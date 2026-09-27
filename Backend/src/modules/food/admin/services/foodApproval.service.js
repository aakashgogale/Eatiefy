import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodItem } from '../models/food.model.js';
import { FoodAddon } from '../../restaurant/models/foodAddon.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodZone } from '../models/zone.model.js';
import { syncMenuItemApprovalStatus } from '../../restaurant/services/restaurantMenu.service.js';
import { getFoodDisplayPrice, serializeFoodVariants } from './foodVariant.service.js';

const toRestaurantDisplayId = (mongoId) => {
    const s = String(mongoId || '');
    return s.length >= 5 ? s.slice(-5) : s;
};

export async function listPendingFoodApprovals(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const foodFilter = { approvalStatus: 'pending' };
    const addonFilter = { approvalStatus: 'pending', isDeleted: { $ne: true } };

    if (query.restaurantId && mongoose.Types.ObjectId.isValid(String(query.restaurantId))) {
        foodFilter.restaurantId = new mongoose.Types.ObjectId(String(query.restaurantId));
        addonFilter.restaurantId = new mongoose.Types.ObjectId(String(query.restaurantId));
    }

    if (query.zoneId && mongoose.Types.ObjectId.isValid(String(query.zoneId))) {
        const zoneOid = new mongoose.Types.ObjectId(String(query.zoneId));
        // Find restaurants in this zone for fallback if older records don't have zoneId yet
        const matchingRestaurants = await FoodRestaurant.find({ zoneId: zoneOid }).select('_id').lean();
        const matchingRestIds = matchingRestaurants.map((r) => r._id);

        foodFilter.$or = [
            { zoneId: zoneOid },
            { zoneId: null, restaurantId: { $in: matchingRestIds } },
            { zoneId: { $exists: false }, restaurantId: { $in: matchingRestIds } }
        ];

        addonFilter.$or = [
            { zoneId: zoneOid },
            { zoneId: null, restaurantId: { $in: matchingRestIds } },
            { zoneId: { $exists: false }, restaurantId: { $in: matchingRestIds } }
        ];
    }

    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim().slice(0, 80);
        const searchRegex = { $regex: term, $options: 'i' };
        if (foodFilter.$or) {
            foodFilter.$and = [
                { $or: foodFilter.$or },
                { $or: [{ name: searchRegex }, { categoryName: searchRegex }] }
            ];
            delete foodFilter.$or;
        } else {
            foodFilter.$or = [
                { name: searchRegex },
                { categoryName: searchRegex }
            ];
        }

        if (addonFilter.$or) {
            addonFilter.$and = [
                { $or: addonFilter.$or },
                { 'draft.name': searchRegex }
            ];
            delete addonFilter.$or;
        } else {
            addonFilter['draft.name'] = searchRegex;
        }
    }

    const [foodList, addonList, foodTotal, addonTotal] = await Promise.all([
        FoodItem.find(foodFilter)
            .sort({ requestedAt: -1, createdAt: -1 })
            .select('restaurantId categoryName name price variants image foodType approvalStatus requestedAt createdAt actionType oldData newData description preparationTime zoneId')
            .lean(),
        FoodAddon.find(addonFilter)
            .sort({ requestedAt: -1, createdAt: -1 })
            .select('restaurantId draft isAvailable requestedAt createdAt zoneId')
            .lean(),
        FoodItem.countDocuments(foodFilter),
        FoodAddon.countDocuments(addonFilter),
    ]);

    const restaurantIds = Array.from(new Set([
        ...foodList.map((f) => String(f.restaurantId)),
        ...addonList.map((a) => String(a.restaurantId)),
    ].filter(Boolean)));

    const restaurants = restaurantIds.length
        ? await FoodRestaurant.find({ _id: { $in: restaurantIds } }).select('restaurantName zoneId').lean()
        : [];
    const restaurantMap = new Map(restaurants.map((r) => [String(r._id), r.restaurantName]));
    const restaurantZoneMap = new Map(restaurants.map((r) => [String(r._id), r.zoneId ? String(r.zoneId) : null]));

    const allZoneIds = Array.from(new Set([
        ...foodList.map((f) => f.zoneId ? String(f.zoneId) : restaurantZoneMap.get(String(f.restaurantId))),
        ...addonList.map((a) => a.zoneId ? String(a.zoneId) : restaurantZoneMap.get(String(a.restaurantId)))
    ].filter(Boolean)));

    const zones = allZoneIds.length
        ? await FoodZone.find({ _id: { $in: allZoneIds } }).select('name zoneName serviceLocation').lean()
        : [];
    const zoneMap = new Map(zones.map((z) => [String(z._id), z.name || z.zoneName || z.serviceLocation || 'Zone']));

    const foodRequests = foodList.map((f) => {
        const resolvedZoneId = f.zoneId ? String(f.zoneId) : (restaurantZoneMap.get(String(f.restaurantId)) || '');
        const resolvedZoneName = resolvedZoneId ? (zoneMap.get(resolvedZoneId) || '') : '';
        return {
            _id: f._id,
            id: f._id,
            entityType: 'food',
            type: 'food',
            restaurantName: restaurantMap.get(String(f.restaurantId)) || 'Unknown Restaurant',
            restaurantId: toRestaurantDisplayId(f.restaurantId),
            zoneId: resolvedZoneId,
            zoneName: resolvedZoneName,
            category: f.categoryName || '',
            itemName: f.name,
            foodType: f.foodType || 'Non-Veg',
            sectionName: f.categoryName || '',
            subsectionName: '',
            approvalStatus: f.approvalStatus || 'pending',
            price: getFoodDisplayPrice(f),
            variants: serializeFoodVariants(f.variants),
            image: f.image || '',
            images: f.image ? [f.image] : [],
            requestedAt: f.requestedAt || f.createdAt,
            isActionable: (f.approvalStatus || 'pending') === 'pending',
            actionType: f.actionType,
            oldData: f.oldData,
            newData: f.newData,
            description: f.description || '',
            preparationTime: f.preparationTime || '',
        };
    });

    const addonRequests = addonList.map((a) => {
        const resolvedZoneId = a.zoneId ? String(a.zoneId) : (restaurantZoneMap.get(String(a.restaurantId)) || '');
        const resolvedZoneName = resolvedZoneId ? (zoneMap.get(resolvedZoneId) || '') : '';
        return {
            _id: a._id,
            id: a._id,
            entityType: 'addon',
            type: 'addon',
            restaurantName: restaurantMap.get(String(a.restaurantId)) || 'Unknown Restaurant',
            restaurantId: toRestaurantDisplayId(a.restaurantId),
            zoneId: resolvedZoneId,
            zoneName: resolvedZoneName,
            category: 'Add-on',
            itemName: a.draft?.name || 'Unnamed Add-on',
            foodType: 'Add-on',
            sectionName: 'Add-on',
            subsectionName: '',
            approvalStatus: 'pending',
            price: a.draft?.price ?? 0,
            image: a.draft?.image || (a.draft?.images && a.draft.images[0]) || '',
            images: a.draft?.images || (a.draft?.image ? [a.draft.image] : []),
            requestedAt: a.requestedAt || a.createdAt,
            isActionable: true,
            description: a.draft?.description || '',
        };
    });

    const allRequests = [...foodRequests, ...addonRequests].sort(
        (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
    );

    const total = foodTotal + addonTotal;
    const requests = allRequests.slice(skip, skip + limit);

    return { requests, page, limit, total };
}

