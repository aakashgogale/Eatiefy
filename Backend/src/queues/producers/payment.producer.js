import { getPaymentQueue, ensureQueuesInitialized } from '../index.js';
import { logger } from '../../utils/logger.js';

let lastUnavailableLogAt = 0;
const COOLDOWN_MS = 60_000;

/**
 * Add a payment processing job to the queue. No-op if BullMQ is disabled / Redis down.
 * Never throws — payment HTTP flow must not break.
 */
export const addPaymentJob = async (data, options = {}) => {
    try {
        await ensureQueuesInitialized();
        const queue = getPaymentQueue();
        if (!queue) {
            const now = Date.now();
            if (now - lastUnavailableLogAt > COOLDOWN_MS) {
                lastUnavailableLogAt = now;
                logger.warn('BullMQ payment queue not available. Job not added.');
            }
            return null;
        }
        const job = await queue.add('process-payment', data, options);
        logger.info(`Payment job added: ${job.id}`);
        return job;
    } catch (err) {
        logger.warn(`Failed to add payment job (non-fatal): ${err.message}`);
        return null;
    }
};
