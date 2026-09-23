import mongoose from 'mongoose';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodDeliveryPartner } from '../models/deliveryPartner.model.js';
import { buildOrderIdentityFilter } from '../../orders/services/order.helpers.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { getFirebaseDB } from '../../../../config/firebase.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Single source of truth for publishing a delivery partner's live GPS position
 * to the customer tracking map.
 *
 * Both transports feed it: the rider's socket (`update-location`) and the HTTP
 * availability heartbeat. The HTTP path matters because a backgrounded or
 * briefly disconnected app loses its socket, and previously the customer's bike
 * froze whenever that happened. Every order the partner is actually assigned to
 * is published — resolved server-side — so the rider app never needs to know
 * (or be trusted with) which order ids to broadcast to.
 */

/** Orders in these states have a rider on the road. */
export const RIDER_TRACKABLE_ORDER_STATUSES = [
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'reached_pickup',
    'picked_up',
    'reached_drop',
];

/*
 * Statuses in which the rider's position is broadcast to the order's watchers.
 *
 * Only once the food is collected. Before pickup the rider may be anywhere -
 * finishing another delivery, still on the way to the restaurant - and showing
 * that to the customer said nothing about when their food arrives. The rider's
 * own `lastLocation` is still persisted at every fix (dispatch needs it), and
 * tracking pages may still join the room; they simply receive no positions
 * until pickup.
 */
export const CUSTOMER_LIVE_TRACKING_STATUSES = new Set(['picked_up', 'reached_drop']);

export const isLiveTrackableOrderStatus = (status) =>
    CUSTOMER_LIVE_TRACKING_STATUSES.has(String(status || '').toLowerCase());

const TERMINAL_ORDER_STATUSES = new Set([
    'delivered',
    'cancelled_by_user',
    'cancelled_by_restaurant',
    'cancelled_by_admin',
]);

const BROADCAST_MIN_INTERVAL_MS = Number(process.env.RIDER_BROADCAST_MIN_INTERVAL_MS) || 1500;
const ORDER_PERSIST_INTERVAL_MS = Number(process.env.RIDER_ORDER_PERSIST_INTERVAL_MS) || 15000;
const PARTNER_PERSIST_INTERVAL_MS = Number(process.env.RIDER_PARTNER_PERSIST_INTERVAL_MS) || 10000;
const ACTIVE_ORDERS_CACHE_MS = Number(process.env.RIDER_ACTIVE_ORDERS_CACHE_MS) || 10000;
const MAX_ACCEPTABLE_ACCURACY_M = Number(process.env.RIDER_MAX_ACCEPTABLE_ACCURACY_M) || 75;
/** A position older than this is not shown as "live" to a newly opened tracking page. */
export const LAST_KNOWN_LOCATION_MAX_AGE_MS = Number(process.env.RIDER_LAST_KNOWN_LOCATION_MAX_AGE_MS) || 10 * 60 * 1000;

const lastBroadcastAt = new Map(); // partnerId -> ms
const lastOrderPersistAt = new Map(); // orderMongoId -> ms
const lastPartnerPersistAt = new Map(); // partnerId -> ms
const activeOrdersCache = new Map(); // partnerId -> { at, orders }

const toFinite = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

export const isValidCoordinate = (lat, lng) =>
    Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0);

export const isTerminalOrderStatus = (status) => TERMINAL_ORDER_STATUSES.has(String(status || '').toLowerCase());

const trackingIdsForOrder = (order) =>
    [...new Set([order?._id ? String(order._id) : '', order?.order_id ? String(order.order_id) : ''].filter(Boolean))];

/** Drops cached assignments, e.g. when an order is accepted, delivered or cancelled. */
export const invalidateRiderActiveOrders = (deliveryPartnerId) => {
    if (deliveryPartnerId) activeOrdersCache.delete(String(deliveryPartnerId));
};

const getActiveOrdersForPartner = async (deliveryPartnerId) => {
    const key = String(deliveryPartnerId);
    const cached = activeOrdersCache.get(key);
    if (cached && Date.now() - cached.at < ACTIVE_ORDERS_CACHE_MS) return cached.orders;

    if (!mongoose.Types.ObjectId.isValid(key)) return [];
    const orders = await FoodOrder.find({
        'dispatch.deliveryPartnerId': new mongoose.Types.ObjectId(key),
        'dispatch.status': { $in: ['assigned', 'accepted'] },
        orderStatus: { $in: RIDER_TRACKABLE_ORDER_STATUSES },
    })
        .select('_id order_id userId restaurantId orderStatus')
        .lean();

    activeOrdersCache.set(key, { at: Date.now(), orders });
    return orders;
};

/**
 * Publishes one GPS fix. Returns the number of orders it was published to.
 * `requestedOrderId` (optional) is only used to reject a fix for an order the
 * partner is not assigned to; publication always covers every assigned order.
 */
