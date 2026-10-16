/**
 * Eatiefy ₹99 section eligibility.
 *
 * An item belongs in the section when the price the customer is actually
 * charged is ₹99 or below. That price comes from the same engine the menu, cart
 * and order use (`applyOtherPriceToFood`: restaurant price + active admin
 * pricing rule), so the section can never disagree with checkout.
 *
 * Coupons/offers are applied to the cart subtotal, not the item, so they do not
 * change eligibility.
 */
import {
    applyOtherPriceToFood,
    loadActivePricingRulesForRestaurants,
} from '../../admin/services/otherPrice.service.js';

export const EATIEFY_99_PRICE = 99;

// Half-paisa tolerance so a rule producing 99.004 still counts as ₹99.
const isWithin99 = (value) => {
    const price = Number(value);
    return Number.isFinite(price) && price > 0 && price < EATIEFY_99_PRICE + 0.005;
};

/**
 * Mongo pre-filter narrowing candidates at the database. Pricing rules only ever
 * add a markup (never discount), so an item selling at ₹99 or less must have a
 * stored price, an admin price override, or a variant price between 0 and ₹99.
 * Exact eligibility is then decided by `selectEatiefy99Foods` (callers must
 * select `+adminPrice` for the override to count).
 */
export const buildEatiefy99CandidateFilter = () => ({
    $or: [
        { price: { $gt: 0, $lte: EATIEFY_99_PRICE } },
        { adminPrice: { $gt: 0, $lte: EATIEFY_99_PRICE } },
        { 'variants.price': { $gt: 0, $lte: EATIEFY_99_PRICE } },
    ],
});

/**
 * Price candidates with live pricing rules and keep only those selling at ₹99
 * or below. An item with variants qualifies as long as at least one variant is
 * within ₹99; all variants are preserved (sorted cheapest first, so the default
 * price shown in the rail is the eligible one) so the detail modal still lets
 * the customer pick the larger option the restaurant added (e.g. Full ₹159
 * alongside Half ₹82).
 *
 * @param {object[]} foods lean FoodItem docs (must include _id, restaurantId, price, variants)
 * @returns {Promise<object[]>} priced foods in input order
 */
export async function selectEatiefy99Foods(foods = []) {
    if (!Array.isArray(foods) || foods.length === 0) return [];

    const rules = await loadActivePricingRulesForRestaurants({
        restaurantIds: foods.map((food) => food.restaurantId),
        menuItemIds: foods.map((food) => food._id),
    });

    const eligible = [];
    for (const food of foods) {
        const priced = applyOtherPriceToFood(food, rules);
        const variants = Array.isArray(priced.variants) ? priced.variants : [];

        if (variants.length === 0) {
            if (isWithin99(priced.price)) eligible.push(priced);
            continue;
        }

        // Qualifies if any variant is within ₹99; keep every variant so the
        // modal shows Half and Full exactly as the restaurant configured them.
        const hasEligibleVariant = variants.some((variant) => isWithin99(variant.price));
        if (!hasEligibleVariant) continue;

        const sortedVariants = [...variants].sort(
            (a, b) => Number(a.price) - Number(b.price),
        );
        const cheapest = sortedVariants[0];
        eligible.push({
            ...priced,
            price: Number(cheapest.price),
            basePrice: Number(cheapest.basePrice) || priced.basePrice,
            markupAmount: Math.max(0, Number(cheapest.markupAmount) || 0),
            variants: sortedVariants,
            variations: sortedVariants,
        });
    }
    return eligible;
}
