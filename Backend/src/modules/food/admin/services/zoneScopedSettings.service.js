import mongoose from 'mongoose';
import { FoodFeeSettings } from '../models/feeSettings.model.js';
import { FoodDeliveryCommissionRule } from '../models/deliveryCommissionRule.model.js';
import { logger } from '../../../../utils/logger.js';

function toObjectId(zoneId) {
    if (!zoneId) return null;
    const raw = String(zoneId);
    if (!mongoose.Types.ObjectId.isValid(raw)) return null;
    return new mongoose.Types.ObjectId(raw);
}

/**
 * Resolve active fee settings for a zone.
 * Prefer exact zone match; if missing, fall back to another zone's active settings
 * so delivery/platform fees never collapse to 0 because a zone was newly added.
 */
export async function resolveFeeSettingsForZone(zoneId) {
    const oid = toObjectId(zoneId);

    if (oid) {
        const exact = await FoodFeeSettings.findOne({ zoneId: oid, isActive: true }).lean();
        if (exact) return exact;
    }

    const fallback = await FoodFeeSettings.findOne({
        isActive: true,
        zoneId: { $exists: true, $ne: null }
    })
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();

    if (fallback) {
        logger.warn(
            `Fee settings missing for zone ${zoneId || 'n/a'}; using fallback zone ${fallback.zoneId}`
        );
        return fallback;
    }

    // Pre-migration safety: legacy docs without zoneId
    const legacy = await FoodFeeSettings.findOne({ isActive: true })
        .sort({ createdAt: -1 })
        .lean();
    if (legacy) {
        logger.warn(
            `Fee settings missing for zone ${zoneId || 'n/a'}; using legacy global fee settings`
        );
    }
    return legacy || null;
}

/**
 * Resolve active delivery commission rules for a zone.
 * Prefer exact zone; if empty, fall back to another zone that has active rules.
 */
export async function resolveCommissionRulesForZone(zoneId) {
    const oid = toObjectId(zoneId);

    if (oid) {
        const exact = await FoodDeliveryCommissionRule.find({
            zoneId: oid,
            status: { $ne: false }
        }).lean();
        if (exact?.length) return exact;
    }

    const fallbackZone = await FoodDeliveryCommissionRule.aggregate([
        { $match: { status: { $ne: false }, zoneId: { $exists: true, $ne: null } } },
        { $group: { _id: '$zoneId', count: { $sum: 1 }, updatedAt: { $max: '$updatedAt' } } },
        { $sort: { updatedAt: -1, count: -1 } },
        { $limit: 1 }
    ]);

    const fallbackZoneId = fallbackZone?.[0]?._id;
    if (fallbackZoneId) {
        const fallbackRules = await FoodDeliveryCommissionRule.find({
            zoneId: fallbackZoneId,
            status: { $ne: false }
        }).lean();
        if (fallbackRules?.length) {
            logger.warn(
                `Commission rules missing for zone ${zoneId || 'n/a'}; using fallback zone ${fallbackZoneId}`
            );
            return fallbackRules;
        }
    }

    // Pre-migration safety: legacy docs without zoneId
    const legacy = await FoodDeliveryCommissionRule.find({
        status: { $ne: false },
        $or: [{ zoneId: null }, { zoneId: { $exists: false } }]
    }).lean();
    if (legacy?.length) {
        logger.warn(
            `Commission rules missing for zone ${zoneId || 'n/a'}; using legacy global rules`
        );
        return legacy;
    }

    return [];
}
