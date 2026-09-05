import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { MapPin, Search, SlidersHorizontal, Star, X, ArrowDownUp, Timer, IndianRupee, Clock, Bookmark, UtensilsCrossed, Wallet } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { Badge } from "@food/components/ui/badge"
import { Card, CardContent } from "@food/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@food/components/ui/avatar";
import AnimatedPage from "@food/components/user/AnimatedPage"
import { useLocation as useLocationHook, resolveServiceCity } from "@food/hooks/useLocation"
import { useZone } from "@food/hooks/useZone"
import { useProfile } from "@food/context/ProfileContext"
import { diningAPI } from "@food/api"
import OptimizedImage from "@food/components/OptimizedImage"
import { HeroBannerSkeleton } from "@food/components/ui/loading-skeletons"
import { isModuleAuthenticated } from "@food/utils/auth"
import { filterCategoriesForVegMode } from "@food/utils/vegMode"
import {
  buildFoodCacheKey,
  getFoodPageCache,
  setFoodPageCache,
} from "@food/utils/foodPageCache"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}
const DINING_CACHE_TTL_MS = 15 * 60 * 1000

const isDiningCacheFresh = (cached) =>
  Boolean(cached?.ts && Date.now() - Number(cached.ts) < DINING_CACHE_TTL_MS)

const slugifyValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")

const getCoordinates = (restaurant) => {
  const latitude = restaurant?.location?.latitude
  const longitude = restaurant?.location?.longitude
  if (typeof latitude === "number" && typeof longitude === "number") {
    return { latitude, longitude }
  }

  const coords = restaurant?.location?.coordinates
  if (Array.isArray(coords) && coords.length === 2) {
    return { latitude: coords[1], longitude: coords[0] }
  }

  return null
}

const getDistanceKm = (userLocation, restaurant) => {
  const userLat = Number(userLocation?.latitude)
  const userLng = Number(userLocation?.longitude)
  const restaurantCoords = getCoordinates(restaurant)

  if (!Number.isFinite(userLat) || !Number.isFinite(userLng) || !restaurantCoords) {
    return Number.POSITIVE_INFINITY
  }

  const toRadians = (value) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const dLat = toRadians(restaurantCoords.latitude - userLat)
  const dLng = toRadians(restaurantCoords.longitude - userLng)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(userLat)) *
      Math.cos(toRadians(restaurantCoords.latitude)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const shimmerClassName =
  "before:absolute before:inset-0 before:-translate-x-full before:bg-gradient-to-r before:from-transparent before:via-white/30 before:to-transparent before:animate-[shimmer_2.2s_infinite]"

const loadingCategoryCards = Array.from({ length: 6 }, (_, index) => `category-skeleton-${index}`)
const loadingRestaurantCards = Array.from({ length: 6 }, (_, index) => `restaurant-skeleton-${index}`)

function DiningSectionHeaderSkeleton() {
  return (
    <div className="mb-6 px-1">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`h-8 w-1 rounded-full bg-[#f0dcca] ${shimmerClassName} relative overflow-hidden`} />
          <div className={`h-7 w-56 max-w-[70vw] rounded-full bg-[#ead8c8] ${shimmerClassName} relative overflow-hidden`} />
        </div>
        <div className={`h-7 w-32 rounded-full bg-[#f5e8ef] ${shimmerClassName} relative overflow-hidden`} />
      </div>
    </div>
  )
}

