import mongoose from 'mongoose';
import { logger } from '../../../../utils/logger.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import {
  sendNotificationToOwner,
  sendNotificationToOwners,
} from "../../../../core/notifications/firebase.service.js";
import { getIO, rooms } from '../../../../config/socket.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';

export function enqueueOrderEvent(action, payload = {}) {
  try {
    void addOrderJob({ action, ...payload }).catch((err) => {
      logger.warn(`BullMQ enqueue order event failed: ${action} - ${err?.message || err}`);
    });
  } catch (err) {
    logger.warn(`BullMQ enqueue order event failed (sync): ${action} - ${err?.message || err}`);
  }
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const MAX_DELIVERY_DISTANCE_KM = 50;

export function assertRestaurantDeliversToZone(
  restaurant,
  { zoneId, orderType, deliveryAddress } = {},
) {
  const type = String(orderType || "delivery").toLowerCase();
  if (type !== "delivery") return;

  const restaurantZoneId = restaurant?.zoneId ? String(restaurant.zoneId) : "";
  const deliveryZoneId = zoneId ? String(zoneId) : "";

  // Same-zone only: never allow Indore user → Punjab restaurant (or missing zone).
  if (restaurantZoneId) {
    if (!deliveryZoneId) {
      throw new ValidationError("Delivery location is outside this restaurant's service zone");
    }
    if (restaurantZoneId !== deliveryZoneId) {
      throw new ValidationError("This restaurant does not deliver to your selected location");
    }
  }

  if (
    restaurant?.location?.coordinates?.length === 2 &&
    deliveryAddress?.location?.coordinates?.length === 2
  ) {
    const [rLng, rLat] = restaurant.location.coordinates;
    const [dLng, dLat] = deliveryAddress.location.coordinates;
    const distanceKm = haversineKm(rLat, rLng, dLat, dLng);
    if (Number.isFinite(distanceKm) && distanceKm > MAX_DELIVERY_DISTANCE_KM) {
      throw new ValidationError("Delivery address is too far from this restaurant");
    }
  }
}

export function generateFourDigitDeliveryOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function sanitizeOrderForExternal(orderDoc) {
  const o = orderDoc?.toObject ? orderDoc.toObject() : { ...(orderDoc || {}) };
  delete o.deliveryOtp;
  const dv = o.deliveryVerification;
  if (dv && dv.dropOtp != null) {
    const d = dv.dropOtp;
    o.deliveryVerification = {
      ...dv,
      dropOtp: {
        required: Boolean(d.required),
        verified: Boolean(d.verified),
      },
    };
  }
  o.orderMongoId = (o._id || orderDoc?._id || "").toString();
  // Ensure orderId field for UI always contains the pretty ID
  o.orderId = o.order_id || o.orderMongoId; 
  return o;
}

function deriveBaseFromAppliedPricingRule(price, item = {}) {
  const type = String(item?.appliedPricingType || '').toUpperCase();
  const value = Number(item?.appliedPricingValue);
  const selling = Number(price) || 0;
  if (!Number.isFinite(value) || value <= 0 || selling <= 0) return null;
  if (type === 'PERCENTAGE') {
    return Math.max(0, Math.round((selling / (1 + value / 100)) * 100) / 100);
  }
  if (type === 'FIXED') {
    return Math.max(0, Math.round((selling - value) * 100) / 100);
  }
  return null;
}

/** Unit price the restaurant owns (before admin markup). */
export function resolveRestaurantItemUnitPrice(item = {}) {
  const price = Number(item?.price) || 0;
  const markup = Number(item?.markupAmount) || 0;
  const other = Number(item?.otherPrice) || 0;
  const base = Number(item?.basePrice);
  const hasAdminScope =
    item?.pricingScope && String(item.pricingScope).toUpperCase() !== 'LEGACY';

  if (Number.isFinite(base) && base >= 0) {
    if (markup > 0 || (hasAdminScope && other > base + 0.01) || base < price - 0.01) {
      return base;
    }
    if (Math.abs(base - price) < 0.01) {
      const derived = deriveBaseFromAppliedPricingRule(price, item);
      if (derived != null && derived < price - 0.01) return derived;
    }
    return base;
  }

  if (markup > 0) return Math.max(0, Math.round((price - markup) * 100) / 100);

  const derived = deriveBaseFromAppliedPricingRule(price, item);
  if (derived != null) return derived;

  return price;
}

/**
 * Restaurant-facing order view: show restaurant base as price, but keep
 * admin markup metadata so the accept popup can show "149 + 51 = 200".
 */
export function toRestaurantFacingOrder(orderDoc) {
  const order = sanitizeOrderForExternal(orderDoc);
  const pricing = order.pricing || {};
  const items = Array.isArray(order.items)
    ? order.items.map((item) => {
        const customerUnit = Number(item?.price) || 0;
        const restaurantUnit = resolveRestaurantItemUnitPrice(item);
        const qty = Number(item?.quantity) || 1;
        let markupUnit = Number(item?.markupAmount);
        if (!Number.isFinite(markupUnit) || markupUnit < 0) {
          markupUnit = Math.max(0, Math.round((customerUnit - restaurantUnit) * 100) / 100);
        }
        return {
          ...item,
          customerPrice: customerUnit,
          price: restaurantUnit,
          variantPrice: restaurantUnit,
          basePrice: restaurantUnit,
          markupAmount: markupUnit,
          otherPrice: Number(item?.otherPrice) || customerUnit,
          appliedPricingType: item?.appliedPricingType || null,
          appliedPricingValue: item?.appliedPricingValue ?? null,
          pricingScope: item?.pricingScope || item?.pricingRule?.scope || null,
          pricingRule: item?.pricingRule || null,
          lineMarkupTotal: Math.round(markupUnit * qty * 100) / 100,
        };
      })
    : [];

  const computedBaseSubtotal = items.reduce((sum, item) => {
    const unit = Number(item.price) || 0;
    const qty = Number(item.quantity) || 1;
    return sum + unit * qty;
  }, 0);

  const computedMarkupTotal = items.reduce((sum, item) => {
    return sum + (Number(item.lineMarkupTotal) || 0);
  }, 0);

  const storedBase = Number(pricing.baseSubtotal);
  const storedMarkup = Number(pricing.markupTotal);
  const storedSubtotal = Number(pricing.subtotal);
  let restaurantSubtotal = computedBaseSubtotal;
  if (Number.isFinite(storedBase) && storedBase >= 0) {
    restaurantSubtotal = storedBase;
  } else if (
    Number.isFinite(storedSubtotal) &&
    Number.isFinite(storedMarkup) &&
    storedMarkup > 0
  ) {
    restaurantSubtotal = Math.max(0, storedSubtotal - storedMarkup);
  }

  const markupTotal =
    Number.isFinite(storedMarkup) && storedMarkup >= 0
      ? storedMarkup
      : computedMarkupTotal;

  const packagingFee = Number(pricing.packagingFee) || 0;
  const restaurantTotal = Math.max(
    0,
    Math.round((restaurantSubtotal + packagingFee) * 100) / 100,
  );

  return {
    ...order,
    items,
    pricing: {
      ...pricing,
      customerSubtotal: Number.isFinite(storedSubtotal) ? storedSubtotal : undefined,
      customerTotal: Number(pricing.total) || undefined,
      markupTotal: Math.round(markupTotal * 100) / 100,
      subtotal: Math.round(restaurantSubtotal * 100) / 100,
      baseSubtotal: Math.round(restaurantSubtotal * 100) / 100,
      // Restaurant bill excludes delivery / platform fee from their earning total.
      deliveryFee: 0,
      platformFee: 0,
      total: restaurantTotal,
    },
    total: restaurantTotal,
    amount: restaurantTotal,
  };
}

export function emitDeliveryDropOtpToUser(order, plainOtp) {
  try {
    const io = getIO();
    if (!io || !plainOtp || !order?.userId) return;

    const isTakeaway = order?.orderType === "takeaway";
    const message = isTakeaway
      ? "Share this OTP with the restaurant to pick up your order."
      : "Share this OTP with your delivery partner to hand over the order.";

    io.to(rooms.user(order.userId)).emit("delivery_drop_otp", {
      orderMongoId: order._id?.toString?.(),
      orderId: order.order_id || order._id?.toString?.(),
      otp: plainOtp,
      orderType: order?.orderType || "delivery",
      message,
    });
  } catch (e) {
    logger.warn(`emitDeliveryDropOtpToUser failed: ${e?.message || e}`);
  }
}

export async function notifyOwnersSafely(targets, payload) {
  try {
    await sendNotificationToOwners(targets, payload);
  } catch (error) {
    logger.warn(`FCM notification failed: ${error?.message || error}`);
  }
}

export async function notifyOwnerSafely(target, payload) {
  try {
    await sendNotificationToOwner({ ...target, payload });
  } catch (error) {
    logger.warn(`FCM notification failed: ${error?.message || error}`);
  }
}

/** Path segments that must never be treated as an order id (legacy Flutter polls). */
export const RESERVED_DELIVERY_ORDER_PATHS = new Set([
  "assigned",
  "active",
  "pending",
  "current",
  "available",
]);

export function buildOrderIdentityFilter(orderIdOrMongoId) {
  const raw = String(orderIdOrMongoId || "").trim();
  if (!raw) return null;
  // Prevent GET /orders/assigned|active|pending from becoming orderId lookups → 404 spam
  if (RESERVED_DELIVERY_ORDER_PATHS.has(raw.toLowerCase())) return null;
  if (mongoose.isValidObjectId(raw))
    return { _id: new mongoose.Types.ObjectId(raw) };

  // Search BOTH underscore and camelCase variants for robust lookup
  return {
    $or: [
      { order_id: raw },
      { orderId: raw },
    ],
  };
}

export function toGeoPoint(lat, lng) {
  if (lat == null || lng == null) return undefined;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return { type: "Point", coordinates: [b, a] };
}

export function pushStatusHistory(order, { byRole, byId, from, to, note = "" }) {
  order.statusHistory.push({
    at: new Date(),
    byRole,
    byId: byId || undefined,
    from,
    to,
    note,
  });
}

export function normalizeOrderForClient(orderDoc) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const mongoId = (order._id || orderDoc?._id || "").toString();
  const displayId = order.order_id || mongoId;
  const statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const lastHistory = statusHistory.length > 0 ? statusHistory[statusHistory.length - 1] : null;

  return {
    ...order,
    orderMongoId: mongoId,
    orderId: displayId,
    status: order?.orderStatus || order?.status || "",
    deliveredAt:
      order?.deliveryState?.deliveredAt || order?.deliveredAt || null,
    deliveryPartnerId:
      order?.dispatch?.deliveryPartnerId || order?.deliveryPartnerId || null,
    rating: order?.ratings?.restaurant?.rating ?? order?.rating ?? null,
    restaurantNote: order?.restaurantNote || "",
    cancellationReason: (order?.orderStatus?.includes('cancel') || order?.status?.includes('cancel')) 
      ? (statusHistory.findLast(h => h.to?.includes('cancel'))?.note || "")
      : null,
    adminStatusNote: (lastHistory && lastHistory.byRole === 'ADMIN' && lastHistory.note?.includes('Admin override'))
      ? `${lastHistory.note} from ${lastHistory.from} to ${lastHistory.to}`
      : null,
    deliveryState: {
      ...(order?.deliveryState || {}),
      currentLocation: order?.lastRiderLocation?.coordinates?.length >= 2 ? {
        lat: order.lastRiderLocation.coordinates[1],
        lng: order.lastRiderLocation.coordinates[0]
      } : (order?.deliveryState?.currentLocation || null)
    }
  };
}

