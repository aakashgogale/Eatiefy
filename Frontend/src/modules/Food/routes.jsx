import React, { useEffect, useLayoutEffect, Suspense, lazy } from "react"
import { Routes, Route, Navigate, useLocation, useNavigate, useNavigationType } from "react-router-dom"
import ProtectedRoute from "@food/components/ProtectedRoute"
import AuthRedirect from "@food/components/AuthRedirect"
import Loader from "@food/components/Loader"
import AuthInitializer from "@food/components/AuthInitializer"
import PushSoundEnableButton from "@food/components/PushSoundEnableButton"
import { initPushNotificationClient, registerWebPushForCurrentModule } from "@food/utils/firebaseMessaging"
import {
  getCategorySlugFromPath,
  isExactMainTabPath,
} from "@food/utils/mainTabRoutes"
import {
  getCategoryLastClick,
  normalizeBrowsePath,
} from "@food/utils/browseScrollMemory"
import { isModuleAuthenticated } from "@food/utils/auth"
import { AppShellSkeleton } from "./components/ui/loading-skeletons"
import { Loader2 } from "lucide-react"

const PageLoader = () => (
  <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center p-6 bg-white dark:bg-[#0a0a0a]">
    <Loader2 className="h-10 w-10 animate-spin text-[#CB202D]" />
    <p className="mt-4 text-gray-500 font-bold uppercase tracking-widest text-[10px]">
      Loading...
    </p>
  </div>
)

// Lazy Loading Components
const UserRouter = lazy(() => import("@food/components/user/UserRouter"))

// Restaurant Module
const RestaurantRouter = lazy(() => import("@food/components/restaurant/RestaurantRouter"))
const RestaurantGlobalNotificationListenerInner = lazy(() =>
  import("@food/hooks/useRestaurantNotifications").then((mod) => ({
    default: function RestaurantGlobalNotificationListenerInner() {
      mod.useRestaurantNotifications()
      return null
    },
  }))
)

// Admin Module
const AdminRouter = lazy(() => import("@food/components/admin/AdminRouter"))
const AdminLogin = lazy(() => import("@food/pages/admin/auth/AdminLogin"))
const AdminSignup = lazy(() => import("@food/pages/admin/auth/AdminSignup"))
const AdminForgotPassword = lazy(() => import("@food/pages/admin/auth/AdminForgotPassword"))

// Delivery Module
const DeliveryRouter = lazy(() => import("../DeliveryV2"))

const UserRouterWrapper = () => {
  const location = useLocation();
  const isPolicyPage = location.pathname.includes('terms') || 
                       location.pathname.includes('privacy') || 
                       location.pathname.includes('support') ||
                       location.pathname.includes('refund') ||
                       location.pathname.includes('shipping') ||
                       location.pathname.includes('cancellation');

  return (
    <Suspense fallback={isPolicyPage ? <PageLoader /> : <AppShellSkeleton />}>
      <UserRouter />
    </Suspense>
  )
}

function UserPathRedirect() {
  const location = useLocation()
  // Correctly handle the /food/user -> /food redirect regardless of where it starts
  const newPath = location.pathname.replace("/user", "") || "/food"
  return <Navigate to={newPath} replace />
}

// Scroll to top on forward navigations only — keep / restore position on back (POP).
// Main tabs + category browse own their scroll (KeepAlive) — never fight them here.
function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useLayoutEffect(() => {
    const isCategory = !!getCategorySlugFromPath(pathname);
    const isMainTab = isExactMainTabPath(pathname);

    // KeepAlive / page restore owns these surfaces — jumping here steals taps.
    if (isMainTab || isCategory) {
      if (navigationType === "POP" && isCategory) {
        try {
          const want = normalizeBrowsePath(pathname);
          const mem = getCategoryLastClick();
          const memPath = mem?.path ? normalizeBrowsePath(mem.path) : "";
          if (
            mem &&
            memPath.includes("/category/") &&
            Number.isFinite(Number(mem.scrollY)) &&
            Number(mem.scrollY) >= 0
          ) {
            // Same browse session (any category slug) — seed once; lock finishes it.
            window.scrollTo({
              top: Number(mem.scrollY),
              left: 0,
              behavior: "instant",
            });
          } else if (want) {
            const raw = sessionStorage.getItem("food_browse_scroll_v1");
            if (raw) {
              const data = JSON.parse(raw);
              const y = Number(data?.scrollY);
              if (
                normalizeBrowsePath(data?.path || "").includes("/category/") &&
                Number.isFinite(y) &&
                y >= 0
              ) {
                window.scrollTo({ top: y, left: 0, behavior: "instant" });
              }
            }
          }
        } catch {
          /* ignore */
        }
      }
      return;
    }

    if (navigationType === "POP") {
      try {
        const raw = sessionStorage.getItem("food_browse_scroll_v1");
        if (raw) {
          const data = JSON.parse(raw);
          const y = Number(data?.scrollY);
          if (
            normalizeBrowsePath(data?.path || "") === normalizeBrowsePath(pathname) &&
            Number.isFinite(y) &&
            y >= 0
          ) {
            window.scrollTo({ top: y, left: 0, behavior: "instant" });
            return;
          }
        }
      } catch {
        /* ignore */
      }
      return;
    }

    // Category chip switches use REPLACE — do not yank scroll (breaks taps).
    if (navigationType === "REPLACE") return;

    window.scrollTo(0, 0);
  }, [pathname, navigationType]);
  return null;
}

