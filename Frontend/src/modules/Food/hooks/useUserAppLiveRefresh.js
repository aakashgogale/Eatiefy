import { useEffect, useRef } from "react"
import { invalidateFoodPages } from "@food/utils/foodPageCache"
import { clearCategoryCache } from "@food/utils/categoryCache"

/**
 * Keeps the user app in sync with restaurant-side changes without a manual
 * reload: a restaurant coming online, editing outlet timings, adding a dish.
 *
 * Two layers, because the socket gateway rejects unauthenticated handshakes:
 *  - Logged-in users get an instant push (`catalog_changed`).
 *  - Everyone, guests included, refreshes when the tab regains focus.
 *
 * Mount once, high in the user app tree.
 */

// DOM event name (the socket event of the same purpose is `catalog_changed`).
const CATALOG_CHANGED_EVENT = "catalog-changed"

// One restaurant save can touch several endpoints; coalesce the burst.
const COALESCE_MS = 1200

// Refetching on every tiny blur would hammer the API - only treat a return as
// stale-worthy if the tab was actually away for a while.
const STALE_AFTER_MS = 30 * 1000

export function useUserAppLiveRefresh() {
  const timerRef = useRef(null)
  const lastHiddenAtRef = useRef(0)
  const pendingRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    const scheduleRefresh = (detail) => {
      if (cancelled) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        // Never refetch behind a hidden tab - it burns battery and data on
        // mobile. Remember it instead, and apply it the moment we come back.
        if (document.visibilityState === "hidden") {
          pendingRef.current = detail
          return
        }
        pendingRef.current = null
        // Category browse keeps its own in-memory cache; without this the page
        // would re-hydrate the very data we are refreshing.
        clearCategoryCache()
        invalidateFoodPages({ ...detail, keepFcmSync: true })
      }, COALESCE_MS)
    }

    // --- Layer 1: realtime push (authenticated users only) ---
    // Relayed by useUserNotifications off the shared user socket.
    const handleCatalogChanged = (event) => {
      scheduleRefresh({
        reason: "catalog-changed",
        restaurantId: event?.detail?.restaurantId || null,
      })
    }
    window.addEventListener(CATALOG_CHANGED_EVENT, handleCatalogChanged)

    // --- Layer 2: refresh on return to the tab (works for guests too) ---
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        lastHiddenAtRef.current = Date.now()
        return
      }
      // A push that arrived while hidden always wins, however brief the absence.
      if (pendingRef.current) {
        const detail = pendingRef.current
        pendingRef.current = null
        scheduleRefresh(detail)
        return
      }
      const awayFor = Date.now() - (lastHiddenAtRef.current || 0)
      if (lastHiddenAtRef.current && awayFor >= STALE_AFTER_MS) {
        scheduleRefresh({ reason: "tab-visible" })
      }
    }

    const handleFocus = () => {
      const awayFor = Date.now() - (lastHiddenAtRef.current || 0)
      if (lastHiddenAtRef.current && awayFor >= STALE_AFTER_MS) {
        scheduleRefresh({ reason: "window-focus" })
      }
    }

    document.addEventListener("visibilitychange", handleVisibility)
    window.addEventListener("focus", handleFocus)

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
      window.removeEventListener(CATALOG_CHANGED_EVENT, handleCatalogChanged)
      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("focus", handleFocus)
    }
  }, [])
}

export default useUserAppLiveRefresh
