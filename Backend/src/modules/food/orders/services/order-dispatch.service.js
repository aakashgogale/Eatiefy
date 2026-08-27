import mongoose from 'mongoose';
import { FoodOrder, FoodSettings } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { config } from '../../../../config/env.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';
import {
  buildDeliverySocketPayload,
  buildOrderIdentityFilter,
  getBusyDeliveryPartnerIds,
  haversineKm,
  notifyOwnerSafely,
  notifyOwnersSafely,
} from './order.helpers.js';
import { fetchDrivingRoute } from '../utils/googleMaps.js';
import { parseGeoPoint } from '../../shared/geo.utils.js';

/**
 * Resolve restaurant → customer road distance once per dispatch broadcast.
 * Falls back to pricing Haversine when Directions is unavailable.
 */
async function enrichPayloadWithTripRoadDistance(order, payload) {
  const existingRoadKm = order?.tripDistanceKm ?? order?.pricing?.roadDistanceKm;
  if (Number.isFinite(Number(existingRoadKm))) {
    const km = Number(Number(existingRoadKm).toFixed(2));
    const minsRaw = order?.tripDurationMins ?? order?.pricing?.roadDurationMins;
    const tripDurationMins = Number.isFinite(Number(minsRaw))
      ? Math.ceil(Number(minsRaw))
      : payload.tripDurationMins;
    return {
      ...payload,
      tripDistanceKm: km,
      tripDurationMins: tripDurationMins ?? null,
      distanceKm: km,
    };
  }

  const restaurantPoint =
    parseGeoPoint(order?.restaurantId) ||
    parseGeoPoint(order?.restaurantId?.location);
  const customerPoint = parseGeoPoint(order?.deliveryAddress);

  if (!restaurantPoint || !customerPoint) {
    return payload;
  }

  try {
    const route = await fetchDrivingRoute(restaurantPoint, customerPoint);
    if (route.distanceKm != null) {
      const tripDurationMins =
        route.durationSeconds != null
          ? Math.ceil(route.durationSeconds / 60)
          : null;

      // Persist so subsequent offers / reconnects reuse road distance.
      if (order?._id) {
        FoodOrder.updateOne(
          { _id: order._id },
          {
            $set: {
              tripDistanceKm: route.distanceKm,
              tripDurationMins,
              'pricing.roadDistanceKm': route.distanceKm,
              'pricing.roadDurationMins': tripDurationMins,
            },
          },
        ).catch(() => {});
      }

      return {
        ...payload,
        tripDistanceKm: route.distanceKm,
        tripDurationMins,
        distanceKm: route.distanceKm,
      };
    }
  } catch (err) {
    logger.warn(`Trip road distance enrichment failed: ${err?.message || err}`);
  }

  return payload;
}

async function listNearbyOnlineDeliveryPartners(
  restaurantId,
  { maxKm = 15, limit = 25 } = {},
) {
  const rId = (restaurantId?._id || restaurantId).toString();
  const restaurant = await FoodRestaurant.findById(rId)
    .select("location city area")
    .lean();

  if (!restaurant?.location?.coordinates?.length) {
    // Without restaurant coords we cannot safely match riders by zone/proximity.
    return { restaurant: null, partners: [] };
  }

  const [rLng, rLat] = restaurant.location.coordinates;
  const allOnline = await FoodDeliveryPartner.find({
    availabilityStatus: "online",
    status: { $nin: ['deactivated', 'rejected', 'blocked'] },
  })
    .select("_id status lastLat lastLng lastLocationAt name phone userId")
    .lean();

  const scored = [];

  for (const p of allOnline) {
    let distanceKm = 2.5; // Default nearby proximity if GPS is initializing

    if (p.lastLat != null && p.lastLng != null && Number.isFinite(p.lastLat) && Number.isFinite(p.lastLng)) {
      const d = haversineKm(rLat, rLng, p.lastLat, p.lastLng);
      if (Number.isFinite(d)) {
        if (d > maxKm) continue; // Outside current search radius
        distanceKm = d;
      }
    }

    scored.push({
      partnerId: p._id,
      userId: p.userId ? p.userId.toString() : p._id.toString(),
      distanceKm,
      status: p.status,
      name: p.name,
      phone: p.phone,
    });
  }

  scored.sort((a, b) => a.distanceKm - b.distanceKm);
  const picked = scored.slice(0, Math.max(1, limit));

  return { partners: picked };
}

