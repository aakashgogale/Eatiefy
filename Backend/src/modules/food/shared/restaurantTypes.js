/**
 * Restaurant/business types used for one-time onboarding pricing.
 *
 * The values are stable slugs persisted on the restaurant document; labels are
 * for display only. There is no built-in fee: a restaurant is charged only when an
 * admin has configured an active FoodOnboardingPricingRule for its zone or for all
 * zones.
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
