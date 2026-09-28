import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';
import { OFFER_APPLICABLE_TO, OFFER_DISCOUNT_TYPES } from '../models/restaurantOffer.model.js';
import { DAY_NAMES, normalizeDayName, normalizeTime } from '../utils/operatingHours.js';

const objectId = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const offerSchema = z
    .object({
        title: z.string().trim().min(3, 'Title must be at least 3 characters').max(80, 'Title must be at most 80 characters'),
        description: z.string().trim().max(300, 'Description must be at most 300 characters').optional().default(''),
        applicableTo: z.enum(OFFER_APPLICABLE_TO, {
            errorMap: () => ({ message: 'Choose where the offer applies: specific items, a category or the entire menu' })
        }),
        itemIds: z.array(objectId).max(200, 'An offer can cover at most 200 items').optional().default([]),
        categoryIds: z.array(objectId).max(50, 'An offer can cover at most 50 categories').optional().default([]),
        discountType: z.enum(OFFER_DISCOUNT_TYPES, {
            errorMap: () => ({ message: 'Discount type must be percentage or flat' })
        }),
        discountValue: z.coerce.number({ invalid_type_error: 'Discount value must be a number' }).positive('Discount value must be more than 0'),
        minOrderValue: z.coerce.number({ invalid_type_error: 'Minimum order value must be a number' }).min(0, 'Minimum order value cannot be negative').optional().default(0),
        validFrom: z.coerce.date({ errorMap: () => ({ message: 'Valid from must be a valid date' }) }),
        validTill: z.coerce.date({ errorMap: () => ({ message: 'Valid till must be a valid date' }) }),
        activeDays: z.array(z.string()).max(7).optional().default([]),
        activeTimeSlot: z
            .object({
                start: z.string().optional().default(''),
                end: z.string().optional().default('')
            })
            .optional()
            .nullable(),
        isActive: z.boolean().optional().default(true)
    })
    .superRefine((data, ctx) => {
        const issue = (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
        if (data.discountType === 'percentage' && data.discountValue > 100) {
            issue('discountValue', 'Percentage discount cannot be more than 100');
        }
        if (data.applicableTo === 'specific_items' && data.itemIds.length === 0) {
            issue('itemIds', 'Select at least one item');
        }
        if (data.applicableTo === 'category' && data.categoryIds.length === 0) {
            issue('categoryIds', 'Select at least one category');
        }
        if (data.validTill <= data.validFrom) {
            issue('validTill', 'Valid till must be after valid from');
        }
    });

const unique = (values) => [...new Set(values)];

/** Canonical day names in week order; throws on anything unrecognisable. */
const normalizeDays = (days) => {
    const normalized = days.map((day) => {
        const name = normalizeDayName(day);
        if (!name) throw new ValidationError(`"${day}" is not a valid day`);
        return name;
    });
    return DAY_NAMES.filter((day) => normalized.includes(day));
};

/** { start, end } as "HH:mm", or empty strings for "all day". */
const normalizeSlot = (slot) => {
    const rawStart = String(slot?.start || '').trim();
    const rawEnd = String(slot?.end || '').trim();
    if (!rawStart && !rawEnd) return { start: '', end: '' };
    if (!rawStart || !rawEnd) throw new ValidationError('Set both a start and an end time, or leave both empty for all day');
    const start = normalizeTime(rawStart);
    const end = normalizeTime(rawEnd);
    if (!start || !end) throw new ValidationError('Times must be in HH:mm format');
    if (start === end) throw new ValidationError('Start and end time cannot be the same');
    return { start, end };
};

/**
 * Validates a create/replace payload.
 * @param {object} body
 * @param {{ requireFutureEnd?: boolean }} [options] creating needs an end in the future
 */
export const validateRestaurantOfferDto = (body, { requireFutureEnd = false } = {}) => {
    const result = offerSchema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(result.error.errors[0]?.message || 'Invalid offer data');
    }
    const data = result.data;
    if (requireFutureEnd && data.validTill <= new Date()) {
        throw new ValidationError('Valid till must be in the future');
    }
    return {
        title: data.title,
        description: data.description,
        applicableTo: data.applicableTo,
        // Only the list that matches applicableTo is kept.
        itemIds: data.applicableTo === 'specific_items' ? unique(data.itemIds) : [],
        categoryIds: data.applicableTo === 'category' ? unique(data.categoryIds) : [],
        discountType: data.discountType,
        discountValue: Math.round(data.discountValue * 100) / 100,
        minOrderValue: Math.round((data.minOrderValue || 0) * 100) / 100,
        validFrom: data.validFrom,
        validTill: data.validTill,
        activeDays: normalizeDays(data.activeDays),
        activeTimeSlot: normalizeSlot(data.activeTimeSlot),
        isActive: data.isActive
    };
};

/** PATCH /:id/toggle — an explicit target state is optional; without it the flag flips. */
export const validateRestaurantOfferToggleDto = (body) => {
    const raw = body?.isActive;
    if (raw === undefined || raw === null || raw === '') return { isActive: undefined };
    if (raw === true || raw === 'true') return { isActive: true };
    if (raw === false || raw === 'false') return { isActive: false };
    throw new ValidationError('isActive must be true or false');
};

export const assertOfferId = (id) => {
    if (!/^[a-f\d]{24}$/i.test(String(id || ''))) throw new ValidationError('Invalid offer id');
    return String(id);
};

export const validateRestaurantOfferListQuery = (query = {}) => {
    const result = z
        .object({
            page: z.coerce.number().int().min(1).optional().default(1),
            limit: z.coerce.number().int().min(1).max(100).optional().default(50)
        })
        .safeParse(query);
    if (!result.success) throw new ValidationError(result.error.errors[0]?.message || 'Invalid query');
    return result.data;
};
