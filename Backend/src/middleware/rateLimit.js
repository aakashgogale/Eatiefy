import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';
import { verifyAccessToken } from '../core/auth/token.util.js';
import { logger } from '../utils/logger.js';

const privateWindowMs = config.rateLimitWindowMinutes * 60 * 1000;
const authWindowMs = config.authRateLimitWindowMinutes * 60 * 1000;

const privateMax =
    config.nodeEnv === 'development'
        ? config.rateLimitDevMaxRequests
        : config.rateLimitMaxRequests;

/**
 * Resolve the real client IP.
 *
 * req.ip already walks X-Forwarded-For only as far as TRUST_PROXY allows, so it
 * is the address the nearest trusted proxy saw. The left-most X-Forwarded-For
 * entry, X-Real-IP and friends are whatever the client chose to send when they
 * reach us through nginx, so keying the limiter on them let anyone reset their
 * budget per request (e.g. unlimited admin-login guesses). CF-Connecting-IP is
 * only honoured when TRUST_CF_CONNECTING_IP=true, i.e. the origin is reachable
 * through Cloudflare alone.
 */
const trustCfConnectingIp = /^(true|1|yes|on)$/i.test(String(process.env.TRUST_CF_CONNECTING_IP || '').trim());

export function getClientIp(req) {
    if (req.clientIp) return req.clientIp;

    if (trustCfConnectingIp) {
        const raw = req.headers['cf-connecting-ip'];
        const fromCf = String(Array.isArray(raw) ? raw[0] : raw || '').split(',')[0].trim();
        if (fromCf) return stripIpv6Mapped(fromCf);
    }

    return stripIpv6Mapped(
        req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown'
    );
}

function stripIpv6Mapped(ip) {
    const s = String(ip || '').trim();
    if (!s) return 'unknown';
    if (s.startsWith('::ffff:')) return s.slice(7);
    return s;
}

function normalizePath(req) {
    const raw = String(req.originalUrl || req.url || '').split('?')[0];
    return raw.replace(/\/+$/, '') || '/';
}

/**
 * High-frequency authenticated polls — do not burn the private budget.
 */
function isHighFrequencyPrivatePoll(req) {
    const path = normalizePath(req);
    return (
        /\/food\/delivery\/orders\/(available|current)(?:\/|$)/.test(path) ||
        /\/food\/delivery\/orders\/[^/]+\/payment-status(?:\/|$)/.test(path) ||
        /\/food\/restaurant\/orders(?:\/|$)/.test(path) ||
        /\/food\/auth\/me$/.test(path) ||
        /\/auth\/me$/.test(path)
    );
}

/**
 * Admin panel read traffic (orders list, reports, etc.) is low-volume and
 * latency-sensitive. Exempt authenticated admin GETs from the generic private
 * budget so polling + socket refreshes do not blank the UI. Writes still count.
 */
function isAdminAuthenticatedRead(req) {
    if (String(req.method || 'GET').toUpperCase() !== 'GET') return false;
    const path = normalizePath(req);
    return /\/food\/admin(?:\/|$)/.test(path);
}

/**
 * Public / unauthenticated catalog & CMS routes — no rate limiting.
 */
export function isPublicApiPath(req) {
    const path = normalizePath(req);

    if (path === '/api/v1/health' || path === '/api/health') return true;

    if (
        path.includes('/public') ||
        /\/pages\/[^/]+$/.test(path) ||
        path.endsWith('/referral-settings') ||
        path.includes('/zones/detect') ||
        path.includes('/zones/nearby') ||
        path.includes('/zones/public') ||
        path.includes('/geocode/') ||
        path.includes('/payments/webhook') ||
        path.includes('/webhook/razorpay')
    ) {
        return true;
    }

    if (
        /\/food\/restaurant\/restaurants(\/|$)/.test(path) ||
        /\/food\/restaurant\/under-250$/.test(path) ||
        /\/food\/restaurant\/offers$/.test(path) ||
        /\/food\/restaurant\/categories\/public$/.test(path) ||
        /\/food\/dining\/(categories|restaurants)\/public$/.test(path) ||
        /\/food\/search\/unified$/.test(path) ||
        /\/food\/explore-icons\/public$/.test(path)
    ) {
        return true;
    }

    if (
        path.endsWith('/food/delivery/register') ||
        path.endsWith('/food/restaurant/register')
    ) {
        return true;
    }

    return false;
}

