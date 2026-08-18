import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { getMondayBasedWeekday, getZonedParts } from '../../../../utils/timezone.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { FoodRestaurantOutletTimings } from '../models/outletTimings.model.js';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const normalizeDay = (value) => {
    const v = String(value || '').trim();
    if (!v) return null;
    const exact = DAY_NAMES.find((d) => d.toLowerCase() === v.toLowerCase());
    if (exact) return exact;
    const abbr = v.slice(0, 3).toLowerCase();
    const match = DAY_NAMES.find((d) => d.toLowerCase().startsWith(abbr));
    return match || null;
};

const normalizeTime = (value, fallback) => {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    // Accept "HH:mm" or "H:mm"
    const m = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return fallback;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return fallback;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

const timeToMinutes = (value) => {
    const normalized = normalizeTime(value, null);
    if (!normalized) return null;
    const [h, m] = normalized.split(':').map(Number);
    return h * 60 + m;
};

const isWithinTimeWindow = (nowMinutes, openingMinutes, closingMinutes) => {
    if (openingMinutes === null || closingMinutes === null) return true;
    if (openingMinutes === closingMinutes) return true;
    if (closingMinutes > openingMinutes) {
        return nowMinutes >= openingMinutes && nowMinutes <= closingMinutes;
    }
    return nowMinutes >= openingMinutes || nowMinutes <= closingMinutes;
};

/**
 * Build a full-week timings array from restaurant-level open/close + openDays.
 * Used on onboarding so registration hours become the default for every day.
 */
export const buildTimingsFromRestaurantHours = ({
    openingTime,
    closingTime,
    openDays,
    fallbackOpening = '09:00',
    fallbackClosing = '22:00'
} = {}) => {
    const open = normalizeTime(openingTime, fallbackOpening);
    const close = normalizeTime(closingTime, fallbackClosing);

    const normalizedOpenDays = Array.isArray(openDays)
        ? openDays.map((d) => normalizeDay(d)).filter(Boolean)
        : [];
    // Empty openDays means "all days open" (same as onboarding all selected).
    const openDaySet = normalizedOpenDays.length > 0 ? new Set(normalizedOpenDays) : null;

    return DAY_NAMES.map((day) => {
        const isOpen = openDaySet ? openDaySet.has(day) : true;
        return {
            day,
            isOpen,
            openingTime: isOpen ? open : '',
            closingTime: isOpen ? close : ''
        };
    });
};

const toClientShape = (doc) => {
    const timings = Array.isArray(doc?.timings) ? doc.timings : [];
    const map = {};
    for (const day of DAY_NAMES) {
        const found = timings.find((t) => normalizeDay(t?.day) === day);
        const isOpen = found ? found.isOpen !== false : true;
        map[day] = {
            isOpen,
            openingTime: isOpen ? normalizeTime(found?.openingTime, '09:00') : '',
            closingTime: isOpen ? normalizeTime(found?.closingTime, '22:00') : ''
        };
    }
    return map;
};

/**
 * Persist weekly outlet timings for a restaurant (create if missing).
 * Does not overwrite an existing document unless `overwrite` is true.
 */
export async function seedOutletTimingsForRestaurant(
    restaurantId,
    { openingTime, closingTime, openDays } = {},
    { overwrite = false } = {}
) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }

    const timings = buildTimingsFromRestaurantHours({ openingTime, closingTime, openDays });

    if (!overwrite) {
        const existing = await FoodRestaurantOutletTimings.findOne({ restaurantId }).select('_id').lean();
        if (existing) {
            return { outletTimings: toClientShape(existing), seeded: false };
        }
    }

    const doc = await FoodRestaurantOutletTimings.findOneAndUpdate(
        { restaurantId },
        { $set: { timings } },
        { upsert: true, new: true, setDefaultsOnInsert: true, projection: 'timings updatedAt' }
    ).lean();

    return { outletTimings: toClientShape(doc), seeded: true };
}