export async function getDispatchSettings() {
  return { dispatchMode: "auto" };
}

export async function updateDispatchSettings(dispatchMode, adminId) {
  // Always set to auto
  await FoodSettings.findOneAndUpdate(
    { key: "dispatch" },
    {
      $set: {
        dispatchMode: "auto",
        updatedBy: { role: "ADMIN", adminId, at: new Date() },
      },
    },
    { upsert: true, new: true },
  );
  return getDispatchSettings();
}

export async function tryAutoAssign(orderId, options = {}) {
  const attempt = options.attempt || 1;
  const lockTimeout = 45000; // 45 seconds lock interval
  const staleThreshold = new Date(Date.now() - 15000);

  const order = await FoodOrder.findOneAndUpdate(
    {
      _id: new mongoose.Types.ObjectId(orderId),
      $and: [
        {
          $or: [
            { 'dispatch.status': 'unassigned' },
            { 'dispatch.status': { $exists: false } },
            {
              'dispatch.status': 'assigned',
              'dispatch.acceptedAt': { $exists: false },
              'dispatch.assignedAt': { $lt: new Date(Date.now() - lockTimeout) }
            }
          ]
        },
        {
          $or: [
            { 'dispatch.dispatchingAt': { $exists: false } },
            { 'dispatch.dispatchingAt': null },
            { 'dispatch.dispatchingAt': { $lt: staleThreshold } }
          ]
        }
      ]
    },
    {
      $set: { 'dispatch.dispatchingAt': new Date() }
    },
    { new: true }
  ).populate(['restaurantId', 'userId']);

  if (!order) {
    logger.info(`tryAutoAssign: Skip for ${orderId} (already dispatching, accepted, or multi-attempt lock active).`);
    return null;
  }

  // Decoupling: Ensure order is accepted by restaurant before dispatching to delivery boys
  const DISPATCHABLE_STATUSES = ['confirmed', 'preparing', 'ready_for_pickup', 'ready', 'reached_pickup', 'picked_up', 'reached_drop'];
  if (!DISPATCHABLE_STATUSES.includes(order.orderStatus)) {
    logger.info(`tryAutoAssign: Skip for ${orderId} (status ${order.orderStatus} not dispatchable yet).`);
    return order;
  }

  try {
    const offeredIds = (order.dispatch?.offeredTo || []).map(o => o.partnerId.toString());
    const permanentlyExcludedIds = new Set(
      (order.dispatch?.offeredTo || [])
        .filter((offer) => offer.action === 'deassigned')
        .map((offer) => offer.partnerId.toString())
    );
    
    // RADIUS EXPANSION LOGIC
    // Attempt 1: 15km, Attempt 2: 25km, Attempt 3: 40km, Attempt 4+: 60km
    let maxKm = 15;
    if (attempt === 2) maxKm = 25;
    if (attempt === 3) maxKm = 40;
    if (attempt >= 4) maxKm = 60;

    const searchOptions = { maxKm, limit: 15 };
    const { partners } = await listNearbyOnlineDeliveryPartners(order.restaurantId, searchOptions);
    const busyPartnerIds = await getBusyDeliveryPartnerIds();

    // TIERED ALERT LOGIC
    // Phase 2: Broadcast to all (Attempt 3+)
    // Phase 3: Admin Alert (Attempt 5+ or roughly 5 mins)
    const isPhase3 = attempt >= 6; // ~6 minutes (60s * 6)

    if (isPhase3) {
      logger.error(`[CRITICAL] Order ${order._id} unassigned for ${attempt} mins. Triggering Admin Alert (Phase 3).`);
      // Notify Admin via Push (Web/Mobile)
      try {
        await notifyOwnersSafely(
          [{ ownerType: 'ADMIN', ownerId: 'GLOBAL' }], // Use GLOBAL or specific admin group if defined
          {
            title: 'Unassigned Order Crisis!',
            body: `Order #${order.order_id || order._id} has not been picked up for 5+ minutes. Manual intervention required!`,
            data: { type: 'admin_alert_unassigned', orderId: order._id.toString() }
          }
        );
      } catch (err) {
        logger.warn(`Admin notification failed: ${err.message}`);
      }
    }

    const eligible = partners.filter((partner) => {
      const partnerKey = partner.partnerId.toString();
      if (offeredIds.includes(partnerKey)) return false;
      if (busyPartnerIds.has(partnerKey)) return false;
      return true;
    });

    if (eligible.length === 0) {
      logger.info(`tryAutoAssign: No NEW eligible partners in ${maxKm}km for order ${order._id}. Restarting hunt...`);
      
      // If we ran out of new eligible partners, we might want to re-offer to everyone (Phase 2 style)
      const io = getIO();
      const reofferEligible = partners.filter((partner) => {
        const partnerKey = partner.partnerId.toString();
        if (permanentlyExcludedIds.has(partnerKey)) return false;
        if (busyPartnerIds.has(partnerKey)) return false;
        return true;
      });
      if (io && reofferEligible.length > 0) {
        const basePayload = buildDeliverySocketPayload(order, order.restaurantId);
        const payload = await enrichPayloadWithTripRoadDistance(order, basePayload);
        for (const p of reofferEligible) {
          const room1 = rooms.delivery(p.partnerId);
          io.to(room1).emit('new_order', { ...payload, pickupDistanceKm: p.distanceKm });
          io.to(room1).emit('new_order_available', { ...payload, pickupDistanceKm: p.distanceKm });
          io.to(room1).emit('play_notification_sound', { ...payload, orderId: order.order_id || order.orderId || order._id });

          if (p.userId && p.userId !== p.partnerId.toString()) {
            const room2 = rooms.delivery(p.userId);
            io.to(room2).emit('new_order', { ...payload, pickupDistanceKm: p.distanceKm });
            io.to(room2).emit('new_order_available', { ...payload, pickupDistanceKm: p.distanceKm });
            io.to(room2).emit('play_notification_sound', { ...payload, orderId: order.order_id || order.orderId || order._id });
          }
        }
      }

      // Re-queue itself to keep trying
      await addOrderJob({
        action: 'DISPATCH_TIMEOUT_CHECK',
        orderMongoId: order._id.toString(),
        orderId: order._id.toString(),
        attempt: attempt + 1
      }, { delay: 30000 }); // Retry faster (30s) if no one found

      return order;
    }

    const io = getIO();
    const basePayload = buildDeliverySocketPayload(order, order.restaurantId);
    const payload = await enrichPayloadWithTripRoadDistance(order, basePayload);

    // BROADCAST: Notify all eligible riders
    logger.info(`Broadcasting order ${order._id} to ${eligible.length} riders. tripDistanceKm=${payload.tripDistanceKm}`);
    for (const p of eligible) {
      if (io) {
        const room1 = rooms.delivery(p.partnerId);
        io.to(room1).emit('new_order', { ...payload, pickupDistanceKm: p.distanceKm });
        io.to(room1).emit('new_order_available', { ...payload, pickupDistanceKm: p.distanceKm });
        io.to(room1).emit('play_notification_sound', { ...payload, orderId: order.order_id || order.orderId || order._id });

        if (p.userId && p.userId !== p.partnerId.toString()) {
          const room2 = rooms.delivery(p.userId);
          io.to(room2).emit('new_order', { ...payload, pickupDistanceKm: p.distanceKm });
          io.to(room2).emit('new_order_available', { ...payload, pickupDistanceKm: p.distanceKm });
          io.to(room2).emit('play_notification_sound', { ...payload, orderId: order.order_id || order.orderId || order._id });
        }
      }
    }

    // Batch Push Notifications
    const pushTargets = [];
    for (const p of eligible) {
      pushTargets.push({ ownerType: 'DELIVERY_PARTNER', ownerId: p.partnerId });
      if (p.userId && p.userId !== p.partnerId.toString()) {
        pushTargets.push({ ownerType: 'DELIVERY_PARTNER', ownerId: p.userId });
      }
    }

    if (pushTargets.length > 0) {
      try {
        await notifyOwnersSafely(
          pushTargets,
          {
            title: 'New order available!',
            body: `Order #${order.order_id || order._id} is available. You have 60 seconds to accept!`,
            data: { type: 'new_order', orderId: order._id.toString() },
          }
        );
      } catch (err) {
        logger.warn(`Push notifications failed for broadcast on order ${order._id}: ${err.message}`);
      }
    }

    const offeredToEntries = eligible.map(p => ({
      partnerId: p.partnerId,
      at: new Date(),
      action: 'offered'
    }));

    order.dispatch.status = 'unassigned';
    order.dispatch.deliveryPartnerId = null;
    order.dispatch.offeredTo.push(...offeredToEntries);
    await order.save();

    // Re-check in 60s
    await addOrderJob({
      action: 'DISPATCH_TIMEOUT_CHECK',
      orderMongoId: order._id.toString(),
      orderId: order._id.toString(),
      attempt: attempt + 1
    }, { delay: 60000 });

    return order;
  } finally {
    await FoodOrder.findByIdAndUpdate(orderId, {
      $unset: { 'dispatch.dispatchingAt': '' },
    });
  }
}


