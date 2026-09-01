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
    logger.error(
      `[Dispatch] Restaurant ${rId} has no location.coordinates — no rider can be matched. ` +
      `Fix the outlet pin in Zone setup.`,
    );
    return { restaurant: null, partners: [] };
  }

  const [rLng, rLat] = restaurant.location.coordinates;

  // Counted so an empty result can explain *why* it is empty. Without these a failed
  // dispatch looks identical to a healthy one that simply found nobody, and the only
  // way to tell them apart on a live server is to query Mongo by hand.
  const [totalPartners, approvedPartners, onlinePartners] = await Promise.all([
    FoodDeliveryPartner.countDocuments({}),
    FoodDeliveryPartner.countDocuments({ status: { $nin: ['deactivated', 'rejected', 'blocked'] } }),
    FoodDeliveryPartner.countDocuments({
      availabilityStatus: 'online',
      status: { $nin: ['deactivated', 'rejected', 'blocked'] },
    }),
  ]);

  const approvedOnline = {
    availabilityStatus: "online",
    status: { $nin: ['deactivated', 'rejected', 'blocked'] },
  };
  const riderFields = "_id status lastLat lastLng lastLocationAt name phone userId";

  // Riders with a known position are fetched through the 2dsphere index on
  // `lastLocation`, so Mongo returns only those inside the radius, already ordered
  // by distance. Loading every online rider and filtering in JavaScript — as this
  // did before — costs a full collection read on every dispatch, and dispatch runs
  // on every accept plus a retry per order per minute.
  const [locatedPartners, unlocatedPartners] = await Promise.all([
    FoodDeliveryPartner.find({
      ...approvedOnline,
      lastLocation: {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [rLng, rLat] },
          $maxDistance: maxKm * 1000,
        },
      },
    })
      .select(riderFields)
      .limit(Math.max(limit * 2, 50))
      .lean(),

    // Riders who have never reported GPS cannot be matched geographically. They are
    // still offered the order (with a neutral distance) rather than dropped, which
    // is how they behaved before — but the set is capped so it cannot grow unbounded.
    FoodDeliveryPartner.find({
      ...approvedOnline,
      $or: [{ lastLocation: { $exists: false } }, { lastLocation: null }],
    })
      .select(riderFields)
      .limit(25)
      .lean(),
  ]);

  const allOnline = [...locatedPartners, ...unlocatedPartners];

  const scored = [];

  for (const p of allOnline) {
    let distanceKm = 2.5; // Default nearby proximity if GPS is initializing

    if (p.lastLat != null && p.lastLng != null && Number.isFinite(p.lastLat) && Number.isFinite(p.lastLng)) {
      const d = haversineKm(rLat, rLng, p.lastLat, p.lastLng);
      if (Number.isFinite(d)) {
        if (d > maxKm) continue; // Defensive: geo query should already exclude these.
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

  if (picked.length === 0) {
    let cause;
    if (onlinePartners === 0) {
      cause = 'Cause: no partner has availabilityStatus="online" — riders must go online in the app.';
    } else if (locatedPartners.length === 0 && unlocatedPartners.length === 0) {
      cause = `Cause: ${onlinePartners} rider(s) online, none within ${maxKm}km of this restaurant.`;
    } else {
      cause = 'Cause: every nearby rider is already busy or was excluded for this order.';
    }
    logger.warn(
      `[Dispatch] No rider matched for restaurant ${rId} within ${maxKm}km. ` +
      `partners_total=${totalPartners} approved=${approvedPartners} online=${onlinePartners} ` +
      `in_radius=${locatedPartners.length} no_gps=${unlocatedPartners.length}. ${cause}`,
    );
  } else {
    logger.info(
      `[Dispatch] Matched ${picked.length} rider(s) for restaurant ${rId} within ${maxKm}km ` +
      `(online=${onlinePartners}, in_radius=${locatedPartners.length}, no_gps=${unlocatedPartners.length}).`,
    );
  }

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

/**
 * Schedules the next dispatch attempt.
 *
 * BullMQ is the durable path, but `addOrderJob` is a silent no-op when the queue is
 * unavailable (Redis down, BULLMQ_ENABLED=false). Dispatch retries are the only
 * thing that gets an order to a rider who comes online a minute later, so losing
 * them strands the order forever. When the queue cannot take the job we fall back
 * to an in-process timer: weaker than a queue — it does not survive a restart — but
 * far better than dropping the retry entirely.
 *
 * @param {import('mongoose').Types.ObjectId|string} orderMongoId
 * @param {number} nextAttempt
 * @param {number} delayMs
 */
async function scheduleDispatchRetry(orderMongoId, nextAttempt, delayMs) {
  const id = String(orderMongoId);
  const payload = {
    action: 'DISPATCH_TIMEOUT_CHECK',
    orderMongoId: id,
    orderId: id,
    attempt: nextAttempt,
  };

  try {
    const job = await addOrderJob(payload, { delay: delayMs });
    if (job) return;
  } catch (err) {
    logger.error(`[Dispatch] Failed to queue retry for order ${id}: ${err.message}`);
  }

  logger.warn(
    `[Dispatch] Queue unavailable — retrying order ${id} via in-process timer in ${delayMs}ms ` +
    `(attempt ${nextAttempt}). Enable Redis + BULLMQ_ENABLED for retries that survive a restart.`,
  );
  setTimeout(() => {
    tryAutoAssign(id, { attempt: nextAttempt }).catch((err) =>
      logger.error(`[Dispatch] In-process retry failed for order ${id}: ${err.message}`),
    );
  }, delayMs).unref?.();
}

/**
 * @typedef {object} DispatchOutcome
 * @property {object|null} order
 * @property {number} notifiedCount how many partners were actually offered the order
 * @property {boolean} skipped true when the run was refused before offering anything
 * @property {string} reason human-readable explanation, safe to show to staff
 */

export async function tryAutoAssign(orderId, options = {}) {
  const attempt = options.attempt || 1;

  // Callers that only re-dispatch in the background keep the legacy contract
  // (order document, or null when the run was skipped). `detailed: true` returns a
  // DispatchOutcome instead — used by the manual "resend" actions, which must be
  // able to tell staff whether anyone was actually reached.
  const outcome = (order, notifiedCount, skipped, reason) =>
    options.detailed ? { order, notifiedCount, skipped, reason } : order;
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
    return outcome(null, 0, true, 'A dispatch attempt for this order is already in progress.');
  }

  // Decoupling: Ensure order is accepted by restaurant before dispatching to delivery boys
  const DISPATCHABLE_STATUSES = ['confirmed', 'preparing', 'ready_for_pickup', 'ready', 'reached_pickup', 'picked_up', 'reached_drop'];
  if (!DISPATCHABLE_STATUSES.includes(order.orderStatus)) {
    logger.info(`tryAutoAssign: Skip for ${orderId} (status ${order.orderStatus} not dispatchable yet).`);
    // This return sits before the try/finally below, so the lock this function just
    // took has to be released by hand — otherwise the order stays locked and every
    // later attempt (including a manual resend) is silently refused.
    await FoodOrder.findByIdAndUpdate(orderId, { $unset: { 'dispatch.dispatchingAt': '' } });
    return outcome(order, 0, true, `Order status "${order.orderStatus}" cannot be dispatched yet.`);
  }

  try {
    const rejectedPartnerIds = new Set(
      (order.dispatch?.offeredTo || [])
        .filter((offer) => offer.action === 'rejected' || offer.action === 'deassigned')
        .map((offer) => offer.partnerId?.toString?.())
        .filter(Boolean)
    );

    const currentlyOfferedIds = new Set(
      (order.dispatch?.offeredTo || [])
        .filter((offer) => offer.action === 'offered')
        .map((offer) => offer.partnerId?.toString?.())
        .filter(Boolean)
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
      if (rejectedPartnerIds.has(partnerKey)) return false;
      if (currentlyOfferedIds.has(partnerKey)) return false;
      if (busyPartnerIds.has(partnerKey)) return false;
      return true;
    });

    if (eligible.length === 0) {
      logger.info(`tryAutoAssign: No NEW eligible partners in ${maxKm}km for order ${order._id}. Restarting hunt...`);
      
      // Re-offer to non-rejected online delivery partners (excluding those who explicitly rejected this order)
      const io = getIO();
      const reofferEligible = partners.filter((partner) => {
        const partnerKey = partner.partnerId.toString();
        if (rejectedPartnerIds.has(partnerKey)) return false;
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

      // Push as well as sockets. This branch is what the automatic retries hit, so
      // sending only over the socket meant a rider whose app was closed — or whose
      // socket was down — could never be reached again after the first offer.
      if (reofferEligible.length > 0) {
        const pushTargets = [];
        for (const p of reofferEligible) {
          pushTargets.push({ ownerType: 'DELIVERY_PARTNER', ownerId: p.partnerId });
          if (p.userId && p.userId !== p.partnerId.toString()) {
            pushTargets.push({ ownerType: 'DELIVERY_PARTNER', ownerId: p.userId });
          }
        }
        try {
          await notifyOwnersSafely(pushTargets, {
            title: 'New order available!',
            body: `Order #${order.order_id || order._id} is still waiting for a delivery partner.`,
            data: { type: 'new_order', orderId: order._id.toString() },
          });
        } catch (err) {
          logger.warn(`Re-offer push failed for order ${order._id}: ${err.message}`);
        }
      }

      // Retry faster (30s) when nobody was found at all.
      await scheduleDispatchRetry(order._id, attempt + 1, 30000);

      const reofferedCount = reofferEligible.length;
      return outcome(
        order,
        reofferedCount,
        false,
        reofferedCount > 0
          ? `Re-offered to ${reofferedCount} delivery partner(s).`
          : 'No delivery partner is online near the restaurant right now.',
      );
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
    await scheduleDispatchRetry(order._id, attempt + 1, 60000);

    return outcome(
      order,
      eligible.length,
      false,
      `Offered to ${eligible.length} delivery partner(s).`,
    );
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
  // `dispatchingAt` is the in-progress lock tryAutoAssign checks. A resend that
  // leaves it set is refused by that lock and returns a cheerful success while
  // reaching nobody — which is exactly how "resend does nothing" looked. The
  // restaurant-accept path already cleared it; these paths must match.
  // null rather than undefined: Mongoose does not always mark a nested path as
  // modified when it is set to undefined, and the lock query treats null and a
  // missing field identically.
  order.dispatch.dispatchingAt = null;
  await order.save();

  const result = await tryAutoAssign(order._id, { detailed: true });

  // A manual resend is a person waiting for an answer: report what really happened
  // instead of an unconditional success.
  if (result.skipped) {
    throw new ValidationError(result.reason);
  }
  if (result.notifiedCount === 0) {
    throw new ValidationError(
      'No delivery partner is online near the restaurant right now. ' +
      'We will keep retrying automatically.',
    );
  }

  return { success: true, notifiedCount: result.notifiedCount, message: result.reason };
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
  // `dispatchingAt` is the in-progress lock tryAutoAssign checks. A resend that
  // leaves it set is refused by that lock and returns a cheerful success while
  // reaching nobody — which is exactly how "resend does nothing" looked. The
  // restaurant-accept path already cleared it; these paths must match.
  // null rather than undefined: Mongoose does not always mark a nested path as
  // modified when it is set to undefined, and the lock query treats null and a
  // missing field identically.
  order.dispatch.dispatchingAt = null;
  await order.save();

  const result = await tryAutoAssign(order._id, { detailed: true });

  // A manual resend is a person waiting for an answer: report what really happened
  // instead of an unconditional success.
  if (result.skipped) {
    throw new ValidationError(result.reason);
  }
  if (result.notifiedCount === 0) {
    throw new ValidationError(
      'No delivery partner is online near the restaurant right now. ' +
      'We will keep retrying automatically.',
    );
  }

  return { success: true, notifiedCount: result.notifiedCount, message: result.reason };
}
