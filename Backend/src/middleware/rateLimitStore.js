import { getRedisClient } from '../config/redis.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Redis-backed store for express-rate-limit (shared across app instances).
 * Production: Redis REQUIRED — no silent memory fallback.
 * Development: memory fallback allowed when Redis is down.
 */
export class RedisRateLimitStore {
    constructor({ prefix = 'rl' } = {}) {
        this.prefix = prefix;
        this.windowMs = 15 * 60 * 1000;
        this.localFallback = new Map();
    }

    init(options) {
        this.windowMs = options.windowMs;
    }

    redisKey(key) {
        return `${this.prefix}:${key}`;
    }

    getRedis() {
        if (!config.redisEnabled) return null;
        const client = getRedisClient();
        return client?.isReady ? client : null;
    }

    async increment(key) {
        const redis = this.getRedis();
        const resetTime = new Date(Date.now() + this.windowMs);

        if (!redis) {
            if (config.nodeEnv === 'production') {
                logger.error('Rate limit Redis unavailable in production');
                // Fail closed: treat as over-limit so we do not silently open the floodgates
                const err = new Error('Rate limit store unavailable');
                err.code = 'RATE_LIMIT_STORE_UNAVAILABLE';
                throw err;
            }
            return this.incrementLocal(key, resetTime);
        }

        try {
            const fullKey = this.redisKey(key);
            const totalHits = await redis.incr(fullKey);
            if (totalHits === 1) {
                await redis.pExpire(fullKey, this.windowMs);
            }
            const ttlMs = await redis.pTTL(fullKey);
            const effectiveReset = ttlMs > 0
                ? new Date(Date.now() + ttlMs)
                : resetTime;
            return { totalHits, resetTime: effectiveReset };
        } catch (error) {
            if (config.nodeEnv === 'production') {
                logger.error(`Rate limit Redis increment failed in production: ${error.message}`);
                throw error;
            }
            logger.warn(`Rate limit Redis increment failed, using memory fallback: ${error.message}`);
            return this.incrementLocal(key, resetTime);
        }
    }

    incrementLocal(key, resetTime) {
        const now = Date.now();
        const entry = this.localFallback.get(key);
        if (!entry || entry.resetTime.getTime() <= now) {
            const fresh = { totalHits: 1, resetTime };
            this.localFallback.set(key, fresh);
            return fresh;
        }
        entry.totalHits += 1;
        return entry;
    }

    async decrement(key) {
        const redis = this.getRedis();
        if (!redis) {
            if (config.nodeEnv === 'production') return;
            const entry = this.localFallback.get(key);
            if (entry && entry.totalHits > 0) entry.totalHits -= 1;
            return;
        }
        try {
            const current = await redis.decr(this.redisKey(key));
            if (current < 0) {
                await redis.set(this.redisKey(key), '0', { PX: this.windowMs });
            }
        } catch (error) {
            logger.warn(`Rate limit Redis decrement failed: ${error.message}`);
        }
    }

    async resetKey(key) {
        const redis = this.getRedis();
        this.localFallback.delete(key);
        if (!redis) return;
        try {
            await redis.del(this.redisKey(key));
        } catch (error) {
            logger.warn(`Rate limit Redis reset failed: ${error.message}`);
        }
    }
}
