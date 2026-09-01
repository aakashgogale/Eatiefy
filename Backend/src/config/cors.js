import { config } from './env.js';

/**
 * Returns explicitly allowed CORS origins from env and defaults.
 * @returns {string[]}
 */
export const getCorsOrigins = () => {
    const defaultOrigins = [
        'http://localhost:5173', 
        'http://localhost:3000',
        'https://eatiefy.com',
        'https://www.eatiefy.com',
        'http://eatiefy.com',
        'http://www.eatiefy.com'
    ];

    const envOrigins = [process.env.CLIENT_URL, config.clientUrl]
        .filter(Boolean)
        .flatMap((url) => String(url).split(','))
        .map((origin) => origin.trim())
        .filter(Boolean);

    return Array.from(new Set([...defaultOrigins, ...envOrigins]));
};

/**
 * Checks if request origin is permitted.
 * Automatically permits Vercel deployments (*.vercel.app), explicit CLIENT_URL, localhost, and non-browser clients.
 * @param {string|undefined} origin 
 * @returns {boolean}
 */
export const isOriginAllowed = (origin) => {
    // Allow non-browser requests (mobile apps, curl, server-to-server)
    if (!origin) return true;

    const allowedOrigins = getCorsOrigins();
    const normalizedOrigin = String(origin).trim().replace(/\/+$/, '').toLowerCase();

    // Check exact match in configured allowed origins list
    if (allowedOrigins.some((allowed) => String(allowed).trim().replace(/\/+$/, '').toLowerCase() === normalizedOrigin)) {
        return true;
    }

    // Allow localhost, 127.0.0.1, eatiefy domains (*.eatiefy.com), and vercel previews (*.vercel.app)
    try {
        const urlObj = new URL(origin);
        const hostname = urlObj.hostname.toLowerCase();
        if (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === 'eatiefy.com' ||
            hostname.endsWith('.eatiefy.com') ||
            hostname.endsWith('.vercel.app')
        ) {
            return true;
        }
    } catch {
        /* Ignore malformed origin */
    }

    return false;
};

/**
 * Express CORS options with credentials enabled.
 */
export const corsOptions = {
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`Not allowed by CORS: ${origin}`));
        }
    },
    credentials: true,
    // Without this the browser repeats the preflight OPTIONS before *every*
    // credentialed request, doubling the request count and adding a round trip to
    // each call. 24h is what we ask for; Chrome caps it at 2h, Firefox honours 24h.
    maxAge: 86400,
    // Every custom header the client actually sends must be listed, or the preflight
    // fails and the real request is never made.
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Idempotency-Key',
        'x-eatify-client',
        'x-eatiefy-client',
    ],
    exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'Retry-After'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
};
