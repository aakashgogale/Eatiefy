import { getOtpQueue, ensureQueuesInitialized } from '../index.js';
import { logger } from '../../utils/logger.js';

let lastUnavailableLogAt = 0;
const COOLDOWN_MS = 60_000;

/**
 * Add an OTP job to the queue. No-op if BullMQ is disabled / Redis down.
 * Never throws — OTP HTTP/SMS path must not break (fallback sync path if any).
 */
export const addOtpJob = async (data, options = {}) => {
    try {
        await ensureQueuesInitialized();
        const queue = getOtpQueue();
        if (!queue) {
            const now = Date.now();
            if (now - lastUnavailableLogAt > COOLDOWN_MS) {
                lastUnavailableLogAt = now;
                logger.warn('BullMQ OTP queue not available. Job not added.');
            }
            return null;
        }
        const job = await queue.add('send-otp', data, options);
        logger.info(`OTP job added: ${job.id}`);
        return job;
    } catch (err) {
        logger.warn(`Failed to add OTP job (non-fatal): ${err.message}`);
        return null;
    }
};