export const publishRiderLocation = async ({
    deliveryPartnerId,
    lat: rawLat,
    lng: rawLng,
    heading: rawHeading,
    speed: rawSpeed,
    accuracy: rawAccuracy,
    requestedOrderId = null,
    source = 'socket',
    excludeSocket = null,
} = {}) => {
    const partnerId = String(deliveryPartnerId || '');
    const lat = toFinite(rawLat);
    const lng = toFinite(rawLng);
    if (!partnerId || !isValidCoordinate(lat, lng)) return 0;

    const now = Date.now();
    const heading = toFinite(rawHeading) ?? 0;
    const speed = toFinite(rawSpeed) ?? 0;
    const accuracy = toFinite(rawAccuracy);

    // Reject updates with poor accuracy to prevent customer map flickering or wild jumps
    if (accuracy !== null && accuracy > MAX_ACCEPTABLE_ACCURACY_M) {
        logger.debug(`[RiderLocation] ${partnerId} fix ignored due to poor accuracy (${accuracy}m > ${MAX_ACCEPTABLE_ACCURACY_M}m)`);
        return 0;
    }

    // Keep the partner's own last known location fresh (also used by dispatch).
    if (now - (lastPartnerPersistAt.get(partnerId) || 0) >= PARTNER_PERSIST_INTERVAL_MS) {
        lastPartnerPersistAt.set(partnerId, now);
        FoodDeliveryPartner.updateOne(
            { _id: partnerId },
            {
                $set: {
                    lastLocation: { type: 'Point', coordinates: [lng, lat] },
                    lastLat: lat,
                    lastLng: lng,
                    lastLocationAt: new Date(now),
                },
            }
        ).catch((err) => logger.warn(`[RiderLocation] partner persist failed: ${err.message}`));
    }

    const orders = await getActiveOrdersForPartner(partnerId);
    if (!orders.length) return 0;

    if (requestedOrderId) {
        const requested = String(requestedOrderId);
        const assigned = orders.some((o) => trackingIdsForOrder(o).includes(requested));
        if (!assigned) {
            // Possibly a just-accepted order not yet in the cache — refresh once.
            invalidateRiderActiveOrders(partnerId);
            const fresh = await getActiveOrdersForPartner(partnerId);
            if (!fresh.some((o) => trackingIdsForOrder(o).includes(requested))) {
                logger.warn(`[RiderLocation] ${partnerId} sent a location for unassigned order ${requested}; ignored`);
                return 0;
            }
            return publishRiderLocation({
                deliveryPartnerId, lat, lng, heading, speed, accuracy, requestedOrderId: null, source, excludeSocket,
            });
        }
    }

    // Socket and HTTP can both deliver the same fix; one broadcast is enough.
    if (now - (lastBroadcastAt.get(partnerId) || 0) < BROADCAST_MIN_INTERVAL_MS) return 0;
    lastBroadcastAt.set(partnerId, now);

    const io = getIO();
    let db = null;
    try {
        db = getFirebaseDB();
    } catch {
        db = null;
    }

    for (const order of orders) {
        // Not carrying this order yet: nothing is published for it.
        if (!isLiveTrackableOrderStatus(order.orderStatus)) continue;

        const orderMongoId = String(order._id);
        const payload = {
            orderId: order.order_id ? String(order.order_id) : orderMongoId,
            orderMongoId,
            deliveryPartnerId: partnerId,
            lat,
            lng,
            boy_lat: lat,
            boy_lng: lng,
            riderLocation: [lat, lng],
            heading,
            speed,
            accuracy,
            orderStatus: order.orderStatus,
            source,
            timestamp: now,
        };

        if (io) {
            let target = io;
            for (const id of trackingIdsForOrder(order)) target = target.to(rooms.tracking(id));
            if (order.userId) target = target.to(rooms.user(order.userId));
            if (order.restaurantId) target = target.to(rooms.restaurant(order.restaurantId));
            if (excludeSocket) target = target.except(excludeSocket.id);
            target.emit('location-update', payload);
        }

        if (db) {
            const node = {
                lat, lng, boy_lat: lat, boy_lng: lng, heading, speed, accuracy,
                deliveryPartnerId: partnerId,
                orderStatus: order.orderStatus,
                timestamp: now,
                last_updated: now,
                status: order.orderStatus,
            };
            for (const id of trackingIdsForOrder(order)) {
                db.ref(`active_orders/${id.replace(/[.#$/[\]]/g, '_')}`)
                    .update(node)
                    .catch((err) => logger.warn(`[RiderLocation] RTDB order write failed: ${err.message}`));
            }
        }

        if (now - (lastOrderPersistAt.get(orderMongoId) || 0) >= ORDER_PERSIST_INTERVAL_MS) {
            lastOrderPersistAt.set(orderMongoId, now);
            FoodOrder.updateOne(
                { _id: order._id },
                { $set: { lastRiderLocation: { type: 'Point', coordinates: [lng, lat] }, lastRiderLocationAt: new Date(now) } }
            ).catch((err) => logger.warn(`[RiderLocation] order persist failed: ${err.message}`));
        }
    }

    if (db) {
        db.ref(`delivery_boys/${partnerId}`)
            .update({ lat, lng, heading, speed, accuracy, timestamp: now, last_updated: now, status: 'online' })
            .catch((err) => logger.warn(`[RiderLocation] RTDB partner write failed: ${err.message}`));
    }

    return orders.length;
};

