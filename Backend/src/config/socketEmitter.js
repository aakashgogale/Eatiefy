/**
 * Socket.IO emitter for processes that do NOT own a Socket.IO server.
 *
 * The API process (`server.js`) creates the real Socket.IO server, so it can emit
 * directly. BullMQ workers (`src/queues/workers/*.js`) are separate PM2 processes
 * with no HTTP server attached — `getIO()` returns null there and every
 * `io.to(room).emit(...)` in the order flow is silently dropped.
 *
 * This module gives those processes a Redis-backed emitter that publishes on the
 * same channel the Socket.IO Redis adapter subscribes to, so events emitted from a
 * worker reach clients connected to the API process.
 *
 * Requires REDIS_ENABLED=true + REDIS_URL, and the API must be running the Redis
 * adapter (see `initSocket` in ./socket.js). Without Redis there is no way to cross
 * the process boundary — we log once and degrade instead of throwing.
 */
import { config } from './env.js';
import { logger } from '../utils/logger.js';

let emitter = null;
let redisClient = null;
let initPromise = null;
let degradedWarningLogged = false;

/**
 * Creates the Redis-backed emitter. Safe to call more than once.
 * @returns {Promise<object|null>} emitter instance, or null when unavailable
 */
const createEmitter = async () => {
    if (!config.redisEnabled || !config.redisUrl) {
        logger.warn(
            'Socket emitter unavailable: REDIS_ENABLED/REDIS_URL not set. ' +
            'Realtime events raised outside the API process will not reach clients.'
        );
        return null;
    }

    try {
        const { Emitter } = await import('@socket.io/redis-emitter');
        const { createClient } = await import('redis');

        redisClient = createClient({
            url: config.redisUrl,
            socket: {
                connectTimeout: 5000,
                reconnectStrategy: (retries) => Math.min(retries * 200, 2000),
            },
        });

        redisClient.on('error', (err) => logger.error(`Socket emitter Redis client: ${err.message}`));

        await redisClient.connect();
        emitter = new Emitter(redisClient);
        logger.info('Socket.IO Redis emitter ready (cross-process realtime enabled)');
        return emitter;
    } catch (err) {
        logger.error(`Socket.IO Redis emitter init failed: ${err.message}`);
        try {
            if (redisClient) {
                redisClient.removeAllListeners('error');
                redisClient.disconnect().catch(() => {});
            }
        } catch (_) {}
        redisClient = null;
        emitter = null;
        return null;
    }
};

/**
 * Initializes the emitter. Call once during worker bootstrap.
 * @returns {Promise<object|null>}
 */
export const initSocketEmitter = async () => {
    if (emitter) return emitter;
    if (!initPromise) initPromise = createEmitter();
    return initPromise;
};

/**
 * Synchronous accessor used by `getIO()` as a fallback.
 * Returns null until `initSocketEmitter()` has resolved.
 * @returns {object|null}
 */
export const getSocketEmitter = () => emitter;

/**
 * Logs the "no realtime transport" warning at most once per process.
 */
export const warnEmitterDegradedOnce = () => {
    if (degradedWarningLogged) return;
    degradedWarningLogged = true;
    logger.warn(
        'No Socket.IO transport in this process (no server, no Redis emitter). ' +
        'Realtime events are being dropped — enable REDIS_ENABLED + REDIS_URL.'
    );
};

/**
 * Closes the emitter's Redis connection during graceful shutdown.
 */
export const closeSocketEmitter = async () => {
    try {
        if (redisClient) {
            await redisClient.quit();
        }
    } catch (err) {
        logger.error(`Socket emitter shutdown error: ${err.message}`);
    } finally {
        redisClient = null;
        emitter = null;
        initPromise = null;
    }
};
