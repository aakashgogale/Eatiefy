import crypto from 'crypto';
import { FoodOrder } from '../../../modules/food/orders/models/order.model.js';
import { confirmOnlinePaymentAndActivateOrder } from '../../../modules/food/orders/services/order-payment-activation.service.js';
import { releaseInventoryForItems } from '../../../modules/food/orders/services/inventory.service.js';
import { onlinePaymentFailureFilter } from '../../../modules/food/orders/services/payment-state.machine.js';
import { claimWebhookEvent } from '../models/webhookEvent.model.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { verifyRazorpayWebhookSignature } from '../../../utils/razorpaySignatures.js';

/**
 * Razorpay webhook handler — signature verified, event-id deduped, amount checked, activation idempotent.
 */
export const handleRazorpayWebhook = async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const secret = config.razorpayWebhookSecret;

    if (!signature || !secret || !req.rawBody) {
        logger.warn('Razorpay Webhook: Missing signature or rawBody buffer.');
        return res.status(400).send('Invalid signature');
    }

    if (!verifyRazorpayWebhookSignature(req.rawBody, signature, secret)) {
        logger.warn('Razorpay Webhook: Signature verification failed.');
        return res.status(400).send('Invalid signature');
    }

    const { event, payload } = req.body || {};

    // Prefer Razorpay event id header when present; else derive stable id from entity+event
    const eventId =
        String(req.headers['x-razorpay-event-id'] || '').trim() ||
        (event === 'payment.captured' && payload?.payment?.entity?.id
            ? `payment.captured:${payload.payment.entity.id}`
            : null) ||
        (event === 'refund.processed' && payload?.refund?.entity?.id
            ? `refund.processed:${payload.refund.entity.id}`
            : null) ||
        (event === 'payment.failed' && payload?.payment?.entity?.id
            ? `payment.failed:${payload.payment.entity.id}`
            : null) ||
        (req.body?.id ? String(req.body.id) : null);

    if (eventId) {
        const claim = await claimWebhookEvent({
            provider: 'razorpay',
            eventId,
            eventType: String(event || ''),
            payloadHash: crypto.createHash('sha256').update(req.rawBody).digest('hex'),
        });
        if (claim.duplicate) {
            logger.info(`Razorpay Webhook duplicate ignored: ${eventId}`);
            return res.status(200).json({ status: 'ok', duplicate: true });
        }
    }

    logger.info(`Razorpay Webhook Received: ${event}`);

    try {
        if (event === 'payment.captured') {
            const paymentObj = payload?.payment?.entity;
            const rzOrderId = paymentObj?.order_id;
            const rzPaymentId = paymentObj?.id;

            if (!rzOrderId || !rzPaymentId) {
                logger.warn('Webhook [payment.captured]: missing order_id or payment id');
                return res.status(200).json({ status: 'ok' });
            }

            const existingOrder = await FoodOrder.findOne({ 'payment.razorpay.orderId': rzOrderId })
                .select('pricing payment orderStatus inventoryReservation inventoryReserved')
                .lean();

            if (!existingOrder) {
                logger.warn(`Webhook [payment.captured]: Order not found for RZ-Order: ${rzOrderId}`);
                return res.status(200).json({ status: 'ok' });
            }

            const expectedPaise = Math.round((Number(existingOrder.pricing?.total) || 0) * 100);
            const paidPaise = Number(paymentObj.amount);
            if (!Number.isFinite(paidPaise) || paidPaise !== expectedPaise) {
                logger.error(
                    `Webhook [payment.captured]: AMOUNT MISMATCH for RZ-Order ${rzOrderId} — paid ${paidPaise} paise, expected ${expectedPaise} paise. Order NOT marked paid.`,
                );
                await FoodOrder.updateOne(
                    onlinePaymentFailureFilter({ _id: existingOrder._id }),
                    { $set: { 'payment.status': 'failed', 'payment.razorpay.paymentId': rzPaymentId } },
                );
                return res.status(200).json({ status: 'ok' });
            }

            const { order, activated, alreadyPaid } = await confirmOnlinePaymentAndActivateOrder({
                filter: { 'payment.razorpay.orderId': rzOrderId },
                razorpayPaymentId: rzPaymentId,
                recordedByRole: 'SYSTEM',
                recordedById: null,
                note: 'Payment status synced via Webhook (payment.captured)',
                notifyUser: true,
            });

            if (activated) {
                logger.info(`Webhook [payment.captured]: Activated Order ${order?.order_id || order?._id}`);
            } else if (alreadyPaid) {
                logger.info(`Webhook [payment.captured]: Already paid Order ${order?.order_id || order?._id}`);
            } else {
                logger.warn(`Webhook [payment.captured]: Could not activate RZ-Order: ${rzOrderId}`);
            }
        }

        if (event === 'payment.failed') {
            const paymentObj = payload?.payment?.entity;
            const rzOrderId = paymentObj?.order_id;
            if (rzOrderId) {
                const failed = await FoodOrder.findOneAndUpdate(
                    onlinePaymentFailureFilter({ 'payment.razorpay.orderId': rzOrderId }),
                    {
                        $set: {
                            'payment.status': 'failed',
                            'payment.razorpay.paymentId': String(paymentObj?.id || ''),
                        },
                        $push: {
                            statusHistory: {
                                at: new Date(),
                                byRole: 'SYSTEM',
                                from: 'pending_payment',
                                to: 'pending_payment',
                                note: 'Payment failed via webhook',
                            },
                        },
                    },
                    { new: true },
                );
                if (failed?.inventoryReserved && Array.isArray(failed.inventoryReservation)) {
                    await releaseInventoryForItems(failed.inventoryReservation).catch((err) => {
                        logger.error(`Inventory release on payment.failed failed: ${err.message}`);
                    });
                    await FoodOrder.updateOne(
                        { _id: failed._id },
                        { $set: { inventoryReserved: false } },
                    );
                }
            }
        }

        if (event === 'refund.processed') {
            const refundObj = payload?.refund?.entity;
            const rzPaymentId = refundObj?.payment_id;
            const rzRefundId = refundObj?.id;
            const refundAmount = (Number(refundObj?.amount) || 0) / 100;

            const order = await FoodOrder.findOneAndUpdate(
                {
                    'payment.razorpay.paymentId': rzPaymentId,
                    'payment.refund.status': { $ne: 'processed' },
                },
                {
                    $set: {
                        'payment.status': 'refunded',
                        'payment.refund': {
                            status: 'processed',
                            amount: refundAmount,
                            refundId: rzRefundId,
                            processedAt: new Date(),
                        },
                    },
                },
                { new: true },
            );

            if (order) {
                logger.info(`Webhook [refund.processed]: Synced Order ${order.order_id || order._id} (Refunded)`);
            } else {
                logger.warn(`Webhook [refund.processed]: Order not found or already refunded for RZ-Payment: ${rzPaymentId}`);
            }
        }

        res.status(200).json({ status: 'ok' });
    } catch (err) {
        logger.error(`Razorpay Webhook Logic Error: ${err.message}`);
        res.status(500).json({ status: 'error' });
    }
};
