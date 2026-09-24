import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
} from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import {
  createPaymentLink,
  createRazorpayQrCode,
  fetchRazorpayPaymentLink,
  fetchRazorpayQrCodePayments,
  isRazorpayConfigured,
} from '../helpers/razorpay.helper.js';
import * as foodTransactionService from './foodTransaction.service.js';
import {
  buildOrderIdentityFilter,
  enqueueOrderEvent,
} from './order.helpers.js';

async function syncRazorpayQrPayment(orderDoc) {
  // Phase 2: avoid relying on FoodOrder.payment as the source of truth.
  const tx = await FoodTransaction.findOne({ orderId: orderDoc?._id }).lean();
  const payment = tx?.payment || orderDoc?.payment || null;
  if (!payment) return null;
  if (payment.method !== 'razorpay_qr') return payment;
  if (payment.status === 'paid') return payment;

  const qrId = payment?.qr?.qrCodeId || payment?.qr?.paymentLinkId;
  if (!qrId || !isRazorpayConfigured()) return orderDoc.payment;

  let isPaid = false;

  try {
    if (String(qrId).startsWith('qr_')) {
      const res = await fetchRazorpayQrCodePayments(qrId);
      const items = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
      const successful = items.find((p) =>
        ['captured', 'authorized'].includes(String(p?.status || '').toLowerCase())
      );
      if (successful) {
        isPaid = true;
      }
    } else {
      const link = await fetchRazorpayPaymentLink(qrId);
      const linkStatus = String(link?.status || '').toLowerCase();
      if (['paid', 'captured', 'authorized'].includes(linkStatus)) {
        isPaid = true;
      }
    }
  } catch (error) {
    logger.warn(
      `Razorpay QR status check failed for ${qrId}: ${error?.message || error}`
    );
    return orderDoc.payment;
  }

  if (isPaid) {
    await FoodOrder.updateOne(
      { _id: orderDoc._id },
      {
        $set: {
          'payment.status': 'paid',
          'payment.paidAt': new Date(),
        },
      }
    );
    await FoodTransaction.updateOne(
      { orderId: orderDoc._id },
      {
        $set: {
          'payment.qr.status': 'paid',
          'payment.status': 'paid',
          'payment.paidAt': new Date(),
        },
      }
    );
  }

  return payment;
}

