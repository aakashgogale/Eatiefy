import IORedis from 'ioredis';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const DEFAULT_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;

/**
 * BullMQ requires ioredis with maxRetriesPerRequest: null.
 * Uses REDIS_URL from environment. Does not interfere with existing Redis (config/redis.js).
 */
const getRetryStrategy = () => (times) => {
    const delay = Math.min(DEFAULT_RETRY_DELAY_MS * Math.pow(2, times), MAX_RETRY_DELAY_MS);
    if (times === 1 || times % 10 === 0) {
        logger.warn(`BullMQ Redis reconnecting in ${delay}ms (attempt ${times})`);
    }
    return delay;
};

let connection = null;
let connectionReady = false;

/**
 * Creates and returns a BullMQ-compatible Redis connection.
 * Caller should check BULLMQ_ENABLED and redisUrl before using.
 * @returns {IORedis | null}
 */
export const getBullMQConnection = () => {
    if (!config.redisEnabled) {
        return null;
    }

    if (!config.redisUrl) {
        logger.warn('BullMQ: REDIS_URL not set, queue connection skipped.');
        return null;
    }

    if (connection) {
        return connection;
    }

    connection = new IORedis(config.redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        // Keep commands queued briefly while reconnecting — avoid hard fails on blips
        enableOfflineQueue: true,
        retryStrategy: getRetryStrategy(),
    });

    connection.on('error', (err) => {
        connectionReady = false;
        logger.error(`BullMQ Redis connection error: ${err.message}`);
    });

    connection.on('ready', () => {
        connectionReady = true;
        logger.info('BullMQ Redis connection established');
    });

    connection.on('connect', () => {
        logger.info('BullMQ Redis connecting...');
    });

    connection.on('close', () => {
        connectionReady = false;
        logger.warn('BullMQ Redis connection closed');
    });

    return connection;
};

/**
 * True when BullMQ Redis has reported ready at least once and is not closed.
 */
export const isBullMQConnectionReady = () => Boolean(connection && connectionReady);

/**
 * Ping Redis to confirm BullMQ connection is usable.
 * @returns {Promise<boolean>}
 */
export const pingBullMQRedis = async () => {
    const conn = getBullMQConnection();
    if (!conn) return false;
    try {
        const result = await conn.ping();
        connectionReady = String(result).toUpperCase() === 'PONG';
        return connectionReady;
    } catch (err) {
        connectionReady = false;
        logger.warn(`BullMQ Redis ping failed: ${err.message}`);
        return false;
    }
};

/**
 * Close the BullMQ Redis connection (e.g. on graceful shutdown).
 * @returns {Promise<void>}
 */
export const closeBullMQConnection = async () => {
    if (connection) {
        try {
            await connection.quit();
        } catch (err) {
            logger.warn(`BullMQ Redis quit error: ${err.message}`);
            try {
                connection.disconnect();
            } catch {
                /* ignore */
            }
        }
        connection = null;
        connectionReady = false;
        logger.info('BullMQ Redis connection closed');
    }
};
