import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';

const toTrimmedString = (value) => (value == null ? '' : String(value).trim());

export const extractRawFoodVariants = (value = {}) => {
    if (Array.isArray(value?.variants)) return value.variants;
    if (Array.isArray(value?.variations)) return value.variations;
    return [];
};

export const normalizeFoodVariantsInput = (value = [], options = {}) => {
    const {
        allowEmpty = true,
        priceLabel = 'Variant price'
    } = options;

    if (value == null || value === '') {
        if (allowEmpty) return [];
        throw new ValidationError('At least one variant is required');
    }

    if (!Array.isArray(value)) {
        throw new ValidationError('Variants must be an array');
    }

    const normalized = value
        .map((entry = {}) => {
            const name = toTrimmedString(entry?.name);
            if (!name) {
                throw new ValidationError('Each variant must have a name');
            }

            const price = Number(entry?.price);
            if (!Number.isFinite(price) || price <= 0) {
                throw new ValidationError(`${priceLabel} must be greater than 0`);
            }

            const variant = {
                name,
                price
            };

            const variantId = entry?._id || entry?.id;
            if (variantId && mongoose.Types.ObjectId.isValid(String(variantId))) {
                variant._id = new mongoose.Types.ObjectId(String(variantId));
            }

            return variant;
        })
        .filter(Boolean);

    if (!allowEmpty && normalized.length === 0) {
        throw new ValidationError('At least one variant is required');
    }

    return normalized;
};

export const serializeFoodVariants = (value = []) =>
    (Array.isArray(value) ? value : [])
        .map((entry = {}, index) => {
            const name = toTrimmedString(entry?.name);
            const price = Number(entry?.price);
            if (!name || !Number.isFinite(price) || price <= 0) return null;

            const variantId = String(entry?._id || entry?.id || `variant-${index}`);
            return {
                id: variantId,
                _id: variantId,
                name,
                price
            };
        })
        .filter(Boolean);

export const hasFoodVariants = (value = {}) => serializeFoodVariants(value?.variants || value?.variations || []).length > 0;

/**
 * The admin price override in force for this item, or null. Items with variants
 * are charged per variant, so an item-level override never applies to them.
 * Only present on documents queried with `+adminPrice`.
 */
export const getFoodAdminPrice = (value = {}) => {
    if (value?.adminPrice == null || value.adminPrice === '' || hasFoodVariants(value)) return null;
    const adminPrice = Number(value.adminPrice);
    return Number.isFinite(adminPrice) && adminPrice > 0 ? adminPrice : null;
};

/**
 * What the restaurant is shown: the effective price, never the override itself
 * (nor that one exists).
 */
export const toRestaurantFacingFood = (food) => {
    if (!food || typeof food !== 'object') return food;
    const { adminPrice: _adminPrice, ...visible } = food;
    const override = getFoodAdminPrice(food);
    return override != null ? { ...visible, price: override } : visible;
};

/** Effective price shown and charged: the admin override when set, else the restaurant's. */
export const getFoodDisplayPrice = (value = {}) => {
    const adminPrice = getFoodAdminPrice(value);
    if (adminPrice != null) return adminPrice;

    const price = Number(value?.price);
    if (Number.isFinite(price) && price > 0) {
        return price;
    }

    const variants = serializeFoodVariants(value?.variants || value?.variations || []);
    if (variants.length > 0) {
        return Math.min(...variants.map((entry) => Number(entry.price) || 0));
    }

    return 0;
};

/** @deprecated Legacy compare-at removed — always returns 0. */
export const getFoodDisplayOtherPrice = () => 0;
