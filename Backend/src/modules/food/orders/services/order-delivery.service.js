import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodDeliveryCashDeposit } from '../../delivery/models/foodDeliveryCashDeposit.model.js';
import { FoodDeliveryCashLimit } from '../../admin/models/deliveryCashLimit.model.js';
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from '../../../../core/auth/errors.js';
import { buildPaginatedResult, buildPaginationOptions } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { createInboxNotifications } from '../../../../core/notifications/notification.service.js';
import { getFirebaseDB } from '../../../../config/firebase.js';
import {
  fetchRazorpayPaymentLink,
  isRazorpayConfigured,
} from '../helpers/razorpay.helper.js';
import { fetchPolyline, toGeoJsonPoint } from '../utils/googleMaps.js';
import {
  ensureRiderEarningOnOrder,
} from './riderEarning.service.js';
import * as foodTransactionService from './foodTransaction.service.js';
import * as dispatchService from './order-dispatch.service.js';
import {
  buildOrderIdentityFilter,
  emitDeliveryDropOtpToUser,
  enqueueOrderEvent,
  generateFourDigitDeliveryOtp,
  haversineKm,
  notifyOwnerSafely,
  notifyOwnersSafely,
  pushStatusHistory,
  sanitizeOrderForExternal,
  isStatusAdvance,
} from './order.helpers.js';
import { detectZoneIdForPoint, getActiveZoneById, isPointInZonePolygon } from '../../utils/zoneGeo.js';

/** Match dispatch hard cap — never list/accept cross-city absurd distances. */
const HARD_MAX_OFFER_DISTANCE_KM = 40;

function normalizeOtpValue(value) {
  return String(value ?? '').replace(/\D/g, '').trim();
}

function isOtpMatch(expectedOtp, enteredOtp) {
  const expected = normalizeOtpValue(expectedOtp);
  const entered = normalizeOtpValue(enteredOtp);
  if (!expected || !entered) return false;
  if (entered === expected) return true;

  // Accept last 4 digits if client sends prefixed/padded OTP.
  if (expected.length === 4 && entered.length > 4) {
    return entered.slice(-4) === expected;
  }

  return false;
}

const ACTIVE_TRIP_ORDER_STATUSES = ['preparing', 'ready_for_pickup', 'picked_up'];

export async function getMaxConcurrentOrders() {
  const doc = await FoodDeliveryCashLimit.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .lean();
  return Math.min(5, Math.max(1, Number(doc?.maxConcurrentOrders ?? 1)));
}

export async function countActiveTripsForPartner(deliveryPartnerId) {
  if (!deliveryPartnerId) return 0;
  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  return FoodOrder.countDocuments({
    'dispatch.deliveryPartnerId': partnerId,
    'dispatch.status': 'accepted',
    orderStatus: { $in: ACTIVE_TRIP_ORDER_STATUSES },
  });
}

export async function getPartnerOrderCapacity(deliveryPartnerId) {
  const [max, active] = await Promise.all([
    getMaxConcurrentOrders(),
    countActiveTripsForPartner(deliveryPartnerId),
  ]);
  const remaining = Math.max(0, max - active);
  return { max, active, remaining };
}

async function enrichOrderWithTransaction(order) {
  if (!order) return null;
  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const out = sanitizeOrderForExternal(order);
  if (tx) {
    out.paymentMethod = tx.payment?.method || tx.paymentMethod || out.paymentMethod;
    out.payment = tx.payment || out.payment;
    out.pricing = tx.pricing || out.pricing;
    out.amounts = tx.amounts || out.amounts;
    out.transactionStatus = tx.status || out.transactionStatus;
  }
  return out;
}

export async function getActiveTripsDelivery(deliveryPartnerId) {
  if (!deliveryPartnerId) {
    throw new ValidationError('Delivery partner ID required');
  }

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const orders = await FoodOrder.find({
    'dispatch.deliveryPartnerId': partnerId,
    'dispatch.status': 'accepted',
    orderStatus: { $in: ACTIVE_TRIP_ORDER_STATUSES },
  })
    .populate({
      path: 'restaurantId',
      select:
        'restaurantName name phone ownerPhone primaryContactNumber location addressLine1 addressLine2 area city state pincode landmark profileImage',
    })
    .populate({ path: 'userId', select: 'name phone' })
    .sort({ updatedAt: -1 })
    .lean();

  const enriched = await Promise.all(
    (orders || []).map((order) => enrichOrderWithTransaction(order)),
  );
  return enriched.filter(Boolean);
}

export async function getCurrentTripDelivery(deliveryPartnerId) {
  const orders = await getActiveTripsDelivery(deliveryPartnerId);
  return orders[0] || null;
}

