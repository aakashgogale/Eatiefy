import mongoose from 'mongoose';
import sharp from 'sharp';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
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

/**
 * Decode UPI URI from Razorpay's QR code image and produce a clean, crisp square QR data URL,
 * plus the direct base64 image data URL.
 */
async function extractUpiUriAndGenerateQr(imageUrl) {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const rawBase64 = `data:image/png;base64,${buf.toString('base64')}`;

    let upiUri = null;
    let qrDataUrl = null;

    try {
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
      if (code?.data) {
        upiUri = code.data;
        qrDataUrl = await QRCode.toDataURL(upiUri, {
          margin: 2,
          width: 400,
          color: { dark: '#000000', light: '#ffffff' },
        });
      }
    } catch (decodeErr) {
      logger.warn(`[CollectQR] jsQR decode failed: ${decodeErr?.message}`);
    }

    return {
      upiUri,
      qrDataUrl,
      rawBase64,
    };
  } catch (err) {
    logger.warn(`[CollectQR] Failed to parse QR image: ${err?.message || err}`);
    return null;
  }
}

async function syncRazorpayQrPayment(orderDoc) {
  // Phase 2: avoid relying on FoodOrder.payment as the source of truth.
  const tx = await FoodTransaction.findOne({ orderId: orderDoc?._id }).lean();
  const payment = tx?.payment || orderDoc?.payment || null;
  if (!payment) return null;
  if (payment.method !== 'razorpay_qr') return payment;
  if (payment.status === 'paid') return payment;

  const qrId = payment?.qr?.qrCodeId || payment?.qr?.paymentLinkId;
  if (!qrId || !isRazorpayConfigured()) return payment;

  let isPaid = false;
  let paidPaymentId = null;

  try {
    if (String(qrId).startsWith('qr_')) {
      const res = await fetchRazorpayQrCodePayments(qrId);
      const items = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
      const successful = items.find((p) =>
        ['captured', 'authorized'].includes(String(p?.status || '').toLowerCase())
      );
      if (successful) {
        isPaid = true;
        paidPaymentId = successful.id;
      }
    } else {
      const link = await fetchRazorpayPaymentLink(qrId);
      const linkStatus = String(link?.status || '').toLowerCase();
      if (['paid', 'captured', 'authorized'].includes(linkStatus)) {
        isPaid = true;
        const payments = Array.isArray(link?.payments) ? link.payments : [];
        paidPaymentId = payments[0]?.payment_id || payments[0]?.id || null;
      }
    }
  } catch (error) {
    logger.warn(
      `Razorpay QR status check failed for ${qrId}: ${error?.message || error}`
    );
    return payment;
  }

  if (isPaid) {
    const paidAt = new Date();
    await FoodOrder.updateOne(
      { _id: orderDoc._id },
      {
        $set: {
          'payment.status': 'paid',
          'payment.paidAt': paidAt,
          ...(paidPaymentId ? { 'payment.razorpay.paymentId': paidPaymentId } : {}),
        },
      }
    );
    await FoodTransaction.updateOne(
      { orderId: orderDoc._id },
      {
        $set: {
          'payment.qr.status': 'paid',
          'payment.status': 'paid',
          'payment.paidAt': paidAt,
          ...(paidPaymentId ? { 'gateway.razorpayPaymentId': paidPaymentId } : {}),
        },
      }
    );

    try {
      await foodTransactionService.updateTransactionStatus(
        orderDoc._id,
        'captured',
        {
          status: 'captured',
          razorpayPaymentId: paidPaymentId,
          note: 'COD collection QR payment verified on Razorpay',
        }
      );
    } catch (ledgerErr) {
      logger.warn(`[CollectQR] Ledger update error: ${ledgerErr?.message}`);
    }

    return {
      ...payment,
      status: 'paid',
      method: 'razorpay_qr',
      paidAt,
      qr: {
        ...(payment.qr || {}),
        status: 'paid',
      },
    };
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

      let cleanUpiUri = null;
      let qrDataUrl = null;
      let rawBase64 = null;
      if (directImage) {
        const decoded = await extractUpiUriAndGenerateQr(directImage);
        if (decoded) {
          cleanUpiUri = decoded.upiUri;
          qrDataUrl = decoded.qrDataUrl;
          rawBase64 = decoded.rawBase64;
        }
      }

      qrData = {
        qrCodeId: rzQr.id,
        paymentLinkId: rzQr.id,
        shortUrl: cleanUpiUri || directImage,
        imageUrl: qrDataUrl || rawBase64 || directImage,
        rawImageUrl: rawBase64 || directImage,
        upiUri: cleanUpiUri || null,
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

        let linkQrDataUrl = null;
        if (link.short_url) {
          try {
            linkQrDataUrl = await QRCode.toDataURL(link.short_url, { margin: 2, width: 400 });
          } catch (_) {}
        }

        qrData = {
          qrCodeId: link.id,
          paymentLinkId: link.id,
          shortUrl: link.short_url,
          imageUrl: linkQrDataUrl || link.short_url,
          rawImageUrl: link.short_url,
          upiUri: null,
          status: link.status || 'created',
          expiresAt: link.expire_by ? new Date(link.expire_by * 1000) : null,
        };
      } catch (linkError) {
        logger.error(`[CollectQR] Razorpay Payment Link failed (${linkError?.message})`);
      }
    }
  }

  // Fallback 2: Standalone Dynamic UPI QR URI (only if explicit MERCHANT_UPI_ID is set in env)
  if (!qrData) {
    if (process.env.MERCHANT_UPI_ID) {
      const upiId = process.env.MERCHANT_UPI_ID;
      const upiName = process.env.MERCHANT_UPI_NAME || 'Eatiefy';
      const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amountDue.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Order #${displayId.slice(-6)}`)}`;
      let customQrDataUrl = null;
      try {
        customQrDataUrl = await QRCode.toDataURL(upiUri, { margin: 2, width: 400 });
      } catch (_) {}

      qrData = {
        qrCodeId: `upi_${order._id}_${Date.now()}`,
        paymentLinkId: `upi_${order._id}`,
        shortUrl: upiUri,
        imageUrl: customQrDataUrl || `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiUri)}`,
        upiUri,
        status: 'active',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      };
    } else {
      throw new ValidationError('Could not initialize Razorpay dynamic payment QR. Please try again or collect cash.');
    }
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
    rawImageUrl: qrData.rawImageUrl || qrData.imageUrl,
    upiUri: qrData.upiUri || null,
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

  let transaction = await FoodTransaction.findOne({ orderId: order._id }).lean();
  if (transaction?.payment?.method === 'razorpay_qr') {
    const syncedPayment = await syncRazorpayQrPayment(order);
    if (syncedPayment?.status === 'paid') {
      transaction = await FoodTransaction.findOne({ orderId: order._id }).lean();
    }
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
