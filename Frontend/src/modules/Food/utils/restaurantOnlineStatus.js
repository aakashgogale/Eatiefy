import { restaurantAPI } from "@food/api"
import { timeStringToMinutes } from "@food/utils/outletHours"

/**
 * One source of truth for "is this outlet online right now".
 *
 * The status shown on Restaurant Home used to come straight from a localStorage
 * mirror that only the Status toggle ever wrote. Anything else that changed the
 * real state — outlet timings closing the day, another device, an admin change
 * — left Home showing a stale value until a full reload.
 *
 * Effective status = `isAcceptingOrders` (the stored switch) AND the outlet
 * being within today's configured timings. localStorage is kept purely as a
 * first-paint hint; the backend is always re-read and wins.
 */

export const RESTAURANT_ONLINE_STATUS_KEY = "restaurant_online_status"
export const RESTAURANT_STATUS_EVENT = "restaurantStatusChanged"
export const OUTLET_TIMINGS_EVENT = "outletTimingsUpdated"

/** Last-known value, for instant paint before the network answers. */
export const readCachedOnlineStatus = () => {
  try {
    const raw = localStorage.getItem(RESTAURANT_ONLINE_STATUS_KEY)
    if (raw === null) return null
    return Boolean(JSON.parse(raw))
  } catch {
    return null
  }
}

const writeCachedOnlineStatus = (isOnline) => {
  try {
    localStorage.setItem(RESTAURANT_ONLINE_STATUS_KEY, JSON.stringify(Boolean(isOnline)))
  } catch {
    // Private mode / quota — the network value still drives the UI.
  }
}

/**
 * Records the new status and tells every mounted listener about it.
 * Call this from anywhere that changes the outlet's online state.
 */
export const publishOnlineStatus = (isOnline) => {
  const value = Boolean(isOnline)
  writeCachedOnlineStatus(value)
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(RESTAURANT_STATUS_EVENT, { detail: { isOnline: value } })
    )
  }
  return value
}

/**
 * True when `now` falls inside the day's configured window.
 * A day marked closed, or with no window configured, is handled by the caller.
 */
export const isWithinOutletTimings = (dayTimings, now = new Date()) => {
  if (!dayTimings) return true
  if (dayTimings.isOpen === false) return false
  if (!dayTimings.openingTime || !dayTimings.closingTime) return true

  const opening = timeStringToMinutes(dayTimings.openingTime)
  const closing = timeStringToMinutes(dayTimings.closingTime)
  if (!Number.isFinite(opening) || !Number.isFinite(closing)) return true

  const current = now.getHours() * 60 + now.getMinutes()
  // A closing time earlier than the opening time means the window crosses midnight.
  if (closing > opening) return current >= opening && current <= closing
  return current >= opening || current <= closing
}

export const getTodayTimings = (outletTimings, now = new Date()) => {
  if (!outletTimings) return null
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" })
  return outletTimings[dayName] || null
}

/** Effective online state from the two stored inputs. */
export const resolveOnlineStatus = ({ isAcceptingOrders, outletTimings } = {}, now = new Date()) => {
  if (!isAcceptingOrders) return false
  return isWithinOutletTimings(getTodayTimings(outletTimings, now), now)
}

/**
 * Re-reads the authoritative state and publishes it.
 * `refreshCurrentRestaurant` deliberately bypasses the 15s profile cache, so a
 * status change made moments ago is never masked by a stale cached response.
 */
export const fetchAuthoritativeOnlineStatus = async () => {
  const [profileRes, timingsRes] = await Promise.allSettled([
    restaurantAPI.refreshCurrentRestaurant(),
    restaurantAPI.getOutletTimings(),
  ])

  if (profileRes.status !== "fulfilled") {
    // Network trouble: keep showing what we last knew rather than flipping to
    // a value we cannot vouch for.
    return readCachedOnlineStatus()
  }

  const restaurant =
    profileRes.value?.data?.data?.restaurant || profileRes.value?.data?.restaurant || null
  const outletTimings =
    timingsRes.status === "fulfilled"
      ? timingsRes.value?.data?.data?.outletTimings || timingsRes.value?.data?.outletTimings || null
      : null

  const isOnline = resolveOnlineStatus({
    isAcceptingOrders: restaurant?.isAcceptingOrders !== false && Boolean(restaurant),
    outletTimings,
  })

  return publishOnlineStatus(isOnline)
}

/**
 * Subscribes to every way the status can change: an explicit publish, an outlet
 * timings save, and another tab writing the mirror. Returns an unsubscribe fn.
 */
export const subscribeToOnlineStatus = (onChange) => {
  if (typeof window === "undefined") return () => {}

  const handleStatusEvent = (event) => {
    onChange(Boolean(event?.detail?.isOnline), "status")
  }
  // A timings change can flip the effective status, but the event carries no
  // value — re-read the authoritative state instead of guessing.
  const handleTimingsEvent = () => {
    onChange(null, "timings")
  }
  const handleStorage = (event) => {
    if (event.key !== RESTAURANT_ONLINE_STATUS_KEY) return
    onChange(readCachedOnlineStatus(), "storage")
  }

  window.addEventListener(RESTAURANT_STATUS_EVENT, handleStatusEvent)
  window.addEventListener(OUTLET_TIMINGS_EVENT, handleTimingsEvent)
  window.addEventListener("storage", handleStorage)

  return () => {
    window.removeEventListener(RESTAURANT_STATUS_EVENT, handleStatusEvent)
    window.removeEventListener(OUTLET_TIMINGS_EVENT, handleTimingsEvent)
    window.removeEventListener("storage", handleStorage)
  }
}
