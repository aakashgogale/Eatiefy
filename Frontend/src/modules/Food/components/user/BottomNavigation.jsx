import { useLocation, useNavigate } from "react-router-dom"
import { ShoppingBag, Tag, Truck, UtensilsCrossed } from "lucide-react"
import { useState, useEffect, useRef, useCallback } from "react"
import { motion } from "framer-motion"
import api from "@food/api"
import { useProfile } from "@food/context/ProfileContext"
import {
  getCachedUnder250PriceLimit,
  getLandingSettingsPublic,
} from "@food/utils/foodPageCache"
import { subscribeBottomNavShow } from "@food/utils/bottomNavEvents"

const HIDE_LOCK_MS = 900

export default function BottomNavigation() {
  const location = useLocation()
  const navigate = useNavigate()
  const pathname = location.pathname
  const [under250PriceLimit, setUnder250PriceLimit] = useState(() =>
    getCachedUnder250PriceLimit(250),
  )

  const [isVisible, setIsVisible] = useState(true)
  const lastScrollYRef = useRef(typeof window !== "undefined" ? window.scrollY : 0)
  const accumulatedScrollUpRef = useRef(0)
  const accumulatedScrollDownRef = useRef(0)
  const isVisibleRef = useRef(true)
  const hideLockUntilRef = useRef(0)
  const showNavAtTop = useCallback((lockMs = 0) => {
    accumulatedScrollDownRef.current = 0
    accumulatedScrollUpRef.current = 0
    if (typeof window !== "undefined") {
      lastScrollYRef.current = window.scrollY
    }
    if (lockMs > 0) {
      hideLockUntilRef.current = Date.now() + lockMs
    }
    if (!isVisibleRef.current) {
      isVisibleRef.current = true
      setIsVisible(true)
    }
  }, [])

  // Fetch landing settings to get dynamic price limit (shared cache)
  useEffect(() => {
    let cancelled = false
    getLandingSettingsPublic(() => api.get("/food/landing/settings/public"))
      .then((settings) => {
        if (cancelled) return
        if (settings && typeof settings.under250PriceLimit === "number") {
          setUnder250PriceLimit(settings.under250PriceLimit)
        }
      })
      .catch(() => {
        if (!cancelled) setUnder250PriceLimit(250)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // After every route change / tab restore: force nav visible so first tap works.
  useEffect(() => {
    showNavAtTop(HIDE_LOCK_MS)
  }, [pathname, showNavAtTop])

  useEffect(() => {
    return subscribeBottomNavShow((e) => {
      const lockMs = Number(e?.detail?.lockMs) || HIDE_LOCK_MS
      showNavAtTop(lockMs)
    })
  }, [showNavAtTop])

  // Scroll logic to hide/show footer - uses refs to avoid listener re-registration
  useEffect(() => {
    const SHOW_THRESHOLD = 150 // Pixels to scroll up to show
    const HIDE_THRESHOLD = 80 // Pixels to scroll down to hide

    const controlNavbar = () => {
      const currentScrollY = window.scrollY
      const lastScrollY = lastScrollYRef.current

      // Route/tab transition lock — scroll restore must not hide nav / eat taps
      if (Date.now() < hideLockUntilRef.current) {
        lastScrollYRef.current = currentScrollY
        if (!isVisibleRef.current) {
          isVisibleRef.current = true
          setIsVisible(true)
        }
        return
      }

      // If we are at the top of the page, always show the footer
      if (currentScrollY <= 50) {
        showNavAtTop()
        return
      }

      if (currentScrollY > lastScrollY) {
        // Scrolling Down
        const delta = currentScrollY - lastScrollY
        accumulatedScrollDownRef.current += delta
        accumulatedScrollUpRef.current = 0

        if (accumulatedScrollDownRef.current > HIDE_THRESHOLD && currentScrollY > 100) {
          if (isVisibleRef.current) {
            isVisibleRef.current = false
            setIsVisible(false)
          }
        }
      } else {
        // Scrolling Up
        const delta = lastScrollY - currentScrollY
        accumulatedScrollUpRef.current += delta
        accumulatedScrollDownRef.current = 0

        if (accumulatedScrollUpRef.current > SHOW_THRESHOLD) {
          if (!isVisibleRef.current) {
            isVisibleRef.current = true
            setIsVisible(true)
          }
        }
      }

      lastScrollYRef.current = currentScrollY
    }

    window.addEventListener("scroll", controlNavbar, { passive: true })
    return () => window.removeEventListener("scroll", controlNavbar)
  }, [showNavAtTop])

  // Recover stale hidden state when already at top
  useEffect(() => {
    const reconcileHiddenAtTop = () => {
      if (typeof window === "undefined") return
      if (window.scrollY <= 50 && !isVisibleRef.current) {
        showNavAtTop()
      }
    }

    reconcileHiddenAtTop()
    window.addEventListener("resize", reconcileHiddenAtTop, { passive: true })

    const t1 = window.setTimeout(reconcileHiddenAtTop, 0)
    const t2 = window.setTimeout(reconcileHiddenAtTop, 150)
    const t3 = window.setTimeout(reconcileHiddenAtTop, 500)

    return () => {
      window.removeEventListener("resize", reconcileHiddenAtTop)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [pathname, isVisible, showNavAtTop])

  // Normalize pathname by removing trailing slash for consistent comparison
  const normalizedPath = pathname.replace(/\/$/, "") || "/"

  const { setOrderType } = useProfile()

  const isDining =
    normalizedPath === "/food/dining" ||
    normalizedPath.startsWith("/food/user/dining")
  const isUnder250 =
    normalizedPath === "/food/under-250" ||
    normalizedPath.startsWith("/food/user/under-250")
  const isProfile =
    normalizedPath.startsWith("/food/profile") ||
    normalizedPath.startsWith("/food/user/profile")
  const isTakeawayPath =
    normalizedPath === "/food/user/takeaway" ||
    normalizedPath.startsWith("/food/user/takeaway")
  const isDeliveryPath =
    normalizedPath === "/food" ||
    normalizedPath === "/food/user" ||
    normalizedPath === "/user" ||
    normalizedPath === "/"

  // Path wins over orderType so Delivery never looks "stuck" inactive after tab switch
  const isTakeaway = isTakeawayPath
  const isDelivery = isDeliveryPath && !isDining && !isUnder250 && !isProfile

  const navItems = [
    {
      id: "delivery",
      label: "Delivery",
      icon: Truck,
      to: "/food/user",
      active: isDelivery,
      orderType: "delivery",
    },
    {
      id: "takeaway",
      label: "Takeaway",
      icon: ShoppingBag,
      to: "/food/user/takeaway",
      active: isTakeaway,
      orderType: "takeaway",
    },
    {
      id: "under250",
      label: `Under ₹${under250PriceLimit}`,
      icon: Tag,
      to: "/food/user/under-250",
      active: isUnder250,
    },
    {
      id: "dining",
      label: "Dining",
      icon: UtensilsCrossed,
      to: "/food/user/dining",
      active: isDining,
    },
  ]

  const handleTabClick = (e, item) => {
    e.preventDefault()
    e.stopPropagation()

    showNavAtTop(HIDE_LOCK_MS)

    if (item.orderType && setOrderType) {
      setOrderType(item.orderType)
    }

    const current = normalizedPath
    const target = item.to.replace(/\/$/, "") || "/"
    // Always navigate — even same-looking paths must leave Under250/Dining instantly
    navigate(item.to, { replace: current === target })
  }

  return (
    <motion.div
      initial={false}
      animate={{ y: isVisible ? 0 : 120 }}
      transition={{
        type: "tween",
        ease: [0.22, 1, 0.36, 1],
        duration: 0.2,
      }}
      className="md:hidden fixed bottom-6 left-0 right-0 z-[11000] px-6 pointer-events-none"
      aria-hidden={!isVisible}
    >
      <div
        className="max-w-md mx-auto h-18 bg-white dark:bg-[#1a1a1a] border border-gray-100 dark:border-white/10 shadow-[0_15px_40px_-10px_rgba(0,0,0,0.3)] flex items-center justify-around px-2 rounded-[2rem] overflow-hidden pointer-events-auto"
      >
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={(e) => handleTabClick(e, item)}
            className={`flex flex-col items-center justify-center gap-1 h-14 w-full relative transition-all duration-300 touch-manipulation ${
              item.active ? "text-[#DC2626]" : "text-gray-600 dark:text-gray-400"
            }`}
          >
            {item.active && (
              <motion.div
                layoutId="active-nav-bg"
                className="absolute inset-x-1 inset-y-1 bg-[#FFF5F5] dark:bg-[#DC2626]/10 rounded-[1.5rem] z-0"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}

            <div className="relative z-10 flex flex-col items-center gap-0.5">
              <item.icon
                className={`h-5 w-5 transition-transform duration-300 ${item.active ? "scale-110" : ""}`}
                strokeWidth={item.active ? 2.5 : 2}
              />
              <span
                className={`text-[10px] font-black tracking-tight uppercase leading-none ${
                  item.active ? "opacity-100" : "text-gray-900/70 dark:text-gray-300/60"
                }`}
              >
                {item.id === "under250" ? "Under 250" : item.label}
              </span>
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  )
}
