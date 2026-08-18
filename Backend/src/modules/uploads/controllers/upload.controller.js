import { sendResponse } from '../../../utils/response.js';
import { ValidationError } from '../../../core/auth/errors.js';
import { storeImageBuffer, storeFileBuffer, deleteStoredAsset, extractAssetUrl } from '../../../services/storage.service.js';

const isVideoMime = (mime) => /^video\//i.test(String(mime || ''));

const storeUploadedFile = async (file, folder, replaceUrl) => {
    if (!file) {
        throw new ValidationError('No file uploaded');
    }

    const { buffer, mimetype, originalname } = file;
    const options = { replaceUrl, originalName: originalname, mimeType: mimetype };

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
        const replaceUrl = extractAssetUrl(req.body?.replaceUrl || req.body?.oldUrl);
        const result = await storeUploadedFile(req.file, folder, replaceUrl);
        return sendResponse(res, 201, 'File uploaded successfully', toUploadPayload(result));
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
        await deleteStoredAsset(url);
        return sendResponse(res, 200, 'File deleted successfully', { url });
    } catch (error) {
        next(error);
    }
};
