import { useCallback, useEffect } from "react"
import { useLocation, useNavigate, useNavigationType } from "react-router-dom"

/*
 * This session's in-app history, oldest first, kept in step with the router by
 * useTrackRestaurantHistory (mounted once in RestaurantRouter). Back pops the
 * real entry when it already is where back should lead, so the on-screen arrow
 * and the phone's back button walk the same stack. Pushing a copy instead left
 * the page just closed underneath: the phone's back button then reopened it,
 * and the stack grew with every round trip.
 */
const MAX_TRACKED_ENTRIES = 50
const historyEntries = []

export function useTrackRestaurantHistory() {
  const location = useLocation()
  const navigationType = useNavigationType()

  useEffect(() => {
    if (historyEntries[historyEntries.length - 1]?.key === location.key) return
    const entry = { key: location.key, pathname: location.pathname }

    if (navigationType === "POP") {
      // Back/forward (or a fresh start): continue from that entry if known.
      const index = historyEntries.findIndex((e) => e.key === location.key)
      historyEntries.splice(index >= 0 ? index + 1 : 0)
      if (index < 0) historyEntries.push(entry)
      return
    }
    if (navigationType === "REPLACE" && historyEntries.length) {
      historyEntries[historyEntries.length - 1] = entry
      return
    }
    historyEntries.push(entry)
    if (historyEntries.length > MAX_TRACKED_ENTRIES) historyEntries.shift()
  }, [location.key, location.pathname, navigationType])
}