export async function approveFoodItem(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
        throw new ValidationError('Invalid food id');
    }
    const updated = await FoodItem.findOneAndUpdate(
        { _id: id, approvalStatus: 'pending' },
        { $set: { approvalStatus: 'approved', approvedAt: new Date(), rejectedAt: null, rejectionReason: '' } },
        { new: true }
    ).lean();
    if (updated?.restaurantId) {
        // Single DB update; makes user-facing menu reflect approval immediately.
        await syncMenuItemApprovalStatus(updated.restaurantId, updated._id, 'approved', '');
        
        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely(
                [{ ownerType: 'RESTAURANT', ownerId: updated.restaurantId }],
                {
                    title: 'Dish Approved! 🍲',
                    body: `Your dish "${updated.name}" has been approved and is now visible to customers.`,
                    image: updated.image || 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                    sendToAllDevices: true,
                    data: {
                        type: 'food_approved',
                        foodId: String(updated._id),
                        restaurantId: String(updated.restaurantId),
                        targetUrl: '/food/restaurant',
                        link: '/food/restaurant',
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send food approval notification:', e);
        }
    }
    return updated;
}

export async function rejectFoodItem(id, reason) {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
        throw new ValidationError('Invalid food id');
    }
    const r = typeof reason === 'string' ? reason.trim() : '';
    if (!r) throw new ValidationError('Rejection reason is required');
    if (r.length > 500) throw new ValidationError('Rejection reason is too long');

    const updated = await FoodItem.findOneAndUpdate(
        { _id: id, approvalStatus: 'pending' },
        { $set: { approvalStatus: 'rejected', rejectedAt: new Date(), rejectionReason: r, approvedAt: null } },
        { new: true }
    ).lean();
    if (updated?.restaurantId) {
        await syncMenuItemApprovalStatus(updated.restaurantId, updated._id, 'rejected', r);
        
        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely(
                [{ ownerType: 'RESTAURANT', ownerId: updated.restaurantId }],
                {
                    title: 'Dish Rejected ❌',
                    body: `Your dish "${updated.name}" was rejected. Reason: ${r}`,
                    image: updated.image || 'https://i.ibb.co/3m2Yh7r/Eatiefy-Brand-Image.png',
                    sendToAllDevices: true,
                    data: {
                        type: 'food_rejected',
                        foodId: String(updated._id),
                        restaurantId: String(updated.restaurantId),
                        reason: r,
                        targetUrl: '/food/restaurant',
                        link: '/food/restaurant',
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send food rejection notification:', e);
        }
    }
    return updated;
}
