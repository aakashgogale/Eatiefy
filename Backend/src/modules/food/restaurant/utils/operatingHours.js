/**
 * Restaurant operating-hours engine (pure, no DB access).
 *
 * Each weekday has { isOpen, openingTime, closingTime } stored as "HH:mm".
 * A closing time earlier than the opening time means the shift ends the next
 * calendar day (15:00 -> 03:00 closes Tuesday 03:00 when it opened Monday).
 * So "is it open now?" must look at today's shift AND yesterday's overnight
 * spill-over, evaluated in the business timezone, never the server's.
 *
 * Windows are half-open: [opening, closing). A restaurant closing at 23:00 is
 * closed at 23:00. Equal opening/closing is treated as open all day (legacy data).
 */
import { APP_TIMEZONE, getMondayBasedWeekday, getZonedParts } from '../../../../utils/timezone.js';

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MINUTES_PER_DAY = 24 * 60;

export const normalizeDayName = (value) => {
    const v = String(value || '').trim().toLowerCase();
    if (!v) return null;
    const exact = DAY_NAMES.find((d) => d.toLowerCase() === v);
    if (exact) return exact;
    if (v.length < 3) return null;
    return DAY_NAMES.find((d) => d.toLowerCase().startsWith(v.slice(0, 3))) || null;
};

/**
 * Canonical "HH:mm" or '' when unparseable.
 * Accepts "HH:mm", "H:mm", "HH:mm:ss", "h:mm AM", "h AM" (12 AM = 00:00, 12 PM = 12:00).
 */
export const normalizeTime = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    const pad = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    const plain = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (plain) {
        const h = Number(plain[1]);
        const m = Number(plain[2]);
        return h <= 23 && m <= 59 ? pad(h, m) : '';
    }

    const meridiem = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]\.?$/);
    if (meridiem) {
        let h = Number(meridiem[1]);
        const m = Number(meridiem[2] || 0);
        if (h < 1 || h > 12 || m > 59) return '';
        const isPm = meridiem[3].toUpperCase() === 'P';
        if (h === 12) h = isPm ? 12 : 0;
        else if (isPm) h += 12;
        return pad(h, m);
    }

    return '';
};

export const timeToMinutes = (value) => {
    const normalized = normalizeTime(value);
    if (!normalized) return null;
    const [h, m] = normalized.split(':').map(Number);
    return h * 60 + m;
};

/** True when the shift closes on the next calendar day. */
export const isOvernightWindow = (openingTime, closingTime) => {
    const open = timeToMinutes(openingTime);
    const close = timeToMinutes(closingTime);
    return open !== null && close !== null && close < open;
};

/**
 * Validates an opening/closing pair. Overnight is valid; identical times are not.
 * Returns an error message, or '' when the pair is acceptable or incomplete.
 */
export const getTimeRangeError = (openingTime, closingTime) => {
    const open = timeToMinutes(openingTime);
    const close = timeToMinutes(closingTime);
    if (open === null || close === null) return '';
    if (open === close) return 'Opening time and closing time cannot be same';
    return '';
};

/**
 * Resolve one day's effective schedule.
 * Priority: weekly outlet timings row -> restaurant-level openDays/opening/closing.
 */
const resolveDaySchedule = (dayName, timingsByDay, restaurant) => {
    const row = timingsByDay.get(dayName);
    if (row) {
        return {
            day: dayName,
            isOpen: row.isOpen !== false,
            openingTime: normalizeTime(row.openingTime) || normalizeTime(restaurant?.openingTime),
            closingTime: normalizeTime(row.closingTime) || normalizeTime(restaurant?.closingTime),
        };
    }

    const openDays = Array.isArray(restaurant?.openDays)
        ? restaurant.openDays.map(normalizeDayName).filter(Boolean)
        : [];
    return {
        day: dayName,
        // Empty openDays has always meant "every day".
        isOpen: openDays.length === 0 || openDays.includes(dayName),
        openingTime: normalizeTime(restaurant?.openingTime),
        closingTime: normalizeTime(restaurant?.closingTime),
    };
};

const buildTimingsIndex = (timings) => {
    const map = new Map();
    if (!Array.isArray(timings)) return map;
    for (const row of timings) {
        const day = normalizeDayName(row?.day);
        if (day && !map.has(day)) map.set(day, row);
    }
    return map;
};

