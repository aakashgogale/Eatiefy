import { getOrderQueue, ensureQueuesInitialized } from '../index.js';
import { logger } from '../../utils/logger.js';

let lastUnavailableLogAt = 0;
const UNAVAILABLE_LOG_COOLDOWN_MS = 60_000;

/**
 * Add an order processing job to the queue. No-op if BullMQ is disabled / Redis down.
 * Never throws to callers — order API flow must not break.
 * @param {object} data - Job data (e.g. { orderId, action })
 * @param {object} [options] - BullMQ job options override
 * @returns {Promise<import('bullmq').Job | null>}
 */
export const addOrderJob = async (data, options = {}) => {
    try {
        await ensureQueuesInitialized();
        const queue = getOrderQueue();
        if (!queue) {
            const now = Date.now();
            if (now - lastUnavailableLogAt > UNAVAILABLE_LOG_COOLDOWN_MS) {
                lastUnavailableLogAt = now;
                logger.warn('BullMQ order queue not available. Job not added (will retry when Redis is up).');
            }
            return null;
        }
        const job = await queue.add('process-order', data, options);
        logger.info(`Order job added: ${job.id}`);
        return job;
    } catch (err) {
        logger.warn(`Failed to add order job (non-fatal): ${err.message}`);
        return null;
    }
};
