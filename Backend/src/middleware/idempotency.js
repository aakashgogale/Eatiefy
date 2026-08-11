import { getRedisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';

const MEMORY_STORE = new Map();
const DEFAULT_TTL_SEC = 24 * 60 * 60;
const MAX_MEMORY_ENTRIES = 5000;

function memoryGet(key) {
    const entry = MEMORY_STORE.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        MEMORY_STORE.delete(key);
        return null;
    }
    return entry.value;
}

function memorySet(key, value, ttlSec) {
    if (MEMORY_STORE.size >= MAX_MEMORY_ENTRIES) {
        const firstKey = MEMORY_STORE.keys().next().value;
        if (firstKey) MEMORY_STORE.delete(firstKey);
    }
    MEMORY_STORE.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}

/**
 * Idempotency-Key middleware for mutating endpoints (order create, payment, etc.).
 * Uses Redis when available; falls back to process-local memory (not shared across instances).
 *
 * Clients must send: Idempotency-Key: <opaque unique string>
 * Scope is bound to authenticated user + method + path.
 */
export function idempotencyMiddleware({ ttlSeconds = DEFAULT_TTL_SEC, required = false } = {}) {
    return async (req, res, next) => {
        const keyHeader = req.get('Idempotency-Key') || req.get('idempotency-key');
        if (!keyHeader || !String(keyHeader).trim()) {
            if (required) {
                return res.status(400).json({
                    success: false,
                    message: 'Idempotency-Key header is required',
                });
            }
            return next();
        }

        const userId = req.user?.userId || 'anon';
        const scope = `${req.method}:${req.baseUrl}${req.path}`;
        const cacheKey = `idempotency:${userId}:${scope}:${String(keyHeader).trim()}`;

        try {
            const redis = getRedisClient();
            if (redis) {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    const parsed = JSON.parse(cached);
                    res.setHeader('Idempotency-Replayed', 'true');
                    return res.status(parsed.status || 200).json(parsed.body);
                }
            } else {
                const cached = memoryGet(cacheKey);
                if (cached) {
                    res.setHeader('Idempotency-Replayed', 'true');
                    return res.status(cached.status || 200).json(cached.body);
                }
            }
        } catch (err) {
            logger.warn(`Idempotency lookup failed (continuing): ${err.message}`);
        }

        const originalJson = res.json.bind(res);
        res.json = (body) => {
            const status = res.statusCode || 200;
            if (status >= 200 && status < 300) {
                const payload = JSON.stringify({ status, body });
                const redis = getRedisClient();
                if (redis) {
                    redis.set(cacheKey, payload, { EX: ttlSeconds }).catch((err) => {
                        logger.warn(`Idempotency store failed: ${err.message}`);
                    });
                } else {
                    memorySet(cacheKey, { status, body }, ttlSeconds);
                }
            }
            return originalJson(body);
        };

        return next();
    };
}
