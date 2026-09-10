import { useLocation } from "react-router-dom"
import { useCallback, useEffect, useState } from "react"
import BottomNavigation from "./BottomNavigation"
import { getUnreadDeliveryNotificationCount } from "@food/utils/deliveryNotifications"
import { deliveryAPI } from "@food/api"

export default function DeliveryLayout({
  children,
  showGig = false,
  showPocket = false,
  onHomeClick,
  onGigClick
}) {
  const location = useLocation()
  const [requestBadgeCount, setRequestBadgeCount] = useState(() =>
    getUnreadDeliveryNotificationCount()
  )
  const [approvalStatus, setApprovalStatus] = useState("loading")

  const [checkingStatus, setCheckingStatus] = useState(false)

  /**
   * Reads approval status straight from the backend, bypassing the profile
   * cache. The status is never taken from local state alone — an admin can
   * approve at any moment, and the cached /me response would still say pending.
   */
  const syncApprovalStatus = useCallback(async ({ silent = true } = {}) => {
    if (!silent) setCheckingStatus(true)
    try {
      const res = await deliveryAPI.refreshMe()
      const user = res?.data?.data?.user ?? res?.data?.user
      const status = user?.status ?? "approved"
      setApprovalStatus(status)
      if (user && typeof localStorage !== "undefined") {
        try {
          localStorage.setItem("delivery_user", JSON.stringify(user))
        } catch (_) {}
      }
      return status
    } catch {
      // Keep whatever is already known instead of dropping an approved partner
      // back to the pending screen because one request failed.
      setApprovalStatus((prev) => (prev === "loading" ? "pending" : prev))
      return null
    } finally {
      if (!silent) setCheckingStatus(false)
    }
  }, [])

  useEffect(() => {
    void syncApprovalStatus()
  }, [syncApprovalStatus])

  // Re-check when the partner comes back to the app (e.g. after being told they
  // were approved), so the dashboard opens without a manual reload.
  useEffect(() => {
    if (approvalStatus === "approved") return undefined
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncApprovalStatus()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onVisible)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onVisible)
    }
  }, [approvalStatus, syncApprovalStatus])

  useEffect(() => {
    setRequestBadgeCount(getUnreadDeliveryNotificationCount())
    const handleNotificationUpdate = () => {
      setRequestBadgeCount(getUnreadDeliveryNotificationCount())
    }
    window.addEventListener("deliveryNotificationsUpdated", handleNotificationUpdate)
    window.addEventListener("storage", handleNotificationUpdate)
    return () => {
      window.removeEventListener("deliveryNotificationsUpdated", handleNotificationUpdate)
      window.removeEventListener("storage", handleNotificationUpdate)
    }
  }, [location.pathname])

  const showBottomNav = [
    "/food/delivery",
    "/food/delivery/requests",
    "/food/delivery/trip-history",
    "/food/delivery/profile"
  ].includes(location.pathname)

  if (approvalStatus === "loading") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-gray-500">Loading...</div>
      </main>
    )
  }

  if (approvalStatus !== "approved") {
    // Rejected and blocked partners must never reach the dashboard, so they get
    // their own message rather than the "waiting" copy.
    const isRejected = approvalStatus === "rejected" || approvalStatus === "blocked"
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center space-y-4 rounded-xl bg-white p-6 shadow-sm border border-gray-200">
          <h1 className="text-xl font-semibold text-gray-900">
            {isRejected ? "Application Not Approved" : "Pending Admin Approval"}
          </h1>
          <p className="text-gray-600 text-sm">
            {isRejected
              ? "Your application was not approved. Please contact support for details."
              : "Your profile has been submitted. You will get full access once admin approves your account."}
          </p>
          {!isRejected && (
            <>
              {/* Explicit re-check: the status is read fresh from the backend, so
                  an approval that just happened opens the dashboard right away
                  without logging out. */}
              <button
                type="button"
                onClick={() => syncApprovalStatus({ silent: false })}
                disabled={checkingStatus}
                className="w-full rounded-lg bg-gray-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {checkingStatus ? "Checking…" : "Check approval status"}
              </button>
              <p className="text-gray-500 text-xs">
                This screen also refreshes automatically when you return to the app.
              </p>
            </>
          )}
        </div>
      </main>
    )
  }

  return (
    <>
      <main>
        {children}
      </main>
      {showBottomNav && (
        <BottomNavigation
          showGig={showGig}
          showPocket={showPocket}
          onHomeClick={onHomeClick}
          onGigClick={onGigClick}
          requestBadgeCount={requestBadgeCount}
        />
      )}
    </>
  )
}

