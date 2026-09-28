import mongoose from 'mongoose';
import { sendResponse, sendError } from '../../../utils/response.js';
import { ValidationError } from '../../../core/auth/errors.js';
import { storeImageBuffer, storeFileBuffer, deleteStoredAsset, extractAssetUrl, maxDimensionForFolder, resolveStoredFilename } from '../../../services/storage.service.js';
import { isFoodImageInUse } from '../../../services/assetReferences.service.js';
import { FoodUploadOwner } from '../models/uploadOwner.model.js';
import { logger } from '../../../utils/logger.js';

const isVideoMime = (mime) => /^video\//i.test(String(mime || ''));

const isAdminRole = (role) => ['ADMIN', 'SUB_ADMIN'].includes(String(role || '').toUpperCase());

/**
 * May the caller delete / replace the file behind `url`? The internal routes
 * carry no req.user (they are authenticated by the upload secret) and admins
 * manage every asset; anyone else only files they uploaded themselves.
 */
const canManageAsset = async (req, url) => {
    if (!req.user) return true;
    if (isAdminRole(req.user.role)) return true;
    const filename = await resolveStoredFilename(url);
    if (!filename) return false;
    const owner = await FoodUploadOwner.findOne({ filename }).select('ownerId').lean();
    return Boolean(owner && String(owner.ownerId) === String(req.user.userId));
};

const recordUploadOwner = async (req, url) => {
    if (!req.user?.userId || !mongoose.Types.ObjectId.isValid(req.user.userId)) return;
    try {
        const filename = await resolveStoredFilename(url);
        if (!filename) return;
        await FoodUploadOwner.updateOne(
            { filename },
            { $setOnInsert: { filename, ownerId: req.user.userId, ownerRole: String(req.user.role || '') } },
            { upsert: true }
        );
    } catch (err) {
        // Never fail the upload itself; the file just stays admin-managed.
        logger.warn(`Failed to record upload owner for ${url}: ${err?.message || err}`);
    }
};

const storeUploadedFile = async (file, folder, replaceUrl) => {
    if (!file) {
        throw new ValidationError('No file uploaded');
    }

    const { buffer, mimetype, originalname } = file;
    const options = {
        replaceUrl,
        originalName: originalname,
        mimeType: mimetype,
        maxDimension: maxDimensionForFolder(folder),
    };

    return isVideoMime(mimetype)
        ? storeFileBuffer(buffer, folder, originalname, options)
        : storeImageBuffer(buffer, folder, options);
};

const toUploadPayload = (result) => ({
    url: result.url || result.secure_url,
    secure_url: result.secure_url || result.url,
    publicId: result.public_id,
    public_id: result.public_id,
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height
});

export const uploadImageController = async (req, res, next) => {
    try {
        const folder = String(req.body?.folder || 'uploads').trim() || 'uploads';
        let replaceUrl = extractAssetUrl(req.body?.replaceUrl || req.body?.oldUrl);
        // A replaced file that a live dish or add-on still shows is kept: the
        // new upload is not saved onto that item yet, and may never be.
        if (replaceUrl && (await isFoodImageInUse(replaceUrl))) replaceUrl = '';
        // Someone else's file is never removed as a side effect of an upload.
        if (replaceUrl && !(await canManageAsset(req, replaceUrl))) replaceUrl = '';
        const result = await storeUploadedFile(req.file, folder, replaceUrl);
        const payload = toUploadPayload(result);
        await recordUploadOwner(req, payload.url);
        return sendResponse(res, 201, 'File uploaded successfully', payload);
    } catch (error) {
        next(error);
    }
};

export const deleteUploadController = async (req, res, next) => {
    try {
        const url = extractAssetUrl(req.body?.url || req.query?.url);
        if (!url) {
            throw new ValidationError('Image url is required');
        }
        // Clients use this to discard uploads they never saved. It must not be
        // able to remove a file a saved dish still displays to customers.
        if (await isFoodImageInUse(url)) {
            return sendError(res, 409, 'File is still in use by a menu item and was not deleted');
        }
        if (!(await canManageAsset(req, url))) {
            return sendError(res, 403, 'You can only delete files you uploaded');
        }
        await deleteStoredAsset(url);
        return sendResponse(res, 200, 'File deleted successfully', { url });
    } catch (error) {
        next(error);
    }
};
