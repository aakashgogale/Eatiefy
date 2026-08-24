import { getRedisClient } from '../config/redis.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const DEFAULT_TTL_SEC = 24 * 60 * 60;
const LOCK_TTL_SEC = 120;
const LOCK_WAIT_MS = 50;
const LOCK_WAIT_ATTEMPTS = 40;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Distributed idempotency for mutating APIs.
 *
 * Uses Redis when enabled and connected (providing distributed deduplication across cluster instances).
 * Gracefully falls back to process in-memory store if Redis is disabled or temporarily offline,
 * ensuring high availability and zero order placement disruption in production.
 *
 * Flow:
 * 1. Require Idempotency-Key when required=true (e.g. for POST /orders)
 * 2. Return cached response if present
 * 3. Acquire lock so concurrent identical keys execute once
 * 4. Store successful response under the key
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
        const lockKey = `${cacheKey}:lock`;

        const redis = config.redisEnabled ? getRedisClient() : null;
        const redisReady = Boolean(redis?.isReady);

        const getCached = async () => {
            if (redisReady) {
                try {
                    const cached = await redis.get(cacheKey);
                    if (cached) return JSON.parse(cached);
                } catch (err) {
                    logger.warn(`Idempotency Redis get error: ${err.message}`);
                }
            }
            return memoryGet(cacheKey);
        };

        const setCached = async (payload) => {
            if (redisReady) {
                try {
                    await redis.set(cacheKey, JSON.stringify(payload), { EX: ttlSeconds });
                    return;
                } catch (err) {
                    logger.warn(`Idempotency Redis set error: ${err.message}`);
                }
            }
            memorySet(cacheKey, payload, ttlSeconds);
        };

        const acquireLock = async () => {
            if (redisReady) {
                try {
                    const ok = await redis.set(lockKey, '1', { NX: true, EX: LOCK_TTL_SEC });
                    return Boolean(ok);
                } catch (err) {
                    logger.warn(`Idempotency Redis acquireLock error: ${err.message}`);
                }
            }
            if (memoryGet(lockKey)) return false;
            memorySet(lockKey, { locked: true }, LOCK_TTL_SEC);
            return true;
        };

        const releaseLock = async () => {
            if (redisReady) {
                try {
                    await redis.del(lockKey);
                } catch {}
            }
            MEMORY_STORE.delete(lockKey);
        };

        try {
            const existing = await getCached();
            if (existing) {
                res.setHeader('Idempotency-Replayed', 'true');
                return res.status(existing.status || 200).json(existing.body);
            }

            let locked = await acquireLock();
            if (!locked) {
                for (let i = 0; i < LOCK_WAIT_ATTEMPTS; i += 1) {
                    await sleep(LOCK_WAIT_MS);
                    const replay = await getCached();
                    if (replay) {
                        res.setHeader('Idempotency-Replayed', 'true');
                        return res.status(replay.status || 200).json(replay.body);
                    }
                    locked = await acquireLock();
                    if (locked) break;
                }
            }

            if (!locked) {
                return res.status(409).json({
                    success: false,
                    message: 'Request with this Idempotency-Key is already in progress',
                });
            }

            const originalJson = res.json.bind(res);
            let stored = false;
            res.json = (body) => {
                const status = res.statusCode || 200;
                if (status >= 200 && status < 300 && !stored) {
                    stored = true;
                    const payload = { status, body };
                    setCached(payload).catch((err) => {
                        logger.warn(`Idempotency store failed: ${err.message}`);
                    });
                }
                releaseLock().catch(() => {});
                return originalJson(body);
            };

            res.on('finish', () => {
                if (res.statusCode >= 400) {
                    releaseLock().catch(() => {});
                }
            });

            return next();
        } catch (err) {
            logger.warn(`Idempotency middleware error: ${err.message}`);
            return next();
        }
    };
}

const MEMORY_STORE = new Map();
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
