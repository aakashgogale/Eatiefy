import 'dotenv/config';
import { Worker } from 'bullmq';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { getBullMQConnection } from '../connection.js';
import { initSocketEmitter, closeSocketEmitter } from '../../config/socketEmitter.js';
import { PAYMENT_QUEUE } from '../queue.constants.js';
import { processPaymentJob } from '../processors/payment.processor.js';

const defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
};

const startPaymentWorker = () => {
    if (!config.bullmqEnabled) {
        logger.info('BullMQ is disabled. Payment worker not started.');
        return null;
    }
    const connection = getBullMQConnection();
    if (!connection) {
        logger.error('Payment worker: Redis connection unavailable. Exiting.');
        process.exit(1);
    }
    const worker = new Worker(PAYMENT_QUEUE, processPaymentJob, {
        connection,
        concurrency: 5,
        defaultJobOptions
    });
    worker.on('completed', (job) => logger.info(`Payment job ${job.id} completed`));
    worker.on('failed', (job, err) => logger.error(`Payment job ${job?.id} failed: ${err.message}`));
    worker.on('error', (err) => logger.error(`Payment worker error: ${err.message}`));
    logger.info('Payment worker started');
    return worker;
};

// Workers have no Socket.IO server of their own — attach the Redis emitter so
// realtime events raised inside jobs still reach connected clients.
await initSocketEmitter();

const worker = startPaymentWorker();
if (worker) {
    const shutdown = async () => {
        await worker.close();
        await closeSocketEmitter();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
