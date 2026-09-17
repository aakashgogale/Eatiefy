import { FoodOrder } from '../models/order.model.js';
import { canExposeOrderToRestaurant } from './order.helpers.js';
import { updateOrderStatusRestaurant } from './order.service.js';
import { resolveRestaurantSettings } from '../../admin/controllers/systemConfig.controller.js';
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
const BATCH_LIMIT = 50;

/** When the restaurant was first shown the order; the window counts from here. */
export const getRestaurantAcceptWindowStart = (order) => {
    const at = order?.restaurantNotifiedAt || order?.createdAt;
    const ms = at ? new Date(at).getTime() : NaN;
    return Number.isFinite(ms) ? ms : null;
};

export async function expireUnacceptedRestaurantOrders({ now = Date.now() } = {}) {
    const { deliveryAcceptOrderTimeMinutes, takeawayAcceptOrderTimeMinutes } = await resolveRestaurantSettings();
    const windows = {
        takeaway: takeawayAcceptOrderTimeMinutes * 60 * 1000,
        other: deliveryAcceptOrderTimeMinutes * 60 * 1000,
    };
    const oldestCutoff = new Date(now - Math.min(windows.takeaway, windows.other) - GRACE_MS);

    const candidates = await FoodOrder.find({
        orderStatus: 'created',
        $or: [
            { restaurantNotifiedAt: { $lte: oldestCutoff } },
            { restaurantNotifiedAt: null, createdAt: { $lte: oldestCutoff } },
        ],
        // A scheduled order is not due for a decision until its time comes.
        $and: [{ $or: [{ scheduledAt: null }, { scheduledAt: { $lte: new Date(now) } }] }],
    })
        .select('_id order_id restaurantId orderType createdAt restaurantNotifiedAt payment scheduledAt')
        .sort({ createdAt: 1 })
        .limit(BATCH_LIMIT)
        .lean();

    let rejected = 0;
    for (const order of candidates) {
        // Never auto-reject an order the restaurant could not see (unpaid online order).
        if (!canExposeOrderToRestaurant(order)) continue;

        const windowMs = order.orderType === 'takeaway' ? windows.takeaway : windows.other;
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
