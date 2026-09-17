/**
 * Restaurant operating-hours engine — mirror of the backend
 * `Backend/src/modules/food/restaurant/utils/operatingHours.js`.
 * Keep the two in sync: the backend decides whether an order is accepted, this
 * copy only drives what the UI shows before the server answers.
 *
 * A closing time earlier than the opening time is an overnight shift
 * (15:00 -> 03:00 closes at 03:00 the next day), so "open now" checks today's
 * shift and yesterday's spill-over. Always evaluated in the business timezone
 * (IST), never the device clock's zone. Windows are [opening, closing).
 */

export const APP_TIMEZONE = "Asia/Kolkata"
/** IST has no DST — fixed +05:30 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
export const MINUTES_PER_DAY = 24 * 60

export const normalizeDayName = (value) => {
  const v = String(value || "").trim().toLowerCase()
  if (!v) return null
  const exact = DAY_NAMES.find((d) => d.toLowerCase() === v)
  if (exact) return exact
  if (v.length < 3) return null
  return DAY_NAMES.find((d) => d.toLowerCase().startsWith(v.slice(0, 3))) || null
}

/**
 * Canonical "HH:mm" or "" when unparseable.
 * Accepts "HH:mm", "H:mm", "HH:mm:ss", "h:mm AM", "h AM" (12 AM = 00:00, 12 PM = 12:00).
 */
export const normalizeTime = (value) => {
  const raw = String(value ?? "").trim()
  if (!raw) return ""

  const pad = (h, m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`

  const plain = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (plain) {
    const h = Number(plain[1])
    const m = Number(plain[2])
    return h <= 23 && m <= 59 ? pad(h, m) : ""
  }

  const meridiem = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]\.?$/)
  if (meridiem) {
    let h = Number(meridiem[1])
    const m = Number(meridiem[2] || 0)
    if (h < 1 || h > 12 || m > 59) return ""
    const isPm = meridiem[3].toUpperCase() === "P"
    if (h === 12) h = isPm ? 12 : 0
    else if (isPm) h += 12
    return pad(h, m)
  }

  return ""
}

export const timeToMinutes = (value) => {
  const normalized = normalizeTime(value)
  if (!normalized) return null
  const [h, m] = normalized.split(":").map(Number)
  return h * 60 + m
}

export const isOvernightWindow = (openingTime, closingTime) => {
  const open = timeToMinutes(openingTime)
  const close = timeToMinutes(closingTime)
  return open !== null && close !== null && close < open
}

export const getTimeRangeError = (openingTime, closingTime) => {
  const open = timeToMinutes(openingTime)
  const close = timeToMinutes(closingTime)
  if (open === null || close === null) return ""
  if (open === close) return "Opening time and closing time cannot be same"
  return ""
}

/** Wall-clock parts in IST for an instant. */
export const getBusinessClock = (now = new Date()) => {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS)
  return {
    dayIndex: (shifted.getUTCDay() + 6) % 7, // Monday = 0
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  }
}

/**
 * Accepts every shape outlet timings arrive in and returns weekly rows:
 * - [{ day, isOpen, openingTime, closingTime }]
 * - { timings: [...] }
 * - { Monday: { isOpen, openingTime, closingTime }, ... }
 * - a single { day, ... } row (legacy list projection)
 */
export const toTimingRows = (outletTimings) => {
  if (!outletTimings) return []
  if (Array.isArray(outletTimings)) return outletTimings
  if (typeof outletTimings !== "object") return []
  if (Array.isArray(outletTimings.timings)) return outletTimings.timings
  if (typeof outletTimings.day === "string") return [outletTimings]
  return Object.entries(outletTimings)
    .filter(([day, row]) => normalizeDayName(day) && row && typeof row === "object")
    .map(([day, row]) => ({ ...row, day }))
}

const resolveDaySchedule = (dayName, timingsByDay, restaurant) => {
  const row = timingsByDay.get(dayName)
  if (row) {
    return {
      day: dayName,
      isOpen: row.isOpen !== false,
      openingTime: normalizeTime(row.openingTime) || normalizeTime(restaurant?.openingTime),
      closingTime: normalizeTime(row.closingTime) || normalizeTime(restaurant?.closingTime),
    }
  }

  const openDays = Array.isArray(restaurant?.openDays)
    ? restaurant.openDays.map(normalizeDayName).filter(Boolean)
    : []
  return {
    day: dayName,
    isOpen: openDays.length === 0 || openDays.includes(dayName),
    openingTime: normalizeTime(restaurant?.openingTime),
    closingTime: normalizeTime(restaurant?.closingTime),
  }
}

const buildTimingsIndex = (timings) => {
  const map = new Map()
  for (const row of toTimingRows(timings)) {
    const day = normalizeDayName(row?.day)
    if (day && !map.has(day)) map.set(day, row)
  }
  return map
}

const getWindow = (schedule) => {
  const open = timeToMinutes(schedule.openingTime)
  const close = timeToMinutes(schedule.closingTime)
  if (open === null || close === null) return null
  return { open, close, allDay: open === close, overnight: close < open }
}

/**
 * Same contract as the backend `getOperatingStatus`, plus `minutesUntilClose`
 * for countdown labels.
 */
export const getOperatingStatus = ({ timings, restaurant } = {}, now = new Date()) => {
  const timingsByDay = buildTimingsIndex(timings)
  const { dayIndex, minutes: nowMinutes, second } = getBusinessClock(now)
  const minuteStartMs = now.getTime() - second * 1000 - (now.getTime() % 1000)
  const atOffset = (minutesFromNow) => new Date(minuteStartMs + minutesFromNow * 60000).toISOString()

  const scheduleAt = (offsetDays) =>
    resolveDaySchedule(DAY_NAMES[(((dayIndex + offsetDays) % 7) + 7) % 7], timingsByDay, restaurant)

  const today = scheduleAt(0)
  const yesterday = scheduleAt(-1)

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
    minutesUntilClose: null,
    timeZone: APP_TIMEZONE,
    ...extra,
  })

  const closing = (minutesLeft) => ({ closesAt: atOffset(minutesLeft), minutesUntilClose: minutesLeft })

  const findOpensAt = () => {
    for (let offset = 0; offset <= 7; offset += 1) {
      const schedule = scheduleAt(offset)
      if (!schedule.isOpen) continue
      const window = getWindow(schedule)
      const start = offset * MINUTES_PER_DAY + (window ? window.open : 0)
      if (start > nowMinutes) return atOffset(start - nowMinutes)
    }
    return null
  }

  if (yesterday.isOpen) {
    const window = getWindow(yesterday)
    if (window?.overnight && nowMinutes < window.close) {
      return result(true, "overnight-open", yesterday, closing(window.close - nowMinutes))
    }
  }

  if (!today.isOpen) {
    return result(false, "day-closed", today, { opensAt: findOpensAt() })
  }

  const window = getWindow(today)
  if (!window) return result(true, "no-timings", today)
  if (window.allDay) return result(true, "all-day", today)

  if (window.overnight) {
    if (nowMinutes >= window.open) {
      return result(true, "open", today, closing(MINUTES_PER_DAY - nowMinutes + window.close))
    }
    return result(false, "before-opening", today, { opensAt: atOffset(window.open - nowMinutes) })
  }
  if (nowMinutes >= window.open && nowMinutes < window.close) {
    return result(true, "open", today, closing(window.close - nowMinutes))
  }
  if (nowMinutes < window.open) {
    return result(false, "before-opening", today, { opensAt: atOffset(window.open - nowMinutes) })
  }
  return result(false, "after-closing", today, { opensAt: findOpensAt() })
}
