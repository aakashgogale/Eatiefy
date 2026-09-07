import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodOnboardingPricingRule } from '../../admin/models/onboardingPricingRule.model.js';
import { FoodOnboardingOffer } from '../../admin/models/onboardingOffer.model.js';
import { FoodZone } from '../../admin/models/zone.model.js';
import {
    DEFAULT_ONBOARDING_BASE_PRICE,
    getRestaurantTypeLabel,
    isValidRestaurantType
} from '../../shared/restaurantTypes.js';

/** Money is stored in rupees; round to paise precision to avoid float drift. */
const toMoney = (value) => Math.round(Number(value) * 100) / 100;

const toObjectId = (value) =>
    value && mongoose.Types.ObjectId.isValid(String(value))
        ? new mongoose.Types.ObjectId(String(value))
        : null;

/**
 * Resolve the base onboarding fee for a (zone, type) pair.
 * Order: active zone rule -> active global rule -> built-in default.
 */
export const resolveBasePrice = async (zoneId, restaurantType) => {
    if (!isValidRestaurantType(restaurantType)) {
        throw new ValidationError('Restaurant type is invalid');
    }

    const zoneObjectId = toObjectId(zoneId);

    if (zoneObjectId) {
        const zoneRule = await FoodOnboardingPricingRule.findOne({
            zoneId: zoneObjectId,
            restaurantType,
            isActive: true
        }).lean();
        if (zoneRule) {
            return {
                basePrice: toMoney(zoneRule.basePrice),
                currency: zoneRule.currency || 'INR',
                priceSource: 'zone_rule',
                pricingRuleId: zoneRule._id
            };
        }
    }

    const globalRule = await FoodOnboardingPricingRule.findOne({
        zoneId: null,
        restaurantType,
        isActive: true
    }).lean();
    if (globalRule) {
        return {
            basePrice: toMoney(globalRule.basePrice),
            currency: globalRule.currency || 'INR',
            priceSource: 'global_rule',
            pricingRuleId: globalRule._id
        };
    }

    return {
        basePrice: toMoney(DEFAULT_ONBOARDING_BASE_PRICE[restaurantType] ?? 0),
        currency: 'INR',
        priceSource: 'system_default',
        pricingRuleId: null
    };
};

/**
 * The offer a restaurant would get right now: active, in its date window, matching
 * zone+type, with a free slot, and actually cheaper than the base price. When several
 * qualify, the one saving the most money wins.
 */
export const findApplicableOffer = async (zoneId, restaurantType, basePrice) => {
    const zoneObjectId = toObjectId(zoneId);
    if (!zoneObjectId || !isValidRestaurantType(restaurantType)) return null;

    const now = new Date();
    const candidates = await FoodOnboardingOffer.find({
        zoneId: zoneObjectId,
        restaurantType,
        isActive: true,
        startsAt: { $lte: now },
        endsAt: { $gte: now },
        $expr: { $lt: ['$consumedCount', '$maxRedemptions'] }
    }).lean();

    const usable = candidates.filter((offer) => toMoney(offer.offerPrice) < toMoney(basePrice));
    if (!usable.length) return null;

    usable.sort((a, b) => a.offerPrice - b.offerPrice);
    return usable[0];
};

/**
 * Full price breakdown for a restaurant, computed only from persisted data.
 * Nothing here reads client input — callers pass ids loaded from the database.
 */
export const buildOnboardingQuote = async ({ zoneId, restaurantType }) => {
    const { basePrice, currency, priceSource, pricingRuleId } = await resolveBasePrice(
        zoneId,
        restaurantType
    );

    const offer = await findApplicableOffer(zoneId, restaurantType, basePrice);
    const zone = toObjectId(zoneId)
        ? await FoodZone.findById(zoneId).select('name zoneName serviceLocation').lean()
        : null;

    const finalAmount = offer ? toMoney(offer.offerPrice) : toMoney(basePrice);

    return {
        restaurantType,
        restaurantTypeLabel: getRestaurantTypeLabel(restaurantType),
        zoneId: zoneId ? String(zoneId) : null,
        zoneName: zone?.name || zone?.zoneName || zone?.serviceLocation || '',
        currency,
        originalPrice: toMoney(basePrice),
        offerPrice: offer ? toMoney(offer.offerPrice) : null,
        finalAmount,
        savings: offer ? toMoney(basePrice - offer.offerPrice) : 0,
        priceSource,
        pricingRuleId: pricingRuleId ? String(pricingRuleId) : null,
        offer: offer
            ? {
                id: String(offer._id),
                name: offer.name,
                remainingSlots: Math.max(0, offer.maxRedemptions - offer.consumedCount),
                maxRedemptions: offer.maxRedemptions,
                endsAt: offer.endsAt
            }
            : null
    };
};

/**
 * Atomically take one slot of an offer.
 *
 * The availability guard and the increment are a single document update, so
 * concurrent checkouts serialise on the document: the last slot is handed to exactly
 * one caller and everyone else gets null (and falls back to the base price).
 *
 * @returns {Promise<object|null>} the offer as it looked before the increment
 */
export const reserveOfferSlot = async (offerId) => {
    const id = toObjectId(offerId);
    if (!id) return null;

    const now = new Date();
    return FoodOnboardingOffer.findOneAndUpdate(
        {
            _id: id,
            isActive: true,
            startsAt: { $lte: now },
            endsAt: { $gte: now },
            $expr: { $lt: ['$consumedCount', '$maxRedemptions'] }
        },
        { $inc: { consumedCount: 1 } },
        { new: false }
    ).lean();
};

/** Promote a held reservation to a confirmed redemption (payment verified). */
export const redeemOfferSlot = async (offerId) => {
    const id = toObjectId(offerId);
    if (!id) return null;
    return FoodOnboardingOffer.findByIdAndUpdate(
        id,
        { $inc: { redeemedCount: 1 } },
        { new: true }
    ).lean();
};

/** Give a reserved-but-unpaid slot back to the pool. */
export const releaseOfferSlot = async (offerId) => {
    const id = toObjectId(offerId);
    if (!id) return null;
    return FoodOnboardingOffer.findOneAndUpdate(
        { _id: id, consumedCount: { $gt: 0 } },
        { $inc: { consumedCount: -1 } },
        { new: true }
    ).lean();
};
