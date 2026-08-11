/**
 * Confirms an online (Razorpay) payment on an order and activates it for restaurant acceptance.
 * Used by both client verify-payment and Razorpay webhooks so either path is sufficient and race-safe.
 *
 * Atomicity: only one concurrent caller wins the `payment.status != paid` update.
 */
import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodBusinessSettings } from '../../admin/models/businessSettings.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';
import { logger } from '../../../../utils/logger.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';
import * as foodTransactionService from './foodTransaction.service.js';
import {
  notifyOwnersSafely,
  notifyRestaurantNewOrder,
} from './order.helpers.js';

const ORDER_ACCEPTANCE_WINDOW_SECONDS = 240;

function normalizeAcceptanceWindowSeconds(minutesLike) {
  const numeric = Number(minutesLike);
  if (!Number.isFinite(numeric)) return ORDER_ACCEPTANCE_WINDOW_SECONDS;
  const roundedMinutes = Math.round(numeric);
  if (roundedMinutes < 1 || roundedMinutes > 20) return ORDER_ACCEPTANCE_WINDOW_SECONDS;
  return roundedMinutes * 60;
}

async function getOrderAcceptanceWindowSeconds() {
  try {
    const settings = await FoodBusinessSettings.findOne()
      .select('orderAcceptanceTimeMinutes')
      .lean();
    return normalizeAcceptanceWindowSeconds(settings?.orderAcceptanceTimeMinutes);
  } catch (err) {
    logger.warn(`Failed to load order acceptance setting: ${err?.message || err}`);
    return ORDER_ACCEPTANCE_WINDOW_SECONDS;
  }
}

function buildAcceptanceDeadline(date = new Date(), windowSeconds = ORDER_ACCEPTANCE_WINDOW_SECONDS) {
  const seconds = Number(windowSeconds);
  return new Date(
    date.getTime() +
      (Number.isFinite(seconds) && seconds > 0 ? seconds : ORDER_ACCEPTANCE_WINDOW_SECONDS) * 1000,
  );
}