/**
 * Publishes the partner's stored position right away (e.g. the moment they
 * accept an order), so the customer sees where the rider really is instead of
 * an empty map until the next GPS fix. Only a recent real fix is used.
 */
export const publishLastKnownRiderLocation = async (deliveryPartnerId, { maxAgeMs = 2 * 60 * 1000 } = {}) => {
    const partnerId = String(deliveryPartnerId || '');
    if (!mongoose.Types.ObjectId.isValid(partnerId)) return 0;
    invalidateRiderActiveOrders(partnerId);

    const partner = await FoodDeliveryPartner.findById(partnerId).select('lastLat lastLng lastLocationAt').lean();
    const lat = toFinite(partner?.lastLat);
    const lng = toFinite(partner?.lastLng);
    const at = partner?.lastLocationAt ? new Date(partner.lastLocationAt).getTime() : 0;
    if (!isValidCoordinate(lat, lng) || !at || Date.now() - at > maxAgeMs) return 0;

    // A fix may have just been broadcast under the old (empty) assignment list.
    lastBroadcastAt.delete(partnerId);
    return publishRiderLocation({ deliveryPartnerId: partnerId, lat, lng, source: 'last_known' });
};

/**
 * Authorises a `join-tracking` request and returns the order when allowed.
 * Customers may only watch their own orders; restaurants their own; riders the
 * orders assigned to them. Previously any signed-in user could watch any rider.
 */
export const resolveTrackableOrderForViewer = async (orderRef, { userId, role } = {}) => {
    const filter = buildOrderIdentityFilter(orderRef);
    if (!filter || !userId) return null;

    const order = await FoodOrder.findOne(filter)
        .select('_id order_id userId restaurantId orderStatus dispatch.deliveryPartnerId dispatch.status lastRiderLocation')
        .lean();
    if (!order) return null;

    const viewer = String(userId);
    if (role === 'USER' && String(order.userId) !== viewer) return null;
    if (role === 'RESTAURANT' && String(order.restaurantId) !== viewer) return null;
    if (role === 'DELIVERY_PARTNER' && String(order.dispatch?.deliveryPartnerId || '') !== viewer) return null;
    if (!['USER', 'RESTAURANT', 'DELIVERY_PARTNER'].includes(role)) return null;
    return order;
};

/** Latest known rider position for an order, used to paint the bike immediately on page open. */
export const getLastKnownRiderLocation = async (order) => {
    const partnerId = order?.dispatch?.deliveryPartnerId;
    if (!partnerId || isTerminalOrderStatus(order?.orderStatus)) return null;
    // Same rule as the live broadcast: no rider position before pickup, or the
    // bike would reappear on the customer's map every time the page is opened.
    if (!isLiveTrackableOrderStatus(order?.orderStatus)) return null;

    const partner = await FoodDeliveryPartner.findById(partnerId).select('lastLat lastLng lastLocationAt').lean();
    const lat = toFinite(partner?.lastLat);
    const lng = toFinite(partner?.lastLng);
    const at = partner?.lastLocationAt ? new Date(partner.lastLocationAt).getTime() : 0;
    if (!isValidCoordinate(lat, lng) || !at || Date.now() - at > LAST_KNOWN_LOCATION_MAX_AGE_MS) return null;

    const orderMongoId = String(order._id);
    return {
        orderId: order.order_id ? String(order.order_id) : orderMongoId,
        orderMongoId,
        deliveryPartnerId: String(partnerId),
        lat,
        lng,
        boy_lat: lat,
        boy_lng: lng,
        riderLocation: [lat, lng],
        heading: 0,
        speed: 0,
        accuracy: null,
        orderStatus: order.orderStatus,
        source: 'last_known',
        timestamp: at,
    };
};

/**
 * Ends live tracking for an order: tells open tracking pages to stop, and clears
 * the realtime nodes so a reopened page does not show a stale bike.
 */
export const endRiderTracking = async (order, reason = 'completed') => {
    if (!order?._id) return;
    const ids = trackingIdsForOrder(order);
    invalidateRiderActiveOrders(order?.dispatch?.deliveryPartnerId);
    lastOrderPersistAt.delete(String(order._id));

    try {
        const io = getIO();
        if (io) {
            let target = io;
            for (const id of ids) target = target.to(rooms.tracking(id));
            if (order.userId) target = target.to(rooms.user(order.userId));
            target.emit('tracking-ended', {
                orderId: order.order_id ? String(order.order_id) : String(order._id),
                orderMongoId: String(order._id),
                orderStatus: order.orderStatus,
                reason,
                timestamp: Date.now(),
            });
        }
    } catch (err) {
        logger.warn(`[RiderLocation] tracking-ended emit failed: ${err.message}`);
    }

    try {
        const db = getFirebaseDB();
        await Promise.all(
            ids.map((id) => db.ref(`active_orders/${id.replace(/[.#$/[\]]/g, '_')}`).remove())
        );
    } catch {
        // Realtime DB not configured — nothing to clear.
    }
};
