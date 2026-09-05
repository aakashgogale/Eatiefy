import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { config } from '../config/env.js';
import { ValidationError } from '../core/auth/errors.js';

const UPLOADS_ROOT = config.uploadsRoot;
const usesRemoteStore = () => Boolean(config.uploadRemoteOrigin) && config.nodeEnv !== 'production';

const ensureRoot = async () => {
    await fs.promises.mkdir(UPLOADS_ROOT, { recursive: true });
};

/** 'food/restaurants/pan' -> 'food_restaurants_pan' */
export const flattenFolder = (folder) => {
    const cleaned = String(folder || 'uploads')
        .trim()
        .replace(/\\/g, '/')
        .replace(/\.{2,}/g, '')
        .replace(/^\/+|\/+$/g, '')
        .replace(/[^A-Za-z0-9/_-]/g, '')
        .replace(/\/+/g, '_');
    return cleaned || 'uploads';
};

const randomId = () => crypto.randomBytes(10).toString('hex');

export const buildAssetUrl = (filename) => `${config.assetBaseUrl}/uploads/${filename}`;

export const extractAssetUrl = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'object') {
        return String(value.url || value.secure_url || value.imageUrl || value.iconUrl || value.src || '').trim();
    }
    return '';
};

export const extractAssetUrls = (value) => {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) {
        return [...new Set(value.flatMap(extractAssetUrls).filter(Boolean))];
    }
    const one = extractAssetUrl(value);
    return one ? [one] : [];
};

const encodeToWebp = async (buffer, { maxWidth } = {}) => {
    try {
        let pipeline = sharp(buffer, { animated: true, failOn: 'none' });
        if (maxWidth) {
            pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
        }
        const meta = await sharp(buffer, { failOn: 'none' }).metadata().catch(() => ({}));
        const out = await pipeline.webp({ quality: 90, effort: 4 }).toBuffer();
        if (!out?.length) {
            throw new Error('empty webp output');
        }
        return { buffer: out, ext: 'webp', width: meta.width, height: meta.height };
    } catch {
        throw new ValidationError('Could not convert image to WebP. Upload a valid image file.');
    }
};

export const resolveStoredFilename = async (urlOrPublicId) => {
    if (!urlOrPublicId) return null;

    let name = String(urlOrPublicId).trim();
    if (/^https?:\/\//i.test(name)) {
        try {
            name = decodeURIComponent(new URL(name).pathname);
        } catch {
            return null;
        }
        const marker = name.match(/\/(?:image|video|raw)\/upload\/(.+)$/i);
        if (marker) {
            name = marker[1]
                .split('/')
                .filter((p) => !/^v\d+$/.test(p))
                .join('_');
        }
    }
    name = name.replace(/\\/g, '/');
    if (name.includes('/')) {
        name = name.replace(/^\/?uploads\//i, '').replace(/\//g, '_');
    }
    name = path.basename(name);
    if (!name || name === '.' || name === '..') return null;
    if (path.extname(name)) return name;

    try {
        const entries = await fs.promises.readdir(UPLOADS_ROOT);
        return entries.find((f) => f.startsWith(`${name}.`)) || null;
    } catch {
        return null;
    }
};

const writeBufferToDisk = async (data, folder, ext) => {
    await ensureRoot();
    const base = `${flattenFolder(folder)}_${randomId()}`;
    const filename = `${base}.${ext}`;
    await fs.promises.writeFile(path.join(UPLOADS_ROOT, filename), data);
    return {
        secure_url: buildAssetUrl(filename),
        url: buildAssetUrl(filename),
        public_id: base,
        filename,
        format: ext,
        bytes: data.length
    };
};

const remoteHeaders = () => ({
    'X-Upload-Secret': config.uploadInternalSecret
});

const postRemoteFile = async ({ buffer, folder, replaceUrl, originalName, mimeType }) => {
    const form = new FormData();
    form.append(
        'file',
        new Blob([buffer], { type: mimeType || 'application/octet-stream' }),
        originalName || 'upload.bin'
    );
    form.append('folder', folder || 'uploads');
    if (replaceUrl) form.append('replaceUrl', String(replaceUrl));

    const response = await fetch(`${config.uploadRemoteOrigin}/api/v1/uploads/internal`, {
        method: 'POST',
        headers: remoteHeaders(),
        body: form
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success || !payload?.data?.url) {
        throw new ValidationError(payload?.error || payload?.message || 'Failed to upload image to server');
    }
    return payload.data;
};

const deleteRemoteAsset = async (url) => {
    const response = await fetch(`${config.uploadRemoteOrigin}/api/v1/uploads/internal`, {
        method: 'DELETE',
        headers: {
            ...remoteHeaders(),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url })
    });
    return response.ok;
};

const deleteFromDisk = async (urlOrPublicId) => {
    const filename = await resolveStoredFilename(urlOrPublicId);
    if (!filename) return false;
    try {
        await fs.promises.unlink(path.join(UPLOADS_ROOT, filename));
        return true;
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error(`Failed to delete upload ${filename}:`, err.message);
        }
        return false;
    }
};

