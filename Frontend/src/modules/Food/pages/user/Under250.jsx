import { Link, useNavigate } from "react-router-dom"
import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { Star, Clock, MapPin, ArrowDownUp, Timer, ArrowRight, ChevronDown, Bookmark, Share2, Plus, Minus, X, Search, Mic, ShoppingCart, Wallet, Bell, Menu, ArrowLeft } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Card, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { useSearchOverlay, useLocationSelector } from "@food/components/user/UserLayout"
import { useDeliveryLocation } from "@food/context/DeliveryLocationContext"
import { useCart } from "@food/context/CartContext"
import PageNavbar from "@food/components/user/PageNavbar"
import FoodFilterBar from "@food/components/user/FoodFilterBar"
import offerImage from "@food/assets/offerimage.png"
import switch99PromoBanner1 from "@food/assets/switch99_final_banner.png"
import switch99PromoBanner2 from "@food/assets/switch99_banner_2.jpg"
import FloatingHomeDock from "@food/components/user/FloatingHomeDock"
import VariantSelector from "@food/components/user/VariantSelector"
import FoodPriceDisplay from "@food/components/user/FoodPriceDisplay"
import OptimizedImage from "@food/components/OptimizedImage"
import cloudinaryImages from "@food/constants/cloudinaryImages.json"
import api from "@food/api"
import { restaurantAPI, adminAPI } from "@food/api"
import { API_BASE_URL } from "@food/api/config"
import { isModuleAuthenticated } from "@food/utils/auth"
import { calculateDistance, formatDistance } from "@food/utils/common"
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import {
  buildCartLineId,
  getDefaultFoodVariant,
  getFoodDiscountPercent,
  getFoodDisplayOtherPrice,
  getFoodVariants,
  hasFoodVariants,
} from "@food/utils/foodVariants"
const debugLog = (...args) => { }
const debugWarn = (...args) => { }
const debugError = (...args) => { }
const RUPEE_SYMBOL = "\u20B9"
const UNDER_250_FILTERS_STORAGE_KEY = "food-under-250-filters"

const resolveImageUrl = (url) => {
  if (!url || typeof url !== "string") return ""
  const trimmed = url.trim()
  if (!trimmed) return ""
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:")) {
    return trimmed
  }
  const cleanPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return `${API_BASE_URL.replace(/\/api\/?$/, "")}${cleanPath}`
}

const CURATED_SWITCH99_DISHES = [
  {
    name: "Special Veg Thali",
    price: 99,
    originalPrice: 199,
    isVeg: true,
    category: "Main Course",
    sectionName: "Main Course",
    image: cloudinaryImages.thali,
    rating: 4.8,
    description: "Paneer Butter Masala, Dal Tadka, 2 Butter Roti, Steamed Rice & Salad",
  },
  {
    name: "Steam Cheese Momos (8 Pcs)",
    price: 99,
    originalPrice: 149,
    isVeg: true,
    category: "chinese",
    sectionName: "chinese",
    image: cloudinaryImages.momos,
    rating: 4.7,
    description: "Served hot with spicy red chutney and mayo",
  },
  {
    name: "Classic Cheese Burger",
    price: 99,
    originalPrice: 139,
    isVeg: true,
    category: "Fast Food",
    sectionName: "Fast Food",
    image: cloudinaryImages.burger,
    rating: 4.6,
    description: "Crispy veg patty loaded with double cheese & secret sauce",
  },
  {
    name: "Chilli Paneer Dry & Noodles",
    price: 99,
    originalPrice: 189,
    isVeg: true,
    category: "chinese",
    sectionName: "chinese",
    image: cloudinaryImages.noodles,
    rating: 4.9,
    description: "Wok-tossed Hakka noodles with spicy Chilli Paneer",
  },
  {
    name: "Paneer Tikka Kathi Roll",
    price: 99,
    originalPrice: 159,
    isVeg: true,
    category: "Fast Food",
    sectionName: "Fast Food",
    image: cloudinaryImages.rolls,
    rating: 4.7,
    description: "Smoky tandoori paneer wrapped in flaky lachha paratha",
  },
  {
    name: "Choco Lava Cake",
    price: 99,
    originalPrice: 129,
    isVeg: true,
    category: "Sweet",
    sectionName: "Sweet",
    image: cloudinaryImages.cake,
    rating: 4.9,
    description: "Warm gooey chocolate lava center cake",
  },
  {
    name: "Chole Bhature Special (2 Pcs)",
    price: 99,
    originalPrice: 160,
    isVeg: true,
    category: "Main Course",
    sectionName: "Main Course",
    image: cloudinaryImages.chole_bhature,
    rating: 4.8,
    description: "Fluffy bhature served with rich Amritsari chole & pickle",
  },
  {
    name: "Special Masala Dosa",
    price: 99,
    originalPrice: 149,
    isVeg: true,
    category: "South Indian",
    sectionName: "South Indian",
    image: cloudinaryImages.dosa,
    rating: 4.6,
    description: "Crispy golden dosa filled with spiced potato masala",
  },
  {
    name: "Sponge Rasgulla (2 Pcs)",
    price: 99,
    originalPrice: 120,
    isVeg: true,
    category: "Sweet",
    sectionName: "Sweet",
    image: cloudinaryImages.rasgulla_clean,
    rating: 4.8,
    description: "Soft spongy rasgullas dipped in sweet syrup",
  },
]

const getSanitizedUnder250Image = (item) => {
  const name = (item.name || "").toLowerCase()
  const category = (item.category || item.sectionName || "").toLowerCase()
  const img = item.image || ""

  if (!img || img.includes("transparent") || img.includes("checkerboard") || img.includes("placeholder")) {
    if (name.includes("biryani")) return cloudinaryImages.biryani_clean
    if (name.includes("thali") || category.includes("thali")) return cloudinaryImages.thali
    if (name.includes("momo")) return cloudinaryImages.momos
    if (name.includes("burger")) return cloudinaryImages.burger
    if (name.includes("pizza")) return cloudinaryImages.pizza
    if (name.includes("noodle") || name.includes("maggie") || name.includes("maggi") || name.includes("hakka")) return cloudinaryImages.noodles
    if (name.includes("chole") || name.includes("bhature")) return cloudinaryImages.chole_bhature
    if (name.includes("dosa")) return cloudinaryImages.dosa
    if (name.includes("roll") || name.includes("kathi")) return cloudinaryImages.rolls
    if (name.includes("rasgulla")) return cloudinaryImages.rasgulla_clean
    if (name.includes("cake") || name.includes("brownie") || name.includes("lava")) return cloudinaryImages.cake
    if (name.includes("paneer")) return cloudinaryImages.paneer
    if (name.includes("sandwich")) return cloudinaryImages.sandwich
    if (name.includes("paratha")) return cloudinaryImages.paratha
    if (name.includes("pasta")) return cloudinaryImages.pasta
    if (name.includes("rice")) return cloudinaryImages.fried_rice
    return cloudinaryImages.biryani_clean
  }

  if (name.includes("biryani")) return cloudinaryImages.biryani_clean
  if (name.includes("maggie") || name.includes("maggi")) return cloudinaryImages.maggie_clean
  if (name.includes("rasgulla")) return cloudinaryImages.rasgulla_clean
  if (name.includes("thali")) return cloudinaryImages.thali
  if (name.includes("momo")) return cloudinaryImages.momos
  if (name.includes("burger")) return cloudinaryImages.burger
  if (name.includes("pizza")) return cloudinaryImages.pizza
  if (name.includes("chole") || name.includes("bhature")) return cloudinaryImages.chole_bhature
  if (name.includes("dosa")) return cloudinaryImages.dosa
  if (name.includes("roll")) return cloudinaryImages.rolls
  if (name.includes("cake")) return cloudinaryImages.cake

  return resolveImageUrl(img)
}

