/**
 * Restaurant offer engine (pure, no DB access).
 *
 * Decides whether an offer is live at a moment and how much it takes off a set of
 * already server-priced checkout items. Money is handled in paise so shares never
 * drift by floating-point error.
 *
 * Rules:
 *  - An item gets at most one offer. When offers overlap, the one saving the most is
 *    applied first; offers on different items combine.
 *  - percentage: that percent off each eligible unit. flat: that amount off the
 *    eligible items once per order, spread across them by value.
 *  - A unit is never discounted below zero, nor by more than the restaurant's own
 *    base price: the restaurant funds its offers, the platform markup is untouched.
 *  - minOrderValue is compared with the item total before any offer.
 */
import { APP_TIMEZONE, getMondayBasedWeekday, getZonedParts } from '../../../../utils/timezone.js';
import { DAY_NAMES, timeToMinutes } from './operatingHours.js';

const toPaise = (rupees) => Math.round((Number(rupees) || 0) * 100);
const fromPaise = (paise) => Math.round(paise) / 100;
const idOf = (value) => (value == null ? '' : String(value._id ?? value));

/** Offer fields written onto checkout items; cleared before every re-pricing. */
export const ITEM_OFFER_FIELDS = Object.freeze(['priceBeforeOffer', 'offerDiscount', 'offerId', 'offerTitle']);

/**
 * True when the offer runs at `date`: switched on, inside validFrom..validTill, on an
 * allowed day and inside its time slot. An overnight slot (22:00-02:00) belongs to the
 * day it starts on, so Friday's slot still runs at 01:00 on Saturday.
 */
export function isOfferLiveAt(offer, date = new Date(), timeZone = APP_TIMEZONE) {
    if (!offer || offer.isActive === false) return false;
    const at = date instanceof Date ? date : new Date(date);
    const from = offer.validFrom ? new Date(offer.validFrom) : null;
    const till = offer.validTill ? new Date(offer.validTill) : null;
    if (!from || !till || at < from || at > till) return false;

    const days = Array.isArray(offer.activeDays) ? offer.activeDays : [];
    const weekday = getMondayBasedWeekday(at, timeZone);
    const dayAllowed = (index) => days.length === 0 || days.includes(DAY_NAMES[(index + 7) % 7]);

    const start = timeToMinutes(offer.activeTimeSlot?.start);
    const end = timeToMinutes(offer.activeTimeSlot?.end);
    if (start === null || end === null || start === end) return dayAllowed(weekday);

    const parts = getZonedParts(at, timeZone);
    const minutes = parts.hour * 60 + parts.minute;
    if (start < end) return minutes >= start && minutes < end && dayAllowed(weekday);
    if (minutes >= start) return dayAllowed(weekday);
    if (minutes < end) return dayAllowed(weekday - 1);
    return false;
}

/** Customer-facing label, e.g. "20% OFF" or "Flat ₹50 OFF above ₹299". */
export function describeOffer(offer) {
    const value = Number(offer?.discountValue) || 0;
    const head = offer?.discountType === 'percentage'
        ? `${value}% OFF`
        : `Flat ₹${value.toLocaleString('en-IN')} OFF`;
    const min = Number(offer?.minOrderValue) || 0;
    return min > 0 ? `${head} above ₹${min.toLocaleString('en-IN')}` : head;
}

const isEligible = (offer, line) => {
    if (offer.applicableTo === 'entire_menu') return true;
    if (offer.applicableTo === 'specific_items') {
        return (offer.itemIds || []).some((id) => idOf(id) === line.itemId);
    }
    if (offer.applicableTo === 'category') {
        return Boolean(line.categoryId) && (offer.categoryIds || []).some((id) => idOf(id) === line.categoryId);
    }
    return false;
};

/** Per-unit discount (paise) this offer gives each of the given lines. */
const unitDiscountsFor = (offer, lines) => {
    const units = new Map();
    const eligible = lines.filter((line) => line.capPaise > 0 && isEligible(offer, line));
    if (!eligible.length) return units;

    if (offer.discountType === 'percentage') {
        const pct = Math.min(100, Math.max(0, Number(offer.discountValue) || 0));
        eligible.forEach((line) => {
            units.set(line.index, Math.min(line.capPaise, Math.floor((line.unitPaise * pct) / 100)));
        });
        return units;
    }

    // Flat: split the amount across eligible lines by value, then hand any remainder
    // to the largest lines. A line only takes whole-paise-per-unit amounts, so a few
    // paise may stay unallocated - the customer is never charged for that gap.
    const capacity = eligible.reduce((sum, line) => sum + line.capPaise * line.qty, 0);
    let remaining = Math.min(toPaise(offer.discountValue), capacity);
    const eligibleTotal = eligible.reduce((sum, line) => sum + line.unitPaise * line.qty, 0);
    const budget = remaining;
    eligible.forEach((line) => {
        const share = Math.floor((budget * line.unitPaise * line.qty) / eligibleTotal);
        const unit = Math.min(line.capPaise, Math.floor(share / line.qty));
        units.set(line.index, unit);
        remaining -= unit * line.qty;
    });
    [...eligible]
        .sort((a, b) => b.unitPaise * b.qty - a.unitPaise * a.qty)
        .forEach((line) => {
            if (remaining <= 0) return;
            const current = units.get(line.index) || 0;
            const extra = Math.min(line.capPaise - current, Math.floor(remaining / line.qty));
            if (extra > 0) {
                units.set(line.index, current + extra);
                remaining -= extra * line.qty;
            }
        });
    return units;
};

