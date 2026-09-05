import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const errorHandler = (err, req, res, next) => {
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Server Error';

    if (err.name === 'MulterError') {
        statusCode = 400;
        if (err.code === 'LIMIT_FILE_SIZE') {
            message = 'Image is too large';
        } else if (err.code === 'LIMIT_FILE_COUNT') {
            message = 'Only one file can be uploaded at a time';
        } else {
            message = err.message || 'Invalid upload';
        }
    } else if (
        err.name === 'CastError' ||
        err.name === 'BSONError' ||
        err.name === 'BSONTypeError' ||
        err.name === 'StrictModeError'
    ) {
        // Invalid ObjectId / bad request body — never leak as opaque 500.
        statusCode = 400;
        message = err.message || 'Invalid request data';
    } else if (err.name === 'ValidationError') {
        // Custom auth ValidationError (has statusCode) or Mongoose ValidationError.
        statusCode = err.statusCode || 400;
        message = err.message || 'Validation failed';
    } else if (err.name === 'ZodError') {
        statusCode = 400;
        message = err.issues?.[0]?.message || err.errors?.[0]?.message || err.message || 'Validation failed';
    } else if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600) {
        statusCode = err.statusCode;
        message = err.message || message;
    }

    // Never expose internal stack details to clients in production.
    if (statusCode >= 500 && config.nodeEnv === 'production') {
        message = 'Something went wrong. Please try again.';
    }

    const requestId = req.requestId || '-';

    logger.error(
        `[${requestId}] ${req.method} ${req.originalUrl} ${statusCode} - ${err.name || 'Error'} - ${err.message || message}`
    );
    if (config.nodeEnv === 'development' && err.stack) {
        logger.error(`[${requestId}] ${err.stack}`);
    }

    // `error` + `message` for both legacy and current frontend parsers.
    res.status(statusCode).json({
        success: false,
        error: message,
        message,
        // Machine-readable code when the error carries one, so clients can
        // branch on it instead of matching the human-readable message.
        ...(err.code && typeof err.code === 'string' ? { code: err.code } : {}),
    });
};

export default errorHandler;
