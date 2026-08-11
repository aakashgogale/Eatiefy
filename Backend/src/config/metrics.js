import os from 'os';
import { monitorEventLoopDelay } from 'perf_hooks';
import { getRedisClient } from '../config/redis.js';
import { getQueueStats } from '../queues/index.js';

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

const latencies = [];
const MAX_SAMPLES = 2000;

let counters = {
    requests: 0,
    status5xx: 0,
    timeouts: 0,
    paymentFailures: 0,
    socketConnections: 0,
};

function percentile(sorted, p) {
    if (!sorted.length) return null;
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[idx];
}

export function recordRequestLatency(ms, statusCode) {
    counters.requests += 1;
    if (statusCode >= 500) counters.status5xx += 1;
    if (statusCode === 408 || statusCode === 504) counters.timeouts += 1;
    latencies.push(ms);
    if (latencies.length > MAX_SAMPLES) latencies.shift();
}

export function recordPaymentFailure() {
    counters.paymentFailures += 1;
}

export function setSocketConnectionCount(n) {
    counters.socketConnections = n;
}

export function incrementSocketConnections(delta = 1) {
    counters.socketConnections = Math.max(0, counters.socketConnections + delta);
}

async function measureRedisLatency() {
    const client = getRedisClient();
    if (!client?.isReady) return null;
    const start = process.hrtime.bigint();
    try {
        await client.ping();
        return Number(process.hrtime.bigint() - start) / 1e6;
    } catch {
        return null;
    }
}

/**
 * Snapshot of process metrics for /metrics and observability.
 */
export async function getMetricsSnapshot() {
    const sorted = [...latencies].sort((a, b) => a - b);
    const mem = process.memoryUsage();
    const queueStats = await getQueueStats().catch(() => []);
    const redisLatencyMs = await measureRedisLatency();

    return {
        timestamp: new Date().toISOString(),
        process: {
            pid: process.pid,
            uptimeSec: Math.round(process.uptime()),
            nodeVersion: process.version,
        },
        cpu: {
            loadAvg: os.loadavg(),
            cores: os.cpus()?.length || 0,
        },
        memory: {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            external: mem.external,
        },
        eventLoop: {
            lagP50Ms: Number((histogram.percentile(50) / 1e6).toFixed(3)),
            lagP95Ms: Number((histogram.percentile(95) / 1e6).toFixed(3)),
            lagP99Ms: Number((histogram.percentile(99) / 1e6).toFixed(3)),
            lagMaxMs: Number((histogram.max / 1e6).toFixed(3)),
        },
        http: {
            requestCount: counters.requests,
            status5xx: counters.status5xx,
            timeouts: counters.timeouts,
            p50Ms: percentile(sorted, 50),
            p95Ms: percentile(sorted, 95),
            p99Ms: percentile(sorted, 99),
            samples: sorted.length,
        },
        redis: {
            latencyMs: redisLatencyMs,
        },
        sockets: {
            connections: counters.socketConnections,
        },
        payments: {
            failures: counters.paymentFailures,
        },
        queues: queueStats,
    };
}
