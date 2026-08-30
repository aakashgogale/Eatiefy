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

    // Allow all local dev origins (localhost on any port and 127.0.0.1 on any port)
    try {
        const urlObj = new URL(origin);
        if (
            urlObj.hostname === 'localhost' ||
            urlObj.hostname === '127.0.0.1' ||
            urlObj.hostname.endsWith('.vercel.app')
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
    credentials: true
};