/**
 * Strict auth credential endpoints — handled by `authRateLimiter` only.
 * refresh-token is NOT here (mobile apps refresh often; uses private limiter).
 */
export function isAuthCredentialPath(req) {
    const path = normalizePath(req);
    if (!path.includes('/auth/')) return false;

    return (
        /\/request-otp$/.test(path) ||
        /\/verify-otp$/.test(path) ||
        /\/admin\/login$/.test(path) ||
        /\/forgot-password\//.test(path) ||
        /\/restaurant\/reapply$/.test(path)
    );
}

function getRateLimitUserId(req) {
    if (req.user?.userId) return String(req.user.userId);

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return null;

    try {
        const decoded = verifyAccessToken(token);
        return decoded?.userId ? String(decoded.userId) : null;
    } catch {
        return null;
    }
}

function buildPrivateKey(req) {
    const ip = getClientIp(req);
    const userId = getRateLimitUserId(req);
    // Logged-in: per-user (IP alone would block whole CGNAT / shared Wi‑Fi).
    // Anonymous private calls: per real IP.
    return userId ? `private:user:${userId}` : `private:ip:${ip}`;
}

function buildAuthKey(req) {
    const ip = getClientIp(req);
    // Last 10 digits, the same normalisation the OTP store uses: otherwise
    // "9876543210", "919876543210", "0919876543210"... each got a fresh budget
    // against the one OTP record they all resolve to.
    const phone =
        req.body?.phone != null
            ? String(req.body.phone).replace(/\D/g, '').slice(-10)
            : '';
    // Prefer phone so same number isn't blocked by shared IP; keep IP for no-body calls.
    return phone ? `auth:phone:${phone}` : `auth:ip:${ip}`;
}

const rateLimitJson = (message) => ({
    success: false,
    message,
});

function onLimitReached(req, kind, key) {
    logger.warn(
        `[RATE_LIMIT] ${kind} exceeded key=${key} ip=${getClientIp(req)} path=${normalizePath(req)} ua=${String(req.headers['user-agent'] || '').slice(0, 80)}`,
    );
}

/** Private / authenticated API budget. */
export const privateRateLimiter = rateLimit({
    windowMs: privateWindowMs,
    max: privateMax,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, default: true },
    keyGenerator: (req) => buildPrivateKey(req),
    handler: (req, res, _next, options) => {
        onLimitReached(req, 'private', buildPrivateKey(req));
        res.status(options.statusCode).json(options.message);
    },
    message: rateLimitJson('Too many requests, please try again later.'),
    skip: (req) =>
        !config.rateLimitEnabled ||
        isHighFrequencyPrivatePoll(req) ||
        isAdminAuthenticatedRead(req),
});

/** Auth OTP / login budget — phone-first (not shared Wi‑Fi IP). */
export const authRateLimiter = rateLimit({
    windowMs: authWindowMs,
    max: config.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false, default: true },
    keyGenerator: (req) => buildAuthKey(req),
    handler: (req, res, _next, options) => {
        onLimitReached(req, 'auth', buildAuthKey(req));
        res.status(options.statusCode).json(options.message);
    },
    message: rateLimitJson('Too many authentication attempts. Please try again later.'),
    skip: () => !config.rateLimitEnabled,
});

/**
 * Mount on `/api`:
 * 1) public → no limit
 * 2) auth OTP/login → skip (route-level authRateLimiter)
 * 3) private → per-user (or per-IP if anonymous)
 */
export function apiRateLimitMiddleware(req, res, next) {
    if (!config.rateLimitEnabled) return next();
    if (isPublicApiPath(req)) return next();
    if (isAuthCredentialPath(req)) return next();
    if (isHighFrequencyPrivatePoll(req)) return next();
    if (isAdminAuthenticatedRead(req)) return next();
    return privateRateLimiter(req, res, next);
}

/** @deprecated Use apiRateLimitMiddleware */
export const apiRateLimiter = apiRateLimitMiddleware;
