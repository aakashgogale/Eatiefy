import mongoose from 'mongoose';
import { FoodDeliveryIncentiveSettings } from '../models/deliveryIncentiveSettings.model.js';
import { FoodZone } from '../models/zone.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import {
    validateDeliveryIncentiveUpsertDto,
    validateZoneIdParam
} from '../validators/deliveryIncentive.validator.js';

/**
 * Zone-wise Eatiefy incentive for delivery partners.
 *
 * The zone's Delivery Boy Payout rules (riderEarning.service.js) stay the BASE
 * earning. This module only computes an ADDITIONAL, admin-configured
 * percentage of the order value that is added on top of it. The result is
 * snapshotted onto each order at creation time so later setting changes never
 * alter existing orders.
 */

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

function toSettingsView(doc, zoneId = null) {
    return {
        zoneId: doc?.zoneId ? String(doc.zoneId) : zoneId ? String(zoneId) : null,
        isEnabled: Boolean(doc?.isEnabled),
        incentivePercent: Math.min(100, Math.max(0, Number(doc?.incentivePercent) || 0)),
        orderValueBasis: doc?.orderValueBasis === 'total' ? 'total' : 'subtotal',
        isConfigured: Boolean(doc),
        updatedAt: doc?.updatedAt || null
    };
}

/** Settings for one zone. Unconfigured zones are returned as disabled. */
export async function getDeliveryIncentiveSettings(zoneId) {
    const zid = validateZoneIdParam(zoneId);
    const doc = await FoodDeliveryIncentiveSettings.findOne({ zoneId: zid }).lean();
    return toSettingsView(doc, zid);
}

export async function upsertDeliveryIncentiveSettings(body = {}) {
    const dto = validateDeliveryIncentiveUpsertDto(body);
    const zoneExists = await FoodZone.exists({ _id: dto.zoneId });
    if (!zoneExists) throw new ValidationError('Invalid zoneId');

    const $set = {};
    if (dto.isEnabled !== undefined) $set.isEnabled = dto.isEnabled;
    if (dto.incentivePercent !== undefined) $set.incentivePercent = dto.incentivePercent;
    if (dto.orderValueBasis !== undefined) $set.orderValueBasis = dto.orderValueBasis;

    const doc = await FoodDeliveryIncentiveSettings.findOneAndUpdate(
        { zoneId: dto.zoneId },
        { $set },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    return toSettingsView(doc);
}

/** Order amount the incentive percentage applies to. */
export function resolveIncentiveOrderValue(pricing, orderValueBasis) {
    const raw = orderValueBasis === 'total' ? pricing?.total : pricing?.subtotal;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? roundMoney(value) : 0;
}

/**
 * Pure calculation of the incentive snapshot for an order.
 * Returns null when no incentive applies (disabled, 0%, takeaway, no value).
 */
export function computeEatiefyIncentive({ pricing, orderType = 'delivery', settings }) {
    if (String(orderType || 'delivery') === 'takeaway') return null;
    if (!settings?.isEnabled) return null;

    const percent = Number(settings.incentivePercent);
    if (!Number.isFinite(percent) || percent <= 0) return null;

    const orderValueBasis = settings.orderValueBasis === 'total' ? 'total' : 'subtotal';
    const orderValue = resolveIncentiveOrderValue(pricing, orderValueBasis);
    if (orderValue <= 0) return null;

    const amount = roundMoney((orderValue * percent) / 100);
    if (amount <= 0) return null;

    return {
        percent,
        orderValueBasis,
        orderValue,
        amount,
        zoneId: settings.zoneId || null,
        calculatedAt: new Date()
    };
}

/** Load the zone's admin settings and compute the incentive snapshot for a new order. */
export async function resolveEatiefyIncentiveForOrder({ pricing, orderType = 'delivery', zoneId }) {
    if (String(orderType || 'delivery') === 'takeaway') return null;
    const raw = zoneId?._id || zoneId;
    if (!raw || !mongoose.Types.ObjectId.isValid(String(raw))) return null;
    const settings = await getDeliveryIncentiveSettings(String(raw));
    return computeEatiefyIncentive({ pricing, orderType, settings });
}

/** Total rider payout = zone-wise base earning + snapshotted Eatiefy incentive. */
export function combineRiderEarning(baseEarning, incentiveAmount) {
    const base = Math.max(0, Number(baseEarning) || 0);
    const incentive = Math.max(0, Number(incentiveAmount) || 0);
    return roundMoney(base + incentive);
}