function DiningCategorySkeleton({ index }) {
  return (
    <div
      className={`relative h-[114px] sm:h-[148px] md:h-[160px] overflow-hidden rounded-[22px] border border-[#efe2d3] bg-[linear-gradient(180deg,#fdfafc_0%,#f9f3f7_100%)] shadow-[0_1px_2px_rgba(60,15,61,0.05)] ${shimmerClassName}`}
    >
      <div className="absolute inset-x-0 top-0 z-10 px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="h-3 w-16 rounded-full bg-[#f0dcca]" />
        <div className="mt-3 h-4 w-24 rounded-full bg-[#ead2bc]" />
        <div className="mt-2 h-4 w-20 rounded-full bg-[#f3e3d4]" />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[64%] rounded-b-[18px] bg-[radial-gradient(circle_at_25%_20%,rgba(126,56,102,0.1),transparent_30%),linear-gradient(180deg,#fcf4f9_0%,#f5e8f1_100%)]">
        <div className="absolute bottom-3 left-3 h-14 w-14 rounded-full bg-white/45 blur-md" />
      </div>
    </div>
  )
}

function DiningRestaurantSkeleton({ index }) {
  return (
    <div className="h-full">
      <div className="h-full overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-[#efe2d3]">
        <div className={`relative h-48 overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(126,56,102,0.12),transparent_28%),linear-gradient(135deg,#fcf6fa_0%,#f9edf5_100%)] sm:h-56 md:h-60 lg:h-64 xl:h-72 ${shimmerClassName}`}>
          <div className="absolute left-4 top-4 h-8 w-28 rounded-lg bg-black/10" />
          <div className="absolute right-4 top-4 h-9 w-9 rounded-lg bg-white/60" />
          <div className="absolute bottom-0 left-0 right-0 h-[40%] bg-gradient-to-r from-[#DC2626] to-transparent/20">
            <div className="flex h-full flex-col justify-end pl-4 pb-4 sm:pl-5 sm:pb-5">
              <div className="h-2.5 w-24 rounded-full bg-white/35" />
              <div className="mt-2 h-px w-24 bg-white/25" />
              <div className="mt-3 h-4 w-40 rounded-full bg-white/55" />
            </div>
          </div>
        </div>
        <div className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="h-5 w-40 rounded-full bg-[#ead8c8]" />
              <div className="mt-2 h-4 w-24 rounded-full bg-[#f2e7dd]" />
            </div>
            <div className="h-8 w-12 rounded-lg bg-[#d7efe0]" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded-full bg-[#efe2d7]" />
            <div className="h-4 w-24 rounded-full bg-[#efe2d7]" />
            <div className="h-4 w-4 rounded-full bg-[#f5ece4]" />
            <div className="h-4 w-20 rounded-full bg-[#f5ece4]" />
          </div>
          <div className="h-4 w-48 rounded-full bg-[#f0e1d3]" />
        </div>
      </div>
    </div>
  )
}

export default function Dining({ isTabActive = true }) {
  const navigate = useNavigate()
  const [heroSearch, setHeroSearch] = useState("")
  const [diningSearchOpen, setDiningSearchOpen] = useState(false)
  const [activeFilters, setActiveFilters] = useState(new Set())
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [activeFilterTab, setActiveFilterTab] = useState('sort')
  const [sortBy, setSortBy] = useState(null)
  const [selectedCuisine, setSelectedCuisine] = useState(null)
  const filterSectionRefs = useRef({})
  const rightContentRef = useRef(null)
  const { location } = useLocationHook()
  const { zoneId, loading: zoneLoading } = useZone(location)
  const { addFavorite, removeFavorite, isFavorite, vegMode, vegModeOption, userProfile } = useProfile()

  const initials = useMemo(() => {
    if (!userProfile) return "";
    const name = userProfile.firstName || userProfile.name || "";
    return name[0]?.toUpperCase() || "U";
  }, [userProfile]);

  const [categories, setCategories] = useState([])
  const [restaurantList, setRestaurantList] = useState([])
  const [loading, setLoading] = useState(true)
  const diningCacheKeyRef = useRef(null)
  const [diningHeroBanners, setDiningHeroBanners] = useState([])
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0)
  const autoSlideIntervalRef = useRef(null)
  const touchStartXRef = useRef(0)
  const touchStartYRef = useRef(0)
  const touchEndXRef = useRef(0)
  const touchEndYRef = useRef(0)
  const isBannerSwipingRef = useRef(false)

  const resolveLocationForDining = useCallback(() => {
    const fromHook = location || {}
    const cityFromHook = String(fromHook?.city || "").trim()
    const hasValidHookCity = cityFromHook && cityFromHook.toLowerCase() !== "current location"

    if (hasValidHookCity) {
      return fromHook
    }

    try {
      const raw = localStorage.getItem("userLocation")
      if (!raw) return fromHook
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === "object" ? { ...fromHook, ...parsed } : fromHook
    } catch {
      return fromHook
    }
  }, [location])

  useEffect(() => {
    if (!isTabActive) return undefined

    const fetchDiningData = async () => {
      try {
        const activeLocation = resolveLocationForDining()
        const lat = Number(activeLocation?.latitude)
        const lng = Number(activeLocation?.longitude)
        const cityRaw = resolveServiceCity({
          locality: activeLocation?.city || "",
          formattedAddress:
            activeLocation?.formattedAddress || activeLocation?.address || "",
          fallback: String(activeLocation?.city || "").trim(),
        })
        const city =
          cityRaw && cityRaw.toLowerCase() !== "current location" ? cityRaw : ""

        const restaurantParams = {}
        if (city) restaurantParams.city = city
        if (zoneId) restaurantParams.zoneId = zoneId
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          restaurantParams.lat = lat
          restaurantParams.lng = lng
        }

        if (!zoneId) {
          setDiningHeroBanners([])
          setCategories([])
          setRestaurantList([])
          setLoading(false)
          return
        }

        const cacheKey = buildFoodCacheKey("dining", {
          zoneId,
          city: city || "",
        })
        diningCacheKeyRef.current = cacheKey
        const cached = getFoodPageCache(cacheKey)

        if (isDiningCacheFresh(cached) && cached.restaurants) {
          setDiningHeroBanners(cached.banners || [])
          setCategories(cached.categories || [])
          setRestaurantList(cached.restaurants || [])
          setLoading(false)
          return
        }

        if (cached?.restaurants?.length) {
          setDiningHeroBanners(cached.banners || [])
          setCategories(cached.categories || [])
          setRestaurantList(cached.restaurants || [])
          setLoading(false)
        } else {
          setLoading(true)
        }

        const [bannerResponse, cats, rests] = await Promise.all([
          diningAPI.getHeroBanners().catch(() => ({ data: { success: false, data: { banners: [] } } })),
          diningAPI.getCategories(),
          diningAPI.getRestaurants(restaurantParams),
        ])

        const heroBanners = Array.isArray(bannerResponse?.data?.data?.banners)
          ? bannerResponse.data.data.banners
              .map((banner, index) => {
                const imageUrl = String(banner?.imageUrl || "").trim()
                if (!imageUrl) return null

                return {
                  id: String(banner?._id || banner?.id || `dining-banner-${index}`),
                  imageUrl,
                  tagline: String(banner?.title || banner?.tagline || "").trim(),
                  promoCode: String(banner?.ctaText || banner?.promoCode || "").trim(),
                }
              })
              .filter(Boolean)
          : []

        const nextCategories = cats?.data?.success ? (cats.data.data || []) : []
        const nextRestaurants = rests?.data?.success ? (rests.data.data || []) : []

        setDiningHeroBanners(heroBanners)
        setCategories(nextCategories)
        setRestaurantList(nextRestaurants)
        setFoodPageCache(cacheKey, {
          banners: heroBanners,
          categories: nextCategories,
          restaurants: nextRestaurants,
          ts: Date.now(),
        })
      } catch (error) {
        debugError("Failed to fetch dining data", error)
        if (!getFoodPageCache(diningCacheKeyRef.current)?.restaurants?.length) {
          setDiningHeroBanners([])
          setCategories([])
          setRestaurantList([])
        }
      } finally {
        setLoading(false)
      }
    }
    fetchDiningData()
    return undefined
  }, [resolveLocationForDining, zoneId, isTabActive])

  const safeCategories = useMemo(() => {
    return (Array.isArray(categories) ? categories : [])
      .filter((category) => {
        const categoryName = String(category?.name || "").trim()
        return categoryName.length > 0
      })
      .map((category, index) => ({
        ...category,
        name: String(category?.name || "").trim(),
        slug: String(category?.slug || category?.name || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, ""),
        imageUrl: String(category?.imageUrl || "").trim()
      }))
  }, [categories])

  const normalizedRestaurantList = useMemo(() => {
    return (Array.isArray(restaurantList) ? restaurantList : [])
      .filter((restaurant) => {
        const name = String(restaurant?.restaurantName || restaurant?.name || "").trim()
        return name.length > 0
      })
      .sort((a, b) => {
        const aEnabled = a?.diningSettings?.isEnabled === true
        const bEnabled = b?.diningSettings?.isEnabled === true
        if (aEnabled && !bEnabled) return -1
        if (!aEnabled && bEnabled) return 1
        return 0
      })
      .map((restaurant, index) => {
        const distanceKm = getDistanceKm(location, restaurant)
        const restaurantName = String(restaurant?.restaurantName || restaurant?.name || "").trim()
        return {
          ...restaurant,
          id: restaurant?._id || restaurant?.id || `restaurant-${index}`,
          name: restaurantName,
          slug: String(restaurant?.restaurantNameNormalized || "").trim() || slugifyValue(restaurantName),
          cuisine: Array.isArray(restaurant?.cuisines) && restaurant.cuisines.length > 0
            ? restaurant.cuisines.join(", ")
            : "Multi-cuisine",
          image: String(
            restaurant?.coverImages?.[0]?.url ||
            restaurant?.coverImages?.[0] ||
            restaurant?.coverImage ||
            restaurant?.menuImages?.[0]?.url ||
            restaurant?.menuImages?.[0] ||
            restaurant?.profileImage?.url ||
            restaurant?.profileImage ||
            ""
          ).trim(),
          offer: String(restaurant?.offer || "Pre-book table").trim(),
          featuredDish: String(restaurant?.featuredDish || "Chef's special").trim(),
          featuredPrice: Number(restaurant?.featuredPrice || 0),
          rating: Number(restaurant?.rating || restaurant?.avgRating || 0),
          deliveryTime: String(
            restaurant?.estimatedDeliveryTime ||
            restaurant?.deliveryTime ||
            (restaurant?.estimatedDeliveryTimeMinutes ? `${restaurant.estimatedDeliveryTimeMinutes} mins` : "30-40 mins")
          ).trim(),
          distanceValue: distanceKm,
          pureVegRestaurant:
            restaurant?.pureVegRestaurant === true ||
            restaurant?.diningSettings?.pureVegRestaurant === true,
          hasNonVegMenu:
            restaurant?.hasNonVegMenu === true
              ? true
              : restaurant?.hasNonVegMenu === false
                ? false
                : undefined,
          isPureVeg:
            restaurant?.hasNonVegMenu === true
              ? false
              : restaurant?.isPureVeg === true ||
                restaurant?.hasNonVegMenu === false,
          diningType: (() => {
            const rawType = restaurant?.diningSettings?.diningType
            let types = []
            if (Array.isArray(rawType)) {
              types = rawType
            } else if (typeof rawType === "string" && rawType.trim()) {
              types = rawType.split(",")
            } else if (restaurant?.categories && Array.isArray(restaurant.categories)) {
              types = restaurant.categories.map(c => typeof c === 'string' ? c : c.slug || c.name)
            }
            
            const uniqueTypes = Array.from(new Set(types.map(t => slugifyValue(t)).filter(Boolean)))
            return uniqueTypes[0] || "family-dining"
          })(),
          isEnabled: restaurant?.diningSettings?.isEnabled === true,
        }
      })
  }, [restaurantList, location])

  const categoryRestaurantKeys = useMemo(() => {
    const keySet = new Set()

    normalizedRestaurantList.forEach((restaurant) => {
      const rawCategories = []

      // 1. Existing categories from the platform categories mapping
      if (Array.isArray(restaurant?.categories)) {
        rawCategories.push(...restaurant.categories)
      }

      // 2. New diningType array from diningSettings
      const dSettingsType = restaurant?.diningSettings?.diningType
      if (Array.isArray(dSettingsType)) {
        rawCategories.push(...dSettingsType)
      } else if (typeof dSettingsType === "string" && dSettingsType) {
        rawCategories.push(dSettingsType)
      }

      rawCategories.forEach((category) => {
        if (!category) return

        if (typeof category === "string") {
          const normalized = slugifyValue(category)
          if (normalized) keySet.add(normalized)
          return
        }

        if (typeof category === "object") {
          const slug = slugifyValue(category?.slug || category?.name || category?.title || "")
          if (slug) keySet.add(slug)
        }
      })
    })

    return keySet
  }, [normalizedRestaurantList])

  const filteredCategories = useMemo(
    () => filterCategoriesForVegMode(safeCategories, vegMode),
    [safeCategories, vegMode],
  )

  const nearbyPopularRestaurants = useMemo(() => {
    const within10Km = normalizedRestaurantList
      .filter((restaurant) => Number.isFinite(restaurant.distanceValue) && restaurant.distanceValue <= 10)
      .sort((a, b) => a.distanceValue - b.distanceValue)

    return within10Km.length > 0 ? within10Km : normalizedRestaurantList
  }, [normalizedRestaurantList])

  const toggleFilter = (filterId) => {
    setActiveFilters(prev => {
      const newSet = new Set(prev)
      if (newSet.has(filterId)) {
        newSet.delete(filterId)
      } else {
        newSet.add(filterId)
      }
      return newSet
    })
  }

  const filteredRestaurants = useMemo(() => {
    let filtered = nearbyPopularRestaurants.filter(
      (restaurant) => restaurant?.diningSettings?.isEnabled === true,
    )

    // Pure veg / pure vegan restaurant scope
    if (vegMode && vegModeOption === "pure-vegan") {
      filtered = filtered.filter((restaurant) => {
        if (restaurant?.isPureVegan === true) return true
        if (restaurant?.isPureVegan === false) return false
        return (
          restaurant?.pureVeganRestaurant === true ||
          restaurant?.diningSettings?.pureVeganRestaurant === true
        )
      })
    } else if (vegMode && vegModeOption === "pure-veg") {
      filtered = filtered.filter((restaurant) => {
        if (restaurant?.hasNonVegMenu === true) return false
        if (restaurant?.isPureVeg === true || restaurant?.isPureVegan === true) return true
        if (restaurant?.hasNonVegMenu === false) return true
        return (
          restaurant?.pureVegRestaurant === true ||
          restaurant?.pureVeganRestaurant === true ||
          restaurant?.diningSettings?.pureVegRestaurant === true ||
          restaurant?.diningSettings?.pureVeganRestaurant === true
        )
      })
    }

    if (activeFilters.has('delivery-under-30')) {
      filtered = filtered.filter(r => {
        const timeStr = String(r.deliveryTime || '')
        const timeMatch = timeStr.match(/(\d+)/)
        return timeMatch && parseInt(timeMatch[1], 10) <= 30
      })
    }
    if (activeFilters.has('delivery-under-45')) {
      filtered = filtered.filter(r => {
        const timeStr = String(r.deliveryTime || '')
        const timeMatch = timeStr.match(/(\d+)/)
        return timeMatch && parseInt(timeMatch[1], 10) <= 45
      })
    }
    if (activeFilters.has('distance-under-1km')) {
      filtered = filtered.filter(r => (r.distanceValue || 0) <= 1.0)
    }
    if (activeFilters.has('distance-under-2km')) {
      filtered = filtered.filter(r => (r.distanceValue || 0) <= 2.0)
    }
    if (activeFilters.has('rating-35-plus')) {
      filtered = filtered.filter(r => r.rating >= 3.5)
    }
    if (activeFilters.has('rating-4-plus')) {
      filtered = filtered.filter(r => r.rating >= 4.0)
    }
    if (activeFilters.has('rating-45-plus')) {
      filtered = filtered.filter(r => r.rating >= 4.5)
    }

    // Apply cuisine filter
    if (selectedCuisine) {
      filtered = filtered.filter(r => r.cuisine.toLowerCase().includes(selectedCuisine.toLowerCase()))
    }

    // Apply search query (restaurant name only)
    if (heroSearch.trim()) {
      const q = heroSearch.trim().toLowerCase()
      filtered = filtered.filter(r =>
        String(r.name || r.restaurantName || '').toLowerCase().includes(q)
      )
    }

    // Apply sorting
    if (sortBy === 'rating-high') {
      filtered.sort((a, b) => b.rating - a.rating)
    } else if (sortBy === 'rating-low') {
      filtered.sort((a, b) => a.rating - b.rating)
    }

    return filtered
  }, [nearbyPopularRestaurants, activeFilters, selectedCuisine, sortBy, heroSearch, vegMode, vegModeOption])

  const diningSearchQuery = heroSearch.trim()
  const isDiningSearching = diningSearchQuery.length > 0
  const showPageSkeleton = (loading || zoneLoading) && !isDiningSearching
  const showDiningSearchEmpty =
    isDiningSearching && !loading && filteredRestaurants.length === 0

  useEffect(() => {
    if (!isDiningSearching) return
    window.scrollTo({ top: 0, behavior: "smooth" })
  }, [isDiningSearching, diningSearchQuery])

  useEffect(() => {
    setCurrentBannerIndex((prev) => {
      if (diningHeroBanners.length === 0) return 0
      return Math.min(prev, diningHeroBanners.length - 1)
    })
  }, [diningHeroBanners.length])

  useEffect(() => {
    if (typeof window === "undefined") return

    diningHeroBanners.forEach((banner) => {
      if (!banner?.imageUrl) return
      const img = new window.Image()
      img.src = banner.imageUrl
    })
  }, [diningHeroBanners])

  const startBannerAutoSlide = useCallback(() => {
    if (autoSlideIntervalRef.current) {
      clearInterval(autoSlideIntervalRef.current)
    }

    if (diningHeroBanners.length <= 1) return

    autoSlideIntervalRef.current = setInterval(() => {
      if (!isBannerSwipingRef.current) {
        setCurrentBannerIndex((prev) => (prev + 1) % diningHeroBanners.length)
      }
    }, 3500)
  }, [diningHeroBanners.length])

  const resetBannerAutoSlide = useCallback(() => {
    startBannerAutoSlide()
  }, [startBannerAutoSlide])

  useEffect(() => {
    startBannerAutoSlide()

    return () => {
      if (autoSlideIntervalRef.current) {
        clearInterval(autoSlideIntervalRef.current)
      }
    }
  }, [startBannerAutoSlide])

  const handleBannerTouchStart = useCallback((event) => {
    if (diningHeroBanners.length <= 1) return
    touchStartXRef.current = event.touches[0].clientX
    touchStartYRef.current = event.touches[0].clientY
    touchEndXRef.current = event.touches[0].clientX
    touchEndYRef.current = event.touches[0].clientY
    isBannerSwipingRef.current = true
  }, [diningHeroBanners.length])

  const handleBannerTouchMove = useCallback((event) => {
    if (!isBannerSwipingRef.current) return
    touchEndXRef.current = event.touches[0].clientX
    touchEndYRef.current = event.touches[0].clientY
  }, [])

  const handleBannerTouchEnd = useCallback(() => {
    if (!isBannerSwipingRef.current || diningHeroBanners.length <= 1) {
      isBannerSwipingRef.current = false
      return
    }

    const deltaX = touchEndXRef.current - touchStartXRef.current
    const deltaY = Math.abs(touchEndYRef.current - touchStartYRef.current)
    const minSwipeDistance = 40

    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaX) > deltaY) {
      setCurrentBannerIndex((prev) => {
        if (deltaX > 0) {
          return (prev - 1 + diningHeroBanners.length) % diningHeroBanners.length
        }
        return (prev + 1) % diningHeroBanners.length
      })
      resetBannerAutoSlide()
    }

    isBannerSwipingRef.current = false
  }, [diningHeroBanners.length, resetBannerAutoSlide])


  return (
    <AnimatedPage className="bg-white dark:bg-[#0a0a0a] min-h-screen relative pb-40">
      <style>{`
        @keyframes shimmer {
          100% {
            transform: translateX(200%);
          }
        }
      `}</style>
      
      {/* Premium Sticky Header - High Z-Index & Optimized Blur */}
      <div className="sticky top-0 z-[100] w-full bg-[#D91F3A] dark:bg-[#0a0a0a] md:hidden rounded-b-[2rem] border-b-2 border-white/20 antialiased">
        {/* Navbar Section - Custom Takeaway Style */}
        <div className="relative z-20 pt-3 pb-3.5 px-4">
          <div className="flex items-center justify-between">
            {/* Left: Takeaway-style heading (location only changeable from Delivery home) */}
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] font-bold text-gray-200 uppercase tracking-[0.2em] drop-shadow-md">
                Table Booking
              </span>
              <h1 className="text-xl font-bold text-white flex items-center gap-2 drop-shadow-md">
                Dining
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setDiningSearchOpen(true)}
                className={`p-2.5 backdrop-blur-md rounded-full active:scale-95 transition-all duration-200 ${diningSearchOpen ? "bg-white text-[#DC2626]" : "bg-white/10 border border-white/20"}`}
                aria-label="Search dining restaurants"
              >
                <Search className={`h-5 w-5 ${diningSearchOpen ? "text-[#DC2626]" : "text-white"}`} strokeWidth={2.5} />
              </button>
              <Link
                to="/food/user/wallet"
                state={{ from: '/food/user' }}
                onClick={(e) => {
                  if (!isModuleAuthenticated('user')) {
                    e.preventDefault();
                    window.dispatchEvent(new CustomEvent('show-login-required'));
                  }
                }}
                className="h-8 w-8 flex items-center justify-center rounded-full bg-white/10 border border-white shadow-none active:scale-90 transition-all transform-gpu translate-z-0"
              >
                <Wallet className="h-4.5 w-4.5 text-white antialiased" strokeWidth={2} />
              </Link>
              
              <Link 
                to="/food/user/profile" 
                state={{ from: "/food/user/dining" }}
                onClick={(e) => {
                  if (!isModuleAuthenticated('user')) {
                    e.preventDefault();
                    window.dispatchEvent(new CustomEvent('show-login-required'));
                  }
                }}
                className="h-9 w-9 relative flex items-center justify-center rounded-full border border-white shadow-none cursor-pointer active:scale-95 transition-all overflow-hidden transform-gpu translate-z-0"
              >
                <Avatar className="h-full w-full bg-[#FFF5E6]">
                  <AvatarImage 
                    src={userProfile?.profileImage || "/assets/images/profile_avatar.webp"} 
                    alt="Profile" 
                    className="object-cover"
                  />
                  <AvatarFallback className="bg-[#FFF5E6] text-[20px] font-black text-[#DC2626] leading-none tracking-tighter antialiased">
                    <img src="/assets/images/profile_avatar.webp" alt="Profile" className="object-cover w-full h-full" />
                  </AvatarFallback>
                </Avatar>
              </Link>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {diningSearchOpen && (
              <motion.section
                key="dining-search-bar"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{
                  height: { type: "spring", stiffness: 380, damping: 32, mass: 0.82 },
                  opacity: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                }}
                className="overflow-hidden origin-top"
                onClick={(e) => e.stopPropagation()}
              >
                <motion.div
                  initial={{ y: -8, opacity: 0, scale: 0.97 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  exit={{ y: -6, opacity: 0, scale: 0.98 }}
                  transition={{
                    type: "spring",
                    stiffness: 460,
                    damping: 30,
                    mass: 0.72,
                  }}
                  className="relative bg-gray-50 dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-gray-800 p-2 flex items-center shadow-inner group mt-3"
                >
                  <Search className="h-4 w-4 text-[#DC2626] ml-2 shrink-0" strokeWidth={2.5} />
                  <div className="flex-1 px-3">
                    <Input
                      autoFocus
                      value={heroSearch}
                      onChange={(e) => setHeroSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setHeroSearch("");
                          setDiningSearchOpen(false);
                        }
                      }}
                      className="h-6 w-full bg-transparent border-0 text-[13px] font-bold text-gray-700 dark:text-white focus-visible:ring-0 focus-visible:ring-offset-0 p-0 leading-none placeholder:text-gray-400"
                      placeholder="Search dining restaurants..."
                    />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {heroSearch && (
                      <button
                        type="button"
                        onClick={() => setHeroSearch("")}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200/90 text-gray-500 hover:bg-gray-300 hover:text-gray-700 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
                        aria-label="Clear search"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setHeroSearch("");
                        setDiningSearchOpen(false);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-[#DC2626]/10 text-[#DC2626] hover:bg-[#DC2626]/20 transition-colors"
                      aria-label="Close search"
                    >
                      <X className="h-4 w-4" strokeWidth={2.5} />
                    </button>
                  </div>
                </motion.div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Banner Section */}
      {!isDiningSearching && (
      <div
        className="relative w-full px-3 sm:px-4 md:px-6 lg:px-8 pt-5 pb-3 sm:pb-5"
      >
        {showPageSkeleton ? (
          <HeroBannerSkeleton className="h-[24vh] sm:h-[32vh] lg:h-[40vh] rounded-[22px] shadow-lg" />
        ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="relative w-full h-[24vh] sm:h-[32vh] lg:h-[40vh] rounded-[22px] overflow-hidden shadow-lg"
        >
          {diningHeroBanners.length > 0 ? (
            <div
              className="relative h-full w-full"
              onTouchStart={handleBannerTouchStart}
              onTouchMove={handleBannerTouchMove}
              onTouchEnd={handleBannerTouchEnd}
            >
              <div
                className="flex h-full w-full transition-transform duration-500 ease-out"
                style={{ transform: `translateX(-${currentBannerIndex * 100}%)` }}
              >
                {diningHeroBanners.map((banner, index) => (
                  <div key={banner.id} className="relative h-full w-full shrink-0">
                    <OptimizedImage
                      src={banner.imageUrl}
                      alt={`Dining Banner ${index + 1}`}
                      className="w-full h-full"
                      objectFit="cover"
                      priority={index === 0}
                      sizes="100vw"
                    />
                    <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5 md:p-6 lg:p-8">
                      <div className="max-w-[75%] rounded-2xl px-3 py-3 text-white sm:px-4 md:px-5">
                        {banner.promoCode && (
                          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/85 sm:text-xs">
                            {banner.promoCode}
                          </p>
                        )}
                        {banner.tagline && (
                          <h2 className="mt-2 text-lg font-bold leading-tight sm:text-2xl md:text-3xl">
                            {banner.tagline}
                          </h2>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {diningHeroBanners.length > 1 && (
                <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/25 px-3 py-1.5 backdrop-blur-sm">
                  {diningHeroBanners.map((banner, index) => (
                    <button
                      key={`${banner.id}-dot`}
                      type="button"
                      aria-label={`Go to dining banner ${index + 1}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        setCurrentBannerIndex(index)
                        resetBannerAutoSlide()
                      }}
                      className={`h-2 rounded-full transition-all duration-300 ${
                        currentBannerIndex === index ? "w-5 bg-white" : "w-2 bg-white/55"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className={`relative h-full w-full bg-[radial-gradient(circle_at_top_left,_rgba(235,89,14,0.22),_transparent_35%),linear-gradient(135deg,#fff5e8_0%,#fffdf9_55%,#ffe3cf_100%)]`}>
              <div className="absolute bottom-6 left-6 max-w-[70%]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-[#b46f37]">Dining</p>
                <h2 className="mt-2 text-2xl font-black text-[#2e1d11] sm:text-3xl">
                  Fresh dining picks near you
                </h2>
                <p className="mt-2 text-sm font-medium text-[#6d5744]">
                  Banner will appear here as soon as a dining hero banner is available.
                </p>
              </div>
            </div>
          )}
        </motion.div>
        )}
      </div>
      )}

      {/* Content */}
      <div className={`max-w-7xl mx-auto px-3 sm:px-6 md:px-8 lg:px-10 xl:px-12 ${isDiningSearching ? "pt-2" : "pt-3 sm:pt-6 md:pt-8 lg:pt-10"} pb-4 md:pb-6 lg:pb-8`}>
        {showPageSkeleton ? (
          <>
            {!isDiningSearching && (
              <div className="mb-0">
                <div className="grid grid-cols-3 gap-2.5 sm:gap-3 md:gap-4">
                  {loadingCategoryCards.map((key, index) => (
                    <DiningCategorySkeleton key={key} index={index} />
                  ))}
                </div>
              </div>
            )}

            <div className={`mb-4 ${isDiningSearching ? "mt-0" : "mt-4 sm:mt-6"}`}>
              {!isDiningSearching && <DiningSectionHeaderSkeleton />}

              <section className="mb-4 py-1">
                <div className="flex items-center gap-2 overflow-hidden pb-1">
                  {Array.from({ length: 6 }, (_, index) => (
                    <div
                      key={`filter-skeleton-${index}`}
                      className={`relative h-8 rounded-md border border-[#efe3d7] bg-[#fff7f1] ${shimmerClassName}`}
                      style={{ width: index === 0 ? 90 : index % 2 === 0 ? 122 : 108 }}
                    />
                  ))}
                </div>
              </section>

              <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 md:gap-6 lg:grid-cols-3 lg:gap-8">
                {loadingRestaurantCards.map((key, index) => (
                  <DiningRestaurantSkeleton key={key} index={index} />
                ))}
              </div>
            </div>
          </>
        ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
        {/* Categories Section */}
        {!isDiningSearching && (
        <div className="mb-0">
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3 md:gap-4">
            {filteredCategories.map((category, index) => (
              <Link
                key={category._id || category.id}
                to={`/user/dining/${category.slug}`}
              >
                <div
                  className="relative h-[114px] sm:h-[148px] md:h-[160px] overflow-hidden rounded-[22px] border border-[#ece5dc] bg-[#fdfaf8] cursor-pointer group"
                >
                  <div className="h-full flex flex-col p-2.5 sm:p-3.5">
                    <p className="font-['Poppins',_'Nunito_Sans',sans-serif] text-[12px] sm:text-[14px] md:text-[15px] font-bold leading-tight tracking-tight text-[#2d2722] mb-1">
                      {category.name}
                    </p>

                    <div className="flex-1 relative overflow-hidden rounded-xl bg-white/40">
                      {category.imageUrl ? (
                        <OptimizedImage
                          src={category.imageUrl}
                          alt={category.name}
                          className="w-full h-full transition-transform duration-500 group-hover:scale-[1.05]"
                          objectFit="contain"
                          sizes="(max-width: 640px) 31vw, (max-width: 768px) 180px, 220px"
                          placeholder="blur"
                          priority={index < 6}
                        />
                      ) : (
                        <div className={`relative h-full w-full bg-[radial-gradient(circle_at_20%_20%,rgba(235,89,14,0.15),transparent_35%),linear-gradient(180deg,#fff7ee_0%,#fff1e1_100%)] ${shimmerClassName}`}>
                          <div className="absolute inset-x-0 bottom-0 h-[60%] rounded-t-[50%] bg-white/30" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
              ))}
          </div>
        </div>
        )}

        {/* Popular Restaurants Around You Section */}
        <div className={`mb-4 ${isDiningSearching ? "mt-0" : "mt-4 sm:mt-6"}`}>
          {!showDiningSearchEmpty && (
          <div className="mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-3">
                <div className="h-8 w-1 bg-[#ef4f5f] rounded-full shadow-[0_0_10px_rgba(239,79,95,0.4)]" />
                <h3 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white tracking-tight whitespace-nowrap">
                  {isDiningSearching ? "Search Results" : "Popular Restaurants Within 10km"}
                </h3>
              </div>
              {!isDiningSearching && (
              <div className="flex items-center">
                <div className="px-3 py-1 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 rounded-full shadow-sm">
                  <p className="text-[10px] sm:text-xs font-black text-[#ef4f5f] uppercase tracking-widest">
                    {filteredRestaurants.length} NEARBY PLACES
                  </p>
                </div>
              </div>
              )}
              {isDiningSearching && filteredRestaurants.length > 0 && (
              <div className="flex items-center">
                <div className="px-3 py-1 bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/50 rounded-full shadow-sm">
                  <p className="text-[10px] sm:text-xs font-black text-[#ef4f5f] uppercase tracking-widest">
                    {filteredRestaurants.length} RESULT{filteredRestaurants.length === 1 ? "" : "S"}
                  </p>
                </div>
              </div>
              )}
            </div>
          </div>
          )}

          {!isDiningSearching ? (
            <section className="py-1 mb-4">
              <div
                className="relative z-10 flex items-center gap-1.5 sm:gap-2 overflow-x-auto overflow-y-visible scrollbar-hide py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                style={{
                  scrollbarWidth: "none",
                  msOverflowStyle: "none",
                }}
              >
                {/* Filter Button - Opens Modal */}
                <Button
                  variant="outline"
                  onClick={() => setIsFilterOpen(true)}
                  className="h-7 sm:h-8 px-2 sm:px-3 rounded-full flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 font-medium transition-all bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                >
                  <SlidersHorizontal className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="text-xs sm:text-sm font-bold text-black dark:text-white">Filters</span>
                </Button>

                {/* Filter Buttons */}
                {[
                  { id: 'delivery-under-30', label: 'Under 30 mins' },
                  { id: 'delivery-under-45', label: 'Under 45 mins' },
                  { id: 'distance-under-1km', label: 'Under 1km', icon: MapPin },
                  { id: 'distance-under-2km', label: 'Under 2km', icon: MapPin },
                  { id: 'rating-35-plus', label: '3.5+ Rating' },
                  { id: 'rating-4-plus', label: '4.0+ Rating' },
                  { id: 'rating-45-plus', label: '4.5+ Rating' },
                ].map((filter) => {
                  const Icon = filter.icon
                  const isActive = activeFilters.has(filter.id)
                  return (
                    <Button
                      key={filter.id}
                      variant="outline"
                      onClick={() => toggleFilter(filter.id)}
                      className={`h-7 sm:h-8 px-2 sm:px-3 rounded-full flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 transition-all font-medium ${isActive
                        ? 'bg-[#DC2626] text-white border border-[#DC2626] hover:bg-[#991B1B]'
                        : 'bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300'
                        }`}
                    >
                      {Icon && <Icon className={`h-3 w-3 sm:h-4 sm:w-4 ${isActive ? 'text-white fill-white' : 'text-current'}`} />}
                      <span className={`text-xs sm:text-sm font-bold ${isActive ? 'text-white' : 'text-black dark:text-white'}`}>{filter.label}</span>
                    </Button>
                  )
                })}
              </div>
            </section>
          ) : null}

          {/* Restaurant Cards */}
          {showDiningSearchEmpty ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                <Search className="h-7 w-7 text-gray-300 dark:text-gray-500" />
              </div>
              <p className="text-base font-bold text-gray-800 dark:text-gray-200">
                No dining restaurants found for &quot;{diningSearchQuery}&quot;
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5 max-w-xs">
                Search by restaurant name only
              </p>
            </div>
          ) : filteredRestaurants.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#eadfce] bg-[#fffaf4] px-6 py-12 text-center text-sm font-medium text-gray-500">
              No popular dining restaurants were found within 10 km for the current location.
            </div>
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 md:gap-6 lg:gap-8">
            {/* First 2 Restaurants */}
            {filteredRestaurants.slice(0, 2).map((restaurant, index) => {
              const restaurantSlug = restaurant.slug || encodeURIComponent(restaurant.name)
              const diningDetailPath = `/food/user/dining/${restaurant.diningType}/${restaurantSlug}`
              const favorite = isFavorite(restaurantSlug)

              const handleToggleFavorite = (e) => {
                e.preventDefault()
                e.stopPropagation()
                if (favorite) {
                  removeFavorite(restaurantSlug)
                } else {
                  addFavorite({
                    slug: restaurantSlug,
                    name: restaurant.name,
                    cuisine: restaurant.cuisine,
                    rating: restaurant.rating,
                    deliveryTime: restaurant.deliveryTime,
                    distance: restaurant.distance,
                    image: restaurant.image
                  })
                }
              }

              return (
                <motion.div
                  key={restaurant._id || restaurant.id}
                  className="h-full"
                  initial={{ opacity: 0, y: 30, scale: 0.95 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{
                    duration: 0.5,
                    delay: index * 0.1,
                    type: "spring",
                    stiffness: 100
                  }}
                  style={{ perspective: 1000 }}
                >
                  <motion.div
                    className="h-full rounded-[22px]"
                    whileHover="hover"
                    initial="rest"
                    variants={{
                      rest: {
                        y: 0,
                        scale: 1,
                        borderRadius: 22,
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
                      },
                      hover: {
                        y: -12,
                        scale: 1.02,
                        borderRadius: 22,
                        boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(34, 197, 94, 0.1)",
                        transition: {
                          type: "spring",
                          stiffness: 300,
                          damping: 20,
                          mass: 0.5
                        }
                      }
                    }}
                  >
                    <Link
                      to={diningDetailPath}
                      state={{ restaurant }}
                      className="h-full flex rounded-[22px]"
                    >
                      <Card className="overflow-hidden gap-0 space-y-0 cursor-pointer border-0 dark:border-gray-800 group bg-white dark:bg-[#1a1a1a] transition-all duration-500 py-0 rounded-[22px] h-full flex flex-col w-full relative">
                        {/* Image Section */}
                        <div className="relative h-44 sm:h-56 md:h-60 lg:h-64 xl:h-72 w-full flex-shrink-0">
                          <motion.div
                            className="absolute inset-0"
                            variants={{
                              rest: { scale: 1 },
                              hover: { scale: 1.15 }
                            }}
                            transition={{ duration: 0.6, ease: "easeOut" }}
                          >
                            {restaurant.image ? (
                              <OptimizedImage
                                src={restaurant.image}
                                alt={restaurant.name}
                                className="w-full h-full"
                                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                                objectFit="cover"
                                placeholder="blur"
                                priority={index < 3}
                              />
                            ) : (
                              <div className={`relative h-full w-full bg-[radial-gradient(circle_at_top_left,rgba(235,89,14,0.24),transparent_30%),linear-gradient(135deg,#fff5e8_0%,#fffaf4_55%,#ffe5d0_100%)] ${shimmerClassName}`} />
                            )}
                          </motion.div>

                          {/* Gradient Overlay on Hover */}
                          <motion.div
                            className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0"
                            variants={{
                              rest: { opacity: 0 },
                              hover: { opacity: 1 }
                            }}
                            transition={{ duration: 0.4 }}
                          />

                          {/* Shine Effect */}
                          <motion.div
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full"
                            variants={{
                              rest: { x: "-100%" },
                              hover: {
                                x: "200%",
                                transition: {
                                  duration: 0.8,
                                  ease: "easeInOut",
                                  delay: 0.2
                                }
                              }
                            }}
                          />

                          {/* Featured Dish Badge - Top Left */}
                          <motion.div
                            className="absolute top-3 left-3 flex items-center z-10"
                            variants={{
                              rest: { scale: 1, y: 0 },
                              hover: { scale: 1.05, y: -2 }
                            }}
                            transition={{ duration: 0.3 }}
                          >
                            {restaurant.featuredDish && restaurant.featuredDish !== "Chef's special" && restaurant.featuredPrice > 0 && (
                            <div className="bg-gray-800/90 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium shadow-lg">
                              {restaurant.featuredDish} • ₹{restaurant.featuredPrice}
                            </div>
                            )}
                          </motion.div>

                          {/* Bookmark Icon - Top Right */}
                          <motion.div
                            variants={{
                              rest: { scale: 1, rotate: 0 },
                              hover: { scale: 1.1, rotate: 5 }
                            }}
                            transition={{ duration: 0.3 }}
                            className="absolute top-3 right-3 z-10"
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 bg-white/90 dark:bg-[#1a1a1a]/90 backdrop-blur-sm rounded-lg hover:bg-white dark:hover:bg-[#2a2a2a] transition-colors"
                              onClick={handleToggleFavorite}
                            >
                              <Bookmark className={`h-5 w-5 ${favorite ? "fill-gray-800 dark:fill-gray-200 text-gray-800 dark:text-gray-200" : "text-gray-600 dark:text-gray-400"}`} strokeWidth={2} />
                            </Button>
                          </motion.div>

                          {/* Blue Section - Bottom 40% */}
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-[#DC2626] to-transparent" style={{ height: '40%' }}>
                            <div className="h-full flex flex-col justify-end">
                              <div className="pl-4 sm:pl-5 pb-4 sm:pb-5">
                                <p className="text-white text-xs sm:text-sm font-medium uppercase tracking-wide mb-1">
                                  PRE-BOOK TABLE
                                </p>
                                <div className="h-px bg-white/30 mb-2 w-24"></div>
                                <p className="text-white text-base sm:text-lg font-bold">
                                  {restaurant.offer}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Content Section */}
                        <motion.div
                          className="flex-1"
                          variants={{
                            rest: { y: 0 },
                            hover: { y: -4 }
                          }}
                          transition={{ duration: 0.4, ease: "easeOut" }}
                        >
                          <CardContent className="p-2.5 sm:p-4 pt-1.5 sm:pt-2 border-t-0">
                            {/* Restaurant Name & Rating */}
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex-1 min-w-0">
                                <motion.h3
                                  className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white line-clamp-1"
                                  variants={{
                                    rest: {},
                                    hover: { color: "#DC2626" }
                                  }}
                                  transition={{ duration: 0.3 }}
                                >
                                  {restaurant.name}
                                </motion.h3>
                              </div>
                              <motion.div
                                className="flex-shrink-0 bg-green-600 text-white px-2 py-1 rounded-lg flex items-center gap-1"
                                variants={{
                                  rest: { scale: 1, rotate: 0 },
                                  hover: { scale: 1.1, rotate: 5 }
                                }}
                                transition={{ duration: 0.3, type: "spring", stiffness: 400 }}
                              >
                                <span className="text-sm font-bold">{restaurant.rating}</span>
                                <Star className="h-3 w-3 fill-white text-white" />
                              </motion.div>
                            </div>

                            {/* Delivery Time & Distance */}
                            <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mb-2">
                              <Clock className="h-4 w-4" strokeWidth={1.5} />
                              <span className="font-medium">{restaurant.deliveryTime}</span>
                              <span className="mx-1">|</span>
                              <span className="font-medium">{restaurant.distance}</span>
                            </div>

                            {/* Dining Status Badge */}
                            <div className="flex items-center gap-2 mt-1">
                                <Badge 
                                    variant="outline" 
                                    className={`px-2 py-0 h-5 text-[10px] uppercase font-bold tracking-wider ${
                                        restaurant.isEnabled 
                                            ? "bg-green-50 text-green-700 border-green-200" 
                                            : "bg-plum-50 text-plum-700 border-plum-100"
                                    }`}
                                >
                                    {restaurant.isEnabled ? "ON" : "OFF"}
                                </Badge>
                                <span className="text-[13px] font-bold text-slate-700">Pre-book table</span>
                            </div>

                          </CardContent>
                        </motion.div>
                      </Card>
                    </Link>
                  </motion.div>
                </motion.div>
              )
            })}

            {/* Remaining Restaurants */}
            {filteredRestaurants.slice(2).map((restaurant, index) => {
              const restaurantSlug = restaurant.slug || encodeURIComponent(restaurant.name)
              const diningDetailPath = `/food/user/dining/${restaurant.diningType}/${restaurantSlug}`
              const favorite = isFavorite(restaurantSlug)

              const handleToggleFavorite = (e) => {
                e.preventDefault()
                e.stopPropagation()
                if (favorite) {
                  removeFavorite(restaurantSlug)
                } else {
                  addFavorite({
                    slug: restaurantSlug,
                    name: restaurant.name,
                    cuisine: restaurant.cuisine,
                    rating: restaurant.rating,
                    deliveryTime: restaurant.deliveryTime,
                    distance: restaurant.distance,
                    image: restaurant.image
                  })
                }
              }

              return (
                <motion.div
                  key={restaurant._id || restaurant.id}
                  className="h-full"
                  initial={{ opacity: 0, y: 30, scale: 0.95 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{
                    duration: 0.5,
                    delay: (index + 2) * 0.1,
                    type: "spring",
                    stiffness: 100
                  }}
                  style={{ perspective: 1000 }}
                >
                  <motion.div
                    className="h-full rounded-[22px]"
                    whileHover="hover"
                    initial="rest"
                    variants={{
                      rest: {
                        y: 0,
                        scale: 1,
                        borderRadius: 22,
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
                      },
                      hover: {
                        y: -12,
                        scale: 1.02,
                        borderRadius: 22,
                        boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(34, 197, 94, 0.1)",
                        transition: {
                          type: "spring",
                          stiffness: 300,
                          damping: 20,
                          mass: 0.5
                        }
                      }
                    }}
                  >
                    <Link
                      to={diningDetailPath}
                      state={{ restaurant }}
                      className="h-full flex rounded-[22px]"
                    >
                      <Card className="overflow-hidden gap-0 space-y-0 cursor-pointer border-0 dark:border-gray-800 group bg-white dark:bg-[#1a1a1a] transition-all duration-500 py-0 rounded-[22px] h-full flex flex-col w-full relative">
                        {/* Image Section */}
                        <div className="relative h-44 sm:h-56 md:h-60 lg:h-64 xl:h-72 w-full flex-shrink-0">
                          <motion.div
                            className="absolute inset-0"
                            variants={{
                              rest: { scale: 1 },
                              hover: { scale: 1.15 }
                            }}
                            transition={{ duration: 0.6, ease: "easeOut" }}
                          >
                            {restaurant.image ? (
                              <OptimizedImage
                                src={restaurant.image}
                                alt={restaurant.name}
                                className="w-full h-full"
                                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                                objectFit="cover"
                                placeholder="blur"
                              />
                            ) : (
                              <div className={`relative h-full w-full bg-[radial-gradient(circle_at_top_left,rgba(235,89,14,0.24),transparent_30%),linear-gradient(135deg,#fff5e8_0%,#fffaf4_55%,#ffe5d0_100%)] ${shimmerClassName}`} />
                            )}
                          </motion.div>

                          {/* Gradient Overlay on Hover */}
                          <motion.div
                            className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0"
                            variants={{
                              rest: { opacity: 0 },
                              hover: { opacity: 1 }
                            }}
                            transition={{ duration: 0.4 }}
                          />

                          {/* Shine Effect */}
                          <motion.div
                            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full"
                            variants={{
                              rest: { x: "-100%" },
                              hover: {
                                x: "200%",
                                transition: {
                                  duration: 0.8,
                                  ease: "easeInOut",
                                  delay: 0.2
                                }
                              }
                            }}
                          />

                          {/* Featured Dish Badge - Top Left */}
                          {restaurant.featuredDish && restaurant.featuredDish !== "Chef's special" && restaurant.featuredPrice > 0 && (
                          <div className="absolute top-3 left-3">
                            <div className="bg-gray-800/80 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium">
                              {restaurant.featuredDish} • ₹{restaurant.featuredPrice}
                            </div>
                          </div>
                          )}

                          {/* Bookmark Icon - Top Right */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-3 right-3 h-9 w-9 bg-white/90 dark:bg-[#1a1a1a]/90 backdrop-blur-sm rounded-lg hover:bg-white dark:hover:bg-[#2a2a2a] transition-colors"
                            onClick={handleToggleFavorite}
                          >
                            <Bookmark className={`h-5 w-5 ${favorite ? "fill-gray-800 dark:fill-gray-200 text-gray-800 dark:text-gray-200" : "text-gray-600 dark:text-gray-400"}`} strokeWidth={2} />
                          </Button>

                          {/* Blue Section - Bottom 40% */}
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-[#DC2626] to-transparent" style={{ height: '40%' }}>
                            <div className="h-full flex flex-col justify-end">
                              <div className="pl-4 sm:pl-5 pb-4 sm:pb-5">
                                <p className="text-white text-xs sm:text-sm font-medium uppercase tracking-wide mb-1">
                                  PRE-BOOK TABLE
                                </p>
                                <div className="h-px bg-white/30 mb-2 w-24"></div>
                                <p className="text-white text-base sm:text-lg font-bold">
                                  {restaurant.offer}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Content Section */}
                        <motion.div
                          className="flex-1"
                          variants={{
                            rest: { y: 0 },
                            hover: { y: -4 }
                          }}
                          transition={{ duration: 0.4, ease: "easeOut" }}
                        >
                          <CardContent className="p-2.5 sm:p-4 pt-1.5 sm:pt-2 border-t-0">
                            {/* Restaurant Name & Rating Badge */}
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white line-clamp-1">
                                {restaurant.name}
                              </h3>
                              <div className="flex-shrink-0 bg-[#267e3e] text-white px-2 py-1 rounded-lg flex items-center gap-1 shadow-sm">
                                <span className="text-sm font-bold leading-none">{restaurant.rating || "0"}</span>
                                <Star className="h-3 w-3 fill-white text-white" />
                              </div>
                            </div>

                            {/* Meta Info Row (Time | Distance) */}
                            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-500 dark:text-gray-400 mb-2.5">
                              <div className="flex items-center gap-1">
                                <Clock className="h-4 w-4 text-gray-400" strokeWidth={2} />
                                <span>{restaurant.deliveryTime}</span>
                              </div>
                              <span className="mx-0.5 text-gray-300">|</span>
                              <div className="flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5 text-gray-400" strokeWidth={2} />
                                <span>{restaurant.distance || "Distance unavailable"}</span>
                              </div>
                            </div>

                            {/* Pre-book Table Promo (If applicable) */}
                            <div className="flex items-center gap-2">
                              <Badge 
                                    variant="outline" 
                                    className={`px-2 py-0 h-5 text-[10px] uppercase font-bold tracking-wider ${
                                        restaurant.isEnabled 
                                            ? "bg-green-50 text-green-700 border-green-200" 
                                            : "bg-plum-50 text-plum-700 border-plum-100"
                                    }`}
                                >
                                    {restaurant.isEnabled ? "ON" : "OFF"}
                                </Badge>
                              <span className="text-sm font-bold text-gray-600 dark:text-gray-400">Pre-book table</span>
                            </div>
                          </CardContent>
                        </motion.div>
                      </Card>
                    </Link>
                  </motion.div>
                </motion.div>
              )
            })}
          </div>
          )}
        </div>
        </motion.div>
        )}
      </div>

      {/* Filter Modal */}
      {isFilterOpen && (
        <div className="fixed inset-0 z-[100]" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setIsFilterOpen(false)}
          />

          {/* Modal Content */}
          <div className="absolute bottom-0 left-0 right-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:max-w-4xl bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl max-h-[85vh] md:max-h-[90vh] flex flex-col animate-[slideUp_0.3s_ease-out]">
            {/* Header */}
            <div className="flex items-center justify-between px-4 md:px-6 py-4 md:py-5 border-b dark:border-gray-800">
              <h2 className="text-lg md:text-xl font-bold text-gray-900 dark:text-white">Filters and sorting</h2>
              <button
                onClick={() => {
                  setActiveFilters(new Set())
                  setSortBy(null)
                  setSelectedCuisine(null)
                }}
                className="text-[#DC2626] font-medium text-sm md:text-base"
              >
                Clear all
              </button>
            </div>

            {/* Body */}
            <div className="flex flex-1 overflow-hidden">
              {/* Left Sidebar - Tabs */}
              <div className="w-24 sm:w-28 md:w-32 bg-gray-50 dark:bg-[#0a0a0a] border-r dark:border-gray-800 flex flex-col">
                {[
                  { id: 'sort', label: 'Sort By', icon: ArrowDownUp },
                  { id: 'time', label: 'Time', icon: Timer },
                  { id: 'rating', label: 'Rating', icon: Star },
                  { id: 'distance', label: 'Distance', icon: MapPin },
                  { id: 'price', label: 'Dish Price', icon: IndianRupee },
                  { id: 'cuisine', label: 'Cuisine', icon: UtensilsCrossed },
                ].map((tab) => {
                  const Icon = tab.icon
                  const isActive = activeFilterTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveFilterTab(tab.id)}
                      className={`flex flex-col items-center gap-1 py-4 px-2 text-center relative transition-colors ${isActive ? 'bg-white dark:bg-[#1a1a1a] text-[#DC2626]' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#DC2626] rounded-r" />
                      )}
                      <Icon className="h-5 w-5 md:h-6 md:w-6" strokeWidth={1.5} />
                      <span className="text-xs md:text-sm font-medium leading-tight">{tab.label}</span>
                    </button>
                  )
                })}
              </div>

              {/* Right Content Area - Scrollable */}
              <div ref={rightContentRef} className="flex-1 overflow-y-auto p-4 md:p-6">
                {/* Sort By Tab */}
                {activeFilterTab === 'sort' && (
                  <div className="space-y-4 mb-8">
                    <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-4">Sort by</h3>
                    <div className="flex flex-col gap-3 md:gap-4">
                      {[
                        { id: null, label: 'Relevance' },
                        { id: 'rating-high', label: 'Rating: High to Low' },
                        { id: 'rating-low', label: 'Rating: Low to High' },
                      ].map((option) => (
                        <button
                          key={option.id || 'relevance'}
                          onClick={() => setSortBy(option.id)}
                          className={`px-4 md:px-5 py-3 md:py-4 rounded-xl border text-left transition-colors ${sortBy === option.id
                            ? 'border-[#DC2626] bg-[#F9F9FB] dark:bg-[#DC2626]/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-[#DC2626]'
                            }`}
                        >
                          <span className={`text-sm md:text-base font-medium ${sortBy === option.id ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>
                            {option.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Time Tab */}
                {activeFilterTab === 'time' && (
                  <div className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Estimated Time</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter('delivery-under-30')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has('delivery-under-30')
                          ? 'border-[#DC2626] bg-[#F9F9FB] dark:bg-[#DC2626]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#DC2626]'
                          }`}
                      >
                        <Timer className={`h-6 w-6 ${activeFilters.has('delivery-under-30') ? 'text-[#DC2626]' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                        <span className={`text-sm font-medium ${activeFilters.has('delivery-under-30') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Under 30 mins</span>
                      </button>
                      <button
                        onClick={() => toggleFilter('delivery-under-45')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has('delivery-under-45')
                          ? 'border-[#DC2626] bg-[#F9F9FB] dark:bg-[#DC2626]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#DC2626]'
                          }`}
                      >
                        <Timer className={`h-6 w-6 ${activeFilters.has('delivery-under-45') ? 'text-[#DC2626]' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                        <span className={`text-sm font-medium ${activeFilters.has('delivery-under-45') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Under 45 mins</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Rating Tab */}
                {activeFilterTab === 'rating' && (
                  <div className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Restaurant Rating</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter('rating-35-plus')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has('rating-35-plus')
                          ? 'border-[#DC2626] bg-[#F9F9FB] dark:bg-[#DC2626]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#DC2626]'
                          }`}
                      >
                        <Star className={`h-6 w-6 ${activeFilters.has('rating-35-plus') ? 'text-[#DC2626] fill-[#DC2626]' : 'text-gray-400 dark:text-gray-500'}`} />
                        <span className={`text-sm font-medium ${activeFilters.has('rating-35-plus') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Rated 3.5+</span>
                      </button>
                      <button
                        onClick={() => toggleFilter('rating-4-plus')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has('rating-4-plus')
                          ? 'border-[#DC2626] bg-[#F9F9FB] dark:bg-[#DC2626]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#DC2626]'
                          }`}
                      >
                        <Star className={`h-6 w-6 ${activeFilters.has('rating-4-plus') ? 'text-[#DC2626] fill-[#DC2626]' : 'text-gray-400 dark:text-gray-500'}`} />
                        <span className={`text-sm font-medium ${activeFilters.has('rating-4-plus') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Rated 4.0+</span>
                      </button>
                      <button
                        onClick={() => toggleFilter('rating-45-plus')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has('rating-45-plus')
                          ? 'border-[#DC2626] bg-[#F9F9FB] dark:bg-[#DC2626]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#DC2626]'
                          }`}
                      >
                        <Star className={`h-6 w-6 ${activeFilters.has('rating-45-plus') ? 'text-[#DC2626] fill-[#DC2626]' : 'text-gray-400 dark:text-gray-500'}`} />
                        <span className={`text-sm font-medium ${activeFilters.has('rating-45-plus') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Rated 4.5+</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Distance Tab */}
                {activeFilterTab === 'distance' && (
                  <div className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Distance</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter('distance-under-1km')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has('distance-under-1km')
                          ? 'border-[#DC2626] bg-[#F9F9FB] dark:bg-[#DC2626]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#DC2626]'
                          }`}
                      >
                        <MapPin className={`h-6 w-6 ${activeFilters.has('distance-under-1km') ? 'text-[#DC2626]' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                        <span className={`text-sm font-medium ${activeFilters.has('distance-under-1km') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Under 1 km</span>
                      </button>
                      <button
                        onClick={() => toggleFilter('distance-under-2km')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has('distance-under-2km')
                          ? 'border-[#DC2626] bg-[#F9F9FB] dark:bg-[#DC2626]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#DC2626]'
                          }`}
                      >
                        <MapPin className={`h-6 w-6 ${activeFilters.has('distance-under-2km') ? 'text-[#DC2626]' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                        <span className={`text-sm font-medium ${activeFilters.has('distance-under-2km') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Under 2 km</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Price Tab */}
                {activeFilterTab === 'price' && (
                  <div className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Dish Price</h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter('price-under-200')}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has('price-under-200')
                          ? 'border-[#DC2626] bg-[#DC2626]/10 dark:bg-[#DC2626]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#DC2626]'
                          }`}
                      >
                        <span className={`text-sm font-medium ${activeFilters.has('price-under-200') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Under ₹200</span>
                      </button>
                      <button
                        onClick={() => toggleFilter('price-under-500')}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has('price-under-500')
                          ? 'border-[#DC2626] bg-[#DC2626]/10 dark:bg-[#DC2626]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#DC2626]'
                          }`}
                      >
                        <span className={`text-sm font-medium ${activeFilters.has('price-under-500') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Under ₹500</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Cuisine Tab */}
                {activeFilterTab === 'cuisine' && (
                  <div className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Cuisine</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {(vegMode
                        ? ['Continental', 'Italian', 'Asian', 'Indian', 'Chinese', 'American', 'Cafe']
                        : ['Continental', 'Italian', 'Asian', 'Indian', 'Chinese', 'American', 'Seafood', 'Cafe']
                      ).map((cuisine) => (
                        <button
                          key={cuisine}
                          onClick={() => setSelectedCuisine(selectedCuisine === cuisine ? null : cuisine)}
                          className={`px-4 py-3 rounded-xl border text-center transition-colors ${selectedCuisine === cuisine
                            ? 'border-[#DC2626] bg-[#F9F9FB] dark:bg-[#DC2626]/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-[#DC2626]'
                            }`}
                        >
                          <span className={`text-sm font-medium ${selectedCuisine === cuisine ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>
                            {cuisine}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-4 md:gap-6 px-4 md:px-6 py-4 md:py-5 border-t dark:border-gray-800 bg-white dark:bg-[#1a1a1a]">
              <button
                onClick={() => setIsFilterOpen(false)}
                className="flex-1 py-3 md:py-4 text-center font-semibold text-gray-700 dark:text-gray-300 text-sm md:text-base"
              >
                Close
              </button>
              <button
                onClick={() => setIsFilterOpen(false)}
                className={`flex-1 py-3 md:py-4 font-semibold rounded-xl transition-colors text-sm md:text-base ${activeFilters.size > 0 || sortBy || selectedCuisine
                  ? 'bg-[#DC2626] text-white hover:bg-[#991B1B]'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  }`}
              >
                {activeFilters.size > 0 || sortBy || selectedCuisine
                  ? `Show ${filteredRestaurants.length} results`
                  : 'Show results'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AnimatedPage>
  )
}