async function getPartnerCashCapacity(deliveryPartnerId) {
  const partnerObjectId = new mongoose.Types.ObjectId(deliveryPartnerId);
  const limitDoc = await FoodDeliveryCashLimit.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .lean();

  const totalCashLimit = Number(limitDoc?.deliveryCashLimit || 0);
  // If limit is not configured, don't block assignments globally.
  if (!Number.isFinite(totalCashLimit) || totalCashLimit <= 0) {
    return {
      totalCashLimit: 0,
      cashInHand: 0,
      availableCashLimit: Number.MAX_SAFE_INTEGER,
      hasCapacity: true,
    };
  }

  const [cashAgg, depositsAgg] = await Promise.all([
    FoodOrder.aggregate([
      {
        $match: {
          'dispatch.deliveryPartnerId': partnerObjectId,
          orderStatus: 'delivered',
        },
      },
      {
        $lookup: {
          from: 'food_transactions',
          localField: '_id',
          foreignField: 'orderId',
          as: 'tx',
        },
      },
      {
        $match: {
          $or: [
            { 'tx.paymentMethod': 'cash' },
            { 'tx': { $size: 0 }, 'payment.method': 'cash' }
          ]
        }
      },
      {
        $group: {
          _id: null,
          grossCashCollected: { $sum: { $ifNull: ['$pricing.total', 0] } },
        },
      },
    ]),
    FoodDeliveryCashDeposit.aggregate([
      {
        $match: {
          deliveryPartnerId: partnerObjectId,
          status: 'Completed',
        },
      },
      {
        $group: {
          _id: null,
          depositedCash: { $sum: { $ifNull: ['$amount', 0] } },
        },
      },
    ]),
  ]);

  const grossCashCollected = Number(cashAgg?.[0]?.grossCashCollected || 0);
  const depositedCash = Number(depositsAgg?.[0]?.depositedCash || 0);
  const cashInHand = Math.max(0, grossCashCollected - depositedCash);
  const availableCashLimit = Math.max(0, totalCashLimit - cashInHand);

  return {
    totalCashLimit,
    cashInHand,
    availableCashLimit,
    hasCapacity: availableCashLimit > 0,
  };
}

function emitOrderUpdate(order, deliveryPartnerId, options = {}) {
  const shouldSendMilestonePush = options?.sendMilestonePush !== false;
  try {
    const io = getIO();
    if (io) {
      const dv =
        order.deliveryVerification?.toObject?.() || order.deliveryVerification;
      const readableId = order.orderId || (order._id ? `FOD-${order._id.toString().slice(-6).toUpperCase()}` : '');
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: readableId,
        displayOrderId: readableId,
        orderStatus: order.orderStatus,
        deliveryState: order.deliveryState,
        deliveryVerification: dv,
      };
      io.to(rooms.delivery(deliveryPartnerId)).emit(
        'order_status_update',
        payload,
      );
      io.to(rooms.restaurant(order.restaurantId)).emit(
        'order_status_update',
        payload,
      );
      io.to(rooms.user(order.userId)).emit('order_status_update', payload);
    }

    // Only send push notifications for key delivery milestones when explicitly allowed.
    if (!shouldSendMilestonePush) return;

    // Only send push notifications for key delivery milestones
    const status = order.orderStatus;
    if (!['picked_up', 'reached_drop', 'delivered'].includes(status)) return;

    let userTitle = '';
    let userBody = '';
    let riderTitle = '';
    let riderBody = '';

    const orderId = order._id.toString();
    const displayOrderId = order.order_id || orderId;

    if (status === 'picked_up') {
      userTitle = 'Order on the way!';
      userBody = `Partner has picked up your order #${orderId} and is heading your way.`;
      riderTitle = 'Order picked up!';
      riderBody = `You have picked up order #${displayOrderId}. Proceed to the customer location.`;
    } else if (status === 'reached_drop') {
      userTitle = 'Partner nearby!';
      userBody = `Your delivery partner has reached your location for order #${orderId}.`;
      riderTitle = 'Arrived at drop!';
      riderBody = `You have reached the customer location for order #${displayOrderId}.`;
    } else if (status === 'delivered') {
      userTitle = `Order #${orderId} delivered!`;
      userBody = 'Hope you enjoyed your meal! Don\'t forget to rate your experience.';
      riderTitle = 'Delivery successful!';
      riderBody = `Order #${displayOrderId} has been successfully delivered.`;

      if (order.payment?.method === 'cash' || order.paymentMethod === 'cash') {
        riderTitle = 'Payment collected!';
        const amt = order.pricing?.total || order.amounts?.totalCustomerPaid || 0;
        riderBody = `You have collected Rs ${amt} cash for Order #${displayOrderId}.`;
      }
    }

    if (userTitle) {
      void notifyOwnerSafely(
        { ownerType: 'USER', ownerId: order.userId },
        {
          title: userTitle,
          body: userBody,
          // Must include notification payload so Android/iOS show tray UI when app is killed
          data: {
            type: 'order_status_update',
            orderId,
            orderMongoId: order._id?.toString?.() || '',
            orderStatus: status,
            link: `/food/user/orders/${order._id?.toString?.() || ''}`,
          },
        },
      );
    }

    if (riderTitle) {
      void notifyOwnerSafely(
        { ownerType: 'DELIVERY_PARTNER', ownerId: deliveryPartnerId },
        {
          title: riderTitle,
          body: riderBody,
          dataOnly: true,
          data: {
            type: status === 'delivered' ? 'order_completed' : 'order_status_update',
            orderId: displayOrderId,
            orderMongoId: order._id?.toString?.() || '',
            title: riderTitle,
            body: riderBody,
            paymentMethod: order.payment?.method || order.paymentMethod,
            amountCollected: String(order.pricing?.total || order.amounts?.totalCustomerPaid || 0),
          },
        },
      );
    }
  } catch (error) {
    logger.error(`Error emitting delivery order update: ${error?.message || error}`);
  }
}