async function incrementCouponUsageForOrder(order, userId) {
  const couponCode = order?.pricing?.couponCode
    ? String(order.pricing.couponCode).trim().toUpperCase()
    : '';
  if (!couponCode) return;
  if (!(Number(order?.pricing?.discount) > 0)) return;
  if (!userId) return;

  try {
    const offer = await FoodOffer.findOne({ couponCode }).lean();
    if (!offer) return;
    await FoodOffer.updateOne(
      {
        _id: offer._id,
        $or: [
          { usageLimit: { $in: [0, null] } },
          { usageLimit: { $exists: false } },
          { $expr: { $lt: [{ $ifNull: ['$usedCount', 0] }, '$usageLimit'] } },
        ],
      },
      { $inc: { usedCount: 1 } },
    );
    await FoodOfferUsage.updateOne(
      { offerId: offer._id, userId: new mongoose.Types.ObjectId(String(userId)) },
      { $inc: { count: 1 }, $set: { lastUsedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    logger.error(`Coupon usage update failed: ${err.message}`);
  }
}

/**
 * @returns {Promise<{ order: object|null, activated: boolean, alreadyPaid: boolean }>}
 */
export async function confirmOnlinePaymentAndActivateOrder({
  filter,
  razorpayPaymentId,
  razorpaySignature,
  recordedByRole = 'SYSTEM',
  recordedById = null,
  note = 'Payment confirmed',
  notifyUser = false,
}) {
  if (!filter || typeof filter !== 'object') {
    throw new Error('confirmOnlinePaymentAndActivateOrder: filter required');
  }

  const acceptanceWindowSeconds = await getOrderAcceptanceWindowSeconds();
  const acceptanceDeadlineAt = buildAcceptanceDeadline(new Date(), acceptanceWindowSeconds);
  const now = new Date();

  const setFields = {
    'payment.status': 'paid',
    'payment.razorpay.paymentId': String(razorpayPaymentId || ''),
    orderStatus: 'created',
    acceptanceWindowSeconds,
    acceptanceDeadlineAt,
  };
  if (razorpaySignature) {
    setFields['payment.razorpay.signature'] = String(razorpaySignature);
  }

  const order = await FoodOrder.findOneAndUpdate(
    {
      ...filter,
      'payment.status': { $ne: 'paid' },
    },
    {
      $set: setFields,
      $push: {
        statusHistory: {
          at: now,
          byRole: recordedByRole,
          byId: recordedById,
          from: 'pending_payment',
          to: 'created',
          note,
        },
      },
    },
    { new: true },
  );

  if (!order) {
    const existing = await FoodOrder.findOne(filter);
    if (existing && String(existing.payment?.status || '').toLowerCase() === 'paid') {
      if (String(existing.orderStatus || '').toLowerCase() === 'pending_payment') {
        const repaired = await FoodOrder.findOneAndUpdate(
          {
            _id: existing._id,
            orderStatus: 'pending_payment',
            'payment.status': 'paid',
          },
          {
            $set: {
              orderStatus: 'created',
              acceptanceWindowSeconds,
              acceptanceDeadlineAt,
            },
            $push: {
              statusHistory: {
                at: now,
                byRole: 'SYSTEM',
                byId: null,
                from: 'pending_payment',
                to: 'created',
                note: 'Repaired stuck paid order awaiting activation',
              },
            },
          },
          { new: true },
        );
        if (repaired) {
          await runPostActivationSideEffects(repaired, {
            razorpayPaymentId,
            razorpaySignature,
            recordedByRole,
            recordedById,
            notifyUser,
            acceptanceWindowSeconds,
          });
          return { order: repaired, activated: true, alreadyPaid: true };
        }
      }
      return { order: existing, activated: false, alreadyPaid: true };
    }
    return { order: existing || null, activated: false, alreadyPaid: false };
  }

  await runPostActivationSideEffects(order, {
    razorpayPaymentId,
    razorpaySignature,
    recordedByRole,
    recordedById,
    notifyUser,
    acceptanceWindowSeconds,
  });

  return { order, activated: true, alreadyPaid: false };
}

async function runPostActivationSideEffects(order, meta) {
  const acceptanceWindowSeconds = meta.acceptanceWindowSeconds || ORDER_ACCEPTANCE_WINDOW_SECONDS;

  void addOrderJob(
    {
      action: 'ORDER_ACCEPTANCE_TIMEOUT_CHECK',
      orderMongoId: order._id?.toString?.(),
      orderId: order._id.toString(),
    },
    {
      delay: acceptanceWindowSeconds * 1000,
      removeOnComplete: true,
      removeOnFail: true,
      jobId: `order-accept-timeout-${order._id?.toString?.()}`,
    },
  ).catch((err) => {
    logger.warn(`Failed to enqueue acceptance timeout check: ${err?.message || err}`);
  });

  try {
    const transaction = await foodTransactionService.createInitialTransaction(order);
    if (transaction && Number.isFinite(Number(transaction.amounts?.platformNetProfit))) {
      order.platformProfit = Number(transaction.amounts.platformNetProfit);
      await FoodOrder.updateOne(
        { _id: order._id },
        { $set: { platformProfit: order.platformProfit } },
      );
    }
  } catch (err) {
    logger.error(`[CRITICAL] Initial transaction failed for order ${order._id}: ${err.message}`);
  }

  try {
    await foodTransactionService.updateTransactionStatus(order._id, 'captured', {
      status: 'captured',
      razorpayPaymentId: meta.razorpayPaymentId,
      razorpaySignature: meta.razorpaySignature,
      recordedByRole: meta.recordedByRole,
      recordedById: meta.recordedById
        ? new mongoose.Types.ObjectId(String(meta.recordedById))
        : undefined,
      note: 'Payment confirmed (verify or webhook)',
    });
  } catch (err) {
    logger.error(`Transaction capture sync failed for order ${order._id}: ${err.message}`);
  }

  await incrementCouponUsageForOrder(order, order.userId);

  try {
    await notifyRestaurantNewOrder(order);
  } catch (err) {
    logger.warn(`Restaurant notify failed for order ${order._id}: ${err.message}`);
  }

  if (meta.notifyUser && order.userId) {
    try {
      await notifyOwnersSafely([{ ownerType: 'USER', ownerId: String(order.userId) }], {
        title: 'Payment Successful! ✅',
        body: `We have received your payment of ₹${order.payment?.amountDue || order.pricing?.total || ''} for Order #${order.order_id || order._id}.`,
        image: 'https://i.ibb.co/5GzXz7r/Eatiefy-Brand-Image.png',
        data: {
          type: 'payment_success',
          orderId: String(order._id),
          orderMongoId: String(order._id),
        },
      });
    } catch (err) {
      logger.warn(`User payment notify failed for order ${order._id}: ${err.message}`);
    }
  }
}
