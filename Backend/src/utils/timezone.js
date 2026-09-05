/** India business timezone helpers for delivery earnings/pocket ranges. */

export const APP_TIMEZONE = 'Asia/Kolkata';
/** IST has no DST — fixed +05:30 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Get calendar Y/M/D parts in Asia/Kolkata.
 */
export function getZonedParts(date = new Date(), timeZone = APP_TIMEZONE) {
  const d = date instanceof Date ? date : new Date(date);
  if (timeZone === APP_TIMEZONE) {
    const ist = new Date(d.getTime() + IST_OFFSET_MS);
    return {
      year: ist.getUTCFullYear(),
      month: ist.getUTCMonth() + 1,
      day: ist.getUTCDate(),
      hour: ist.getUTCHours(),
      minute: ist.getUTCMinutes(),
      second: ist.getUTCSeconds(),
    };
  }

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * Convert Asia/Kolkata wall-clock time to a UTC Date.
 */
export function zonedWallTimeToUtc(
  { year, month, day, hour = 0, minute = 0, second = 0, ms = 0 },
  timeZone = APP_TIMEZONE,
) {
  if (timeZone === APP_TIMEZONE) {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms) - IST_OFFSET_MS);
  }

  // Generic fallback (rare for this app)
  let utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  for (let i = 0; i < 3; i += 1) {
    const parts = getZonedParts(utc, timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const wanted = Date.UTC(year, month - 1, day, hour, minute, second, ms);
    utc = new Date(utc.getTime() + (wanted - asUtc));
  }
  return utc;
}

export function toStartOfDayInTimeZone(date = new Date(), timeZone = APP_TIMEZONE) {
  const p = getZonedParts(date, timeZone);
  return zonedWallTimeToUtc(
    { year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0, ms: 0 },
    timeZone,
  );
}

export function toEndOfDayInTimeZone(date = new Date(), timeZone = APP_TIMEZONE) {
  const p = getZonedParts(date, timeZone);
  return zonedWallTimeToUtc(
    { year: p.year, month: p.month, day: p.day, hour: 23, minute: 59, second: 59, ms: 999 },
    timeZone,
  );
}

/** Monday=0 ... Sunday=6 in Asia/Kolkata */
export function getMondayBasedWeekday(date = new Date(), timeZone = APP_TIMEZONE) {
  const p = getZonedParts(date, timeZone);
  // UTC weekday of that IST calendar date at 12:00 IST
  const noonUtc = zonedWallTimeToUtc(
    { year: p.year, month: p.month, day: p.day, hour: 12 },
    timeZone,
  );
  const sundayBased = noonUtc.getUTCDay(); // Sun=0
  return (sundayBased + 6) % 7; // Mon=0
}

/**
 * Week range Monday 00:00:00.000 → Sunday 23:59:59.999 in Asia/Kolkata.
 */
export function getWeekRangeInTimeZone(anchorDate = new Date(), timeZone = APP_TIMEZONE) {
  const p = getZonedParts(anchorDate, timeZone);
  const mondayOffset = getMondayBasedWeekday(anchorDate, timeZone);
  const mondayUtcNoon = zonedWallTimeToUtc(
    { year: p.year, month: p.month, day: p.day - mondayOffset, hour: 12 },
    timeZone,
  );
  const mp = getZonedParts(mondayUtcNoon, timeZone);
  const start = zonedWallTimeToUtc(
    { year: mp.year, month: mp.month, day: mp.day, hour: 0, minute: 0, second: 0, ms: 0 },
    timeZone,
  );
  const sundayUtcNoon = zonedWallTimeToUtc(
    { year: mp.year, month: mp.month, day: mp.day + 6, hour: 12 },
    timeZone,
  );
  const sp = getZonedParts(sundayUtcNoon, timeZone);
  const end = zonedWallTimeToUtc(
    { year: sp.year, month: sp.month, day: sp.day, hour: 23, minute: 59, second: 59, ms: 999 },
    timeZone,
  );
  return { start, end };
}

export function getMonthRangeInTimeZone(anchorDate = new Date(), timeZone = APP_TIMEZONE) {
  const p = getZonedParts(anchorDate, timeZone);
  const start = zonedWallTimeToUtc(
    { year: p.year, month: p.month, day: 1, hour: 0, minute: 0, second: 0, ms: 0 },
    timeZone,
  );
  const end = zonedWallTimeToUtc(
    { year: p.year, month: p.month + 1, day: 0, hour: 23, minute: 59, second: 59, ms: 999 },
    timeZone,
  );
  return { start, end };
}
