import crypto from 'crypto';
import { FoodOrder } from '../../../modules/food/orders/models/order.model.js';
import { FoodTransaction } from '../../../modules/food/orders/models/foodTransaction.model.js';
import * as foodTransactionService from '../../../modules/food/orders/services/foodTransaction.service.js';
import * as orderService from '../../../modules/food/orders/services/order.service.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

function signaturesMatch(expectedHex, received) {
    try {
        const a = Buffer.from(String(expectedHex), 'utf8');
        const b = Buffer.from(String(received || ''), 'utf8');
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

async function findFoodOrderForRazorpayOrderId(rzOrderId) {
    if (!rzOrderId) return null;

    let order = await FoodOrder.findOne({ 'payment.razorpay.orderId': rzOrderId });
    if (order) return order;

    const tx = await FoodTransaction.findOne({ 'gateway.razorpayOrderId': rzOrderId }).lean();
    if (tx?.orderId) {
        order = await FoodOrder.findById(tx.orderId);
    }
    return order || null;
}

async function markOrderPaidFromWebhook(order, rzPaymentId, note) {
    if (!order) return null;
    if (String(order.payment?.status || '').toLowerCase() === 'paid') return order;

    order.payment = order.payment || {};
    order.payment.status = 'paid';
    if (!order.payment.razorpay) order.payment.razorpay = {};
    order.payment.razorpay.paymentId = rzPaymentId;
    order.markModified('payment');
    await order.save();

    try {
        await foodTransactionService.updateTransactionStatus(order._id, 'captured', {
            status: 'captured',
            razorpayPaymentId: rzPaymentId,
            note,
        });
    } catch (ledgerErr) {
        logger.error(`Webhook Ledger Error (Order ${order.orderId || order._id}): ${ledgerErr.message}`);
    }
    return order;
}

/**
 * Centralized Razorpay Webhook Handler (Core Layer)
 * Manages atomic updates for order payments and refunds across all modules.
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

    if (!signaturesMatch(expected, signature)) {
        logger.warn('Razorpay Webhook: Signature verification failed.');
        return res.status(400).send('Invalid signature');
    }

    const { event, payload } = req.body;
    logger.info(`Razorpay Webhook Received: ${event}`);

    try {
        if (event === 'payment.captured') {
            const paymentObj = payload?.payment?.entity || {};
            const rzOrderId = paymentObj.order_id;
            const rzPaymentId = paymentObj.id;

            let order = await findFoodOrderForRazorpayOrderId(rzOrderId);
            if (!order) {
                // If phone dropped network post-payment, recover order from pending intent
                try {
                    order = await orderService.createOrderFromPendingIntent(rzOrderId, rzPaymentId);
                    if (order) {
                        logger.info(`Webhook [payment.captured]: Auto-created Order ${order._id} from Pending Intent`);
                    }
                } catch (recoveryErr) {
                    logger.error(`Webhook Auto-Create Error for ${rzOrderId}: ${recoveryErr?.message || recoveryErr}`);
                }
            }

            if (order) {
                // Also persist orderId if missing (legacy orders)
                if (rzOrderId && !order.payment?.razorpay?.orderId) {
                    order.payment = order.payment || {};
                    if (!order.payment.razorpay) order.payment.razorpay = {};
                    order.payment.razorpay.orderId = rzOrderId;
                }
                await markOrderPaidFromWebhook(
                    order,
                    rzPaymentId,
                    'Payment status synced via Webhook (payment.captured)',
                );
                logger.info(`Webhook [payment.captured]: Synced Order ${order.orderId || order._id} (Status=paid)`);
            } else {
                logger.warn(`Webhook [payment.captured]: Order not found & no pending intent for RZ-Order: ${rzOrderId}`);
            }
        }

        // COD QR / payment-link collection
        if (event === 'payment_link.paid') {
            const linkObj = payload?.payment_link?.entity || {};
            const paymentLinkId = linkObj.id;
            const foodOrderId = linkObj.notes?.foodOrderId || linkObj.reference_id;
            const payments = Array.isArray(linkObj.payments) ? linkObj.payments : [];
            const rzPaymentId = payments[0]?.payment_id || payments[0]?.id || null;

            let order = null;
            if (foodOrderId) {
                order = await FoodOrder.findById(foodOrderId).catch(() => null);
                if (!order) {
                    order = await FoodOrder.findOne({ orderId: String(foodOrderId) });
                }
            }
            if (!order && paymentLinkId) {
                const tx = await FoodTransaction.findOne({ 'payment.qr.paymentLinkId': paymentLinkId }).lean();
                if (tx?.orderId) order = await FoodOrder.findById(tx.orderId);
            }

            if (order) {
                await markOrderPaidFromWebhook(
                    order,
                    rzPaymentId,
                    'Payment status synced via Webhook (payment_link.paid)',
                );
                try {
                    await FoodTransaction.updateOne(
                        { orderId: order._id },
                        {
                            $set: {
                                'payment.status': 'paid',
                                'payment.method': 'razorpay_qr',
                                'payment.qr.status': 'paid',
                            },
                        },
                    );
                } catch (_) {}
                logger.info(`Webhook [payment_link.paid]: Synced Order ${order.orderId || order._id}`);
            } else {
                logger.warn(`Webhook [payment_link.paid]: Order not found for link ${paymentLinkId}`);
            }
        }

        if (event === 'refund.processed') {
            const refundObj = payload?.refund?.entity || {};
            const rzPaymentId = refundObj.payment_id;
            const rzRefundId = refundObj.id;
            const refundAmount = Number(refundObj.amount || 0) / 100;

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
                logger.info(`Webhook [refund.processed]: Synced Order ${order.orderId || order._id} (Refunded)`);
            } else {
                logger.warn(`Webhook [refund.processed]: Order not found for RZ-Payment: ${rzPaymentId}`);
            }
        }

        res.status(200).json({ status: 'ok' });
    } catch (err) {
        logger.error(`Razorpay Webhook Logic Error: ${err.message}`);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