function RestaurantGlobalNotificationListener() {
  const location = useLocation()
  const isRestaurantRoute =
    location.pathname.startsWith("/food/restaurant") &&
    !location.pathname.startsWith("/food/restaurants")
  const isRestaurantAuthRoute =
    location.pathname === "/food/restaurant/login" ||
    location.pathname === "/food/restaurant/auth/sign-in" ||
    location.pathname === "/food/restaurant/signup" ||
    location.pathname === "/food/restaurant/signup-email" ||
    location.pathname === "/food/restaurant/forgot-password" ||
    location.pathname === "/food/restaurant/otp" ||
    location.pathname === "/food/restaurant/auth/google-callback" ||
    location.pathname.includes("/onboarding") ||
    location.pathname.includes("/pending-verification")
  const isOrderManagedRoute =
    location.pathname === "/food/restaurant" ||
    location.pathname === "/food/restaurant/orders" ||
    location.pathname.startsWith("/food/restaurant/orders/")

  let isApproved = false
  if (isModuleAuthenticated("restaurant")) {
    const userStr = localStorage.getItem("restaurant_user")
    if (userStr) {
      try {
        const user = JSON.parse(userStr)
        isApproved = String(user?.status || "").toLowerCase() === "approved"
      } catch (e) {}
    }
  }

  const shouldListen =
    isRestaurantRoute &&
    !isRestaurantAuthRoute &&
    !isOrderManagedRoute &&
    isModuleAuthenticated("restaurant") &&
    isApproved

  if (!shouldListen) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <RestaurantGlobalNotificationListenerInner />
    </Suspense>
  )
}

