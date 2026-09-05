import 'dotenv/config';
import { Worker } from 'bullmq';
import { logger } from '../../utils/logger.js';
import { TRACKING_QUEUE } from '../queue.constants.js';
import { processTrackingJob } from '../processors/tracking.processor.js';
import { waitForBullMQRedis, attachWorkerLifecycle } from './workerBootstrap.js';

const start = async () => {
    const connection = await waitForBullMQRedis();
    if (!connection) {
        process.exit(0);
        return;
    }

    const worker = new Worker(TRACKING_QUEUE, processTrackingJob, {
        connection,
        concurrency: 10,
    });
    attachWorkerLifecycle(worker, 'Tracking');
    logger.info('Tracking worker started (Scalable Real-time Persistence)');
};

start().catch((err) => {
    logger.error(`Tracking worker failed to start: ${err.message}`);
    process.exit(0);
});
