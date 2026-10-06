import { FoodOrder } from '../models/order.model.js';
import {
    RESTAURANT_SCHEDULED_RING_LEAD_MS,
    buildRestaurantNewOrderPush,
    buildRestaurantOrderAlarmStopPush,
    canExposeOrderToRestaurant,
    isRestaurantOrderDueToRing,
    isRestaurantVoipCallDue,
    notifyOwnersSafely,
} from './order.helpers.js';
import { endVoipCallsSafely } from '../../../../core/notifications/firebase.service.js';
import {
    ACCEPT_WINDOW_GRACE_MS,
    buildAcceptWindowResolver,
    getRestaurantAcceptWindowStart,
} from './restaurantAcceptTimeout.service.js';
import { loadRestaurantSettingsByZone } from '../../admin/controllers/systemConfig.controller.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Repeating new-order alarm on the restaurant's phone.
 *
 * A push rings once. With the app closed nothing else on the phone knows the
 * order is still waiting, and iOS cuts a notification sound off at 30 seconds,
 * so the push is repeated every RESTAURANT_ORDER_RING_INTERVAL_SECONDS (default
 * 25) until the order is accepted, rejected or cancelled, or its accept window
 * is over. Then one data-only "stop" push lets apps that render the alarm
 * themselves silence it.
 *
 * The state lives on the order (`restaurantAlarm`, started by
 * notifyRestaurantNewOrder) and every ring and stop is claimed with a
 * conditional update, so API instances sweeping at the same time send it once.
 */

const DEFAULT_RING_INTERVAL_SECONDS = 25;
const MIN_RING_INTERVAL_SECONDS = 10;
const BATCH_LIMIT = 200;

/** Delay between rings; 0 when repeating is switched off (the first push still goes out). */
export const getRestaurantOrderRingIntervalMs = () => {
    const raw = String(process.env.RESTAURANT_ORDER_RING_INTERVAL_SECONDS ?? '').trim();
    if (!raw) return DEFAULT_RING_INTERVAL_SECONDS * 1000;
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return Math.max(MIN_RING_INTERVAL_SECONDS, seconds) * 1000;
};

const toMs = (value) => {
    const ms = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(ms) ? ms : null;
};

const restaurantTarget = (order) => [
    { ownerType: 'RESTAURANT', ownerId: String(order.restaurantId), platform: 'mobile' },
];

/** True once the order can no longer be accepted, even if the auto-reject has not run yet. */
const isAcceptWindowOver = (order, windowMs, now) => {
    const notifiedAt = getRestaurantAcceptWindowStart(order);
    if (notifiedAt == null) return false;
    // A scheduled order starts ringing shortly before its time, not when placed.
    const scheduledAt = toMs(order.scheduledAt);
    const ringStart = scheduledAt != null
        ? Math.max(notifiedAt, scheduledAt - RESTAURANT_SCHEDULED_RING_LEAD_MS)
        : notifiedAt;
    return now - ringStart >= windowMs + ACCEPT_WINDOW_GRACE_MS;
};

async function stopAlarm(order, now) {
    const claimed = await FoodOrder.updateOne(
        { _id: order._id, 'restaurantAlarm.active': true },
        { $set: { 'restaurantAlarm.active': false, 'restaurantAlarm.stoppedAt': new Date(now) } },
    );
    if (!claimed?.modifiedCount) return false;
    await notifyOwnersSafely(restaurantTarget(order), buildRestaurantOrderAlarmStopPush(order));
    // Hang up the order call still ringing on the restaurant's iPhones.
    await endVoipCallsSafely(restaurantTarget(order), {
        orderKey: String(order._id),
        reason: order.orderStatus === 'created' ? 'expired' : 'resolved',
        data: { orderMongoId: String(order._id), orderStatus: String(order.orderStatus || '') },
    });
    return true;
}

async function ringAgain(order, now, intervalMs) {
    // A VoIP call rings on its own; start the next one only once it has ended.
    const voipRing = isRestaurantVoipCallDue(order, now);
    const claimed = await FoodOrder.updateOne(
        {
            _id: order._id,
            orderStatus: 'created',
            'restaurantAlarm.active': true,
            'restaurantAlarm.lastRingAt': order.restaurantAlarm?.lastRingAt ?? null,
        },
        {
            $set: {
                'restaurantAlarm.lastRingAt': new Date(now),
                ...(voipRing ? { 'restaurantAlarm.lastVoipCallAt': new Date(now) } : {}),
            },
            $inc: { 'restaurantAlarm.ringCount': 1 },
        },
    );
    if (!claimed?.modifiedCount) return false;

    const ringSeq = (Number(order.restaurantAlarm?.ringCount) || 1) + 1;
    await notifyOwnersSafely(restaurantTarget(order), {
        ...buildRestaurantNewOrderPush(order, { ringSeq, now, voipRing }),
        // A phone that was offline must not get a burst of stale rings later.
        ttlSeconds: Math.ceil((intervalMs * 2) / 1000),
    });
    return true;
}

export async function syncRestaurantOrderAlarms({ now = Date.now() } = {}) {
    const ringing = await FoodOrder.find({ 'restaurantAlarm.active': true })
        .select('_id order_id orderId restaurantId zoneId orderType orderStatus payment scheduledAt createdAt restaurantNotifiedAt restaurantAlarm')
        .sort({ 'restaurantAlarm.lastRingAt': 1 })
        .limit(BATCH_LIMIT)
        .lean();
    if (!ringing.length) return { rung: 0, stopped: 0 };

    const intervalMs = getRestaurantOrderRingIntervalMs();
    const windowFor = await buildAcceptWindowResolver(await loadRestaurantSettingsByZone(), ringing);

    let rung = 0;
    let stopped = 0;
    for (const order of ringing) {
        try {
            if (order.orderStatus !== 'created' || isAcceptWindowOver(order, windowFor(order), now)) {
                if (await stopAlarm(order, now)) stopped += 1;
                continue;
            }
            if (!intervalMs || !canExposeOrderToRestaurant(order) || !isRestaurantOrderDueToRing(order, now)) continue;

            const lastRingAt = toMs(order.restaurantAlarm?.lastRingAt);
            if (lastRingAt != null && now - lastRingAt < intervalMs) continue;
            if (await ringAgain(order, now, intervalMs)) rung += 1;
        } catch (err) {
            logger.warn(`[RestaurantAlarm] ${order.order_id || order._id}: ${err?.message || err}`);
        }
    }
    return { rung, stopped };
}
