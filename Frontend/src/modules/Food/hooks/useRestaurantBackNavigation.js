import { useCallback, useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"

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
  const from = toRestaurantPath(location.state?.backTo) || toRestaurantPath(location.state?.from)

  useEffect(() => {
    if (from && from !== location.pathname) rememberBackFrom(location.pathname, from)
  }, [from, location.pathname])

  return useCallback(() => {
    navigate(resolveRestaurantBackPath(location))
  }, [location, navigate])
}