async function syncRazorpayQrPayment(orderDoc) {
  // Phase 2: FoodTransaction is source of truth; avoid relying on FoodOrder.payment.
  const tx = await FoodTransaction.findOne({ orderId: orderDoc?._id }).lean();
  const payment = tx?.payment || orderDoc?.payment || null;
  if (!payment) return null;
  if (payment.method !== 'razorpay_qr') return payment;
  if (payment.status === 'paid') return payment;

  const paymentLinkId = payment?.qr?.paymentLinkId;
  if (!paymentLinkId || !isRazorpayConfigured()) return payment;

  let link;
  try {
    link = await fetchRazorpayPaymentLink(paymentLinkId);
  } catch (error) {
    logger.warn(
      `Razorpay payment-link fetch failed for ${paymentLinkId}: ${
        error?.message || error
      }`,
    );
    return orderDoc.payment;
  }

  const linkStatus = String(link?.status || '').toLowerCase();
  if (!linkStatus) return orderDoc.payment;

  await FoodTransaction.updateOne(
    { orderId: orderDoc?._id },
    {
      $set: {
        'payment.qr.status': linkStatus,
        'payment.status': ['paid', 'captured', 'authorized'].includes(linkStatus)
          ? 'paid'
          : ['expired', 'cancelled', 'canceled', 'failed'].includes(linkStatus)
            ? 'failed'
            : (payment.status || 'pending_qr'),
      },
    },
  );

  const updatedTx = await FoodTransaction.findOne({ orderId: orderDoc?._id }).lean();
  return updatedTx?.payment || payment;
}

export async function listOrdersAvailableDelivery(deliveryPartnerId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const [partnerCapacity, orderCapacity, partner] = await Promise.all([
    getPartnerCashCapacity(deliveryPartnerId),
    getPartnerOrderCapacity(deliveryPartnerId),
    FoodDeliveryPartner.findById(deliveryPartnerId)
      .select('lastLat lastLng lastLocationAt')
      .lean(),
  ]);
  const cashLimit = {
    blocked: !partnerCapacity.hasCapacity,
    message: !partnerCapacity.hasCapacity
      ? 'Please deposit your amount to get new orders.'
      : '',
    totalCashLimit: Number(partnerCapacity.totalCashLimit || 0),
    cashInHand: Number(partnerCapacity.cashInHand || 0),
    availableCashLimit: Number(partnerCapacity.availableCashLimit || 0),
  };

  const activeOwnOrderFilter = {
    orderType: 'delivery',
    'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(deliveryPartnerId),
    orderStatus: {
      $nin: [
        'delivered',
        'cancelled_by_user',
        'cancelled_by_restaurant',
        'cancelled_by_admin',
      ],
    },
  };

  // Zone-scope new offers: partner must be inside the same service zone as the restaurant GPS.
  const partnerZoneId = await detectZoneIdForPoint(partner?.lastLat, partner?.lastLng);
  const partnerZoneDoc = partnerZoneId ? await getActiveZoneById(partnerZoneId) : null;

  let unassignedOfferFilter = null;
  if (
    partnerCapacity.hasCapacity &&
    orderCapacity.remaining > 0 &&
    partnerZoneId
  ) {
    unassignedOfferFilter = {
      orderType: 'delivery',
      'dispatch.status': 'unassigned',
      orderStatus: { $in: ['preparing', 'ready_for_pickup'] },
      zoneId: new mongoose.Types.ObjectId(partnerZoneId),
    };
  }

  const filter = unassignedOfferFilter
    ? { $or: [unassignedOfferFilter, activeOwnOrderFilter] }
    : activeOwnOrderFilter;

  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name phone email')
      .populate(
        'restaurantId',
        'restaurantName name address phone ownerPhone location profileImage zoneId',
      )
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);

  const orderIds = (docs || []).map((d) => d?._id).filter(Boolean);
  const txRows = orderIds.length
    ? await FoodTransaction.find({ orderId: { $in: orderIds } }).lean()
    : [];
  const txByOrderId = new Map(txRows.map((t) => [String(t.orderId), t]));

  const enriched = (docs || []).map((doc) => {
    const tx = txByOrderId.get(String(doc?._id)) || null;
    if (!tx) return doc;
    return {
      ...doc,
      paymentMethod: tx.payment?.method || tx.paymentMethod || doc.paymentMethod,
      payment: tx.payment || doc.payment,
      pricing: tx.pricing || doc.pricing,
      amounts: tx.amounts || doc.amounts,
      transactionStatus: tx.status || doc.transactionStatus,
    };
  });

  const isRestaurantInPartnerZone = (order) => {
    const coords = order?.restaurantId?.location?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2 || !partnerZoneDoc) return false;
    const [rLng, rLat] = coords;
    return isPointInZonePolygon(rLat, rLng, partnerZoneDoc.coordinates || []);
  };

  const isWithinOfferDistance = (order) => {
    const coords = order?.restaurantId?.location?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return false;
    if (partner?.lastLat == null || partner?.lastLng == null) return false;
    const [rLng, rLat] = coords;
    const d = haversineKm(partner.lastLat, partner.lastLng, rLat, rLng);
    return Number.isFinite(d) && d <= HARD_MAX_OFFER_DISTANCE_KM;
  };

  const newOffers = enriched.filter((order) => {
    const dispatchStatus = String(order?.dispatch?.status || '').toLowerCase();
    const orderStatus = String(order?.orderStatus || '').toLowerCase();
    const isOwnAccepted =
      String(order?.dispatch?.deliveryPartnerId || '') === String(deliveryPartnerId);
    if (isOwnAccepted) return false;
    return (
      partnerZoneId &&
      isRestaurantInPartnerZone(order) &&
      isWithinOfferDistance(order) &&
      ['unassigned', 'assigned'].includes(dispatchStatus) &&
      ['preparing', 'ready_for_pickup'].includes(orderStatus)
    );
  });

  const acceptedOrders = enriched.filter((order) => {
    const dispatchStatus = String(order?.dispatch?.status || '').toLowerCase();
    const partnerMatch =
      String(order?.dispatch?.deliveryPartnerId || '') === String(deliveryPartnerId);
    return dispatchStatus === 'accepted' && partnerMatch;
  });

  return {
    ...buildPaginatedResult({ docs: enriched, total, page, limit }),
    cashLimit,
    capacity: orderCapacity,
    newOffers,
    acceptedOrders,
  };
}