export default function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const lastFcmPathRef = React.useRef("")

  useEffect(() => {
    initPushNotificationClient()

    const pathname = location.pathname
    const isUserMainTabSwitch =
      isExactMainTabPath(pathname) &&
      isExactMainTabPath(lastFcmPathRef.current) &&
      pathname !== lastFcmPathRef.current

    lastFcmPathRef.current = pathname

    if (isUserMainTabSwitch) return

    registerWebPushForCurrentModule(pathname)
  }, [location.pathname])

  // Ensure FCM token is saved once after login (not on every tab switch)
  useEffect(() => {
    const onLoginSuccess = () => {
      registerWebPushForCurrentModule("/food/user")
    }
    window.addEventListener("userLoginSuccess", onLoginSuccess)
    return () => window.removeEventListener("userLoginSuccess", onLoginSuccess)
  }, [])

  // Global Auth Failure Listener EXACTLY like Ometto
  useEffect(() => {
    const handleAuthFailure = (event) => {
      const module = event.detail?.module || 'user'
      
      const loginPaths = {
        admin: '/food/admin/login',
        restaurant: '/food/restaurant/login',
        delivery: '/food/delivery/login',
        user: '/food/user/login'
      }

      // Only redirect if the current tab is actually on the module that failed
      if (location.pathname.startsWith(`/food/${module}`)) {
        const targetPath = loginPaths[module] || '/food/user/login'
        navigate(targetPath, { replace: true, state: { from: location.pathname } })
      }
    }

    const handleStorageChange = (e) => {
      // Cross-tab instant logout (Ometto v2 upgrade)
      if ((e.key === "restaurant_accessToken" || e.key === "delivery_accessToken") && !e.newValue) {
        const module = e.key === "restaurant_accessToken" ? "restaurant" : "delivery"
        const loginPaths = {
          restaurant: '/food/restaurant/login',
          delivery: '/food/delivery/login',
        }
        // ONLY redirect if we are currently inside the affected module!
        if (location.pathname.startsWith(`/food/${module}`)) {
          navigate(loginPaths[module], { replace: true })
        }
      }
    }

    window.addEventListener('authRefreshFailed', handleAuthFailure)
    window.addEventListener('storage', handleStorageChange)
    
    // Safety Net: Aggressively check local storage every 2 seconds if active token gets deleted
    const safetyInterval = setInterval(() => {
      // Don't kick users out of auth pages, onboarding, pending-verification, or public legal pages!
      const isRestaurantAuth = location.pathname.includes('/login') || 
                               location.pathname.includes('/otp') || 
                               location.pathname.includes('/signup') || 
                               location.pathname.includes('/auth') || 
                               location.pathname.includes('/forgot-password') ||
                               location.pathname.includes('/onboarding') ||
                               location.pathname.includes('/pending-verification')
      const isDeliveryAuth = location.pathname.includes('/login') || location.pathname.includes('/otp') || location.pathname.includes('/signup') || location.pathname.includes('/auth') || location.pathname.includes('/pending-verification')
      const isPublicLegalPage = location.pathname.includes('/privacy') || location.pathname.includes('/terms') || location.pathname.includes('/help-content') || location.pathname.includes('/help/content') || location.pathname.includes('/help-centre/support')
      
      if (location.pathname.startsWith('/food/restaurant') && !isRestaurantAuth && !isPublicLegalPage) {
        if (!localStorage.getItem('restaurant_accessToken')) {
          navigate('/food/restaurant/login', { replace: true })
        }
      }
      if (location.pathname.startsWith('/food/delivery') && !isDeliveryAuth && !isPublicLegalPage) {
        if (!localStorage.getItem('delivery_accessToken')) {
          navigate('/food/delivery/login', { replace: true })
        }
      }
    }, 2000)

    // Verify session instantly when user switches back to this tab
    // This is crucial for cross-device/incognito logouts on static pages that don't poll
    const handleFocus = async () => {
      try {
        const hasRestaurantToken = !!localStorage.getItem('restaurant_accessToken');
        const hasDeliveryToken = !!localStorage.getItem('delivery_accessToken');
        
        // Dynamically import authAPI to avoid circular dependencies
        if (hasRestaurantToken || hasDeliveryToken) {
          const { authAPI } = await import('@food/api');
          if (hasRestaurantToken) authAPI.me('restaurant').catch(() => {});
          if (hasDeliveryToken) authAPI.me('delivery').catch(() => {});
        }
      } catch (error) {
        // Silently catch - if it fails authAPI will handle the 401
      }
    };
    
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('authRefreshFailed', handleAuthFailure)
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('focus', handleFocus);
      clearInterval(safetyInterval)
    }
  }, [navigate, location.pathname])

  return (
    <AuthInitializer>
      <>
        <ScrollToTop />
        <RestaurantGlobalNotificationListener />
        <PushSoundEnableButton />
        <Routes>
          {/* Restaurant Module - Already mapped to /restaurant */}
          <Route
            path="restaurant/*"
            element={
              <Suspense fallback={<AppShellSkeleton />}>
                <RestaurantRouter />
              </Suspense>
            }
          />

          {/* Delivery Module - Already mapped to /delivery */}
          <Route
            path="delivery/*"
            element={
              <Suspense fallback={<AppShellSkeleton />}>
                <DeliveryRouter />
              </Suspense>
            }
          />

          {/* User Module - Explicitly mapped to /user and the catch-all for /food/ and / */}
          {/* NOTE: /user/food is a common mis-navigation - redirect to correct /food/user home */}
          <Route path="user/food" element={<Navigate to="/food/user" replace />} />
          <Route
            path="user/*"
            element={<UserRouterWrapper />}
          />

          {/* Make UserRouter the default for all other paths to handle / and /food/ as user home */}
          <Route
            path="/*"
            element={<UserRouterWrapper />}
          />
        </Routes>
      </>
    </AuthInitializer>
  )
}
