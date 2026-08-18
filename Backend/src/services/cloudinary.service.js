import { v2 as cloudinary } from 'cloudinary';
import { saveImageBuffer } from './storage.service.js';
import { config } from '../config/env.js';

// ─── Cloudinary SDK Configuration ────────────────────────────────────────────
// Only configured when credentials are present (mode = 'cloudinary')
if (config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret) {
    cloudinary.config({
        cloud_name: config.cloudinaryCloudName,
        api_key: config.cloudinaryApiKey,
        api_secret: config.cloudinaryApiSecret,
    });
}

/**
 * Upload buffer directly to Cloudinary SDK.
 * Returns a Cloudinary UploadApiResponse-compatible object.
 */
const uploadToCloudinary = (buffer, folder) =>
    new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: 'image',
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        stream.end(buffer);
    });

// ─── Legacy aliases (kept for backward-compat — always use server storage) ──

/**
 * Legacy name kept so existing services keep working without Cloudinary.
 * All image uploads are stored on the VPS and served by nginx.
 */
export const uploadImageBuffer = async (buffer, folder = 'uploads') => {
    const saved = await saveImageBuffer(buffer, folder);
    return saved.url;
};

export const uploadImageBufferDetailed = async (buffer, folder = 'uploads') => {
    const saved = await saveImageBuffer(buffer, folder);
    return {
        secure_url: saved.url,
        public_id: saved.path,
        url: saved.url,
        path: saved.path,
        filename: saved.filename
    };
};

// ─── Smart Router ─────────────────────────────────────────────────────────────

/**
 * Route an image buffer upload to either Cloudinary or local server storage,
 * based on the `mode` parameter ('cloudinary' | 'server').
 *
 * Always returns: { secure_url, public_id, url, path, filename }
 *
 * NOTE: Does NOT touch any existing upload code elsewhere in the codebase.
 * Only businessSettings.controller.js calls this function.
 */
export const uploadImageRouted = async (buffer, folder = 'uploads', mode = 'server') => {
    if (mode === 'cloudinary') {
        if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) {
            throw new Error(
                'Cloudinary credentials are not configured. ' +
                'Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your .env file.'
            );
        }
        const result = await uploadToCloudinary(buffer, folder);
        return {
            secure_url: result.secure_url,
            public_id: result.public_id,
            url: result.secure_url,
            path: result.public_id,
            filename: result.public_id
        };
    }

    // Default: server storage (unchanged behaviour)
    const saved = await saveImageBuffer(buffer, folder);
    return {
        secure_url: saved.url,
        public_id: saved.path,
        url: saved.url,
        path: saved.path,
        filename: saved.filename
    };
};
