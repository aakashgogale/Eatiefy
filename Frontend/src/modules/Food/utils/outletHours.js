/**
 * Shared outlet-hours helpers.
 *
 * Opening / closing times were previously parsed and validated separately inside
 * Onboarding, AddRestaurant, EditOwner and OutletTimings — four copies that could
 * (and did) drift apart. Everything here works on the canonical "HH:mm" 24-hour
 * string the backend stores, so the wire format never changes.
 */

/**
 * One-tap choices shown under each field. Late-night values are included on
 * purpose — an outlet that opens at midnight or closes at 2 AM is normal, and
 * used to be unreachable because the old picker rejected those pairs.
 */
export const OPENING_TIME_PRESETS = ["00:00", "06:00", "08:00", "09:00", "10:00", "11:00", "12:00", "18:00"];
export const CLOSING_TIME_PRESETS = ["14:00", "18:00", "21:00", "22:00", "23:00", "00:00", "01:00", "02:00"];

/** Canonical "HH:mm", or "" when the input cannot be understood. */
export const normalizeTimeValue = (value) => {
  if (!value) return "";

  const raw = String(value).trim();
  if (!raw) return "";

  const to24Hour = (h, m, period) => {
    let hours = Number(h);
    const minutes = Number(m);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "";
    if (minutes < 0 || minutes > 59) return "";
    const p = String(period || "").toUpperCase();
    if (p === "AM") {
      if (hours === 12) hours = 0;
    } else if (p === "PM") {
      if (hours !== 12) hours += 12;
    }
    if (hours < 0 || hours > 23) return "";
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  };

  // Already "HH:mm" / "H:mm"
  const plain = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (plain) {
    const h = Number(plain[1]);
    const m = Number(plain[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return "";
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // 12-hour: "10:00 AM", "9:30pm"
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (ampm) return to24Hour(ampm[1], ampm[2], ampm[3]);

  // ISO / Date-like fallback
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
  }

  return "";
};

/** Minutes since midnight, or null when unparseable. */
export const timeStringToMinutes = (value) => {
  const normalized = normalizeTimeValue(value);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
};

/** "14:30" -> "2:30 PM" for display only. */
export const formatTime12Hour = (value) => {
  const normalized = normalizeTimeValue(value);
  if (!normalized) return "--:-- --";
  const [h, m] = normalized.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
};

/**
 * A close time earlier than the open time means the outlet trades past midnight
 * (10:00 AM -> 02:00 AM). That is a normal shift, not an error — the old screens
 * rejected it outright, which made late-night outlets impossible to register.
 */
export const isOvernightRange = (openingTime, closingTime) => {
  const open = timeStringToMinutes(openingTime);
  const close = timeStringToMinutes(closingTime);
  if (open === null || close === null) return false;
  return close < open;
};

/** Trading length in minutes, counting an overnight wrap. */
export const getOpenDurationMinutes = (openingTime, closingTime) => {
  const open = timeStringToMinutes(openingTime);
  const close = timeStringToMinutes(closingTime);
  if (open === null || close === null) return null;
  return close > open ? close - open : close + 24 * 60 - open;
};

/**
 * Validate a pair. Returns { valid, error, overnight, durationMinutes }.
 *
 * Only genuinely impossible input is an error. Partial input is "not yet valid"
 * rather than wrong, so a half-filled form never shows a red message.
 */
export const validateOutletHours = (openingTime, closingTime) => {
  const open = timeStringToMinutes(openingTime);
  const close = timeStringToMinutes(closingTime);

  if (open === null || close === null) {
    return { valid: false, error: "", overnight: false, durationMinutes: null, incomplete: true };
  }

  if (open === close) {
    return {
      valid: false,
      error: "Opening and closing time cannot be the same",
      overnight: false,
      durationMinutes: 0,
      incomplete: false,
    };
  }

  const overnight = close < open;
  return {
    valid: true,
    error: "",
    overnight,
    durationMinutes: getOpenDurationMinutes(openingTime, closingTime),
    incomplete: false,
  };
};

/** "Open for 8h 30m" style summary for the UI. */
export const formatOpenDuration = (openingTime, closingTime) => {
  const total = getOpenDurationMinutes(openingTime, closingTime);
  if (total === null || total <= 0) return "";
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
};
