import React, { useEffect, useMemo, useState, useCallback } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowLeft,
  Clock,
  MapPin,
  Heart,
  Star,
  Search,
  SlidersHorizontal,
  X,
  Sparkles,
  Leaf,
  BadgePercent,
  RotateCcw,
  Check,
  ChevronDown,
  Building2,
  Navigation,
} from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import Footer from "@food/components/user/Footer"
import ScrollReveal from "@food/components/user/ScrollReveal"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { RestaurantGridSkeleton } from "@food/components/ui/loading-skeletons"
import { useProfile } from "@food/context/ProfileContext"
import { useDeliveryLocation } from "@food/context/DeliveryLocationContext"
import { restaurantAPI } from "@food/api"
import { API_BASE_URL } from "@food/api/config"
import { useDelayedLoading } from "@food/hooks/useDelayedLoading"
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability"
import { calculateDistance } from "@food/utils/common"
import { usePullToRefresh } from "@/shared/hooks/usePullToRefresh"

const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "")

const normalizeImageUrl = (imageUrl) => {
  if (typeof imageUrl !== "string" || !imageUrl.trim()) return ""
  const trimmed = imageUrl.trim()
  if (/^(https?:)?\/\//i.test(trimmed) || /^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) {
    return trimmed
  }
  return trimmed.startsWith("/")
    ? `${BACKEND_ORIGIN}${trimmed}`
    : `${BACKEND_ORIGIN}/${trimmed}`
}

const pickRestaurantImages = (restaurant) => {
  const candidates = [
    restaurant?.coverImage?.url,
    restaurant?.coverImage,
    ...(Array.isArray(restaurant?.coverImages) ? restaurant.coverImages.map((img) => img?.url || img) : []),
    restaurant?.profileImage?.url,
    restaurant?.profileImage,
    restaurant?.image?.url,
    restaurant?.image,
    ...(Array.isArray(restaurant?.menuImages) ? restaurant.menuImages.map((img) => img?.url || img) : []),
  ]
  const validImages = candidates
    .filter((value) => typeof value === "string" && value.trim())
    .map((img) => normalizeImageUrl(img))
  return Array.from(new Set(validImages))
}

const fallbackRestaurantImage =
  "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&auto=format&fit=crop&q=80"

