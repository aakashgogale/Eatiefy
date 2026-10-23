import { Suspense, useMemo, useSyncExternalStore } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import {
  Bell,
  Clock,
  BadgePercent,
  History,
  IndianRupee,
  LifeBuoy,
  Power,
  Store,
} from "lucide-react"
import useNotificationInbox from "@food/hooks/useNotificationInbox"
import { getCachedSettings } from "@food/utils/businessSettings"
import { isModuleAuthenticated } from "@food/utils/auth"
import { getOrdersTabs, findActiveTab } from "./BottomNavOrders"
import { useRestaurantNotifications } from "@food/hooks/useRestaurantNotifications"
import NewOrderNotification from "./NewOrderNotification"

/**
 * Tablet/desktop frame for the signed-in Restaurant Panel.
 *
 * Below 768px this renders nothing extra: the wrappers are `display: contents`
 * (restaurantTheme.css) and the sidebar is not mounted at all, so the phone app
 * keeps its exact layout and runs no additional hooks or requests.
 */

const WIDE_QUERY = "(min-width: 768px)"

// Some POS terminals (e.g. iMin) report a >= 768px width but need the phone
// layout — the bottom tab bar, not the sidebar. index.html flags them with
// data-pos-device; there the sidebar must never mount. Phones are < 768px, so
// they are unaffected either way.
const isPosDevice = () =>
  typeof document !== "undefined" &&
  document.documentElement.getAttribute("data-pos-device") === "true"

const subscribeWide = (onChange) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {}
  const mql = window.matchMedia(WIDE_QUERY)
  mql.addEventListener?.("change", onChange)
  return () => mql.removeEventListener?.("change", onChange)
}
const getWide = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia(WIDE_QUERY).matches &&
  !isPosDevice()

const useIsWideScreen = () => useSyncExternalStore(subscribeWide, getWide, () => false)

const BASE = "/food/restaurant"

// Existing screens only (same destinations as the Explore hub).
const SHORTCUTS = [
  { id: "history", label: "Order history", icon: History, route: `${BASE}/orders/all` },
  { id: "status", label: "Outlet status", icon: Power, route: `${BASE}/status` },
  { id: "timings", label: "Outlet timings", icon: Clock, route: `${BASE}/outlet-timings` },
  { id: "offers", label: "Offers", icon: BadgePercent, route: `${BASE}/offers` },
  { id: "payout", label: "Payouts", icon: IndianRupee, route: `${BASE}/hub-finance` },
  { id: "notifications", label: "Notifications", icon: Bell, route: `${BASE}/notifications` },
  { id: "support", label: "Help & support", icon: LifeBuoy, route: `${BASE}/help-centre/support` },
]

const readRestaurantName = () => {
  try {
    const user = JSON.parse(localStorage.getItem("restaurant_user") || "null")
    return String(user?.name || user?.restaurantName || "").trim()
  } catch {
    return ""
  }
}

function NavItem({ item, active, badge, onClick }) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={`group relative flex w-full items-center rounded-xl transition-colors
        flex-col gap-1 px-1 py-2.5 text-[10px]
        lg:flex-row lg:gap-3 lg:px-3 lg:py-2.5 lg:text-[13.5px]
        ${active
          ? "bg-[#2E7D52] text-white shadow-sm"
          : "text-gray-600 hover:bg-[#F1F8F4] hover:text-[#1B5E3F]"}`}
    >
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
        {badge ? (
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
        ) : null}
      </span>
      <span className="max-w-full font-semibold leading-tight text-center line-clamp-2 break-words lg:line-clamp-none lg:truncate lg:text-left">
        {item.label}
      </span>
    </button>
  )
}

function RestaurantSidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const tabs = useMemo(() => getOrdersTabs(BASE), [])
  // Shared, de-duplicated inbox cache (same source as the bottom nav dot).
  const { unreadCount } = useNotificationInbox("restaurant", { limit: 20 })

  const activeShortcutId = findActiveTab(SHORTCUTS, pathname)?.id
  // The bottom bar falls back to "Orders" for every screen; here only the
  // dashboard and order screens light it up.
  const activeTabId = tabs.find((tab) =>
    tab.route === BASE
      ? pathname === BASE || pathname === `${BASE}/` || pathname.startsWith(`${BASE}/orders/`)
      : pathname === tab.route || pathname.startsWith(`${tab.route}/`),
  )?.id
  const restaurantName = readRestaurantName()
  const settings = getCachedSettings()
  const companyName = settings?.companyName || ""
  const logoUrl = settings?.logo?.url || ""

  const go = (route) => {
    if (route !== pathname) navigate(route)
  }

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 flex w-[var(--rt-sidebar-w)] flex-col border-r border-[#D8E8DE] bg-white"
      aria-label="Restaurant navigation"
    >
      <div className="flex items-center gap-3 border-b border-gray-100 px-3 py-4 lg:px-5">
        <div className="mx-auto flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-[#2E7D52] to-[#1B5E3F] text-white lg:mx-0">
          {logoUrl ? (
            <img src={logoUrl} alt={companyName || "Logo"} className="h-full w-full bg-white object-contain p-1" />
          ) : (
            <Store className="h-5 w-5" />
          )}
        </div>
        <div className="hidden min-w-0 lg:block">
          <p className="truncate text-[15px] font-bold leading-tight text-gray-900">
            {restaurantName || "Restaurant"}
          </p>
          <p className="truncate text-[11px] font-medium text-gray-500">
            {companyName ? `${companyName} Partner` : "Partner dashboard"}
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-4 lg:px-3">
        <div className="space-y-1">
          {tabs.map((tab) => (
            <NavItem
              key={tab.id}
              item={tab}
              active={activeTabId === tab.id && !activeShortcutId}
              badge={tab.id === "feedback" && unreadCount > 0}
              onClick={() => go(tab.route)}
            />
          ))}
        </div>

        <p className="mb-2 mt-6 hidden px-3 text-[11px] font-bold uppercase tracking-wider text-gray-400 lg:block">
          Shortcuts
        </p>
        <div className="mt-4 space-y-1 border-t border-gray-100 pt-4 lg:mt-0 lg:border-t-0 lg:pt-0">
          {SHORTCUTS.map((item) => (
            <NavItem
              key={item.id}
              item={item}
              active={activeShortcutId === item.id}
              badge={item.id === "notifications" && unreadCount > 0}
              onClick={() => go(item.route)}
            />
          ))}
        </div>
      </nav>
    </aside>
  )
}

// Same markup as the router-level fallback, kept inside the shell so the
// sidebar stays on screen while a lazy screen loads.
const PageLoader = (
  <div className="min-h-screen bg-white dark:bg-[#141414] flex items-center justify-center">
    <div className="relative">
      <div className="w-10 h-10 border-[3px] border-gray-100/30 rounded-full"></div>
      <div className="absolute top-0 left-0 w-10 h-10 border-[3px] border-[#2E7D52] border-t-transparent rounded-full animate-spin"></div>
    </div>
  </div>
)

// Desktop content column per screen (restaurantTheme.css, >= 1024px only):
// dashboards and lists use a wide column, detail/map screens a medium one,
// and everything else (forms, settings) a narrow readable column.
const WIDE_PATHS = [
  "/orders/all",
  "/inventory",
  "/hub-menu",
  "/feedback",
  "/explore",
  "/hub-finance",
  "/finance-details",
  "/withdrawal-history",
  "/reservations",
  "/dining-reservations",
]
const MEDIUM_PATHS = ["/orders/", "/notifications", "/edit-owner", "/edit-address", "/zone-setup", "/hub-menu/item/"]

const matchesPath = (pathname, path) =>
  path.endsWith("/")
    ? pathname.startsWith(`${BASE}${path}`)
    : pathname === `${BASE}${path}` || pathname.startsWith(`${BASE}${path}/`)

const getContentColumn = (pathname) => {
  const path = pathname.replace(/\/+$/, "")
  if (path === BASE) return "wide"
  // Checked first: "/orders/all" is a list, "/orders/:id" a detail screen.
  if (MEDIUM_PATHS.some((p) => matchesPath(path, p)) && !matchesPath(path, "/orders/all")) return "medium"
  if (WIDE_PATHS.some((p) => matchesPath(path, p))) return "wide"
  return "narrow"
}

/** Public screens (help, legal) also get the shell when the partner is signed in. */
export function RestaurantShellIfSignedIn({ children }) {
  return isModuleAuthenticated("restaurant") ? <RestaurantShell>{children}</RestaurantShell> : children
}

export default function RestaurantShell({ children }) {
  const isWide = useIsWideScreen()
  const { pathname } = useLocation()
  const { newOrder, clearNewOrder } = useRestaurantNotifications()
  const isOrdersMain = pathname === "/food/restaurant" || pathname === "/food/restaurant/"

  const formattedNewOrder = useMemo(() => {
    if (!newOrder) return null
    return {
      ...newOrder,
      orderMongoId: newOrder.orderMongoId || newOrder._id || newOrder.id,
      total: newOrder.total ?? newOrder.pricing?.total ?? 0,
      customerAddress: newOrder.customerAddress || newOrder.deliveryAddress || newOrder.address,
      restaurantNote: newOrder.restaurantNote || newOrder.note || "",
      note: newOrder.restaurantNote || newOrder.note || "",
    }
  }, [newOrder])

  return (
    <div className="rt-shell">
      {!isOrdersMain && formattedNewOrder && (
        <NewOrderNotification order={formattedNewOrder} onClose={clearNewOrder} />
      )}
      {isWide ? <RestaurantSidebar /> : null}
      <div className="rt-shell-main" data-col={getContentColumn(pathname)}>
        <Suspense fallback={PageLoader}>{children}</Suspense>
      </div>
    </div>
  )
}