export async function acceptOrderDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const partnerId = new mongoose.Types.ObjectId(deliveryPartnerId);

  const existingOrder = await FoodOrder.findOne(identity)
    .select('pricing payment dispatch orderStatus zoneId restaurantId')
    .populate({ path: 'restaurantId', select: 'zoneId location' })
    .lean();
  if (!existingOrder) throw new NotFoundError('Order not found');

  const partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
    .select('lastLat lastLng lastLocationAt')
    .lean();
  const partnerZoneId = await detectZoneIdForPoint(partner?.lastLat, partner?.lastLng);
  const restaurantCoords = existingOrder?.restaurantId?.location?.coordinates;
  const restaurantZoneId =
    Array.isArray(restaurantCoords) && restaurantCoords.length >= 2
      ? await detectZoneIdForPoint(restaurantCoords[1], restaurantCoords[0])
      : String(existingOrder?.zoneId || existingOrder?.restaurantId?.zoneId || '').trim() || null;
  const orderZoneId = String(
    restaurantZoneId || existingOrder?.zoneId || existingOrder?.restaurantId?.zoneId || '',
  ).trim();

  const alreadyAcceptedByPartnerEarly =
    existingOrder?.dispatch?.status === 'accepted' &&
    String(existingOrder?.dispatch?.deliveryPartnerId || '') === String(deliveryPartnerId);

  if (!alreadyAcceptedByPartnerEarly) {
    if (!partnerZoneId || !orderZoneId || partnerZoneId !== orderZoneId) {
      throw new ForbiddenError('This order is outside your service zone');
    }
    if (
      Array.isArray(restaurantCoords) &&
      restaurantCoords.length >= 2 &&
      partner?.lastLat != null &&
      partner?.lastLng != null
    ) {
      const d = haversineKm(
        partner.lastLat,
        partner.lastLng,
        restaurantCoords[1],
        restaurantCoords[0],
      );
      if (!Number.isFinite(d) || d > HARD_MAX_OFFER_DISTANCE_KM) {
        throw new ForbiddenError('This order is too far from your current location');
      }
    }
  }

  const paymentMethod = String(existingOrder?.payment?.method || 'cash').toLowerCase();
  const isCashOrder = paymentMethod === 'cash';
  const orderAmount = Math.max(0, Number(existingOrder?.pricing?.total || 0));
  const offeredEntry = (existingOrder?.dispatch?.offeredTo || []).find(
    (entry) => String(entry?.partnerId || '') === String(deliveryPartnerId),
  );
  const canBypassCashLimit = Boolean(offeredEntry?.allowOverLimit);

  const partnerCapacity = await getPartnerCashCapacity(deliveryPartnerId);
  const hasAmountCapacity = Number(partnerCapacity.availableCashLimit || 0) >= orderAmount;

  if (isCashOrder && !hasAmountCapacity && !canBypassCashLimit) {
    throw new ValidationError('Cash limit is not enough for this order amount. Please deposit your amount to get orders.');
  }

  if (!partnerCapacity.hasCapacity && !canBypassCashLimit) {
    throw new ValidationError('Cash limit reached. Please deposit your amount to get orders.');
  }

  const orderCapacity = await getPartnerOrderCapacity(deliveryPartnerId);
  const alreadyAcceptedByPartner = alreadyAcceptedByPartnerEarly;

  if (!alreadyAcceptedByPartner && orderCapacity.remaining <= 0) {
    throw new ValidationError('Maximum concurrent orders reached');
  }

  const now = new Date();
  const acceptedStatuses = ['preparing', 'ready_for_pickup', 'picked_up'];
  const cancellableStatuses = [
    'cancelled_by_user',
    'cancelled_by_restaurant',
    'cancelled_by_admin',
  ];

  const statusHistoryEntry = {
    byRole: 'DELIVERY_PARTNER',
    byId: partnerId,
    from: 'dispatchable',
    to: 'accepted',
    note: 'Delivery partner accepted order',
    at: now,
  };

  const order = await FoodOrder.findOneAndUpdate(
    {
      ...identity,
      orderType: 'delivery',
      orderStatus: { $in: acceptedStatuses },
      $or: [
        { 'dispatch.status': 'unassigned' },
        {
          'dispatch.status': 'assigned',
          'dispatch.deliveryPartnerId': partnerId,
        },
      ],
    },
    {
      $set: {
        'dispatch.deliveryPartnerId': partnerId,
        'dispatch.status': 'accepted',
        'dispatch.assignedAt': now,
        'dispatch.acceptedAt': now,
      },
      $push: {
        statusHistory: statusHistoryEntry,
      },
    },
    { new: true },
  ).populate('restaurantId userId');

  if (!order) {
    const existing = await FoodOrder.findOne(identity)
      .select('orderStatus dispatch')
      .lean();

    if (!existing) throw new NotFoundError('Order not found');
    if (cancellableStatuses.includes(existing.orderStatus)) {
      throw new ValidationError('Order was cancelled');
    }
    if (existing.orderStatus === 'delivered') {
      throw new ValidationError('Order already delivered');
    }
    if (!acceptedStatuses.includes(existing.orderStatus)) {
      throw new ValidationError('Order not ready for delivery assignment');
    }
    if (
      existing.dispatch?.status === 'accepted' &&
      String(existing.dispatch?.deliveryPartnerId || '') === String(deliveryPartnerId)
    ) {
      const acceptedOrder = await FoodOrder.findOne(identity)
        .populate('restaurantId userId');
      return acceptedOrder
        ? sanitizeOrderForExternal(acceptedOrder)
        : null;
    }
    if (
      existing.dispatch?.status === 'accepted' &&
      String(existing.dispatch?.deliveryPartnerId || '') !== String(deliveryPartnerId)
    ) {
      throw new ForbiddenError('Order already accepted by another partner');
    }

    throw new ValidationError('Order is no longer available to accept');
  }

  try {
    const before = Number(order.riderEarning || 0);
    await ensureRiderEarningOnOrder(order);
    if (Number(order.riderEarning || 0) > before) {
      await order.save();
    }
  } catch (err) {
    logger.warn(`ensureRiderEarningOnOrder on accept failed: ${err?.message || err}`);
  }

  const responseOrder = sanitizeOrderForExternal(order);

  // Notify other riders IMMEDIATELY — do not wait for Firebase/polyline work
  try {
    const io = getIO();
    if (io) {
      const claimedPayload = {
        orderId: order._id.toString(),
        orderMongoId: order._id?.toString?.(),
        claimedBy: deliveryPartnerId.toString(),
        message: 'This request accepted by another rider',
      };
      io.to('all_delivery').emit('order_claimed', claimedPayload);
      logger.info(
        `[DeliveryDispatch] Broadcasted order_claimed immediately for order ${order._id.toString()}`,
      );

      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        dispatchStatus: order.dispatch?.status,
      };
      io.to(rooms.delivery(deliveryPartnerId)).emit('order_status_update', payload);
      io.to(rooms.restaurant(order.restaurantId)).emit('order_status_update', payload);
      io.to(rooms.user(order.userId)).emit('order_status_update', payload);
    }
  } catch (error) {
    logger.error(`Error emitting order_claimed on accept: ${error?.message || error}`);
  }

  void (async () => {
    try {
      const rest = order.restaurantId;
      const userLoc = order.deliveryAddress?.location?.coordinates;
      const restLoc = rest?.location?.coordinates;

      if (restLoc?.[0] && userLoc?.[0]) {
        const polyline = await fetchPolyline(
          { lat: restLoc[1], lng: restLoc[0] },
          { lat: userLoc[1], lng: userLoc[0] },
        );

        const db = getFirebaseDB();
        if (db) {
          const orderRef = db.ref(`active_orders/${order._id.toString()}`);
          await orderRef
            .set({
              polyline,
              lat: restLoc[1],
              lng: restLoc[0],
              boy_lat: restLoc[1],
              boy_lng: restLoc[0],
              restaurant_lat: restLoc[1],
              restaurant_lng: restLoc[0],
              customer_lat: userLoc[1],
              customer_lng: userLoc[0],
              status: 'accepted',
              last_updated: Date.now(),
            })
            .catch((error) =>
              logger.error(`Firebase orderRef set error: ${error.message}`),
            );
        }
      }
    } catch (error) {
      logger.error(
        `Error initializing Firebase order tracking: ${error?.message || error}`,
      );
    }

    try {
      await foodTransactionService.updateTransactionRider(order._id, deliveryPartnerId);
    } catch (error) {
      logger.error(
        `Error updating delivery rider transaction for ${order._id}: ${
          error?.message || error
        }`,
      );
    }

    try {
      await notifyOwnerSafely(
        { ownerType: 'USER', ownerId: order.userId },
        {
          title: `Delivery partner assigned`,
          body: `A delivery partner has accepted Order #${order._id.toString()}.`,
          data: {
            type: 'delivery_accepted',
            orderId: order._id.toString(),
            orderMongoId: order._id?.toString?.() || '',
            dispatchStatus: order.dispatch?.status,
            link: '/food/user/orders',
          },
        },
      );

      await notifyOwnerSafely(
        { ownerType: 'RESTAURANT', ownerId: order.restaurantId },
        {
          title: `Rider assigned`,
          body: `Order #${order._id.toString()} is now assigned to a delivery partner.`,
          data: {
            type: 'delivery_accepted',
            orderId: order._id.toString(),
            orderMongoId: order._id?.toString?.() || '',
            dispatchStatus: order.dispatch?.status,
            link: '/food/restaurant/orders',
          },
        },
      );
    } catch (error) {
      logger.error(
        `Error notifying delivery acceptance for ${order._id}: ${
          error?.message || error
        }`,
      );
    }
  })();

  enqueueOrderEvent('delivery_accepted', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    dispatchStatus: order.dispatch?.status,
    orderStatus: order.orderStatus,
  });

  return responseOrder;
}

