import mongoose from 'mongoose';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { FoodOnboardingPricingRule } from '../models/onboardingPricingRule.model.js';
import { FoodOnboardingOffer } from '../models/onboardingOffer.model.js';
import { FoodZone } from '../models/zone.model.js';
import { FoodOnboardingPayment } from '../../restaurant/models/onboardingPayment.model.js';
import {
    DEFAULT_ONBOARDING_BASE_PRICE,
    RESTAURANT_TYPE_LABELS,
    RESTAURANT_TYPE_VALUES,
    getRestaurantTypeLabel,
    normalizeRestaurantType
} from '../../shared/restaurantTypes.js';

const toObjectId = (value) =>
    value && mongoose.Types.ObjectId.isValid(String(value))
        ? new mongoose.Types.ObjectId(String(value))
        : null;

const parsePrice = (value, label) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
        throw new ValidationError(`${label} must be a number of 0 or more`);
    }
    return Math.round(n * 100) / 100;
};

const parseRequiredType = (value) => {
    const type = normalizeRestaurantType(value);
    if (!type) throw new ValidationError('A valid restaurant type is required');
    return type;
};

const parseBoolean = (value, fallback = true) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
    return fallback;
};

const parseDate = (value, label) => {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) {
        throw new ValidationError(`${label} is not a valid date`);
    }
    return date;
};

/** Static metadata the admin forms need (types + defaults + zones). */
export const getOnboardingPricingBootstrap = async () => {
    const zones = await FoodZone.find({ isActive: true })
        .select('name zoneName serviceLocation')
        .sort({ name: 1 })
        .lean();

    return {
        restaurantTypes: RESTAURANT_TYPE_VALUES.map((value) => ({
            value,
            label: RESTAURANT_TYPE_LABELS[value],
            defaultBasePrice: DEFAULT_ONBOARDING_BASE_PRICE[value]
        })),
        zones: zones.map((zone) => ({
            id: String(zone._id),
            name: zone.name || zone.zoneName || zone.serviceLocation || String(zone._id)
        }))
    };
};

const toRuleView = (rule) => ({
    id: String(rule._id),
    zoneId: rule.zoneId ? String(rule.zoneId._id || rule.zoneId) : null,
    zoneName: rule.zoneId?.name || rule.zoneId?.zoneName || (rule.zoneId ? '' : 'All zones (default)'),
    restaurantType: rule.restaurantType,
    restaurantTypeLabel: getRestaurantTypeLabel(rule.restaurantType),
    basePrice: rule.basePrice,
    currency: rule.currency || 'INR',
    isActive: rule.isActive !== false,
    notes: rule.notes || '',
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt
});

export const listOnboardingPricingRules = async (query = {}) => {
    const filter = {};
    const zoneId = String(query.zoneId || '').trim();
    if (zoneId === 'global') {
        filter.zoneId = null;
    } else if (zoneId) {
        const oid = toObjectId(zoneId);
        if (!oid) throw new ValidationError('Invalid zoneId');
        filter.zoneId = oid;
    }
    if (query.restaurantType) filter.restaurantType = parseRequiredType(query.restaurantType);
    if (query.status === 'active') filter.isActive = true;
    if (query.status === 'inactive') filter.isActive = false;

    const rules = await FoodOnboardingPricingRule.find(filter)
        .populate('zoneId', 'name zoneName')
        .sort({ isActive: -1, updatedAt: -1 })
        .lean();

    return { rules: rules.map(toRuleView), total: rules.length };
};

/**
 * Duplicate active rules for the same (zone, type) are rejected here and again by a
 * unique partial index, so a race between two admins cannot create a conflict.
 */
export const upsertOnboardingPricingRule = async (body = {}, adminId = null) => {
    const restaurantType = parseRequiredType(body.restaurantType);
    const zoneId = String(body.zoneId || '').trim();
    const zoneObjectId = !zoneId || zoneId === 'global' ? null : toObjectId(zoneId);
    if (zoneId && zoneId !== 'global' && !zoneObjectId) {
        throw new ValidationError('Invalid zoneId');
    }
    if (zoneObjectId) {
        const zoneExists = await FoodZone.exists({ _id: zoneObjectId });
        if (!zoneExists) throw new ValidationError('Selected zone does not exist');
    }

    const basePrice = parsePrice(body.basePrice, 'Base price');
    const isActive = parseBoolean(body.isActive, true);
    const ruleId = String(body.id || body._id || '').trim();

    if (isActive) {
        const clash = await FoodOnboardingPricingRule.findOne({
            zoneId: zoneObjectId,
            restaurantType,
            isActive: true,
            ...(ruleId && mongoose.Types.ObjectId.isValid(ruleId) ? { _id: { $ne: ruleId } } : {})
        }).lean();
        if (clash) {
            throw new ValidationError(
                'An active pricing rule already exists for this zone and restaurant type. Edit or disable it first.'
            );
        }
    }

    const payload = {
        zoneId: zoneObjectId,
        restaurantType,
        basePrice,
        currency: String(body.currency || 'INR').toUpperCase(),
        isActive,
        notes: String(body.notes || '').trim(),
        updatedBy: adminId || null
    };

    let saved;
    try {
        if (ruleId) {
            if (!mongoose.Types.ObjectId.isValid(ruleId)) throw new ValidationError('Invalid pricing rule id');
            saved = await FoodOnboardingPricingRule.findByIdAndUpdate(
                ruleId,
                { $set: payload },
                { new: true, runValidators: true }
            )
                .populate('zoneId', 'name zoneName')
                .lean();
            if (!saved) throw new NotFoundError('Pricing rule not found');
        } else {
            const created = await FoodOnboardingPricingRule.create({ ...payload, createdBy: adminId || null });
            saved = await FoodOnboardingPricingRule.findById(created._id)
                .populate('zoneId', 'name zoneName')
                .lean();
        }
    } catch (error) {
        if (error?.code === 11000) {
            throw new ValidationError(
                'An active pricing rule already exists for this zone and restaurant type.'
            );
        }
        throw error;
    }

    return toRuleView(saved);
};

