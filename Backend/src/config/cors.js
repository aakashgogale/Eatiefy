import { config } from './env.js';

/**
 * Returns allowed CORS origins including local dev ports and CLIENT_URL.
 * @returns {string[]}
 */
export const getCorsOrigins = () => {
    const defaultOrigins = ['http://localhost:5173', 'http://localhost:3000'];

    const envOrigins = [process.env.CLIENT_URL, config.clientUrl]
        .filter(Boolean)
        .flatMap((url) => String(url).split(','))
        .map((origin) => origin.trim())
        .filter(Boolean);

    return Array.from(new Set([...defaultOrigins, ...envOrigins]));
};

/**
 * Express CORS options with credentials enabled.
 */
export const corsOptions = {
    origin: (origin, callback) => {
        const allowed = getCorsOrigins();
        // Allow requests with no origin (like mobile apps, curl, server-to-server)
        if (!origin || allowed.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
};
