import crypto from 'crypto';

/**
 * Constant-time string comparison for HMAC / signature verification.
 * Returns false if either side is missing or lengths differ.
 */
export function safeEqualString(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}
