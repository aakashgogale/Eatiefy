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
 * Resolve the real client IP behind Vite / nginx / Cloudflare / mobile gateways.
 */
export function getClientIp(req) {
    if (req.clientIp) return req.clientIp;

    const headerFirst = (value) => {
        if (!value) return null;
        const raw = Array.isArray(value) ? value[0] : String(value);
        const first = raw.split(',')[0]?.trim();
        return first || null;
    };

    // Prefer left-most X-Forwarded-For (original client). Nginx sets this.
    // CF-Connecting-IP only when Cloudflare is in front.
    const fromForwarded = headerFirst(req.headers['x-forwarded-for']);
    const fromCf = headerFirst(req.headers['cf-connecting-ip']);
    const fromRealIp = headerFirst(req.headers['x-real-ip']);
    const fromTrueClient = headerFirst(req.headers['true-client-ip']);

    // If Cloudflare is present, trust CF first; otherwise XFF / X-Real-IP from nginx.
    const picked =
        fromCf ||
        fromForwarded ||
        fromRealIp ||
        fromTrueClient ||
        (req.ip ? stripIpv6Mapped(req.ip) : null) ||
        stripIpv6Mapped(req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown');

    return stripIpv6Mapped(picked);
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
    const phone =
        req.body?.phone != null
            ? String(req.body.phone).replace(/\D/g, '').slice(-15)
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
