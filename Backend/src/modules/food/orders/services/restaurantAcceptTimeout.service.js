import { FoodOrder } from '../models/order.model.js';
import { canExposeOrderToRestaurant } from './order.helpers.js';
import { updateOrderStatusRestaurant } from './order.service.js';
import { loadRestaurantSettingsByZone } from '../../admin/controllers/systemConfig.controller.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Server-side accept window for new restaurant orders.
 *
 * The restaurant app auto-rejects when its countdown hits zero, but only while
 * the app is open with the popup showing. A closed tab, a dead phone or a lost
 * connection left the order "created" forever and the customer waiting with no
 * answer. This sweep enforces the same admin-configured window regardless.
 *
 * It runs slightly behind the client (GRACE_MS) so an open restaurant app still
 * performs the auto-reject itself, and it goes through the normal restaurant
 * rejection path, so refunds, notifications and socket events behave exactly as
 * if the restaurant had rejected the order.
 */

export const AUTO_REJECT_REASON = 'No response from restaurant (Auto-rejected)';
const GRACE_MS = 20 * 1000;
export const ACCEPT_WINDOW_GRACE_MS = GRACE_MS;
const BATCH_LIMIT = 50;

/** When the restaurant was first shown the order; the window counts from here. */
export const getRestaurantAcceptWindowStart = (order) => {
    const at = order?.restaurantNotifiedAt || order?.createdAt;
    const ms = at ? new Date(at).getTime() : NaN;
    return Number.isFinite(ms) ? ms : null;
};

const toWindows = ({ deliveryAcceptOrderTimeMinutes, takeawayAcceptOrderTimeMinutes }) => ({
    takeaway: takeawayAcceptOrderTimeMinutes * 60 * 1000,
    other: deliveryAcceptOrderTimeMinutes * 60 * 1000,
});

/**
 * Zone of each candidate's restaurant. The restaurant app reads its countdown for
 * this same zone, so the server never rejects on a shorter window than it shows.
 */
async function loadRestaurantZoneIds(orders) {
    const restaurantIds = [...new Set(orders.map((order) => String(order.restaurantId)))];
    const restaurants = await FoodRestaurant.find({ _id: { $in: restaurantIds } })
        .select('zoneId')
        .lean();
    return new Map(restaurants.map((r) => [String(r._id), r.zoneId ? String(r.zoneId) : null]));
}

/**
 * Returns `(order) => accept window in ms` for these orders, each read for the
 * zone of its restaurant. Shared with the restaurant alarm, so a phone never
 * rings for longer than the window enforced here.
 */
export async function buildAcceptWindowResolver(settings, orders = []) {
    // Without any zone override every order uses the default, so skip the lookup.
    const restaurantZoneIds = settings.hasZoneOverrides && orders.length
        ? await loadRestaurantZoneIds(orders)
        : new Map();
    return (order) => {
        const zoneId = restaurantZoneIds.has(String(order.restaurantId))
            ? restaurantZoneIds.get(String(order.restaurantId))
            : order.zoneId;
        const windows = toWindows(settings.forZone(zoneId));
        return order.orderType === 'takeaway' ? windows.takeaway : windows.other;
    };
}

export async function expireUnacceptedRestaurantOrders({ now = Date.now() } = {}) {
    const settings = await loadRestaurantSettingsByZone();
    // The shortest window of any zone bounds the query; each order is then checked
    // against the window of its own restaurant's zone.
    const shortestWindowMs = Math.min(
        ...settings.all.flatMap((zoneSettings) => Object.values(toWindows(zoneSettings)))
    );
    const oldestCutoff = new Date(now - shortestWindowMs - GRACE_MS);

    const candidates = await FoodOrder.find({
        orderStatus: 'created',
        $or: [
            { restaurantNotifiedAt: { $lte: oldestCutoff } },
            { restaurantNotifiedAt: null, createdAt: { $lte: oldestCutoff } },
        ],
        // A scheduled order is not due for a decision until its time comes.
        $and: [{ $or: [{ scheduledAt: null }, { scheduledAt: { $lte: new Date(now) } }] }],
    })
        .select('_id order_id restaurantId zoneId orderType createdAt restaurantNotifiedAt payment scheduledAt')
        .sort({ createdAt: 1 })
        .limit(BATCH_LIMIT)
        .lean();

    const windowFor = await buildAcceptWindowResolver(settings, candidates);

    let rejected = 0;
    for (const order of candidates) {
        // Never auto-reject an order the restaurant could not see (unpaid online order).
        if (!canExposeOrderToRestaurant(order)) continue;

        const windowMs = windowFor(order);
        const startedAt = getRestaurantAcceptWindowStart(order);
        if (startedAt == null || now - startedAt < windowMs + GRACE_MS) continue;

        try {
            // The status guard inside makes this a no-op if the restaurant accepted meanwhile.
            await updateOrderStatusRestaurant(
                String(order._id),
                String(order.restaurantId),
                'cancelled_by_restaurant',
                AUTO_REJECT_REASON,
            );
            rejected += 1;
            logger.info(`[AcceptTimeout] Auto-rejected unanswered order ${order.order_id || order._id}`);
        } catch (err) {
            logger.warn(`[AcceptTimeout] Could not auto-reject ${order._id}: ${err?.message || err}`);
        }
    }
    return rejected;
}
