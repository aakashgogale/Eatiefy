import { recordRequestLatency } from '../config/metrics.js';

/**
 * Records request latency + status for /metrics.
 */
export function metricsMiddleware(req, res, next) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        recordRequestLatency(ms, res.statusCode);
    });
    next();
}