export async function rejectOrderDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (order.dispatch.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()) {
    throw new ForbiddenError('Not your order');
  }

  const offer = order.dispatch.offeredTo.find(
    (item) =>
      String(item.partnerId) === String(deliveryPartnerId) &&
      item.action === 'offered',
  );
  if (offer) offer.action = 'rejected';

  order.dispatch.status = 'unassigned';
  order.dispatch.deliveryPartnerId = undefined;
  order.dispatch.assignedAt = undefined;
  order.dispatch.acceptedAt = undefined;
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from: 'assigned',
    to: 'unassigned',
    note: 'Rejected',
  });
  await order.save();

  enqueueOrderEvent('delivery_rejected', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
  });

  void dispatchService
    .tryAutoAssign(order._id)
    .catch((error) =>
      logger.error(`SmartDispatch: Auto-assign after reject failed: ${error.message}`),
    );

  return order.toObject();
}

export async function confirmReachedPickupDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }
  if (order.orderStatus === 'delivered') {
    throw new ValidationError('Order already delivered');
  }

  const currentPhase = order.deliveryState?.currentPhase || '';
  const currentStatus = order.deliveryState?.status || '';
  if (currentPhase === 'at_pickup' || currentStatus === 'reached_pickup') {
    return order.toObject();
  }

  const from = currentStatus || currentPhase || order.orderStatus;
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'at_pickup',
    status: 'reached_pickup',
    reachedPickupAt: order.deliveryState?.reachedPickupAt || new Date(),
  };
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'reached_pickup',
    note: 'Reached pickup location',
  });
  await order.save();

  emitOrderUpdate(order, deliveryPartnerId);

  try {
    const restaurant = await FoodRestaurant.findById(order.restaurantId)
      .select('restaurantName')
      .lean();
    const partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
      .select('name')
      .lean();

    await notifyOwnersSafely(
      [{ ownerType: 'RESTAURANT', ownerId: order.restaurantId }],
      {
        title: 'Rider arrived!',
        body: `${partner?.name || 'The delivery partner'} has arrived at ${
          restaurant?.restaurantName || 'your restaurant'
        } to pick up Order #${order._id.toString()}.`,
        data: {
          type: 'rider_arrived',
          orderId: String(order._id.toString()),
          orderMongoId: String(order._id),
          partnerName: partner?.name || '',
        },
      },
    );
  } catch (error) {
    logger.error(
      `Error notifying restaurant about rider arrival for ${order._id}: ${
        error?.message || error
      }`,
    );
  }

  enqueueOrderEvent('reached_pickup', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    orderStatus: order.orderStatus,
    deliveryPhase: order.deliveryState?.currentPhase,
    deliveryStatus: order.deliveryState?.status,
  });
  return order.toObject();
}

