import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import * as foodTransactionService from './foodTransaction.service.js';
import { notifyOwnersSafely, pushStatusHistory } from './order.helpers.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Auto-expiry for takeaway "Pay at Pickup" orders that were placed but never paid.
 *
 * These orders sit at orderStatus "created" with payment.status
 * "awaiting_pickup_payment". The restaurant is never shown them (the exposure gate
 * hides unpaid online orders), so the normal accept-timeout sweep deliberately
 * skips them — they would otherwise live forever. This sweep cancels the ones the
 * customer abandoned, the way large delivery apps drop an unpaid order after a
 * window. No money was taken, so there is nothing to refund.
 *
 * The window is configurable via PAY_AT_PICKUP_EXPIRY_MINUTES (default 120).
 */

const DEFAULT_EXPIRY_MINUTES = 120;
const BATCH_LIMIT = 50;

function getExpiryMs() {
    const raw = Number(process.env.PAY_AT_PICKUP_EXPIRY_MINUTES);
    const minutes = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_EXPIRY_MINUTES;
    return minutes * 60 * 1000;
}

export async function expireUnpaidPickupOrders({ now = Date.now() } = {}) {
    const cutoff = new Date(now - getExpiryMs());

    const candidates = await FoodOrder.find({
        orderType: 'takeaway',
        orderStatus: 'created',
        'payment.payAtPickup': true,
        'payment.status': 'awaiting_pickup_payment',
        createdAt: { $lte: cutoff },
    })
        .sort({ createdAt: 1 })
        .limit(BATCH_LIMIT);

    let expired = 0;
    for (const order of candidates) {
        try {
            // Re-check under the live document: a payment may have landed between
            // the query and here, which flips payment.status away from awaiting.
            if (order.payment?.status !== 'awaiting_pickup_payment') continue;

            const from = order.orderStatus;
            // Reuse an existing cancel status so the large orderStatus enum (and its
            // many consumers) stays untouched; cancelledBy records it was the system.
            order.orderStatus = 'cancelled_by_admin';
            order.cancellationReason = 'Payment not completed at pickup (auto-expired)';
            order.cancelledAt = new Date();
            order.cancelledBy = 'system';
            pushStatusHistory(order, {
                byRole: 'SYSTEM',
                from,
                to: 'cancelled_by_admin',
                note: 'Pay-at-Pickup order expired: payment was not completed.',
            });
            await order.save();

            // No payment was captured, so mark the ledger entry failed (not refunded).
            try {
                await foodTransactionService.updateTransactionStatus(order._id, 'failed', {
                    status: 'failed',
                    recordedByRole: 'SYSTEM',
                    note: 'Pay-at-Pickup order expired without payment.',
                });
            } catch (ledgerErr) {
                // If there is no ledger row yet, just drop any stray one.
                try { await FoodTransaction.deleteOne({ orderId: order._id }); } catch {}
                logger.warn(`[PickupExpiry] Ledger update skipped for ${order._id}: ${ledgerErr?.message || ledgerErr}`);
            }

            if (order.userId) {
                await notifyOwnersSafely([{ ownerType: 'USER', ownerId: String(order.userId) }], {
                    title: 'Order Expired',
                    body: `Your takeaway order #${order.order_id || order._id} expired because the payment was not completed at pickup.`,
                    idempotencyKey: `pickup_expired_${order._id}`,
                    eventId: `pickup_expired_${order._id}`,
                    tag: `pickup_expired_${order._id}`,
                    data: {
                        type: 'order_expired',
                        orderId: String(order._id),
                        orderMongoId: String(order._id),
                        link: `/food/user/orders/${order._id?.toString?.() || ''}`,
                        tag: `pickup_expired_${order._id}`,
                        eventId: `pickup_expired_${order._id}`,
                    },
                });
            }

            expired += 1;
            logger.info(`[PickupExpiry] Expired unpaid pay-at-pickup order ${order.order_id || order._id}`);
        } catch (err) {
            logger.warn(`[PickupExpiry] Could not expire ${order._id}: ${err?.message || err}`);
        }
    }
    return expired;
}