const getWindow = (schedule) => {
    const open = timeToMinutes(schedule.openingTime);
    const close = timeToMinutes(schedule.closingTime);
    if (open === null || close === null) return null;
    return { open, close, allDay: open === close, overnight: close < open };
};

/**
 * Compute the open/closed state at `now`.
 *
 * @param {{ timings?: Array, restaurant?: object }} source
 *   timings: weekly rows [{ day, isOpen, openingTime, closingTime }]
 *   restaurant: { openingTime, closingTime, openDays } used as fallback
 * @returns {{
 *   isOpen: boolean,
 *   reason: 'open'|'overnight-open'|'all-day'|'no-timings'|'day-closed'|'before-opening'|'after-closing',
 *   day: string, shiftDay: string|null, openingTime: string|null, closingTime: string|null,
 *   overnight: boolean, closesAt: string|null, opensAt: string|null, timeZone: string
 * }}
 */
export function getOperatingStatus({ timings, restaurant } = {}, now = new Date(), timeZone = APP_TIMEZONE) {
    const timingsByDay = buildTimingsIndex(timings);
    const todayIndex = getMondayBasedWeekday(now, timeZone);
    const parts = getZonedParts(now, timeZone);
    const nowMinutes = parts.hour * 60 + parts.minute;
    // Start of the current minute, so "closes in N minutes" lands on a round minute.
    const minuteStartMs = now.getTime() - parts.second * 1000 - (now.getTime() % 1000);
    const atOffset = (minutesFromNow) => new Date(minuteStartMs + minutesFromNow * 60000).toISOString();

    const scheduleAt = (offsetDays) =>
        resolveDaySchedule(DAY_NAMES[(((todayIndex + offsetDays) % 7) + 7) % 7], timingsByDay, restaurant);

    const today = scheduleAt(0);
    const yesterday = scheduleAt(-1);

    const result = (isOpen, reason, schedule, extra = {}) => ({
        isOpen,
        reason,
        day: today.day,
        shiftDay: schedule?.day || null,
        openingTime: schedule?.openingTime || null,
        closingTime: schedule?.closingTime || null,
        overnight: schedule ? isOvernightWindow(schedule.openingTime, schedule.closingTime) : false,
        closesAt: null,
        opensAt: null,
        timeZone,
        ...extra,
    });

    // Minutes from now until the next opening, scanning up to a week ahead.
    const findOpensAt = () => {
        for (let offset = 0; offset <= 7; offset += 1) {
            const schedule = scheduleAt(offset);
            if (!schedule.isOpen) continue;
            const window = getWindow(schedule);
            const start = offset * MINUTES_PER_DAY + (window ? window.open : 0);
            if (start > nowMinutes) return atOffset(start - nowMinutes);
        }
        return null;
    };

    // 1) Yesterday's overnight shift still running (e.g. Mon 15:00 -> Tue 03:00, now Tue 01:00).
    if (yesterday.isOpen) {
        const window = getWindow(yesterday);
        if (window?.overnight && nowMinutes < window.close) {
            return result(true, 'overnight-open', yesterday, {
                closesAt: atOffset(window.close - nowMinutes),
            });
        }
    }

    // 2) Today's shift.
    if (!today.isOpen) {
        return result(false, 'day-closed', today, { opensAt: findOpensAt() });
    }

    const window = getWindow(today);
    if (!window) {
        // No complete window configured: hours are not enforced (historic behaviour).
        return result(true, 'no-timings', today);
    }
    if (window.allDay) {
        return result(true, 'all-day', today);
    }
    if (window.overnight) {
        if (nowMinutes >= window.open) {
            return result(true, 'open', today, {
                closesAt: atOffset(MINUTES_PER_DAY - nowMinutes + window.close),
            });
        }
        return result(false, 'before-opening', today, { opensAt: atOffset(window.open - nowMinutes) });
    }
    if (nowMinutes >= window.open && nowMinutes < window.close) {
        return result(true, 'open', today, { closesAt: atOffset(window.close - nowMinutes) });
    }
    if (nowMinutes < window.open) {
        return result(false, 'before-opening', today, { opensAt: atOffset(window.open - nowMinutes) });
    }
    return result(false, 'after-closing', today, { opensAt: findOpensAt() });
}