export const setOnboardingPricingRuleStatus = async (id, isActiveRaw, adminId = null) => {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid pricing rule id');
    const isActive = parseBoolean(isActiveRaw, true);

    const rule = await FoodOnboardingPricingRule.findById(id).lean();
    if (!rule) throw new NotFoundError('Pricing rule not found');

    if (isActive) {
        const clash = await FoodOnboardingPricingRule.findOne({
            _id: { $ne: rule._id },
            zoneId: rule.zoneId ?? null,
            restaurantType: rule.restaurantType,
            isActive: true
        }).lean();
        if (clash) {
            throw new ValidationError(
                'Another active rule already covers this zone and restaurant type. Disable it first.'
            );
        }
    }

    const updated = await FoodOnboardingPricingRule.findByIdAndUpdate(
        id,
        { $set: { isActive, updatedBy: adminId || null } },
        { new: true }
    )
        .populate('zoneId', 'name zoneName')
        .lean();

    return toRuleView(updated);
};

export const deleteOnboardingPricingRule = async (id) => {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid pricing rule id');
    const deleted = await FoodOnboardingPricingRule.findByIdAndDelete(id).lean();
    if (!deleted) throw new NotFoundError('Pricing rule not found');
    return { id: String(deleted._id) };
};

// ----- Promotional offers -----

const toOfferView = (offer) => {
    const consumed = offer.consumedCount || 0;
    const now = new Date();
    return {
        id: String(offer._id),
        name: offer.name,
        zoneId: offer.zoneId ? String(offer.zoneId._id || offer.zoneId) : null,
        zoneName: offer.zoneId?.name || offer.zoneId?.zoneName || '',
        restaurantType: offer.restaurantType,
        restaurantTypeLabel: getRestaurantTypeLabel(offer.restaurantType),
        originalPrice: offer.originalPrice,
        offerPrice: offer.offerPrice,
        maxRedemptions: offer.maxRedemptions,
        usedSlots: offer.redeemedCount || 0,
        heldSlots: Math.max(0, consumed - (offer.redeemedCount || 0)),
        remainingSlots: Math.max(0, offer.maxRedemptions - consumed),
        startsAt: offer.startsAt,
        endsAt: offer.endsAt,
        isActive: offer.isActive !== false,
        isLive:
            offer.isActive !== false &&
            offer.startsAt <= now &&
            offer.endsAt >= now &&
            consumed < offer.maxRedemptions,
        createdAt: offer.createdAt,
        updatedAt: offer.updatedAt
    };
};

export const listOnboardingOffers = async (query = {}) => {
    const filter = {};
    if (query.zoneId) {
        const oid = toObjectId(query.zoneId);
        if (!oid) throw new ValidationError('Invalid zoneId');
        filter.zoneId = oid;
    }
    if (query.restaurantType) filter.restaurantType = parseRequiredType(query.restaurantType);
    if (query.status === 'active') filter.isActive = true;
    if (query.status === 'inactive') filter.isActive = false;

    const offers = await FoodOnboardingOffer.find(filter)
        .populate('zoneId', 'name zoneName')
        .sort({ isActive: -1, startsAt: -1 })
        .lean();

    return { offers: offers.map(toOfferView), total: offers.length };
};

