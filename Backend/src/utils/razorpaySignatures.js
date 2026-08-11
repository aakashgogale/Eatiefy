import crypto from 'crypto';
import { safeEqualString } from './cryptoSafeCompare.js';

/**
 * Verify Razorpay webhook HMAC-SHA256 over raw body.
 */
export function verifyRazorpayWebhookSignature(rawBody, signature, secret) {
    if (!rawBody || !signature || !secret) return false;
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return safeEqualString(expected, String(signature));
}

/**
 * Verify Razorpay payment checkout signature (orderId|paymentId).
 */
export function verifyRazorpayPaymentSignature(orderId, paymentId, signature, secret) {
    if (!secret || !signature || !orderId || !paymentId) return false;
    const expected = crypto
        .createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
    return safeEqualString(expected, String(signature));
}
