import { useEffect, useState, useRef } from "react"
import { MapPin, X } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useLocation, hasValidStoredUserLocation } from "@food/hooks/useLocation"

export default function LocationPrompt() {
  const navigate = useNavigate()
  const { location, loading, permissionGranted, requestLocation } = useLocation()
  const [showPrompt, setShowPrompt] = useState(false)
  const [isRequesting, setIsRequesting] = useState(false)
  const cardRef = useRef(null)

  useEffect(() => {
    const promptDismissed = localStorage.getItem("locationPromptDismissed")
    if (hasValidStoredUserLocation() || promptDismissed) return

    const timer = setTimeout(() => {
      if (!hasValidStoredUserLocation() && !permissionGranted) {
        setShowPrompt(true)
        document.body.style.overflow = "hidden"
        if (cardRef.current) {
          cardRef.current.style.opacity = "0"
          cardRef.current.style.transform = "translateY(20px)"
          requestAnimationFrame(() => {
            if (cardRef.current) {
              cardRef.current.style.opacity = "1"
              cardRef.current.style.transform = "translateY(0)"
            }
          })
        }
      }
    }, 400)

    return () => {
      clearTimeout(timer)
      document.body.style.overflow = ""
    }
  }, [permissionGranted])

  useEffect(() => {
    if (hasValidStoredUserLocation() && showPrompt) {
      setShowPrompt(false)
      document.body.style.overflow = ""
    }
  }, [location, showPrompt])

  const handleAllow = async () => {
    setIsRequesting(true)
    try {
      await requestLocation()
      localStorage.setItem("locationPromptDismissed", "true")
      setShowPrompt(false)
      document.body.style.overflow = ""
    } catch {
      // Keep prompt open so user can try again or pick manually.
    } finally {
      setIsRequesting(false)
    }
  }

  const handleSelectManually = () => {
    setShowPrompt(false)
    document.body.style.overflow = ""
    localStorage.setItem("locationPromptDismissed", "true")
    navigate("/food/user/address-selector")
  }

  const handleDismiss = () => {
    setShowPrompt(false)
    document.body.style.overflow = ""
    localStorage.setItem("locationPromptDismissed", "true")
  }

  useEffect(() => {
    return () => {
      document.body.style.overflow = ""
    }
  }, [])

  if (!showPrompt) return null

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4 transition-all duration-300 animate-fadeIn"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <div
        ref={cardRef}
        className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-[28px] p-6 shadow-2xl mx-auto my-auto relative transition-all duration-300 flex flex-col items-center"
      >
        <button
          className="absolute right-4 top-4 text-[#DC2626] hover:text-[#B91C1C] transition-all p-1.5 rounded-full bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/60 shadow-sm active:scale-95 duration-200"
          onClick={handleDismiss}
        >
          <X className="h-4.5 w-4.5" strokeWidth={2.5} />
        </button>

        <div className="relative mb-5 mt-4">
          <div className="absolute inset-0 rounded-full bg-red-100 dark:bg-red-950/40 animate-ping opacity-75"></div>
          <div className="relative h-16 w-16 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center ring-8 ring-red-100/50 dark:ring-red-950/10">
            <MapPin className="h-8 w-8 text-[#DC2626]" />
          </div>
        </div>

        <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 tracking-tight text-center">
          Enable Location Services
        </h3>

        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center mt-3 leading-relaxed px-1">
          Allow location access to discover great local restaurants near you, view accurate delivery times, and explore exclusive offers in your area.
        </p>

        <div className="flex flex-col gap-2.5 mt-6 w-full">
          <button
            onClick={handleAllow}
            className="w-full h-12 rounded-full bg-[#DC2626] hover:bg-[#B91C1C] text-white font-semibold text-sm transition-all duration-200 shadow-lg shadow-red-600/10 flex items-center justify-center disabled:opacity-85"
            disabled={loading || isRequesting}
          >
            {loading || isRequesting ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Getting Location...
              </span>
            ) : (
              "Allow Location Access"
            )}
          </button>

          <button
            onClick={handleSelectManually}
            className="w-full h-12 rounded-full bg-zinc-500/10 dark:bg-zinc-400/10 hover:bg-zinc-500/20 dark:hover:bg-zinc-400/20 text-zinc-700 dark:text-zinc-200 font-bold text-sm transition-all duration-200 border border-zinc-500/20 dark:border-zinc-400/20 backdrop-blur-md shadow-inner flex items-center justify-center"
          >
            Select Location Manually
          </button>
        </div>
      </div>
    </div>
  )
}