export async function createCollectQr(
  orderId,
  deliveryPartnerId,
  customerInfo = {},
) {
  const filter = buildOrderIdentityFilter(orderId);
  if (!filter) throw new NotFoundError('Order not found');

  const order = await FoodOrder.findOne(filter)
    .populate('userId', 'name email phone')
    .lean();

  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }
  const tx = await FoodTransaction.findOne({ orderId: order._id }).lean();
  const payment = tx?.payment || order.payment || {};
  if (payment.method !== 'cash' && payment.status === 'paid') {
    throw new ValidationError('Order already paid');
  }

  const amountDue = payment.amountDue ?? tx?.pricing?.total ?? order.pricing?.total ?? order.total ?? order.amount ?? 0;
  if (amountDue < 1) throw new ValidationError('No amount due');

  const user = order.userId || {};
  const amountPaise = Math.round(amountDue * 100);
  const displayId = String(order.order_id || order.orderId || order._id);

  let qrData = null;

  if (isRazorpayConfigured()) {
    try {
      // Attempt 1: Create real Dynamic UPI QR Code via Razorpay QR Code API
      const rzQr = await createRazorpayQrCode({
        amountPaise,
        name: `Order #${displayId.slice(-6)}`,
        description: `Payment for Order #${displayId}`,
        notes: {
          foodOrderId: order._id.toString(),
          orderDisplayId: displayId,
          purpose: 'cod_collect_qr',
        },
      });

      const directImage = rzQr.image_url || rzQr.imageUrl || rzQr.image || rzQr.short_url || rzQr.upi_link || rzQr.url;
      logger.info(`[CollectQR] Razorpay QR created: id=${rzQr.id}, image=${directImage}`);

      qrData = {
        qrCodeId: rzQr.id,
        paymentLinkId: rzQr.id,
        shortUrl: directImage,
        imageUrl: directImage,
        status: rzQr.status || 'active',
        expiresAt: rzQr.close_by ? new Date(rzQr.close_by * 1000) : null,
      };
    } catch (qrError) {
      logger.warn(
        `[CollectQR] Razorpay QR Code API creation failed (${qrError?.message}), falling back to Payment Link`,
      );
      try {
        // Fallback 1: Create Payment Link
        const link = await createPaymentLink({
          amountPaise,
          currency: 'INR',
          description: `Order ${displayId} - COD collect`,
          orderId: order._id.toString(),
          customerName: customerInfo.name || user.name || 'Customer',
          customerEmail: customerInfo.email || user.email || 'customer@example.com',
          customerPhone: customerInfo.phone || user.phone,
          notes: {
            foodOrderId: order._id.toString(),
            orderDisplayId: displayId,
            purpose: 'cod_collect_qr',
          },
        });

        logger.info(`[CollectQR] Razorpay Payment Link created: id=${link.id}, url=${link.short_url}`);
        qrData = {
          qrCodeId: link.id,
          paymentLinkId: link.id,
          shortUrl: link.short_url,
          imageUrl: link.short_url,
          status: link.status || 'created',
          expiresAt: link.expire_by ? new Date(link.expire_by * 1000) : null,
        };
      } catch (linkError) {
        logger.error(`[CollectQR] Razorpay Payment Link failed (${linkError?.message}), creating dynamic UPI QR`);
      }
    }
  }

  // Fallback 2: Standalone Dynamic UPI QR URI (for offline, sandbox or gateway outage)
  if (!qrData) {
    const upiId = process.env.MERCHANT_UPI_ID || 'eatiefy@icici';
    const upiName = 'Eatiefy';
    const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amountDue.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Order #${displayId.slice(-6)}`)}`;
    const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiUri)}`;

    qrData = {
      qrCodeId: `upi_${order._id}_${Date.now()}`,
      paymentLinkId: `upi_${order._id}`,
      shortUrl: upiUri,
      imageUrl: qrImgUrl,
      status: 'active',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  // Write QR collection state into FoodTransaction
  await FoodTransaction.updateOne(
    { orderId: order._id },
    {
      $set: {
        paymentMethod: 'razorpay_qr',
        'payment.method': 'razorpay_qr',
        'payment.status': 'pending_qr',
        'payment.qr': qrData,
      },
    },
  );

  const updatedTx = await FoodTransaction.findOne({ orderId: order._id }).lean();

  if (updatedTx) {
    await foodTransactionService.updateTransactionStatus(
      order._id,
      'cod_collect_qr_created',
      {
        recordedByRole: 'DELIVERY_PARTNER',
        recordedById: deliveryPartnerId,
        note: 'COD collection QR created',
      },
    );
  }

  enqueueOrderEvent('collect_qr_created', {
    orderMongoId: String(orderId),
    orderId: order?.orderId || null,
    deliveryPartnerId,
    paymentLinkId: qrData.paymentLinkId,
    shortUrl: qrData.shortUrl,
    amountDue,
  });

  return {
    shortUrl: qrData.shortUrl,
    imageUrl: qrData.imageUrl,
    qrCodeId: qrData.qrCodeId,
    amount: amountDue,
    expiresAt: qrData.expiresAt,
  };
}

export async function getPaymentStatus(orderId, deliveryPartnerId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError('Order id required');

  const order = await FoodOrder.findOne(identity).select(
    'dispatch riderEarning platformProfit',
  );
  if (!order) throw new NotFoundError('Order not found');
  if (
    order.dispatch?.deliveryPartnerId?.toString() !== deliveryPartnerId.toString()
  ) {
    throw new ForbiddenError('Not your order');
  }

  const transaction = await FoodTransaction.findOne({ orderId: order._id }).lean();
  if (transaction?.payment?.method === 'razorpay_qr') {
    await syncRazorpayQrPayment(order);
  }
  const latestHistory =
    (transaction?.history || []).sort((a, b) => (b.at || 0) - (a.at || 0))[0] ||
    null;

  return {
    payment: transaction?.payment || {},
    latestPaymentSnapshot: latestHistory,
    riderEarning: order.riderEarning ?? 0,
    platformProfit: order.platformProfit ?? 0,
    pricingTotal: transaction?.pricing?.total ?? 0,
    transactionStatus: transaction?.status ?? null,
  };
}
