import { useCallback, useEffect, useRef, useState } from "react"
import { WifiOff, RefreshCw, Loader2 } from "lucide-react"

/**
 * App-level offline state for the Restaurant app.
 *
 * Without this, losing connectivity mid-session left the shell showing raw
 * failures, and a navigation attempt fell through to the browser's own
 * "Web page not available" page.
 *
 * The children stay mounted behind the overlay on purpose: anything the user
 * had typed is still there when connectivity returns, so no work is lost.
 * Only genuine browser-level offline state raises this — an API returning 5xx
 * is a server problem and keeps flowing through normal error handling.
 */

const isBrowserOffline = () =>
  typeof navigator !== "undefined" && navigator.onLine === false

/**
 * `navigator.onLine` only proves a link exists, not that the internet is
 * reachable, so Retry actually probes the origin before clearing the state.
 */
const probeConnectivity = async () => {
  if (isBrowserOffline()) return false
  try {
    await fetch(`${window.location.origin}/favicon.ico?probe=${Date.now()}`, {
      method: "HEAD",
      cache: "no-store",
    })
    return true
  } catch {
    return false
  }
}

export default function RestaurantOfflineGate({ children }) {
  const [isOffline, setIsOffline] = useState(isBrowserOffline)
  const [isRetrying, setIsRetrying] = useState(false)
  const [justRecovered, setJustRecovered] = useState(false)
  const recoveredTimerRef = useRef(null)

  const markOnline = useCallback(() => {
    setIsOffline((wasOffline) => {
      if (wasOffline) {
        // Brief confirmation so the recovery is visible rather than silent.
        setJustRecovered(true)
        clearTimeout(recoveredTimerRef.current)
        recoveredTimerRef.current = setTimeout(() => setJustRecovered(false), 3000)
      }
      return false
    })
  }, [])

  useEffect(() => {
    const handleOffline = () => setIsOffline(true)
    window.addEventListener("online", markOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", markOnline)
      window.removeEventListener("offline", handleOffline)
      clearTimeout(recoveredTimerRef.current)
    }
  }, [markOnline])

  const handleRetry = useCallback(async () => {
    if (isRetrying) return
    setIsRetrying(true)
    try {
      if (await probeConnectivity()) markOnline()
    } finally {
      setIsRetrying(false)
    }
  }, [isRetrying, markOnline])

  return (
    <>
      {children}

      {justRecovered && !isOffline ? (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-[200] bg-green-600 px-4 py-2 text-center text-xs font-bold text-white"
        >
          Back online
        </div>
      ) : null}

      {isOffline ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="restaurant-offline-title"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-white px-6 dark:bg-[#0a0a0a]"
        >
          <div className="w-full max-w-sm text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-white/10">
              <WifiOff className="h-7 w-7 text-gray-500" aria-hidden="true" />
            </div>

            <h1
              id="restaurant-offline-title"
              className="text-xl font-bold text-gray-900 dark:text-white"
            >
              You're offline
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Check your mobile data or Wi-Fi connection. Your screen is kept as it
              was, so nothing you've entered is lost.
            </p>

            <button
              type="button"
              onClick={handleRetry}
              disabled={isRetrying}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] px-5 py-3.5 text-sm font-bold text-white transition-transform active:scale-95 disabled:opacity-70"
            >
              {isRetrying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Checking connection...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Retry
                </>
              )}
            </button>

            <p className="mt-4 text-xs text-gray-400">
              Orders and updates resume automatically once you're back online.
            </p>
          </div>
        </div>
      ) : null}
    </>
  )
}
