import 'dotenv/config';
import { Worker } from 'bullmq';
import { logger } from '../../utils/logger.js';
import { ORDER_QUEUE } from '../queue.constants.js';
import { processOrderJob } from '../processors/order.processor.js';
import { waitForBullMQRedis, attachWorkerLifecycle, connectWorkerMongo } from './workerBootstrap.js';

const start = async () => {
    const connection = await waitForBullMQRedis();
    if (!connection) {
        process.exit(0);
        return;
    }

    // This worker's jobs read/write MongoDB. Without a connection Mongoose just
    // buffers every query and times out after 10s, so connect before consuming.
    const dbReady = await connectWorkerMongo('Order worker');
    if (!dbReady) {
        process.exit(0);
        return;
    }

    const worker = new Worker(ORDER_QUEUE, processOrderJob, {
        connection,
        concurrency: 5,
    });
    attachWorkerLifecycle(worker, 'Order');
    logger.info('Order worker started');
};

start().catch((err) => {
    logger.error(`Order worker failed to start: ${err.message}`);
    process.exit(0);
});
