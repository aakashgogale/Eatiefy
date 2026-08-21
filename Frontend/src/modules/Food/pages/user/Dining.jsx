import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion } from "framer-motion"
import { ArrowLeft, MapPin, Search, Mic, SlidersHorizontal, Star, X, ArrowDownUp, Timer, IndianRupee, Clock, Bookmark, UtensilsCrossed, ChevronDown, Bell, ShoppingCart, Wallet, User, Calendar, Sparkles } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { Card, CardContent } from "@food/components/ui/card"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { useSearchOverlay, useLocationSelector } from "@food/components/user/UserLayout"
import { useLocation as useLocationHook } from "@food/hooks/useLocation"
import { useProfile } from "@food/context/ProfileContext"
import { useCart } from "@food/context/CartContext"
import { diningAPI } from "@food/api"
import { resolveMediaUrl } from "@food/utils/common"
import PageNavbar from "@food/components/user/PageNavbar"
import OptimizedImage from "@food/components/OptimizedImage"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

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

function DiningCategorySkeleton({ index }) {
  return (
    <motion.div
      className={`relative h-[138px] overflow-hidden rounded-[18px] border border-[#e9e1d8] bg-[linear-gradient(180deg,#fff9f2_0%,#fff2e6_100%)] shadow-[0_1px_2px_rgba(35,24,12,0.05)] sm:h-[154px] md:h-[166px] ${shimmerClassName}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04 }}
    >
      <div className="absolute inset-x-0 top-0 z-10 px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="h-3 w-16 rounded-full bg-[#f0dcca]" />
        <div className="mt-3 h-4 w-24 rounded-full bg-[#ead2bc]" />
        <div className="mt-2 h-4 w-20 rounded-full bg-[#f3e3d4]" />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[64%] rounded-b-[18px] bg-[radial-gradient(circle_at_25%_20%,rgba(235,89,14,0.2),transparent_30%),linear-gradient(180deg,#fff0e0_0%,#ffe5ca_100%)]">
        <div className="absolute bottom-3 left-3 h-14 w-14 rounded-full bg-white/45 blur-md" />
      </div>
    </motion.div>
  )
}

function DiningRestaurantSkeleton({ index }) {
  return (
    <motion.div
      className="h-full"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06 }}
    >
      <div className="h-full overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-[#efe2d3]">
        <div className={`relative h-48 overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(235,89,14,0.24),transparent_28%),linear-gradient(135deg,#fff4e8_0%,#ffe9d5_100%)] sm:h-56 md:h-60 lg:h-64 xl:h-72 ${shimmerClassName}`}>
          <div className="absolute left-4 top-4 h-8 w-28 rounded-lg bg-black/10" />
          <div className="absolute right-4 top-4 h-9 w-9 rounded-lg bg-white/60" />
          <div className="absolute bottom-0 left-0 right-0 h-[40%] bg-gradient-to-r from-[#EB590E] to-transparent/20">
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
    </motion.div>
  )
}

export default function Dining() {
  const navigate = useNavigate()
  const { getCartCount } = useCart()
  const cartCount = getCartCount()
  const [heroSearch, setHeroSearch] = useState("")
  const [activeFilters, setActiveFilters] = useState(new Set())
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [activeFilterTab, setActiveFilterTab] = useState('sort')
  const [sortBy, setSortBy] = useState(null)
  const [selectedCuisine, setSelectedCuisine] = useState(null)
  const filterSectionRefs = useRef({})
  const rightContentRef = useRef(null)
  const { openSearch, closeSearch, setSearchValue } = useSearchOverlay()
  const { openLocationSelector } = useLocationSelector()
  const { location } = useLocationHook()
  const { addFavorite, removeFavorite, isFavorite } = useProfile()

  const [categories, setCategories] = useState([])
  const [restaurantList, setRestaurantList] = useState([])
  const [loading, setLoading] = useState(true)
  const [diningHeroBanners, setDiningHeroBanners] = useState([])
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0)
  const autoSlideIntervalRef = useRef(null)
  const touchStartXRef = useRef(0)
  const touchStartYRef = useRef(0)
  const touchEndXRef = useRef(0)
  const touchEndYRef = useRef(0)
  const isBannerSwipingRef = useRef(false)
  const { getDefaultAddress } = useProfile()

  const formatSavedAddress = useCallback((address) => {
    if (!address) return "";
    if (address.formattedAddress && address.formattedAddress !== "Select location") {
      return address.formattedAddress;
    }
    const parts = [];
    if (address.additionalDetails) parts.push(address.additionalDetails);
    if (address.street) parts.push(address.street);
    if (address.city) parts.push(address.city);
    if (parts.length > 0) return parts.join(", ");
    if (address.address && address.address !== "Select location") return address.address;
    return "";
  }, []);

  const savedAddressText = useMemo(() => {
    const defaultAddress = getDefaultAddress?.();
    return formatSavedAddress(defaultAddress);
  }, [getDefaultAddress, formatSavedAddress]);

  const displayLocation = savedAddressText || (location?.area && location?.city 
    ? `${location.area}, ${location.city}` 
    : location?.area || location?.city || "Select Location");

  useEffect(() => {
    const fetchDiningData = async () => {
      try {
        setLoading(true)
        const [bannerResponse, cats, rests] = await Promise.all([
          diningAPI.getHeroBanners().catch(() => ({ data: { success: false, data: { banners: [] } } })),
          diningAPI.getCategories(),
          diningAPI.getRestaurants(location?.city ? { city: location.city } : {}),
        ])

        const heroBanners = Array.isArray(bannerResponse?.data?.data?.banners)
          ? bannerResponse.data.data.banners
              .filter(b => b && b.isActive !== false)
              .map((banner, index) => {
                const rawUrl = String(banner?.imageUrl || banner?.image || "").trim()
                if (!rawUrl) return null
                const imageUrl = resolveMediaUrl(rawUrl)

                return {
                  id: String(banner?._id || banner?.id || `dining-banner-${index}`),
                  imageUrl,
                  tagline: String(banner?.title || banner?.tagline || "").trim(),
                  promoCode: String(banner?.ctaText || banner?.promoCode || "").trim(),
                  ctaLink: String(banner?.ctaLink || banner?.link || "").trim(),
                  ctaText: String(banner?.ctaButtonText || "Reserve Table").trim(),
                  isVideo: Boolean(rawUrl.match(/\.(mp4|webm|mov|m4v|avi)(\?.*)?$/i) || banner?.mediaType === 'video'),
                }
              })
              .filter(Boolean)
          : []

        setDiningHeroBanners(heroBanners)
        setCategories(cats?.data?.success ? (cats.data.data || []) : [])
        setRestaurantList(rests?.data?.success ? (rests.data.data || []) : [])
      } catch (error) {
        debugError("Failed to fetch dining data", error)
        setDiningHeroBanners([])
        setCategories([])
        setRestaurantList([])
      } finally {
        setLoading(false)
      }
    }
    fetchDiningData()
  }, [location?.city])

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
      .filter((restaurant) => String(restaurant?.restaurantName || restaurant?.name || "").trim().length > 0)
      .map((restaurant, index) => {
        const distanceKm = getDistanceKm(location, restaurant)
        const restaurantName = String(restaurant?.restaurantName || restaurant?.name || "").trim()
        const rawImage = String(
          restaurant?.diningSettings?.coverImage ||
          restaurant?.coverImages?.[0]?.url ||
          restaurant?.coverImages?.[0] ||
          restaurant?.coverImage ||
          restaurant?.profileImage?.url ||
          restaurant?.profileImage ||
          ""
        ).trim()
        const image = rawImage ? resolveMediaUrl(rawImage) : ""
        const rawRating = Number(restaurant?.rating || restaurant?.avgRating || restaurant?.averageRating || 4.2)
        const displayRating = Number.isFinite(rawRating) && rawRating > 0 ? (rawRating > 5 ? (rawRating / 20).toFixed(1) : rawRating.toFixed(1)) : "4.2"
        const area = restaurant?.location?.area || restaurant?.address?.area || restaurant?.address?.formattedAddress?.split(',')?.[0] || "Nearby"

        return {
          ...restaurant,
          id: restaurant?._id || restaurant?.id || `restaurant-${index}`,
          name: restaurantName,
          slug: String(restaurant?.restaurantNameNormalized || "").trim() || slugifyValue(restaurantName),
          cuisine: Array.isArray(restaurant?.cuisines) && restaurant.cuisines.length > 0
            ? restaurant.cuisines.join(", ")
            : (restaurant?.cuisine || "Multi-cuisine, North Indian"),
          image,
          offer: String(restaurant?.offer || restaurant?.discountText || "").trim(),
          rating: displayRating,
          area,
          deliveryTime: String(
            restaurant?.estimatedDeliveryTime ||
            restaurant?.deliveryTime ||
            (restaurant?.estimatedDeliveryTimeMinutes ? `${restaurant.estimatedDeliveryTimeMinutes} mins` : "25-30 mins")
          ).trim(),
          distanceValue: distanceKm,
          distance: Number.isFinite(distanceKm) ? `${distanceKm.toFixed(1)} km` : "1.2 km",
          diningType: restaurant?.diningSettings?.diningType || restaurant?.categories?.[0]?.slug || "dining",
        }
      })
  }, [restaurantList, location])

  const categoryRestaurantKeys = useMemo(() => {
    const keySet = new Set()

    normalizedRestaurantList.forEach((restaurant) => {
      const rawCategories = []

      if (Array.isArray(restaurant?.categories)) {
        rawCategories.push(...restaurant.categories)
      }

      if (restaurant?.diningSettings?.diningType) {
        rawCategories.push(restaurant.diningSettings.diningType)
      }

      rawCategories.forEach((category) => {
        if (typeof category === "string") {
          const normalized = slugifyValue(category)
          if (normalized) keySet.add(normalized)
          return
        }

        if (category && typeof category === "object") {
          const slug = slugifyValue(category?.slug || category?.name || category?.title || "")
          if (slug) keySet.add(slug)
        }
      })
    })

    return keySet
  }, [normalizedRestaurantList])

  const filteredCategories = useMemo(() => {
    return safeCategories.filter((category) => categoryRestaurantKeys.has(category.slug))
  }, [safeCategories, categoryRestaurantKeys])

  const nearbyPopularRestaurants = useMemo(() => {
    const sorted = [...normalizedRestaurantList].sort((a, b) => {
      if (Number.isFinite(a.distanceValue) && Number.isFinite(b.distanceValue)) {
        return a.distanceValue - b.distanceValue
      }
      return parseFloat(b.rating || 0) - parseFloat(a.rating || 0)
    })
    return sorted
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
    let filtered = [...nearbyPopularRestaurants]

    if (activeFilters.has('delivery-under-30')) {
      filtered = filtered.filter(r => {
        const timeMatch = r.deliveryTime.match(/(\d+)/)
        return timeMatch && parseInt(timeMatch[1]) <= 30
      })
    }
    if (activeFilters.has('delivery-under-45')) {
      filtered = filtered.filter(r => {
        const timeMatch = r.deliveryTime.match(/(\d+)/)
        return timeMatch && parseInt(timeMatch[1]) <= 45
      })
    }
    if (activeFilters.has('distance-under-1km')) {
      filtered = filtered.filter(r => {
        const distMatch = r.distance.match(/(\d+\.?\d*)/)
        return distMatch && parseFloat(distMatch[1]) <= 1.0
      })
    }
    if (activeFilters.has('distance-under-2km')) {
      filtered = filtered.filter(r => {
        const distMatch = r.distance.match(/(\d+\.?\d*)/)
        return distMatch && parseFloat(distMatch[1]) <= 2.0
      })
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

    // Apply sorting
    if (sortBy === 'rating-high') {
      filtered.sort((a, b) => b.rating - a.rating)
    } else if (sortBy === 'rating-low') {
      filtered.sort((a, b) => a.rating - b.rating)
    }

    return filtered
  }, [nearbyPopularRestaurants, activeFilters, selectedCuisine, sortBy])

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
      if (!isBannerSwipingRef.current && (typeof document === "undefined" || !document.hidden)) {
        setCurrentBannerIndex((prev) => (prev + 1) % diningHeroBanners.length)
      }
    }, 3500)
  }, [diningHeroBanners.length])

  const resetBannerAutoSlide = useCallback(() => {
    startBannerAutoSlide()
  }, [startBannerAutoSlide])

  useEffect(() => {
    startBannerAutoSlide()
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        startBannerAutoSlide()
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      if (autoSlideIntervalRef.current) {
        clearInterval(autoSlideIntervalRef.current)
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange)
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


  const handleSearchFocus = useCallback(() => {
    if (heroSearch) {
      setSearchValue(heroSearch)
    }
    openSearch()
  }, [heroSearch, openSearch, setSearchValue])

  if (loading) {
    return (
      <div className="min-h-[85vh] flex flex-col items-center justify-center p-6 bg-[#fcfaf7] dark:bg-[#0c0c0c]">
        <div className="relative flex flex-col items-center">
          {/* Glowing Ring with Utensils Icon */}
          <div className="relative w-20 h-20 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-orange-100 dark:border-orange-950/40" />
            <div className="absolute inset-0 rounded-full border-4 border-[#EB590E] border-t-transparent animate-spin" />
            <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#EB590E] to-[#FF8C38] flex items-center justify-center text-white shadow-lg shadow-orange-500/30">
              <UtensilsCrossed className="w-6 h-6 animate-pulse" />
            </div>
          </div>

          <div className="mt-5 text-center">
            <p className="text-base font-black text-slate-900 dark:text-white tracking-tight">
              Eatiefy Dining
            </p>
            <p className="text-xs font-semibold text-slate-400 mt-1">
              Loading restaurants & table reservations...
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <AnimatedPage className="bg-[#fcfaf7] dark:bg-[#0c0c0c] pb-[140px] overflow-visible min-h-screen">
      <style>{`
        @keyframes shimmer {
          100% {
            transform: translateX(200%);
          }
        }
      `}</style>

      {/* 1. TOP CURVED APP BAR (Clean Vibrant Eatiefy Signature Gradient) */}
      <div 
        style={{
          background: "linear-gradient(135deg, #EB590E 0%, #FF6F1E 50%, #DF4A00 100%)",
          boxShadow: "0 10px 28px -4px rgba(235, 89, 14, 0.35)"
        }}
        className="relative w-full text-white pt-3 pb-6 px-4 sm:px-6 md:px-8 rounded-b-[28px] sm:rounded-b-[36px]"
      >
        {/* Top bar with back/location on left and actions on right */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-[0.24em] text-white/90">
              TABLE BOOKING
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-none mt-0.5">
              Dining
            </h1>
          </div>

          {/* Right Action Icons (Search, Bookings, Profile) */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            <button
              onClick={openSearch}
              className="flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/25 transition-all active:scale-95 shadow-sm text-white"
              title="Search Dining"
            >
              <Search className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2.5} />
            </button>

            <Link
              to="/food/user/bookings"
              className="flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/25 transition-all active:scale-95 shadow-sm text-white"
              title="My Table Bookings"
            >
              <Calendar className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2.2} />
            </Link>

            <Link
              to="/food/user/profile"
              className="flex items-center justify-center h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/25 transition-all active:scale-95 shadow-sm text-white"
              title="Profile"
            >
              <User className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={2.2} />
            </Link>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 pt-4 sm:pt-6 space-y-6 sm:space-y-8">

        {/* 2. HERO PROMO BANNER (Full Clean Banner when uploaded by Admin, or Premium Eatiefy Brand Banner) */}
        {(() => {
          if (diningHeroBanners.length > 0) {
            const currentBanner = diningHeroBanners[currentBannerIndex] || diningHeroBanners[0];
            return (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                onTouchStart={handleBannerTouchStart}
                onTouchMove={handleBannerTouchMove}
                onTouchEnd={handleBannerTouchEnd}
                onClick={() => {
                  if (currentBanner?.ctaLink) {
                    if (currentBanner.ctaLink.startsWith("http")) {
                      window.open(currentBanner.ctaLink, "_blank", "noopener,noreferrer");
                    } else {
                      navigate(currentBanner.ctaLink);
                    }
                  } else {
                    const targetEl = document.getElementById("popular-restaurants-section");
                    if (targetEl) {
                      targetEl.scrollIntoView({ behavior: "smooth" });
                    } else {
                      navigate("/food/user/dining/restaurants");
                    }
                  }
                }}
                className="relative w-full rounded-[20px] sm:rounded-[28px] overflow-hidden shadow-[0_8px_25px_rgba(235,89,14,0.15)] cursor-pointer group bg-slate-100 dark:bg-zinc-900 border border-orange-200/40 aspect-[2.1/1] sm:aspect-[2.4/1]"
              >
                <img
                  src={currentBanner.imageUrl}
                  alt={currentBanner.tagline || "Dining Banner"}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=900&h=600&fit=crop";
                  }}
                />

                {/* Multi-slide Indicators if more than 1 banner exists */}
                {diningHeroBanners.length > 1 && (
                  <div className="absolute bottom-3 right-4 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-md">
                    {diningHeroBanners.map((_, idx) => (
                      <button
                        key={idx}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentBannerIndex(idx);
                          resetBannerAutoSlide();
                        }}
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          idx === currentBannerIndex ? "w-5 bg-white" : "w-1.5 bg-white/50"
                        }`}
                        aria-label={`Slide ${idx + 1}`}
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            );
          }

          // Premium Eatiefy Signature Brand Banner
          return (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              style={{
                background: "linear-gradient(135deg, #EB590E 0%, #FF6F1E 60%, #E04D00 100%)",
                boxShadow: "0 12px 32px rgba(235, 89, 14, 0.22)"
              }}
              className="relative w-full rounded-[24px] sm:rounded-[32px] overflow-hidden text-white flex flex-col md:flex-row items-stretch border border-orange-400/30"
            >
              <div className="p-6 sm:p-8 md:p-10 flex flex-col justify-center flex-1 z-10">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-white text-[11px] sm:text-xs font-black uppercase tracking-wider w-max mb-3">
                  <Sparkles className="w-3.5 h-3.5" /> Instant Table Confirmation
                </div>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-white tracking-tight leading-tight">
                  Eatiefy Dining
                </h2>
                <p className="mt-2 text-xs sm:text-sm md:text-base text-orange-100 font-medium leading-relaxed max-w-md">
                  Discover exquisite restaurant ambience, reserve premium dining tables, and enjoy exclusive dining offers.
                </p>
                <div className="mt-5">
                  <button
                    onClick={() => {
                      const targetEl = document.getElementById("popular-restaurants-section");
                      if (targetEl) {
                        targetEl.scrollIntoView({ behavior: "smooth" });
                      } else {
                        navigate("/food/user/dining/restaurants");
                      }
                    }}
                    className="inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-white hover:bg-orange-50 text-[#EB590E] text-xs sm:text-sm font-black shadow-lg shadow-black/10 transition-all active:scale-95 cursor-pointer"
                  >
                    Reserve Table Now
                  </button>
                </div>
              </div>

              <div className="relative w-full md:w-5/12 h-44 sm:h-52 md:h-auto min-h-[190px] overflow-hidden">
                <img
                  src="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=900&h=600&fit=crop"
                  alt="Dining Experience"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t md:bg-gradient-to-l from-transparent via-[#EB590E]/30 to-[#EB590E] opacity-90 md:opacity-100" />
              </div>
            </motion.div>
          );
        })()}

        {/* 3. DYNAMIC CATEGORIES CAROUSEL */}
        {safeCategories.length > 0 && (
          <div>
            <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide pb-2 pt-1 -mx-4 px-4 sm:mx-0 sm:px-0">
              {safeCategories.map((category, index) => (
                <Link
                  key={category.slug || index}
                  to={`/food/user/dining/${category.slug}`}
                  className="flex-shrink-0"
                >
                  <div className="w-[110px] sm:w-[130px] h-[115px] sm:h-[135px] rounded-[22px] p-3 flex flex-col justify-between border border-slate-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm hover:shadow-md hover:border-[#EB590E]/50 transition-all group relative overflow-hidden">
                    <span className="font-extrabold text-xs sm:text-sm text-slate-800 dark:text-white group-hover:text-[#EB590E] transition-colors z-10 truncate">
                      {category.name}
                    </span>
                    <div className="relative w-full h-[60px] sm:h-[75px] mt-1 rounded-xl overflow-hidden self-end bg-orange-50">
                      <img
                        src={resolveMediaUrl(category.imageUrl) || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=300&h=300&fit=crop"}
                        alt={category.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* 4. SECTION HEADER (Vertical Accent Line + Title + Badge) */}
        <div id="popular-restaurants-section" className="pt-2">
          <div className="flex flex-col gap-1.5 mb-4">
            <div className="flex items-center gap-2.5">
              <span className="w-1.5 h-6 rounded-full bg-[#EB590E] flex-shrink-0" />
              <h3 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white tracking-tight">
                Featured Dining Restaurants
              </h3>
            </div>
            <div className="pl-4">
              <span className="inline-flex items-center px-3 py-1 rounded-full bg-orange-50 dark:bg-orange-950/40 text-[#EB590E] border border-orange-200/60 dark:border-orange-900/40 font-extrabold text-[10px] sm:text-xs tracking-wider uppercase">
                {filteredRestaurants.length} Restaurants Available
              </span>
            </div>
          </div>

          {/* 5. FILTER PILLS */}
          <div
            className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-3 pt-1 -mx-4 px-4 sm:mx-0 sm:px-0"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {/* Filters Dialog Trigger Button */}
            <button
              onClick={() => setIsFilterOpen(true)}
              className="h-8 sm:h-9 px-3.5 rounded-xl flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 font-bold text-xs sm:text-sm bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 hover:border-[#EB590E] text-gray-800 dark:text-gray-200 shadow-sm transition-all active:scale-95"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#EB590E]" strokeWidth={2.2} />
              <span>Filters</span>
            </button>

            {/* Quick Filter Buttons */}
            {[
              { id: 'delivery-under-30', label: 'Under 30 mins' },
              { id: 'delivery-under-45', label: 'Under 45 mins' },
              { id: 'distance-under-1km', label: 'Under 1km', icon: MapPin },
              { id: 'distance-under-2km', label: 'Under 2km', icon: MapPin },
              { id: 'rating-4-plus', label: 'Rating 4.0+' },
              { id: 'rating-45-plus', label: 'Rating 4.5+' },
            ].map((filter) => {
              const Icon = filter.icon
              const isActive = activeFilters.has(filter.id)
              return (
                <button
                  key={filter.id}
                  onClick={() => toggleFilter(filter.id)}
                  className={`h-8 sm:h-9 px-3.5 rounded-xl flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 font-bold text-xs sm:text-sm transition-all shadow-sm active:scale-95 ${
                    isActive
                      ? 'bg-[#EB590E] text-white border border-[#EB590E] font-extrabold shadow-md'
                      : 'bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 hover:border-[#EB590E]/50 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {Icon && <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-white' : 'text-gray-500'}`} />}
                  <span>{filter.label}</span>
                </button>
              )
            })}
          </div>

          {/* Restaurant Cards */}
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 md:gap-6 lg:grid-cols-3 lg:gap-8">
              {loadingRestaurantCards.map((key, index) => (
                <DiningRestaurantSkeleton key={key} index={index} />
              ))}
            </div>
          ) : filteredRestaurants.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#eadfce] bg-[#fffaf4] px-6 py-12 text-center text-sm font-medium text-gray-500">
              No popular dining restaurants were found within 10 km for the current location.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6 lg:gap-7">
              {filteredRestaurants.map((restaurant, index) => {
                const restaurantSlug = restaurant.slug || restaurant.name.toLowerCase().replace(/\s+/g, "-")
                const diningDetailPath = `/food/user/dining/${restaurant.diningType || "dining"}/${restaurantSlug}`
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
                    key={restaurant._id || restaurant.id || index}
                    className="h-full"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.25) }}
                  >
                    <Link
                      to={diningDetailPath}
                      state={{ restaurant }}
                      className="block h-full group"
                    >
                      <div className="h-full flex flex-col bg-white dark:bg-[#18181b] rounded-2xl sm:rounded-3xl border border-gray-200/80 dark:border-zinc-800 shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_14px_30px_rgba(0,0,0,0.12)] transition-all duration-300 overflow-hidden hover:-translate-y-1">
                        
                        {/* Image Section */}
                        <div className="relative h-48 sm:h-52 md:h-56 w-full overflow-hidden bg-slate-100 dark:bg-zinc-800">
                          <img
                            src={restaurant.image || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&h=500&fit=crop"}
                            alt={restaurant.name}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.onerror = null;
                              e.currentTarget.src = "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&h=500&fit=crop";
                            }}
                          />

                          {/* Top Left Tag: Table Booking */}
                          <div className="absolute top-3 left-3 z-10">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md text-white text-[11px] font-bold tracking-wide border border-white/10 shadow-sm">
                              <UtensilsCrossed className="w-3 h-3 text-amber-300" />
                              Table Booking
                            </span>
                          </div>

                          {/* Top Right: Favorite Button */}
                          <button
                            type="button"
                            onClick={handleToggleFavorite}
                            className="absolute top-3 right-3 z-10 h-8 w-8 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-md border border-white/15 flex items-center justify-center text-white transition-transform active:scale-90 shadow-sm"
                            title="Save to favorites"
                          >
                            <Bookmark className={`h-4 w-4 ${favorite ? "fill-amber-400 text-amber-400" : "text-white"}`} strokeWidth={2.2} />
                          </button>

                          {/* Subtle Bottom Scrim Overlay */}
                          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 via-black/20 to-transparent pointer-events-none" />

                          {/* Bottom Left Offer Tag if Available */}
                          {restaurant.offer && restaurant.offer !== "Pre-book table" && (
                            <div className="absolute bottom-2.5 left-3 z-10">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-500 text-slate-950 font-black text-[11px] uppercase tracking-wider shadow-md">
                                {restaurant.offer}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Content Body */}
                        <div className="p-4 flex-1 flex flex-col justify-between">
                          <div>
                            {/* Row 1: Name & Rating */}
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="font-extrabold text-base sm:text-lg text-gray-900 dark:text-white line-clamp-1 group-hover:text-[#EB590E] transition-colors">
                                {restaurant.name}
                              </h3>
                              <div className="flex-shrink-0 inline-flex items-center gap-1 bg-emerald-600 text-white px-2 py-0.5 rounded-md text-xs font-black shadow-sm">
                                <span>{restaurant.rating}</span>
                                <Star className="h-3 w-3 fill-white text-white" />
                              </div>
                            </div>

                            {/* Row 2: Cuisine */}
                            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-medium truncate mt-1">
                              {restaurant.cuisine}
                            </p>

                            {/* Row 3: Distance & Time */}
                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 font-medium mt-2 flex-wrap">
                              <span className="inline-flex items-center gap-1 text-gray-600 dark:text-gray-300">
                                <MapPin className="w-3.5 h-3.5 text-[#EB590E]" />
                                {restaurant.area || "Nearby"} • {restaurant.distance}
                              </span>
                              <span>•</span>
                              <span className="inline-flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5 text-gray-400" />
                                {restaurant.deliveryTime}
                              </span>
                            </div>
                          </div>

                          {/* Bottom CTA Row */}
                          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-zinc-800/80 flex items-center justify-between">
                            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                              Instant Table Confirmation
                            </span>
                            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#EB590E] hover:bg-[#D44D0A] text-white text-xs font-bold shadow-sm transition-all group-hover:shadow-md">
                              Reserve
                            </span>
                          </div>
                        </div>

                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
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
                className="text-[#EB590E] font-medium text-sm md:text-base"
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
                      className={`flex flex-col items-center gap-1 py-4 px-2 text-center relative transition-colors ${isActive ? 'bg-white dark:bg-[#1a1a1a] text-[#EB590E]' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#EB590E] rounded-r" />
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
                            ? 'border-[#EB590E] bg-[#FFF2EB] dark:bg-[#EB590E]/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-[#EB590E]'
                            }`}
                        >
                          <span className={`text-sm md:text-base font-medium ${sortBy === option.id ? 'text-[#EB590E]' : 'text-gray-700 dark:text-gray-300'}`}>
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
                          ? 'border-[#EB590E] bg-[#FFF2EB] dark:bg-[#EB590E]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#EB590E]'
                          }`}
                      >
                        <Timer className={`h-6 w-6 ${activeFilters.has('delivery-under-30') ? 'text-[#EB590E]' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                        <span className={`text-sm font-medium ${activeFilters.has('delivery-under-30') ? 'text-[#EB590E]' : 'text-gray-700 dark:text-gray-300'}`}>Under 30 mins</span>
                      </button>
                      <button
                        onClick={() => toggleFilter('delivery-under-45')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has('delivery-under-45')
                          ? 'border-[#EB590E] bg-[#FFF2EB] dark:bg-[#EB590E]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#EB590E]'
                          }`}
                      >
                        <Timer className={`h-6 w-6 ${activeFilters.has('delivery-under-45') ? 'text-[#EB590E]' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                        <span className={`text-sm font-medium ${activeFilters.has('delivery-under-45') ? 'text-[#EB590E]' : 'text-gray-700 dark:text-gray-300'}`}>Under 45 mins</span>
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
                          ? 'border-[#EB590E] bg-[#FFF2EB] dark:bg-[#EB590E]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#EB590E]'
                          }`}
                      >
                        <Star className={`h-6 w-6 ${activeFilters.has('rating-35-plus') ? 'text-[#EB590E] fill-[#EB590E]' : 'text-gray-400 dark:text-gray-500'}`} />
                        <span className={`text-sm font-medium ${activeFilters.has('rating-35-plus') ? 'text-[#EB590E]' : 'text-gray-700 dark:text-gray-300'}`}>Rated 3.5+</span>
                      </button>
                      <button
                        onClick={() => toggleFilter('rating-4-plus')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has('rating-4-plus')
                          ? 'border-[#EB590E] bg-[#FFF2EB] dark:bg-[#EB590E]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#EB590E]'
                          }`}
                      >
                        <Star className={`h-6 w-6 ${activeFilters.has('rating-4-plus') ? 'text-[#EB590E] fill-[#EB590E]' : 'text-gray-400 dark:text-gray-500'}`} />
                        <span className={`text-sm font-medium ${activeFilters.has('rating-4-plus') ? 'text-[#EB590E]' : 'text-gray-700 dark:text-gray-300'}`}>Rated 4.0+</span>
                      </button>
                      <button
                        onClick={() => toggleFilter('rating-45-plus')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has('rating-45-plus')
                          ? 'border-[#EB590E] bg-[#FFF2EB] dark:bg-[#EB590E]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#EB590E]'
                          }`}
                      >
                        <Star className={`h-6 w-6 ${activeFilters.has('rating-45-plus') ? 'text-[#EB590E] fill-[#EB590E]' : 'text-gray-400 dark:text-gray-500'}`} />
                        <span className={`text-sm font-medium ${activeFilters.has('rating-45-plus') ? 'text-[#EB590E]' : 'text-gray-700 dark:text-gray-300'}`}>Rated 4.5+</span>
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
                          ? 'border-[#EB590E] bg-[#FFF2EB] dark:bg-[#EB590E]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#EB590E]'
                          }`}
                      >
                        <MapPin className={`h-6 w-6 ${activeFilters.has('distance-under-1km') ? 'text-[#EB590E]' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                        <span className={`text-sm font-medium ${activeFilters.has('distance-under-1km') ? 'text-[#EB590E]' : 'text-gray-700 dark:text-gray-300'}`}>Under 1 km</span>
                      </button>
                      <button
                        onClick={() => toggleFilter('distance-under-2km')}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has('distance-under-2km')
                          ? 'border-[#EB590E] bg-[#FFF2EB] dark:bg-[#EB590E]/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-[#EB590E]'
                          }`}
                      >
                        <MapPin className={`h-6 w-6 ${activeFilters.has('distance-under-2km') ? 'text-[#EB590E]' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                        <span className={`text-sm font-medium ${activeFilters.has('distance-under-2km') ? 'text-[#EB590E]' : 'text-gray-700 dark:text-gray-300'}`}>Under 2 km</span>
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
                          ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-green-500'
                          }`}
                      >
                        <span className={`text-sm font-medium ${activeFilters.has('price-under-200') ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`}>Under ₹200</span>
                      </button>
                      <button
                        onClick={() => toggleFilter('price-under-500')}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has('price-under-500')
                          ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-green-500'
                          }`}
                      >
                        <span className={`text-sm font-medium ${activeFilters.has('price-under-500') ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`}>Under ₹500</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Cuisine Tab */}
                {activeFilterTab === 'cuisine' && (
                  <div className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Cuisine</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {['Continental', 'Italian', 'Asian', 'Indian', 'Chinese', 'American', 'Seafood', 'Cafe'].map((cuisine) => (
                        <button
                          key={cuisine}
                          onClick={() => setSelectedCuisine(selectedCuisine === cuisine ? null : cuisine)}
                          className={`px-4 py-3 rounded-xl border text-center transition-colors ${selectedCuisine === cuisine
                            ? 'border-[#EB590E] bg-[#FFF2EB] dark:bg-[#EB590E]/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-[#EB590E]'
                            }`}
                        >
                          <span className={`text-sm font-medium ${selectedCuisine === cuisine ? 'text-[#EB590E]' : 'text-gray-700 dark:text-gray-300'}`}>
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
                  ? 'bg-[#EB590E] text-white hover:bg-[#D94F0C]'
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
