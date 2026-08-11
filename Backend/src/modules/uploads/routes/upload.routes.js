import express from 'express';
import { uploadImage } from '../controllers/upload.controller.js';
import { imageUpload, uploadRateLimiter } from '../middleware/upload.middleware.js';
import { authMiddleware } from '../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../core/roles/role.middleware.js';

const router = express.Router();

/**
 * POST /v1/uploads/image?folder=food/users/profile
 * multipart field: file (required)
 * Auth required — ADMIN, RESTAURANT, USER, DELIVERY_PARTNER
 * MIME + size limits enforced by imageUpload middleware
 */
router.post(
    '/image',
    authMiddleware,
    requireRoles('ADMIN', 'RESTAURANT', 'USER', 'DELIVERY_PARTNER'),
    uploadRateLimiter,
    imageUpload.single('file'),
    uploadImage
);

export default router;
