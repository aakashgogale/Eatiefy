import { useState, useEffect, useRef } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { Search, Menu, ChevronRight, MapPin, X, Bell, HelpCircle } from "lucide-react"
import { restaurantAPI } from "@food/api"
import { formatRestaurantDisplayAddress } from "@food/utils/restaurantLocation"
import { getCachedSettings, loadBusinessSettings } from "@food/utils/businessSettings"
import useNotificationInbox from "@food/hooks/useNotificationInbox"
import { useRestaurantNotifications } from "@food/hooks/useRestaurantNotifications"
import { Utensils } from "lucide-react"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const extractRestaurantPayload = (response) =>
  response?.data?.data?.restaurant ||
  response?.data?.restaurant ||
  response?.data?.data?.user ||
  response?.data?.user ||
  response?.data?.data ||
  null

export default function RestaurantNavbar({
  restaurantName: propRestaurantName,
  location: propLocation,
  showSearch = true,
  hideSearch = false,
  showOfflineOnlineTag = true,
  showNotifications = true,
}) {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const [isSearchActive, setIsSearchActive] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const [status, setStatus] = useState("Offline")
  const [restaurantData, setRestaurantData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [companyName, setCompanyName] = useState("")
  const [logoUrl, setLogoUrl] = useState(null)
  const searchTimeoutRef = useRef(null)
  const { unreadCount } = useNotificationInbox("restaurant", { limit: 20, pollMs: 5 * 60 * 1000 })
  const { newReservation, clearNewReservation } = useRestaurantNotifications();

  // Global search effect
  useEffect(() => {
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (searchValue.trim() === "") {
      // Dispatch empty search event
      window.dispatchEvent(
        new CustomEvent("restaurantSearchUpdated", {
          detail: { query: "", results: [], isLoading: false },
        }),
      )
      return
    }

    // Set loading state
    window.dispatchEvent(
      new CustomEvent("restaurantSearchUpdated", {
        detail: { query: searchValue, results: [], isLoading: true },
      }),
    )

    // Debounce search API call
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await restaurantAPI.getOrders({
          page: 1,
          limit: 100,
          search: searchValue,
        })
        
        if (response.data.success) {
          window.dispatchEvent(
            new CustomEvent("restaurantSearchUpdated", {
              detail: {
                query: searchValue,
                results: response.data.data.orders || [],
                isLoading: false,
              },
            }),
          )
        }
      } catch (error) {
        debugError("Search error:", error)
        window.dispatchEvent(
          new CustomEvent("restaurantSearchUpdated", {
            detail: { query: searchValue, results: [], isLoading: false, error },
          }),
        )
      }
    }, 500)

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [searchValue])

  // Load business settings for branding
  useEffect(() => {
    const loadSettings = async () => {
      const cached = getCachedSettings()
      if (cached) {
        if (cached.companyName) setCompanyName(cached.companyName)
        if (cached.logo?.url) setLogoUrl(cached.logo.url)
      } else {
        const settings = await loadBusinessSettings()
        if (settings) {
          if (settings.companyName) setCompanyName(settings.companyName)
          if (settings.logo?.url) setLogoUrl(settings.logo.url)
        }
      }
    }
    loadSettings()

    const handleSettingsUpdate = () => {
      const cached = getCachedSettings()
      if (cached) {
        if (cached.companyName) setCompanyName(cached.companyName)
        if (cached.logo?.url) setLogoUrl(cached.logo.url)
      }
    }
    window.addEventListener('businessSettingsUpdated', handleSettingsUpdate)
    return () => window.removeEventListener('businessSettingsUpdated', handleSettingsUpdate)
  }, [])

  // Fetch restaurant data on mount
  useEffect(() => {
    const fetchRestaurantData = async () => {
      try {
        setLoading(true)
        const response = await restaurantAPI.refreshCurrentRestaurant()
        const data = extractRestaurantPayload(response)
        if (data) {
          setRestaurantData(data)
        }
      } catch (error) {
        // Only log error if it's not a network/timeout error (backend might be down/slow)
        if (error.code !== 'ERR_NETWORK' && error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
          debugError("Error fetching restaurant data:", error)
        }
        // Continue with default values if fetch fails
      } finally {
        setLoading(false)
      }
    }

    fetchRestaurantData()

    const handleRestaurantDataUpdate = () => {
      fetchRestaurantData()
    }

    window.addEventListener("ownerDataUpdated", handleRestaurantDataUpdate)
    window.addEventListener("addressUpdated", handleRestaurantDataUpdate)

    return () => {
      window.removeEventListener("ownerDataUpdated", handleRestaurantDataUpdate)
      window.removeEventListener("addressUpdated", handleRestaurantDataUpdate)
    }
  }, [])

  // Get restaurant name (use prop if provided, otherwise use fetched data)
  const restaurantName = propRestaurantName || restaurantData?.name || "Restaurant"

  const [restaurantAddress, setRestaurantAddress] = useState("")

  // Update location when restaurantData or propLocation changes
  useEffect(() => {
    if (propLocation && propLocation.trim() !== "") {
      setRestaurantAddress(propLocation.trim())
      return
    }

    if (restaurantData) {
      setRestaurantAddress(formatRestaurantDisplayAddress(restaurantData.location, restaurantData))
    } else {
      setRestaurantAddress("")
    }
  }, [restaurantData, propLocation])

  // Load status from localStorage on mount and listen for changes
  useEffect(() => {
    const updateStatus = () => {
      try {
        const savedStatus = localStorage.getItem('restaurant_online_status')
        if (savedStatus !== null) {
          const isOnline = JSON.parse(savedStatus)
          setStatus(isOnline ? "Online" : "Offline")
        } else {
          // If not stored yet, fallback to backend value (when available).
          const isOnline = Boolean(restaurantData?.isAcceptingOrders)
          setStatus(isOnline ? "Online" : "Offline")
        }
      } catch (error) {
        debugError("Error loading restaurant status:", error)
        const isOnline = Boolean(restaurantData?.isAcceptingOrders)
        setStatus(isOnline ? "Online" : "Offline")
      }
    }

    // Load initial status
    updateStatus()

    // Listen for status changes from RestaurantStatus page
  const handleStatusChange = (event) => {
      const isOnline = event.detail?.isOnline || false
      setStatus(isOnline ? "Online" : "Offline")
  }

    window.addEventListener('restaurantStatusChanged', handleStatusChange)
    
    return () => {
      window.removeEventListener('restaurantStatusChanged', handleStatusChange)
    }
  }, [restaurantData])

  const handleStatusClick = () => {
    navigate("/food/restaurant/status", { state: { from: routerLocation.pathname } })
  }

  const handleSearchClick = () => {
    // No-op as search is now permanent
  }

  const handleSearchClose = () => {
    setSearchValue("")
  }

  const handleSearchChange = (e) => {
    setSearchValue(e.target.value)
  }

  const handleMenuClick = () => {
    navigate("/food/restaurant/explore", { state: { from: routerLocation.pathname } })
  }

  const handleNotificationsClick = () => {
    navigate("/food/restaurant/notifications", { state: { from: routerLocation.pathname } })
  }

  return (
    <>
      <div className="w-full bg-gradient-to-br from-[#B80B3D] to-[#66001D] rounded-b-[35px] flex flex-col shadow-[0_10px_30px_rgba(184,11,61,0.25)] pb-2 relative z-10">
        {/* Top Navbar */}
        <div className="px-4 py-3 flex items-center justify-between">
          {/* Left Side - Restaurant Info */}
          <div className="flex-1 min-w-0 pr-2 flex items-center gap-3">
            <div className="min-w-0">
              {/* Restaurant Name */}
              <div className="flex items-center gap-1.5 min-w-0">
                <h1 className="text-[17px] font-bold text-white truncate tracking-tight leading-none">
                  {loading ? "Loading..." : (restaurantName || "Restaurant")}
                </h1>
              </div>
              {!loading && restaurantAddress && restaurantAddress.trim() !== "" && (
                <div className="flex items-center gap-1 mt-1.5 opacity-90">
                  <MapPin className="w-2.5 h-2.5 text-white/80 shrink-0" />
                  <p className="text-[11px] text-white/90 truncate font-medium" title={restaurantAddress}>
                    {restaurantAddress}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right Side - Interactive Elements */}
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Offline/Online Status Tag */}
            {showOfflineOnlineTag && (
              <button
                onClick={handleStatusClick}
                className={`flex items-center gap-1 px-2 py-1 rounded-full transition-all duration-300 backdrop-blur-md border ${
                  status === "Online" 
                    ? "bg-white/15 border-white/20 text-white" 
                    : "bg-gradient-to-br from-[#B80B3D] to-[#66001D]/20 border-white/10 text-white/70"
                } active:scale-95 shadow-sm hover:bg-white/25`}
              >
                <div className="relative flex items-center justify-center">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    status === "Online" ? "bg-emerald-400" : "bg-white/30"
                  }`}></span>
                  {status === "Online" && (
                    <span className="absolute w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping opacity-60"></span>
                  )}
                </div>
                <span className="text-[11px] font-bold tracking-tight px-0.5">
                  {status}
                </span>
              </button>
            )}

            {/* Notifications Icon */}
            {showNotifications && (
              <button
                onClick={handleNotificationsClick}
                className="relative p-2.5 hover:bg-white/10 rounded-full transition-colors group"
                aria-label="Notifications"
              >
                <Bell className="w-5 h-5 text-white" />
                {unreadCount > 0 && (
                  <span className="absolute top-2 right-2.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#B80B3D] shadow-[0_0_8px_rgba(52,211,153,0.4)]" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Persistent Search Bar - Outside the bordered navbar div */}
      {showSearch && !hideSearch && (
        <div className="px-4 py-3 bg-white">
          <div className="relative group">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <Search className="h-4.5 w-4.5 text-slate-400 group-focus-within:text-[#B80B3D] transition-colors" />
            </div>
            <input
              type="text"
              value={searchValue}
              onChange={handleSearchChange}
              placeholder="Search by order ID or dish name"
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-[14px] font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-medium focus:outline-none focus:ring-2 focus:ring-[#B80B3D]/10 focus:border-[#B80B3D]/20 transition-all shadow-sm"
            />
            {searchValue && (
              <button
                onClick={handleSearchClose}
                className="absolute inset-y-0 right-3 flex items-center"
              >
                <X className="h-4 w-4 text-slate-400 hover:text-slate-600" />
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* Real-time Dining Booking Popup */}
      {newReservation && (
        <div className="fixed top-20 left-4 right-4 z-[100] animate-in slide-in-from-top duration-300">
          <div className="bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-[#B80B3D]/10 overflow-hidden">
            <div className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center shrink-0">
                <Utensils className="w-6 h-6 text-[#B80B3D]" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-black text-slate-900 text-sm">New Table Request!</h4>
                <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
                  {newReservation.user?.name || "A Guest"} has requested a table for {newReservation.guests} people.
                </p>
              </div>
              <button 
                onClick={clearNewReservation}
                className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-slate-50 p-3 flex gap-2">
              <button 
                onClick={() => {
                  clearNewReservation();
                  navigate("/food/restaurant/dining-reservations");
                }}
                className="flex-1 h-10 bg-gradient-to-r from-[#B80B3D] to-[#66001D] text-white text-xs font-bold rounded-xl uppercase tracking-widest shadow-lg shadow-red-100"
              >
                View Request
              </button>
              <button 
                onClick={clearNewReservation}
                className="px-4 h-10 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-xl uppercase tracking-widest"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}








