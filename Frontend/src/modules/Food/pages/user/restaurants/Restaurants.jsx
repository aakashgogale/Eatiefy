import React, { useEffect, useMemo, useState } from "react"
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
  Timer,
  IndianRupee,
  UtensilsCrossed,
  RotateCcw,
  Check,
  ChevronDown,
} from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import Footer from "@food/components/user/Footer"
import ScrollReveal from "@food/components/user/ScrollReveal"
import { Card, CardContent } from "@food/components/ui/card"
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
    ...(Array.isArray(restaurant?.menuImages) ? restaurant.menuImages.map((img) => img?.url || img) : []),
    restaurant?.profileImage?.url,
    restaurant?.profileImage,
  ]
  const validImages = candidates
    .filter((value) => typeof value === "string" && value.trim())
    .map((img) => normalizeImageUrl(img))
  return Array.from(new Set(validImages))
}

const fallbackRestaurantImage =
  "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&auto=format&fit=crop&q=80"

export default function Restaurants() {
  const navigate = useNavigate()
  const { addFavorite, removeFavorite, isFavorite } = useProfile()
  const { effectiveLocation: userLocation, zoneId } = useDeliveryLocation()

  const [restaurants, setRestaurants] = useState([])
  const [loading, setLoading] = useState(true)
  const showRestaurantsSkeleton = useDelayedLoading(loading)

  // Search, Filter & Sort State
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCuisine, setSelectedCuisine] = useState("all")
  const [activeFilter, setActiveFilter] = useState("all") // 'all', 'pure_veg', 'rating_4plus', 'fast_delivery', 'offers', 'open_now'
  const [sortBy, setSortBy] = useState("recommended") // 'recommended', 'rating_high', 'delivery_fast', 'distance_near', 'cost_low', 'cost_high'
  const [showSortMenu, setShowSortMenu] = useState(false)

  useEffect(() => {
    let cancelled = false

    const fetchRestaurants = async () => {
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
        if (cancelled) return

        const userLat = userLocation?.latitude
        const userLng = userLocation?.longitude

        const transformed = list.map((restaurant) => {
          const slug =
            restaurant?.slug ||
            String(restaurant?.name || "")
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
          const rating = rawRating > 0 ? (rawRating > 5 ? rawRating / 20 : rawRating) : 4.3

          const images = pickRestaurantImages(restaurant)
          const image = images[0] || fallbackRestaurantImage

          // Determine offers
          const activeOfferSummaries = Array.isArray(restaurant?.activeOffers)
            ? restaurant.activeOffers.map((o) => o?.summary || o?.name).filter(Boolean)
            : []
          const offer = activeOfferSummaries[0] || restaurant?.offer || restaurant?.discount || null

          // Delivery time minutes parse for sorting
          const deliveryTimeStr =
            restaurant?.estimatedDeliveryTime ||
            (restaurant?.estimatedDeliveryTimeMinutes
              ? `${restaurant.estimatedDeliveryTimeMinutes} mins`
              : "25-30 mins")
          
          const deliveryMinutesMatch = String(deliveryTimeStr).match(/(\d+)/)
          const deliveryMinutes = deliveryMinutesMatch ? parseInt(deliveryMinutesMatch[1], 10) : 30

          // Cost parse
          const rawCost = restaurant?.costForTwo || restaurant?.avgPrice || 250
          const costNumber = typeof rawCost === "number" ? rawCost : parseInt(String(rawCost).replace(/[^0-9]/g, "") || "250", 10)

          const isPureVeg = Boolean(
            restaurant?.isPureVeg ||
            restaurant?.pureVegRestaurant ||
            restaurant?.vegOnly ||
            restaurant?.dietaryPreferences?.includes("veg")
          )

          const availability = getRestaurantAvailabilityStatus(restaurant, new Date())

          return {
            id: restaurant?._id || restaurant?.restaurantId || slug,
            slug,
            name: restaurant?.name || "Restaurant",
            cuisine: primaryCuisine,
            cuisinesList,
            allCuisinesText,
            rating: Number(rating.toFixed(1)),
            deliveryTime: deliveryTimeStr,
            deliveryMinutes,
            distance: formattedDistance,
            distanceInKm: Number.isFinite(distInKm) ? distInKm : 1.5,
            costForTwo: `₹${costNumber} for two`,
            costNumber,
            priceRange: restaurant?.priceRange || "$$",
            image,
            images,
            offer,
            isPureVeg,
            availability,
            raw: restaurant,
          }
        })

        setRestaurants(transformed)
      } catch (error) {
        if (!cancelled) {
          setRestaurants([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchRestaurants()
    return () => {
      cancelled = true
    }
  }, [zoneId, userLocation?.latitude, userLocation?.longitude])

  // Extract all unique cuisines for cuisine filter tabs
  const availableCuisines = useMemo(() => {
    const set = new Set()
    restaurants.forEach((r) => {
      r.cuisinesList.forEach((c) => {
        if (c && typeof c === "string" && c.trim()) {
          set.add(c.trim())
        }
      })
    })
    return ["all", ...Array.from(set).slice(0, 12)]
  }, [restaurants])

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
      // Prioritize open restaurants first
      const aOpen = a.availability?.isOpen ? 1 : 0
      const bOpen = b.availability?.isOpen ? 1 : 0
      if (aOpen !== bOpen) return bOpen - aOpen

      if (sortBy === "rating_high") {
        return b.rating - a.rating
      }
      if (sortBy === "delivery_fast") {
        return a.deliveryMinutes - b.deliveryMinutes
      }
      if (sortBy === "distance_near") {
        return a.distanceInKm - b.distanceInKm
      }
      if (sortBy === "cost_low") {
        return a.costNumber - b.costNumber
      }
      if (sortBy === "cost_high") {
        return b.costNumber - a.costNumber
      }
      // default / recommended
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

  const sortOptions = [
    { id: "recommended", label: "Recommended" },
    { id: "rating_high", label: "Rating: High to Low" },
    { id: "delivery_fast", label: "Delivery Time: Fastest" },
    { id: "distance_near", label: "Distance: Nearest" },
    { id: "cost_low", label: "Cost: Low to High" },
    { id: "cost_high", label: "Cost: High to Low" },
  ]

  return (
    <AnimatedPage className="min-h-screen bg-[#fafafa] dark:bg-[#0c0c0c] text-gray-900 dark:text-gray-100 flex flex-col justify-between">
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 md:py-8 space-y-6 flex-1">
        {/* Header Bar */}
        <ScrollReveal>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
            <div className="flex items-center gap-3.5">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(-1)}
                className="h-10 w-10 sm:h-11 sm:w-11 rounded-full bg-white dark:bg-[#181818] border border-gray-200 dark:border-zinc-800 shadow-sm hover:bg-gray-100 dark:hover:bg-zinc-800 transition-all"
                aria-label="Go back"
              >
                <ArrowLeft className="h-5 w-5 text-gray-700 dark:text-gray-200" />
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                    All Restaurants
                  </h1>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400 border border-orange-200 dark:border-orange-900/50">
                    {filteredRestaurants.length}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-primary-orange flex-shrink-0" />
                  <span>Discover top-rated cuisines & lightning-fast delivery near you</span>
                </p>
              </div>
            </div>

            {/* Quick stats / Zone Pill */}
            {zoneId && (
              <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-zinc-800/80 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200/70 dark:border-zinc-700/60 self-start sm:self-auto">
                <MapPin className="w-3.5 h-3.5 text-primary-orange" />
                <span>Zone Delivering Active</span>
              </div>
            )}
          </div>
        </ScrollReveal>

        {/* Search & Filter Controls Bar */}
        <ScrollReveal delay={0.05}>
          <div className="bg-white dark:bg-[#151515] p-3.5 sm:p-4 rounded-2xl border border-gray-200/80 dark:border-zinc-800/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.2)] space-y-3.5">
            {/* Search Input & Sort Trigger */}
            <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3 items-stretch sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-zinc-500 pointer-events-none" />
                <Input
                  type="text"
                  placeholder="Search restaurants, cuisines, dishes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-9 h-11 rounded-xl bg-gray-50/80 dark:bg-zinc-900 border-gray-200 dark:border-zinc-800 focus:bg-white dark:focus:bg-zinc-900 text-sm placeholder:text-gray-400 dark:placeholder:text-zinc-500 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Sort Dropdown */}
              <div className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowSortMenu((prev) => !prev)}
                  className="w-full sm:w-auto h-11 px-4 rounded-xl bg-gray-50/80 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 hover:border-gray-300 dark:hover:border-zinc-700 flex items-center justify-between sm:justify-center gap-2 text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-200 transition-all shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-primary-orange" />
                    <span>
                      {sortOptions.find((o) => o.id === sortBy)?.label || "Sort"}
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showSortMenu ? "rotate-180" : ""}`} />
                </button>

                {/* Dropdown Menu */}
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
                        className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-xl z-50 py-1.5 overflow-hidden"
                      >
                        <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500 border-b border-gray-100 dark:border-zinc-800">
                          Sort Restaurants By
                        </div>
                        {sortOptions.map((opt) => (
                          <button
                            key={opt.id}
                            onClick={() => {
                              setSortBy(opt.id)
                              setShowSortMenu(false)
                            }}
                            className={`w-full text-left px-3.5 py-2.5 text-xs sm:text-sm flex items-center justify-between hover:bg-orange-50/60 dark:hover:bg-zinc-800 transition-colors ${
                              sortBy === opt.id
                                ? "text-primary-orange font-bold bg-orange-50/40 dark:bg-orange-950/20"
                                : "text-gray-700 dark:text-zinc-300 font-medium"
                            }`}
                          >
                            <span>{opt.label}</span>
                            {sortBy === opt.id && <Check className="w-4 h-4 text-primary-orange" />}
                          </button>
                        ))}
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Quick Filter Pills Strip */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-1 pb-0.5">
              {[
                { id: "all", label: "All" },
                { id: "pure_veg", label: "Pure Veg", icon: Leaf, color: "text-emerald-600" },
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
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border shadow-sm ${
                      isActive
                        ? "bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-zinc-900 dark:border-white shadow-md scale-[1.02]"
                        : "bg-gray-50 dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 border-gray-200 dark:border-zinc-800 hover:border-gray-300 dark:hover:border-zinc-700"
                    }`}
                  >
                    {pill.pulse && (
                      <span className="relative flex h-2 w-2 mr-0.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                    )}
                    {IconComponent && (
                      <IconComponent
                        className={`w-3.5 h-3.5 ${isActive ? "text-white dark:text-zinc-900" : pill.color || ""}`}
                      />
                    )}
                    <span>{pill.label}</span>
                  </button>
                )
              })}

              {/* Reset Button when filters active */}
              {hasActiveFilters && (
                <button
                  onClick={handleResetFilters}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 hover:bg-red-100 dark:hover:bg-red-900/60 whitespace-nowrap transition-all ml-auto"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              )}
            </div>

            {/* Cuisines Horizontal Bar */}
            {availableCuisines.length > 2 && (
              <div className="pt-2 border-t border-gray-100 dark:border-zinc-800/80 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500 mr-1 whitespace-nowrap">
                  Cuisines:
                </span>
                {availableCuisines.map((c) => {
                  const isSelected = selectedCuisine === c
                  const label = c === "all" ? "All Cuisines" : c
                  return (
                    <button
                      key={c}
                      onClick={() => setSelectedCuisine(c)}
                      className={`text-xs px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-colors ${
                        isSelected
                          ? "bg-primary-orange text-white font-bold shadow-sm"
                          : "text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-900 dark:hover:text-zinc-200"
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </ScrollReveal>

        {/* Restaurant Grid or Skeleton / Empty State */}
        {showRestaurantsSkeleton ? (
          <RestaurantGridSkeleton count={8} />
        ) : filteredRestaurants.length === 0 ? (
          /* Empty State */
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="py-16 sm:py-20 flex flex-col items-center justify-center text-center px-4"
          >
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-orange-50 dark:bg-orange-950/40 border border-orange-100 dark:border-orange-900/40 flex items-center justify-center mb-4 text-primary-orange shadow-inner">
              <UtensilsCrossed className="w-9 h-9 sm:w-11 sm:h-11 stroke-[1.5]" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-1.5">
              No restaurants match your filters
            </h3>
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 max-w-md mb-6">
              We couldn't find any restaurants matching your current search or active filters. Try adjusting or resetting them.
            </p>
            <Button
              onClick={handleResetFilters}
              className="bg-primary-orange hover:bg-primary-orange/90 text-white rounded-xl px-5 py-2.5 text-sm font-semibold shadow-md shadow-orange-500/20 gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Reset all filters</span>
            </Button>
          </motion.div>
        ) : (
          /* Grid of Production-Grade Cards */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5 lg:gap-6 pt-1">
            {filteredRestaurants.map((restaurant, index) => {
              const favorite = isFavorite(restaurant.slug)
              const isOpen = restaurant.availability?.isOpen ?? true

              const handleToggleFavorite = (e) => {
                e.preventDefault()
                e.stopPropagation()
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

              return (
                <ScrollReveal key={restaurant.id} delay={Math.min(index * 0.04, 0.3)}>
                  <Link
                    to={`/food/user/restaurants/${restaurant.slug}`}
                    className="h-full flex group focus:outline-none"
                  >
                    <Card
                      className={`overflow-hidden border border-gray-200/80 dark:border-zinc-800/90 bg-white dark:bg-[#161616] rounded-3xl shadow-[0_4px_16px_rgba(0,0,0,0.04)] hover:shadow-[0_12px_28px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_12px_28px_rgba(0,0,0,0.5)] transition-all duration-300 flex flex-col h-full w-full transform hover:-translate-y-1.5 ${
                        !isOpen ? "opacity-80" : ""
                      }`}
                    >
                      {/* Image Container with Badges */}
                      <div className="relative w-full aspect-[16/10] sm:h-48 md:h-52 overflow-hidden bg-gray-100 dark:bg-zinc-800 flex-shrink-0">
                        <img
                          src={restaurant.image}
                          alt={restaurant.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            e.currentTarget.src = fallbackRestaurantImage
                          }}
                        />

                        {/* Top Gradient Overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent pointer-events-none" />

                        {/* Operational Status Pill (Top Left) */}
                        <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1.5 z-10 pointer-events-none">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-md backdrop-blur-md ${
                              isOpen
                                ? "bg-emerald-600/90 text-white border border-emerald-400/40"
                                : "bg-zinc-900/90 text-zinc-300 border border-zinc-700/50"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isOpen ? "bg-white animate-pulse" : "bg-zinc-400"
                              }`}
                            />
                            {isOpen ? "Open" : "Closed"}
                          </span>

                          {restaurant.isPureVeg && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-600 text-white shadow-md">
                              <Leaf className="w-3 h-3 fill-white" />
                              <span>Veg</span>
                            </span>
                          )}
                        </div>

                        {/* Favorite Button (Top Right) */}
                        <button
                          type="button"
                          onClick={handleToggleFavorite}
                          className="absolute top-3 right-3 z-20 h-8 w-8 sm:h-9 sm:w-9 rounded-full bg-black/40 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:bg-black/60 hover:scale-110 active:scale-95 transition-all shadow-md"
                          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
                        >
                          <Heart
                            className={`w-4 h-4 transition-colors ${
                              favorite
                                ? "fill-red-500 text-red-500 stroke-red-500"
                                : "text-white stroke-[2.2]"
                            }`}
                          />
                        </button>

                        {/* Bottom Offer Ribbon / Pill overlay on image */}
                        {restaurant.offer && (
                          <div className="absolute bottom-2.5 left-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md border border-white/15 text-white text-[11px] font-semibold truncate shadow-lg">
                            <BadgePercent className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                            <span className="truncate">{restaurant.offer}</span>
                          </div>
                        )}
                      </div>

                      {/* Card Content Details */}
                      <CardContent className="p-4 sm:p-4.5 flex-1 flex flex-col justify-between gap-3">
                        <div>
                          {/* Name & Rating */}
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white line-clamp-1 group-hover:text-primary-orange transition-colors duration-200 tracking-tight">
                              {restaurant.name}
                            </h3>
                            <div className="flex items-center gap-1 bg-emerald-600 dark:bg-emerald-700 text-white px-2 py-0.5 rounded-lg text-xs font-black shadow-sm flex-shrink-0">
                              <span>{restaurant.rating}</span>
                              <Star className="w-3 h-3 fill-current text-white" />
                            </div>
                          </div>

                          {/* Cuisines */}
                          <p className="text-xs sm:text-[13px] text-gray-500 dark:text-zinc-400 font-medium line-clamp-1">
                            {restaurant.allCuisinesText}
                          </p>
                        </div>

                        {/* Delivery Meta Row */}
                        <div className="pt-2.5 border-t border-gray-100 dark:border-zinc-800/80 flex items-center justify-between text-xs text-gray-600 dark:text-zinc-400">
                          <div className="flex items-center gap-1.5 font-semibold bg-gray-50 dark:bg-zinc-900/90 px-2 py-1 rounded-md border border-gray-100 dark:border-zinc-800">
                            <Clock className="w-3.5 h-3.5 text-primary-orange" />
                            <span>{restaurant.deliveryTime}</span>
                          </div>
                          <div className="flex items-center gap-1 font-medium text-gray-500 dark:text-zinc-400">
                            <MapPin className="w-3.5 h-3.5 text-gray-400 dark:text-zinc-500" />
                            <span>{restaurant.distance}</span>
                          </div>
                          <div className="font-semibold text-gray-700 dark:text-zinc-300">
                            {restaurant.costForTwo}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                </ScrollReveal>
              )
            })}
          </div>
        )}
      </div>

      <Footer />
    </AnimatedPage>
  )
}
