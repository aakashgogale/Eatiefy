import { useEffect } from "react"

/**
 * Refetch admin list pages when sidebar badge counts change (poll / approve / reject).
 * badgeKeys: e.g. "deliveryPartners", "restaurants", "foodApprovals"
 */
export function useAdminBadgeListRefresh(badgeKeys, refetch, deps = []) {
  useEffect(() => {
    if (typeof window === "undefined" || typeof refetch !== "function") return

    const keys = (Array.isArray(badgeKeys) ? badgeKeys : [badgeKeys]).filter(Boolean)

    const handleRefresh = (event) => {
      const changedKeys = event?.detail?.changedKeys || []
      if (!changedKeys.length) {
        refetch({ silent: true })
        return
      }
      if (changedKeys.some((key) => keys.includes(key))) {
        refetch({ silent: true })
      }
    }

    window.addEventListener("admin-list-refresh", handleRefresh)
    return () => window.removeEventListener("admin-list-refresh", handleRefresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
