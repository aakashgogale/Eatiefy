import {
    FoodDeliveryOnboardingDraft,
    DELIVERY_ONBOARDING_DRAFT_TTL_DAYS
} from '../models/deliveryOnboardingDraft.model.js';
import { storeImageBuffer, deleteStoredAsset, extractAssetUrl } from '../../../../services/storage.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';

/** Same storage folders the multipart /register endpoint uses. */
export const DELIVERY_DOC_FOLDERS = {
    profilePhoto: 'food/delivery/profile',
    aadharPhoto: 'food/delivery/aadhar',
    panPhoto: 'food/delivery/pan',
    drivingLicensePhoto: 'food/delivery/license'
};

export const DELIVERY_DRAFT_FIELDS = Object.keys(DELIVERY_DOC_FOLDERS);

// Phone photos arrive at full camera resolution when on-device compression fails
// (common on iOS WebViews). Downscale on the server so every document is stored at a
// readable, consistent size regardless of what the device managed to do.
export const DELIVERY_DOC_MAX_WIDTH = 2048;

const DOC_LABELS = {
    profilePhoto: 'profile photo',
    aadharPhoto: 'Aadhar card photo',
    panPhoto: 'PAN card photo',
    drivingLicensePhoto: 'driving license photo'
};

/** ISO-BMFF `ftyp` box with a HEIC/HEIF brand (AVIF, which decodes fine, is excluded). */
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const isHeicBuffer = (buffer) => {
    if (!buffer || buffer.length < 12) return false;
    if (buffer.toString('latin1', 4, 8) !== 'ftyp') return false;
    return HEIC_BRANDS.has(buffer.toString('latin1', 8, 12));
};

const nextExpiry = () =>
    new Date(Date.now() + DELIVERY_ONBOARDING_DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000);

const assertField = (field) => {
    const value = String(field || '').trim();
    if (!DELIVERY_DRAFT_FIELDS.includes(value)) {
        throw new ValidationError(`Invalid document type. Allowed: ${DELIVERY_DRAFT_FIELDS.join(', ')}`);
    }
    return value;
};

const toUploadsPayload = (doc) => {
    const uploads = doc?.uploads || {};
    return DELIVERY_DRAFT_FIELDS.reduce((acc, field) => {
        acc[field] = uploads[field] || '';
        return acc;
    }, {});
};

const safeDelete = async (url) => {
    if (!url) return;
    try {
        await deleteStoredAsset(url);
    } catch (err) {
        logger.warn(`[DeliveryDraft] Failed to delete asset ${url}: ${err?.message || err}`);
    }
};

export const getDeliveryDraftUploads = async (phoneLast10) => {
    const doc = await FoodDeliveryOnboardingDraft.findOne({ phoneLast10 }).lean();
    return toUploadsPayload(doc);
};

/** Stores one signup document on the server and records it; replaces (and deletes) the previous file. */
export const addDeliveryDraftUpload = async (phoneLast10, rawField, file) => {
    const field = assertField(rawField);
    if (!file?.buffer?.length) {
        throw new ValidationError('No file uploaded');
    }

    let stored;
    try {
        stored = await storeImageBuffer(file.buffer, DELIVERY_DOC_FOLDERS[field], {
            originalName: file.originalname,
            mimeType: file.mimetype,
            maxWidth: DELIVERY_DOC_MAX_WIDTH
        });
    } catch (error) {
        // The server's image library cannot decode iPhone HEIC; give an actionable
        // message instead of the generic "could not convert" one.
        if (isHeicBuffer(file.buffer)) {
            throw new ValidationError('HEIC photos are not supported. Please upload a JPG, PNG or WebP photo.');
        }
        throw error;
    }
    const url = stored.url || stored.secure_url;
    if (!url) {
        throw new ValidationError('Upload failed: storage returned no URL');
    }

    const previous = await FoodDeliveryOnboardingDraft.findOneAndUpdate(
        { phoneLast10 },
        { $set: { [`uploads.${field}`]: url, expiresAt: nextExpiry() } },
        { upsert: true, new: false }
    ).lean();
    const previousUrl = previous?.uploads?.[field];
    if (previousUrl && previousUrl !== url) {
        await safeDelete(previousUrl);
    }

    const current = await FoodDeliveryOnboardingDraft.findOne({ phoneLast10 }).lean();
    return { url, field, uploads: toUploadsPayload(current) };
};

/** Removes one uploaded document. Only a file recorded in this phone's draft is ever deleted. */
export const removeDeliveryDraftUpload = async (phoneLast10, rawField, rawUrl) => {
    const field = assertField(rawField);
    const url = extractAssetUrl(rawUrl);
    if (!url) {
        throw new ValidationError('Image url is required');
    }
    const updated = await FoodDeliveryOnboardingDraft.findOneAndUpdate(
        { phoneLast10, [`uploads.${field}`]: url },
        { $set: { [`uploads.${field}`]: '' } },
        { new: true }
    ).lean();
    if (updated) {
        await safeDelete(url);
        return toUploadsPayload(updated);
    }
    return getDeliveryDraftUploads(phoneLast10);
};

/**
 * Resolves `<field>Url` references in a /register submission. A URL is accepted
 * only if it is the one recorded in this phone's draft, so a submission can never
 * attach arbitrary or someone else's files.
 */
export const resolveDeliveryDraftImagesForRegistration = async (phoneLast10, body = {}) => {
    const requested = DELIVERY_DRAFT_FIELDS.reduce((acc, field) => {
        acc[field] = extractAssetUrl(body?.[`${field}Url`]);
        return acc;
    }, {});
    const resolved = DELIVERY_DRAFT_FIELDS.reduce((acc, field) => {
        acc[field] = '';
        return acc;
    }, {});
    if (!phoneLast10 || !Object.values(requested).some(Boolean)) return resolved;

    const draft = await getDeliveryDraftUploads(phoneLast10);
    for (const field of DELIVERY_DRAFT_FIELDS) {
        const url = requested[field];
        if (!url) continue;
        if (url !== draft[field]) {
            throw new ValidationError(`Your uploaded ${DOC_LABELS[field]} is no longer available. Please upload it again.`);
        }
        resolved[field] = url;
    }
    return resolved;
};

/** Drops the draft after registration. Files stay: the partner record now references them. */
export const clearDeliveryDraft = async (phoneLast10) => {
    if (!phoneLast10) return;
    try {
        await FoodDeliveryOnboardingDraft.deleteOne({ phoneLast10 });
    } catch (err) {
        logger.warn(`[DeliveryDraft] Failed to clear draft for ${phoneLast10}: ${err?.message || err}`);
    }
};
