import { FoodDiningBanner } from '../models/diningBanner.model.js';
import { storeImageBuffer, deleteStoredAsset } from '../../../../services/storage.service.js';

export const listDiningBanners = async (zoneId = null) => {
    let query = zoneId ? { zoneId } : { zoneId: null };
    return FoodDiningBanner.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
};

export const createDiningBannersFromFiles = async (files, meta = {}) => {
    if (!files || !files.length) {
        return [];
    }

    const results = [];

    for (const file of files) {
        try {
            const uploadResult = await storeImageBuffer(file.buffer, 'food/dining-banners');

            const banner = await FoodDiningBanner.create({
                imageUrl: uploadResult.secure_url,
                publicId: uploadResult.public_id,
                title: meta.title,
                ctaText: meta.ctaText,
                ctaLink: meta.ctaLink,
                diningType: meta.diningType,
                zoneId: meta.zoneId,
                sortOrder: meta.sortOrder ?? 0,
                isActive: true,
            });

            results.push({ success: true, banner: banner.toObject() });
        } catch (error) {
            results.push({ success: false, error: error.message });
        }
    }

    return results;
};

export const deleteDiningBanner = async (id) => {
    const doc = await FoodDiningBanner.findById(id);
    if (!doc) {
        return { deleted: false };
    }

    // Never let a failed file cleanup block the record deletion.
    await deleteStoredAsset(doc.imageUrl || doc.publicId);

    await doc.deleteOne();
    return { deleted: true };
};

export const updateDiningBannerOrder = async (id, sortOrder) => {
    const updated = await FoodDiningBanner.findByIdAndUpdate(
        id,
        { sortOrder },
        { new: true }
    ).lean();
    return updated;
};

export const toggleDiningBannerStatus = async (id, isActive) => {
    const updated = await FoodDiningBanner.findByIdAndUpdate(
        id,
        { isActive },
        { new: true }
    ).lean();
    return updated;
};

