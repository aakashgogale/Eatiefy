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
async function fetchImageBuffer(imageUrl, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(imageUrl, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      // brief backoff before retry
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

/**
 * Decode the real `upi://pay?...` string out of Razorpay's hosted QR poster and
 * regenerate a clean, scan-direct UPI QR from it.
 *
 * Razorpay's `image_url` is a branded *poster* whose QR encodes a real UPI intent
 * string. We must surface that UPI string (not the rzp.io poster link) so scanning
 * opens GPay/PhonePe/Paytm directly instead of a "leaving app" web redirect.
 *
 * Returns { upiUri, qrDataUrl, rawBase64 } only when a genuine `upi://` string is
 * decoded; otherwise null, so the caller never ships the poster/link to the scanner.
 */
async function extractUpiUriAndGenerateQr(imageUrl) {
  let buf = null;
  try {
    buf = await fetchImageBuffer(imageUrl, 3);
  } catch (err) {
    logger.warn(`[CollectQR] Failed to fetch QR image: ${err?.message || err}`);
    return null;
  }
  if (!buf) return null;

  const rawBase64 = `data:image/png;base64,${buf.toString('base64')}`;

  // Try the raw poster first, then a few preprocessing variants to make jsQR robust
  // against the poster's borders/branding and any anti-aliasing.
  const decodeAttempts = [
    (b) => sharp(b),
    (b) => sharp(b).resize({ width: 900, withoutEnlargement: false }),
    (b) => sharp(b).grayscale().normalize().threshold(128),
    (b) => sharp(b).resize({ width: 1200, withoutEnlargement: false }).grayscale().normalize(),
  ];

  let upiUri = null;
  for (const build of decodeAttempts) {
    try {
      const { data, info } = await build(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
      const decoded = code?.data ? String(code.data).trim() : '';
      // Only accept a genuine UPI intent string. Reject rzp.io / http links and anything else.
      if (decoded.toLowerCase().startsWith('upi://')) {
        upiUri = decoded;
        break;
      }
    } catch (decodeErr) {
      logger.warn(`[CollectQR] jsQR decode attempt failed: ${decodeErr?.message}`);
    }
  }

  if (!upiUri) {
    logger.warn('[CollectQR] Could not decode a upi:// string from Razorpay QR poster');
    return null;
  }

  let qrDataUrl = null;
  try {
    qrDataUrl = await QRCode.toDataURL(upiUri, {
      margin: 2,
      width: 400,
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch (genErr) {
    logger.warn(`[CollectQR] QR regeneration failed: ${genErr?.message}`);
  }

  return {
    upiUri,
    qrDataUrl,
    rawBase64,
  };
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
      // Create a real Dynamic UPI QR via Razorpay QR Code API, then decode the
      // genuine upi:// intent out of its poster so scanning opens the UPI app
      // directly (no rzp.io web redirect). Retry the whole create+decode cycle a
      // couple of times to absorb transient image-fetch/decode failures, since a
      // failed decode is exactly what used to leak the poster link to the scanner.
      let rzQr = null;
      let cleanUpiUri = null;
      let qrDataUrl = null;
      let rawBase64 = null;

      for (let attempt = 1; attempt <= 2 && !cleanUpiUri; attempt++) {
        rzQr = await createRazorpayQrCode({
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
        logger.info(`[CollectQR] Razorpay QR created (attempt ${attempt}): id=${rzQr.id}, image=${directImage}`);

        if (directImage) {
          const decoded = await extractUpiUriAndGenerateQr(directImage);
          if (decoded) {
            cleanUpiUri = decoded.upiUri;
            qrDataUrl = decoded.qrDataUrl;
            rawBase64 = decoded.rawBase64;
          }
        }
      }

      // We MUST have the real upi:// string, otherwise scanning opens the rzp.io
      // web redirect instead of the UPI app. If decode failed, treat it as a
      // failure and let the outer catch fall back — never ship the poster link.
      if (!cleanUpiUri) {
        throw new Error('Could not decode UPI string from Razorpay QR poster');
      }

      qrData = {
        qrCodeId: rzQr.id,
        paymentLinkId: rzQr.id,
        // Scanner-facing fields carry ONLY the clean UPI intent — never the rzp.io poster link.
        shortUrl: cleanUpiUri,
        imageUrl: qrDataUrl || null,
        rawImageUrl: qrDataUrl || null,
        qrDataUrl: qrDataUrl || null,
        rawBase64: rawBase64 || null,
        upiUri: cleanUpiUri,
        status: rzQr.status || 'active',
        // We serve our own regenerated clean matrix, so this is not a poster image.
        isPoster: false,
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
    qrDataUrl: qrData.qrDataUrl || null,
    rawBase64: qrData.rawBase64 || null,
    upiUri: qrData.upiUri || null,
    qrCodeId: qrData.qrCodeId,
    amount: amountDue,
    isPoster: Boolean(qrData.isPoster),
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
  let payment = transaction?.payment || {};

  if (payment?.method === 'razorpay_qr') {
    const syncedPayment = await syncRazorpayQrPayment(order);
    if (syncedPayment) {
      payment = syncedPayment;
      transaction = await FoodTransaction.findOne({ orderId: order._id }).lean();
    }
  }

  const isPaid = ['paid', 'captured', 'authorized'].includes(String(payment?.status || '').toLowerCase());
  const latestHistory =
    (transaction?.history || []).sort((a, b) => (b.at || 0) - (a.at || 0))[0] ||
    null;

  return {
    isPaid,
    status: isPaid ? 'paid' : (payment?.status || 'pending'),
    payment: {
      ...payment,
      status: isPaid ? 'paid' : (payment?.status || 'pending'),
    },
    latestPaymentSnapshot: latestHistory,
    riderEarning: order.riderEarning ?? 0,
    platformProfit: order.platformProfit ?? 0,
    pricingTotal: transaction?.pricing?.total ?? 0,
    transactionStatus: transaction?.status ?? null,
  };
}