export async function confirmPickupDelivery(orderId, deliveryPartnerId, billImageUrl) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  const from = order.orderStatus;
  const nextStatus = 'picked_up';
  if (!isStatusAdvance(from, nextStatus)) {
      throw new ValidationError(`Order is already at status '${from}'. Cannot re-mark as '${nextStatus}'.`);
  }
  order.orderStatus = nextStatus;
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'en_route_to_delivery',
    status: 'picked_up',
    pickedUpAt: new Date(),
    billImageUrl,
  };

  // OTP should be generated/sent only when rider explicitly requests it at drop.

  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'picked_up',
    note: 'Order picked up',
  });

  try {
    await ensureRiderEarningOnOrder(order);
  } catch (err) {
    logger.warn(`ensureRiderEarningOnOrder on pickup failed: ${err?.message || err}`);
  }

  await order.save();

  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('picked_up', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    billImageUrl: billImageUrl || null,
  });
  return order.toObject();
}

export async function confirmReachedDropDelivery(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  if (order.deliveryVerification?.dropOtp?.verified) {
    emitOrderUpdate(order, deliveryPartnerId);
    return sanitizeOrderForExternal(order);
  }

  const alreadyAtDrop =
    order.deliveryState?.currentPhase === 'at_drop' ||
    order.deliveryState?.status === 'reached_drop';
  const fromPhase =
    order.deliveryState?.status ||
    order.deliveryState?.currentPhase ||
    order.orderStatus ||
    '';

  const existingOtp = String(order.deliveryOtp || '').trim();

  // Idempotency: if already reached drop and OTP exists, avoid duplicate push notifications.
  if (alreadyAtDrop && existingOtp) {
    const hasDropOtpMeta = Boolean(order.deliveryVerification?.dropOtp);
    if (!hasDropOtpMeta) {
      order.deliveryVerification = {
        ...(order.deliveryVerification?.toObject?.() ||
          order.deliveryVerification ||
          {}),
        dropOtp: { required: true, verified: false },
      };
      await order.save();
    }
    // Rider explicitly requested OTP again at drop, re-emit same OTP without regenerating.
    emitDeliveryDropOtpToUser(order, existingOtp);
    return sanitizeOrderForExternal(order);
  }

  if (!existingOtp) {
    order.deliveryOtp = generateFourDigitDeliveryOtp();
  }

  if (!order.deliveryVerification?.dropOtp) {
    order.deliveryVerification = {
      ...(order.deliveryVerification?.toObject?.() ||
        order.deliveryVerification ||
        {}),
      dropOtp: { required: true, verified: false },
    };
  }

  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'at_drop',
    status: 'reached_drop',
    reachedDropAt: order.deliveryState?.reachedDropAt || new Date(),
  };

  if (!alreadyAtDrop) {
    pushStatusHistory(order, {
      byRole: 'DELIVERY_PARTNER',
      byId: deliveryPartnerId,
      from: fromPhase,
      to: 'reached_drop',
      note: 'Reached drop location',
    });
  }

  await order.save();

  emitDeliveryDropOtpToUser(order, String(order.deliveryOtp || '').trim());
  emitOrderUpdate(order, deliveryPartnerId);
  enqueueOrderEvent('reached_drop', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    dropOtpRequired: order.deliveryVerification?.dropOtp?.required ?? true,
    dropOtpVerified: order.deliveryVerification?.dropOtp?.verified ?? false,
  });
  return sanitizeOrderForExternal(order);
}

