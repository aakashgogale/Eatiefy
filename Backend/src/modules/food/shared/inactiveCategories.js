import mongoose from 'mongoose';
import { FoodCategory } from '../admin/models/category.model.js';

/**
 * Categories a restaurant (or admin) has switched off.
 *
 * Turning a category off must hide its dishes everywhere a customer can find or
 * order them: restaurant menu, home rails, search, cart and checkout. Every one
 * of those reads food_items directly, so they all share this list.
 *
 * The set is tiny (only switched-off categories) and is cached briefly per
 * process; toggling a category clears it immediately on the process that
 * handled the change, and other processes pick it up within CACHE_MS.
 */

const CACHE_MS = 15 * 1000;
let cache = { at: 0, ids: [], idSet: new Set() };
let inflight = null;

export const invalidateInactiveCategoryCache = () => {
    cache = { at: 0, ids: [], idSet: new Set() };
};

export async function getInactiveCategoryIds() {
    if (Date.now() - cache.at < CACHE_MS) return cache;
    if (inflight) return inflight;
    inflight = FoodCategory.find({ isActive: false })
        .select('_id')
        .lean()
        .then((docs) => {
            const ids = docs.map((doc) => doc._id);
            cache = { at: Date.now(), ids, idSet: new Set(ids.map(String)) };
            return cache;
        })
        .finally(() => {
            inflight = null;
        });
    return inflight;
}

/**
 * Mongo clause excluding foods in switched-off categories, or null when none are
 * off. Foods without a category are unaffected (`$nin` matches a missing field).
 */
export async function buildActiveCategoryFoodClause() {
    const { ids } = await getInactiveCategoryIds();
    return ids.length ? { categoryId: { $nin: ids } } : null;
}

/** Adds the clause to a food filter in place (via $and) and returns it. */
export async function withActiveCategoryFilter(filter = {}) {
    const clause = await buildActiveCategoryFoodClause();
    if (!clause) return filter;
    filter.$and = [...(Array.isArray(filter.$and) ? filter.$and : []), clause];
    return filter;
}

export async function isFoodCategoryInactive(food) {
    const raw = food?.categoryId?._id || food?.categoryId;
    if (!raw || !mongoose.Types.ObjectId.isValid(String(raw))) return false;
    const { idSet } = await getInactiveCategoryIds();
    return idSet.has(String(raw));
}