export async function getOutletTimingsForRestaurant(restaurantId) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    const doc = await FoodRestaurantOutletTimings.findOne({ restaurantId }).select('timings updatedAt').lean();
    if (doc) {
        return { outletTimings: toClientShape(doc), persisted: true };
    }

    // No weekly row yet — use restaurant-level onboarding hours (not hardcoded 09–22).
    const restaurant = await FoodRestaurant.findById(restaurantId)
        .select('openingTime closingTime openDays')
        .lean();

    const timings = buildTimingsFromRestaurantHours({
        openingTime: restaurant?.openingTime,
        closingTime: restaurant?.closingTime,
        openDays: restaurant?.openDays
    });

    return { outletTimings: toClientShape({ timings }), persisted: false };
}

export async function upsertOutletTimingsForRestaurant(restaurantId, outletTimings) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }
    if (!outletTimings || typeof outletTimings !== 'object' || Array.isArray(outletTimings)) {
        throw new ValidationError('outletTimings must be an object keyed by day name');
    }

    // Prefer restaurant hours as fallback when a day is open but times omitted.
    const restaurant = await FoodRestaurant.findById(restaurantId)
        .select('openingTime closingTime')
        .lean();
    const fallbackOpen = normalizeTime(restaurant?.openingTime, '09:00');
    const fallbackClose = normalizeTime(restaurant?.closingTime, '22:00');

    const timings = DAY_NAMES.map((day) => {
        const src = outletTimings[day] && typeof outletTimings[day] === 'object' ? outletTimings[day] : {};
        const isOpen = src.isOpen !== false;
        return {
            day,
            isOpen,
            openingTime: isOpen ? normalizeTime(src.openingTime, fallbackOpen) : '',
            closingTime: isOpen ? normalizeTime(src.closingTime, fallbackClose) : ''
        };
    });

    const doc = await FoodRestaurantOutletTimings.findOneAndUpdate(
        { restaurantId },
        { $set: { timings } },
        { upsert: true, new: true, setDefaultsOnInsert: true, projection: 'timings updatedAt' }
    ).lean();

    return { outletTimings: toClientShape(doc), persisted: true };
}

/**
 * Shared open-now check (outlet day schedule → restaurant opening/closing).
 * Used by order create so backend matches user-side availability.
 */
export async function assertRestaurantOpenForOrders(restaurantId, now = new Date()) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ValidationError('Invalid restaurant id');
    }

    const [timingsDoc, restaurant] = await Promise.all([
        FoodRestaurantOutletTimings.findOne({ restaurantId }).select('timings').lean(),
        FoodRestaurant.findById(restaurantId).select('openingTime closingTime openDays').lean()
    ]);

    // Always evaluate against Asia/Kolkata (never server OS timezone).
    const dayName = DAY_NAMES[getMondayBasedWeekday(now)];
    const parts = getZonedParts(now);
    const nowMinutes = parts.hour * 60 + parts.minute;

    let todayTiming = null;
    if (Array.isArray(timingsDoc?.timings) && timingsDoc.timings.length > 0) {
        todayTiming = timingsDoc.timings.find((t) => normalizeDay(t?.day) === dayName) || null;
    }

    if (!todayTiming) {
        const openDays = Array.isArray(restaurant?.openDays) ? restaurant.openDays : [];
        if (openDays.length > 0) {
            const openSet = new Set(openDays.map((d) => normalizeDay(d)).filter(Boolean));
            if (openSet.size > 0 && !openSet.has(dayName)) {
                throw new ValidationError('Restaurant is closed today');
            }
        }
    } else if (todayTiming.isOpen === false) {
        throw new ValidationError('Restaurant is closed today');
    }

    const openingTime =
        todayTiming?.openingTime || restaurant?.openingTime || null;
    const closingTime =
        todayTiming?.closingTime || restaurant?.closingTime || null;

    const openingMinutes = timeToMinutes(openingTime);
    const closingMinutes = timeToMinutes(closingTime);

    if (openingMinutes === null || closingMinutes === null) {
        return true;
    }

    if (!isWithinTimeWindow(nowMinutes, openingMinutes, closingMinutes)) {
        throw new ValidationError('Restaurant is currently closed');
    }

    return true;
}
