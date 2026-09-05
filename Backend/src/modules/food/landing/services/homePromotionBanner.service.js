import { HomePromotionBanner } from '../models/homePromotionBanner.model.js';
import { storeImageBuffer, deleteStoredAsset } from '../../../../services/storage.service.js';

const BANNER_FOLDER = 'food/home-promotion-banners';

const toDateOrNull = (value) => (value && value !== '' ? new Date(value) : null);

export const listHomePromotionBanners = async (zoneId = null) => {
    const query = zoneId ? { zoneId } : {};
    return HomePromotionBanner.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
};

/**
 * Active banners for the user home carousel, filtered by the optional schedule
 * window. A banner with no startDate/endDate is always in-window.
 */
export const getPublicHomePromotionBanners = async (zoneId = null) => {
    const now = new Date();
    const filter = {
        isActive: true,
        $and: [
            {
                $or: [
                    { startDate: { $lte: now } },
                    { startDate: null },
                    { startDate: { $exists: false } }
                ]
            },
            {
                $or: [
                    { endDate: { $gte: now } },
                    { endDate: null },
                    { endDate: { $exists: false } }
                ]
            }
        ]
    };

    // Fall back to global banners when a zone has none of its own.
    if (zoneId) {
        const zoneBanners = await HomePromotionBanner.find({ ...filter, zoneId })
            .sort({ sortOrder: 1, createdAt: -1 })
            .lean();
        if (zoneBanners.length) return zoneBanners;
    }

    return HomePromotionBanner.find({ ...filter, zoneId: null })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();
};

const createOne = async (file, meta = {}, sortOrder = 0) => {
    const uploadResult = await storeImageBuffer(file.buffer, BANNER_FOLDER);

    return HomePromotionBanner.create({
        imageUrl: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        title: meta.title,
        ctaLink: meta.ctaLink,
        zoneId: meta.zoneId || null,
        startDate: toDateOrNull(meta.startDate),
        endDate: toDateOrNull(meta.endDate),
        sortOrder,
        isActive: true
    });
};

export const createHomePromotionBanner = async (file, meta = {}) => {
    if (!file) return null;
    return createOne(file, meta, meta.sortOrder ?? 0);
};

/**
 * Bulk upload. Each file becomes its own banner so the user-side carousel has
 * several slides to rotate through. Sort order continues after the last banner
 * so newly uploaded images keep the order they were selected in.
 */
export const createHomePromotionBannersFromFiles = async (files, meta = {}) => {
    if (!files || !files.length) {
        return [];
    }

    const last = await HomePromotionBanner.findOne(meta.zoneId ? { zoneId: meta.zoneId } : {})
        .sort({ sortOrder: -1 })
        .lean();
    let nextOrder = meta.sortOrder != null ? Number(meta.sortOrder) : (last?.sortOrder ?? -1) + 1;

    const results = [];
    for (const file of files) {
        try {
            const banner = await createOne(file, meta, nextOrder);
            nextOrder += 1;
            results.push({ success: true, banner: banner.toObject() });
        } catch (error) {
            results.push({ success: false, error: error.message });
        }
    }

    return results;
};

export const updateHomePromotionBanner = async (id, data) => {
    const updateData = { ...data };
    if (data.startDate !== undefined) updateData.startDate = toDateOrNull(data.startDate);
    if (data.endDate !== undefined) updateData.endDate = toDateOrNull(data.endDate);

    return HomePromotionBanner.findByIdAndUpdate(id, updateData, { new: true }).lean();
};

export const deleteHomePromotionBanner = async (id) => {
    const doc = await HomePromotionBanner.findById(id);
    if (!doc) return { deleted: false };

    // Never let a failed file cleanup block the record deletion.
    await deleteStoredAsset(doc.imageUrl || doc.publicId);

    await doc.deleteOne();
    return { deleted: true };
};

export const toggleHomePromotionBannerStatus = async (id, isActive) => {
    const banner = await HomePromotionBanner.findById(id);
    if (!banner) return null;

    banner.isActive = typeof isActive === 'boolean' ? isActive : !banner.isActive;
    await banner.save();
    return banner.toObject();
};

export const updateHomePromotionBannerOrder = async (id, sortOrder) => {
    return HomePromotionBanner.findByIdAndUpdate(id, { sortOrder }, { new: true }).lean();
};