export async function applyAggregateRating(model, entityId, newRating) {
  if (!entityId) return;
  const doc = await model.findById(entityId).select("rating totalRatings");
  if (!doc) return;

  const totalRatings = Number(doc.totalRatings || 0);
  const currentAverage = Number(doc.rating || 0);
  const nextTotal = totalRatings + 1;
  const nextAverage = Number(
    ((currentAverage * totalRatings + Number(newRating)) / nextTotal).toFixed(1),
  );

  doc.totalRatings = nextTotal;
  doc.rating = nextAverage;
  await doc.save();
}

export function buildDeliverySocketPayload(orderDoc, restaurantDoc = null) {
  const order = orderDoc?.toObject ? orderDoc.toObject() : orderDoc || {};
  const restaurant = restaurantDoc || order?.restaurantId || null;
  const restaurantLocation = restaurant?.location || {};
  const deliveryAddress = order?.deliveryAddress || {};
  const customerAddressParts = [
    deliveryAddress.street,
    deliveryAddress.additionalDetails,
    deliveryAddress.city,
    deliveryAddress.state,
    deliveryAddress.zipCode,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  return {
    orderMongoId:
      orderDoc?._id?.toString?.() || order?._id?.toString?.() || order?._id,
    orderId: order?.order_id || order?._id?.toString?.(),
    status: orderDoc?.orderStatus || order?.orderStatus,
    items: order?.items || [],
    pricing: order?.pricing,
    total: order?.pricing?.total,
    payment: order?.payment,
    paymentMethod: order?.payment?.method,
    restaurantId:
      order?.restaurantId?._id?.toString?.() ||
      order?.restaurantId?.toString?.() ||
      order?.restaurantId,
    restaurantName: restaurant?.restaurantName || order?.restaurantName,
    restaurantAddress:
      [
        restaurant?.addressLine1,
        restaurant?.addressLine2,
        restaurant?.area,
        restaurant?.city,
        restaurant?.state,
        restaurant?.pincode,
      ]
        .filter(Boolean)
        .join(', ') ||
      restaurantLocation?.address ||
      restaurantLocation?.formattedAddress ||
      "",
    restaurantPhone:
      restaurant?.primaryContactNumber ||
      restaurant?.ownerPhone ||
      restaurant?.phone ||
      "",
    restaurantLocation: {
      latitude: restaurantLocation?.latitude,
      longitude: restaurantLocation?.longitude,
      address:
        [
          restaurant?.addressLine1,
          restaurant?.addressLine2,
          restaurant?.area,
          restaurant?.city,
          restaurant?.state,
          restaurant?.pincode,
        ]
          .filter(Boolean)
          .join(', ') ||
        restaurantLocation?.address ||
        restaurantLocation?.formattedAddress ||
        "",
      area: restaurantLocation?.area || restaurant?.area || "",
      city: restaurantLocation?.city || restaurant?.city || "",
      state: restaurantLocation?.state || restaurant?.state || "",
    },
    deliveryAddress: order?.deliveryAddress,
    customerAddress: customerAddressParts.length ? customerAddressParts.join(', ') : "",
    customerName: order?.customerName || order?.deliveryAddress?.fullName || order?.deliveryAddress?.name || order?.userId?.name || "",
    customerPhone: order?.customerPhone || order?.deliveryAddress?.phone || order?.userId?.phone || "",
    userName: order?.customerName || order?.deliveryAddress?.fullName || order?.deliveryAddress?.name || order?.userId?.name || "",
    userPhone: order?.customerPhone || order?.deliveryAddress?.phone || order?.userId?.phone || "",
    note: order?.note || "",
    riderEarning: order?.riderEarning || 0,
    // Never fall back to customer deliveryFee — that is not rider payout
    earnings: Number(order?.riderEarning || 0) || 0,
    deliveryFee: order?.pricing?.deliveryFee || 0,
    deliveryFleet: order?.deliveryFleet,
    dispatch: order?.dispatch,
    createdAt: order?.createdAt,
    updatedAt: order?.updatedAt,
  };
}

export function canExposeOrderToRestaurant(orderLike) {
  const method = String(orderLike?.payment?.method || "").toLowerCase();
  const status = String(orderLike?.payment?.status || "").toLowerCase();
  if (["cash", "wallet"].includes(method)) return true;
  return ["paid", "authorized", "captured", "settled"].includes(status);
}

export async function notifyRestaurantNewOrder(orderDoc) {
  try {
    if (!orderDoc || !canExposeOrderToRestaurant(orderDoc)) return;

    const io = getIO();
    if (io) {
      const payload = toRestaurantFacingOrder(orderDoc);
      logger.info(
        `[RestaurantOrders] Emitting new_order to ${rooms.restaurant(orderDoc.restaurantId)} for order ${orderDoc._id?.toString?.() || ''}`,
      );
      io.to(rooms.restaurant(orderDoc.restaurantId)).emit("new_order", payload);
    }

    await notifyOwnersSafely(
      [{ ownerType: "RESTAURANT", ownerId: orderDoc.restaurantId }],
      {
        title: "🔔 New order received",
        body: `Order #${orderDoc.order_id || orderDoc._id} is waiting for review.`,
        sound: "default",
        channelId: "restaurant_orders",
        sendToAllDevices: true,
        data: {
          type: "new_order",
          orderId: orderDoc._id.toString(),
          orderMongoId: orderDoc._id?.toString?.() || "",
          link: `/restaurant/orders/${orderDoc._id?.toString?.() || ""}`,
        },
      },
    );
  } catch {
    // Do not block order/payment flow if notification fails.
  }
}

export const STATUS_PRIORITY = {
  created: 10,
  confirmed: 20,
  preparing: 30,
  ready_for_pickup: 40,
  reached_pickup: 50,
  picked_up: 60,
  reached_drop: 70,
  delivered: 80,
  cancelled_by_user: 100,
  cancelled_by_restaurant: 100,
  cancelled_by_admin: 100,
};

/**
 * Returns true if the next status is a valid forward progression from the current status.
 * Prevents "reversing" order status (e.g. from Preparing back to Created).
 */
export function isStatusAdvance(current, next) {
  // If current status is missing, it's effectively 'created' or start of flow
  if (!current) return true;
  
  const currentPrio = STATUS_PRIORITY[current] || 0;
  const nextPrio = STATUS_PRIORITY[next] || 0;

  // Terminal states (100) cannot transition to anything else
  if (currentPrio >= 100) return false;
  
  // Delivered (80) cannot transition to anything (except maybe cancellation if allowed, but here we say no)
  if (currentPrio === 80) return false;

  // Special case: Cancellation is almost always an advance unless already delivered
  if (nextPrio === 100 && currentPrio < 80) return true;

  return nextPrio > currentPrio;
}

export function normalizeOtpValue(value) {
  return String(value ?? '').replace(/\D/g, '').trim();
}

export function isOtpMatch(expectedOtp, enteredOtp) {
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
