import 'dotenv/config';
import { Worker } from 'bullmq';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { connectDB, disconnectDB } from '../../config/db.js';
import { connectRedis, closeRedis } from '../../config/redis.js';
import { getBullMQConnection, closeBullMQConnection } from '../connection.js';
import { TRACKING_QUEUE } from '../queue.constants.js';
import { processTrackingJob } from '../processors/tracking.processor.js';

const defaultJobOptions = {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
};

const startTrackingWorker = async () => {
    if (!config.bullmqEnabled) {
        logger.info('BullMQ is disabled. Tracking worker not started.');
        return null;
    }

    await connectDB();
    // Shared node-redis client used by tracking.processor hot→cold sync
    if (config.redisEnabled) {
        await connectRedis();
    } else {
        logger.error('Tracking worker requires Redis');
        process.exit(1);
    }

    const connection = getBullMQConnection();
    if (!connection) {
        logger.error('Tracking worker: BullMQ Redis connection unavailable. Exiting.');
        process.exit(1);
    }

    const worker = new Worker(TRACKING_QUEUE, processTrackingJob, {
        connection,
        concurrency: 10,
        defaultJobOptions,
    });

    worker.on('completed', (job) => logger.debug?.(`Tracking job ${job.id} completed`) || null);
    worker.on('failed', (job, err) => {
        logger.error(`Tracking job ${job?.id} failed (attempts=${job?.attemptsMade}): ${err.message}`);
        if (job && job.attemptsMade >= (job.opts?.attempts || defaultJobOptions.attempts)) {
            logger.error(`Tracking job ${job.id} moved to failed retention (DLQ-equivalent)`);
        }
    });
    worker.on('error', (err) => logger.error(`Tracking worker error: ${err.message}`));

    logger.info('Tracking worker started (Redis + Mongo connected)');
    return worker;
};

const worker = await startTrackingWorker();
if (worker) {
    const shutdown = async () => {
        logger.info('Graceful shutdown: closing tracking worker');
        await worker.close();
        await closeBullMQConnection();
        await closeRedis();
        await disconnectDB();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