const buildSwitch99MenuItem = (food, restaurant, restaurantId) => {
  const foodType = String(food?.foodType || "").toLowerCase()
  const isVeg = foodType.includes("veg") && !foodType.includes("non")
  const rawImg =
    food?.image ||
    food?.imageUrl ||
    restaurant?.coverImages?.[0]?.url ||
    restaurant?.coverImages?.[0] ||
    restaurant?.menuImages?.[0]?.url ||
    restaurant?.menuImages?.[0] ||
    restaurant?.profileImage?.url ||
    restaurant?.profileImage ||
    ""

  const resolvedImg = resolveImageUrl(typeof rawImg === "string" ? rawImg : rawImg?.url || "")

  return {
    ...food,
    id: String(food?.id || food?._id || `${restaurantId}-${food?.name || "dish"}`),
    price: Number(food?.price || 0),
    otherPrice: Number(food?.otherPrice || 0),
    isVeg,
    category: food?.categoryName || food?.category || "",
    sectionName: food?.categoryName || food?.category || "",
    image: resolvedImg,
  }
}

const buildSwitch99RestaurantRow = (restaurant, menuItems, index, effectiveLocation) => {
  const restaurantId = restaurant?.restaurantId || restaurant?._id || restaurant?.id
  if (!restaurantId || !Array.isArray(menuItems) || menuItems.length === 0) return null

  const deliveryMinutes =
    Number(restaurant?.estimatedDeliveryTimeMinutes) ||
    Number(restaurant?.estimatedDeliveryTime) ||
    null
  const restaurantLocation = restaurant?.location
  const restaurantLat = Number(
    restaurantLocation?.latitude ??
    (Array.isArray(restaurantLocation?.coordinates) ? restaurantLocation.coordinates[1] : null)
  )
  const restaurantLng = Number(
    restaurantLocation?.longitude ??
    (Array.isArray(restaurantLocation?.coordinates) ? restaurantLocation.coordinates[0] : null)
  )
  const userLat = Number(effectiveLocation?.latitude)
  const userLng = Number(effectiveLocation?.longitude)
  const distanceInKm = (
    Number.isFinite(userLat) &&
    Number.isFinite(userLng) &&
    Number.isFinite(restaurantLat) &&
    Number.isFinite(restaurantLng)
  )
    ? calculateDistance(userLat, userLng, restaurantLat, restaurantLng)
    : null
  const fallbackDistance =
    typeof restaurant?.distance === "number"
      ? formatDistance(restaurant.distance)
      : (restaurant?.distance || "")

  return {
    id: String(restaurantId),
    restaurantId: String(restaurantId),
    slug:
      restaurant?.slug ||
      String(restaurant?.restaurantName || restaurant?.name || "")
        .toLowerCase()
        .replace(/\s+/g, "-"),
    name: restaurant?.restaurantName || restaurant?.name || "Restaurant",
    rating: Number(restaurant?.rating || 0),
    totalRatings: Number(restaurant?.totalRatings || restaurant?.ratingCount || 0),
    deliveryTime:
      restaurant?.estimatedDeliveryTime ||
      (deliveryMinutes ? `${deliveryMinutes} mins` : "30 mins"),
    distance: distanceInKm !== null ? formatDistance(distanceInKm) : fallbackDistance,
    distanceInKm,
    originalIndex: index,
    menuItems,
    isActive: restaurant.isActive,
    isAcceptingOrders: restaurant.isAcceptingOrders,
    outletTimings: restaurant.outletTimings,
    openDays: restaurant.openDays,
    deliveryTimings: restaurant.deliveryTimings,
    openingTime: restaurant.openingTime,
    closingTime: restaurant.closingTime,
  }
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


export default function Under250() {
  const initialFiltersRef = useRef(readUnder250Filters())
  const goBack = useAppBackNavigation()
  const {
    effectiveLocation,
    displayAddressText: displayLocation,
    zoneId,
    zoneStatus,
    isInService,
    isOutOfService,
  } = useDeliveryLocation()
  const { openLocationSelector } = useLocationSelector()
  const navigate = useNavigate()
  const { addToCart, updateQuantity, removeFromCart, getCartItem, cart } = useCart()
  const [activeCategory, setActiveCategory] = useState(initialFiltersRef.current.activeCategory)
  const [showSortPopup, setShowSortPopup] = useState(false)
  const [selectedSort, setSelectedSort] = useState(initialFiltersRef.current.selectedSort)
  const [draftSelectedSort, setDraftSelectedSort] = useState(initialFiltersRef.current.selectedSort)
  const [under30MinsFilter, setUnder30MinsFilter] = useState(initialFiltersRef.current.under30MinsFilter)
  const [isVeg, setIsVeg] = useState(false)
  const [isNonVeg, setIsNonVeg] = useState(false)
  const [rating4Plus, setRating4Plus] = useState(false)
  const [hasOffers, setHasOffers] = useState(false)
  const [showItemDetail, setShowItemDetail] = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)
  const [selectedVariantId, setSelectedVariantId] = useState("")
  const [itemDetailQuantity, setItemDetailQuantity] = useState(1)
  const [showShareOptions, setShowShareOptions] = useState(false)
  const { openSearch, closeSearch, setSearchValue } = useSearchOverlay()
  const [heroSearch, setHeroSearch] = useState("")
  const cartCount = cart?.items?.reduce((acc, item) => acc + item.quantity, 0) || 0
  
  const handleSearchFocus = useCallback(() => {
    if (heroSearch) {
      setSearchValue(heroSearch)
    }
    openSearch()
  }, [heroSearch, openSearch, setSearchValue])
  const [quantities, setQuantities] = useState({})
  const [bookmarkedItems, setBookmarkedItems] = useState(new Set())

  const getLineItemIdForDish = (item, variant = null) =>
    buildCartLineId(item?.id || item?._id || "", variant?.id || variant?._id || "")

  const getVariantForDish = (item, preferredVariantId = "") => {
    const variants = getFoodVariants(item)
    if (variants.length === 0) return null
    return variants.find((variant) => String(variant.id) === String(preferredVariantId || "")) || variants[0]
  }

  const getDishQuantity = (item, preferredVariantId = "") => {
    const variant = getVariantForDish(item, preferredVariantId)
    const lineItemId = getLineItemIdForDish(item, variant)
    return quantities[lineItemId] || 0
  }

  const getTotalDishQuantity = (item) => {
    const variants = getFoodVariants(item)
    if (variants.length === 0) return getDishQuantity(item)
    return variants.reduce((sum, variant) => sum + getDishQuantity(item, variant.id), 0)
  }


  const scrollLockYRef = useRef(0)
  const itemDetailContentRef = useRef(null)
  const itemDetailGestureRef = useRef({
    startY: 0,
    dragging: false,
  })
  const [categories, setCategories] = useState([])
  const [bannerImages, setBannerImages] = useState([])
  const [loadingBanner, setLoadingBanner] = useState(true)
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0)
  const [isTransitioning, setIsTransitioning] = useState(true)
  const [under250Restaurants, setUnder250Restaurants] = useState([])
  const [loadingRestaurants, setLoadingRestaurants] = useState(true)
  const [availabilityTick, setAvailabilityTick] = useState(Date.now())
  const [hasScrolledPastBanner, setHasScrolledPastBanner] = useState(false)
  const bannerShellRef = useRef(null)
  const stickyHeaderRef = useRef(null)
  const autoSlideIntervalRef = useRef(null)
  const touchStartXRef = useRef(0)
  const touchStartYRef = useRef(0)
  const touchEndXRef = useRef(0)
  const touchEndYRef = useRef(0)
  const isBannerSwipingRef = useRef(false)
  const fetchGenerationRef = useRef(0)

  const isSwitch99EligibleItem = useCallback((item = {}) => {
    if (!item || item?.isAvailable === false) return false
    const rawPrice = String(item?.price ?? "")
    const numPrice = Number(item?.price)
    return rawPrice.includes("99") || (!isNaN(numPrice) && numPrice > 0 && numPrice <= 99)
  }, [])

  const filterCandidateRestaurants = useCallback((restaurants = []) => {
    return restaurants.filter((restaurant) => {
      const availability = getRestaurantAvailabilityStatus(restaurant, new Date())
      if (!availability.isOpen) return false

      // Keep candidate set broad; final eligibility is menu-item based (price contains "99").
      return true
    })
  }, [])

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

  // Sort and filter restaurants based on selected sort and filters
  const sortedAndFilteredRestaurants = useMemo(() => {
    let filtered = under250Restaurants
      .filter(r => {
        const availability = getRestaurantAvailabilityStatus(r, new Date(availabilityTick));
        return availability.isOpen;
      })
      .map(r => ({ ...r, menuItems: [...(r.menuItems || [])] }))

    // Apply category filter
    if (activeCategory) {
      const selectedCat = categories.find(cat => cat.id === activeCategory)
      if (selectedCat) {
        const catNameLower = selectedCat.name.toLowerCase()
        filtered = filtered.map(restaurant => {
          const matches = restaurant.menuItems.filter(item =>
            (item.category || "").toLowerCase() === catNameLower ||
            (item.sectionName || "").toLowerCase() === catNameLower ||
            (item.subsectionName || "").toLowerCase() === catNameLower
          )
          if (matches.length > 0) {
            return { ...restaurant, menuItems: matches }
          }
          return null
        }).filter(Boolean)
      }
    }

    // Apply Pure Veg filter
    if (isVeg) {
      filtered = filtered.map(restaurant => {
        const vegItems = restaurant.menuItems.filter(item => {
          const foodType = String(item.foodType || "").toLowerCase()
          return item.isVeg || (foodType.includes("veg") && !foodType.includes("non"))
        })
        if (vegItems.length > 0) return { ...restaurant, menuItems: vegItems }
        return null
      }).filter(Boolean)
    }

    // Apply Non Veg filter
    if (isNonVeg) {
      filtered = filtered.map(restaurant => {
        const nonVegItems = restaurant.menuItems.filter(item => {
          const foodType = String(item.foodType || "").toLowerCase()
          return item.isVeg === false || foodType.includes("non")
        })
        if (nonVegItems.length > 0) return { ...restaurant, menuItems: nonVegItems }
        return null
      }).filter(Boolean)
    }

    // Apply Ratings 4.0+ filter
    if (rating4Plus) {
      filtered = filtered.filter(restaurant => (restaurant.rating || 0) >= 4.0)
    }

    // Apply Offers filter
    if (hasOffers) {
      filtered = filtered.map(restaurant => {
        const offerItems = restaurant.menuItems.filter(item => item.originalPrice && item.originalPrice > item.price)
        if (offerItems.length > 0 || restaurant.offer) return restaurant
        return null
      }).filter(Boolean)
    }

    // Apply "Under 30 mins" filter
    if (under30MinsFilter) {
      filtered = filtered.filter(restaurant => {
        const deliveryTime = parseDeliveryTime(restaurant.deliveryTime)
        return deliveryTime <= 30
      })
    }

    // Apply sorting
    if (selectedSort === 'rating-high' || selectedSort === 'rating') {
      filtered.sort((a, b) => {
        const ratingA = a.rating || 0
        const ratingB = b.rating || 0
        if (ratingB !== ratingA) {
          return ratingB - ratingA
        }
        return (b.menuItems?.length || 0) - (a.menuItems?.length || 0)
      })
    } else if (selectedSort === 'delivery-time-low' || selectedSort === 'delivery_time') {
      filtered.sort((a, b) => {
        const timeA = parseDeliveryTime(a.deliveryTime)
        const timeB = parseDeliveryTime(b.deliveryTime)
        if (timeA !== timeB) {
          return timeA - timeB
        }
        return (b.rating || 0) - (a.rating || 0)
      })
    } else if (selectedSort === 'cost_low_to_high') {
      filtered.sort((a, b) => {
        const minA = a.menuItems?.length ? Math.min(...a.menuItems.map(i => Number(i.price || 0))) : 999
        const minB = b.menuItems?.length ? Math.min(...b.menuItems.map(i => Number(i.price || 0))) : 999
        return minA - minB
      })
    } else if (selectedSort === 'cost_high_to_low') {
      filtered.sort((a, b) => {
        const maxA = a.menuItems?.length ? Math.max(...a.menuItems.map(i => Number(i.price || 0))) : 0
        const maxB = b.menuItems?.length ? Math.max(...b.menuItems.map(i => Number(i.price || 0))) : 0
        return maxB - maxA
      })
    } else if (selectedSort === 'distance-low') {
      filtered.sort((a, b) => {
        const distA = Number.isFinite(a.distanceInKm) ? a.distanceInKm : parseDistance(a.distance)
        const distB = Number.isFinite(b.distanceInKm) ? b.distanceInKm : parseDistance(b.distance)
        return distA - distB
      })
    }

    return filtered
  }, [under250Restaurants, selectedSort, under30MinsFilter, isVeg, isNonVeg, rating4Plus, hasOffers, activeCategory, categories, availabilityTick])

  const resolveBannerUrl = useCallback((url) => {
    if (!url || typeof url !== "string") return ""
    const trimmed = url.trim()
    if (!trimmed) return ""
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:")) {
      return trimmed
    }
    const cleanPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
    return `${API_BASE_URL.replace(/\/api\/?$/, "")}${cleanPath}`
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoadingBanner(true)
    api.get('/food/hero-banners/under-250/public')
      .then((res) => {
        if (cancelled) return
        const data = res?.data?.data
        const list = Array.isArray(data?.banners) ? data.banners : (Array.isArray(data) ? data : [])
        const images = list
          .map((banner) => resolveBannerUrl(banner?.imageUrl || banner?.url || banner))
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
  }, [resolveBannerUrl])

  // Fetch under-250 banner from public API
  const displayBanners = useMemo(() => {
    if (bannerImages.length > 0) return bannerImages
    return [switch99PromoBanner1, switch99PromoBanner2]
  }, [bannerImages]);

  const extendedBanners = useMemo(() => {
    if (displayBanners.length <= 1) return displayBanners
    return [...displayBanners, displayBanners[0]]
  }, [displayBanners])

  const handleTransitionEnd = useCallback(() => {
    if (currentBannerIndex >= displayBanners.length) {
      setIsTransitioning(false)
      setCurrentBannerIndex(0)
    }
  }, [currentBannerIndex, displayBanners.length])

  useEffect(() => {
    if (!isTransitioning) {
      const timer = setTimeout(() => {
        setIsTransitioning(true)
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isTransitioning])

  useEffect(() => {
    setCurrentBannerIndex((prev) => {
      if (displayBanners.length === 0) return 0
      return Math.min(prev, displayBanners.length - 1)
    })
  }, [displayBanners.length])

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
    if (displayBanners.length <= 1) return
    autoSlideIntervalRef.current = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return
      setIsTransitioning(true)
      setCurrentBannerIndex((prev) => prev + 1)
    }, 3500)
  }, [displayBanners.length])

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
    if (displayBanners.length <= 1) return
    touchStartXRef.current = event.touches[0].clientX
    touchStartYRef.current = event.touches[0].clientY
    touchEndXRef.current = event.touches[0].clientX
    touchEndYRef.current = event.touches[0].clientY
    isBannerSwipingRef.current = true
  }, [displayBanners.length])

  const handleBannerTouchMove = useCallback((event) => {
    if (!isBannerSwipingRef.current) return
    touchEndXRef.current = event.touches[0].clientX
    touchEndYRef.current = event.touches[0].clientY
  }, [])

  const handleBannerTouchEnd = useCallback(() => {
    if (!isBannerSwipingRef.current || displayBanners.length <= 1) {
      isBannerSwipingRef.current = false
      return
    }

    const deltaX = touchEndXRef.current - touchStartXRef.current
    const deltaY = Math.abs(touchEndYRef.current - touchStartYRef.current)
    const minSwipeDistance = 40

    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaX) > deltaY) {
      if (deltaX > 0) {
        if (currentBannerIndex === 0) {
          setIsTransitioning(false)
          setCurrentBannerIndex(displayBanners.length)
          setTimeout(() => {
            setIsTransitioning(true)
            setCurrentBannerIndex(displayBanners.length - 1)
          }, 30)
        } else {
          setIsTransitioning(true)
          setCurrentBannerIndex((prev) => prev - 1)
        }
      } else {
        setIsTransitioning(true)
        setCurrentBannerIndex((prev) => prev + 1)
      }
      resetBannerAutoSlide()
    }

    isBannerSwipingRef.current = false
  }, [displayBanners.length, currentBannerIndex, resetBannerAutoSlide])

  // Fetch restaurants with dishes under ?250 from backend
  useEffect(() => {
    const fetchRestaurantsUnder250 = async () => {
      const fetchGeneration = ++fetchGenerationRef.current
      try {
        setLoadingRestaurants(true)
        if (!zoneId) {
          setUnder250Restaurants([])
          return
        }

        const [restaurantsResponse, foodsResponse] = await Promise.all([
          restaurantAPI.getRestaurants({ zoneId, limit: 1000 }),
          restaurantAPI.getPublicFoods({
            zoneId,
            promo: "switch99",
            limit: 1000,
          }),
        ])

        if (fetchGeneration !== fetchGenerationRef.current) return

        const restaurantsRaw = Array.isArray(restaurantsResponse?.data?.data?.restaurants)
          ? restaurantsResponse.data.data.restaurants
          : []
        const candidateRestaurants = filterCandidateRestaurants(restaurantsRaw)
        const foods = Array.isArray(foodsResponse?.data?.data?.foods)
          ? foodsResponse.data.data.foods
          : []

        const foodsByRestaurantId = new Map()
        foods.forEach((food) => {
          if (!isSwitch99EligibleItem(food)) return
          const restaurantId = String(food?.restaurantId || "").trim()
          if (!restaurantId) return
          if (!foodsByRestaurantId.has(restaurantId)) {
            foodsByRestaurantId.set(restaurantId, [])
          }
          foodsByRestaurantId.get(restaurantId).push(food)
        })

        const restaurantsWithUnder250Dishes = candidateRestaurants
          .map((restaurant, index) => {
            const restaurantId = String(restaurant?.restaurantId || restaurant?._id || "").trim()
            if (!restaurantId) return null

            const restaurantFoods = foodsByRestaurantId.get(restaurantId) || []
            const existingMenuItems = restaurantFoods.map((food) =>
              buildSwitch99MenuItem(food, restaurant, restaurantId),
            )

            // Enrich with curated top ₹99 dishes to make every restaurant full and vibrant
            const existingNames = new Set(existingMenuItems.map((item) => (item.name || "").toLowerCase()))
            const extraDishes = CURATED_SWITCH99_DISHES.filter((dish) => !existingNames.has(dish.name.toLowerCase()))
              .map((dish, dIdx) => ({
                ...dish,
                id: `${restaurantId}-curated-${dIdx}`,
                restaurantId,
                restaurantName: restaurant?.name || restaurant?.restaurantName || "",
              }))

            const menuItems = [...existingMenuItems, ...extraDishes].slice(0, 8)

            return buildSwitch99RestaurantRow(
              restaurant,
              menuItems,
              index,
              effectiveLocation,
            )
          })
          .filter(Boolean)

        if (fetchGeneration !== fetchGenerationRef.current) return
        setUnder250Restaurants(restaurantsWithUnder250Dishes)
      } catch (error) {
        debugError("Error fetching restaurants under 250:", error)
        if (fetchGeneration === fetchGenerationRef.current) {
          setUnder250Restaurants([])
        }
      } finally {
        if (fetchGeneration === fetchGenerationRef.current) {
          setLoadingRestaurants(false)
        }
      }
    }

    fetchRestaurantsUnder250()
  }, [zoneId, effectiveLocation, filterCandidateRestaurants, isSwitch99EligibleItem])

  // Fetch categories from backend (no static fallback list)
  useEffect(() => {
    let cancelled = false

    const fetchCategories = async () => {
      try {
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
        }
      } catch (error) {
        debugError("Error fetching under-250 categories:", error)
        if (!cancelled) setCategories([])
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
    const tickAvailability = () => {
      if (typeof document !== "undefined" && document.hidden) return
      setAvailabilityTick(Date.now());
    }
    const intervalId = setInterval(tickAvailability, 60000);
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        setAvailabilityTick(Date.now());
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, []);

  useEffect(() => {
    if (!selectedItem) {
      setSelectedVariantId("")
      return
    }
    const defaultVariant = getDefaultFoodVariant(selectedItem)
    setSelectedVariantId(defaultVariant?.id || "")
  }, [selectedItem])

  useEffect(() => {
    if (!selectedItem || !showItemDetail) return

    const existingQuantity = getTotalDishQuantity(selectedItem)
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


  // Scroll detection removed — FloatingHomeDock handles fixed positioning above bottom nav

  useEffect(() => {
    const handleBannerScroll = () => {
      const bannerShell = bannerShellRef.current
      const stickyHeader = stickyHeaderRef.current

      if (!bannerShell) {
        setHasScrolledPastBanner(false)
        return
      }

      const bannerRect = bannerShell.getBoundingClientRect()
      const stickyHeight = stickyHeader?.getBoundingClientRect().height || 0
      setHasScrolledPastBanner(bannerRect.bottom <= stickyHeight)
    }

    handleBannerScroll()
    window.addEventListener("scroll", handleBannerScroll, { passive: true })
    window.addEventListener("resize", handleBannerScroll)

    return () => {
      window.removeEventListener("scroll", handleBannerScroll)
      window.removeEventListener("resize", handleBannerScroll)
    }
  }, [])

  // Helper function to update item quantity in both local state and cart
  const updateItemQuantity = (item, newQuantity, event = null, preferredVariant = null) => {
    // Check authentication
    if (!isModuleAuthenticated('user')) {
      toast.error("Please login to add items to cart")
      navigate('/food/user/auth/login', { state: { from: location.pathname } })
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

    const restaurant = item.restaurant || "Eatiefy 99"
    const validRestaurantId = item.restaurantId || item.restaurant_id || ""

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
      restaurant,
      restaurantId: validRestaurantId || undefined,
      description: item.description || "",
      originalPrice: item.originalPrice || item.price,
      foodType: item.foodType,
      isVeg: item.isVeg,
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
          const result = addToCart(cartItem, sourcePosition, { quantity: newQuantity - existingCartItem.quantity })
          if (result?.ok === false) {
            if (result.needsConfirmation) return
            toast.error(result.error || 'Cannot add item from different restaurant. Please clear cart first.')
            return
          }
        } else if (newQuantity < existingCartItem.quantity && sourcePosition) {
          updateQuantity(lineItemId, newQuantity, sourcePosition, productInfo)
        } else {
          updateQuantity(lineItemId, newQuantity)
        }
      } else {
        const result = addToCart(cartItem, sourcePosition, { quantity: newQuantity })
        if (result?.ok === false) {
          if (result.needsConfirmation) return
          toast.error(result.error || 'Cannot add item from different restaurant. Please clear cart first.')
          return
        }
      }
    }
  }

  const closeItemDetail = useCallback(() => {
    setShowItemDetail(false)
    setShowShareOptions(false)
  }, [])

  const handleItemClick = (item, restaurant) => {
    // Add restaurant info to item for display
    const itemWithRestaurant = {
      ...item,
      restaurant: restaurant.name,
      restaurantId: restaurant.restaurantId || restaurant.id || "",
      restaurantSlug: restaurant.slug || restaurant.restaurantId || "",
      description: item.description || `${item.name} from ${restaurant.name}`,
      customisable: item.customisable || false,
      notEligibleForCoupons: item.notEligibleForCoupons || false,
    }
    const existingQuantity = getTotalDishQuantity(itemWithRestaurant)
    setItemDetailQuantity(existingQuantity > 0 ? existingQuantity : 1)
    setSelectedItem(itemWithRestaurant)
    setShowShareOptions(false)
    setShowItemDetail(true)
  }

  const handleAddButtonClick = (item, restaurant, event) => {
    if (hasFoodVariants(item) && getTotalDishQuantity(item) === 0) {
      handleItemClick(item, restaurant)
      return
    }
    const resolvedVariant = getDefaultFoodVariant(item)
    updateItemQuantity(
      { ...item, restaurant: restaurant.name, restaurantId: restaurant.restaurantId || restaurant.id || "" },
      1,
      event,
      resolvedVariant,
    )
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
          text: `Check out ${item.name || "this dish"} from ${item.restaurant || "Eatiefy 99"}`,
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
    const shareText = `Check out ${selectedItem.name || "this dish"} from ${selectedItem.restaurant || "Eatiefy 99"}`
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

    <div className={`relative min-h-screen bg-white dark:bg-[#0a0a0a] pb-0 md:pb-4`}>
      {/* Floating / Sticky Navigation Header with Back Button */}
      <div 
        ref={stickyHeaderRef}
        className={`sticky top-0 z-50 w-full transition-all duration-300 rounded-b-2xl sm:rounded-b-3xl overflow-hidden md:hidden ${
          hasScrolledPastBanner 
            ? "bg-white/95 dark:bg-[#0a0a0a]/95 backdrop-blur-xl shadow-sm border-b border-gray-100 dark:border-gray-900 py-2.5 px-4 flex items-center gap-3" 
            : "bg-gradient-to-b from-black/50 via-black/20 to-transparent backdrop-blur-none p-3.5 pointer-events-none flex items-center gap-3"
        }`}
      >
        <button
          onClick={goBack}
          className="flex items-center justify-center h-9 w-9 rounded-full bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-md border border-white/50 dark:border-gray-700/60 transition-transform active:scale-95 pointer-events-auto"
          aria-label="Go back"
        >
          <ArrowLeft className="h-4 w-4 text-gray-800 dark:text-gray-200" strokeWidth={2.5} />
        </button>

        {hasScrolledPastBanner && (
          <span className="text-base font-bold text-gray-900 dark:text-white truncate">
            Under {RUPEE_SYMBOL}99
          </span>
        )}
      </div>

      {/* Dynamic Eatiefy 99 Hero Banner Section */}
      {loadingBanner ? (
        <div className="relative w-full overflow-hidden h-[clamp(260px,42vw,540px)] bg-gray-100 dark:bg-gray-900 animate-pulse flex items-center justify-center" />
      ) : displayBanners.length > 0 ? (
        <div
          ref={bannerShellRef}
          data-banner-shell="true"
          className="relative w-full overflow-hidden h-[clamp(260px,42vw,540px)] -mt-16 sm:-mt-20 bg-white dark:bg-[#0a0a0a]"
        >
          <div
            className="absolute inset-0 z-0 overflow-hidden"
            onTouchStart={handleBannerTouchStart}
            onTouchMove={handleBannerTouchMove}
            onTouchEnd={handleBannerTouchEnd}
          >
            <div
              className={`flex h-full w-full ${
                isTransitioning ? "transition-transform duration-500 ease-out" : "transition-none"
              }`}
              style={{ transform: `translateX(-${currentBannerIndex * 100}%)` }}
              onTransitionEnd={handleTransitionEnd}
            >
              {extendedBanners.map((bannerSrc, index) => (
                <div key={`${bannerSrc}-${index}`} className="relative h-full w-full shrink-0">
                  <img
                    src={bannerSrc}
                    alt={`Eatiefy 99 Banner ${(index % displayBanners.length) + 1}`}
                    className="w-full h-full object-cover"
                    loading="eager"
                    decoding="async"
                    onError={(e) => {
                      e.currentTarget.onerror = null
                      e.currentTarget.src = switch99PromoBanner1
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Soft Bottom Gradient Fade - Seamless Transition into Categories */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 sm:h-28 bg-gradient-to-t from-white via-white/50 to-transparent dark:from-[#0a0a0a] dark:via-[#0a0a0a]/50 z-[5]" />

          {/* Dynamic Pagination Indicators */}
          {displayBanners.length > 1 && (
            <div className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
              {displayBanners.map((_, index) => {
                const activeDotIndex = currentBannerIndex % displayBanners.length
                return (
                  <button
                    key={`banner-dot-${index}`}
                    onClick={() => {
                      setIsTransitioning(true)
                      setCurrentBannerIndex(index)
                      resetBannerAutoSlide()
                    }}
                    className={`transition-all duration-300 rounded-full h-1.5 ${
                      activeDotIndex === index ? "w-6 bg-[#E2AD4B]" : "w-1.5 bg-black/40 dark:bg-white/40"
                    }`}
                  />
                )
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* Content Section */}
      <div className="relative max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 xl:px-12 space-y-0 -mt-10 sm:-mt-14 md:-mt-16 z-10 pt-2 sm:pt-3 md:pt-4 lg:pt-6 pb-6 md:pb-8 lg:pb-10">

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
                <div 
                  className="w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-full overflow-hidden shadow-md transition-all"
                  style={!activeCategory ? { boxShadow: "0 0 0 2px var(--window-bg-color, #fff), 0 0 0 4px var(--module-theme-color, #E2AD4B)" } : {}}
                >
                  <OptimizedImage
                    src={offerImage}
                    alt="All"
                    className="w-full h-full bg-white rounded-full"
                    objectFit="cover"
                    sizes="(max-width: 640px) 62px, (max-width: 768px) 96px, 112px"
                    placeholder="blur"
                  />
                </div>
                <span 
                  className="text-xs sm:text-sm md:text-base font-semibold text-gray-800 dark:text-gray-200 text-center pb-1"
                  style={!activeCategory ? { color: "var(--module-theme-color, #E2AD4B)" } : {}}
                >
                  All
                </span>
              </motion.div>
            </div>
            {categories.map((category, index) => {
              const isActive = activeCategory === category.id
              return (
                <div key={category.id} className="flex-shrink-0 cursor-pointer" onClick={() => setActiveCategory(isActive ? null : category.id)}>
                  <motion.div
                    className="flex flex-col items-center gap-2 w-[72px] sm:w-24 md:w-28"
                    whileHover={{ scale: 1.1, y: -4 }}
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  >
                    <div 
                      className="w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-full overflow-hidden shadow-md transition-all"
                      style={isActive ? { boxShadow: "0 0 0 2px var(--window-bg-color, #fff), 0 0 0 4px var(--module-theme-color, #E2AD4B)" } : {}}
                    >
                      <OptimizedImage
                        src={category.image}
                        alt={category.name}
                        className="w-full h-full bg-white rounded-full"
                        objectFit="cover"
                        sizes="(max-width: 640px) 62px, (max-width: 768px) 96px, 112px"
                        placeholder="blur"
                      />
                    </div>
                    <span 
                      className="text-xs sm:text-sm md:text-base font-bold text-gray-800 dark:text-gray-200 text-center leading-tight whitespace-nowrap pb-1"
                      style={isActive ? { color: "var(--module-theme-color, #E2AD4B)" } : {}}
                    >
                      {category.name}
                    </span>
                  </motion.div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="py-2 sm:py-3">
          <FoodFilterBar
            sortBy={selectedSort}
            onSortChange={setSelectedSort}
            isVeg={isVeg}
            onVegToggle={() => setIsVeg((prev) => !prev)}
            isNonVeg={isNonVeg}
            onNonVegToggle={() => setIsNonVeg((prev) => !prev)}
            rating4Plus={rating4Plus}
            onRating4PlusToggle={() => setRating4Plus((prev) => !prev)}
            hasOffers={hasOffers}
            onOffersToggle={() => setHasOffers((prev) => !prev)}
            under30Mins={under30MinsFilter}
            onUnder30MinsToggle={() => setUnder30MinsFilter((prev) => !prev)}
          />
        </section>


        {/* Restaurant Menu Sections */}
        {loadingRestaurants ? (
          <div className="flex justify-center items-center py-12">
            <div className="text-gray-500 dark:text-gray-400">Loading restaurants...</div>
          </div>
        ) : sortedAndFilteredRestaurants.length === 0 ? (
          <div className="flex justify-center items-center py-12">
            <div className="text-gray-500 dark:text-gray-400">
              {under250Restaurants.length === 0
                ? `No restaurants with dishes under ${RUPEE_SYMBOL}99 found.`
                : "No restaurants match the selected filters."}
            </div>
          </div>
        ) : (
          sortedAndFilteredRestaurants.map((restaurant) => {
            const restaurantSlug = restaurant.slug || restaurant.name.toLowerCase().replace(/\s+/g, "-")
            return (
              <section key={restaurant.id} className="pt-4 sm:pt-6 md:pt-8 lg:pt-10">
                {/* Restaurant Header */}
                <div className="flex items-start justify-between mb-3 md:mb-4 lg:mb-6">
                  <div className="flex-1">
                    <h3 className="text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-4xl font-bold text-gray-900 dark:text-white mb-1 md:mb-2">
                      {restaurant.name}
                    </h3>
                    <div className="flex items-center gap-2 text-sm md:text-base lg:text-lg text-gray-500 dark:text-gray-400">
                      <Clock className="h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6" strokeWidth={1.5} />
                      <span className="font-medium">{restaurant.deliveryTime}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <div
                      className="flex items-center gap-1 text-white px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md text-xs sm:text-sm font-extrabold shadow-sm"
                      style={{ backgroundColor: "#24963F" }}
                    >
                      <Star className="h-3 w-3 sm:h-3.5 sm:w-3.5 fill-white text-white" />
                      <span className="text-white">{restaurant.rating > 0 ? Number(restaurant.rating).toFixed(1) : "4.2"}</span>
                    </div>
                    <span className="text-[10px] sm:text-xs text-gray-400 dark:text-gray-500 font-medium mt-1">
                      {restaurant.totalRatings > 0
                        ? `${restaurant.totalRatings >= 1000 ? `${(restaurant.totalRatings / 1000).toFixed(1)}k+` : `${restaurant.totalRatings}+`} ratings`
                        : "100+ ratings"}
                    </span>
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
                        const quantity = getTotalDishQuantity(item)
                        return (
                          <motion.div
                            key={item.id}
                            className={`flex-shrink-0 w-[150px] sm:w-[170px] md:w-[200px] lg:w-full bg-transparent overflow-visible relative ${shouldShowGrayscale ? 'cursor-default' : 'cursor-pointer'}`}
                            onClick={() => {
                              if (!shouldShowGrayscale) {
                                handleItemClick(item, restaurant)
                              }
                            }}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: "-50px" }}
                            transition={{ duration: 0.4, delay: itemIndex * 0.05 }}
                            whileHover={{ y: -8, scale: 1.02 }}
                          >
                            {/* Item Image Container */}
                            <div className="relative w-full h-[120px] sm:h-[140px] md:h-[155px] lg:h-[175px] rounded-2xl overflow-hidden shadow-sm border border-gray-200/80 dark:border-gray-700/70 bg-white dark:bg-neutral-900 transition-all duration-300 group-hover:shadow-md group-hover:border-gray-300/90">
                              <motion.div
                                className="absolute inset-0 w-full h-full"
                                whileHover={{ scale: 1.05 }}
                                transition={{ duration: 0.3, ease: "easeOut" }}
                              >
                                <img
                                  src={getSanitizedUnder250Image(item)}
                                  alt={item.name}
                                  className="w-full h-full object-cover rounded-2xl bg-white"
                                  loading="lazy"
                                />
                              </motion.div>

                              {/* Popular Badge */}
                              <div
                                className="absolute top-2 left-2 text-white text-[9.5px] font-black px-2 py-0.5 rounded-full shadow-md backdrop-blur-md z-10"
                                style={{ backgroundColor: "#659116" }}
                              >
                                Popular
                              </div>

                              {/* Rating Badge Overlay (bottom-left) */}
                              <div className="absolute bottom-2 left-2 z-10 flex items-center gap-0.5 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md text-gray-900 dark:text-white px-2 py-0.5 rounded-full shadow-md border border-gray-200/80 dark:border-gray-700/70 text-[10.5px] font-extrabold">
                                <span className="text-[#659116] leading-none">★</span>
                                <span className="leading-none">{item.rating ?? restaurant.rating ?? 4.2}</span>
                              </div>

                              {/* Floating Action Button (bottom-right) */}
                              {quantity > 0 ? (
                                <div
                                  className="absolute bottom-2 right-2.5 z-20 flex items-center justify-between gap-1 sm:gap-2 px-1.5 sm:px-2 py-0.5 rounded-full bg-white dark:bg-gray-900 shadow-md border border-gray-200/90 dark:border-gray-700/80 h-7 sm:h-8 min-w-[55px] sm:min-w-[70px]"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      updateItemQuantity(
                                        { ...item, restaurant: restaurant.name, restaurantId: restaurant.restaurantId || restaurant.id || "" },
                                        quantity - 1,
                                        e
                                      )
                                    }}
                                    className="text-[#659116] hover:opacity-80 p-0.5"
                                  >
                                    <Minus className="h-3 w-3" strokeWidth={3.5} />
                                  </button>
                                  <span className="text-[12px] font-black text-gray-950 dark:text-white">
                                    {quantity}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      updateItemQuantity(
                                        { ...item, restaurant: restaurant.name, restaurantId: restaurant.restaurantId || restaurant.id || "" },
                                        quantity + 1,
                                        e
                                      )
                                    }}
                                    className="text-[#659116] hover:opacity-80 p-0.5"
                                  >
                                    <Plus className="h-3 w-3" strokeWidth={3.5} />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  disabled={shouldShowGrayscale}
                                  className={`absolute bottom-2 right-2.5 z-20 h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-white dark:bg-gray-900 shadow-md flex items-center justify-center hover:scale-105 transition-transform duration-200 border border-gray-200/90 dark:border-gray-700/80 ${
                                    shouldShowGrayscale ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (!shouldShowGrayscale) {
                                      handleAddButtonClick(item, restaurant, e)
                                    }
                                  }}
                                >
                                  <Plus className="h-4 w-4 text-[#659116]" strokeWidth={3} />
                                </button>
                              )}
                            </div>

                            {/* Item Details below image */}
                            <div className="pt-2 px-1 pb-1">
                              {/* Restaurant Name */}
                              <div className="text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 truncate">
                                {restaurant.name}
                              </div>

                              {/* Item Name Row with Veg Icon */}
                              <div className="flex items-center gap-1 sm:gap-1.5 mt-0.5">
                                <div 
                                  className="h-3 w-3 rounded border flex items-center justify-center flex-shrink-0"
                                  style={{
                                    borderColor: item.isVeg ? "#16A34A" : "#dc2626",
                                    backgroundColor: item.isVeg ? "#F0FDF4" : "#FEF2F2"
                                  }}
                                >
                                  <div 
                                    className="h-1.5 w-1.5 rounded-full" 
                                    style={{
                                      backgroundColor: item.isVeg ? "#16A34A" : "#dc2626"
                                    }}
                                  />
                                </div>
                                <span className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white truncate flex-1">
                                  {item.name}
                                </span>
                              </div>

                              {/* Price and Optional View Cart Link */}
                              <div className="flex items-baseline justify-between mt-0.5">
                                <span className="text-sm sm:text-base font-extrabold text-gray-950 dark:text-white">
                                  <FoodPriceDisplay item={item} />
                                </span>
                                {quantity > 0 && (
                                  <Link 
                                    to="/food/user/cart" 
                                    onClick={(e) => e.stopPropagation()} 
                                    className="text-[9px] sm:text-[10px] font-bold hover:underline"
                                    style={{ color: "var(--module-theme-color, #E2AD4B)" }}
                                  >
                                    View cart
                                  </Link>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        )
                      })}

                      {/* End-of-scroll "View Full Menu" Card (Swiggy / Zomato style) */}
                      <motion.div
                        className="flex-shrink-0 w-[140px] sm:w-[160px] md:w-[180px] lg:w-[200px] flex flex-col items-center justify-center cursor-pointer group"
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: "-50px" }}
                        transition={{ duration: 0.4 }}
                        whileHover={{ scale: 1.03 }}
                        onClick={() => navigate(`/food/user/restaurants/${restaurantSlug}?under250=true`)}
                      >
                        <div className="w-full h-[120px] sm:h-[140px] md:h-[155px] lg:h-[175px] rounded-2xl border-2 border-dashed border-[#E2AD4B]/60 dark:border-[#E2AD4B]/50 bg-gradient-to-br from-[#E2AD4B]/10 via-amber-500/5 to-transparent dark:from-[#E2AD4B]/20 dark:via-transparent flex flex-col items-center justify-center p-4 text-center transition-all duration-300 group-hover:border-[#E2AD4B] group-hover:bg-[#E2AD4B]/20 group-hover:shadow-lg">
                          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[#E2AD4B] text-white flex items-center justify-center shadow-md mb-2 group-hover:scale-110 transition-transform duration-300">
                            <ArrowRight className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.5} />
                          </div>
                          <span className="text-xs sm:text-sm font-extrabold text-gray-900 dark:text-white leading-tight">
                            View Full Menu
                          </span>
                          <span className="text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 mt-0.5">
                            See all dishes →
                          </span>
                        </div>
                        <div className="pt-2 text-[10px] sm:text-xs font-semibold text-gray-400 dark:text-gray-500 text-center">
                          {restaurant.name}
                        </div>
                      </motion.div>
                    </div>
                  </div>
                )}
              </section>
            )
          }))}
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
              transition={{ duration: 0.2 }}
              onClick={() => setShowSortPopup(false)}
              className="fixed inset-0 bg-black/50 z-100"
            />

            {/* Bottom Sheet */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{
                type: "spring",
                stiffness: 300,
                damping: 30
              }}
              className="fixed bottom-0 left-0 right-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:max-w-lg lg:max-w-2xl bg-white dark:bg-[#1a1a1a] rounded-t-3xl shadow-2xl z-[110] max-h-[60vh] md:max-h-[80vh] overflow-hidden flex flex-col"
            >
              {/* Drag Handle */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-12 h-1 bg-gray-300 rounded-full" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-4 md:px-6 py-4 md:py-5 border-b dark:border-gray-800">
                <h2 className="text-lg md:text-xl lg:text-2xl font-bold text-gray-900 dark:text-white">Sort By</h2>
                <button
                  onClick={handleClearAll}
                  className="text-[#EB590E] dark:text-[#F97316] font-medium text-sm md:text-base"
                >
                  Clear all
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-6">
                <div className="flex flex-col gap-3 md:gap-4">
                  {sortOptions.map((option) => (
                    <button
                      key={option.id || 'relevance'}
                      onClick={() => setDraftSelectedSort(option.id)}
                      className={`px-4 md:px-5 lg:px-6 py-3 md:py-4 rounded-xl border text-left transition-colors ${draftSelectedSort === option.id
                        ? 'border-[#EB590E] bg-[#FFF2EB] dark:bg-orange-900/20'
                        : 'border-gray-200 dark:border-gray-800 hover:border-[#EB590E]'
                        }`}
                    >
                      <span className={`text-sm md:text-base lg:text-lg font-medium ${draftSelectedSort === option.id ? 'text-[#EB590E] dark:text-[#F97316]' : 'text-gray-700 dark:text-gray-300'}`}>
                        {option.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center gap-4 md:gap-6 px-4 md:px-6 py-4 md:py-5 border-t dark:border-gray-800 bg-white dark:bg-[#1a1a1a]">
                <button
                  onClick={() => setShowSortPopup(false)}
                  className="flex-1 py-3 md:py-4 text-center font-semibold text-gray-700 dark:text-gray-300 text-sm md:text-base"
                >
                  Close
                </button>
                <button
                  onClick={handleApply}
                  className="flex-1 py-3 md:py-4 font-semibold rounded-xl transition-colors text-sm md:text-base bg-[#EB590E] text-white hover:bg-[#D94F0C]"
                >
                  Apply
                </button>
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
              <div className="relative w-full h-64 md:h-80 lg:h-96 xl:h-[500px] overflow-hidden rounded-t-3xl">
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
                      <div className="h-5 w-5 md:h-6 md:w-6 lg:h-7 lg:w-7 rounded border-2 flex items-center justify-center flex-shrink-0" style={{ borderColor: "#16A34A", backgroundColor: "#F0FDF4" }}>
                        <div className="h-2.5 w-2.5 md:h-3 md:w-3 lg:h-3.5 lg:w-3.5 rounded-full" style={{ backgroundColor: "#16A34A" }} />
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
                  {selectedItem.description || `${selectedItem.name} from ${selectedItem.restaurant || 'Eatiefy 99'}`}
                </p>

                {/* Highly Reordered Progress Bar */}
                {selectedItem.customisable && (
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 h-0.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-[#EB590E] rounded-full" style={{ width: '50%' }} />
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

                {hasFoodVariants(selectedItem) && (
                  <VariantSelector
                    variants={getFoodVariants(selectedItem)}
                    selectedVariantId={selectedVariantId}
                    onSelectVariant={setSelectedVariantId}
                    getVariantQuantity={(variantId) => getDishQuantity(selectedItem, variantId)}
                  />
                )}
              </div>

              {/* Bottom Action Bar */}
              <div className={`border-t px-4 md:px-6 lg:px-8 xl:px-10 py-4 md:py-5 lg:py-6 bg-white dark:bg-[#1a1a1a] ${hasFoodVariants(selectedItem) ? "border-[#EB590E]/10 dark:border-[#EB590E]/20" : "border-gray-200 dark:border-gray-800"}`}>
                {hasFoodVariants(selectedItem) && (
                  <div className="mb-3 md:mb-4 flex items-center justify-between rounded-xl bg-gray-50 dark:bg-[#222222] px-3 md:px-4 py-2 md:py-2.5">
                    <span className="text-xs md:text-sm font-medium text-gray-500 dark:text-gray-400">
                      Adding to cart
                    </span>
                    <span className="text-sm md:text-base font-semibold text-gray-900 dark:text-white truncate max-w-[65%] text-right">
                      {getVariantForDish(selectedItem, selectedVariantId)?.name || "Selected portion"}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-4 md:gap-5 lg:gap-6">
                  {/* Quantity Selector */}
                  <div className={`flex items-center gap-3 md:gap-4 lg:gap-5 rounded-xl md:rounded-2xl px-3 md:px-4 lg:px-5 h-[44px] md:h-[50px] lg:h-[56px] ${hasFoodVariants(selectedItem)
                    ? "border-2 border-[#EB590E]/25 bg-[#FFF7F2] dark:bg-[#EB590E]/5"
                    : "border-2 border-gray-300 dark:border-gray-700"
                    } ${shouldShowGrayscale ? "opacity-50" : ""}`}>
                    <button
                      onClick={(e) => {
                        if (!shouldShowGrayscale) {
                          e.stopPropagation()
                          if (hasFoodVariants(selectedItem)) {
                            updateItemQuantity(
                              selectedItem,
                              Math.max(0, getDishQuantity(selectedItem, selectedVariantId) - 1),
                              e,
                              getVariantForDish(selectedItem, selectedVariantId),
                            )
                          } else {
                            setItemDetailQuantity((prev) => Math.max(1, prev - 1))
                          }
                        }
                      }}
                      disabled={
                        shouldShowGrayscale ||
                        (hasFoodVariants(selectedItem)
                          ? getDishQuantity(selectedItem, selectedVariantId) === 0
                          : itemDetailQuantity <= 1)
                      }
                      className={`${shouldShowGrayscale
                        ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed'
                        }`}
                    >
                      <Minus className="h-5 w-5 md:h-6 md:w-6 lg:h-7 lg:w-7" />
                    </button>
                    <span className={`text-lg md:text-xl lg:text-2xl font-semibold min-w-[2rem] md:min-w-[2.5rem] lg:min-w-[3rem] text-center ${shouldShowGrayscale
                      ? 'text-gray-400 dark:text-gray-600'
                      : 'text-gray-900 dark:text-white'
                      }`}>
                      {hasFoodVariants(selectedItem)
                        ? getDishQuantity(selectedItem, selectedVariantId)
                        : itemDetailQuantity}
                    </span>
                    <button
                      onClick={(e) => {
                        if (!shouldShowGrayscale) {
                          e.stopPropagation()
                          if (hasFoodVariants(selectedItem)) {
                            updateItemQuantity(
                              selectedItem,
                              getDishQuantity(selectedItem, selectedVariantId) + 1,
                              e,
                              getVariantForDish(selectedItem, selectedVariantId),
                            )
                          } else {
                            setItemDetailQuantity((prev) => prev + 1)
                          }
                        }
                      }}
                      disabled={shouldShowGrayscale}
                      className={shouldShowGrayscale
                        ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                      }
                    >
                      <Plus className="h-5 w-5 md:h-6 md:w-6 lg:h-7 lg:w-7" />
                    </button>
                  </div>

                  {/* Add Item Button */}
                  <Button
                    className={`flex-1 h-[44px] md:h-[50px] lg:h-[56px] rounded-xl md:rounded-2xl font-semibold flex items-center justify-center gap-2 text-sm md:text-base lg:text-lg shadow-lg border-0 ${shouldShowGrayscale
                      ? '!bg-gray-300 dark:!bg-gray-700 !text-gray-500 dark:!text-gray-600 cursor-not-allowed opacity-50 shadow-none'
                      : hasFoodVariants(selectedItem)
                        ? '!bg-[#EB590E] hover:!bg-[#D94F0C] !text-white shadow-[0_8px_20px_-8px_rgba(235,89,14,0.65)]'
                        : '!bg-red-500 hover:!bg-red-600 dark:!bg-red-600 dark:hover:!bg-red-700 !text-white shadow-red-500/25'
                      }`}
                    onClick={(e) => {
                      if (!shouldShowGrayscale) {
                        if (hasFoodVariants(selectedItem)) {
                          updateItemQuantity(
                            selectedItem,
                            getDishQuantity(selectedItem, selectedVariantId) + 1,
                            e,
                            getVariantForDish(selectedItem, selectedVariantId),
                          )
                        } else {
                          updateItemQuantity(selectedItem, itemDetailQuantity, e)
                        }
                        closeItemDetail()
                      }
                    }}
                    disabled={shouldShowGrayscale}
                  >
                    <span>{hasFoodVariants(selectedItem) ? "Add to cart" : "Add item"}</span>
                    <div className="flex items-center gap-1 md:gap-1.5 rounded-lg bg-white/15 px-2 py-0.5">
                      {(() => {
                        const sellPrice = hasFoodVariants(selectedItem)
                          ? Number(getVariantForDish(selectedItem, selectedVariantId)?.price || selectedItem.price) || 0
                          : Number(selectedItem.price) || 0
                        const comparePrice = hasFoodVariants(selectedItem)
                          ? Number(getVariantForDish(selectedItem, selectedVariantId)?.otherPrice) ||
                            getFoodDisplayOtherPrice(selectedItem)
                          : Number(selectedItem.otherPrice) ||
                            Number(selectedItem.originalPrice) ||
                            getFoodDisplayOtherPrice(selectedItem)
                        const showStrike = comparePrice > 0 && comparePrice > sellPrice
                        const discountPercent = showStrike
                          ? getFoodDiscountPercent(null, sellPrice, comparePrice)
                          : 0
                        return (
                          <>
                            {showStrike ? (
                              <span className="text-xs md:text-sm line-through text-white/70">
                                {RUPEE_SYMBOL}{Math.round(comparePrice)}
                              </span>
                            ) : null}
                            <span className="text-sm md:text-base lg:text-lg font-bold tabular-nums">
                              {RUPEE_SYMBOL}{Math.round(sellPrice)}
                            </span>
                            {discountPercent > 0 ? (
                              <span className="text-[10px] font-bold uppercase tracking-wide text-white/95">
                                {discountPercent}% OFF
                              </span>
                            ) : null}
                          </>
                        )
                      })()}
                    </div>
                  </Button>
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
                    className="rounded-2xl border border-gray-200 dark:border-gray-700 px-4 py-3 text-sm font-medium text-gray-800 dark:text-gray-200 hover:border-[#EB590E] hover:text-[#EB590E] transition-colors"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <FloatingHomeDock hasBottomNav />
    </div>
  )
}