export async function verifyDropOtpDelivery(orderId, deliveryPartnerId, otp) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  const otpStr = normalizeOtpValue(otp);
  if (!otpStr) throw new ValidationError('OTP is required');

  if (!order.deliveryVerification?.dropOtp?.required) {
    const hasSecretOtp = Boolean(normalizeOtpValue(order.deliveryOtp));
    if (!hasSecretOtp) {
      throw new ValidationError(
        'OTP verification is not active for this order. Confirm reached drop first.',
      );
    }

    if (!order.deliveryVerification) order.deliveryVerification = {};
    order.deliveryVerification.dropOtp = {
      required: true,
      verified: false,
      ...(order.deliveryVerification?.dropOtp || {}),
    };
    order.markModified('deliveryVerification.dropOtp');
    await order.save();
  }
  if (order.deliveryVerification?.dropOtp?.verified) {
    return { order: sanitizeOrderForExternal(order) };
  }

  if (!isOtpMatch(order.deliveryOtp, otpStr)) {
    throw new ValidationError(
      'Invalid OTP. Ask the customer for the code shown in their app.',
    );
  }

  if (!order.deliveryVerification) order.deliveryVerification = { dropOtp: {} };
  order.deliveryVerification.dropOtp.verified = true;
  order.markModified('deliveryVerification.dropOtp.verified');
  await order.save();

  // OTP verification does not advance order status; suppress milestone push to avoid duplicates.
  emitOrderUpdate(order, deliveryPartnerId, { sendMilestonePush: false });
  enqueueOrderEvent('drop_otp_verified', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
  });
  return { order: sanitizeOrderForExternal(order) };
}