/**
 * Store an image as WebP on the production server (`/var/www/uploads`).
 * Local/dev backends forward the file to UPLOAD_REMOTE_ORIGIN instead of writing disk.
 */
export const storeImageBuffer = async (buffer, folder = 'uploads', options = {}) => {
    if (!buffer || !buffer.length) {
        throw new ValidationError('File buffer is required');
    }

    if (usesRemoteStore()) {
        return postRemoteFile({
            buffer,
            folder,
            replaceUrl: extractAssetUrl(options.replaceUrl),
            originalName: options.originalName || 'upload.jpg',
            mimeType: options.mimeType || 'image/jpeg'
        });
    }

    const encoded = await encodeToWebp(buffer, options);
    const stored = await writeBufferToDisk(encoded.buffer, folder, 'webp');
    if (options.replaceUrl) {
        await deleteStoredAsset(options.replaceUrl);
    }
    return {
        ...stored,
        width: encoded.width,
        height: encoded.height,
        resource_type: 'image'
    };
};

/** Store a video/raw buffer (no transcoding). Images should use storeImageBuffer. */
export const storeFileBuffer = async (buffer, folder = 'uploads', originalName = '', options = {}) => {
    if (!buffer || !buffer.length) {
        throw new ValidationError('File buffer is required');
    }

    if (usesRemoteStore()) {
        return postRemoteFile({
            buffer,
            folder,
            replaceUrl: options.replaceUrl,
            originalName: originalName || 'upload.bin',
            mimeType: options.mimeType || 'application/octet-stream'
        });
    }

    const rawExt = path.extname(String(originalName || '')).replace(/[^.A-Za-z0-9]/g, '') || '.bin';
    const stored = await writeBufferToDisk(buffer, folder, rawExt.replace('.', ''));
    if (options.replaceUrl) {
        await deleteStoredAsset(options.replaceUrl);
    }
    return stored;
};

export const deleteStoredAsset = async (urlOrPublicId) => {
    const url = extractAssetUrl(urlOrPublicId);
    if (!url) return false;
    if (usesRemoteStore()) {
        try {
            return await deleteRemoteAsset(url);
        } catch (err) {
            console.error('Failed to delete remote upload:', err.message);
            return false;
        }
    }
    return deleteFromDisk(url);
};

export const deleteStoredAssets = async (urls = []) => {
    const list = extractAssetUrls(urls);
    await Promise.all(list.map((url) => deleteStoredAsset(url)));
};

/** Delete previous files that are no longer referenced after a successful replace. */
export const deleteReplacedAssets = async (previous, next) => {
    const prev = new Set(extractAssetUrls(previous));
    const curr = new Set(extractAssetUrls(next));
    const removed = [...prev].filter((url) => !curr.has(url));
    if (!removed.length) return;
    await deleteStoredAssets(removed);
};

export const uploadImageBuffer = async (buffer, folder = 'uploads', options = {}) => {
    const result = await storeImageBuffer(buffer, folder, options);
    return result.url || result.secure_url;
};

export { UPLOADS_ROOT };
