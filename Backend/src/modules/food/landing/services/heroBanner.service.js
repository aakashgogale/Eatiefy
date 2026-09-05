import { FoodHeroBanner } from '../models/heroBanner.model.js';
import { storeImageBuffer, deleteStoredAsset } from '../../../../services/storage.service.js';

export const listHeroBanners = async (zoneId = null) => {
    let query = zoneId ? { zoneId } : { zoneId: null };
    const banners = await FoodHeroBanner.find(query)
        .populate({
            path: 'linkedRestaurantIds',
            select: 'restaurantName name restaurantId profileImage rating'
        })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();

    return banners.map((b) => {
        const { linkedRestaurantIds, ...rest } = b;
        const linked = Array.isArray(linkedRestaurantIds)
            ? linkedRestaurantIds.map((r) => {
                if (typeof r === 'object' && r !== null) {
                    return {
                        ...r,
                        name: r.restaurantName || r.name || ''
                    };
                }
                return r;
            })
            : [];
        return {
            ...rest,
            linkedRestaurants: linked
        };
    });
};

export const createHeroBannersFromFiles = async (files, meta = {}) => {
    if (!files || !files.length) {
        return [];
    }

    const results = [];

    for (const file of files) {
        try {
            const uploadResult = await storeImageBuffer(file.buffer, 'food/hero-banners');

            const banner = await FoodHeroBanner.create({
                imageUrl: uploadResult.secure_url,
                publicId: uploadResult.public_id,
                title: meta.title,
                ctaText: meta.ctaText,
                ctaLink: meta.ctaLink,
                linkedRestaurantIds: meta.linkedRestaurantIds || [],
                sortOrder: meta.sortOrder ?? 0,
                zoneId: meta.zoneId || null,
                isActive: true
            });

            results.push({ success: true, banner: banner.toObject() });
        } catch (error) {
            results.push({ success: false, error: error.message });
        }
    }

    return results;
};

export const linkRestaurantsToHeroBanner = async (id, restaurantIds) => {
    const updatedBanner = await FoodHeroBanner.findByIdAndUpdate(
        id,
        { linkedRestaurantIds: restaurantIds },
        { new: true }
    )
        .populate({
            path: 'linkedRestaurantIds',
            select: 'restaurantName name restaurantId profileImage rating'
        })
        .lean();

    if (!updatedBanner) return null;

    const { linkedRestaurantIds, ...rest } = updatedBanner;
    const linked = Array.isArray(linkedRestaurantIds)
        ? linkedRestaurantIds.map((r) => {
            if (typeof r === 'object' && r !== null) {
                return {
                    ...r,
                    name: r.restaurantName || r.name || ''
                };
            }
            return r;
        })
        : [];
    return {
        ...rest,
        linkedRestaurants: linked
    };
};

export const deleteHeroBanner = async (id) => {
    const doc = await FoodHeroBanner.findById(id);
    if (!doc) {
        return { deleted: false };
    }

    // Never let a failed file cleanup block the record deletion.
    await deleteStoredAsset(doc.imageUrl || doc.publicId);

    await doc.deleteOne();
    return { deleted: true };
};

export const updateHeroBannerOrder = async (id, sortOrder) => {
    const updated = await FoodHeroBanner.findByIdAndUpdate(
        id,
        { sortOrder },
        { new: true }
    ).lean();
    return updated;
};

export const toggleHeroBannerStatus = async (id, isActive) => {
    const banner = await FoodHeroBanner.findById(id);
    if (!banner) return null;

    const newStatus = typeof isActive === 'boolean' ? isActive : !banner.isActive;
    banner.isActive = newStatus;
    await banner.save();
    return banner.toObject();
};

