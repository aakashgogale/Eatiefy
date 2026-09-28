import { z } from 'zod';
import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';

const createOfferSchema = z.object({
    couponCode: z.string().min(1, 'Coupon code is required'),
    discountType: z.enum(['percentage', 'flat-price']).default('percentage'),
    discountValue: z.number().positive('Discount value must be greater than 0'),
    customerScope: z.enum(['all', 'first-time']).default('all'),
    restaurantScope: z.enum(['all', 'selected']).default('all'),
    restaurantId: z.string().optional(),
    endDate: z.string().optional().or(z.literal('')).or(z.undefined()),
    startDate: z.string().optional().or(z.literal('')).or(z.undefined()),
    minOrderValue: z.number().min(0).optional(),
    maxDiscount: z.number().min(0).optional(),
    usageLimit: z.number().min(0).optional(),
    perUserLimit: z.number().min(0).optional(),
    isFirstOrderOnly: z.boolean().optional(),
    couponType: z.enum(['delivery', 'takeaway', 'all']).default('all'),
    zoneIds: z.array(z.string()).optional()
});

/*
 * The admin form sends calendar dates ("2026-09-30"). They were stored as UTC
 * midnight, i.e. 5:30 AM IST: a coupon "valid till 30 Sep" died early that
 * morning, and one ending today was rejected as "not a future date". Dates are
 * whole days in India time: start at 00:00 IST, end at 23:59:59.999 IST.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const toIstDayBoundary = (value, endOfDay) => {
    const raw = String(value || '').trim();
    if (!raw) return undefined;
    if (DATE_ONLY.test(raw)) {
        return new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`);
    }
    return new Date(raw);
};

export const validateCreateOfferDto = (body) => {
    const normalized = {
        ...body,
        couponCode: typeof body?.couponCode === 'string' ? body.couponCode.trim() : body?.couponCode,
        discountType: body?.discountType,
        discountValue: Number(body?.discountValue),
        customerScope: body?.customerScope,
        restaurantScope: body?.restaurantScope,
        restaurantId: body?.restaurantId ? String(body.restaurantId) : undefined,
        endDate: body?.endDate ? String(body.endDate) : undefined,
        startDate: body?.startDate ? String(body.startDate) : undefined,
        minOrderValue: (() => {
            if (body?.minOrderValue === undefined || body?.minOrderValue === null || body?.minOrderValue === '') {
                return undefined;
            }
            const parsed = Number(body.minOrderValue);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
        })(),
        maxDiscount: body?.maxDiscount !== undefined ? Number(body.maxDiscount) : undefined,
        usageLimit: body?.usageLimit !== undefined ? Number(body.usageLimit) : undefined,
        perUserLimit: body?.perUserLimit !== undefined ? Number(body.perUserLimit) : undefined,
        isFirstOrderOnly: body?.isFirstOrderOnly !== undefined ? Boolean(body.isFirstOrderOnly) : undefined,
        couponType: body?.couponType || 'all',
        zoneIds: Array.isArray(body?.zoneIds)
            ? body.zoneIds.map((z) => String(z || '').trim()).filter(Boolean)
            : undefined
    };

    const result = createOfferSchema.safeParse(normalized);
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }

    if (result.data.restaurantScope === 'selected') {
        if (!result.data.restaurantId || !mongoose.Types.ObjectId.isValid(result.data.restaurantId)) {
            throw new ValidationError('Valid restaurantId is required for selected restaurant scope');
        }
    }

    const endDate = toIstDayBoundary(result.data.endDate, true);
    const zoneIds = [...new Set(result.data.zoneIds || [])];
    if (zoneIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
        throw new ValidationError('Invalid zone selected');
    }
    if (endDate && Number.isNaN(endDate.getTime())) {
        throw new ValidationError('Invalid endDate');
    }
    const startDate = toIstDayBoundary(result.data.startDate, false);
    if (startDate && Number.isNaN(startDate.getTime())) {
        throw new ValidationError('Invalid startDate');
    }
    if (endDate && startDate && endDate.getTime() <= startDate.getTime()) {
        throw new ValidationError('endDate must be after startDate');
    }
    if (endDate && endDate.getTime() <= Date.now()) {
        throw new ValidationError('endDate must be a future date');
    }
    // Business rule: percentage coupon must have maxDiscount; flat ignores it
    let maxDiscount = result.data.maxDiscount;
    if (result.data.discountType === 'percentage') {
        if (maxDiscount === undefined || maxDiscount === null || Number.isNaN(Number(maxDiscount))) {
            throw new ValidationError('maxDiscount is required for percentage coupons');
        }
        maxDiscount = Math.max(0, Number(maxDiscount) || 0);
    } else {
        maxDiscount = undefined; // ignore for flat-price
    }

    return {
        couponCode: result.data.couponCode.trim().toUpperCase(),
        discountType: result.data.discountType,
        discountValue: result.data.discountValue,
        customerScope: result.data.customerScope,
        restaurantScope: result.data.restaurantScope,
        restaurantId: result.data.restaurantScope === 'selected' ? result.data.restaurantId : undefined,
        endDate,
        startDate,
        minOrderValue: result.data.minOrderValue,
        maxDiscount,
        usageLimit: result.data.usageLimit,
        perUserLimit: result.data.perUserLimit,
        isFirstOrderOnly: result.data.isFirstOrderOnly === true,
        couponType: result.data.couponType,
        // Empty = every zone.
        zoneIds
    };
};

const cartVisibilitySchema = z.object({
    itemId: z.string().min(1, 'itemId is required'),
    showInCart: z.boolean()
});

export const validateUpdateOfferCartVisibilityDto = (body) => {
    const result = cartVisibilitySchema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(result.error.errors[0].message);
    }
    return result.data;
};
