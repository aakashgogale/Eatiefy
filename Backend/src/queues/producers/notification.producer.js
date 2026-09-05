import { getNotificationQueue, ensureQueuesInitialized } from '../index.js';
import { logger } from '../../utils/logger.js';

let lastUnavailableLogAt = 0;
const COOLDOWN_MS = 60_000;

/**
 * Add a notification job to the queue. No-op if BullMQ is disabled / Redis down.
 * Never throws — request path must not break.
 */
export const addNotificationJob = async (data, options = {}) => {
    try {
        await ensureQueuesInitialized();
        const queue = getNotificationQueue();
        if (!queue) {
            const now = Date.now();
            if (now - lastUnavailableLogAt > COOLDOWN_MS) {
                lastUnavailableLogAt = now;
                logger.warn('BullMQ notification queue not available. Job not added.');
            }
            return null;
        }
        const job = await queue.add('send-notification', data, options);
        logger.info(`Notification job added: ${job.id}`);
        return job;
    } catch (err) {
        logger.warn(`Failed to add notification job (non-fatal): ${err.message}`);
        return null;
    }
};
