import multer from 'multer';
import { config } from '../../../config/env.js';

const memoryStorage = multer.memoryStorage();

const ALLOWED_UPLOAD_MIMES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'image/jfif',
    'image/pjpeg',
    'image/x-png',
    'image/bmp',
    'image/svg+xml',
    'application/octet-stream'
]);

export const imageUpload = multer({
    storage: memoryStorage,
    limits: {
        fileSize: config.uploadMaxFileSizeBytes || 25 * 1024 * 1024,
        files: 1
    },
    fileFilter: (_req, file, cb) => {
        const mimeType = String(file.mimetype || '').toLowerCase();
        const ext = String(file.originalname || '').toLowerCase();
        const isImageExt = /\.(jpg|jpeg|png|webp|gif|heic|heif|jfif|bmp|svg)$/i.test(ext);

        if (ALLOWED_UPLOAD_MIMES.has(mimeType) || mimeType.startsWith('image/') || isImageExt) {
            return cb(null, true);
        }
        return cb(new Error('Only image files (JPEG, PNG, WebP, GIF, HEIC) are allowed'));
    }
});

export { uploadRateLimiter } from '../../../middleware/rateLimit.js';
