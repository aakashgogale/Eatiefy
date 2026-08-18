import { config } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * Validates required environment configuration on startup.
 * Logs clear errors and exits if critical variables are missing.
 */
export const validateConfig = () => {
    const missing = [];

    if (!config.mongodbUri) {
        missing.push('MONGO_URI or MONGODB_URI');
    }
    if (!config.jwtAccessSecret) {
        missing.push('JWT_ACCESS_SECRET or JWT_SECRET');
    }
    if (!config.jwtRefreshSecret) {
        missing.push('JWT_REFRESH_SECRET');
    }
    if (config.redisEnabled && !config.redisUrl) {
        missing.push('REDIS_URL (required when REDIS_ENABLED=true)');
    }
    if (config.bullmqEnabled && !config.redisEnabled) {
        missing.push('REDIS_ENABLED=true (required when BULLMQ_ENABLED=true)');
    }

    // Production hard requirements for horizontal scale + idempotency
    if (config.nodeEnv === 'production') {
        if (!config.redisEnabled || !config.redisUrl) {
            missing.push('REDIS_ENABLED=true and REDIS_URL (required in production)');
        }
        if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) {
            missing.push('CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET (required in production for multi-instance uploads)');
        }
    }

    if (missing.length > 0) {
        logger.error(`Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }

    if (config.nodeEnv === 'production' && config.useDefaultOtp) {
        logger.error('USE_DEFAULT_OTP=true is forbidden in production');
        process.exit(1);
    }

    if (config.nodeEnv === 'production' && !config.razorpayWebhookSecret && config.razorpayKeyId) {
        logger.warn('RAZORPAY_WEBHOOK_SECRET is not set — payment webhooks cannot be verified');
    }
};
