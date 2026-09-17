import mongoose from 'mongoose';
import { buildZoneServiceabilityClause, resolveServiceZone } from '../../shared/zoneLocation.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { getFoodDisplayOtherPrice, getFoodDisplayPrice } from '../../admin/services/foodVariant.service.js';
import { EATIEFY_99_PRICE, buildEatiefy99CandidateFilter, selectEatiefy99Foods } from '../utils/eatiefy99.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildCategoryKeywords = (categorySlug) => {
    const raw = String(categorySlug || '').trim().toLowerCase();
    if (!raw || raw === 'all') return [];

    const normalized = raw.replace(/&/g, ' and ').replace(/-/g, ' ').trim();
    const words = normalized.split(/\s+/).filter(Boolean);
    return [...new Set([raw, normalized, ...words])];
};

/**
 * Approved, available foods across approved restaurants in a zone.
 * Powers the user home "Meals under 99" rail and the category/search pages.
 */
export async function listPublicFoods(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 500, 1), 1000);
    const zoneIdRaw = String(query.zoneId || '').trim();
    const categorySlug = String(query.categorySlug || query.category || '').trim().toLowerCase();
    const promo = String(query.promo || query.promoSlug || '').trim().toLowerCase();
    // Eatiefy ₹99 section: only items selling at ₹99 or below (no client override).
    const isEatiefyPromo = promo === 'eatiefy' || promo === 'under-250' || promo === 'under250';
    const promoMeta = isEatiefyPromo ? { targetPrice: EATIEFY_99_PRICE } : {};

    // Only approved restaurants that are live right now. `$ne: false` (rather
    // than `=== true`) keeps legacy records that never had the flag set, so an
    // open restaurant is never hidden by missing data.
    const restaurantFilter = {
        status: 'approved',
        isActive: { $ne: false },
        isAcceptingOrders: { $ne: false }
    };

    // Same serviceability rule as the restaurant listing: only restaurants in the
    // caller's service zone, and nothing at all when no zone can be resolved —
    // this rail must never surface food from an out-of-zone restaurant.
    const serviceZone = await resolveServiceZone({
        zoneId: zoneIdRaw,
        lat: query.lat,
        lng: query.lng
    });
    if (serviceZone) {
        restaurantFilter.$and = [buildZoneServiceabilityClause(serviceZone)];
    } else if (String(query.allowUnzoned || '') !== 'true') {
        return { foods: [], total: 0, requiresLocation: true, ...promoMeta };
    }

    const restaurants = await FoodRestaurant.find(restaurantFilter)
        .select('_id restaurantName zoneId profileImage rating estimatedDeliveryTime isActive isAcceptingOrders')
        .lean();

    if (!restaurants.length) {
        return { foods: [], total: 0, ...promoMeta };
    }

    const restaurantMap = new Map(
        restaurants.map((restaurant) => [String(restaurant._id), restaurant])
    );
    const restaurantIds = restaurants.map((restaurant) => restaurant._id);

    const foodFilter = {
        restaurantId: { $in: restaurantIds },
        approvalStatus: 'approved',
        isAvailable: { $ne: false }
    };

    const keywords = buildCategoryKeywords(categorySlug);
    if (keywords.length > 0) {
        foodFilter.$or = keywords.flatMap((keyword) => {
            const rx = escapeRegex(keyword);
            return [
                { name: { $regex: rx, $options: 'i' } },
                { categoryName: { $regex: rx, $options: 'i' } }
            ];
        });
    }
    if (isEatiefyPromo) {
        // Narrow at the database; both $or clauses must hold, so combine with $and.
        foodFilter.$and = [buildEatiefy99CandidateFilter()];
    }

    let list = await FoodItem.find(foodFilter)
        .sort({ createdAt: -1 })
        .limit(isEatiefyPromo ? Math.max(limit, 2000) : limit)
        .lean();

    if (isEatiefyPromo) {
        list = await selectEatiefy99Foods(list);
    }

    const foods = list
        .map((food) => {
            const restaurant = restaurantMap.get(String(food.restaurantId));
            return {
                id: food._id,
                _id: food._id,
                restaurantId: food.restaurantId,
                restaurantName: restaurant?.restaurantName || 'Unknown Restaurant',
                categoryId: food.categoryId || null,
                categoryName: food.categoryName || '',
                category: food.categoryName || '',
                name: food.name,
                description: food.description || '',
                // Promo items are already priced with live pricing rules (selling price).
                price: isEatiefyPromo ? food.price : getFoodDisplayPrice(food),
                otherPrice: getFoodDisplayOtherPrice(food),
                ...(isEatiefyPromo ? { variants: food.variants } : {}),
                image: food.image || '',
                foodType: food.foodType || 'Non-Veg',
                isAvailable: food.isAvailable !== false,
                preparationTime: food.preparationTime || '',
                approvalStatus: food.approvalStatus || 'approved'
            };
        })
        .filter((food) => food.isAvailable !== false)
        .slice(0, limit);

    return { foods, total: foods.length, ...promoMeta };
}