export async function completeDelivery(orderId, deliveryPartnerId, body = {}) {
  const identity = buildOrderIdentityFilter(orderId);
  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  const { otp, ratings, paymentMethod: selectedPaymentMethod } = body;

  // 1. Handover OTP Verification
  if (
    otp &&
    order.deliveryVerification?.dropOtp?.required &&
    !order.deliveryVerification?.dropOtp?.verified
  ) {
    const orderWithSecret = await FoodOrder.findById(order._id).select('+deliveryOtp');
    if (isOtpMatch(orderWithSecret?.deliveryOtp, otp)) {
      order.deliveryVerification.dropOtp.verified = true;
      order.markModified('deliveryVerification.dropOtp.verified');
    } else {
      throw new ValidationError('Invalid handover OTP provided.');
    }
  }

  if (
    order.deliveryVerification?.dropOtp?.required &&
    !order.deliveryVerification?.dropOtp?.verified &&
    !otp
  ) {
    throw new ValidationError(
      'Customer handover OTP is required. Verify the OTP from the customer before completing delivery.',
    );
  }

  const from = order.orderStatus;
  const nextStatus = 'delivered';
  if (!isStatusAdvance(from, nextStatus)) {
      throw new ValidationError(`Order is already at status '${from}'. Cannot re-mark as '${nextStatus}'.`);
  }
  
  // 2. Financial Context Resolution
  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const prevPayStatus = String(tx?.payment?.status || order?.payment?.status || 'cod_pending');
  const payMethod = String(tx?.payment?.method || order?.payment?.method || order?.paymentMethod || 'cash');

  /**
   * Final Payment Method Logic:
   * - If rider chose 'qr', we force 'razorpay_qr'.
   * - If rider chose 'cash', we force 'cash'. 
   * - Otherwise, we keep the original method.
   */
  let finalPayMethod = payMethod;
  if (selectedPaymentMethod === 'qr') finalPayMethod = 'razorpay_qr';
  else if (selectedPaymentMethod === 'cash') finalPayMethod = 'cash';

  // 3. QR Payment Verification (Blocking)
  if (finalPayMethod === 'razorpay_qr') {
    const syncedPayment = await syncRazorpayQrPayment(order);
    if (String(syncedPayment?.status || '').toLowerCase() !== 'paid') {
      throw new ValidationError('Please wait for the customer to complete the QR payment. Payment not verified yet.');
    }
  }

  // 4. Backfill rider earning if missing (geocode coords + commission rules)
  try {
    await ensureRiderEarningOnOrder(order);
  } catch (err) {
    logger.warn(
      `ensureRiderEarningOnOrder failed for ${order._id}: ${err?.message || err}`,
    );
  }

  // Update memory object before saving order so that DB is correctly updated
  if (!order.payment) order.payment = {};
  order.payment.status = 'paid';
  order.payment.method = finalPayMethod;

  // 5. Update Order State
  order.orderStatus = 'delivered';
  order.deliveryState = {
    ...(order.deliveryState?.toObject?.() || order.deliveryState || {}),
    currentPhase: 'delivered',
    status: 'delivered',
    deliveredAt: new Date(),
  };

  if (ratings) {
    order.ratings = {
      ...(order.ratings?.toObject?.() || order.ratings || {}),
      ...ratings,
    };
  }

  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: 'delivered',
    note: `Delivery completed using ${finalPayMethod}.`,
  });

  await order.save();

  // Reset COD Cancellation Count on any successful delivery
  if (order.userId) {
    try {
      const user = await FoodUser.findById(order.userId);
      if (user) {
        user.codCancellationCount = 0;
        await user.save();
      }
    } catch (err) {
      logger.error('Failed to reset COD cancellation count:', err.message);
    }
  }

  // Create inbox notifications for user and restaurant
  try {
    const orderId = order.orderId || order._id.toString();
    const notifs = [];
    if (order.userId) {
      notifs.push({
        ownerType: 'USER',
        ownerId: order.userId,
        title: `Order #${orderId} Delivered!`,
        message: 'Your order has been delivered. Enjoy your meal!',
        category: 'order',
        source: 'ORDER_UPDATE',
      });
    }
    if (order.restaurantId) {
      notifs.push({
        ownerType: 'RESTAURANT',
        ownerId: order.restaurantId,
        title: `Order #${orderId} Delivered`,
        message: 'The order has been successfully delivered to the customer.',
        category: 'order',
        source: 'ORDER_UPDATE',
      });
    }
    if (notifs.length) await createInboxNotifications({ notifications: notifs });
  } catch (notifErr) {
    logger.warn('Failed to create delivered notifications:', notifErr?.message);
  }

  // 6. Update Financial Ledger (FoodTransaction)
  // This triggers the sync back to FoodOrder.payment.method which updates the Rider's Cash Limit (if cash) or Pocket (always).
  const ledgerKind =
    finalPayMethod === 'cash' 
      ? 'cod_marked_paid_on_delivery' 
      : (finalPayMethod === 'razorpay_qr' ? 'cod_collect_qr_settled' : 'payment_snapshot_sync');

  try {
    await foodTransactionService.updateTransactionStatus(order._id, ledgerKind, {
      status: 'captured', // This marks payment as 'paid'
      paymentMethod: finalPayMethod,
      recordedByRole: 'DELIVERY_PARTNER',
      recordedById: deliveryPartnerId,
      note: `Rider finalized payment as ${finalPayMethod}. Order is now delivered.`,
    });
  } catch (txErr) {
    import('fs').then(fs => fs.appendFileSync('c:\\Users\\princeb\\.gemini\\antigravity-ide\\brain\\6e556dc8-03b6-43c7-8fad-7c0a061a566e\\scratch\\txErr.log', txErr.stack + '\\n'));
    logger.error(`Failed to update transaction status for order ${order._id}:`, txErr);
  }

  emitOrderUpdate(order, deliveryPartnerId);
  
  enqueueOrderEvent('delivery_completed', {
    orderMongoId: order._id?.toString?.(),
    orderId: order.orderId || order._id.toString(),
    deliveryPartnerId,
    payMethod: finalPayMethod,
    prevPayStatus,
    paymentStatus: 'paid'
  });

  return sanitizeOrderForExternal(order);
}


export async function updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select('+deliveryOtp');
  if (!order) throw new NotFoundError('Order not found');
  if (order.dispatch.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()) {
    throw new ForbiddenError('Not your order');
  }

  const from = order.orderStatus;
  if (!isStatusAdvance(from, orderStatus)) {
      throw new ValidationError(`Current order status '${from}' is further ahead than '${orderStatus}'. Order cannot be moved backwards.`);
  }
  order.orderStatus = orderStatus;
  pushStatusHistory(order, {
    byRole: 'DELIVERY_PARTNER',
    byId: deliveryPartnerId,
    from,
    to: orderStatus,
  });
  await order.save();

  enqueueOrderEvent('delivery_status_updated', {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    deliveryPartnerId,
    from,
    to: orderStatus,
  });
  return order.toObject();
}
