/**
 * Restaurant/business types used for one-time onboarding pricing.
 *
 * The values are stable slugs persisted on the restaurant document; labels are
 * for display only. Base prices here are the last-resort fallback used when an
 * admin has configured neither a zone rule nor a global rule — admins manage
 * live pricing through FoodOnboardingPricingRule.
 */
export const RESTAURANT_TYPES = Object.freeze({
    FAMILY_RESTAURANT: 'family_restaurant',
    CAFE: 'cafe',
    CLOUD_KITCHEN: 'cloud_kitchen',
    STREET_FOOD: 'street_food'
});

export const RESTAURANT_TYPE_VALUES = Object.freeze(Object.values(RESTAURANT_TYPES));

export const RESTAURANT_TYPE_LABELS = Object.freeze({
    [RESTAURANT_TYPES.FAMILY_RESTAURANT]: 'Family Restaurant',
    [RESTAURANT_TYPES.CAFE]: 'Cafe',
    [RESTAURANT_TYPES.CLOUD_KITCHEN]: 'Cloud Kitchen',
    [RESTAURANT_TYPES.STREET_FOOD]: 'Street Food'
});

/** Seed/fallback base prices in INR (rupees, not paise). */
export const DEFAULT_ONBOARDING_BASE_PRICE = Object.freeze({
    [RESTAURANT_TYPES.FAMILY_RESTAURANT]: 999,
    [RESTAURANT_TYPES.CAFE]: 699,
    [RESTAURANT_TYPES.CLOUD_KITCHEN]: 899,
    [RESTAURANT_TYPES.STREET_FOOD]: 499
});

export const isValidRestaurantType = (value) =>
    RESTAURANT_TYPE_VALUES.includes(String(value || '').trim());

/** Accepts a slug or a human label ("Family Restaurant") and returns the slug. */
export const normalizeRestaurantType = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const slug = raw.toLowerCase().replace(/[\s-]+/g, '_');
    if (RESTAURANT_TYPE_VALUES.includes(slug)) return slug;
    return '';
};

export const getRestaurantTypeLabel = (value) =>
    RESTAURANT_TYPE_LABELS[normalizeRestaurantType(value)] || '';
