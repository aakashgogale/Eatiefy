import { createClient } from 'redis';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

let redisClient = null;

/**
 * Creates a new Redis client instance based on configuration.
 * Reconnects automatically; never throws to the request path.
 * @returns {import('redis').RedisClientType|null}
 */
export const createRedisClient = () => {
    if (!config.redisUrl) {
        logger.warn('Redis URL not provided, Redis client will not be created.');
        return null;
    }

    const client = createClient({
        url: config.redisUrl,
        socket: {
            reconnectStrategy: (retries) => {
                const delay = Math.min(1000 * 2 ** retries, 15000);
                if (retries === 1 || retries % 10 === 0) {
                    logger.warn(`Redis reconnecting (attempt ${retries}) in ${delay}ms`);
                }
                return delay;
            },
        },
    });

    client.on('error', (err) => logger.error(`Redis Client Error: ${err.message}`));
    client.on('connect', () => logger.info('Redis connecting...'));
    client.on('ready', () => logger.info('Redis client ready'));
    client.on('end', () => logger.warn('Redis client disconnected'));

    return client;
};

/**
 * Connects to Redis if REDIS_ENABLED is true.
 * Failure is non-fatal — API continues without cache/queues.
 * @returns {Promise<import('redis').RedisClientType|null>}
 */
export const connectRedis = async () => {
    const isRedisEnabled = config.redisEnabled;

    if (!isRedisEnabled) {
        logger.info('Redis is disabled via REDIS_ENABLED flag.');
        return null;
    }

    try {
        if (!redisClient) {
            redisClient = createRedisClient();
        }

        if (!redisClient) return null;

        if (!redisClient.isOpen) {
            await redisClient.connect();
        }

        // Verify with ping so we don't pretend Redis is up when it isn't
        const pong = await redisClient.ping();
        if (String(pong).toUpperCase() !== 'PONG') {
            throw new Error(`Unexpected Redis PING response: ${pong}`);
        }

        logger.info('Successfully connected to Redis');
        return redisClient;
    } catch (error) {
        logger.error(`Failed to connect to Redis: ${error.message}`);
        logger.warn('API will continue without Redis (cache/queues degraded).');
        try {
            if (redisClient?.isOpen) await redisClient.quit();
        } catch {
            /* ignore */
        }
        redisClient = null;
        return null;
    }
};

/**
 * Returns the existing Redis client (may be null / not ready).
 * @returns {import('redis').RedisClientType|null}
 */
export const getRedisClient = () => {
    if (!redisClient) return null;
    if (redisClient.isReady === false) return null;
    return redisClient;
};

/**
 * Close Redis connection (e.g. graceful shutdown).
 * @returns {Promise<void>}
 */
export const closeRedis = async () => {
    if (redisClient) {
        try {
            if (redisClient.isOpen) await redisClient.quit();
        } catch (err) {
            logger.warn(`Redis quit error: ${err.message}`);
            try {
                await redisClient.disconnect();
            } catch {
                /* ignore */
            }
        }
        redisClient = null;
        logger.info('Redis connection closed');
    }
};
