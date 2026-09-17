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
 * stored price — or a variant price — between 0 and ₹99. Exact eligibility is
 * then decided by `selectEatiefy99Foods`.
 */
export const buildEatiefy99CandidateFilter = () => ({
    $or: [
        { price: { $gt: 0, $lte: EATIEFY_99_PRICE } },
        { 'variants.price': { $gt: 0, $lte: EATIEFY_99_PRICE } },
    ],
});

/**
 * Price candidates with live pricing rules and keep only those selling at ₹99
 * or below. Items with variants keep only their eligible variants (cheapest
 * first, so the default variant is the displayed price), so the section never
 * offers a ₹159 option of a dish; without an eligible variant the item is dropped.
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

        // With variants the customer pays the chosen variant's price.
        const eligibleVariants = variants
            .filter((variant) => isWithin99(variant.price))
            .sort((a, b) => Number(a.price) - Number(b.price));
        if (!eligibleVariants.length) continue;
        const cheapest = eligibleVariants[0];
        eligible.push({
            ...priced,
            price: Number(cheapest.price),
            basePrice: Number(cheapest.basePrice) || priced.basePrice,
            markupAmount: Math.max(0, Number(cheapest.markupAmount) || 0),
            variants: eligibleVariants,
            variations: eligibleVariants,
        });
    }
    return eligible;
}
