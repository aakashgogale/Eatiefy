import express from 'express';
import crypto from 'crypto';
import { upload } from '../../../middleware/upload.js';
import { authMiddleware } from '../../../core/auth/auth.middleware.js';
import { config } from '../../../config/env.js';
import { sendError } from '../../../utils/response.js';
import { uploadImageController, deleteUploadController } from '../controllers/upload.controller.js';

const router = express.Router();

const secretsMatch = (provided, expected) => {
    const a = Buffer.from(String(provided || ''));
    const b = Buffer.from(String(expected || ''));
    if (!a.length || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
};

const requireUploadSecret = (req, res, next) => {
    const provided = req.get('x-upload-secret');
    if (!secretsMatch(provided, config.uploadInternalSecret)) {
        return sendError(res, 401, 'Invalid upload secret');
    }
    next();
};

router.post('/image', authMiddleware, upload.single('file'), uploadImageController);
router.delete('/', authMiddleware, deleteUploadController);

// Local/dev backends forward files here so they land in /var/www/uploads on the server.
router.post('/internal', requireUploadSecret, upload.single('file'), uploadImageController);
router.delete('/internal', requireUploadSecret, deleteUploadController);

export default router;
