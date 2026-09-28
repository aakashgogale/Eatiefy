/*
 * Browser origins the API trusts: CORS (app.js) and redirect targets such as the
 * Razorpay return URL (webhook.routes.js) both check against this one list.
 */
// Loads Backend/.env before CORS_ORIGINS / FRONTEND_URL are read below.
import './env.js';

const defaultOrigins = [
    'https://eatiefy.com',
    'https://www.eatiefy.com',
    // Legacy domain kept so anything still served from it keeps working.
    'https://omettofood.com',
    'https://www.omettofood.com',
    'http://omettofood.com',
    'http://www.omettofood.com',
    'http://localhost:5173',
    'http://localhost:3000'
];

const allowedHostnames = new Set([
    'eatiefy.com',
    'www.eatiefy.com',
    'omettofood.com',
    'www.omettofood.com',
    'localhost',
    '127.0.0.1'
]);

const extraOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

const frontendOrigin = String(process.env.FRONTEND_URL || '')
    .trim()
    .replace(/\/$/, '');

const allowedOrigins = [...new Set([
    ...defaultOrigins,
    ...extraOrigins,
    ...(frontendOrigin ? [frontendOrigin] : [])
])];

export const isAllowedOrigin = (origin) => {
    if (!origin) return true;
    if (allowedOrigins.includes(origin)) return true;

    try {
        const { hostname } = new URL(origin);
        return allowedHostnames.has(hostname.toLowerCase());
    } catch {
        return false;
    }
};
