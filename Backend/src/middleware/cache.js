import { getRedisClient } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';

const normalizeQueryEntries = (query = {}) => {
    const entries = [];

    for (const key of Object.keys(query).sort()) {
        const value = query[key];

        if (Array.isArray(value)) {
            for (const item of [...value].map((entry) => String(entry)).sort()) {
                entries.push([key, item]);
            }
            continue;
        }

        if (value && typeof value === 'object') {
            entries.push([key, JSON.stringify(value)]);
            continue;
        }

        if (value !== undefined) {
            entries.push([key, String(value)]);
        }
    }

    return entries;
};

const buildCacheKey = (req, prefix, varyByUser = false) => {
    const basePath = `${req.baseUrl || ''}${req.path || ''}`;
    const params = new URLSearchParams(normalizeQueryEntries(req.query));
    const queryString = params.toString();
    const userScope = varyByUser ? `:user:${req.user?.userId || 'guest'}` : '';
    const pathWithQuery = queryString ? `${basePath}?${queryString}` : basePath;

    return `${prefix}:${req.method}:${pathWithQuery}${userScope}`;
};

/**
 * Higher-order function to create a caching middleware.
 * @param {number} ttlInSeconds - Time to live for the cache in seconds.
 * @param {string} prefix - Optional key prefix for Redis (e.g. 'restaurants').
 * @param {{ varyByUser?: boolean, browserTtlSeconds?: number }} options
 * @returns {import('express').RequestHandler}
 */
export const cacheResponse = (ttlInSeconds = 300, prefix = 'api_cache', options = {}) => {
    const varyByUser = options?.varyByUser === true;
    const browserTtlSeconds = Number(options?.browserTtlSeconds || 0);

    return async (req, res, next) => {
        if (!config.redisEnabled || req.method !== 'GET') return next();

        const redis = getRedisClient();
        if (!redis || !redis.isReady) return next();

        const key = buildCacheKey(req, prefix, varyByUser);

        const applyHeaders = () => {
            if (browserTtlSeconds > 0) {
                const staleWhileRevalidate = Math.min(browserTtlSeconds * 2, 86400);
                res.setHeader('Cache-Control', `public, max-age=${browserTtlSeconds}, stale-while-revalidate=${staleWhileRevalidate}`);
            }
        };

        try {
            const cachedData = await redis.get(key);
            if (cachedData) {
                res.setHeader('X-Cache', 'HIT');
                applyHeaders();
                return res.json(JSON.parse(cachedData));
            }

            const originalJson = res.json.bind(res);
            res.json = (body) => {
                if (res.statusCode < 400) {
                    redis.set(key, JSON.stringify(body), { EX: ttlInSeconds })
                        .catch((err) => logger.error(`Redis caching failed for ${key}: ${err.message}`));
                }
                res.setHeader('X-Cache', 'MISS');
                applyHeaders();
                return originalJson(body);
            };

            next();
        } catch (err) {
            logger.warn(`Cache middleware error: ${err.message}`);
            next();
        }
    };
};

/**
 * Clear every cached list a menu change can appear in.
 *
 * Keys are built as `<prefix>:GET:<path>?<query>`, so a bare `restaurant_menu:<id>`
 * pattern matches nothing — the id sits in the middle of the path. `public_foods`
 * and `search_unified` are cross-restaurant lists, so one new item invalidates all
 * of their variants (zone, category, promo).
 *
 * @param {string} [restaurantId] - Narrows the menu cache; omit to clear every menu.
 */
export const invalidateMenuCaches = async (restaurantId) => {
    const id = String(restaurantId || '').trim();
    await Promise.all([
        invalidateCache(id ? `restaurant_menu:*${id}*` : 'restaurant_menu:*'),
        invalidateCache('public_foods:*'),
        invalidateCache('search_unified:*'),
    ]);
};

/**
 * Clear cache by pattern using SCAN so Redis is not blocked by KEYS on larger datasets.
 * @param {string} pattern - Redis glob pattern for keys to delete.
 */
export const invalidateCache = async (pattern) => {
    if (!config.redisEnabled) return;
    const redis = getRedisClient();
    if (!redis || !redis.isReady) return;

    try {
        const keys = [];
        for await (const key of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
            keys.push(key);
        }

        if (keys.length > 0) {
            const batchSize = 200;
            for (let i = 0; i < keys.length; i += batchSize) {
                const chunk = keys.slice(i, i + batchSize);
                await redis.del(chunk);
            }
            logger.info(`Invalidated ${keys.length} cache keys matching: ${pattern}`);
        }
    } catch (err) {
        logger.error(`Cache invalidation error: ${err.message}`);
    }
};
