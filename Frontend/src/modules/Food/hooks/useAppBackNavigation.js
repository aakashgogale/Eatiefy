import { useCallback } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useProfile } from "@food/context/ProfileContext"

const toFoodPath = (value) => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("/food/")) return trimmed
  if (trimmed === "/food") return trimmed
  if (trimmed.startsWith("/user/")) return `/food${trimmed}`
  if (trimmed === "/user") return "/food/user"
  return null
}

const getNormalizedUserPath = (pathname) => {
  if (pathname.startsWith("/food")) {
    return pathname.slice(5) || "/"
  }
  return pathname || "/"
}

const pathsMatch = (a, b) => {
  const norm = (p) => String(p || "").replace(/\/+$/, "") || "/"
  return norm(a) === norm(b)
}

const resolveBackPath = ({ pathname, search, state, orderType }) => {
  const normalizedPath = getNormalizedUserPath(pathname)
  const explicitBackPath = toFoodPath(state?.backTo) || toFoodPath(state?.from) || toFoodPath(state?.returnTo)
  const searchParams = new URLSearchParams(search || "")
  const defaultHomePath = orderType === "takeaway" ? "/food/user/takeaway" : "/food/user"

  if (
    normalizedPath === "/user/profile/payments/new" ||
    /^\/user\/profile\/payments\/[^/]+\/edit$/.test(normalizedPath)
  ) {
    return explicitBackPath || "/food/user/profile/payments"
  }

  if (
    /^\/user\/profile\/(edit|favorites|support|coupons|about|report-safety-emergency|accessibility|logout|refer-earn|payments)$/.test(
      normalizedPath,
    )
  ) {
    return explicitBackPath || "/food/user/profile"
  }

  if (
    /^\/user\/profile\/(terms|privacy|refund|shipping|cancellation|support-info)$/.test(
      normalizedPath,
    )
  ) {
    return explicitBackPath || "/food/user/profile"
  }

  if (normalizedPath === "/user/wallet") {
    return explicitBackPath || "/food/user/profile"
  }

  if (normalizedPath === "/user/notifications") {
    return explicitBackPath || defaultHomePath
  }

  if (/^\/user\/restaurants\/[^/]+$/.test(normalizedPath)) {
    if (searchParams.get("under250") === "true") {
      return "/food/user/under-250"
    }
    return explicitBackPath || defaultHomePath
  }

  if (/^\/user\/dining\/book(\/|$)/.test(normalizedPath)) {
    return explicitBackPath || "/food/user/dining"
  }

  if (/^\/user\/dining\/[^/]+\/[^/]+$/.test(normalizedPath)) {
    return explicitBackPath || "/food/user/dining"
  }

  if (
    normalizedPath === "/user/dining/explore/upto50" ||
    normalizedPath === "/user/dining/explore/near-rated" ||
    normalizedPath === "/user/dining/coffee"
  ) {
    return "/food/user/dining"
  }

  if (/^\/user\/dining\/[^/]+$/.test(normalizedPath)) {
    return "/food/user/dining"
  }

  if (
    normalizedPath === "/user/orders" ||
    /^\/user\/orders\/[^/]+(\/invoice|\/details)?$/.test(normalizedPath)
  ) {
    if (state?.from === "profile" || state?.backTo?.includes("profile") || explicitBackPath?.includes("profile")) {
      return "/food/user/profile"
    }
    return defaultHomePath
  }

  if (
    normalizedPath === "/user/cart/checkout" ||
    normalizedPath === "/user/cart/select-address"
  ) {
    return "/food/user/cart"
  }

  if (normalizedPath === "/user/address-selector") {
    return explicitBackPath || defaultHomePath
  }

  if (/^\/user\/collections\/[^/]+$/.test(normalizedPath)) {
    return "/food/user/collections"
  }

  if (normalizedPath === "/user/categories") {
    return defaultHomePath
  }

  if (/^\/user\/category\/[^/]+$/.test(normalizedPath)) {
    return defaultHomePath
  }

  if (
    normalizedPath === "/user/offers" ||
    normalizedPath === "/user/gourmet" ||
    normalizedPath === "/user/coffee"
  ) {
    return defaultHomePath
  }

  if (/^\/user\/product\/[^/]+$/.test(normalizedPath)) {
    return explicitBackPath || defaultHomePath
  }

  if (/^\/user\/complaints(\/|$)/.test(normalizedPath)) {
    return explicitBackPath || "/food/user/orders"
  }

  if (explicitBackPath && !pathsMatch(explicitBackPath, pathname)) {
    return explicitBackPath
  }

  return defaultHomePath
}

/**
 * One-tap back to the known parent route.
 * Avoids navigate(-1) — phone history often has query/sheet intermediates,
 * so -1 needs 2–4 taps and feels stuck. Keep-alive still works because we
 * navigate to category/home paths that remount under preserved shells.
 */
export default function useAppBackNavigation() {
  const navigate = useNavigate()
  const location = useLocation()
  const profile = useProfile()
  const orderType = profile ? profile.orderType : null

  return useCallback(() => {
    // Restaurant "more info" sheet lives in ?info= — close it first without history pop.
    const searchParams = new URLSearchParams(location.search || "")
    if (searchParams.get("info") === "true") {
      searchParams.delete("info")
      const next = searchParams.toString()
      navigate(
        { pathname: location.pathname, search: next ? `?${next}` : "" },
        { replace: true, state: location.state },
      )
      return
    }

    const target = resolveBackPath({ ...location, orderType })

    if (target && !pathsMatch(target, location.pathname)) {
      navigate(target, { replace: true })
      return
    }

    if (location.search) {
      navigate(location.pathname, { replace: true, state: location.state })
      return
    }

    navigate(orderType === "takeaway" ? "/food/user/takeaway" : "/food/user", {
      replace: true,
    })
  }, [location, navigate, orderType])
}
