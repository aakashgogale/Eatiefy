import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Backend/ — the base a relative UPLOAD_PATH is resolved against.
const backendRoot = path.resolve(__dirname, '..', '..');

const uploadPath = process.env.UPLOAD_PATH
    || (process.env.NODE_ENV === 'production' ? '/var/www/uploads' : 'uploads/');

export const config = {
    // Basic server config
    port: process.env.PORT || 5000,
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',

    // Database
    mongodbUri: process.env.MONGO_URI || process.env.MONGODB_URI,

    // JWT
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',

    // OTP
    otpExpiry: process.env.OTP_EXPIRY || '5m',
    otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 4),
    otpExpiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES || 10),
    otpExpirySeconds: Number(process.env.OTP_EXPIRY_SECONDS || 300),
    otpRateLimit: Number(process.env.OTP_RATE_LIMIT || (process.env.NODE_ENV === 'production' ? 3 : 100)),
    otpRateWindow: Number(process.env.OTP_RATE_WINDOW || (process.env.NODE_ENV === 'production' ? 600 : 60)),
    useDefaultOtp: process.env.USE_DEFAULT_OTP === 'true',
    // Phone-scoped default OTP (independent of USE_DEFAULT_OTP for all numbers)
    useDefaultTestPhone: process.env.USE_DEFAULT_TEST_PHONE === 'true',
    defaultTestPhone: String(process.env.DEFAULT_TEST_PHONE || '').replace(/\D/g, '').slice(-10),

    // MSG91
    msg91AuthKey: process.env.MSG91_AUTH_KEY,
    msg91SenderId: process.env.MSG91_SENDER_ID,
    msg91TemplateId: process.env.MSG91_TEMPLATE_ID,

    // SMS India Hub
    smsIndiaHubUsername: process.env.SMS_INDIA_HUB_USERNAME,
    smsApiKey: process.env.SMS_INDIA_HUB_API_KEY,
    smsSenderId: process.env.SMS_INDIA_HUB_SENDER_ID,
    smsDltTemplateId: process.env.SMS_INDIA_HUB_DLT_TEMPLATE_ID,

    // Service Toggles
    smsHubEnabled: process.env.SMS_HUB_ENABLED === 'true',
    msg91Enabled: process.env.MSG91_ENABLED === 'true',

    // Rate limiting (see Backend/.env RATE_LIMIT_* / AUTH_RATE_LIMIT_*)
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    rateLimitWindowMinutes: Number(process.env.RATE_LIMIT_WINDOW || 15),
    rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX || 3500),
    rateLimitDevMaxRequests: Number(process.env.RATE_LIMIT_DEV_MAX || 2000),
    authRateLimitWindowMinutes: Number(process.env.AUTH_RATE_LIMIT_WINDOW || 15),
    authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 30),

    // Proxy hops for req.ip / X-Forwarded-For (nginx, Cloudflare, load balancer).
    // Set TRUST_PROXY=1 (one hop) or true. Default: 1 so rate-limit sees the real client IP.
    trustProxy: (() => {
        const raw = process.env.TRUST_PROXY;
        if (raw === undefined || raw === '') return 1;
        if (raw === 'true' || raw === 'TRUE') return true;
        if (raw === 'false' || raw === 'FALSE') return false;
        const n = Number(raw);
        return Number.isFinite(n) ? n : 1;
    })(),

    // Security
    bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 10),

    // Uploads
    uploadPath,
    // Single resolved absolute path for every read/write of the uploads dir.
    // Callers must use this — resolving uploadPath themselves is how the three
    // previous call sites ended up with three different base directories.
    uploadsRoot: path.isAbsolute(uploadPath)
        ? path.normalize(uploadPath)
        : path.resolve(backendRoot, uploadPath),
    // Public origin baked into stored image URLs (nginx). No trailing slash.
    assetBaseUrl: String(
        process.env.ASSET_BASE_URL ||
        process.env.API_BASE_URL ||
        `http://localhost:${process.env.PORT || 5000}`
    ).replace(/\/+$/, ''),
    // Local/dev only: forward uploads to the live server instead of writing a local folder.
    uploadRemoteOrigin: String(process.env.UPLOAD_REMOTE_ORIGIN || '').replace(/\/+$/, ''),
    uploadInternalSecret: process.env.UPLOAD_INTERNAL_SECRET || process.env.JWT_ACCESS_SECRET || '',
    // Keep serving /uploads from Express. Off in production once nginx owns it.
    serveUploadsFromNode: process.env.SERVE_UPLOADS_FROM_NODE === 'true',

    // Redis
    redisEnabled: process.env.REDIS_ENABLED === 'true',
    redisUrl: process.env.REDIS_URL,

    // BullMQ
    bullmqEnabled: process.env.BULLMQ_ENABLED === 'true',

    // Firebase / FCM
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
    firebaseDatabaseUrl: process.env.VITE_FIREBASE_DATABASE_URL,
    firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
    firebaseWebApiKey: process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY,
    firebaseWebAuthDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN,
    firebaseWebStorageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
    firebaseWebMessagingSenderId:
        process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID,
    firebaseWebAppId: process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID,
    firebaseWebMeasurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID || process.env.FIREBASE_MEASUREMENT_ID,
    firebaseWebVapidKey: process.env.VITE_FIREBASE_VAPID_KEY || process.env.FIREBASE_VAPID_KEY,

    // Socket.io
    socketCorsOrigin: process.env.SOCKET_CORS_ORIGIN || '*',

    // Razorpay (payments)
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET, // ✅ NEW

    // Email (SMTP) – for admin forgot password OTP etc.
    emailHost: process.env.EMAIL_HOST,
    emailPort: Number(process.env.EMAIL_PORT) || 587,
    emailUser: process.env.EMAIL_USER,
    emailPass: process.env.EMAIL_PASS ? String(process.env.EMAIL_PASS).replace(/\s/g, '') : '',
    emailFrom: String(process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@example.com')
        .replace(/^["']|["']$/g, '')
        .trim()
};
