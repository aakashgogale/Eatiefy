/**
 * Shared helpers for BullMQ worker processes.
 * Goal: never crash-loop PM2 if Redis is briefly down — wait, then exit cleanly for restart.
 */
import mongoose from 'mongoose';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { connectDB, disconnectDB } from '../../config/db.js';
import { getBullMQConnection, pingBullMQRedis } from '../connection.js';

const WAIT_MS = 3000;
const MAX_WAIT_ATTEMPTS = 20; // ~60s then exit 0 for PM2 restart

/**
 * @returns {Promise<import('ioredis').default | null>}
 */
export async function waitForBullMQRedis() {
    if (!config.bullmqEnabled) {
        logger.info('BullMQ is disabled. Worker not started.');
        return null;
    }
    if (!config.redisEnabled) {
        logger.warn('Worker: REDIS_ENABLED is not true. Worker not started.');
        return null;
    }

    for (let attempt = 1; attempt <= MAX_WAIT_ATTEMPTS; attempt++) {
        const connection = getBullMQConnection();
        if (!connection) {
            logger.warn('Worker: Redis connection object unavailable.');
            return null;
        }
        const ok = await pingBullMQRedis();
        if (ok) return connection;

        logger.warn(
            `Worker: waiting for Redis… (${attempt}/${MAX_WAIT_ATTEMPTS})`,
        );
        await new Promise((r) => setTimeout(r, WAIT_MS));
    }

    logger.error(
        'Worker: Redis still unavailable after wait. Exiting cleanly for PM2 restart.',
    );
    return null;
}

/**
 * Connects the worker process to MongoDB.
 *
 * Workers only ever waited for Redis. Any job that touched the database then
 * had no connection to use, so Mongoose buffered the query and gave up — which
 * is exactly the "Operation `food_orders.findOne()` buffering timed out after
 * 10000ms" failure seen in production.
 *
 * Only call this from workers whose processor actually reads/writes the DB, so
 * idle workers do not hold Atlas connections for nothing.
 *
 * @returns {Promise<boolean>} true when the connection is usable.
 */
export async function connectWorkerMongo(label = 'worker') {
    // Already connected (e.g. a retry after a Redis reconnect).
    if (mongoose.connection.readyState === 1) return true;

    try {
        // Reuses the API server's retry + SRV-resolution handling. A small pool
        // keeps several workers well inside the cluster's connection limit.
        await connectDB({ maxPoolSize: 5 });
        const ok = mongoose.connection.readyState === 1;
        if (ok) logger.info(`${label}: MongoDB connected`);
        else logger.error(`${label}: MongoDB not ready after connect`);
        return ok;
    } catch (err) {
        logger.error(`${label}: MongoDB connection failed: ${err.message}`);
        return false;
    }
}

export function attachWorkerLifecycle(worker, label = 'worker') {
    if (!worker) return;

    worker.on('completed', (job) =>
        logger.info(`${label} job ${job.id} completed`),
    );
    worker.on('failed', (job, err) =>
        logger.error(`${label} job ${job?.id} failed: ${err.message}`),
    );
    worker.on('error', (err) =>
        logger.error(`${label} error: ${err.message}`),
    );

    const shutdown = async () => {
        try {
            await worker.close();
        } catch (err) {
            logger.warn(`${label} close error: ${err.message}`);
        }
        // Release the DB connection too, so a restart does not leave a socket
        // lingering against the connection limit.
        if (mongoose.connection.readyState === 1) {
            try {
                await disconnectDB();
            } catch (err) {
                logger.warn(`${label} db close error: ${err.message}`);
            }
        }
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
