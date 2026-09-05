import { useState, useEffect, useMemo } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ArrowLeft, Star, Clock, Bookmark, BadgePercent, Utensils } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Card, CardContent } from "@food/components/ui/card"
import api from "@food/api"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { toast } from "sonner"
import { API_BASE_URL } from "@food/api/config"
import OptimizedImage from "@food/components/OptimizedImage"
import { RestaurantGridSkeleton } from "@food/components/ui/loading-skeletons"
import { useDelayedLoading } from "@food/hooks/useDelayedLoading"
import { useLocation } from "@food/hooks/useLocation"
import { useZone } from "@food/hooks/useZone"
import { useProfile } from "@food/context/ProfileContext"
import { filterRestaurantsForVegMode } from "@food/utils/vegMode"

// Import banner
import gourmetBanner from "@food/assets/gourmet_new_banner.png"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function Gourmet() {
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const [favorites, setFavorites] = useState(new Set())
  const [gourmetRestaurants, setGourmetRestaurants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { location } = useLocation()
  const { zoneId } = useZone(location)
  const { vegMode, vegModeOption } = useProfile()
  const showGourmetSkeleton = useDelayedLoading(loading)

  const visibleGourmetRestaurants = useMemo(() => {
    let list = gourmetRestaurants;
    if (zoneId) {
      list = list.filter(r => !r.zoneId || String(r.zoneId) === String(zoneId));
    }
    return filterRestaurantsForVegMode(list, { vegMode, vegModeOption });
  }, [gourmetRestaurants, vegMode, vegModeOption, zoneId])

  const backendOrigin = (API_BASE_URL || "").replace(/\/api\/v1\/?$/, "")

  const resolveImageUrl = (url) => {
    if (typeof url !== "string") return ""
    const trimmed = url.trim()
    if (!trimmed) return ""
    if (/^(https?:|\/\/|data:|blob:)/i.test(trimmed)) return trimmed
    if (!backendOrigin) return trimmed
    return `${backendOrigin.replace(/\/$/, "")}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`
  }

  // Fetch Gourmet restaurants from public API
  useEffect(() => {
    const fetchGourmetRestaurants = async () => {
      try {
        setLoading(true)
        setError(null)
        const reqConfig = zoneId ? { params: { zoneId } } : {}
        const response = await api.get('/food/hero-banners/gourmet/public', reqConfig)
        const data = response?.data?.data
        const list = data?.restaurants ?? (Array.isArray(data) ? data : [])
        setGourmetRestaurants(list)
      } catch (err) {
        debugError('Error fetching Gourmet restaurants:', err)
        const errorMessage = err?.response?.data?.message || err?.message || 'Failed to load Gourmet restaurants'
        setError(errorMessage)
        toast.error(errorMessage)
        setGourmetRestaurants([])
      } finally {
        setLoading(false)
      }
    }

    fetchGourmetRestaurants()
  }, [zoneId])

  const toggleFavorite = (id) => {
    setFavorites(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a]">
      {/* Banner Section */}
      <div className="relative w-full overflow-hidden h-[30vh] sm:h-[35vh] md:h-[40vh] shadow-2xl">
        {/* Back Button */}
        <button
          onClick={goBack}
          className="absolute top-4 left-4 md:top-6 md:left-6 z-20 w-10 h-10 bg-white/20 hover:bg-white/40 backdrop-blur-md rounded-full flex items-center justify-center transition-all active:scale-90"
        >
          <ArrowLeft className="h-5 w-5 text-white" />
        </button>

        {/* Banner Image */}
        <div className="absolute inset-0 z-0 scale-105">
          <img
            src={gourmetBanner}
            alt="Gourmet Dining"
            className="w-full h-full object-cover animate-in fade-in zoom-in duration-1000"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
        </div>

        {/* Banner Text Overlay */}
        <div className="absolute bottom-8 left-6 md:left-10 z-10 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-8 h-[2px] bg-[#DC2626]" />
            <span className="text-[10px] font-black tracking-[0.3em] text-white/80 uppercase">Experience Excellence</span>
          </div>
          <h1 className="text-3xl md:text-5xl font-black text-white drop-shadow-2xl">Gourmet Dining</h1>
          <p className="text-white/70 text-sm md:text-base font-medium max-w-md">Indulge in carefully curated premium dining from the city's finest restaurants.</p>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 sm:px-6 md:px-8 lg:px-10 py-6 md:py-8 lg:py-10 space-y-4 md:space-y-6">
        <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">

          {/* Restaurant Count */}
          <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-zinc-800">
            <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 tracking-[0.2em] uppercase">
              {showGourmetSkeleton ? '...' : visibleGourmetRestaurants.length} PREMIER ESTABLISHMENTS
            </p>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] font-bold text-gray-500 uppercase">Live Deals Available</span>
            </div>
          </div>

          {/* Loading State */}
          {showGourmetSkeleton && <RestaurantGridSkeleton count={4} />}

          {/* Error State */}
          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="text-red-500 dark:text-red-400 text-center">{error}</p>
              <Button onClick={() => window.location.reload()} className="mt-4">Retry</Button>
            </div>
          )}

          {/* Restaurant Cards */}
          {!showGourmetSkeleton && !error && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              {visibleGourmetRestaurants.length === 0 ? (
                <div className="col-span-full text-center py-12">
                  <p className="text-gray-500 dark:text-gray-400">No Gourmet restaurants available at the moment</p>
                </div>
              ) : (
                visibleGourmetRestaurants.map((item) => {
                  const restaurant = item.restaurant || item
                  const restaurantSlug = restaurant.slug || restaurant.restaurantName?.toLowerCase().replace(/\s+/g, "-") || restaurant.name?.toLowerCase().replace(/\s+/g, "-") || ""
                  const restaurantId = restaurant._id || restaurant.restaurantId || restaurant.id
                  const isFavorite = favorites.has(restaurantId)

                  // Calculate distance if coordinates are available
                  const calculateDistance = (lat1, lng1, lat2, lng2) => {
                    const R = 6371; // Earth's radius in kilometers
                    const dLat = ((lat2 - lat1) * Math.PI) / 180;
                    const dLng = ((lng2 - lng1) * Math.PI) / 180;
                    const a =
                      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos((lat1 * Math.PI) / 180) *
                        Math.cos((lat2 * Math.PI) / 180) *
                        Math.sin(dLng / 2) *
                        Math.sin(dLng / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    return R * c; // Distance in kilometers
                  };

                  let distanceStr = '1.2 km'
                  const restaurantLat = restaurant.location?.latitude || restaurant.location?.coordinates?.[1]
                  const restaurantLng = restaurant.location?.longitude || restaurant.location?.coordinates?.[0]
                  
                  if (location?.latitude && location?.longitude && restaurantLat && restaurantLng) {
                    const d = calculateDistance(location.latitude, location.longitude, restaurantLat, restaurantLng)
                    distanceStr = `${d.toFixed(1)} km`
                  } else if (restaurant.distance) {
                    distanceStr = restaurant.distance
                  }

                  // Get restaurant cover image with priority: coverImages > menuImages > profileImage
                  const coverImages = restaurant.coverImages && restaurant.coverImages.length > 0
                    ? restaurant.coverImages.map(img => img.url || img).filter(Boolean)
                    : []

                  const menuImages = restaurant.menuImages && restaurant.menuImages.length > 0
                    ? restaurant.menuImages.map(img => img.url || img).filter(Boolean)
                    : []

                  const rawRestaurantImage =
                    coverImages.length > 0
                      ? coverImages[0]
                      : (menuImages.length > 0
                        ? menuImages[0]
                        : (restaurant.profileImage?.url || restaurant.profileImage || restaurant.image || ""))

                  const restaurantImage = resolveImageUrl(rawRestaurantImage)

                  return (
                    <Link key={restaurantId} to={`/user/restaurants/${restaurantSlug}`}>
                      <Card className="overflow-hidden cursor-pointer border-0 group bg-white dark:bg-[#1a1a1a] shadow-xl shadow-gray-200/20 dark:shadow-none hover:shadow-2xl hover:shadow-[#DC2626]/5 transition-all duration-500 py-0 rounded-[32px] mb-4 group active:scale-[0.98]">
                        {/* Image Section */}
                        <div className="relative h-48 sm:h-56 md:h-60 w-full overflow-hidden rounded-t-[32px]">
                          {restaurantImage ? (
                            <OptimizedImage
                              src={restaurantImage}
                              alt={restaurant.restaurantName || restaurant.name}
                              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                            />
                          ) : (
                            <div className="w-full h-full bg-gray-100 dark:bg-zinc-800 flex items-center justify-center">
                              <Utensils className="w-8 h-8 text-gray-200" />
                            </div>
                          )}
                          
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />

                          {/* Bookmark Icon - Top Right */}
                          <div className="absolute top-4 right-4 z-10">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-10 w-10 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-2xl border border-white/20 transition-all active:scale-90"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                toggleFavorite(restaurantId)
                              }}
                            >
                              <Bookmark className={`h-5 w-5 ${isFavorite ? "fill-white text-white" : "text-white/80"}`} strokeWidth={2} />
                            </Button>
                          </div>
                          
                          {/* Rating Badge Overlay */}
                          <div className="absolute bottom-4 right-4 flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-2xl shadow-2xl">
                             <span className="text-sm font-black text-gray-900">{restaurant.rating?.toFixed(1) || '4.0'}</span>
                             <Star className="h-3.5 w-3.5 fill-[#DC2626] text-[#DC2626]" />
                          </div>
                        </div>

                        {/* Content Section */}
                        <CardContent className="p-5">
                          {/* Restaurant Name */}
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <h3 className="text-xl font-black text-gray-900 dark:text-gray-100 truncate group-hover:text-[#DC2626] transition-colors">
                              {restaurant.restaurantName || restaurant.name}
                            </h3>
                          </div>

                          {/* Delivery Time & Distance */}
                          <div className="flex items-center gap-4 text-[12px] text-gray-500 dark:text-gray-400 mb-4 font-bold uppercase tracking-tight">
                            <div className="flex items-center gap-1.5">
                              <Clock className="h-4 w-4 text-[#DC2626]" strokeWidth={2.5} />
                              <span>{restaurant.estimatedDeliveryTime || '25-30 mins'}</span>
                            </div>
                            <span className="text-gray-200">•</span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[#F87171] font-black">{distanceStr} away</span>
                            </div>
                          </div>

                          {/* Offer Badge */}
                          {restaurant.offer ? (
                            <div className="flex items-center gap-2.5 px-3 py-2 bg-[#DC2626]/5 dark:bg-[#DC2626]/10 rounded-2xl w-fit">
                              <BadgePercent className="h-4 w-4 text-[#DC2626]" strokeWidth={3} />
                              <span className="text-[10px] font-black text-[#DC2626] uppercase tracking-wider">{restaurant.offer}</span>
                            </div>
                          ) : (
                            <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest bg-gray-50 dark:bg-zinc-900 px-3 py-2 rounded-2xl w-fit">
                              Elite Selection
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </Link>
                  )
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


