import { Link, useNavigate } from "react-router-dom"
import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { Star, Clock, MapPin, ArrowDownUp, Timer, ArrowRight, ChevronDown, Bookmark, Share2, Plus, Minus, X, Check, Utensils, UtensilsCrossed, Wallet } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"
import { Card, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import { useLocation } from "@food/hooks/useLocation"
import { useZone } from "@food/hooks/useZone"
import { useCart } from "@food/context/CartContext"
import { useProfile } from "@food/context/ProfileContext"
import { Avatar, AvatarFallback, AvatarImage } from "@food/components/ui/avatar"
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability"
import under250Banner from "@food/assets/under250_banner.jpg"
import homeBannerRed from "@food/assets/home-banner-red-clean.png"
import AddToCartAnimation from "@food/components/user/AddToCartAnimation"
import OptimizedImage from "@food/components/OptimizedImage"
import api from "@food/api"
import { restaurantAPI, adminAPI } from "@food/api"
import { isModuleAuthenticated } from "@food/utils/auth"
import { flattenMenuItems, getMenuFromResponse } from "@food/utils/menuItems"
import { calculateDistance, formatDistance } from "@food/utils/common"
import { hasFoodVariants, getDefaultFoodVariant, buildCartLineId } from "@food/utils/foodVariants"
import { isVegMenuItem, isVeganMenuItem, isNonVegCategoryScope } from "@food/utils/vegMode"
import {
  buildFoodCacheKey,
  getCachedUnder250PriceLimit,
  getFoodPageCache,
  getLandingSettingsPublic,
  setFoodPageCache,
} from "@food/utils/foodPageCache"
const getLineItemIdForDish = (item, variant = null) =>
  buildCartLineId(item?.id || item?._id || "", variant?.id || variant?._id || "")

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}
const RUPEE_SYMBOL = "\u20B9"
const UNDER_250_FILTERS_STORAGE_KEY = "food-under-250-filters"
const UNDER250_LIST_MAX_VISIBLE = 12
const UNDER250_ITEMS_PER_RESTAURANT = 10
const UNDER250_PAGE_SIZE = 6
const UNDER250_CACHE_TTL_MS = 15 * 60 * 1000

const isUnder250CacheFresh = (cached) =>
  Boolean(
    cached?.restaurants?.length > 0 &&
      cached?.ts &&
      Date.now() - Number(cached.ts) < UNDER250_CACHE_TTL_MS,
  )

const mapUnder250Restaurants = (restaurantsRaw, location) => {
  const userLat = Number(location?.latitude)
  const userLng = Number(location?.longitude)

  return (Array.isArray(restaurantsRaw) ? restaurantsRaw : []).map((restaurant) => {
    const restaurantId = restaurant?.restaurantId || restaurant?.id || restaurant?._id

    const restaurantLocation = restaurant?.location
    const restaurantLat = Number(
      restaurantLocation?.latitude ??
        (Array.isArray(restaurantLocation?.coordinates)
          ? restaurantLocation.coordinates[1]
          : null),
    )
    const restaurantLng = Number(
      restaurantLocation?.longitude ??
        (Array.isArray(restaurantLocation?.coordinates)
          ? restaurantLocation.coordinates[0]
          : null),
    )
    const distanceInKm =
      Number.isFinite(userLat) &&
      Number.isFinite(userLng) &&
      Number.isFinite(restaurantLat) &&
      Number.isFinite(restaurantLng)
        ? calculateDistance(userLat, userLng, restaurantLat, restaurantLng)
        : null

    const fallbackDistance =
      typeof restaurant?.distance === "number"
        ? formatDistance(restaurant.distance)
        : restaurant?.distance || ""

    const mappedItems = (restaurant.menuItems || [])
      .slice(0, UNDER250_ITEMS_PER_RESTAURANT)
      .map((item) => ({
        ...item,
        id: String(item.id || item._id),
        price: Number(item.price || 0),
        foodType: item.foodType || (item.isVeg ? "Veg" : "Non-Veg"),
        isVeg: isVegMenuItem(item),
        isVegan: isVeganMenuItem(item),
        image: item?.image || "",
      }))
    const hasNonVegInPayload = mappedItems.some((item) => !item.isVeg)
    const hasNonVeganInPayload = mappedItems.some((item) => !item.isVegan)
    const hasNonVegMenu =
      restaurant?.hasNonVegMenu === true || hasNonVegInPayload
        ? true
        : restaurant?.hasNonVegMenu === false
          ? false
          : undefined
    const isPureVegan =
      restaurant?.isPureVegan === true
        ? true
        : restaurant?.pureVeganRestaurant === true && !hasNonVeganInPayload
          ? true
          : restaurant?.isPureVegan === false
            ? false
            : undefined

    return {
      ...restaurant,
      id: String(restaurantId),
      restaurantId: String(restaurantId),
      name: restaurant?.restaurantName || restaurant?.name || "Restaurant",
      rating: Number(restaurant?.rating || 0),
      totalRatings: Number(restaurant?.totalRatings || restaurant?.ratingCount || 0),
      deliveryTime:
        restaurant?.estimatedDeliveryTime ||
        (restaurant?.estimatedDeliveryTimeMinutes
          ? `${restaurant.estimatedDeliveryTimeMinutes} mins`
          : "30 mins"),
      distance: distanceInKm !== null ? formatDistance(distanceInKm) : fallbackDistance,
      distanceInKm,
      hasNonVegMenu,
      pureVeganRestaurant: restaurant?.pureVeganRestaurant === true,
      isPureVeg:
        hasNonVegMenu === true
          ? false
          : restaurant?.isPureVeg === true ||
            (hasNonVegMenu === false &&
              (restaurant?.pureVegRestaurant === true ||
                restaurant?.pureVeganRestaurant === true ||
                mappedItems.some((item) => item.isVeg))),
      isPureVegan:
        isPureVegan === true
          ? true
          : isPureVegan === false
            ? false
            : restaurant?.pureVeganRestaurant === true && !hasNonVeganInPayload,
      menuItems: mappedItems,
    }
  })
}

const readUnder250Filters = () => {
  if (typeof window === "undefined") {
    return {
      selectedSort: null,
      activeCategory: null,
      under30MinsFilter: false,
    }
  }

  try {
    const raw = window.localStorage.getItem(UNDER_250_FILTERS_STORAGE_KEY)
    if (!raw) {
      return {
        selectedSort: null,
        activeCategory: null,
        under30MinsFilter: false,
      }
    }

    const parsed = JSON.parse(raw)
    return {
      selectedSort: typeof parsed?.selectedSort === "string" ? parsed.selectedSort : null,
      activeCategory: typeof parsed?.activeCategory === "string" ? parsed.activeCategory : null,
      under30MinsFilter: parsed?.under30MinsFilter === true,
    }
  } catch {
    return {
      selectedSort: null,
      activeCategory: null,
      under30MinsFilter: false,
    }
  }
}