export async function processDispatchTimeout(orderId, partnerId) {
  const order = await FoodOrder.findById(orderId);
  if (!order) return;

  const stillAssigned = order.dispatch?.status === 'assigned' &&
    String(order.dispatch?.deliveryPartnerId) === String(partnerId) &&
    !order.dispatch?.acceptedAt;

  if (stillAssigned) {
    logger.info(`Dispatch timeout for partner ${partnerId} on order ${orderId}. Re-trying hunt...`);
    const offer = order.dispatch.offeredTo.find(
      o => String(o.partnerId) === String(partnerId) && o.action === 'offered'
    );
    if (offer) offer.action = 'timeout';

    order.dispatch.status = 'unassigned';
    order.dispatch.deliveryPartnerId = null;
    await order.save();
    
    const attempt = (order.dispatch?.offeredTo?.length || 0) + 1;
    await tryAutoAssign(orderId, { attempt });
  } else if (order.dispatch?.status === 'unassigned') {
    // If it's already unassigned (e.g. from a previous timeout), just keep hunting
    const attempt = (order.dispatch?.offeredTo?.length || 0) + 1;
    await tryAutoAssign(orderId, { attempt });
  }
}


export async function resendDeliveryNotificationRestaurant(orderId, restaurantId) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne({
    ...identity,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  });

  if (!order) throw new NotFoundError('Order not found');

  const activeStatuses = ['confirmed', 'preparing', 'ready_for_pickup', 'ready'];
  if (!activeStatuses.includes(order.orderStatus)) {
    throw new ValidationError(`Cannot resend notification for order in status: ${order.orderStatus}`);
  }

  if (order.dispatch?.status === 'accepted') {
    throw new ValidationError('A delivery partner has already accepted this order.');
  }

  order.dispatch.status = 'unassigned';
  order.dispatch.deliveryPartnerId = null;
  order.dispatch.offeredTo = [];
  await order.save();

  await tryAutoAssign(order._id);
  return { success: true };
}

export async function resendDeliveryNotificationAdmin(orderId) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity);

  if (!order) throw new NotFoundError('Order not found');

  const activeStatuses = ['confirmed', 'preparing', 'ready_for_pickup', 'ready', 'reached_pickup'];
  if (!activeStatuses.includes(order.orderStatus)) {
    throw new ValidationError(`Cannot resend notification for order in status: ${order.orderStatus}`);
  }

  if (order.dispatch?.status === 'accepted') {
    throw new ValidationError('A delivery partner has already accepted this order. Please use Deassign & Resend instead.');
  }

  order.dispatch.status = 'unassigned';
  order.dispatch.deliveryPartnerId = null;
  order.dispatch.offeredTo = [];
  await order.save();

  await tryAutoAssign(order._id);
  return { success: true };
}
