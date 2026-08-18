import { Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom"
import { useEffect, useState, createContext, useContext, useRef, useCallback, useMemo } from "react"
import { toast } from "sonner"
import { ProfileProvider } from "@food/context/ProfileContext"
import LocationPrompt from "./LocationPrompt"
import { CartProvider } from "@food/context/CartContext"
import { OrdersProvider } from "@food/context/OrdersContext"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

import SearchOverlay from "./SearchOverlay"
import BottomNavigation from "./BottomNavigation"
import DesktopNavbar from "./DesktopNavbar"
import BackToTop from "./BackToTop"
import { useUserNotifications } from "../../hooks/useUserNotifications"
import { useProfile } from "@food/context/ProfileContext"
import { useLocation as useGeoLocation } from "../../hooks/useLocation"
import { useZone } from "../../hooks/useZone"
import { useCartZoneGuard } from "../../hooks/useCartZoneGuard"
import OutOfZoneScreen from "./OutOfZoneScreen"
import { isModuleAuthenticated } from "../../utils/auth"
import { AppShellSkeleton } from "@food/components/ui/loading-skeletons"
import LoginRequiredModal from "./LoginRequiredModal"
import MainTabKeepAlive from "./MainTabKeepAlive"
import { getMainTabFromPath, isExactMainTabPath, rememberMainTabBeforeProfile, shouldPreserveMainTabsUnderPath, getCategorySlugFromPath, isRestaurantDetailPath, rememberCategoryKeepAliveSlug, peekCategoryKeepAliveSlug, clearCategoryKeepAliveSlug } from "@food/utils/mainTabRoutes"
import { registerFoodPageCacheLifecycle } from "@food/utils/foodPageCache"
import CategoryBrowseKeepAlive from "./CategoryBrowseKeepAlive"

let reloadManualLocationFlagCleared = false
/** Clear sticky manual-location loader flag on F5 before first paint. */
function clearManualLocationFlagOnReload() {
  if (reloadManualLocationFlagCleared) return
  reloadManualLocationFlagCleared = true
  try {
    const isReload =
      performance.getEntriesByType("navigation")[0]?.type === "reload" ||
      window.performance?.navigation?.type === 1
    if (isReload) {
      sessionStorage.removeItem("manual_location_update")
    }
  } catch {
    /* ignore */
  }
}

// Sync orderType with route
function RouteSyncHandler() {
  const location = useLocation()
  const { setOrderType, orderType } = useProfile()

  useEffect(() => {
    // Determine path ignoring /food prefix for uniform handling
    let path = location.pathname
    if (path.startsWith("/food")) {
      path = path.substring(5) || "/"
    }
    const normalizedPath = path.replace(/\/+$/, "") || "/"
    
    // Paths that should PRESERVE the current orderType (sub-navigation)
    const preservePaths = [
      "/cart", "/user/cart",
      "/restaurants", "/user/restaurants",
      "/search", "/user/search",
      "/product", "/user/product",
      "/user/orders", "/orders",
      "/profile", "/user/profile"
    ]
    const isPreservePath = preservePaths.some(p => normalizedPath === p || normalizedPath.startsWith(p + "/"))
    
    if (isPreservePath) return

    // Explicit mode switches
    let newMode = null
    if (normalizedPath === "/takeaway" || normalizedPath.startsWith("/takeaway/") || normalizedPath.startsWith("/user/takeaway")) {
      newMode = "takeaway"
    } else if (normalizedPath === "/dining" || normalizedPath.startsWith("/dining/") || normalizedPath.startsWith("/user/dining")) {
      newMode = "dining"
    } else if (normalizedPath === "/" || normalizedPath === "/user" || normalizedPath === "/user/") {
      newMode = "delivery"
    }

    if (newMode && orderType !== newMode) {
      setOrderType(newMode)
    }
  }, [location.pathname, orderType, setOrderType])

  return null
}

// Create SearchOverlay context with default value
const SearchOverlayContext = createContext({
  isSearchOpen: false,
  searchValue: "",
  setSearchValue: () => {
    debugWarn("SearchOverlayProvider not available")
  },
  openSearch: () => {
    debugWarn("SearchOverlayProvider not available")
  },
  closeSearch: () => { }
})

export function useSearchOverlay() {
  const context = useContext(SearchOverlayContext)
  // Always return context, even if provider is not available (will use default values)
  return context
}

function SearchOverlayProvider({ children }) {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState("")

  const openSearch = () => {
    setIsSearchOpen(true)
  }

  const closeSearch = () => {
    setIsSearchOpen(false)
    setSearchValue("")
  }

  return (
    <SearchOverlayContext.Provider value={{ isSearchOpen, searchValue, setSearchValue, openSearch, closeSearch }}>
      {children}
      {isSearchOpen && (
        <SearchOverlay
          isOpen={isSearchOpen}
          onClose={closeSearch}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
        />
      )}
    </SearchOverlayContext.Provider>
  )
}

// Create LocationSelector context with default value
const LocationSelectorContext = createContext({
  isLocationSelectorOpen: false,
  openLocationSelector: () => {
    debugWarn("LocationSelectorProvider not available")
  },
  closeLocationSelector: () => { }
})

export function useLocationSelector() {
  const context = useContext(LocationSelectorContext)
  if (!context) {
    throw new Error("useLocationSelector must be used within LocationSelectorProvider")
  }
  return context
}

function LocationSelectorProvider({ children }) {
  const navigate = useNavigate()

  const openLocationSelector = useCallback(() => {
    // Navigate to the standalone address selector page
    // Using window.location.pathname to avoid hook issues in some contexts
    navigate("/food/user/address-selector", { state: { from: window.location.pathname } })
  }, [navigate])

  const closeLocationSelector = useCallback(() => { }, [])

  // Debounced loading state to prevent flickering and ensure smooth navigation transitions
  const [showGlobalLoader, setShowGlobalLoader] = useState(false)

  const value = useMemo(() => ({
    isLocationSelectorOpen: false,
    openLocationSelector,
    closeLocationSelector,
    showGlobalLoader,
    setShowGlobalLoader
  }), [openLocationSelector, closeLocationSelector, showGlobalLoader])

  return (
    <LocationSelectorContext.Provider value={value}>
      {children}
    </LocationSelectorContext.Provider>
  )
}

function UserLayoutContent() {
  clearManualLocationFlagOnReload()
  const location = useLocation()
  const { location: activeLocation, loading: isGeoLoading } = useGeoLocation()
  const { loading: isProfileLoading } = useProfile()
  const { isOutOfService, loading: isZoneLoading, zoneStatus, zoneId } = useZone(activeLocation)
  useCartZoneGuard(zoneId, zoneStatus)
  const hasValidCoordinates = activeLocation && Number.isFinite(activeLocation.latitude) && Number.isFinite(activeLocation.longitude);
  const isOutOfZone = isOutOfService && hasValidCoordinates;
  const { openLocationSelector } = useLocationSelector()
  const navigationType = useNavigationType()
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false)

  useEffect(() => {
    const handleShowLoginModal = () => {
      setIsLoginModalOpen(true)
    }
    window.addEventListener('show-login-required', handleShowLoginModal)
    return () => {
      window.removeEventListener('show-login-required', handleShowLoginModal)
    }
  }, [])

  useEffect(() => {
    const handleNotificationToast = (e) => {
      const { title, message } = e.detail || {}
      toast.custom(() => (
        <div className="w-[calc(100vw-32px)] sm:w-[380px] bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-3xl pointer-events-auto flex items-center gap-4 p-3.5 border border-gray-50 animate-in fade-in slide-in-from-top-4">
          <div className="flex-shrink-0">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-[#DC2626] to-[#991B1B] flex items-center justify-center shadow-lg">
              <img src="/assets/images/ometto-toast-logo.png" alt="Ometto" className="w-7 h-7 object-contain brightness-0 invert" />
            </div>
          </div>
          <div className="flex-1 pr-1 min-w-0">
            <p className="text-[13px] font-bold text-gray-900 leading-tight truncate">{title || "Notification"}</p>
            {message ? <p className="text-[12px] font-medium text-gray-500 mt-0.5 line-clamp-2 leading-snug">{message}</p> : null}
          </div>
        </div>
      ), {
        id: 'user-notif-toast',
        duration: 6000,
        position: 'top-center',
      })
    }
    window.addEventListener('show-user-notification-toast', handleNotificationToast)
    return () => window.removeEventListener('show-user-notification-toast', handleNotificationToast)
  }, [])

  // Save order status notifications to localStorage so bell badge updates everywhere
  useEffect(() => {
    const handleOrderNotif = (e) => {
      const { orderId, status, title, message } = e.detail || {}
      const statusLower = String(status || '').toLowerCase()
      // Only save to bell inbox for delivered or cancelled orders
      if (statusLower !== 'delivered' && !statusLower.includes('cancel')) return
      const isDelivered = statusLower === 'delivered'
      const newNotif = {
        id: `order-${orderId}-${status}-${Date.now()}`,
        type: isDelivered ? 'order' : 'alert',
        title: title || (isDelivered ? `Order #${orderId} Delivered!` : `Order #${orderId} ${status}`),
        message: message || (isDelivered ? 'Your order has been delivered. Enjoy!' : `Your order status is now ${statusLower.replace(/_/g, ' ')}`),
        time: 'Just now',
        timestamp: Date.now(),
        read: false,
        icon: isDelivered ? 'CheckCircle2' : 'AlertCircle',
        iconColor: isDelivered ? 'text-green-600' : 'text-red-600'
      }
      try {
        const existing = JSON.parse(localStorage.getItem('food_user_notifications') || '[]')
        const list = Array.isArray(existing) ? existing : []
        // Drop legacy demo seeds (#12345 / Special Offer) if still present
        const cleaned = list.filter((item) => {
          const id = String(item?.id || '')
          const title = String(item?.title || '')
          const message = String(item?.message || '')
          if (id === '1' || id === '2') return false
          if (title === 'Order Confirmed' && message.includes('#12345')) return false
          if (title === 'Special Offer' && message.includes('50% off')) return false
          return true
        })
        // Dedupe same order+status within a short window
        const dedupeKey = `order-${orderId}-${status}`
        const already = cleaned.some(
          (n) =>
            String(n.id || '').startsWith(dedupeKey) ||
            (String(n.title || '') === String(newNotif.title) &&
              Date.now() - Number(n.timestamp || 0) < 15_000),
        )
        if (already) return
        const updated = [newNotif, ...cleaned].slice(0, 100)
        localStorage.setItem('food_user_notifications', JSON.stringify(updated))
        const unreadCount = updated.filter(n => !n.read).length
        window.dispatchEvent(new CustomEvent('notificationsUpdated', { detail: { count: unreadCount } }))
      } catch {}
    }
    window.addEventListener('orderStatusNotification', handleOrderNotif)
    return () => window.removeEventListener('orderStatusNotification', handleOrderNotif)
  }, [])

  const path = location.pathname.startsWith("/food")
    ? location.pathname.substring(5) || "/"
    : location.pathname
  const normalizedPath = path.length > 1 ? path.replace(/\/+$/, "") : path

  const isMainPage = normalizedPath === "/" || 
    normalizedPath === "" || 
    normalizedPath === "/user" || 
    normalizedPath === "/dining" || 
    normalizedPath === "/user/dining" || 
    normalizedPath === "/takeaway" || 
    normalizedPath === "/user/takeaway" ||
    normalizedPath === "/under-250" ||
    normalizedPath === "/user/under-250";

  // Determine if this is a policy or auth page immediately
  const isAuthPage = normalizedPath.includes('auth/');
  const isPolicyPage = normalizedPath.includes('terms') || 
                       normalizedPath.includes('privacy') || 
                       normalizedPath.includes('support');

  const shouldBlockOutOfZone = 
    hasValidCoordinates &&
    !isAuthPage && 
    !isPolicyPage &&
    !normalizedPath.includes('profile') &&
    !normalizedPath.includes('wallet') &&
    !normalizedPath.includes('help') &&
    !normalizedPath.includes('address') &&
    !normalizedPath.includes('orders');

  // Debounced loading state to prevent flickering and ensure smooth navigation transitions
  const { showGlobalLoader, setShowGlobalLoader } = useLocationSelector()

  // Safety: never leave a full-screen blocker that eats every tap until app kill
  useEffect(() => {
    if (!showGlobalLoader) return undefined
    const timer = window.setTimeout(() => {
      setShowGlobalLoader(false)
      sessionStorage.removeItem("manual_location_update")
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [showGlobalLoader, setShowGlobalLoader])

  // isInitialChecking: only block render if we have ZERO cached location AND zone data.
  // On refresh, cached data exists -> render immediately, fetch in background.
  const [isInitialChecking, setIsInitialChecking] = useState(() => {
    const isAuthenticated = isModuleAuthenticated('user');
    if (!isAuthenticated || isAuthPage || isPolicyPage) return false;
    // If we already have cached location + zone -> never block
    const hasCachedLocation = !!localStorage.getItem('userLocation');
    const hasCachedZone = !!localStorage.getItem('userZoneId');
    return !(hasCachedLocation && hasCachedZone);
  })

  useEffect(() => {
    // Skip location/zone check for auth, policy, support pages, or if not logged in
    const isAuthenticated = isModuleAuthenticated('user');
    if (isAuthPage || isPolicyPage || !isAuthenticated) {
      setShowGlobalLoader(false)
      setIsInitialChecking(false)
      return
    }

    if (isZoneLoading || isGeoLoading || isProfileLoading) {
      // ONLY show global overlay for truly manual location updates (user explicitly changed location)
      // Never block the page for silent background GPS refreshes
      const isManualUpdate = sessionStorage.getItem("manual_location_update") === "true";

      // Show overlay if it is a manual update
      if (isManualUpdate) {
        setShowGlobalLoader(true)
      }
      // If we have location+zone cached, never show overlay even during background refresh
    } else {
      const timer = setTimeout(() => {
        setShowGlobalLoader(false)
        setIsInitialChecking(false) // First load completed
        sessionStorage.removeItem("manual_location_update"); // Clear manual flag
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isZoneLoading, isGeoLoading, isProfileLoading, isAuthPage, isPolicyPage, activeLocation?.latitude, activeLocation?.longitude, zoneStatus])

  // Global Refresh Handler - Scroll to top ONLY on browser refresh
  useEffect(() => {
    const isReload = 
      performance.getEntriesByType('navigation')[0]?.type === 'reload' || 
      window.performance?.navigation?.type === 1;

    if (isReload) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      sessionStorage.removeItem("homeScrollY");
      sessionStorage.removeItem("homeVisibleCount");
      // F5 keeps sticky delivery location — don't flash "Fetching Location..."
      // from a prior manual select flag. Fresh tab open / login still fetch normally.
      sessionStorage.removeItem("manual_location_update");
      setShowGlobalLoader(false);
    }
  }, [setShowGlobalLoader]);

  useEffect(() => {
    registerFoodPageCacheLifecycle();
  }, []);

  const pathMainTab = getMainTabFromPath(location.pathname);
  const lastMainTabRef = useRef(pathMainTab || "delivery");
  const [mainTabsMounted, setMainTabsMounted] = useState(() => !!pathMainTab);

  useEffect(() => {
    if (pathMainTab) {
      lastMainTabRef.current = pathMainTab;
      setMainTabsMounted(true);
    }
  }, [pathMainTab]);

  useEffect(() => {
    if (pathMainTab && pathMainTab !== "profile") {
      rememberMainTabBeforeProfile(pathMainTab);
    }
  }, [pathMainTab]);

  // Keep home/tabs alive under restaurant/category so back is instant (no remount/refetch).
  const preserveMainTabs =
    !pathMainTab &&
    mainTabsMounted &&
    shouldPreserveMainTabsUnderPath(location.pathname);
  const keepAliveTab = pathMainTab || (preserveMainTabs ? lastMainTabRef.current : null);
  const activeMainTab = pathMainTab;

  const categorySlug = getCategorySlugFromPath(location.pathname);
  const isRestaurantPath = isRestaurantDetailPath(location.pathname);
  const lastCategorySlugRef = useRef(
    categorySlug || peekCategoryKeepAliveSlug() || null,
  );
  const [categoryBrowseMounted, setCategoryBrowseMounted] = useState(
    () => !!(categorySlug || peekCategoryKeepAliveSlug()),
  );

  if (categorySlug) {
    lastCategorySlugRef.current = categorySlug;
    rememberCategoryKeepAliveSlug(categorySlug);
  }

  useEffect(() => {
    if (categorySlug) {
      setCategoryBrowseMounted(true);
      rememberCategoryKeepAliveSlug(categorySlug);
      return;
    }
    // Keep category page mounted under restaurant OR home tabs — instant reopen.
    // Only tear down when leaving both (e.g. search / other non-tab routes).
    if (!isRestaurantPath && !pathMainTab) {
      setCategoryBrowseMounted(false);
      lastCategorySlugRef.current = null;
      clearCategoryKeepAliveSlug();
    }
  }, [categorySlug, isRestaurantPath, pathMainTab]);

  const preservedCategorySlug =
    categorySlug || lastCategorySlugRef.current || peekCategoryKeepAliveSlug();
  const showCategoryBrowse =
    !!categorySlug ||
    (categoryBrowseMounted &&
      !!preservedCategorySlug &&
      (isRestaurantPath || !!pathMainTab));
  const categoryBrowseVisible = !!categorySlug;

  useEffect(() => {
    const rootPaths = ["/", "/user", "/food", "/dining", "/user/dining", "/takeaway", "/user/takeaway"];
    const isAtRoot = rootPaths.includes(location.pathname);

    // Main tab switches restore scroll via MainTabKeepAlive — don't reset here.
    if (isExactMainTabPath(location.pathname)) return;

    if (navigationType !== 'POP' && !isAtRoot && !location.pathname.includes('/search')) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  }, [location.pathname, location.search, location.hash, navigationType]);

  // Exact main tabs only (includes /home + /user/home). Do not broaden beyond mainTabRoutes.
  const showBottomNav = !isInitialChecking && isExactMainTabPath(location.pathname)

  const isUnder250 = normalizedPath === "/under-250" || normalizedPath === "/user/under-250"
  const lastOutOfZoneRef = useRef(isOutOfZone)

  // Out of Zone Branded Toast Trigger
  useEffect(() => {
    // Only show toast if out of zone, loader is gone, and we are on a main page where the out-of-zone screen is shown
    if (isOutOfZone && !lastOutOfZoneRef.current && !showGlobalLoader && isMainPage) {
      const timer = setTimeout(() => {
        toast.custom(() => (
          <div
            className="w-[calc(100vw-32px)] sm:w-[380px] bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-3xl pointer-events-auto flex items-center gap-4 p-3.5 border border-gray-50 duration-300 animate-in fade-in slide-in-from-top-4"
          >
            <div className="flex-shrink-0">
              <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-[#DC2626] to-[#991B1B] flex items-center justify-center p-1.5 shadow-lg">
                <img 
                  src="/assets/images/ometto-toast-logo.png" 
                  alt="Ometto" 
                  className="w-full h-full object-contain brightness-0 invert" 
                />
              </div>
            </div>
            <div className="flex-1 pr-2">
              <p className="text-[14px] font-bold text-gray-800 leading-tight">
                Restaurants are unavailable here right now.
              </p>
              <p className="text-[13px] font-medium text-gray-500 mt-1">
                Please choose a different location
              </p>
            </div>
          </div>
        ), {
          duration: 4000,
          position: 'top-center',
          id: 'out-of-zone-toast'
        });
      }, 300); // Shorter delay after loader is gone

      lastOutOfZoneRef.current = true;
      return () => clearTimeout(timer);
    }
    
    // Reset the ref if user moves back into a zone
    if (!isOutOfZone) {
      lastOutOfZoneRef.current = false;
    }
  }, [isOutOfZone, showGlobalLoader, isMainPage]);


  return (
    <>
      <RouteSyncHandler />
      
      {/* Location Fetching Loader - Only shown on main pages after login */}
      {showGlobalLoader && !isInitialChecking && !location.pathname.includes('/search') && (
        <div className="fixed inset-0 z-[1000] bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-300 pointer-events-auto">
          <div className="relative">
            <div className="w-10 h-10 border-[3px] border-gray-100/30 rounded-full"></div>
            <div className="absolute top-0 left-0 w-10 h-10 border-[3px] border-[#DC2626] border-t-transparent rounded-full animate-spin"></div>
          </div>
          <p className="mt-4 text-[13px] font-bold text-gray-800 tracking-tight">Fetching Location...</p>
        </div>
      )}

      {/* Desktop Navbar - Hidden on mobile, visible on medium+ screens */}
      <div className="hidden md:block">
        {showBottomNav && !isOutOfZone && <DesktopNavbar showLogo={!isUnder250} />}
      </div>
      {!isPolicyPage && !isAuthPage && <LocationPrompt />}
      
      {isInitialChecking && !location.pathname.includes('/search') ? (
        <AppShellSkeleton />
      ) : (zoneStatus === "OUT_OF_SERVICE" && !isZoneLoading && !isGeoLoading) && shouldBlockOutOfZone ? (
        <OutOfZoneScreen 
          location={activeLocation} 
          handleLocationClick={openLocationSelector} 
        />
      ) : (
        <main className={`${showBottomNav ? "md:pt-40" : ""} min-h-screen flex flex-col`}>
          {keepAliveTab ? (
            <div
              style={{ display: pathMainTab ? "block" : "none" }}
              aria-hidden={!pathMainTab}
              data-main-tabs-preserved={!pathMainTab ? "true" : undefined}
            >
              <MainTabKeepAlive
                activeTab={keepAliveTab}
                isVisible={!!pathMainTab}
              />
            </div>
          ) : null}
          {showCategoryBrowse ? (
            <CategoryBrowseKeepAlive
              categorySlug={preservedCategorySlug}
              isVisible={categoryBrowseVisible}
            />
          ) : null}
          {!pathMainTab && !categorySlug ? <Outlet /> : null}
        </main>
      )}

      {(normalizedPath === "/" || normalizedPath === "" || normalizedPath === "/user") && !isOutOfZone && <BackToTop />}
      {showBottomNav && !isOutOfZone && <BottomNavigation />}
      
      {/* Central Login Required Modal */}
      <LoginRequiredModal isOpen={isLoginModalOpen} onClose={() => setIsLoginModalOpen(false)} />
    </>
  )
}

export default function UserLayout() {
  useUserNotifications()

  return (
    <div className="min-h-screen bg-[#f5f5f5] dark:bg-[#0a0a0a] transition-colors duration-200">
      <ProfileProvider>
        <CartProvider>
          <OrdersProvider>
            <SearchOverlayProvider>
              <LocationSelectorProvider>
                <UserLayoutContent />
              </LocationSelectorProvider>
            </SearchOverlayProvider>
          </OrdersProvider>
        </CartProvider>
      </ProfileProvider>
    </div>
  )
}