export default function Under250({ isTabActive = true }) {
  const initialFiltersRef = useRef(readUnder250Filters())
  const { location } = useLocation()
  const { zoneId, zoneStatus, isInService, isOutOfService } = useZone(location)
  const { userProfile, vegMode, vegModeOption } = useProfile()

  const navigate = useNavigate()
  const { addToCart, updateQuantity, removeFromCart, getCartItem, cart } = useCart()
  const [activeCategory, setActiveCategory] = useState(initialFiltersRef.current.activeCategory)
  const [showSortPopup, setShowSortPopup] = useState(false)
  const [selectedSort, setSelectedSort] = useState(initialFiltersRef.current.selectedSort)
  const [draftSelectedSort, setDraftSelectedSort] = useState(initialFiltersRef.current.selectedSort)
  const [under30MinsFilter, setUnder30MinsFilter] = useState(initialFiltersRef.current.under30MinsFilter)
  const [showItemDetail, setShowItemDetail] = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)
  const [itemDetailQuantity, setItemDetailQuantity] = useState(1)
  const [showShareOptions, setShowShareOptions] = useState(false)
  const [quantities, setQuantities] = useState({})
  const [bookmarkedItems, setBookmarkedItems] = useState(new Set())
  const [viewCartButtonBottom, setViewCartButtonBottom] = useState("bottom-[92px]")
  const lastScrollY = useRef(0)
  const scrollLockYRef = useRef(0)
  const itemDetailContentRef = useRef(null)
  const itemDetailGestureRef = useRef({
    startY: 0,
    dragging: false,
  })
  const [categories, setCategories] = useState([])
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [bannerImages, setBannerImages] = useState([])
  const [loadingBanner, setLoadingBanner] = useState(true)
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0)
  const [isTransitionEnabled, setIsTransitionEnabled] = useState(true)
  const [under250PriceLimit, setUnder250PriceLimit] = useState(() =>
    getCachedUnder250PriceLimit(250),
  )
  const cacheKey = buildFoodCacheKey("under250", {
    zoneId: zoneId || "none",
    limit: under250PriceLimit,
  })
  const cachedListRef = useRef(getFoodPageCache(cacheKey))
  const [under250Restaurants, setUnder250Restaurants] = useState(
    () => cachedListRef.current?.restaurants || [],
  )
  const [loadingRestaurants, setLoadingRestaurants] = useState(
    () => !(cachedListRef.current?.restaurants?.length > 0),
  )
  const [visibleRestaurantCount, setVisibleRestaurantCount] = useState(UNDER250_LIST_MAX_VISIBLE)
  const [hasScrolledPastBanner, setHasScrolledPastBanner] = useState(false)
  const bannerShellRef = useRef(null)
  const stickyHeaderRef = useRef(null)
  const autoSlideIntervalRef = useRef(null)
  const touchStartXRef = useRef(0)
  const touchStartYRef = useRef(0)
  const touchEndXRef = useRef(0)
  const touchEndYRef = useRef(0)
  const isBannerSwipingRef = useRef(false)
  const fetchInflightRef = useRef(null)

  const sortOptions = [
    { id: null, label: 'Relevance' },
    { id: 'rating-high', label: 'Rating: High to Low' },
    { id: 'delivery-time-low', label: 'Estimated Time: Low to High' },
    { id: 'distance-low', label: 'Distance: Low to High' },
  ]

  const handleClearAll = () => {
    setSelectedSort(null)
    setDraftSelectedSort(null)
    setUnder30MinsFilter(false)
    setActiveCategory(null)
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(UNDER_250_FILTERS_STORAGE_KEY)
    }
  }

  const handleApply = () => {
    setSelectedSort(draftSelectedSort)
    setShowSortPopup(false)
  }

  // Helper function to parse delivery time (e.g., "12-15 mins" -> 12 or average)
  const parseDeliveryTime = (deliveryTime) => {
    if (typeof deliveryTime === "number" && Number.isFinite(deliveryTime)) return deliveryTime
    if (!deliveryTime) return 999 // Default high value for sorting
    const value = String(deliveryTime)
    const rangeMatch = value.match(/(\d+)\s*-\s*(\d+)/)
    if (rangeMatch) {
      return (parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2 // Average
    }
    const match = value.match(/(\d+)/)
    if (match) {
      return parseInt(match[1])
    }
    return 999
  }

  // Helper function to parse distance (e.g., "0.4 km" -> 0.4)
  const parseDistance = (distance) => {
    if (typeof distance === "number" && Number.isFinite(distance)) return distance
    if (!distance) return 999 // Default high value for sorting
    const value = String(distance)
    const match = value.match(/(\d+\.?\d*)/)
    if (match) {
      const numericValue = parseFloat(match[1])
      return value.toLowerCase().includes("m") && !value.toLowerCase().includes("km")
        ? numericValue / 1000
        : numericValue
    }
    return 999
  }

  // Sort and filter restaurants based on selected sort, filters, and veg mode
  const sortedAndFilteredRestaurants = useMemo(() => {
    let filtered = under250Restaurants.map((r) => ({
      ...r,
      menuItems: [...(r.menuItems || [])],
    }))

    // Veg mode: pure-veg / pure-vegan restaurants only, or all restaurants with diet-filtered dishes
    if (vegMode) {
      if (vegModeOption === "pure-vegan") {
        filtered = filtered.filter((restaurant) => {
          if (restaurant?.isPureVegan === true) return true
          if (restaurant?.isPureVegan === false) return false
          const items = restaurant.menuItems || []
          const hasNonVeganDish = items.some((item) => !isVeganMenuItem(item))
          return restaurant?.pureVeganRestaurant === true && !hasNonVeganDish
        })
      } else if (vegModeOption === "pure-veg") {
        filtered = filtered.filter((restaurant) => {
          // Full-menu signal from API (any price) — don't trust under-250 items alone
          if (restaurant?.hasNonVegMenu === true) return false
          if (restaurant?.isPureVeg === true || restaurant?.isPureVegan === true) return true
          if (restaurant?.hasNonVegMenu === false) {
            // Menu scanned: no non-veg anywhere; allow even if admin flag is wrong/missing
            return true
          }
          const items = restaurant.menuItems || []
          const hasNonVegDish = items.some((item) => !isVegMenuItem(item))
          return (
            (restaurant?.pureVegRestaurant === true ||
              restaurant?.pureVeganRestaurant === true) &&
            !hasNonVegDish
          )
        })
      }
      filtered = filtered
        .map((restaurant) => {
          const dietItems = (restaurant.menuItems || []).filter((item) =>
            vegModeOption === "pure-vegan"
              ? isVeganMenuItem(item)
              : isVegMenuItem(item),
          )
          if (dietItems.length === 0) return null
          return { ...restaurant, menuItems: dietItems }
        })
        .filter(Boolean)
    }

    // Apply category filter
    if (activeCategory) {
      const selectedCat = categories.find((cat) => cat.id === activeCategory)
      if (selectedCat) {
        const catNameLower = String(selectedCat.name || "").toLowerCase()
        filtered = filtered
          .map((restaurant) => {
            const matches = restaurant.menuItems.filter((item) => {
              const itemCat = String(item.categoryName || item.category || item.sectionName || item.subsectionName || "").toLowerCase()
              const itemName = String(item.name || "").toLowerCase()
              const itemDesc = String(item.description || "").toLowerCase()
              return (
                (itemCat && (itemCat.includes(catNameLower) || catNameLower.includes(itemCat))) ||
                (itemName && (itemName.includes(catNameLower) || catNameLower.includes(itemName))) ||
                (itemDesc && itemDesc.includes(catNameLower))
              )
            })
            if (matches.length > 0) {
              return { ...restaurant, menuItems: matches }
            }
            return null
          })
          .filter(Boolean)
      }
    }

    // Apply "Under 30 mins" filter
    if (under30MinsFilter) {
      filtered = filtered.filter((restaurant) => {
        const deliveryTime = parseDeliveryTime(restaurant.deliveryTime)
        return deliveryTime <= 30
      })
    }

    // Apply sorting
    if (selectedSort === "rating-high") {
      filtered.sort((a, b) => {
        const ratingA = a.rating || 0
        const ratingB = b.rating || 0
        if (ratingB !== ratingA) {
          return ratingB - ratingA
        }
        return (b.menuItems?.length || 0) - (a.menuItems?.length || 0)
      })
    } else if (selectedSort === "delivery-time-low") {
      filtered.sort((a, b) => {
        const timeA = parseDeliveryTime(a.deliveryTime)
        const timeB = parseDeliveryTime(b.deliveryTime)
        if (timeA !== timeB) {
          return timeA - timeB
        }
        if ((b.rating || 0) !== (a.rating || 0)) {
          return (b.rating || 0) - (a.rating || 0)
        }
        return (a.originalIndex || 0) - (b.originalIndex || 0)
      })
    } else if (selectedSort === "distance-low") {
      filtered.sort((a, b) => {
        const distA = Number.isFinite(a.distanceInKm)
          ? a.distanceInKm
          : parseDistance(a.distance)
        const distB = Number.isFinite(b.distanceInKm)
          ? b.distanceInKm
          : parseDistance(b.distance)
        if (distA !== distB) {
          return distA - distB
        }
        if ((b.rating || 0) !== (a.rating || 0)) {
          return (b.rating || 0) - (a.rating || 0)
        }
        return (a.originalIndex || 0) - (b.originalIndex || 0)
      })
    }

    const sortedResult = filtered
      .map((restaurant, index) => ({ restaurant, index }))
      .sort((a, b) => {
        const aAvail = getRestaurantAvailabilityStatus(a.restaurant)
        const bAvail = getRestaurantAvailabilityStatus(b.restaurant)
        
        const aOpen = aAvail?.isOpen ? 1 : 0
        const bOpen = bAvail?.isOpen ? 1 : 0
        
        if (aOpen !== bOpen) {
          return bOpen - aOpen
        }
        
        return a.index - b.index
      })
      .map(item => item.restaurant)

    return sortedResult
  }, [
    under250Restaurants,
    selectedSort,
    under30MinsFilter,
    activeCategory,
    categories,
    vegMode,
    vegModeOption,
  ])

  const displayCategories = useMemo(() => {
    let baseCats = categories
    if (vegMode) {
      baseCats = baseCats.filter((cat) => !isNonVegCategoryScope(cat))
    }
    if (!under250Restaurants || under250Restaurants.length === 0) {
      return baseCats
    }

    const availableItems = under250Restaurants.flatMap((r) => r.menuItems || [])
    if (availableItems.length === 0) return baseCats

    return baseCats.filter((cat) => {
      const catNameLower = String(cat.name || "").toLowerCase().trim()
      const catWords = catNameLower.split(/\s+/).filter(w => w.length > 2)

      return availableItems.some((item) => {
        const itemCat = String(item.categoryName || item.category || item.sectionName || item.subsectionName || item.categoryId || "").toLowerCase().trim()
        const itemName = String(item.name || "").toLowerCase().trim()
        const itemDesc = String(item.description || "").toLowerCase().trim()

        if (itemCat && (itemCat.includes(catNameLower) || catNameLower.includes(itemCat))) return true
        if (itemName && (itemName.includes(catNameLower) || catNameLower.includes(itemName))) return true
        if (itemDesc && itemDesc.includes(catNameLower)) return true

        if (catWords.length > 0) {
          return catWords.some(word => itemCat.includes(word) || itemName.includes(word) || itemDesc.includes(word))
        }
        return false
      })
    })
  }, [categories, vegMode, under250Restaurants])

  // If active category was non-veg and veg mode turns on, clear it
  useEffect(() => {
    if (!vegMode || !activeCategory) return
    const selected = categories.find((cat) => cat.id === activeCategory)
    if (selected && isNonVegCategoryScope(selected)) {
      setActiveCategory(null)
    }
  }, [vegMode, activeCategory, categories])

  // Fetch under-50 banner from public API
  useEffect(() => {
    let cancelled = false
    setLoadingBanner(true)
    const reqConfig = zoneId ? { params: { zoneId } } : {}
    api.get('/food/hero-banners/under-250/public', reqConfig)
      .then((res) => {
        if (cancelled) return
        const data = res?.data?.data
        const list = Array.isArray(data?.banners) ? data.banners : (Array.isArray(data) ? data : [])
        const images = list
          .map((banner) => (typeof banner?.imageUrl === "string" ? banner.imageUrl.trim() : ""))
          .filter(Boolean)
        setBannerImages(images)
      })
      .catch(() => {
        if (!cancelled) setBannerImages([])
      })
      .finally(() => {
        if (!cancelled) setLoadingBanner(false)
      })
    return () => { cancelled = true }
  }, [zoneId])

  // Fetch landing settings to get dynamic price limit (shared cache)
  useEffect(() => {
    let cancelled = false
    getLandingSettingsPublic(() =>
      api.get("/food/landing/settings/public", zoneId ? { params: { zoneId } } : {}),
    )
      .then((settings) => {
        if (cancelled) return
        if (settings && typeof settings.under250PriceLimit === "number") {
          setUnder250PriceLimit(settings.under250PriceLimit)
        }
      })
      .catch(() => {
        if (!cancelled) setUnder250PriceLimit(250)
      })
    return () => {
      cancelled = true
    }
  }, [zoneId])

  useEffect(() => {
    setCurrentBannerIndex((prev) => {
      if (bannerImages.length === 0) return 0
      return Math.min(prev, bannerImages.length - 1)
    })
  }, [bannerImages.length])

  useEffect(() => {
    if (typeof window === "undefined") return

    bannerImages.forEach((src) => {
      if (!src) return
      const img = new window.Image()
      img.src = src
    })
  }, [bannerImages])

  const startBannerAutoSlide = useCallback(() => {
    if (autoSlideIntervalRef.current) {
      clearInterval(autoSlideIntervalRef.current)
    }

    if (bannerImages.length <= 1) return

    autoSlideIntervalRef.current = setInterval(() => {
      if (!isBannerSwipingRef.current) {
        setIsTransitionEnabled(true)
        setCurrentBannerIndex((prev) => {
          if (prev >= bannerImages.length) return prev
          return prev + 1
        })
      }
    }, 3500)
  }, [bannerImages.length])

  // Handle snap-back when reaching the cloned slide at the end
  useEffect(() => {
    if (currentBannerIndex === bannerImages.length && bannerImages.length > 1) {
      const timer = setTimeout(() => {
        setIsTransitionEnabled(false)
        setCurrentBannerIndex(0)
      }, 500) // match transition duration
      return () => clearTimeout(timer)
    }
  }, [currentBannerIndex, bannerImages.length])

  // Re-enable transition after snap-back
  useEffect(() => {
    if (!isTransitionEnabled && currentBannerIndex === 0) {
      const timer = setTimeout(() => {
        setIsTransitionEnabled(true)
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isTransitionEnabled, currentBannerIndex])

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
    if (bannerImages.length <= 1) return
    touchStartXRef.current = event.touches[0].clientX
    touchStartYRef.current = event.touches[0].clientY
    touchEndXRef.current = event.touches[0].clientX
    touchEndYRef.current = event.touches[0].clientY
    isBannerSwipingRef.current = true
  }, [bannerImages.length])

  const handleBannerTouchMove = useCallback((event) => {
    if (!isBannerSwipingRef.current) return
    touchEndXRef.current = event.touches[0].clientX
    touchEndYRef.current = event.touches[0].clientY
  }, [])

  const handleBannerTouchEnd = useCallback(() => {
    if (!isBannerSwipingRef.current || bannerImages.length <= 1) {
      isBannerSwipingRef.current = false
      return
    }

    const deltaX = touchEndXRef.current - touchStartXRef.current
    const deltaY = Math.abs(touchEndYRef.current - touchStartYRef.current)
    const minSwipeDistance = 40

    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaX) > deltaY) {
      if (deltaX > 0) {
        if (currentBannerIndex === 0) {
          setIsTransitionEnabled(false)
          setCurrentBannerIndex(bannerImages.length)
          setTimeout(() => {
            setIsTransitionEnabled(true)
            setCurrentBannerIndex(bannerImages.length - 1)
          }, 50)
        } else {
          setIsTransitionEnabled(true)
          setCurrentBannerIndex((prev) => prev - 1)
        }
      } else {
        setIsTransitionEnabled(true)
        setCurrentBannerIndex((prev) => {
          if (prev >= bannerImages.length) return prev
          return prev + 1
        })
      }
      resetBannerAutoSlide()
    }

    isBannerSwipingRef.current = false
  }, [bannerImages.length, currentBannerIndex, resetBannerAutoSlide])

  // Recompute distances when GPS moves — do NOT refetch the heavy list
  useEffect(() => {
    const lat = Number(location?.latitude)
    const lng = Number(location?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

    setUnder250Restaurants((prev) => {
      if (!prev.length) return prev
      let changed = false
      const next = prev.map((restaurant) => {
        const restaurantLocation = restaurant?.location
        const restaurantLat = Number(
          restaurantLocation?.latitude ??
            (Array.isArray(restaurantLocation?.coordinates)
              ? restaurantLocation.coordinates[1]
              : null),
        )
        const restaurantLng = Number(
          restaurantLocation?.longitude ??
            (Array.isArray(restaurantLocation?.coordinates)
              ? restaurantLocation.coordinates[0]
              : null),
        )
        if (!Number.isFinite(restaurantLat) || !Number.isFinite(restaurantLng)) {
          return restaurant
        }
        const distanceInKm = calculateDistance(lat, lng, restaurantLat, restaurantLng)
        const distance = formatDistance(distanceInKm)
        if (restaurant.distanceInKm === distanceInKm && restaurant.distance === distance) {
          return restaurant
        }
        changed = true
        return { ...restaurant, distanceInKm, distance }
      })
      return changed ? next : prev
    })
  }, [location?.latitude, location?.longitude])

  // Progressive fetch: first 6 restaurants paint fast, rest append in background.
  // Fresh cache → show instantly, no full refresh on tab return.
  useEffect(() => {
    if (!isTabActive) return undefined
    if (!zoneId) {
      setLoadingRestaurants(false)
      return undefined
    }

    let cancelled = false
    const key = buildFoodCacheKey("under250", {
      zoneId,
      limit: under250PriceLimit,
    })
    const cached = getFoodPageCache(key)

    if (isUnder250CacheFresh(cached)) {
      setUnder250Restaurants(mapUnder250Restaurants(cached.restaurants, location))
      setVisibleRestaurantCount(
        Math.max(UNDER250_LIST_MAX_VISIBLE, cached.restaurants.length),
      )
      setLoadingRestaurants(false)
      return undefined
    }

    if (cached?.restaurants?.length) {
      setUnder250Restaurants(mapUnder250Restaurants(cached.restaurants, location))
      setLoadingRestaurants(false)
    } else if (under250Restaurants.length === 0) {
      setLoadingRestaurants(true)
    }

    const mergeUnique = (prev, incoming) => {
      const seen = new Set(prev.map((r) => String(r.id)))
      const next = [...prev]
      incoming.forEach((r) => {
        const id = String(r.id)
        if (seen.has(id)) return
        seen.add(id)
        next.push(r)
      })
      return next
    }

    const loadProgressive = async () => {
      let resolveInflight
      let rejectInflight
      try {
        // If a fetch for this key is already running, wait for it instead of
        // bailing out and leaving the skeleton stuck (common when effect re-runs
        // while the previous request returns an empty list).
        if (fetchInflightRef.current?.key === key && fetchInflightRef.current?.promise) {
          try {
            await fetchInflightRef.current.promise
          } catch (_) {
            // ignore — handled by the owner fetch
          }
          if (!cancelled) setLoadingRestaurants(false)
          return
        }

        const inflightPromise = new Promise((resolve, reject) => {
          resolveInflight = resolve
          rejectInflight = reject
        })
        fetchInflightRef.current = { key, promise: inflightPromise }

        let offset = 0
        let scanSkip = 0
        let hasMore = true
        let accumulatedRaw = cached?.restaurants?.length ? [...cached.restaurants] : []
        let page = 0

        while (hasMore && !cancelled && page < 25) {
          const response = await Promise.race([
            restaurantAPI.getRestaurantsUnder250({
              zoneId,
              priceLimit: under250PriceLimit,
              limit: UNDER250_PAGE_SIZE,
              offset,
              scanSkip: page === 0 ? 0 : scanSkip,
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Under-250 request timed out")), 20000),
            ),
          ])
          if (cancelled) break

          const data = response?.data?.data
          const batchRaw = Array.isArray(data?.restaurants) ? data.restaurants : []
          hasMore = data?.hasMore === true && batchRaw.length > 0
          scanSkip = Number(data?.scanSkip) || scanSkip
          offset = Number(data?.nextOffset) || offset + batchRaw.length

          if (batchRaw.length === 0) break

          accumulatedRaw = (() => {
            const seen = new Set(accumulatedRaw.map((r) => String(r._id || r.id || r.restaurantId)))
            const next = [...accumulatedRaw]
            batchRaw.forEach((r) => {
              const id = String(r._id || r.id || r.restaurantId)
              if (seen.has(id)) return
              seen.add(id)
              next.push(r)
            })
            return next
          })()

          const mappedBatch = mapUnder250Restaurants(batchRaw, location)
          setUnder250Restaurants((prev) =>
            page === 0 && !(cached?.restaurants?.length)
              ? mappedBatch
              : mergeUnique(prev, mappedBatch),
          )
          setVisibleRestaurantCount((n) =>
            Math.max(n, UNDER250_LIST_MAX_VISIBLE, (page + 1) * UNDER250_PAGE_SIZE),
          )
          setLoadingRestaurants(false)
          setFoodPageCache(key, { restaurants: accumulatedRaw, ts: Date.now() })

          page += 1
          if (!hasMore) break
          // Yield so UI stays responsive between pages
          await new Promise((r) => setTimeout(r, 50))
        }

        // Empty API result: clear list + stop skeleton
        if (!cancelled && accumulatedRaw.length === 0) {
          setUnder250Restaurants([])
          setFoodPageCache(key, { restaurants: [], ts: Date.now() })
        } else if (!cancelled) {
          setFoodPageCache(key, { restaurants: accumulatedRaw, ts: Date.now() })
        }

        if (!cancelled) {
          setLoadingRestaurants(false)
        }
        resolveInflight?.()
      } catch (error) {
        rejectInflight?.(error)
        if (!cancelled) {
          debugError("Error fetching restaurants under 250:", error)
          if (!(cached?.restaurants?.length > 0)) {
            setUnder250Restaurants([])
          }
          setLoadingRestaurants(false)
        }
      } finally {
        if (fetchInflightRef.current?.key === key) fetchInflightRef.current = null
        if (!cancelled) {
          setLoadingRestaurants(false)
        }
      }
    }

    loadProgressive()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- location only used for mapping; GPS remapped separately
  }, [zoneId, under250PriceLimit, isTabActive])

  // Fetch categories from backend (no static fallback list)
  useEffect(() => {
    let cancelled = false

    const fetchCategories = async () => {
      try {
        setLoadingCategories((prev) => categories.length === 0 ? true : false)
        const response = await adminAPI.getPublicCategories(zoneId ? { zoneId } : {})
        const categoriesRaw = Array.isArray(response?.data?.data?.categories)
          ? response.data.data.categories
          : []

        const mappedCategories = categoriesRaw
          .map((cat, index) => {
            const name = String(cat?.name || "").trim()
            if (!name) return null

            return {
              id: String(cat?.id || cat?._id || cat?.slug || `cat-${index}`),
              name,
              slug: String(cat?.slug || name.toLowerCase().replace(/\s+/g, "-")),
              foodTypeScope: String(cat?.foodTypeScope || cat?.type || "Both"),
              image:
                cat?.imageUrl ||
                cat?.image ||
                cat?.icon ||
                "",
            }
          })
          .filter(Boolean)

        if (!cancelled) {
          setCategories(mappedCategories)
          setLoadingCategories(false)
        }
      } catch (error) {
        debugError("Error fetching under-250 categories:", error)
        if (!cancelled) {
          setCategories([])
          setLoadingCategories(false)
        }
      }
    }

    fetchCategories()

    return () => {
      cancelled = true
    }
  }, [zoneId])

  // Sync quantities from cart on mount
  useEffect(() => {
    const cartQuantities = {}
    cart.forEach((item) => {
      cartQuantities[item.id] = item.quantity || 0
    })
    setQuantities(cartQuantities)
  }, [cart])

  useEffect(() => {
    if (!selectedItem || !showItemDetail) return

    const defaultVariant = getDefaultFoodVariant(selectedItem)
    const lineItemId = getLineItemIdForDish(selectedItem, defaultVariant)
    const existingQuantity = quantities[lineItemId] || 0
    if (existingQuantity > 0) {
      setItemDetailQuantity(existingQuantity)
    }
  }, [quantities, selectedItem, showItemDetail])

  useEffect(() => {
    if (!showSortPopup) return
    setDraftSelectedSort(selectedSort)
  }, [showSortPopup, selectedSort])

  useEffect(() => {
    if (!showSortPopup && !showItemDetail && !showShareOptions) return
    if (typeof window === "undefined") return

    const bodyStyle = document.body.style
    scrollLockYRef.current = window.scrollY

    const originalOverflow = bodyStyle.overflow
    const originalPosition = bodyStyle.position
    const originalTop = bodyStyle.top
    const originalWidth = bodyStyle.width

    bodyStyle.overflow = "hidden"
    bodyStyle.position = "fixed"
    bodyStyle.top = `-${scrollLockYRef.current}px`
    bodyStyle.width = "100%"

    return () => {
      bodyStyle.overflow = originalOverflow
      bodyStyle.position = originalPosition
      bodyStyle.top = originalTop
      bodyStyle.width = originalWidth
      window.scrollTo(0, scrollLockYRef.current)
    }
  }, [showSortPopup, showItemDetail, showShareOptions])

  // Keep-alive: leaving Under250 must unlock body + close sheets or Delivery taps feel dead
  useEffect(() => {
    if (isTabActive) return undefined
    setShowSortPopup(false)
    setShowItemDetail(false)
    setShowShareOptions(false)
    setSelectedItem(null)
    if (typeof document !== "undefined") {
      const bodyStyle = document.body.style
      bodyStyle.overflow = ""
      bodyStyle.position = ""
      bodyStyle.top = ""
      bodyStyle.width = ""
    }
    return undefined
  }, [isTabActive])

  useEffect(() => {
    if (typeof window === "undefined") return

    if (!selectedSort && !activeCategory && !under30MinsFilter) {
      window.localStorage.removeItem(UNDER_250_FILTERS_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(
      UNDER_250_FILTERS_STORAGE_KEY,
      JSON.stringify({
        selectedSort,
        activeCategory,
        under30MinsFilter,
      })
    )
  }, [selectedSort, activeCategory, under30MinsFilter])

  // Scroll detection for view cart button positioning
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY
      const scrollDifference = Math.abs(currentScrollY - lastScrollY.current)

      // Only update if scroll difference is significant (avoid flickering)
      if (scrollDifference < 5) {
        return
      }

      // Scroll down -> bottom-[72px], Scroll up -> bottom-[92px]
      if (currentScrollY > lastScrollY.current) {
        // Scrolling down
        setViewCartButtonBottom("bottom-[72px]")
      } else if (currentScrollY < lastScrollY.current) {
        // Scrolling up
        setViewCartButtonBottom("bottom-[92px]")
      }

      // Update banner scroll state for navbar transparency
      if (currentScrollY > 40) {
        setHasScrolledPastBanner(true)
      } else {
        setHasScrolledPastBanner(false)
      }

      lastScrollY.current = currentScrollY
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  // Helper function to update item quantity in both local state and cart
  const updateItemQuantity = (item, newQuantity, event = null, restaurantName = null, preferredVariant = null) => {
    // Check authentication
    if (!isModuleAuthenticated('user')) {
      window.dispatchEvent(new CustomEvent('show-login-required'))
      return
    }

    // CRITICAL: Check if user is in service zone
    if (isOutOfService) {
      toast.error('You are outside the service zone. Please select a location within the service area.')
      return
    }

    const resolvedVariant = preferredVariant || getDefaultFoodVariant(item)
    const lineItemId = getLineItemIdForDish(item, resolvedVariant)

    // Update local state
    setQuantities((prev) => ({
      ...prev,
      [lineItemId]: newQuantity,
    }))

    // Find restaurant name from the item or use provided parameter
    const restaurant = restaurantName || item.restaurant || "Under 250"

    // Prepare cart item with all required properties
    const cartItem = {
      id: lineItemId,
      lineItemId,
      itemId: item.id,
      name: item.name,
      price: resolvedVariant?.price ?? item.price,
      variantId: resolvedVariant?.id || "",
      variantName: resolvedVariant?.name || "",
      variantPrice: resolvedVariant?.price ?? item.price,
      image: item.image,
      restaurant: restaurant,
      description: item.description || "",
      originalPrice: item.originalPrice || item.price,
      isVeg: item.isVeg === true,
      priceOnOtherPlatforms: null,
      otherPlatformGst: null,
    }

    // Get source position for animation from event target
    let sourcePosition = null
    if (event) {
      let buttonElement = event.currentTarget
      if (!buttonElement && event.target) {
        buttonElement = event.target.closest('button') || event.target
      }

      if (buttonElement) {
        const rect = buttonElement.getBoundingClientRect()
        const scrollX = window.pageXOffset || window.scrollX || 0
        const scrollY = window.pageYOffset || window.scrollY || 0

        sourcePosition = {
          viewportX: rect.left + rect.width / 2,
          viewportY: rect.top + rect.height / 2,
          scrollX: scrollX,
          scrollY: scrollY,
          itemId: lineItemId,
        }
      }
    }

    // Update cart context
    if (newQuantity <= 0) {
      const productInfo = {
        id: lineItemId,
        name: item.name,
        imageUrl: item.image,
      }
      removeFromCart(lineItemId, sourcePosition, productInfo)
    } else {
      const existingCartItem = getCartItem(lineItemId)
      if (existingCartItem) {
        const productInfo = {
          id: lineItemId,
          name: item.name,
          imageUrl: item.image,
        }

        if (newQuantity > existingCartItem.quantity && sourcePosition) {
          const result = addToCart(cartItem, sourcePosition)
          if (result?.ok === false) {
            toast.error(result.error || 'Cannot add item from different restaurant. Please clear cart first.')
            return
          }
          if (newQuantity > existingCartItem.quantity + 1) {
            updateQuantity(lineItemId, newQuantity)
          }
        } else if (newQuantity < existingCartItem.quantity && sourcePosition) {
          updateQuantity(lineItemId, newQuantity, sourcePosition, productInfo)
        } else {
          updateQuantity(lineItemId, newQuantity)
        }
      } else {
        const result = addToCart(cartItem, sourcePosition)
        if (result?.ok === false) {
          toast.error(result.error || 'Cannot add item from different restaurant. Please clear cart first.')
          return
        }
        if (newQuantity > 1) {
          updateQuantity(lineItemId, newQuantity)
        }
      }
    }
  }

  const closeItemDetail = useCallback(() => {
    setShowItemDetail(false)
    setShowShareOptions(false)
  }, [])

  const goToRestaurantForVariants = (item, restaurant) => {
    const restaurantSlug = restaurant.slug || restaurant.restaurantId || ""
    const itemId = item.id || item._id
    navigate(`/user/restaurants/${restaurantSlug}${itemId ? `?dish=${encodeURIComponent(itemId)}` : ""}`)
  }

  const handleItemClick = (item, restaurant) => {
    const availabilityStatus = getRestaurantAvailabilityStatus(restaurant)
    const isRestaurantOffline = !availabilityStatus.isOpen
    // Add restaurant info to item for display
    const itemWithRestaurant = {
      ...item,
      restaurant: restaurant.name,
      restaurantSlug: restaurant.slug || restaurant.restaurantId || "",
      description: item.description || `${item.name} from ${restaurant.name}`,
      customisable: item.customisable || false,
      notEligibleForCoupons: item.notEligibleForCoupons || false,
      isRestaurantOffline,
    }
    const defaultVariant = getDefaultFoodVariant(item)
    const lineItemId = getLineItemIdForDish(item, defaultVariant)
    const existingQuantity = quantities[lineItemId] || 0
    setItemDetailQuantity(existingQuantity > 0 ? existingQuantity : 1)
    setSelectedItem(itemWithRestaurant)
    setShowShareOptions(false)
    setShowItemDetail(true)
  }

  const handleBookmarkClick = (itemId) => {
    setBookmarkedItems((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(itemId)) {
        newSet.delete(itemId)
      } else {
        newSet.add(itemId)
      }
      return newSet
    })
  }

  const handleShareItem = async (item) => {
    if (!item) return

    const itemId = item.id || item._id
    const restaurantSlug = item.restaurantSlug || item.slug || ""
    const shareUrl = restaurantSlug
      ? `${window.location.origin}/user/restaurants/${restaurantSlug}${itemId ? `?dish=${encodeURIComponent(itemId)}` : ""}`
      : window.location.href

    try {
      if (navigator.share) {
        await navigator.share({
          title: item.name || "Dish",
          text: `Check out ${item.name || "this dish"} from ${item.restaurant || "Under 250"}`,
          url: shareUrl,
        })
        return
      }
    } catch (error) {
      if (error?.name === "AbortError") return
    }

    setShowShareOptions(true)
  }

  const handleShareOption = async (type) => {
    if (!selectedItem) return

    const itemId = selectedItem.id || selectedItem._id
    const restaurantSlug = selectedItem.restaurantSlug || selectedItem.slug || ""
    const shareUrl = restaurantSlug
      ? `${window.location.origin}/user/restaurants/${restaurantSlug}${itemId ? `?dish=${encodeURIComponent(itemId)}` : ""}`
      : window.location.href
    const shareText = `Check out ${selectedItem.name || "this dish"} from ${selectedItem.restaurant || "Under 250"}`
    const encodedUrl = encodeURIComponent(shareUrl)
    const encodedText = encodeURIComponent(`${shareText} ${shareUrl}`)

    try {
      if (type === "copy") {
        await navigator.clipboard.writeText(shareUrl)
        toast.success("Link copied to clipboard!")
      } else if (type === "whatsapp") {
        window.open(`https://wa.me/?text=${encodedText}`, "_blank", "noopener,noreferrer")
      } else if (type === "telegram") {
        window.open(`https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(shareText)}`, "_blank", "noopener,noreferrer")
      } else if (type === "sms") {
        window.location.href = `sms:?&body=${encodedText}`
      } else if (type === "email") {
        window.location.href = `mailto:?subject=${encodeURIComponent(selectedItem.name || "Dish")}&body=${encodedText}`
      }
      setShowShareOptions(false)
    } catch {
      toast.error("Failed to share link")
    }
  }

  const handleItemDetailTouchStart = (e) => {
    if (!showItemDetail) return
    itemDetailGestureRef.current = {
      startY: e.touches?.[0]?.clientY || 0,
      dragging: true,
    }
  }

  const handleItemDetailTouchEnd = (e) => {
    if (!showItemDetail || !itemDetailGestureRef.current.dragging) return

    const endY = e.changedTouches?.[0]?.clientY || 0
    const deltaY = endY - itemDetailGestureRef.current.startY
    const contentScrollTop = itemDetailContentRef.current?.scrollTop || 0

    itemDetailGestureRef.current.dragging = false

    if (contentScrollTop <= 0 && deltaY > 80) {
      closeItemDetail()
    }
  }

  const handleItemDetailWheel = (e) => {
    if (!showItemDetail) return
    const contentScrollTop = itemDetailContentRef.current?.scrollTop || 0
    if (contentScrollTop <= 0 && e.deltaY < -20) {
      closeItemDetail()
    }
  }

  // Check if should show grayscale (only when user is out of service)
  const shouldShowGrayscale = isOutOfService

  return (

    <div className={`relative min-h-screen bg-white dark:bg-[#0a0a0a] ${shouldShowGrayscale ? 'grayscale opacity-75' : ''}`}>
      <div
        ref={stickyHeaderRef}
        className="fixed top-0 left-0 right-0 z-40 w-full px-4 py-2 sm:py-3 rounded-b-[2rem] shadow-lg bg-[#D91F3A]"
      >
        <div className="relative z-10 max-w-7xl mx-auto flex items-center justify-between">
          {/* Left: Takeaway-style heading (location only changeable from Delivery home) */}
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-bold text-white/80 uppercase tracking-[0.2em] drop-shadow-md">
              Budget Meals
            </span>
            <h1 className="text-xl font-bold text-white flex items-center gap-2 drop-shadow-md">
              Under {RUPEE_SYMBOL}{under250PriceLimit}
            </h1>
          </div>

          {/* Right: Wallet & Profile Actions */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Wallet Button */}
            <Link 
              to="/food/user/wallet" 
              state={{ from: "/food/user/under-250" }}
              onClick={(e) => {
                if (!isModuleAuthenticated('user')) {
                  e.preventDefault();
                  window.dispatchEvent(new CustomEvent('show-login-required'));
                }
              }}
              className="p-1.5 active:scale-90 transition-all flex items-center justify-center text-white"
            >
              <Wallet className="h-[26px] w-[26px] antialiased" strokeWidth={2.2} />
            </Link>

            {/* Profile Avatar */}
            <Link 
              to="/food/user/profile" 
              state={{ from: "/food/user/under-250" }}
              onClick={(e) => {
                if (!isModuleAuthenticated('user')) {
                  e.preventDefault();
                  window.dispatchEvent(new CustomEvent('show-login-required'));
                }
              }}
              className="h-9 w-9 relative flex items-center justify-center rounded-full border-[1.5px] border-white ring-1 ring-red-500/80 cursor-pointer active:scale-95 transition-all overflow-hidden"
            >
              <Avatar className="h-full w-full bg-[#FFF5E6] dark:bg-gray-800">
                <AvatarImage 
                  src={userProfile?.profileImage || "/assets/images/profile_avatar.webp"} 
                  alt="Profile" 
                  className="object-cover"
                />
                <AvatarFallback className="bg-[#FFF5E6] dark:bg-gray-800 text-[20px] font-black text-[#DC2626] leading-none tracking-tighter antialiased">
                  <img src="/assets/images/profile_avatar.webp" alt="Profile" className="object-cover w-full h-full" />
                </AvatarFallback>
              </Avatar>
            </Link>
          </div>
        </div>
      </div>

      {/* Banner Section */}
      <div
        ref={bannerShellRef}
        data-banner-shell="true"
        className="relative w-full overflow-hidden h-[clamp(210px,34vw,430px)] animate-fade-in"
      >
        {/* Sliding Banner Container */}
        <div
          className="flex w-full h-full"
          style={{
            transform: `translateX(-${currentBannerIndex * 100}%)`,
            transition: isTransitionEnabled ? "transform 500ms cubic-bezier(0.25, 1, 0.5, 1)" : "none"
          }}
        >
          {(bannerImages.length > 1 ? [...bannerImages, bannerImages[0]] : (bannerImages.length > 0 ? bannerImages : [under250Banner])).map((imgSrc, index) => (
            <div key={`${index}-${imgSrc}`} className="w-full h-full flex-shrink-0 relative">
              <OptimizedImage
                src={imgSrc}
                alt={`Under 250 Banner ${index + 1}`}
                priority={index === 0}
                className="w-full h-full"
                objectFit="cover"
                style={{ objectPosition: "center 90%" }}
              />
            </div>
          ))}
        </div>

        {/* Subtle gradient overlay to ensure navbar readability if needed */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-transparent pointer-events-none z-10" />

        {/* Bottom Right Carousel Pagination Dots */}
        {bannerImages.length > 1 && (
          <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 pointer-events-auto">
            {bannerImages.map((_, dotIndex) => {
              const activeDotIndex = currentBannerIndex === bannerImages.length ? 0 : currentBannerIndex;
              return (
                <button
                  key={dotIndex}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsTransitionEnabled(true);
                    setCurrentBannerIndex(dotIndex);
                    resetBannerAutoSlide();
                  }}
                  className={`transition-all duration-300 rounded-full ${
                    activeDotIndex === dotIndex
                      ? "w-4 h-1.5 bg-white shadow-sm"
                      : "w-1.5 h-1.5 bg-white/50 hover:bg-white/80"
                  }`}
                  aria-label={`Go to banner ${dotIndex + 1}`}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Content Section — large bottom padding on mobile so the last dishes are
          not hidden behind the fixed bottom navigation (which would otherwise
          steal taps meant for the nav buttons). */}
      <div className="relative max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 xl:px-12 space-y-0 pt-2 sm:pt-3 md:pt-4 lg:pt-6 pb-32 md:pb-8 lg:pb-10">

        <section className="space-y-1 sm:space-y-1.5">
          <div
            className="flex gap-3 sm:gap-4 md:gap-5 lg:gap-6 overflow-x-auto md:overflow-x-visible overflow-y-visible scrollbar-hide scroll-smooth px-2 sm:px-3 py-2 sm:py-3 md:py-4"
            style={{
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              touchAction: "pan-x pan-y pinch-zoom",
              overflowY: "hidden",
            }}
          >
            {/* All Button */}
            <div className="flex-shrink-0 cursor-pointer" onClick={() => setActiveCategory(null)}>
              <motion.div
                className="flex flex-col items-center gap-2 w-[62px] sm:w-24 md:w-28"
                whileHover={{ scale: 1.1, y: -4 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
              >
                <div className={`w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-full overflow-hidden shadow-md transition-all flex items-center justify-center ${!activeCategory ? 'bg-gradient-to-br from-[#DC2626] to-[#991B1B] text-white ring-2 ring-[#DC2626] ring-offset-2' : 'bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-200'}`}>
                  <Utensils className="w-6 h-6 sm:w-10 sm:h-10 md:w-12 md:h-12" />
                </div>
                <span className={`text-xs sm:text-sm md:text-base font-bold text-center pb-1 ${!activeCategory ? 'text-[#DC2626]' : 'text-gray-800 dark:text-gray-200'}`}>
                  All
                </span>
              </motion.div>
            </div>
            {loadingCategories ? (
              <>
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="flex-shrink-0 flex flex-col items-center gap-2 w-[62px] sm:w-24 md:w-28">
                    <div className="w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-full skeleton-shimmer" />
                    <div className="h-3.5 skeleton-shimmer rounded w-12" />
                  </div>
                ))}
              </>
            ) : (
              displayCategories.map((category, index) => {
                const isActive = activeCategory === category.id
                return (
                  <div key={category.id} className="flex-shrink-0 cursor-pointer" onClick={() => setActiveCategory(isActive ? null : category.id)}>
                      <motion.div
                        className="flex flex-col items-center gap-2 w-[62px] sm:w-24 md:w-28"
                        whileHover={{ scale: 1.1, y: -4 }}
                        whileTap={{ scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                      >
                        <div className={`w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-full overflow-hidden shadow-md transition-all ${isActive ? 'ring-2 ring-[#DC2626] ring-offset-2' : ''}`}>
                          <OptimizedImage
                            src={category.image}
                            alt={category.name}
                            className="w-full h-full bg-white rounded-full"
                            objectFit="cover"
                            sizes="(max-width: 640px) 62px, (max-width: 768px) 96px, 112px"
                            placeholder="blur"
                          />
                        </div>
                        <span className={`text-xs sm:text-sm md:text-base font-semibold text-gray-800 dark:text-gray-200 text-center pb-1 ${isActive ? 'text-[#DC2626]' : ''}`}>
                          {category.name.length > 7 ? `${category.name.slice(0, 7)}...` : category.name}
                        </span>
                      </motion.div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        <section className="py-2 sm:py-3 md:py-4">
          <div className="flex items-center gap-2 md:gap-3">
            <Button
              variant="outline"
              onClick={() => setShowSortPopup(true)}
              className="h-8 sm:h-9 md:h-10 px-3 sm:px-4 md:px-5 rounded-md flex items-center gap-2 whitespace-nowrap flex-shrink-0 font-medium transition-all bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm md:text-base"
            >
              <ArrowDownUp className="h-4 w-4 md:h-5 md:w-5 rotate-90" />
              <span className="text-sm md:text-base font-medium">
                {selectedSort ? sortOptions.find(opt => opt.id === selectedSort)?.label : 'Sort'}
              </span>
              <ChevronDown className="h-3 w-3 md:h-4 md:w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={() => setUnder30MinsFilter(!under30MinsFilter)}
              className={`h-8 sm:h-9 md:h-10 px-3 sm:px-4 md:px-5 rounded-md flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 font-medium transition-all text-sm md:text-base ${under30MinsFilter
                ? 'bg-[#DC2626] text-white border border-[#DC2626] hover:bg-[#991B1B]'
                : 'bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300'
                }`}
            >
              <Timer className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5" />
              <span className="text-xs sm:text-sm md:text-base font-medium">Under 30 mins</span>
            </Button>
          </div>
        </section>


        {/* Restaurant Menu Sections */}
        {loadingRestaurants && under250Restaurants.length === 0 ? (
          <div className="space-y-8 pt-4 sm:pt-6 md:pt-8 lg:pt-10">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-4">
                {/* Skeleton Header */}
                <div className="flex flex-col gap-2">
                  <div className="h-6 sm:h-8 w-48 skeleton-shimmer rounded-lg"></div>
                  <div className="flex gap-4">
                    <div className="h-4 w-24 skeleton-shimmer rounded"></div>
                    <div className="h-4 w-24 skeleton-shimmer rounded"></div>
                  </div>
                </div>
                {/* Skeleton Grid */}
                <div className="flex gap-4 overflow-hidden pb-4">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="flex-shrink-0 w-[200px] sm:w-[220px] h-64 bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-gray-800 p-3 space-y-3 shadow-sm">
                      <div className="w-full h-32 skeleton-shimmer rounded-lg" />
                      <div className="h-4 skeleton-shimmer rounded w-3/4" />
                      <div className="flex justify-between items-center pt-2">
                        <div className="h-5 skeleton-shimmer rounded w-16" />
                        <div className="h-8 skeleton-shimmer rounded w-16" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : sortedAndFilteredRestaurants.length === 0 ? (
          <div className="flex flex-col justify-center items-center py-16 px-6 text-center">
            <p className="text-base sm:text-lg font-semibold text-gray-700 dark:text-gray-200">
              {under250Restaurants.length === 0
                ? `No dishes available under ${RUPEE_SYMBOL}${under250PriceLimit}`
                : "No dishes match the selected filters"}
            </p>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-sm">
              {under250Restaurants.length === 0
                ? "Check back later or browse Delivery / Takeaway for more options."
                : "Try clearing Sort or category filters."}
            </p>
          </div>
        ) : (
          <>
          {sortedAndFilteredRestaurants.slice(0, visibleRestaurantCount).map((restaurant) => {
            const restaurantSlug = restaurant.slug || restaurant.name.toLowerCase().replace(/\s+/g, "-")
            const availabilityStatus = getRestaurantAvailabilityStatus(restaurant)
            const isRestaurantOffline = !availabilityStatus.isOpen
            return (
              <section key={restaurant.id} className={`pt-4 sm:pt-6 md:pt-8 lg:pt-10 ${isRestaurantOffline ? 'opacity-80' : ''}`}>
                {/* Restaurant Header */}
                <div className="flex items-start justify-between mb-3 md:mb-4 lg:mb-6">
                  <div className="flex-1">
                    <h3 className="text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-4xl font-bold text-gray-900 dark:text-white mb-1 md:mb-2">
                      {restaurant.name}
                    </h3>
                    <div className="flex items-center gap-2 md:gap-4 mt-1.5 flex-wrap">
                      <div className="flex items-center gap-1.5 text-xs md:text-sm font-semibold text-gray-500 dark:text-gray-400">
                        <Clock className="h-3.5 w-3.5 md:h-4 md:w-4" strokeWidth={2.5} />
                        <span>{restaurant.deliveryTime}</span>
                      </div>
                      <div className="w-[1px] h-3 bg-gray-200 dark:bg-gray-800 hidden xs:block"></div>
                      <div className="flex items-center gap-1.5 text-xs md:text-sm font-semibold text-gray-500 dark:text-gray-400">
                        <MapPin className="h-3.5 w-3.5 md:h-4 md:w-4" strokeWidth={2.5} />
                        <span>{restaurant.distance}</span>
                      </div>
                      <div className="flex items-center gap-1 px-2 py-0.5 md:px-2.5 md:py-1 bg-[#267e3e] text-white rounded-md">
                        <Star className="h-3 w-3 md:h-3.5 md:w-3.5 fill-white text-white" />
                        <span className="text-[10px] md:text-xs font-black">{restaurant.rating}</span>
                      </div>
                      <div className="h-4 w-[1px] bg-gray-200 dark:bg-gray-800"></div>
                      <span className="text-[10px] md:text-xs font-bold text-gray-400 dark:text-gray-500">
                        {restaurant.totalRatings > 0 ? `${restaurant.totalRatings >= 1000 ? `${(restaurant.totalRatings / 1000).toFixed(1)}K` : restaurant.totalRatings}+ Ratings` : 'New'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Menu Items Horizontal Scroll */}
                {restaurant.menuItems && restaurant.menuItems.length > 0 && (
                  <div className="space-y-2 md:space-y-3 lg:space-y-4">
                    <div
                      className="flex md:grid gap-3 sm:gap-4 md:gap-5 lg:gap-6 overflow-x-auto md:overflow-x-visible overflow-y-visible scrollbar-hide scroll-smooth pb-2 md:pb-0 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                      style={{
                        scrollbarWidth: "none",
                        msOverflowStyle: "none",
                        touchAction: "pan-x pan-y pinch-zoom",
                        overflowY: "hidden",
                      }}
                    >
                       {restaurant.menuItems.map((item, itemIndex) => {
                        const defaultVariant = getDefaultFoodVariant(item)
                        const lineItemId = getLineItemIdForDish(item, defaultVariant)
                        const quantity = quantities[lineItemId] || 0
                        const isOffline = shouldShowGrayscale || isRestaurantOffline
                        return (
                          <motion.div
                            key={item.id}
                            className={`flex-shrink-0 w-[200px] sm:w-[220px] md:w-full bg-white dark:bg-[#1a1a1a] rounded-lg md:rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden cursor-pointer ${
                              isOffline ? 'grayscale opacity-75' : ''
                            }`}
                            onClick={() => handleItemClick(item, restaurant)}
                            whileHover={isOffline ? {} : { y: -4, scale: 1.01 }}
                            transition={{ duration: 0.2 }}
                            style={{ boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)" }}
                          >
                            {/* Item Image */}
                            <div className="relative w-full h-32 sm:h-36 md:h-40 lg:h-48 xl:h-52 overflow-hidden">
                              <motion.div
                                className="absolute inset-0"
                                whileHover={isOffline ? {} : { scale: 1.1 }}
                                transition={{ duration: 0.5, ease: "easeOut" }}
                              >
                                <OptimizedImage
                                  src={item.image}
                                  alt={item.name}
                                  className="w-full h-full"
                                  objectFit="cover"
                                  sizes="(max-width: 640px) 200px, (max-width: 768px) 220px, 100vw"
                                  placeholder="blur"
                                  priority={itemIndex < 4}
                                />
                              </motion.div>
                              {/* Gradient Overlay on Hover */}
                              {!isOffline && (
                                <motion.div
                                  className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent"
                                  initial={{ opacity: 0 }}
                                  whileHover={{ opacity: 1 }}
                                  transition={{ duration: 0.3 }}
                                />
                              )}
                              {/* Veg Indicator */}
                              {item.isVeg && (
                                <motion.div
                                  className="absolute top-2 left-2 md:top-3 md:left-3 h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6 rounded border-2 border-green-600 bg-white flex items-center justify-center z-10"
                                  whileHover={{ scale: 1.2, rotate: 5 }}
                                  transition={{ duration: 0.2 }}
                                >
                                  <div className="h-2 w-2 md:h-2.5 md:w-2.5 lg:h-3 lg:w-3 rounded-full bg-green-600" />
                                </motion.div>
                              )}

                            </div>

                            {/* Item Details */}
                            <div className="p-3 md:p-4 lg:p-5">
                              <div className="flex items-center gap-1 md:gap-2 mb-1 md:mb-2 lg:mb-3">
                                {item.isVeg && (
                                  <div className="h-3 w-3 md:h-4 md:w-4 lg:h-5 lg:w-5 rounded border border-green-600 bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
                                    <div className="h-1.5 w-1.5 md:h-2 md:w-2 lg:h-2.5 lg:w-2.5 rounded-full bg-green-600" />
                                  </div>
                                )}
                                <span className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white truncate">
                                  1 x {item.name}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-base md:text-lg lg:text-xl xl:text-2xl font-bold text-gray-900 dark:text-white">
                                    {RUPEE_SYMBOL}{Math.round(item.price)}
                                  </p>
                                  {item.bestPrice && (
                                    <p className="text-xs md:text-sm lg:text-base text-gray-500 dark:text-gray-400">Best price</p>
                                  )}
                                </div>
                                {quantity > 0 && !isRestaurantOffline ? (
                                  <div
                                    className="flex items-center gap-1.5 bg-[#DC2626] text-white rounded-lg p-1 shadow-md"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        const defaultVariant = getDefaultFoodVariant(item)
                                        updateItemQuantity(item, quantity - 1, e, restaurant.name, defaultVariant)
                                      }}
                                      className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center hover:bg-black/20 rounded transition-colors text-white"
                                    >
                                      <Minus className="w-3.5 h-3.5 text-white" />
                                    </button>
                                    <span className="px-1 text-xs sm:text-sm font-bold min-w-[1.25rem] text-center text-white">
                                      {quantity}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        const defaultVariant = getDefaultFoodVariant(item)
                                        updateItemQuantity(item, quantity + 1, e, restaurant.name, defaultVariant)
                                      }}
                                      className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center hover:bg-black/20 rounded transition-colors text-white"
                                    >
                                      <Plus className="w-3.5 h-3.5 text-white" />
                                    </button>
                                  </div>
                                ) : (
                                  <Button
                                    variant={"ghost"}
                                    size="sm"
                                    disabled={isOffline}
                                    className={`h-7 md:h-8 lg:h-9 px-3 md:px-4 lg:px-5 text-xs md:text-sm lg:text-base font-bold shadow-md transition-all active:scale-95 ${isOffline
                                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 border-gray-300 dark:border-gray-700 cursor-not-allowed opacity-50'
                                      : 'bg-[#DC2626] text-white hover:bg-[#991B1B]'
                                      }`}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (!isOffline) {
                                        const defaultVariant = getDefaultFoodVariant(item)
                                        updateItemQuantity(item, 1, e, restaurant.name, defaultVariant)
                                      }
                                    }}
                                  >
                                    Add
                                  </Button>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        )
                      })}
                    </div>

                    {/* View Full Menu Button */}
                    <Link className="flex justify-center mt-2 md:mt-3 lg:mt-4" to={`/user/restaurants/${restaurantSlug}?under250=true`}>
                      <Button
                        variant="outline"
                        className="w-min align-center text-center rounded-lg md:rounded-xl mx-auto bg-gray-50 dark:bg-[#1a1a1a] hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-white text-gray-700 border-gray-200 dark:border-gray-800 h-9 md:h-10 lg:h-11 px-4 md:px-6 lg:px-8 text-sm md:text-base lg:text-lg"
                      >
                        View full menu <ArrowRight className="h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6 ml-2 text-gray-700 dark:text-gray-300" />
                      </Button>
                    </Link>
                  </div>
                )}
              </section>
            )
          })}
          {visibleRestaurantCount < sortedAndFilteredRestaurants.length ? (
            <div className="flex justify-center py-6 pb-28">
              <Button
                type="button"
                variant="outline"
                className="rounded-full px-6 touch-manipulation"
                onClick={() =>
                  setVisibleRestaurantCount((n) => n + UNDER250_LIST_MAX_VISIBLE)
                }
              >
                Show more restaurants
              </Button>
            </div>
          ) : (
            <div className="h-24" />
          )}
          </>
        )}
      </div>

      {/* Sort Popup - Bottom Sheet */}
      <AnimatePresence>
        {showSortPopup && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              onClick={() => setShowSortPopup(false)}
              className="fixed inset-0 bg-black/50 z-100"
            />

            {/* Center Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.1, ease: "easeOut" }}
              className="fixed inset-0 flex items-center justify-center z-[110] px-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-full max-w-sm bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b dark:border-gray-800">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">Sort By</h2>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleClearAll}
                      className="text-[#DC2626] dark:text-[#FEE2E2] font-medium text-sm hover:opacity-85 transition-opacity"
                    >
                      Clear all
                    </button>
                    <button
                      onClick={() => setShowSortPopup(false)}
                      className="p-1.5 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="px-5 py-4 flex flex-col gap-3">
                  {sortOptions.map((option) => (
                    <button
                      key={option.id || 'relevance'}
                      onClick={() => {
                        setDraftSelectedSort(option.id);
                        setSelectedSort(option.id);
                        setShowSortPopup(false);
                      }}
                      className={`px-4 py-3.5 rounded-xl border text-left transition-colors flex items-center justify-between ${selectedSort === option.id
                        ? 'border-[#DC2626] bg-[#fdfafc] dark:bg-[#DC2626]/20'
                        : 'border-gray-200 dark:border-gray-800 hover:border-[#DC2626]'
                        }`}
                    >
                      <span className={`text-sm font-medium ${selectedSort === option.id ? 'text-[#DC2626] dark:text-[#FEE2E2]' : 'text-gray-700 dark:text-gray-300'}`}>
                        {option.label}
                      </span>
                      {selectedSort === option.id && (
                        <div className="w-5 h-5 rounded-full bg-[#DC2626] flex items-center justify-center flex-shrink-0">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>

                {/* Footer */}
                <div className="flex items-center gap-3 px-5 pb-5">
                  <button
                    onClick={() => setShowSortPopup(false)}
                    className="flex-1 py-3 text-center font-bold text-white bg-gray-800 dark:bg-gray-700 hover:bg-gray-900 dark:hover:bg-gray-600 rounded-xl transition-colors text-sm"
                  >
                    Close
                  </button>
                  <button
                    onClick={handleApply}
                    className="flex-1 py-3 font-semibold rounded-xl transition-colors text-sm bg-[#DC2626] text-white hover:bg-[#991B1B]"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Item Detail Popup */}
      <AnimatePresence>
        {showItemDetail && selectedItem && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 bg-black/40 z-[9999]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={closeItemDetail}
            />

            {/* Item Detail Bottom Sheet */}
            <motion.div
              className="fixed left-0 right-0 bottom-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:max-w-2xl lg:max-w-4xl xl:max-w-5xl z-[10000] bg-white dark:bg-[#1a1a1a] rounded-t-3xl shadow-2xl max-h-[90vh] md:max-h-[85vh] flex flex-col"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.15, type: "spring", damping: 30, stiffness: 400 }}
              onClick={(e) => e.stopPropagation()}
              onTouchStart={handleItemDetailTouchStart}
              onTouchEnd={handleItemDetailTouchEnd}
              onWheel={handleItemDetailWheel}
            >
              {/* Close Button - Top Center Above Popup with 4px gap */}
              <div className="absolute -top-[44px] left-1/2 -translate-x-1/2 z-[10001]">
                <motion.button
                  onClick={closeItemDetail}
                  className="h-10 w-10 md:h-12 md:w-12 rounded-full bg-gray-800 dark:bg-gray-700 flex items-center justify-center hover:bg-gray-900 dark:hover:bg-gray-600 transition-colors shadow-lg"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <X className="h-5 w-5 md:h-6 md:w-6 text-white" />
                </motion.button>
              </div>

              {/* Image Section */}
              <div className={`relative w-full h-64 md:h-80 lg:h-96 xl:h-[500px] overflow-hidden rounded-t-3xl ${
                (shouldShowGrayscale || selectedItem.isRestaurantOffline) ? 'grayscale opacity-75' : ''
              }`}>
                <OptimizedImage
                  src={selectedItem.image}
                  alt={selectedItem.name}
                  className="w-full h-full"
                  objectFit="cover"
                  sizes="100vw"
                  priority={true}
                  placeholder="blur"
                />
                {/* Bookmark and Share Icons Overlay */}
                <div className="absolute bottom-4 right-4 flex items-center gap-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleBookmarkClick(selectedItem.id)
                    }}
                    className={`h-10 w-10 rounded-full border flex items-center justify-center transition-all duration-300 ${bookmarkedItems.has(selectedItem.id)
                      ? "border-red-500 bg-red-50 text-red-500"
                      : "border-white bg-white/90 text-gray-600 hover:bg-white"
                      }`}
                  >
                    <Bookmark
                      className={`h-5 w-5 transition-all duration-300 ${bookmarkedItems.has(selectedItem.id) ? "fill-red-500" : ""
                        }`}
                    />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleShareItem(selectedItem)
                    }}
                    className="h-10 w-10 rounded-full border border-white bg-white/90 text-gray-600 hover:bg-white flex items-center justify-center transition-colors"
                  >
                    <Share2 className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Content Section */}
              <div
                ref={itemDetailContentRef}
                className="flex-1 overflow-y-auto px-4 md:px-6 lg:px-8 xl:px-10 py-4 md:py-6 lg:py-8"
              >
                {/* Item Name and Indicator */}
                <div className="flex items-start justify-between mb-3 md:mb-4 lg:mb-6">
                  <div className="flex items-center gap-2 md:gap-3 flex-1">
                    {selectedItem.isVeg && (
                      <div className="h-5 w-5 md:h-6 md:w-6 lg:h-7 lg:w-7 rounded border-2 border-green-600 dark:border-green-500 bg-green-50 dark:bg-green-900/20 flex items-center justify-center flex-shrink-0">
                        <div className="h-2.5 w-2.5 md:h-3 md:w-3 lg:h-3.5 lg:w-3.5 rounded-full bg-green-600 dark:bg-green-500" />
                      </div>
                    )}
                    <h2 className="text-xl md:text-2xl lg:text-3xl xl:text-4xl font-bold text-gray-900 dark:text-white">
                      {selectedItem.name}
                    </h2>
                  </div>
                  {/* Bookmark and Share Icons (Desktop) */}
                  <div className="hidden md:flex items-center gap-2 lg:gap-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleBookmarkClick(selectedItem.id)
                      }}
                      className={`h-8 w-8 lg:h-10 lg:w-10 rounded-full border flex items-center justify-center transition-all duration-300 ${bookmarkedItems.has(selectedItem.id)
                        ? "border-red-500 bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400"
                        : "border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                        }`}
                    >
                      <Bookmark
                        className={`h-4 w-4 lg:h-5 lg:w-5 transition-all duration-300 ${bookmarkedItems.has(selectedItem.id) ? "fill-red-500 dark:fill-red-400" : ""
                          }`}
                      />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleShareItem(selectedItem)
                      }}
                      className="h-8 w-8 lg:h-10 lg:w-10 rounded-full border border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 flex items-center justify-center transition-colors"
                    >
                      <Share2 className="h-4 w-4 lg:h-5 lg:w-5" />
                    </button>
                  </div>
                </div>

                {/* Description */}
                <p className="text-sm md:text-base lg:text-lg text-gray-600 dark:text-gray-400 mb-4 md:mb-6 lg:mb-8 leading-relaxed">
                  {selectedItem.description || `${selectedItem.name} from ${selectedItem.restaurant || 'Under 250'}`}
                </p>

                {/* Highly Reordered Progress Bar */}
                {selectedItem.customisable && (
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 h-0.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-[#DC2626]" style={{ width: '50%' }} />
                    </div>
                    <span className="text-xs text-gray-600 dark:text-gray-400 font-medium whitespace-nowrap">
                      highly reordered
                    </span>
                  </div>
                )}

                {/* Not Eligible for Coupons */}
                {selectedItem.notEligibleForCoupons && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-4">
                    NOT ELIGIBLE FOR COUPONS
                  </p>
                )}
              </div>

              {/* Bottom Action Bar */}
              <div className="border-t dark:border-gray-800 border-gray-200 px-4 md:px-6 lg:px-8 xl:px-10 py-4 md:py-5 lg:py-6 bg-white dark:bg-[#1a1a1a]">
                {selectedItem.isRestaurantOffline && (
                  <p className="text-sm font-semibold text-red-500 mb-3 text-center">
                    Restaurant is currently closed and not accepting orders.
                  </p>
                )}
                <div className="flex items-center gap-4 md:gap-5 lg:gap-6">
                  {/* Quantity Selector */}
                  <div className={`flex items-center gap-3 md:gap-4 lg:gap-5 border-2 rounded-lg md:rounded-xl px-3 md:px-4 lg:px-5 h-[44px] md:h-[50px] lg:h-[56px] ${
                    (shouldShowGrayscale || selectedItem.isRestaurantOffline)
                      ? 'border-gray-300 dark:border-gray-700 opacity-50'
                      : 'border-gray-300 dark:border-gray-700'
                    }`}>
                    <button
                      onClick={(e) => {
                        if (!shouldShowGrayscale && !selectedItem.isRestaurantOffline) {
                          e.stopPropagation()
                          setItemDetailQuantity((prev) => Math.max(1, prev - 1))
                        }
                      }}
                      disabled={itemDetailQuantity <= 1 || shouldShowGrayscale || selectedItem.isRestaurantOffline}
                      className={`${(shouldShowGrayscale || selectedItem.isRestaurantOffline || itemDetailQuantity <= 1)
                        ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                        }`}
                    >
                      <Minus className="h-5 w-5 md:h-6 md:w-6 lg:h-7 lg:w-7" />
                    </button>
                    <span className={`text-lg md:text-xl lg:text-2xl font-semibold min-w-[2rem] md:min-w-[2.5rem] lg:min-w-[3rem] text-center ${
                      (shouldShowGrayscale || selectedItem.isRestaurantOffline)
                        ? 'text-gray-400 dark:text-gray-600'
                        : 'text-gray-900 dark:text-white'
                      }`}>
                      {itemDetailQuantity}
                    </span>
                    <button
                      onClick={(e) => {
                        if (!shouldShowGrayscale && !selectedItem.isRestaurantOffline) {
                          e.stopPropagation()
                          setItemDetailQuantity((prev) => prev + 1)
                        }
                      }}
                      disabled={shouldShowGrayscale || selectedItem.isRestaurantOffline}
                      className={(shouldShowGrayscale || selectedItem.isRestaurantOffline)
                        ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                      }
                    >
                      <Plus className="h-5 w-5 md:h-6 md:w-6 lg:h-7 lg:w-7" />
                    </button>
                  </div>

                  {/* Add / Update Item Button */}
                  <Button
                    className={`flex-1 h-[44px] md:h-[50px] lg:h-[56px] rounded-lg md:rounded-xl font-semibold flex items-center justify-center gap-2 text-sm md:text-base lg:text-lg ${
                      (shouldShowGrayscale || selectedItem.isRestaurantOffline)
                        ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-600 cursor-not-allowed opacity-50'
                        : 'bg-[#DC2626] hover:bg-[#991B1B] dark:bg-[#DC2626] dark:hover:bg-[#991B1B] text-white'
                        }`}
                    onClick={(e) => {
                      if (!shouldShowGrayscale && !selectedItem.isRestaurantOffline) {
                        const defaultVariant = getDefaultFoodVariant(selectedItem)
                        updateItemQuantity(selectedItem, itemDetailQuantity, e, selectedItem.restaurant, defaultVariant)
                        closeItemDetail()
                      }
                    }}
                    disabled={shouldShowGrayscale || selectedItem.isRestaurantOffline}
                  >
                    <span>{quantities[getLineItemIdForDish(selectedItem, getDefaultFoodVariant(selectedItem))] > 0 ? "Update item" : "Add item"}</span>
                    <span className="text-base md:text-lg lg:text-xl font-bold">
                      {RUPEE_SYMBOL}{Math.round((getDefaultFoodVariant(selectedItem)?.price ?? selectedItem.price) * itemDetailQuantity)}
                    </span>
                  </Button>

                  {/* Remove Button when item is in cart */}
                  {quantities[getLineItemIdForDish(selectedItem, getDefaultFoodVariant(selectedItem))] > 0 && (
                    <Button
                      variant="outline"
                      className="h-[44px] md:h-[50px] lg:h-[56px] px-3 md:px-4 rounded-lg md:rounded-xl font-semibold text-red-600 border-red-200 hover:bg-red-50 text-xs md:text-sm"
                      onClick={(e) => {
                        if (!shouldShowGrayscale && !selectedItem.isRestaurantOffline) {
                          const defaultVariant = getDefaultFoodVariant(selectedItem)
                          updateItemQuantity(selectedItem, 0, e, selectedItem.restaurant, defaultVariant)
                          closeItemDetail()
                        }
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showShareOptions && selectedItem && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/40 z-[10020]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowShareOptions(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.2, type: "spring", damping: 28, stiffness: 320 }}
              className="fixed bottom-0 left-0 right-0 z-[10021] bg-white dark:bg-[#1a1a1a] rounded-t-3xl shadow-2xl px-4 py-4"
            >
              <div className="flex justify-center pb-3">
                <div className="w-12 h-1 bg-gray-300 rounded-full" />
              </div>
              <div className="flex items-center justify-between pb-4">
                <h3 className="text-base md:text-lg font-semibold text-gray-900 dark:text-white">Share dish</h3>
                <button
                  onClick={() => setShowShareOptions(false)}
                  className="text-sm font-medium text-gray-500 dark:text-gray-400"
                >
                  Close
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: "whatsapp", label: "WhatsApp" },
                  { id: "telegram", label: "Telegram" },
                  { id: "sms", label: "SMS" },
                  { id: "email", label: "Email" },
                  { id: "copy", label: "Copy Link" },
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => handleShareOption(option.id)}
                    className="rounded-2xl border border-gray-200 dark:border-gray-700 px-4 py-3 text-sm font-medium text-gray-800 dark:text-gray-200 hover:border-[#DC2626] hover:text-[#DC2626] transition-colors"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add to Cart Animation */}
      <AddToCartAnimation dynamicBottom={viewCartButtonBottom} />
    </div>
  )
}

