import { Queue } from 'bullmq';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import {
    getBullMQConnection,
    pingBullMQRedis,
    isBullMQConnectionReady,
} from './connection.js';
import {
    OTP_QUEUE,
    NOTIFICATION_QUEUE,
    ORDER_QUEUE,
    PAYMENT_QUEUE,
    TRACKING_QUEUE,
    QUEUE_NAMES
} from './queue.constants.js';

/** @type {Map<string, Queue>} */
const queueInstances = new Map();

let queuesBootstrapped = false;

/**
 * Default job options: retry, backoff, cleanup.
 * Applied to all queues when BULLMQ_ENABLED=true.
 */
const defaultJobOptions = {
    attempts: 3,
    backoff: {
        type: 'exponential',
        delay: 1000
    },
    removeOnComplete: {
        count: 1000
    },
    removeOnFail: {
        age: 24 * 3600
    }
};

/**
 * Create and cache a single queue by name.
 * @param {string} queueName
 * @returns {Queue | null}
 */
const createQueue = (queueName) => {
    const conn = getBullMQConnection();
    if (!conn) return null;
    const queue = new Queue(queueName, {
        connection: conn,
        defaultJobOptions
    });
    queueInstances.set(queueName, queue);
    return queue;
};

/**
 * Get or create a queue by name. Returns null if BullMQ is disabled or Redis unavailable.
 * If Redis was down at boot and comes back later, tries a one-shot re-bootstrap.
 * @param {string} queueName
 * @returns {Queue | null}
 */
export const getQueue = (queueName) => {
    if (!config.bullmqEnabled) {
        return null;
    }
    if (!config.redisEnabled) {
        return null;
    }
    if (!queuesBootstrapped) {
        // Sync path — callers use producers which already no-op when null.
        // Async re-bootstrap is kicked from add*Job helpers / initializeQueues at boot.
        return null;
    }
    if (queueInstances.has(queueName)) {
        return queueInstances.get(queueName);
    }
    return createQueue(queueName);
};

/** In-flight rebootstrap promise (avoid parallel inits). */
let rebootstrapPromise = null;

/**
 * Try to initialize queues later if Redis was down at first boot.
 * Safe to call often; no-ops when already up.
 */
export const ensureQueuesInitialized = async () => {
    if (!config.bullmqEnabled || !config.redisEnabled) return false;
    if (queuesBootstrapped) return true;
    if (rebootstrapPromise) return rebootstrapPromise;

    rebootstrapPromise = (async () => {
        try {
            const result = await initializeQueues();
            return Boolean(result.initialized || result.queues?.length);
        } finally {
            rebootstrapPromise = null;
        }
    })();

    return rebootstrapPromise;
};

/**
 * Initialize all queue instances (for producer use). Does NOT start workers.
 * Workers run in separate processes and use workers/*.js.
 * Safe: if Redis is down, skips queues and API keeps running.
 * @returns {Promise<{ initialized: boolean, queues: string[] }>}
 */
export const initializeQueues = async () => {
    if (!config.bullmqEnabled) {
        logger.info('BullMQ is disabled (BULLMQ_ENABLED is not true). Queues will not be initialized.');
        queuesBootstrapped = false;
        return { initialized: false, queues: [] };
    }

    if (!config.redisEnabled) {
        logger.warn('BullMQ is enabled but Redis is disabled. Queues will not be initialized.');
        queuesBootstrapped = false;
        return { initialized: false, queues: [] };
    }

    const conn = getBullMQConnection();
    if (!conn) {
        logger.warn('BullMQ enabled but REDIS_URL missing. Queues not initialized.');
        queuesBootstrapped = false;
        return { initialized: false, queues: [] };
    }

    const alive = await pingBullMQRedis();
    if (!alive) {
        logger.warn(
            'BullMQ: Redis not reachable at startup. Queues skipped — API continues. Jobs will enqueue once Redis is up and process restarts or reconnects.',
        );
        queuesBootstrapped = false;
        return { initialized: false, queues: [] };
    }

    const initialized = [];
    for (const name of QUEUE_NAMES) {
        try {
            createQueue(name);
            initialized.push(name);
        } catch (err) {
            logger.error(`BullMQ queue "${name}" initialization failed: ${err.message}`);
        }
    }

    queuesBootstrapped = initialized.length > 0;
    if (initialized.length > 0) {
        logger.info(`BullMQ queues initialized: ${initialized.join(', ')}`);
    }
    return { initialized: initialized.length === QUEUE_NAMES.length, queues: initialized };
};

/**
 * Named queue getters for convenience.
 */
export const getOtpQueue = () => getQueue(OTP_QUEUE);
export const getNotificationQueue = () => getQueue(NOTIFICATION_QUEUE);
export const getOrderQueue = () => getQueue(ORDER_QUEUE);
export const getPaymentQueue = () => getQueue(PAYMENT_QUEUE);
export const getTrackingQueue = () => getQueue(TRACKING_QUEUE);

/**
 * Get job counts per queue for admin observability. Returns [] if BullMQ disabled.
 * @returns {Promise<Array<{ name: string, waiting: number, active: number, completed: number, failed: number }>>}
 */
export const getQueueStats = async () => {
    if (!config.bullmqEnabled) return [];
    const stats = [];
    for (const name of QUEUE_NAMES) {
        const queue = getQueue(name);
        if (!queue) continue;
        try {
            const counts = await queue.getJobCounts();
            stats.push({ name, ...counts });
        } catch (err) {
            logger.error(`Queue ${name} getJobCounts failed: ${err.message}`);
            stats.push({ name, waiting: 0, active: 0, completed: 0, failed: 0, error: err.message });
        }
    }
    return stats;
};

export { OTP_QUEUE, NOTIFICATION_QUEUE, ORDER_QUEUE, PAYMENT_QUEUE, QUEUE_NAMES } from './queue.constants.js';
export { getBullMQConnection, closeBullMQConnection, isBullMQConnectionReady } from './connection.js';
