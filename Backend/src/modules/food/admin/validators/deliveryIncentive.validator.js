import { z } from 'zod';
import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { DELIVERY_INCENTIVE_ORDER_VALUE_BASES } from '../models/deliveryIncentiveSettings.model.js';

const deliveryIncentiveUpsertSchema = z.object({
    zoneId: z.string().min(1, 'zoneId is required'),
    isEnabled: z.boolean().optional(),
    incentivePercent: z
        .number({ invalid_type_error: 'Incentive percent must be a number' })
        .finite('Incentive percent must be a number')
        .min(0, 'Incentive percent cannot be negative')
        .max(100, 'Incentive percent cannot exceed 100')
        .optional(),
    orderValueBasis: z
        .enum(DELIVERY_INCENTIVE_ORDER_VALUE_BASES, {
            errorMap: () => ({ message: `Order value basis must be one of: ${DELIVERY_INCENTIVE_ORDER_VALUE_BASES.join(', ')}` })
        })
        .optional()
});

const parseBoolean = (value) => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    const s = String(value).trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0') return false;
    return value;
};

export const validateZoneIdParam = (zoneId) => {
    const raw = zoneId != null ? String(zoneId).trim() : '';
    if (!raw) throw new ValidationError('zoneId is required');
    if (!mongoose.Types.ObjectId.isValid(raw)) throw new ValidationError('Invalid zoneId');
    return raw;
};

export const validateDeliveryIncentiveUpsertDto = (body) => {
    const normalized = {
        zoneId: body?.zoneId != null ? String(body.zoneId).trim() : '',
        isEnabled: parseBoolean(body?.isEnabled),
        incentivePercent:
            body?.incentivePercent === undefined || body?.incentivePercent === null || body?.incentivePercent === ''
                ? undefined
                : Number(body.incentivePercent),
        orderValueBasis:
            body?.orderValueBasis !== undefined ? String(body.orderValueBasis).trim().toLowerCase() : undefined
    };

    const result = deliveryIncentiveUpsertSchema.safeParse(normalized);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    validateZoneIdParam(result.data.zoneId);
    return result.data;
};
