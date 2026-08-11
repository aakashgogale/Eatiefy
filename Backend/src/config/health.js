import mongoose from 'mongoose';
import { config } from './env.js';
import { getRedisClient } from './redis.js';

/**
 * Liveness: process is up (does not require dependencies).
 */
export const livenessCheck = () => ({
    status: 'UP',
    timestamp: new Date().toISOString(),
});

/**
 * Readiness / health: Mongo required; Redis reported when enabled.
 */
export const healthCheck = async () => {
    const mongoState = mongoose.connection.readyState;
    const mongoOk = mongoState === 1; // 1 = connected

    let redisOk = null;
    if (config.redisEnabled) {
        const client = getRedisClient();
        redisOk = client ? 'ok' : 'unavailable';
        if (client) {
            try {
                await client.ping();
                redisOk = 'ok';
            } catch {
                redisOk = 'unavailable';
            }
        }
    } else {
        redisOk = 'disabled';
    }

    const ready = mongoOk && (redisOk === 'ok' || redisOk === 'disabled');

    return {
        status: ready ? 'UP' : 'DEGRADED',
        ready,
        mongo: mongoOk ? 'connected' : 'disconnected',
        redis: redisOk,
        timestamp: new Date().toISOString(),
    };
};

export const readinessCheck = async () => {
    const health = await healthCheck();
    return {
        status: health.ready ? 'ready' : 'not_ready',
        ...health,
    };
};