/** Sub-component for individual restaurant card with zero-overflow horizontal layout */
function HorizontalRestaurantCard({ restaurant, favorite, onToggleFavorite, index }) {
  const isOpen = restaurant.availability?.isOpen ?? true

  return (
    <ScrollReveal delay={Math.min(index * 0.03, 0.2)}>
      <Link
        to={`/food/user/restaurants/${restaurant.slug}`}
        className="block group focus:outline-none select-none w-full max-w-full"
      >
        <div
          className={`w-full max-w-full overflow-hidden border border-gray-200/80 dark:border-white/10 bg-white dark:bg-[#141414] rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-all duration-300 transform hover:-translate-y-0.5 active:scale-[0.99] flex items-center justify-between gap-3 sm:gap-4 ${
            !isOpen ? "opacity-85" : ""
          }`}
        >
          {/* Left Side: Info & Order Button */}
          <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch py-0.5">
            <div>
              {/* Row 1: Name & Heart Icon */}
              <div className="flex items-center justify-between gap-1.5 mb-0.5">
                <h3 className="text-[15px] sm:text-base font-bold text-gray-900 dark:text-white truncate group-hover:text-[#008543] transition-colors duration-200 tracking-tight">
                  {restaurant.name}
                </h3>
                <button
                  type="button"
                  onClick={(e) => onToggleFavorite(e, restaurant)}
                  className="p-1 -mr-1 rounded-full text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors flex-shrink-0"
                  aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
                >
                  <Heart
                    className={`w-4 h-4 transition-colors ${
                      favorite
                        ? "fill-red-500 text-red-500 stroke-red-500"
                        : "stroke-[2]"
                    }`}
                  />
                </button>
              </div>

              {/* Row 2: Cuisines */}
              <p className="text-[11px] sm:text-xs text-gray-500 dark:text-zinc-400 font-medium truncate mb-1">
                {restaurant.allCuisinesText}
              </p>

              {/* Row 3: Rating ⭐ & Veg Tag */}
              <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                <div className="flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 flex-shrink-0" />
                  <span className="text-xs font-bold text-gray-900 dark:text-white">
                    {restaurant.rating}
                  </span>
                </div>
                {restaurant.isPureVeg && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200/60">
                    <Leaf className="w-2.5 h-2.5 fill-emerald-600" />
                    <span>Veg</span>
                  </span>
                )}
                {restaurant.offer && (
                  <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 rounded border border-emerald-200/50 truncate max-w-[130px]">
                    <BadgePercent className="w-2.5 h-2.5 flex-shrink-0" />
                    <span className="truncate">{restaurant.offer}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Subtle Divider Line */}
            <div className="h-px bg-gray-100 dark:bg-zinc-800/80 my-1 w-full" />

            {/* Row 4: Time, Distance & Order Now Button */}
            <div className="flex items-center justify-between gap-1.5 pt-0.5">
              <div className="flex items-center gap-2 text-[11px] sm:text-xs text-gray-600 dark:text-zinc-400 font-medium truncate">
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Clock className="w-3 h-3 text-gray-500 dark:text-zinc-400" />
                  <span>{restaurant.deliveryTime}</span>
                </div>
                <span className="text-gray-300 dark:text-zinc-700">•</span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <MapPin className="w-3 h-3 text-gray-400 dark:text-zinc-500" />
                  <span>{restaurant.distance}</span>
                </div>
              </div>

              {/* Order Now Action (Brand Green Theme) */}
              <button
                type="button"
                className="bg-[#008543] hover:bg-[#00733a] text-white font-bold text-xs px-3.5 py-1.5 rounded-lg sm:rounded-xl shadow-sm hover:shadow transition-all active:scale-95 flex items-center justify-center flex-shrink-0"
              >
                Order Now
              </button>
            </div>
          </div>

          {/* Right Side: Image */}
          <div className="relative w-24 h-24 sm:w-32 sm:h-32 md:w-36 md:h-36 rounded-xl sm:rounded-2xl overflow-hidden bg-gray-100 dark:bg-zinc-800 flex-shrink-0 shadow-sm group-hover:scale-[1.02] transition-transform duration-300">
            <img
              src={restaurant.image}
              alt={restaurant.name}
              className="w-full h-full object-cover"
              loading={index < 4 ? "eager" : "lazy"}
              decoding="async"
              onError={(e) => {
                e.currentTarget.src = fallbackRestaurantImage
              }}
            />
            {!isOpen && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-1">
                <span className="text-white text-[10px] font-bold uppercase tracking-wider bg-rose-600 px-2 py-0.5 rounded-full">
                  Closed
                </span>
              </div>
            )}
          </div>
        </div>
      </Link>
    </ScrollReveal>
  )
}

