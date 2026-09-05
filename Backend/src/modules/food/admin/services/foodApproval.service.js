import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodItem } from '../models/food.model.js';
import { FoodAddon } from '../../restaurant/models/foodAddon.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
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
    const addonFilter = { approvalStatus: 'pending' };

    if (query.restaurantId && mongoose.Types.ObjectId.isValid(String(query.restaurantId))) {
        foodFilter.restaurantId = query.restaurantId;
        addonFilter.restaurantId = query.restaurantId;
    }

    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim().slice(0, 80);
        foodFilter.$or = [
            { name: { $regex: term, $options: 'i' } },
            { categoryName: { $regex: term, $options: 'i' } },
        ];
        addonFilter['draft.name'] = { $regex: term, $options: 'i' };
    }

    const [foodList, addonList, foodTotal, addonTotal] = await Promise.all([
        FoodItem.find(foodFilter)
            .sort({ requestedAt: -1, createdAt: -1 })
            .select('restaurantId categoryName name price variants image foodType approvalStatus requestedAt createdAt actionType oldData newData description preparationTime')
            .lean(),
        FoodAddon.find(addonFilter)
            .sort({ requestedAt: -1, createdAt: -1 })
            .select('restaurantId draft isAvailable requestedAt createdAt')
            .lean(),
        FoodItem.countDocuments(foodFilter),
        FoodAddon.countDocuments(addonFilter),
    ]);

    const restaurantIds = Array.from(new Set([
        ...foodList.map((f) => String(f.restaurantId)),
        ...addonList.map((a) => String(a.restaurantId)),
    ].filter(Boolean)));

    const restaurants = restaurantIds.length
        ? await FoodRestaurant.find({ _id: { $in: restaurantIds } }).select('restaurantName').lean()
        : [];
    const restaurantMap = new Map(restaurants.map((r) => [String(r._id), r.restaurantName]));

    const foodRequests = foodList.map((f) => ({
        _id: f._id,
        id: f._id,
        entityType: 'food',
        type: 'food',
        restaurantName: restaurantMap.get(String(f.restaurantId)) || 'Unknown Restaurant',
        restaurantId: toRestaurantDisplayId(f.restaurantId),
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
    }));

    const addonRequests = addonList.map((a) => ({
        _id: a._id,
        id: a._id,
        entityType: 'addon',
        type: 'addon',
        restaurantName: restaurantMap.get(String(a.restaurantId)) || 'Unknown Restaurant',
        restaurantId: toRestaurantDisplayId(a.restaurantId),
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
    }));

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
                    image: updated.image || 'https://i.ibb.co/3m2Yh7r/Appzeto-Brand-Image.png',
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
                    image: updated.image || 'https://i.ibb.co/3m2Yh7r/Appzeto-Brand-Image.png',
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
