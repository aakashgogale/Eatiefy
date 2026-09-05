import { config } from '../../../../config/env.js';

const sanitize = (value) => (value ? String(value).trim().replace(/^['"]|['"]$/g, '') : '');

/**
 * Public environment variables for frontend + service worker runtime.
 * IMPORTANT: Only expose non-secret keys safe for clients.
 * Prefer VITE_* then FIREBASE_* / config fallbacks so SW can init when
 * only one naming style is present in Backend .env.
 */
export const getPublicEnvController = async (_req, res, next) => {
    try {
        const apiKey =
            sanitize(process.env.VITE_FIREBASE_API_KEY) ||
            sanitize(process.env.FIREBASE_API_KEY) ||
            sanitize(config.firebaseWebApiKey) ||
            '';
        const authDomain =
            sanitize(process.env.VITE_FIREBASE_AUTH_DOMAIN) ||
            sanitize(process.env.FIREBASE_AUTH_DOMAIN) ||
            sanitize(config.firebaseWebAuthDomain) ||
            '';
        const projectId =
            sanitize(process.env.VITE_FIREBASE_PROJECT_ID) ||
            sanitize(process.env.FIREBASE_PROJECT_ID) ||
            sanitize(config.firebaseProjectId) ||
            '';
        const storageBucket =
            sanitize(process.env.VITE_FIREBASE_STORAGE_BUCKET) ||
            sanitize(process.env.FIREBASE_STORAGE_BUCKET) ||
            sanitize(config.firebaseWebStorageBucket) ||
            '';
        const messagingSenderId =
            sanitize(process.env.VITE_FIREBASE_MESSAGING_SENDER_ID) ||
            sanitize(process.env.FIREBASE_MESSAGING_SENDER_ID) ||
            sanitize(config.firebaseWebMessagingSenderId) ||
            '';
        const appId =
            sanitize(process.env.VITE_FIREBASE_APP_ID) ||
            sanitize(process.env.FIREBASE_APP_ID) ||
            sanitize(config.firebaseWebAppId) ||
            '';
        const measurementId =
            sanitize(process.env.VITE_FIREBASE_MEASUREMENT_ID) ||
            sanitize(process.env.FIREBASE_MEASUREMENT_ID) ||
            sanitize(config.firebaseWebMeasurementId) ||
            '';
        const vapidKey =
            sanitize(process.env.VITE_FIREBASE_VAPID_KEY) ||
            sanitize(process.env.FIREBASE_VAPID_KEY) ||
            sanitize(config.firebaseWebVapidKey) ||
            '';

        // Do NOT expose Google Maps server/geocode key here.
        return res.status(200).json({
            success: true,
            message: 'Public environment variables fetched',
            data: {
                VITE_GOOGLE_MAPS_API_KEY: '',
                VITE_FIREBASE_API_KEY: apiKey,
                VITE_FIREBASE_AUTH_DOMAIN: authDomain,
                VITE_FIREBASE_PROJECT_ID: projectId,
                VITE_FIREBASE_STORAGE_BUCKET: storageBucket,
                VITE_FIREBASE_MESSAGING_SENDER_ID: messagingSenderId,
                VITE_FIREBASE_APP_ID: appId,
                VITE_FIREBASE_MEASUREMENT_ID: measurementId,
                VITE_FIREBASE_VAPID_KEY: vapidKey,
                FIREBASE_API_KEY: apiKey,
                FIREBASE_AUTH_DOMAIN: authDomain,
                FIREBASE_PROJECT_ID: projectId,
                FIREBASE_STORAGE_BUCKET: storageBucket,
                FIREBASE_MESSAGING_SENDER_ID: messagingSenderId,
                FIREBASE_APP_ID: appId,
                FIREBASE_MEASUREMENT_ID: measurementId,
                FIREBASE_VAPID_KEY: vapidKey,
                NODE_ENV: config.nodeEnv || 'development'
            }
        });
    } catch (error) {
        next(error);
    }
};