export const upsertOnboardingOffer = async (body = {}, adminId = null) => {
    const name = String(body.name || '').trim();
    if (!name) throw new ValidationError('Offer name is required');

    const restaurantType = parseRequiredType(body.restaurantType);
    const zoneObjectId = toObjectId(body.zoneId);
    if (!zoneObjectId) throw new ValidationError('A valid zone is required for an offer');
    const zoneExists = await FoodZone.exists({ _id: zoneObjectId });
    if (!zoneExists) throw new ValidationError('Selected zone does not exist');

    const originalPrice = parsePrice(body.originalPrice, 'Original price');
    const offerPrice = parsePrice(body.offerPrice, 'Offer price');
    if (offerPrice >= originalPrice) {
        throw new ValidationError('Offer price must be lower than the original price');
    }

    const maxRedemptions = Number(body.maxRedemptions);
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1) {
        throw new ValidationError('Maximum eligible restaurants must be a whole number of 1 or more');
    }

    const startsAt = parseDate(body.startsAt, 'Start date');
    const endsAt = parseDate(body.endsAt, 'End date');
    if (endsAt <= startsAt) throw new ValidationError('End date must be after the start date');

    const offerId = String(body.id || body._id || '').trim();
    const isActive = parseBoolean(body.isActive, true);

    const payload = {
        name,
        zoneId: zoneObjectId,
        restaurantType,
        originalPrice,
        offerPrice,
        maxRedemptions,
        startsAt,
        endsAt,
        isActive,
        updatedBy: adminId || null
    };

    let saved;
    if (offerId) {
        if (!mongoose.Types.ObjectId.isValid(offerId)) throw new ValidationError('Invalid offer id');
        const current = await FoodOnboardingOffer.findById(offerId).lean();
        if (!current) throw new NotFoundError('Offer not found');
        // Slots already taken must stay honoured — an admin cannot shrink the cap below them.
        if (maxRedemptions < (current.consumedCount || 0)) {
            throw new ValidationError(
                `This offer already has ${current.consumedCount} claimed slot(s); the limit cannot be lower than that.`
            );
        }
        saved = await FoodOnboardingOffer.findByIdAndUpdate(
            offerId,
            { $set: payload },
            { new: true, runValidators: true }
        )
            .populate('zoneId', 'name zoneName')
            .lean();
    } else {
        const created = await FoodOnboardingOffer.create({ ...payload, createdBy: adminId || null });
        saved = await FoodOnboardingOffer.findById(created._id).populate('zoneId', 'name zoneName').lean();
    }

    return toOfferView(saved);
};

export const setOnboardingOfferStatus = async (id, isActiveRaw, adminId = null) => {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid offer id');
    const updated = await FoodOnboardingOffer.findByIdAndUpdate(
        id,
        { $set: { isActive: parseBoolean(isActiveRaw, true), updatedBy: adminId || null } },
        { new: true }
    )
        .populate('zoneId', 'name zoneName')
        .lean();
    if (!updated) throw new NotFoundError('Offer not found');
    return toOfferView(updated);
};

export const deleteOnboardingOffer = async (id) => {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) throw new ValidationError('Invalid offer id');
    const offer = await FoodOnboardingOffer.findById(id).lean();
    if (!offer) throw new NotFoundError('Offer not found');
    if ((offer.redeemedCount || 0) > 0) {
        throw new ValidationError(
            'This offer has already been used by paying restaurants and must be disabled instead of deleted.'
        );
    }
    await FoodOnboardingOffer.findByIdAndDelete(id);
    return { id: String(id) };
};

// ----- Payment review -----

export const listOnboardingPayments = async (query = {}) => {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 200);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const filter = {};
    if (['created', 'paid', 'failed', 'cancelled'].includes(String(query.status))) {
        filter.status = String(query.status);
    }
    if (query.zoneId) {
        const oid = toObjectId(query.zoneId);
        if (!oid) throw new ValidationError('Invalid zoneId');
        filter.zoneId = oid;
    }
    if (query.restaurantType) filter.restaurantType = parseRequiredType(query.restaurantType);

    const [payments, total] = await Promise.all([
        FoodOnboardingPayment.find(filter)
            .populate('restaurantId', 'restaurantName ownerName ownerPhone status restaurantType')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        FoodOnboardingPayment.countDocuments(filter)
    ]);

    return {
        payments: payments.map((payment) => ({
            id: String(payment._id),
            restaurantId: payment.restaurantId?._id ? String(payment.restaurantId._id) : String(payment.restaurantId),
            restaurantName: payment.restaurantId?.restaurantName || '',
            ownerName: payment.restaurantId?.ownerName || '',
            ownerPhone: payment.restaurantId?.ownerPhone || payment.ownerPhone || '',
            restaurantStatus: payment.restaurantId?.status || '',
            restaurantType: payment.restaurantType,
            restaurantTypeLabel: getRestaurantTypeLabel(payment.restaurantType),
            zoneName: payment.pricing?.zoneName || '',
            originalPrice: payment.pricing?.originalPrice ?? null,
            offerPrice: payment.pricing?.offerPrice ?? null,
            finalAmount: payment.pricing?.finalAmount ?? null,
            offerName: payment.pricing?.offerName || '',
            currency: payment.pricing?.currency || 'INR',
            status: payment.status,
            transactionReference: payment.gateway?.razorpayPaymentId || '',
            gatewayOrderId: payment.gateway?.razorpayOrderId || '',
            confirmedVia: payment.gateway?.confirmedVia || '',
            paidAt: payment.paidAt,
            createdAt: payment.createdAt
        })),
        total,
        page,
        limit
    };
};