const pathOnly = (value) => String(value || "").split(/[?#]/)[0]

/*
 * Where a page was opened from, remembered per page for the session. Router
 * state (`from`) is lost as soon as the page changes its own URL (e.g. Payout
 * switching ?tab=), reloads, or the WebView is restored - and the fallback was
 * the Orders screen, so returning from a page opened in Explore landed on
 * Orders instead of Explore.
 */
const BACK_FROM_KEY = (pathname) => `restaurant_back_from:${pathname}`

const rememberBackFrom = (pathname, from) => {
  try {
    sessionStorage.setItem(BACK_FROM_KEY(pathname), from)
  } catch {
    /* storage unavailable */
  }
}

const readBackFrom = (pathname) => {
  try {
    return sessionStorage.getItem(BACK_FROM_KEY(pathname))
  } catch {
    return null
  }
}

const forgetBackFrom = (pathname) => {
  try {
    sessionStorage.removeItem(BACK_FROM_KEY(pathname))
  } catch {
    /* storage unavailable */
  }
}

const toRestaurantPath = (value) => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()

  if (!trimmed) return null
  if (trimmed.startsWith("/food/restaurant")) return trimmed
  if (trimmed === "/restaurant") return "/food/restaurant"
  if (trimmed.startsWith("/restaurant/")) return `/food${trimmed}`

  return null
}

const getNormalizedRestaurantPath = (pathname) => {
  if (pathname.startsWith("/food/restaurant")) {
    return pathname.slice("/food/restaurant".length) || "/"
  }

  return pathname || "/"
}

const resolveRestaurantBackPath = ({ pathname, state }) => {
  const normalizedPath = getNormalizedRestaurantPath(pathname)
  const rememberedFrom = toRestaurantPath(readBackFrom(pathname))
  const explicitBackPath =
    toRestaurantPath(state?.backTo) ||
    toRestaurantPath(state?.from) ||
    (rememberedFrom && rememberedFrom !== pathname ? rememberedFrom : null)

  if (normalizedPath === "/orders/all") {
    return explicitBackPath || "/food/restaurant"
  }

  if (/^\/orders\/[^/]+$/.test(normalizedPath)) {
    return explicitBackPath || "/food/restaurant/orders/all"
  }

  if (
    normalizedPath === "/food/all" ||
    /^\/food\/[^/]+$/.test(normalizedPath) ||
    /^\/food\/[^/]+\/edit$/.test(normalizedPath)
  ) {
    return explicitBackPath || "/food/restaurant/food/all"
  }

  if (
    normalizedPath === "/advertisements/new" ||
    /^\/advertisements\/[^/]+$/.test(normalizedPath) ||
    /^\/advertisements\/[^/]+\/edit$/.test(normalizedPath)
  ) {
    return explicitBackPath || "/food/restaurant/advertisements"
  }

  if (
    normalizedPath === "/coupon/new" ||
    /^\/coupon\/[^/]+\/edit$/.test(normalizedPath)
  ) {
    return explicitBackPath || "/food/restaurant/coupon"
  }

  if (
    normalizedPath === "/edit" ||
    normalizedPath === "/edit-owner" ||
    normalizedPath === "/edit-cuisines" ||
    normalizedPath === "/edit-address" ||
    normalizedPath === "/phone" ||
    normalizedPath === "/manage-outlets" ||
    normalizedPath === "/update-bank-details" ||
    normalizedPath === "/fssai" ||
    normalizedPath === "/fssai/update" ||
    normalizedPath === "/outlet-info" ||
    normalizedPath === "/outlet-timings" ||
    /^\/outlet-timings\/[^/]+$/.test(normalizedPath) ||
    normalizedPath === "/zone-setup"
  ) {
    return explicitBackPath || "/food/restaurant/explore"
  }

  // Pages listed in Explore return to Explore.
  if (
    normalizedPath === "/delivery-settings" ||
    normalizedPath === "/menu-categories" ||
    normalizedPath === "/offers" ||
    normalizedPath === "/hub-finance" ||
    normalizedPath === "/feedback" ||
    normalizedPath.toLowerCase() === "/share-feedback"
  ) {
    return explicitBackPath || "/food/restaurant/explore"
  }

  if (
    normalizedPath === "/settings" ||
    normalizedPath === "/rush-hour" ||
    normalizedPath === "/status" ||
    normalizedPath === "/business-plan" ||
    normalizedPath === "/config" ||
    normalizedPath === "/categories" ||
    normalizedPath === "/privacy" ||
    normalizedPath === "/terms"
  ) {
    return explicitBackPath || "/food/restaurant"
  }

  if (
    normalizedPath === "/reviews" ||
    /^\/reviews\/[^/]+\/reply$/.test(normalizedPath) ||
    normalizedPath === "/ratings-reviews" ||
    normalizedPath === "/dish-ratings"
  ) {
    return explicitBackPath || "/food/restaurant/reviews"
  }

  if (
    normalizedPath === "/help-centre/support" ||
    normalizedPath === "/help-content"
  ) {
    return explicitBackPath || "/food/restaurant/feedback"
  }

  if (normalizedPath === "/reservations") {
    return explicitBackPath || "/food/restaurant/explore"
  }

  if (
    normalizedPath === "/finance-details" ||
    normalizedPath === "/download-report"
  ) {
    return explicitBackPath || "/food/restaurant/hub-finance"
  }

  if (/^\/hub-menu\/item\/[^/]+$/.test(normalizedPath)) {
    return explicitBackPath || "/food/restaurant/explore"
  }

  if (explicitBackPath && explicitBackPath !== pathname) {
    return explicitBackPath
  }

  return "/food/restaurant"
}

export default function useRestaurantBackNavigation() {
  const navigate = useNavigate()
  const location = useLocation()
  const navigationType = useNavigationType()
  const from = toRestaurantPath(location.state?.backTo) || toRestaurantPath(location.state?.from)

  useEffect(() => {
    if (from && from !== location.pathname) {
      rememberBackFrom(location.pathname, from)
    } else if (!from && navigationType === "PUSH") {
      // Opened afresh without an origin (e.g. from a bottom tab): an origin
      // remembered from an earlier visit no longer applies.
      forgetBackFrom(location.pathname)
    }
  }, [from, location.pathname, navigationType])

  return useCallback(() => {
    const target = resolveRestaurantBackPath(location)
    const current = historyEntries[historyEntries.length - 1]
    const previous = historyEntries[historyEntries.length - 2]
    if (current?.key === location.key && previous?.pathname === pathOnly(target)) {
      navigate(-1)
      return
    }
    navigate(target)
  }, [location, navigate])
}
