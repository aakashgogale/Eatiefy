import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoSanitize from 'mongo-sanitize';
import xssClean from 'xss-clean';
import routes from './routes/index.js';
import errorHandler from './middleware/errorHandler.js';
import { apiRateLimitMiddleware, getClientIp } from './middleware/rateLimit.js';
import { responseTimeLogger } from './middleware/responseTimeLogger.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { healthCheck } from './config/health.js';
import { config } from './config/env.js';

const app = express();

// Trust proxy so req.ip / rate-limit see the real client IP (nginx, CF, Vite proxy).
app.set('trust proxy', config.trustProxy);

// Request ID tracing (before other middlewares so all logs can use it)
app.use(requestIdMiddleware);

// Attach resolved client IP for logging / downstream use
app.use((req, _res, next) => {
    req.clientIp = getClientIp(req);
    next();
});

// Health endpoints (no rate limit, minimal JSON, no secrets)
app.get('/health', async (_req, res) => {
    try {
        const data = await healthCheck();
        res.status(200).json(data);
    } catch (err) {
        res.status(503).json({ status: 'DOWN', error: 'Health check failed' });
    }
});
app.get('/ready', (_req, res) => {
    res.status(200).json({ status: 'ready' });
});

// Security & parsing middlewares
app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } },
    hsts: config.nodeEnv === 'production' ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    xssFilter: true,
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
const defaultOrigins = [
    'https://omettofood.com',
    'https://www.omettofood.com',
    'http://omettofood.com',
    'http://www.omettofood.com',
    'http://localhost:5173',
    'http://localhost:3000'
];

const allowedHostnames = new Set([
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

const isAllowedOrigin = (origin) => {
    if (!origin) return true;
    if (allowedOrigins.includes(origin)) return true;

    try {
        const { hostname } = new URL(origin);
        return allowedHostnames.has(hostname.toLowerCase());
    } catch {
        return false;
    }
};

app.use(cors({
    origin(origin, callback) {
        if (isAllowedOrigin(origin)) {
            callback(null, true);
            return;
        }

        console.warn(`[CORS] Blocked origin: ${origin}`);
        const err = new Error('Not allowed by CORS');
        err.statusCode = 403;
        callback(err);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
}));
if (config.nodeEnv !== 'production') {
    app.use(morgan('dev'));
}
app.use(express.json({
    verify: (req, res, buf) => {
        // ✅ Store rawBody for signature verification (Razorpay Webhooks)
        if (req.originalUrl && req.originalUrl.includes('/webhook/razorpay')) {
            req.rawBody = buf;
        }
    }
}));
app.use(express.urlencoded({ extended: true }));

// Protect against NoSQL injection and XSS
app.use((req, _res, next) => {
    req.body = mongoSanitize(req.body);
    req.query = mongoSanitize(req.query);
    req.params = mongoSanitize(req.params);
    next();
});
app.use(xssClean());

// Uploads are served by nginx straight off disk in production (see deploy/nginx/ometto.conf).
// This static mount is the dev fallback only — SERVE_UPLOADS_FROM_NODE=true forces it on.
if (config.serveUploadsFromNode) {
    app.use(
        '/uploads',
        express.static(config.uploadsRoot, {
            maxAge: '30d',
            index: false,
            dotfiles: 'ignore'
        })
    );
}

// Rate limit: public free · auth routes use authRateLimiter · private = user+IP
app.use('/api', apiRateLimitMiddleware);

// Optional: log API response time (method, path, status, duration) - no sensitive data
// app.use('/api', responseTimeLogger);

// API Routes
app.use('/api', routes);

// Error Handling
app.use(errorHandler);

export default app;
