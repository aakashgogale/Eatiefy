import React, { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import MaintenanceGate from '../modules/Food/components/MaintenanceGate'

const NATIVE_LAST_ROUTE_KEY = 'native_last_route'

// Lazy load the Food service module (Quick-spicy app)
const FoodApp = lazy(() => import('../modules/Food/routes'))
const AuthApp = lazy(() => import('../modules/auth/routes'))
import ProtectedRoute from '@food/components/ProtectedRoute'

const PageLoader = () => (
  <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center p-6 bg-white dark:bg-[#0a0a0a]">
    <Loader2 className="h-10 w-10 animate-spin text-[#CB202D]" />
    <p className="mt-4 text-gray-500 font-bold uppercase tracking-widest text-[10px]">
      Loading...
    </p>
  </div>
)

/**
 * FoodAppWrapper — Quick-spicy App. को /food prefix के साथ render करता है.
 * 
 * Quick-spicy की App.jsx में routes /restaurant, /usermain, /admin, /delivery
 * जैसे hain (bina /food prefix ke). Yahan hum useLocation se /food ke baad wala
 * path nikalne ke baad FoodApp render karte hain. FoodApp internally BrowserRouter
 * nahi use karta (sirf Routes use karta hai), isliye ye directly kaam karta hai.
 */
import { AppShellSkeleton, OnboardingSkeleton } from '../modules/Food/components/ui/loading-skeletons'

const FoodAppWrapper = () => {
  const location = useLocation();
  
  // Synchronous initial auth check to prevent AppShellSkeleton flash before redirect
  const authStatus = localStorage.getItem("user_authenticated");
  const token = localStorage.getItem("user_accessToken");
  
  // Never redirect restaurant/delivery/admin paths to user login
  const isNonUserModulePath = 
    location.pathname.startsWith('/food/restaurant') ||
    location.pathname.startsWith('/food/delivery') ||
    location.pathname.startsWith('/food/admin');

  const isUserPath = !isNonUserModulePath && (
                     location.pathname.startsWith('/home') ||
                     location.pathname === '/food' || 
                     location.pathname === '/food/' ||
                     location.pathname.startsWith('/food/user'));

  const isPolicyPage = location.pathname.includes('terms') || 
                       location.pathname.includes('privacy') || 
                       location.pathname.includes('support') ||
                       location.pathname.includes('refund') ||
                       location.pathname.includes('shipping') ||
                       location.pathname.includes('cancellation');

  if (isUserPath && authStatus === null && !token && !isPolicyPage) {
    return <Navigate to="/user/auth/login" replace />;
  }

  const isOnboarding = location.pathname.startsWith('/food/restaurant/onboarding');

  return (
    <Suspense fallback={isOnboarding ? <OnboardingSkeleton /> : (isPolicyPage ? <PageLoader /> : <AppShellSkeleton />)}>
      <FoodApp />
    </Suspense>
  )
}

const RedirectToFood = () => {
  const location = useLocation();
  // We safely replace the exact current pathname with a /food prefixed pathname
  // This effectively catches programmatic navigation to absolute paths like '/restaurant/login'
  // and turns them into '/food/restaurant/login'
  return <Navigate to={`/food${location.pathname}${location.search}`} replace />;
};

const MasterLandingPage = lazy(() => import('./MasterLandingPage'))
const AdminRouter = lazy(() => import('../modules/Food/components/admin/AdminRouter'))

const AppRoutes = () => {
  const location = useLocation()

  useEffect(() => {
    if (typeof window === 'undefined') return

    const protocol = String(window.location?.protocol || '').toLowerCase()
    const userAgent = String(window.navigator?.userAgent || '').toLowerCase()
    const isNativeLikeShell =
      Boolean(window.flutter_inappwebview) ||
      Boolean(window.ReactNativeWebView) ||
      protocol === 'file:' ||
      userAgent.includes(' wv') ||
      userAgent.includes('; wv')

    if (!isNativeLikeShell) return

    const route = `${location.pathname || ''}${location.search || ''}`
    if (route.startsWith('/food/') || route.startsWith('/admin')) {
      localStorage.setItem(NATIVE_LAST_ROUTE_KEY, route)
    }
  }, [location.pathname, location.search])

  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <MaintenanceGate>
        <Routes>
          {/* Auth Module */}
          <Route path="/user/auth/*" element={
            <Suspense fallback={<AppShellSkeleton />}>
              <AuthApp />
            </Suspense>
          } />

          {/* Food Module - Handle both /food and root / for the user app */}
          <Route path="/food/*" element={<FoodAppWrapper />} />

          {/* Global Admin Portal - AdminRouter handles its own protection for sub-routes */}
          <Route path="/admin/*" element={
            <Suspense fallback={<AppShellSkeleton />}>
              <AdminRouter />
            </Suspense>
          } />

          {/* Landing Page ONLY on / */}
          <Route path="/" element={
            <Suspense fallback={<AppShellSkeleton />}>
              <MasterLandingPage />
            </Suspense>
          } />

          {/* Handle root and other paths via FoodAppWrapper */}
          <Route path="/*" element={<FoodAppWrapper />} />
        </Routes>
      </MaintenanceGate>
    </Suspense>
  )
}

export default AppRoutes
