import { config } from '../config/env.js';

const SECRET_PATTERNS = [
    /password/i,
    /secret/i,
    /token/i,
    /authorization/i,
    /api[_-]?key/i,
    /razorpay/i,
    /signature/i,
];

function redact(value) {
    if (value == null) return value;
    if (typeof value === 'string') {
        if (value.length > 8 && /Bearer\s+/i.test(value)) return 'Bearer [REDACTED]';
        return value;
    }
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(redact);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (SECRET_PATTERNS.some((re) => re.test(k))) {
            out[k] = '[REDACTED]';
        } else {
            out[k] = redact(v);
        }
    }
    return out;
}

function emit(level, message, meta = {}) {
    const entry = {
        level,
        msg: typeof message === 'string' ? message : String(message),
        time: new Date().toISOString(),
        env: config.nodeEnv,
        ...redact(meta),
    };
    const line = JSON.stringify(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
}

export const logger = {
    info: (msg, meta) => emit('info', msg, typeof meta === 'object' ? meta : undefined),
    error: (msg, meta) => emit('error', msg, typeof meta === 'object' ? meta : undefined),
    warn: (msg, meta) => emit('warn', msg, typeof meta === 'object' ? meta : undefined),
    debug: (msg, meta) => {
        if (config.nodeEnv !== 'production') emit('debug', msg, typeof meta === 'object' ? meta : undefined);
    },
};
