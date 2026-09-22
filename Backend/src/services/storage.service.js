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

/*
 * Public image URLs.
 *
 * Stored image values are not uniform: besides the canonical
 * `${ASSET_BASE_URL}/uploads/<file>.webp` there are relative "/uploads/..."
 * paths, protocol-relative "//host/..." values, localhost URLs saved by a dev
 * backend pointed at the production database, and plain http:// copies of the
 * https asset host. Each of those loads on some devices and not on others -
 * relative paths resolve against whatever origin the app happens to run on,
 * localhost points at the customer's own phone, http is blocked as mixed
 * content inside WebViews. toPublicAssetUrl maps all of them onto one absolute
 * URL every client can load, and leaves genuinely external URLs alone.
 */
const LOCAL_ASSET_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

/** URIs that only exist on the device that created them - never storable. */
const DEVICE_LOCAL_URI = /^(blob|data|file|content|capacitor|ionic|filesystem):/i;

const assetBase = () => {
    try {
        return new URL(config.assetBaseUrl);
    } catch {
        return null;
    }
};

export const toPublicAssetUrl = (value) => {
    let raw = extractAssetUrl(value).replace(/\\/g, '/');
    if (!raw || DEVICE_LOCAL_URI.test(raw)) return '';

    const base = assetBase();
    if (raw.startsWith('//')) raw = `${base?.protocol || 'https:'}${raw}`;

    // "/uploads/x.webp" or "uploads/x.webp": a file on our own disk.
    if (!/^https?:\/\//i.test(raw)) {
        const rel = raw.replace(/^\.?\/*/, '');
        return /^uploads\//i.test(rel) ? `${config.assetBaseUrl}/${rel}` : raw;
    }

    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        return raw;
    }
    if (!base) return parsed.toString();

    // A dev backend stamped its own localhost origin on a file that lives in
    // the shared uploads folder. Only rewrite when the configured asset host
    // is itself public; in local development localhost is correct.
    const baseIsLocal = LOCAL_ASSET_HOSTS.has(base.hostname.toLowerCase());
    if (!baseIsLocal && LOCAL_ASSET_HOSTS.has(parsed.hostname.toLowerCase()) && /^\/uploads\//i.test(parsed.pathname)) {
        return `${config.assetBaseUrl}${parsed.pathname}${parsed.search}`;
    }

    // http copy of our own https asset host: mixed content in the app.
    if (parsed.hostname === base.hostname && base.protocol === 'https:' && parsed.protocol === 'http:') {
        parsed.protocol = 'https:';
    }
    return parsed.toString();
};

/**
 * Normalises an image value submitted for storage. A device-local URI means
 * the client saved before its upload finished; storing it would give every
 * customer a broken image, so it is refused with a message the restaurant can
 * act on instead of being silently saved.
 */
export const normalizeImageForStorage = (value) => {
    const raw = extractAssetUrl(value);
    if (!raw) return '';
    if (DEVICE_LOCAL_URI.test(raw)) {
        throw new ValidationError('The image has not finished uploading. Please wait for the upload to complete and save again.');
    }
    const url = toPublicAssetUrl(raw);
    if (!/^https?:\/\//i.test(url)) {
        throw new ValidationError('Invalid image URL. Please upload the image again.');
    }
    if (url.length > 2048) {
        throw new ValidationError('Image URL is too long. Please upload the image again.');
    }
    return url;
};

export const extractAssetUrls = (value) => {
    if (value == null || value === '') return [];
    if (Array.isArray(value)) {
        return [...new Set(value.flatMap(extractAssetUrls).filter(Boolean))];
    }
    const one = extractAssetUrl(value);
    return one ? [one] : [];
};

const encodeToWebp = async (buffer, { maxWidth, maxDimension } = {}) => {
    try {
        // rotate() with no angle applies the EXIF orientation. Phones store an
        // upright photo as landscape pixels plus an orientation tag; WebP output
        // drops the tag, so without this every portrait photo came out sideways.
        let pipeline = sharp(buffer, { animated: true, failOn: 'none' }).rotate();
        if (maxDimension) {
            // Bounds both edges, so tall and panoramic images are capped too.
            pipeline = pipeline.resize({
                width: maxDimension,
                height: maxDimension,
                fit: 'inside',
                withoutEnlargement: true,
            });
        } else if (maxWidth) {
            pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
        }
        const { data: out, info } = await pipeline
            .webp({ quality: 90, effort: 4 })
            .toBuffer({ resolveWithObject: true });
        if (!out?.length) {
            throw new Error('empty webp output');
        }
        // Report what was stored (after rotation/resize), not the input size.
        const height = info.pageHeight || info.height;
        return { buffer: out, ext: 'webp', width: info.width, height };
    } catch {
        // Checked only after decoding failed, so AVIF (same container) is unaffected.
        if (isHeicBuffer(buffer)) {
            throw new ValidationError(HEIC_UNSUPPORTED_MESSAGE);
        }
        throw new ValidationError('Could not convert image to WebP. Upload a valid image file.');
    }
};

/*
 * iPhone / Samsung "High Efficiency" photos. The prebuilt image library decodes
 * AVIF but not HEVC-coded HEIC, and every upload route funnels through here, so
 * the restaurant gets an instruction they can act on instead of a generic
 * "could not convert".
 */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
export const isHeicBuffer = (buffer) => {
    if (!buffer || buffer.length < 12) return false;
    if (buffer.toString('latin1', 4, 8) !== 'ftyp') return false;
    return HEIC_BRANDS.has(buffer.toString('latin1', 8, 12));
};
export const HEIC_UNSUPPORTED_MESSAGE =
    'This photo is in HEIC format, which cannot be processed. Please upload a JPG, PNG or WebP photo (on iPhone: Settings > Camera > Formats > Most Compatible).';

/*
 * Dish and add-on photos are shown at card / detail size; a full camera frame
 * (4000px, several MB) only slows every menu down on mobile data. The browser
 * already downsizes to 1024px before upload - this enforces a ceiling for
 * uploads that skip that step. Other folders (UPI QR codes, ID documents) are
 * never resized.
 */
const FOOD_IMAGE_FOLDER = /(^|\/)(foods|menu-items|addons)(\/|$)/i;
export const FOOD_IMAGE_MAX_DIMENSION = 2048;
export const maxDimensionForFolder = (folder) =>
    FOOD_IMAGE_FOLDER.test(String(folder || '')) ? FOOD_IMAGE_MAX_DIMENSION : undefined;

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
