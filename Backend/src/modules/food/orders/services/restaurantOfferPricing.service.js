import mongoose from 'mongoose';
import { FoodRestaurantOffer } from '../../restaurant/models/restaurantOffer.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import {
    applyOffersToItems,
    isOfferLiveAt,
    ITEM_OFFER_FIELDS
} from '../../restaurant/utils/restaurantOfferEngine.js';
import { getRazorpayInstance, isRazorpayConfigured } from '../helpers/razorpay.helper.js';
import { logger } from '../../../../utils/logger.js';

/** A paid order is priced at its quote time only if that quote is this recent. */
const QUOTE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const stripOfferFields = (item) => {
    const copy = { ...item };
    ITEM_OFFER_FIELDS.forEach((field) => delete copy[field]);
    return copy;
};

/**
 * The moment offers are evaluated at. Normally now; for an order paid online it is
 * when its Razorpay order was created - the quote the customer paid - so an offer
 * whose time slot ends mid-payment still matches the amount that was charged.
 */
async function resolveOfferClock(dto) {
    const now = new Date();
    const razorpayOrderId = String(dto?.razorpayOrderId || '').trim();
    if (!razorpayOrderId || !isRazorpayConfigured()) return now;
    try {
        const order = await getRazorpayInstance().orders.fetch(razorpayOrderId);
        const createdMs = Number(order?.created_at) * 1000;
        if (Number.isFinite(createdMs) && createdMs <= now.getTime() && now.getTime() - createdMs <= QUOTE_MAX_AGE_MS) {
            return new Date(createdMs);
        }
    } catch (err) {
        logger.warn(`[RestaurantOffers] Could not read quote time for ${razorpayOrderId}: ${err?.message || err}`);
    }
    return now;
}

/**
 * Applies the restaurant's live offers to server-priced checkout items.
 *
 * Isolated from the rest of order pricing: it only lowers the price (and the
 * restaurant-owned base price) of the lines an offer covers, so subtotal, tax,
 * coupons, fees, the restaurant's earning and commission all follow from the items.
 *
 * @param {{ restaurantId: string, items: object[], dto?: object }} params
 * @returns {Promise<{ items: object[], discount: number, appliedOffers: object[], lockedOffers: object[], itemTotalBeforeOffers: number }>}
 *   lockedOffers: live offers covering the cart that only miss their minimum order.
 */
export async function applyRestaurantItemOffers({ restaurantId, items = [], dto = {} }) {
    // Items may come back from an earlier quote (payment recovery): never discount twice.
    const cleanItems = items.map(stripOfferFields);
    const unchanged = () => ({
        items: cleanItems,
        discount: 0,
        appliedOffers: [],
        lockedOffers: [],
        itemTotalBeforeOffers:
            Math.round(cleanItems.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0) * 100) / 100
    });

    if (!cleanItems.length || !mongoose.Types.ObjectId.isValid(String(restaurantId || ''))) return unchanged();
    const rid = new mongoose.Types.ObjectId(String(restaurantId));

    // Most restaurants run no offers: skip the quote-time lookup entirely for them.
    if (!(await FoodRestaurantOffer.exists({ restaurantId: rid, isActive: true, approvalStatus: 'approved' }))) return unchanged();

    const at = await resolveOfferClock(dto);
    const offers = (
        await FoodRestaurantOffer.find({
            restaurantId: rid,
            isActive: true,
            approvalStatus: 'approved',
            validFrom: { $lte: at },
            validTill: { $gte: at }
        }).lean()
    ).filter((offer) => isOfferLiveAt(offer, at));
    if (!offers.length) return unchanged();

    let itemCategoryMap = new Map();
    if (offers.some((offer) => offer.applicableTo === 'category')) {
        const ids = cleanItems
            .map((item) => String(item.itemId || ''))
            .filter((id) => mongoose.Types.ObjectId.isValid(id));
        const docs = await FoodItem.find({ _id: { $in: ids }, restaurantId: rid }).select('categoryId').lean();
        itemCategoryMap = new Map(docs.map((doc) => [String(doc._id), doc.categoryId ? String(doc.categoryId) : '']));
    }

    return applyOffersToItems(cleanItems, offers, { itemCategoryMap });
}