export default function Restaurants() {
  const navigate = useNavigate()
  const { addFavorite, removeFavorite, isFavorite } = useProfile()
  const { effectiveLocation: userLocation, zoneId, displayAddressText } = useDeliveryLocation()

  const [restaurants, setRestaurants] = useState([])
  const [loading, setLoading] = useState(true)
  const showRestaurantsSkeleton = useDelayedLoading(loading)

  // Search, Filter & Sort State
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCuisine, setSelectedCuisine] = useState("all")
  const [activeFilter, setActiveFilter] = useState("all") // 'all', 'pure_veg', 'rating_4plus', 'fast_delivery', 'offers', 'open_now'
  const [sortBy, setSortBy] = useState("recommended")
  const [showSortMenu, setShowSortMenu] = useState(false)

  const fetchRestaurants = useCallback(async () => {
    try {
      setLoading(true)
      const params = { limit: 300, _ts: Date.now() }
      if (zoneId) {
        params.zoneId = zoneId
      }
      const response = await restaurantAPI.getRestaurants(params, { noCache: true })
      const list =
        response?.data?.data?.restaurants ||
        response?.data?.restaurants ||
        []

      const userLat = userLocation?.latitude
      const userLng = userLocation?.longitude

      const transformed = list.map((restaurant) => {
        const slug =
          restaurant?.slug ||
          String(restaurant?.name || restaurant?.restaurantName || "")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")

        const cuisinesList = Array.isArray(restaurant?.cuisines) && restaurant.cuisines.length > 0
          ? restaurant.cuisines.filter(Boolean)
          : [restaurant?.cuisine || "Multi-cuisine"]

        const primaryCuisine = cuisinesList[0] || "Multi-cuisine"
        const allCuisinesText = cuisinesList.join(", ")

        const rLoc = restaurant?.location
        const rLat = rLoc?.latitude || rLoc?.coordinates?.[1]
        const rLng = rLoc?.longitude || rLoc?.coordinates?.[0]
        
        let distInKm = Number.isFinite(Number(restaurant?.distanceInKm))
          ? Number(restaurant?.distanceInKm)
          : calculateDistance(userLat, userLng, rLat, rLng)

        const formattedDistance = restaurant?.distance
          ? (typeof restaurant.distance === "number" ? `${restaurant.distance.toFixed(1)} km` : restaurant.distance)
          : Number.isFinite(distInKm)
          ? `${distInKm.toFixed(1)} km`
          : "1.2 km"

        const rawRating = Number(restaurant?.rating || restaurant?.avgRating || 0)
        const rating = rawRating > 0 ? (rawRating > 5 ? rawRating / 20 : rawRating) : 4.5
        const ratingCount = restaurant?.ratingCount || restaurant?.ratingsCount || restaurant?.reviewsCount || null

        const images = pickRestaurantImages(restaurant)
        const image = images[0] || fallbackRestaurantImage

        const activeOfferSummaries = Array.isArray(restaurant?.activeOffers)
          ? restaurant.activeOffers.map((o) => o?.summary || o?.name || o?.title).filter(Boolean)
          : []
        const offer = activeOfferSummaries[0] || restaurant?.offer || restaurant?.discount || null

        const rawDeliveryTime =
          restaurant?.estimatedDeliveryTime ||
          restaurant?.deliveryTime ||
          (restaurant?.estimatedDeliveryTimeMinutes
            ? `${restaurant.estimatedDeliveryTimeMinutes} mins`
            : "25-30 mins")
        
        let deliveryTimeStr = String(rawDeliveryTime).trim()
        if (/^\d+(-\d+)?$/.test(deliveryTimeStr)) {
          deliveryTimeStr = `${deliveryTimeStr} mins`
        }

        const deliveryMinutesMatch = deliveryTimeStr.match(/(\d+)/)
        const deliveryMinutes = deliveryMinutesMatch ? parseInt(deliveryMinutesMatch[1], 10) : 30

        const rawCost = restaurant?.costForTwo || restaurant?.avgPrice || restaurant?.averagePrice || 250
        const costNumber = typeof rawCost === "number" ? rawCost : parseInt(String(rawCost).replace(/[^0-9]/g, "") || "250", 10)

        const isPureVeg = Boolean(
          restaurant?.isPureVeg ||
          restaurant?.pureVegRestaurant ||
          restaurant?.vegOnly ||
          restaurant?.dietaryPreferences?.includes("veg")
        )

        const isFeatured = Boolean(restaurant?.isFeatured || restaurant?.isPromoted || restaurant?.featured)
        const availability = getRestaurantAvailabilityStatus(restaurant, new Date())

        return {
          id: restaurant?._id || restaurant?.restaurantId || slug,
          slug,
          name: restaurant?.restaurantName || restaurant?.name || "Restaurant",
          cuisine: primaryCuisine,
          cuisinesList,
          allCuisinesText,
          rating: Number(rating.toFixed(1)),
          ratingCount,
          deliveryTime: deliveryTimeStr,
          deliveryMinutes,
          distance: formattedDistance,
          distanceInKm: Number.isFinite(distInKm) ? distInKm : 1.2,
          costForTwo: `₹${costNumber} for two`,
          costNumber,
          priceRange: restaurant?.priceRange || "$$",
          image,
          images,
          offer,
          isPureVeg,
          isFeatured,
          availability,
          raw: restaurant,
        }
      })

      setRestaurants(transformed)
    } catch (error) {
      console.warn("Failed to load restaurants:", error)
      setRestaurants([])
    } finally {
      setLoading(false)
    }
  }, [zoneId, userLocation?.latitude, userLocation?.longitude])

  useEffect(() => {
    fetchRestaurants()
  }, [fetchRestaurants])

  usePullToRefresh(fetchRestaurants)

  // Filter and sort restaurants
  const filteredRestaurants = useMemo(() => {
    let result = [...restaurants]

    // 1. Search Query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.allCuisinesText.toLowerCase().includes(q) ||
          r.slug.toLowerCase().includes(q)
      )
    }

    // 2. Cuisine filter
    if (selectedCuisine !== "all") {
      result = result.filter((r) =>
        r.cuisinesList.some(
          (c) => c.toLowerCase() === selectedCuisine.toLowerCase()
        )
      )
    }

    // 3. Quick active filter
    if (activeFilter === "pure_veg") {
      result = result.filter((r) => r.isPureVeg)
    } else if (activeFilter === "rating_4plus") {
      result = result.filter((r) => r.rating >= 4.0)
    } else if (activeFilter === "fast_delivery") {
      result = result.filter((r) => r.deliveryMinutes <= 30)
    } else if (activeFilter === "offers") {
      result = result.filter((r) => Boolean(r.offer))
    } else if (activeFilter === "open_now") {
      result = result.filter((r) => r.availability?.isOpen)
    }

    // 4. Sorting
    result.sort((a, b) => {
      const aOpen = a.availability?.isOpen ? 1 : 0
      const bOpen = b.availability?.isOpen ? 1 : 0
      if (aOpen !== bOpen) return bOpen - aOpen

      if (sortBy === "rating_high") return b.rating - a.rating
      if (sortBy === "delivery_fast") return a.deliveryMinutes - b.deliveryMinutes
      if (sortBy === "distance_near") return a.distanceInKm - b.distanceInKm
      if (sortBy === "cost_low") return a.costNumber - b.costNumber
      if (sortBy === "cost_high") return b.costNumber - a.costNumber
      return b.rating - a.rating
    })

    return result
  }, [restaurants, searchQuery, selectedCuisine, activeFilter, sortBy])

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    selectedCuisine !== "all" ||
    activeFilter !== "all" ||
    sortBy !== "recommended"

  const handleResetFilters = () => {
    setSearchQuery("")
    setSelectedCuisine("all")
    setActiveFilter("all")
    setSortBy("recommended")
  }

  const handleToggleFavorite = (e, restaurant) => {
    e.preventDefault()
    e.stopPropagation()
    const favorite = isFavorite(restaurant.slug)
    if (favorite) {
      removeFavorite(restaurant.slug)
    } else {
      addFavorite({
        slug: restaurant.slug,
        name: restaurant.name,
        cuisine: restaurant.cuisine,
        rating: restaurant.rating,
        deliveryTime: restaurant.deliveryTime,
        distance: restaurant.distance,
        priceRange: restaurant.priceRange,
        image: restaurant.image,
      })
    }
  }

  const sortOptions = [
    { id: "recommended", label: "Recommended" },
    { id: "rating_high", label: "Rating: High to Low" },
    { id: "delivery_fast", label: "Delivery Time: Fastest" },
    { id: "distance_near", label: "Distance: Nearest" },
    { id: "cost_low", label: "Cost: Low to High" },
    { id: "cost_high", label: "Cost: High to Low" },
  ]

  return (
    <AnimatedPage className="min-h-screen bg-[#fbfbfb] dark:bg-[#0a0a0a] text-gray-900 dark:text-gray-100 flex flex-col justify-between overflow-x-hidden w-full">
      <div className="w-full max-w-3xl mx-auto px-3.5 sm:px-5 py-3 sm:py-5 space-y-3 flex-1 overflow-x-hidden">
        
        {/* Top Header Section */}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                onClick={() => navigate(-1)}
                className="h-9 w-9 rounded-full bg-white dark:bg-[#181818] border border-gray-200/80 dark:border-white/10 shadow-sm flex items-center justify-center text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-800 active:scale-95 transition-all flex-shrink-0"
                aria-label="Go back"
              >
                <ArrowLeft className="h-4.5 w-4.5" />
              </button>
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-lg sm:text-2xl font-black tracking-tight text-gray-900 dark:text-white truncate">
                  All Restaurants
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-[#008543] dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200/60 flex-shrink-0">
                  {filteredRestaurants.length}
                </span>
              </div>
            </div>

            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-[#008543] dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 hover:bg-emerald-100 whitespace-nowrap transition-all flex-shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
          </div>

          {/* Dynamic Live Delivery Location Subtitle */}
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 font-medium pl-0.5 pt-0.5">
            <Navigation className="w-3 h-3 text-[#008543] flex-shrink-0" />
            <span className="truncate">
              Delivering to <strong className="text-gray-700 dark:text-gray-200">{displayAddressText || "your location"}</strong>
            </span>
          </div>
        </div>

        {/* Search & Sort Controls */}
        <div className="bg-white dark:bg-[#141414] p-3 rounded-2xl border border-gray-200/70 dark:border-white/10 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-2.5 w-full relative z-20">
          
          {/* Search Bar & Sort Button */}
          <div className="flex gap-2 items-center w-full">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-zinc-500 pointer-events-none" />
              <Input
                type="text"
                placeholder="Search restaurants, cuisines, dishes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-8 h-10 rounded-xl bg-gray-50/90 dark:bg-zinc-900 border-gray-200/80 dark:border-zinc-800 focus:bg-white text-xs sm:text-sm font-medium w-full"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Sort Toggle Button */}
            <div className="relative flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowSortMenu((prev) => !prev)}
                className="h-10 px-3 rounded-xl bg-gray-50/90 dark:bg-zinc-900 border border-gray-200/80 dark:border-zinc-800 hover:border-gray-300 flex items-center gap-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 transition-all shadow-sm active:scale-95"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#008543]" />
                <span className="hidden sm:inline">
                  {sortOptions.find((o) => o.id === sortBy)?.label || "Sort"}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showSortMenu ? "rotate-180" : ""}`} />
              </button>

              {/* Sort Dropdown */}
              <AnimatePresence>
                {showSortMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowSortMenu(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-[#1c1c1c] rounded-2xl border border-gray-200/90 dark:border-zinc-700 shadow-[0_12px_40px_rgba(0,0,0,0.18)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.7)] z-50 py-1.5 overflow-hidden"
                    >
                      <div className="px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500 border-b border-gray-100 dark:border-zinc-800">
                        Sort Restaurants
                      </div>
                      {sortOptions.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => {
                            setSortBy(opt.id)
                            setShowSortMenu(false)
                          }}
                          className={`w-full text-left px-3.5 py-2.5 text-xs sm:text-sm flex items-center justify-between hover:bg-emerald-50/60 dark:hover:bg-zinc-800 transition-colors ${
                            sortBy === opt.id
                              ? "text-[#008543] font-bold bg-emerald-50/40 dark:bg-emerald-950/20"
                              : "text-gray-700 dark:text-zinc-300 font-medium"
                          }`}
                        >
                          <span>{opt.label}</span>
                          {sortBy === opt.id && <Check className="w-4 h-4 text-[#008543]" />}
                        </button>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Quick Filter Pills (Zero scrollbar lines across all devices) */}
          <div
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scrollbar-hide w-full pt-0.5 pb-0.5"
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {[
              { id: "all", label: "All" },
              { id: "pure_veg", label: "Pure Veg", icon: Leaf, color: "text-[#008543]" },
              { id: "rating_4plus", label: "Rating 4.0+", icon: Star, color: "text-amber-500" },
              { id: "fast_delivery", label: "Fast (<30m)", icon: Clock, color: "text-blue-500" },
              { id: "offers", label: "Offers & Deals", icon: BadgePercent, color: "text-purple-500" },
              { id: "open_now", label: "Open Now", pulse: true },
            ].map((pill) => {
              const isActive = activeFilter === pill.id
              const IconComponent = pill.icon

              return (
                <button
                  key={pill.id}
                  onClick={() => setActiveFilter(isActive && pill.id !== "all" ? "all" : pill.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border flex-shrink-0 ${
                    isActive
                      ? "bg-[#008543] text-white border-[#008543] shadow-sm scale-[1.02]"
                      : "bg-gray-50/90 dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 border-gray-200/80 dark:border-zinc-800 hover:border-gray-300"
                  }`}
                >
                  {pill.pulse && (
                    <span className="relative flex h-2 w-2 mr-0.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#008543]"></span>
                    </span>
                  )}
                  {IconComponent && (
                    <IconComponent
                      className={`w-3.5 h-3.5 ${isActive ? "text-white" : pill.color || ""}`}
                    />
                  )}
                  <span>{pill.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Restaurant List Section */}
        {showRestaurantsSkeleton ? (
          <RestaurantGridSkeleton count={5} />
        ) : filteredRestaurants.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="py-16 flex flex-col items-center justify-center text-center px-4"
          >
            <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 flex items-center justify-center mb-4 text-[#008543]">
              <Building2 className="w-9 h-9 stroke-[1.5]" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1.5">
              No restaurants found in your area
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md mb-5 font-medium">
              We couldn't find any restaurants matching your active filters. Try adjusting or resetting them.
            </p>
            <Button
              onClick={handleResetFilters}
              className="bg-[#008543] hover:bg-[#00733a] text-white rounded-xl px-4 py-2 text-xs font-semibold shadow-md shadow-emerald-500/20 gap-2"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset all filters</span>
            </Button>
          </motion.div>
        ) : (
          <div className="flex flex-col gap-3 sm:gap-3.5 pt-1 w-full max-w-full overflow-hidden">
            {filteredRestaurants.map((restaurant, index) => {
              const favorite = isFavorite(restaurant.slug)

              return (
                <HorizontalRestaurantCard
                  key={restaurant.id}
                  restaurant={restaurant}
                  favorite={favorite}
                  onToggleFavorite={handleToggleFavorite}
                  index={index}
                />
              )
            })}
          </div>
        )}
      </div>

      <Footer />
    </AnimatedPage>
  )
}