const totalOf = (units, lines) =>
    [...units.entries()].reduce((sum, [index, unit]) => sum + unit * lines[index].qty, 0);

/**
 * Apply live offers to server-priced checkout items.
 *
 * @param {Array<object>} items checkout items with itemId, price, basePrice, quantity
 * @param {Array<object>} offers offers already known to be live now
 * @param {{ itemCategoryMap?: Map<string, string> }} [context] itemId -> categoryId
 * @returns {{ items: object[], discount: number, appliedOffers: object[], itemTotalBeforeOffers: number }}
 *   `items` are new objects; lines an offer touched carry the ITEM_OFFER_FIELDS and a
 *   reduced price/basePrice (markupAmount unchanged).
 */
export function applyOffersToItems(items = [], offers = [], { itemCategoryMap = new Map() } = {}) {
    const lines = items.map((item, index) => {
        const unitPaise = Math.max(0, toPaise(item.price));
        const baseRaw = Number(item.basePrice);
        const basePaise = Number.isFinite(baseRaw) && baseRaw >= 0 ? toPaise(baseRaw) : unitPaise;
        return {
            index,
            itemId: idOf(item.itemId),
            categoryId: itemCategoryMap.get(idOf(item.itemId)) || '',
            qty: Math.max(1, Math.floor(Number(item.quantity) || 1)),
            unitPaise,
            capPaise: Math.min(unitPaise, basePaise),
            claimedBy: null,
            unitDiscount: 0
        };
    });
    const itemTotalPaise = lines.reduce((sum, line) => sum + line.unitPaise * line.qty, 0);

    let candidates = offers.filter((offer) => toPaise(offer.minOrderValue) <= itemTotalPaise);
    const appliedOffers = [];
    // Each round applies the offer that saves the most on the items still unclaimed.
    while (candidates.length) {
        const free = lines.filter((line) => !line.claimedBy);
        let best = null;
        candidates.forEach((offer) => {
            const units = unitDiscountsFor(offer, free);
            const total = totalOf(units, lines);
            const beats =
                !best ||
                total > best.total ||
                (total === best.total && idOf(offer) < idOf(best.offer)); // deterministic tie-break
            if (total > 0 && beats) best = { offer, units, total };
        });
        if (!best) break;
        best.units.forEach((unit, index) => {
            if (unit <= 0) return;
            lines[index].claimedBy = best.offer;
            lines[index].unitDiscount = unit;
        });
        appliedOffers.push({
            offerId: idOf(best.offer),
            title: best.offer.title || '',
            label: describeOffer(best.offer),
            discount: fromPaise(best.total)
        });
        candidates = candidates.filter((offer) => offer !== best.offer);
    }

    const pricedItems = items.map((item, index) => {
        const line = lines[index];
        if (!line.claimedBy) return { ...item };
        const price = fromPaise(line.unitPaise - line.unitDiscount);
        const baseRaw = Number(item.basePrice);
        return {
            ...item,
            priceBeforeOffer: fromPaise(line.unitPaise),
            offerDiscount: fromPaise(line.unitDiscount),
            offerId: idOf(line.claimedBy),
            offerTitle: line.claimedBy.title || '',
            price,
            variantPrice: price,
            basePrice: Number.isFinite(baseRaw) && baseRaw >= 0
                ? fromPaise(toPaise(baseRaw) - line.unitDiscount)
                : price
        };
    });

    // Live offers covering something in the cart that only miss their minimum order:
    // the cart tells the customer how much more unlocks each one (cheapest first).
    const lockedOffers = offers
        .filter((offer) => toPaise(offer.minOrderValue) > itemTotalPaise)
        .filter((offer) => lines.some((line) => line.capPaise > 0 && isEligible(offer, line)))
        .map((offer) => ({
            offerId: idOf(offer),
            title: offer.title || '',
            label: describeOffer(offer),
            headline: describeOffer({ ...offer, minOrderValue: 0 }),
            minOrderValue: fromPaise(toPaise(offer.minOrderValue)),
            amountNeeded: fromPaise(toPaise(offer.minOrderValue) - itemTotalPaise)
        }))
        .sort((a, b) => a.amountNeeded - b.amountNeeded || (a.offerId < b.offerId ? -1 : 1));

    return {
        items: pricedItems,
        discount: fromPaise(lines.reduce((sum, line) => sum + line.unitDiscount * line.qty, 0)),
        appliedOffers,
        lockedOffers,
        itemTotalBeforeOffers: fromPaise(itemTotalPaise)
    };
}
