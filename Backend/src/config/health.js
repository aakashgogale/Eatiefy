import mongoose from 'mongoose';
import { config } from './env.js';
import { getRedisClient } from './redis.js';

/**
 * Liveness: process is up (does not require dependencies).
 * Load balancers use this to know the process is alive.
 */
export const livenessCheck = () => ({
    status: 'UP',
    timestamp: new Date().toISOString(),
});

/**
 * Readiness / health: Mongo required.
 * In production Redis is also required (idempotency, rate limit, sockets).
 * LB must not route when ready=false.
 */
export const healthCheck = async () => {
    const mongoState = mongoose.connection.readyState;
    const mongoOk = mongoState === 1;

    let redisOk = null;
    if (config.redisEnabled || config.nodeEnv === 'production') {
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

    const redisRequired = config.nodeEnv === 'production' || config.redisEnabled;
    const redisHealthy = redisOk === 'ok' || (!redisRequired && redisOk === 'disabled');
    const ready = mongoOk && redisHealthy;

    return {
        status: ready ? 'UP' : (mongoOk ? 'DEGRADED' : 'DOWN'),
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
