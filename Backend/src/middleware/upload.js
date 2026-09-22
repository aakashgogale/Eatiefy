import multer from 'multer';

/**
 * Multer buffers uploads in memory. Images are converted to WebP and stored
 * on the live server at /var/www/uploads (local backends forward there).
 * Keep MAX_FILE_SIZE_MB <= nginx client_max_body_size (25M).
 */
const MAX_FILE_SIZE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB || 25);
const MAX_FILES_PER_REQUEST = Number(process.env.MAX_UPLOAD_FILES || 20);

const ALLOWED_MIME = new Set([
    'image/jpeg',
    'image/pjpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/heic',
    'image/heif',
    'image/bmp',
    'image/x-icon',
    'image/vnd.microsoft.icon',
    'video/mp4',
    'video/quicktime',
    'video/webm'
]);

// Non-standard spellings some Android WebViews / camera bridges report.
const MIME_ALIASES = {
    'image/jpg': 'image/jpeg',
    'image/x-png': 'image/png',
    'image/x-ms-bmp': 'image/bmp'
};

const EXTENSION_MIME = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    jfif: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    heic: 'image/heic',
    heif: 'image/heif',
    bmp: 'image/bmp'
};

/**
 * Gallery pickers frequently send a blank or generic type (`application/octet-stream`)
 * for perfectly valid photos. Fall back to the file extension for those; the image
 * pipeline still decodes the bytes, so a mislabelled non-image is rejected there.
 */
const resolveMimeType = (file) => {
    const mime = String(file.mimetype || '').toLowerCase().trim();
    if (MIME_ALIASES[mime]) return MIME_ALIASES[mime];
    if (mime && mime !== 'application/octet-stream' && mime !== 'binary/octet-stream') return mime;
    const ext = String(file.originalname || '').split('.').pop().toLowerCase();
    return EXTENSION_MIME[ext] || mime;
};

const storage = multer.memoryStorage();

const UNLABELLED_MIME = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

const fileFilter = (_req, file, cb) => {
    const mime = resolveMimeType(file);
    if (ALLOWED_MIME.has(mime)) {
        file.mimetype = mime;
        return cb(null, true);
    }
    /*
     * No usable type AND no known extension - e.g. a compressed canvas Blob
     * appended as "blob", or an Android content URI. Only headers are visible
     * here, so the file is let through as unlabelled and judged by its bytes:
     * every non-video upload is fully decoded and re-encoded to WebP, and
     * anything that is not a real image is rejected there. Nothing unlabelled
     * is ever stored as-is.
     */
    if (UNLABELLED_MIME.has(mime)) {
        file.mimetype = 'application/octet-stream';
        return cb(null, true);
    }
    const err = new Error(`Unsupported file type: ${file.mimetype}`);
    err.statusCode = 400;
    err.code = 'UNSUPPORTED_FILE_TYPE';
    return cb(err);
};

export const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
        files: MAX_FILES_PER_REQUEST,
        fields: 100
    }
});
