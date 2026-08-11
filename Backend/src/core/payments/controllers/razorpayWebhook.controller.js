import { FoodOrder } from '../../../modules/food/orders/models/order.model.js';
import { confirmOnlinePaymentAndActivateOrder } from '../../../modules/food/orders/services/order-payment-activation.service.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { safeEqualString } from '../../../utils/cryptoSafeCompare.js';
import crypto from 'crypto';

/**
 * Razorpay webhook handler — signature verified, amount checked, order activation idempotent.
 */
export const handleRazorpayWebhook = async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const secret = config.razorpayWebhookSecret;

    if (!signature || !secret || !req.rawBody) {
        logger.warn('Razorpay Webhook: Missing signature or rawBody buffer.');
        return res.status(400).send('Invalid signature');
    }

    const expected = crypto
        .createHmac('sha256', secret)
        .update(req.rawBody)
        .digest('hex');

    if (!safeEqualString(expected, String(signature))) {
        logger.warn('Razorpay Webhook: Signature verification failed.');
        return res.status(400).send('Invalid signature');
    }

    const { event, payload } = req.body;
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
                .select('pricing payment orderStatus')
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
                if (String(existingOrder.payment?.status || '').toLowerCase() !== 'paid') {
                    await FoodOrder.updateOne(
                        { _id: existingOrder._id, 'payment.status': { $ne: 'paid' } },
                        { $set: { 'payment.status': 'failed', 'payment.razorpay.paymentId': rzPaymentId } },
                    );
                }
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
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
