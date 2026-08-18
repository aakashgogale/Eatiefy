import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Multer rejects oversized/too-many files with a code, not an HTTP status.
// Without this they surface as 500s and the client shows "Server Error".
const MULTER_STATUS = {
    LIMIT_FILE_SIZE: 413,
    LIMIT_FILE_COUNT: 400,
    LIMIT_PART_COUNT: 400,
    LIMIT_FIELD_COUNT: 400,
    LIMIT_FIELD_KEY: 400,
    LIMIT_FIELD_VALUE: 400,
    LIMIT_UNEXPECTED_FILE: 400
};

const errorHandler = (err, req, res, next) => {
    const statusCode = err.statusCode || MULTER_STATUS[err.code] || 500;
    const message = err.code === 'LIMIT_FILE_SIZE'
        ? `File too large. Maximum ${process.env.MAX_UPLOAD_SIZE_MB || 25}MB per file.`
        : err.message || 'Server Error';
    const requestId = req.requestId || '-';

    logger.error(
        `[${requestId}] ${req.method} ${req.originalUrl} ${statusCode} - ${err.name || 'Error'} - ${message}`
    );
    if (config.nodeEnv === 'development' && err.stack) {
        logger.error(`[${requestId}] ${err.stack}`);
    }

    res.status(statusCode).json({
        success: false,
        error: message
    });
};

export default errorHandler;
