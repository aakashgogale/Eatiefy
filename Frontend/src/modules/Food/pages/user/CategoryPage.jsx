import { useState, useMemo, useRef, useEffect, useLayoutEffect, startTransition, useDeferredValue } from "react"
import { useParams, Link, useNavigate, useNavigationType } from "react-router-dom"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Star, Clock, Search, SlidersHorizontal, ChevronDown, Bookmark, BadgePercent, MapPin, ArrowDownUp, Timer, IndianRupee, UtensilsCrossed, ShieldCheck, X, Loader2, Grid2x2, Zap } from "lucide-react"
import { Card, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import {
  CategoryChipRowSkeleton,
  LoadingSkeletonRegion,
  RestaurantGridSkeleton,
} from "@food/components/ui/loading-skeletons"

// Import shared food images - prevents duplication
import { foodImages } from "@food/constants/images"
import dishFallbackImage from "@food/assets/dish_fallback.webp"
import api from "@food/api"
import { restaurantAPI, adminAPI, searchAPI } from "@food/api"
import { API_BASE_URL } from "@food/api/config"
import { useProfile } from "@food/context/ProfileContext"
import {
  filterCategoriesForVegMode,
  isNonVegCategoryScope,
  isVegMenuItem,
  isVeganMenuItem,
} from "@food/utils/vegMode"
import { useLocation } from "@food/hooks/useLocation"
import { useZone } from "@food/hooks/useZone"
import { useDelayedLoading } from "@food/hooks/useDelayedLoading"
import { getMenuFromResponse } from "@food/utils/menuItems"
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability"
import { compareRestaurantsByAvailabilityAndDistance } from "@food/utils/restaurantBrowseSort"
import { calculateDistance, formatDistance } from "@food/utils/common"
import {
  saveCategoryBrowseClick,
  getCategoryLastClick,
  categoryBrowseNeedsRestore,
  trackCategoryWindowScrollY,
  peekBrowseScroll,
  peekBrowseScrollAny,
} from "@food/utils/browseScrollMemory"
import { toFoodUserPath, getRestaurantRouteId } from "@food/utils/mainTabRoutes"
import RestaurantImageCarousel from "@food/components/user/RestaurantImageCarousel"
import {
  peekCategoryListCache,
  setCategoryListCache,
  peekCategoryRestaurantsCache,
  setCategoryRestaurantsCache,
} from "../../utils/categoryCache"

/** First paint: fewer restaurants + progressive menu enrichment */
const CATEGORY_FETCH_LIMIT = 18
const ALL_LIST_INITIAL_VISIBLE = 8
const ALL_LIST_LOAD_MORE = 6
const RECOMMENDED_MAX_ITEMS = 24
const MENU_ENRICH_BATCH = 3

// Filter options
const filterOptions = [
  { id: 'under-30-mins', label: 'Under 30 mins' },
  { id: 'price-match', label: 'Price Match', hasIcon: true },
  { id: 'flat-50-off', label: 'Flat 50% OFF', hasIcon: true },
  { id: 'under-250', label: 'Under ₹250' },
  { id: 'rating-4-plus', label: 'Rating 4.0+' },
]

// Mock data removed - using backend data only

const CATEGORY_PAGE_FILTERS_STORAGE_KEY = "food-category-page-filters-v1"

const debugLog = (...args) => {};
const debugWarn = (...args) => {};
const debugError = (...args) => {};

// In-memory cache to avoid localStorage quota limits and slow JSON parsing for large menus

export default function CategoryPage({
  embeddedCategorySlug = null,
  hideHeader = false,
  hideCategoryCarousel = false,
  hideFilters = false,
  disableAutoScroll = false,
  isBrowseActive = true,
}) {
  const params = useParams()
  const category = embeddedCategorySlug || params.category
  const navigate = useNavigate()
  const { vegMode, vegModeOption } = useProfile()
  const { location } = useLocation()
  const { zoneId, isOutOfService, loading: loadingZone } = useZone(location)
  const navType = useNavigationType()
  const recommendedSectionRef = useRef(null)
  const hasAutoScrolledRef = useRef(false)



  // Let the network fetch effect handle clearing stale data if the zone actually changes.
  useEffect(() => {
    if (!isBrowseActive) return
    if (!loadingZone) return
    const cached = peekCategoryListCache(zoneId)
    if (Array.isArray(cached?.categories) && cached.categories.length > 1) return
    setLoadingCategories(true)
  }, [loadingZone, isBrowseActive, zoneId])
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState(category?.toLowerCase() || 'all')
  // Always prefer URL/embedded slug so save+restore paths stay stable (not mongo id).
  const categoryBackPath = `/user/category/${String(
    embeddedCategorySlug || category || selectedCategory || "all",
  ).toLowerCase()}`
  const [activeFilters, setActiveFilters] = useState(new Set())
  const [favorites, setFavorites] = useState(new Set())
  const [sortBy, setSortBy] = useState(null)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [activeFilterTab, setActiveFilterTab] = useState('sort')
  const [activeScrollSection, setActiveScrollSection] = useState('sort')
  const [isLoadingFilterResults, setIsLoadingFilterResults] = useState(false)
  const filterSectionRefs = useRef({})
  const rightContentRef = useRef(null)
  const categoryScrollRef = useRef(null)
  const stickyHeaderRef = useRef(null)
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(0)
  const menuEnrichmentRequestRef = useRef(0)
  const approvedFoodsCacheRef = useRef(null)
  const approvedFoodsInFlightRef = useRef(null)
  const hasRestoredCategoryFiltersRef = useRef(false)
  const lastFetchedCategoryRef = useRef(null)

  // State for categories from admin (seed from memory cache — no "No categories" flash)
  const [categories, setCategories] = useState(() => {
    const cached = peekCategoryListCache(zoneId)
    return Array.isArray(cached?.categories) && cached.categories.length > 0
      ? cached.categories
      : []
  })
  const [loadingCategories, setLoadingCategories] = useState(() => {
    const cached = peekCategoryListCache(zoneId)
    return !(Array.isArray(cached?.categories) && cached.categories.length > 1)
  })
  const [categoryKeywords, setCategoryKeywords] = useState(() => {
    const cached = peekCategoryListCache(zoneId)
    return cached?.keywords && typeof cached.keywords === "object" ? cached.keywords : {}
  })

  const displayCategories = useMemo(() => {
    if (!Array.isArray(categories)) return []
    if (!vegMode) return categories
    return categories.filter(
      (cat) => cat?.id === "all" || cat?.slug === "all" || !isNonVegCategoryScope(cat),
    )
  }, [categories, vegMode])

  // Clear non-veg category selection when veg mode turns on
  useEffect(() => {
    if (!vegMode || !selectedCategory || selectedCategory === "all") return
    const selected = categories.find(
      (cat) =>
        String(cat?.slug || "").toLowerCase() === String(selectedCategory).toLowerCase() ||
        String(cat?.id || "") === String(selectedCategory),
    )
    if (selected && isNonVegCategoryScope(selected)) {
      setSelectedCategory("all")
    }
  }, [vegMode, selectedCategory, categories])

  const activeCategory = useMemo(() => {
    if (!selectedCategory || selectedCategory === 'all' || !categories) return null;
    return categories.find(c =>
      c.slug === selectedCategory ||
      c.id === selectedCategory ||
      c.name?.toLowerCase().replace(/\s+/g, '-') === selectedCategory
    );
  }, [selectedCategory, categories]);

  const activeCategoryIds = useMemo(() => {
    if (!activeCategory || !categories) return [];
    const targetName = activeCategory.name?.toLowerCase();
    return categories
      .filter(c => c.name?.toLowerCase() === targetName)
      .map(c => c.id)
      .filter(Boolean);
  }, [activeCategory, categories]);

  const [restaurantsData, setRestaurantsData] = useState(() => {
    const initialCategory = category?.toLowerCase() || 'all';
    const cached = peekCategoryRestaurantsCache(initialCategory, zoneId, [])
    return cached?.restaurants || []
  })
  const [loadingRestaurants, setLoadingRestaurants] = useState(() => {
    const initialCategory = category?.toLowerCase() || 'all';
    return !peekCategoryRestaurantsCache(initialCategory, zoneId, [])
  })
  const [isEnrichingMenus, setIsEnrichingMenus] = useState(false)
  const [approvedFoodsData, setApprovedFoodsData] = useState([])
  const [visibleAllCount, setVisibleAllCount] = useState(ALL_LIST_INITIAL_VISIBLE)
  const allListSentinelRef = useRef(null)
  const lastScrolledCategoryRef = useRef(null)
  const hasRestoredBrowseScrollRef = useRef(false)
  const savedScrollYRef = useRef(0)
  const liveScrollYRef = useRef(0)
  const savedVisibleCountRef = useRef(ALL_LIST_INITIAL_VISIBLE)
  // Skeleton only while chips are actually loading — don't hide behind restaurant cache
  const showCategorySkeleton = useDelayedLoading(
    (loadingCategories || loadingZone) && categories.length <= 1,
    { delay: 60, minDuration: 120 },
  )
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const BACKEND_ORIGIN = useMemo(() => API_BASE_URL.replace(/\/api\/?$/, ""), [])
  const slugify = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
  const normalizeCategoryToken = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  const matchesCategoryText = (value, keywords) => {
    const normalizedValue = normalizeCategoryToken(value)
    if (!normalizedValue) return false

    return keywords.some((keyword) => {
      const normalizedKeyword = normalizeCategoryToken(keyword)
      if (!normalizedKeyword) return false
      return (
        normalizedValue === normalizedKeyword ||
        normalizedValue.includes(normalizedKeyword) ||
        slugify(normalizedValue) === slugify(normalizedKeyword)
      )
    })
  }
  const uniqueByRestaurant = (list) => {
    const seen = new Set()
    return list.filter((row) => {
      // Use distinct keys for dishes vs restaurants to prevent collisions
      const key = row.dishId ? `dish-${row.dishId}` : (row.restaurantId || row.id || `raw-${slugify(row.name)}`)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  const toArray = (value) => {
    if (Array.isArray(value)) return value
    if (!value || typeof value !== "object") return []
    return Object.values(value).filter((entry) => entry && typeof entry === "object")
  }

  const normalizeMenu = (menu) => {
    const rawSections = toArray(menu?.sections)
    return {
      ...menu,
      sections: rawSections.map((section, sectionIndex) => ({
        ...section,
        id: String(section?.id || section?._id || `section-${sectionIndex}`),
        name: section?.name || section?.title || "Unnamed Section",
        items: toArray(section?.items).map((item, itemIndex) => ({
          ...item,
          id: String(item?.id || item?._id || `${sectionIndex}-${itemIndex}`),
        })),
        subsections: toArray(section?.subsections).map((subsection, subsectionIndex) => ({
          ...subsection,
          id: String(subsection?.id || subsection?._id || `subsection-${sectionIndex}-${subsectionIndex}`),
          name: subsection?.name || "Unnamed Subsection",
          items: toArray(subsection?.items).map((item, itemIndex) => ({
            ...item,
            id: String(item?.id || item?._id || `${sectionIndex}-${subsectionIndex}-${itemIndex}`),
          })),
        })),
      })),
    }
  }




  const buildFallbackMenuFromFoods = (foods, restaurant) => {
    const restaurantIds = new Set(
      [
        restaurant?.restaurantId,
        restaurant?.id,
        restaurant?.mongoId,
      ]
        .filter(Boolean)
        .map((value) => String(value).trim())
    )

    const restaurantName = String(restaurant?.name || "").trim().toLowerCase()
    const matchingFoods = foods.filter((food) => {
      const foodRestaurantId = String(food?.restaurantId || "").trim()
      const foodRestaurantName = String(food?.restaurantName || "").trim().toLowerCase()
      return (
        (foodRestaurantId && restaurantIds.has(foodRestaurantId)) ||
        (restaurantName && foodRestaurantName === restaurantName)
      )
    })

    if (matchingFoods.length === 0) {
      return null
    }

    const sectionsMap = new Map()
    matchingFoods.forEach((food, index) => {
      const sectionName = String(food?.categoryName || food?.category || "Varieties").trim() || "Varieties"
      const sectionKey = slugify(sectionName)
      if (!sectionsMap.has(sectionKey)) {
        sectionsMap.set(sectionKey, {
          id: sectionKey || `section-${index}`,
          name: sectionName,
          items: [],
          subsections: [],
        })
      }

      sectionsMap.get(sectionKey).items.push({
        id: String(food?.id || food?._id || `${sectionKey}-${index}`),
        _id: food?._id,
        name: food?.name || "Unnamed Item",
        description: food?.description || "",
        price: Number(food?.price || 0),
        originalPrice: Number(food?.originalPrice || food?.price || 0),
        image: normalizeImageUrl(food?.image),
        foodType: food?.foodType || "Non-Veg",
        isAvailable: food?.isAvailable !== false,
        categoryName: food?.categoryName || sectionName,
        category: food?.categoryName || sectionName,
        preparationTime: food?.preparationTime || "",
        approvalStatus: food?.approvalStatus || "approved",
      })
    })

    return {
      sections: Array.from(sectionsMap.values()),
    }
  }

  const getCategoryFallbackDishesFromApprovedFoods = (categoryId, restaurants) => {
    const keywords = getCategoryKeywords(categoryId)
    if (keywords.length === 0 || !Array.isArray(approvedFoodsData) || approvedFoodsData.length === 0) {
      return []
    }

    const restaurantsById = new Map()
    const restaurantsByName = new Map()
    ;(Array.isArray(restaurants) ? restaurants : []).forEach((restaurant) => {
      const idCandidates = [
        restaurant?.restaurantId,
        restaurant?.id,
        restaurant?.mongoId,
      ]
        .filter(Boolean)
        .map((value) => String(value).trim())

      idCandidates.forEach((value) => {
        if (!restaurantsById.has(value)) {
          restaurantsById.set(value, restaurant)
        }
      })

      const normalizedName = String(restaurant?.name || "").trim().toLowerCase()
      if (normalizedName && !restaurantsByName.has(normalizedName)) {
        restaurantsByName.set(normalizedName, restaurant)
      }
    })

    return approvedFoodsData
      .filter((food) => {
        if (food?.isAvailable === false) return false
        if (String(food?.approvalStatus || "").toLowerCase() !== "approved") return false

        const categoryName = String(food?.categoryName || food?.category || "").toLowerCase()
        const foodName = String(food?.name || "").toLowerCase()
        return (
          matchesCategoryText(categoryName, keywords) ||
          matchesCategoryText(foodName, keywords)
        )
      })
      .map((food, index) => {
        const restaurantId = String(food?.restaurantId || "").trim()
        const restaurantName = String(food?.restaurantName || "").trim()
        const matchedRestaurant =
          restaurantsById.get(restaurantId) ||
          restaurantsByName.get(restaurantName.toLowerCase()) ||
          null

        const fallbackRestaurantName = restaurantName || "Restaurant"
        const fallbackSlug = slugify(fallbackRestaurantName)
        const fallbackImage = normalizeImageUrl(food?.image)

        return {
          ...(matchedRestaurant || {}),
          id: `${restaurantId || fallbackSlug || "restaurant"}-${String(food?.id || food?._id || index)}`,
          restaurantId: restaurantId || matchedRestaurant?.restaurantId || matchedRestaurant?.id || null,
          mongoId: matchedRestaurant?.mongoId || matchedRestaurant?.id || null,
          slug: matchedRestaurant?.slug || fallbackSlug,
          name: matchedRestaurant?.name || fallbackRestaurantName,
          image: matchedRestaurant?.image || fallbackImage,
          images: Array.isArray(matchedRestaurant?.images) && matchedRestaurant.images.length > 0
            ? matchedRestaurant.images
            : (fallbackImage ? [fallbackImage] : []),
          cuisine: matchedRestaurant?.cuisine || null,
          rating: matchedRestaurant?.rating || null,
          deliveryTime: matchedRestaurant?.deliveryTime || null,
          distance: matchedRestaurant?.distance || null,
          offer: matchedRestaurant?.offer || null,
          featuredDish: matchedRestaurant?.featuredDish || food?.name || null,
          featuredPrice: matchedRestaurant?.featuredPrice || Number(food?.price || 0),
          menu: matchedRestaurant?.menu || null,
          dishId: String(food?.id || food?._id || `${restaurantId}-${index}`),
          categoryDish: food,
          categoryDishName: food?.name || "Unnamed Item",
          categoryDishPrice: Number(food?.price || 0),
          categoryDishImage: fallbackImage,
          categoryDishFoodType: food?.foodType || "Non-Veg",
        }
      })
  }

  const normalizeImageUrl = (value) => {
    if (!value) return ""

    const raw =
      typeof value === "string"
        ? value
        : typeof value === "object"
          ? (value.url || value.secure_url || value.imageUrl || value.image || value.src || value.path || "")
          : ""

    if (typeof raw !== "string") return ""
    const trimmed = raw.trim()
    if (!trimmed) return ""
    if (/^data:/i.test(trimmed) || /^blob:/i.test(trimmed)) return trimmed

    const appProtocol = typeof window !== "undefined" ? window.location?.protocol : ""
    const appHost = typeof window !== "undefined" ? window.location?.hostname : ""
    let normalized = trimmed
      .replace(/\\/g, "/")
      .replace(/^(https?):\/(?!\/)/i, "$1://")
      .replace(/^(https?:\/\/)(https?:\/\/)/i, "$1")

    if (/^\/\//.test(normalized)) {
      normalized = `${appProtocol || "https:"}${normalized}`
    }

    const hasSignedParams = (url) =>
      /[?&](X-Amz-|Signature=|Expires=|AWSAccessKeyId=|GoogleAccessId=|token=|sig=|se=|sp=|sv=)/i.test(url)

    if (/^https?:\/\//i.test(normalized)) {
      try {
        const parsed = new URL(normalized, window.location.origin)
        if (
          appHost &&
          appHost !== "localhost" &&
          appHost !== "127.0.0.1" &&
          /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)
        ) {
          try {
            const backendUrl = new URL(BACKEND_ORIGIN)
            parsed.protocol = backendUrl.protocol
            parsed.hostname = backendUrl.hostname
            parsed.port = backendUrl.port
          } catch {
            parsed.protocol = window.location.protocol
            parsed.hostname = window.location.hostname
            if (window.location.port) parsed.port = window.location.port
          }
        }
        if (appProtocol === "https:" && parsed.protocol === "http:") {
          parsed.protocol = "https:"
        }
        const finalUrl = parsed.toString()
        return hasSignedParams(finalUrl) ? finalUrl : encodeURI(finalUrl)
      } catch {
        return normalized
      }
    }

    const absolutePath = normalized.startsWith("/")
      ? `${BACKEND_ORIGIN}${normalized}`
      : `${BACKEND_ORIGIN}/${normalized.replace(/^\.?\/*/, "")}`

    try {
      const parsed = new URL(absolutePath, window.location.origin)
      if (appProtocol === "https:" && parsed.protocol === "http:") {
        parsed.protocol = "https:"
      }
      const finalUrl = parsed.toString()
      return hasSignedParams(finalUrl) ? finalUrl : encodeURI(finalUrl)
    } catch {
      return absolutePath
    }
  }

  const currentFilterStorageKey = useMemo(
    () => slugify(selectedCategory || category || "all") || "all",
    [selectedCategory, category]
  )

  const parseFirstNumber = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) return value
    const match = String(value || "").match(/(\d+(?:\.\d+)?)/)
    return match ? Number(match[1]) : null
  }

  const getComparableDeliveryTime = (row) => parseFirstNumber(row?.deliveryTime)

  const getComparableDistance = (row) => {
    const raw = String(row?.distance || "").trim().toLowerCase()
    if (!raw) return null

    const parsed = parseFirstNumber(raw)
    if (parsed == null) return null
    if (raw.includes("m") && !raw.includes("km")) {
      return parsed / 1000
    }
    return parsed
  }

  const getComparablePrice = (row) => {
    if (Array.isArray(row?.recommendedDishes) && row.recommendedDishes.length > 0) {
      const prices = row.recommendedDishes
        .map((dish) => Number(dish?.price))
        .filter((price) => Number.isFinite(price))
      if (prices.length > 0) return Math.min(...prices)
    }
    const raw = row?.categoryDishPrice ?? row?.featuredPrice ?? null
    const parsed = typeof raw === "number" ? raw : parseFirstNumber(raw)
    return Number.isFinite(parsed) ? parsed : null
  }

  const getComparableRating = (row) => {
    const parsed = typeof row?.rating === "number" ? row.rating : parseFirstNumber(row?.rating)
    return Number.isFinite(parsed) ? parsed : null
  }

  const matchesOfferText = (value, pattern) => pattern.test(String(value || ""))

  const applyFiltersAndSorting = (rows) => {
    let nextRows = Array.isArray(rows) ? [...rows] : []

    if (activeFilters.has('under-30-mins')) {
      nextRows = nextRows.filter((row) => {
        const time = getComparableDeliveryTime(row)
        return time != null && time <= 30
      })
    }

    if (activeFilters.has('delivery-under-45')) {
      nextRows = nextRows.filter((row) => {
        const time = getComparableDeliveryTime(row)
        return time != null && time <= 45
      })
    }

    if (activeFilters.has('rating-35-plus')) {
      nextRows = nextRows.filter((row) => {
        const rating = getComparableRating(row)
        return rating != null && rating >= 3.5
      })
    }

    if (activeFilters.has('rating-4-plus')) {
      nextRows = nextRows.filter((row) => {
        const rating = getComparableRating(row)
        return rating != null && rating >= 4.0
      })
    }

    if (activeFilters.has('rating-45-plus')) {
      nextRows = nextRows.filter((row) => {
        const rating = getComparableRating(row)
        return rating != null && rating >= 4.5
      })
    }

    if (activeFilters.has('distance-under-1km')) {
      nextRows = nextRows.filter((row) => {
        const distance = getComparableDistance(row)
        return distance != null && distance <= 1
      })
    }

    if (activeFilters.has('distance-under-2km')) {
      nextRows = nextRows.filter((row) => {
        const distance = getComparableDistance(row)
        return distance != null && distance <= 2
      })
    }

    if (activeFilters.has('price-under-200')) {
      nextRows = nextRows.filter((row) => {
        const price = getComparablePrice(row)
        return price != null && price <= 200
      })
    }

    if (activeFilters.has('under-250')) {
      nextRows = nextRows.filter((row) => {
        const price = getComparablePrice(row)
        return price != null && price <= 250
      })
    }

    if (activeFilters.has('price-under-500')) {
      nextRows = nextRows.filter((row) => {
        const price = getComparablePrice(row)
        return price != null && price <= 500
      })
    }

    if (activeFilters.has('flat-50-off')) {
      nextRows = nextRows.filter((row) => matchesOfferText(row?.offer, /50\s*%/i))
    }

    if (activeFilters.has('price-match')) {
      nextRows = nextRows.filter((row) =>
        matchesOfferText(row?.offer, /price\s*match/i) ||
        matchesOfferText(row?.priceRange, /price\s*match/i) ||
        matchesOfferText(row?.categoryDish?.description, /price\s*match/i)
      )
    }

    if (deferredSearchQuery.trim()) {
      const query = deferredSearchQuery.toLowerCase()
      nextRows = nextRows.filter((row) =>
        row.name?.toLowerCase().includes(query) ||
        row.cuisine?.toLowerCase().includes(query) ||
        row.featuredDish?.toLowerCase().includes(query) ||
        row.categoryDishName?.toLowerCase().includes(query) ||
        (Array.isArray(row.recommendedDishes) &&
          row.recommendedDishes.some((dish) =>
            String(dish?.name || "").toLowerCase().includes(query),
          ))
      )
    }

    if (sortBy) {
      nextRows.sort((left, right) => {
        if (sortBy === 'price-low' || sortBy === 'price-high') {
          const leftPrice = getComparablePrice(left)
          const rightPrice = getComparablePrice(right)
          if (leftPrice == null && rightPrice == null) return 0
          if (leftPrice == null) return 1
          if (rightPrice == null) return -1
          return sortBy === 'price-low' ? leftPrice - rightPrice : rightPrice - leftPrice
        }

        if (sortBy === 'rating-high' || sortBy === 'rating-low') {
          const leftRating = getComparableRating(left)
          const rightRating = getComparableRating(right)
          if (leftRating == null && rightRating == null) return 0
          if (leftRating == null) return 1
          if (rightRating == null) return -1
          return sortBy === 'rating-high' ? rightRating - leftRating : leftRating - rightRating
        }

        return 0
      })
    }

    const uniqueList = uniqueByRestaurant(nextRows)
    const sortedList = uniqueList
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const byBrowse = compareRestaurantsByAvailabilityAndDistance(a.row, b.row)
        if (byBrowse !== 0) return byBrowse
        return a.index - b.index
      })
      .map(item => item.row)

    return sortedList
  }

  // Fetch categories from admin API (memory-cached — no empty flash on reopen)
  useEffect(() => {
    if (loadingZone) return
    if (!isBrowseActive) return

    let isCancelled = false

    const fetchCategories = async () => {
      try {
        const cached = peekCategoryListCache(zoneId)
        if (Array.isArray(cached?.categories) && cached.categories.length > 1) {
          setCategories(cached.categories)
          if (cached.keywords) setCategoryKeywords(cached.keywords)
          setLoadingCategories(false)
          return
        }

        // Already loaded in this mount
        if (categories.length > 1) {
          setLoadingCategories(false)
          return
        }

        setLoadingCategories(true)
        const response = await adminAPI.getPublicCategories(zoneId ? { zoneId } : {})

        if (isCancelled) return

        if (response.data && response.data.success && response.data.data && response.data.data.categories) {
          const categoriesArray = response.data.data.categories

          const transformedCategories = [
            { id: 'all', name: "All", image: null, slug: 'all' },
            ...categoriesArray.map((cat) => ({
              id: String(cat._id || cat.id || ''),
              name: cat.name,
              image: cat.image || foodImages[0],
              slug: cat.slug || cat.name.toLowerCase().replace(/\s+/g, '-'),
              type: cat.type,
              foodTypeScope: cat.foodTypeScope || cat.type || "",
            }))
          ]

          const keywordsMap = {}
          categoriesArray.forEach((cat) => {
            const categoryId = String(cat._id || cat.id || '')
            const categoryName = cat.name.toLowerCase()
            const words = categoryName.split(/[\s-]+/).filter(w => w.length > 0)
            keywordsMap[categoryId] = [categoryName, ...words]
          })

          setCategories(transformedCategories)
          setCategoryKeywords(keywordsMap)
          setCategoryListCache(zoneId, {
            categories: transformedCategories,
            keywords: keywordsMap,
          })
        } else if (categories.length === 0) {
          setCategories([{ id: 'all', name: "All", image: null, slug: 'all' }])
        }
      } catch (error) {
        if (isCancelled) return
        debugError('Error fetching categories:', error)
        if (categories.length === 0) {
          setCategories([{ id: 'all', name: "All", image: null, slug: 'all' }])
        }
      } finally {
        if (!isCancelled) setLoadingCategories(false)
      }
    }

    fetchCategories()

    return () => {
      isCancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed from cache; avoid loop on categories.length
  }, [zoneId, loadingZone, isBrowseActive])

  // Helper function to check if menu has dishes matching category keywords
  const getCategoryKeywords = (categoryId) => {
    const raw = String(categoryId || "").trim().toLowerCase()
    const fromAdmin = categoryKeywords[raw]
    let keywords = []
    if (Array.isArray(fromAdmin) && fromAdmin.length > 0) {
      keywords = [...fromAdmin]
    } else {
      // Fallback: derive keywords from the slug in URL (e.g. "samosha" -> ["samosha"])
      // This prevents "no data" when admin categories don't include the slug.
      const parts = raw.split(/[\s-]+/).filter(Boolean)
      keywords = parts.length > 0 ? Array.from(new Set([raw, ...parts])) : []
    }

    // Add common variations/misspellings (e.g. "samosha" vs "samosa")
    if (keywords.includes('samosha') || keywords.includes('samosa')) {
      if (!keywords.includes('samosa')) keywords.push('samosa')
      if (!keywords.includes('samosha')) keywords.push('samosha')
    }

    return keywords
  }

  const checkCategoryInMenu = (menu, categoryId) => {
    if (!menu || !menu.sections || !Array.isArray(menu.sections)) {
      return false
    }

    const targetIds = activeCategoryIds
    const keywords = getCategoryKeywords(categoryId)

    for (const section of menu.sections) {
      const sectionNameLower = (section.name || '').toLowerCase()
      if (keywords.length > 0 && matchesCategoryText(sectionNameLower, keywords)) {
        return true
      }

      if (section.items && Array.isArray(section.items)) {
        for (const item of section.items) {
          const itemNameLower = (item.name || '').toLowerCase()
          const itemCategoryLower = (item.categoryName || item.category || '').toLowerCase()

          // Match by category ID
          if (targetIds.length > 0 && item.categoryId && targetIds.includes(String(item.categoryId))) {
            return true
          }

          // Match by name or category keywords
          if (
            keywords.length > 0 &&
            (matchesCategoryText(itemNameLower, keywords) ||
             matchesCategoryText(itemCategoryLower, keywords))
          ) {
            return true
          }
        }
      }

      if (section.subsections && Array.isArray(section.subsections)) {
        for (const subsection of section.subsections) {
          const subsectionNameLower = (subsection?.name || "").toLowerCase()
          if (keywords.length > 0 && matchesCategoryText(subsectionNameLower, keywords)) {
            return true
          }

          const subItems = Array.isArray(subsection?.items) ? subsection.items : []
          for (const item of subItems) {
            const itemNameLower = (item?.name || "").toLowerCase()
            const itemCategoryLower = (item?.categoryName || item?.category || "").toLowerCase()

            // Match by category ID
            if (targetIds.length > 0 && item.categoryId && targetIds.includes(String(item.categoryId))) {
              return true
            }

            // Match by name or category keywords
            if (
              keywords.length > 0 &&
              (matchesCategoryText(itemNameLower, keywords) ||
               matchesCategoryText(itemCategoryLower, keywords))
            ) {
              return true
            }
          }
        }
      }
    }

    return false
  }

  // Helper function to get ALL dishes matching a category from menu (returns array of dish info)
  const getAllCategoryDishesFromMenu = (menu, categoryId) => {
    if (!menu || !menu.sections || !Array.isArray(menu.sections)) {
      return []
    }

    const matchingDishes = []
    const targetIds = activeCategoryIds
    const keywords = getCategoryKeywords(categoryId)
    const seenItemIds = new Set() // Prevent duplicate items

    const addMatchingDish = (item, section, subsection = null) => {
      const itemId = item._id || item.id || `${item.name}-${item.price}`
      if (seenItemIds.has(String(itemId))) return
      seenItemIds.add(String(itemId))

      const originalPrice = item.originalPrice || item.price || 0
      const discountPercent = item.discountPercent || 0
      const finalPrice = discountPercent > 0
        ? Math.round(originalPrice * (1 - discountPercent / 100))
        : originalPrice

      const dishImage = normalizeImageUrl(
        item.image?.url || item.image || subsection?.image?.url || subsection?.image || section.image?.url || section.image
      )

      matchingDishes.push({
        name: item.name,
        price: finalPrice,
        image: dishImage,
        originalPrice: originalPrice,
        itemId: itemId,
        foodType: item.foodType,
      })
    }

    for (const section of menu.sections) {
      const sectionNameLower = (section?.name || "").toLowerCase()
      const sectionMatchesKeyword = keywords.length > 0 && matchesCategoryText(sectionNameLower, keywords)

      if (section.items && Array.isArray(section.items)) {
        for (const item of section.items) {
          const itemNameLower = (item.name || '').toLowerCase()
          const itemCategoryLower = (item.categoryName || item.category || '').toLowerCase()

          const matchesId = targetIds.length > 0 && item.categoryId && targetIds.includes(String(item.categoryId))
          const matchesKeyword = keywords.length > 0 && (
            sectionMatchesKeyword ||
            matchesCategoryText(itemNameLower, keywords) ||
            matchesCategoryText(itemCategoryLower, keywords)
          )

          if (matchesId || matchesKeyword) {
            addMatchingDish(item, section)
          }
        }
      }

      if (section.subsections && Array.isArray(section.subsections)) {
        for (const subsection of section.subsections) {
          const subsectionNameLower = (subsection?.name || "").toLowerCase()
          const subsectionMatchesKeyword = keywords.length > 0 && matchesCategoryText(subsectionNameLower, keywords)
          const subItems = Array.isArray(subsection?.items) ? subsection.items : []

          for (const item of subItems) {
            const itemNameLower = (item?.name || "").toLowerCase()
            const itemCategoryLower = (item?.categoryName || item?.category || "").toLowerCase()

            const matchesId = targetIds.length > 0 && item.categoryId && targetIds.includes(String(item.categoryId))
            const matchesKeyword = keywords.length > 0 && (
              sectionMatchesKeyword ||
              subsectionMatchesKeyword ||
              matchesCategoryText(itemNameLower, keywords) ||
              matchesCategoryText(itemCategoryLower, keywords)
            )

            if (matchesId || matchesKeyword) {
              addMatchingDish(item, section, subsection)
            }
          }
        }
      }
    }

    return matchingDishes
  }

  const toRecommendedDish = (dish, restaurant) => {
    const coverImage =
      restaurant?.image ||
      (Array.isArray(restaurant?.images) ? restaurant.images.find(Boolean) : "") ||
      ""
    const foodType = isVegMenuItem(dish) ? "Veg" : (dish?.foodType || dish?.categoryDishFoodType || "Non-Veg")
    return {
      id: dish?.itemId || dish?.id || dish?._id || `${dish?.name}-${dish?.price}`,
      name: dish?.name || "Unnamed Item",
      price: Number(dish?.price || 0),
      image: dish?.image || "",
      foodType,
    }
  }

  const buildRestaurantCardWithCategoryDishes = (restaurant, dishes) => {
    const recommendedDishes = (Array.isArray(dishes) ? dishes : [])
      .map((dish) => toRecommendedDish(dish, restaurant))
      .filter((dish) => dish.name)
    if (recommendedDishes.length === 0) return null

    const first = recommendedDishes[0]
    const restaurantId = restaurant?.id || restaurant?.restaurantId || restaurant?.mongoId || restaurant?.slug

    return {
      ...restaurant,
      id: restaurantId,
      recommendedDishes,
      dishId: first.id,
      categoryDishName: first.name,
      categoryDishPrice: first.price,
      categoryDishImage: first.image,
      categoryDishFoodType: first.foodType,
    }
  }

  /** One card per restaurant; category dishes go into recommendedDishes for Home-style carousel */
  const groupRestaurantsByCategoryDishes = (restaurants, categoryId) => {
    const cards = []
    ;(Array.isArray(restaurants) ? restaurants : []).forEach((restaurant) => {
      // Prefer search API dishes / already-built carousel dishes — skip waiting on full menus
      if (Array.isArray(restaurant.recommendedDishes) && restaurant.recommendedDishes.length > 0) {
        cards.push(restaurant)
        return
      }

      let categoryDishes = []
      if (Array.isArray(restaurant.categoryDishes) && restaurant.categoryDishes.length > 0) {
        categoryDishes = restaurant.categoryDishes.map((dish) => ({
          itemId: dish?._id || dish?.id || dish?.itemId,
          name: dish?.name,
          price: dish?.price,
          image: dish?.image,
          foodType: dish?.foodType,
        }))
      } else {
        if (!restaurant?.menu) return
        if (!checkCategoryInMenu(restaurant.menu, categoryId)) return
        categoryDishes = getAllCategoryDishesFromMenu(restaurant.menu, categoryId)
      }

      if (vegMode) {
        categoryDishes = categoryDishes.filter((dish) =>
          vegModeOption === "pure-vegan"
            ? isVeganMenuItem(dish)
            : isVegMenuItem(dish),
        )
      }
      const card = buildRestaurantCardWithCategoryDishes(restaurant, categoryDishes)
      if (card) cards.push(card)
    })
    return cards
  }

  const groupFallbackDishesByRestaurant = (fallbackRows) => {
    const byRestaurant = new Map()

    ;(Array.isArray(fallbackRows) ? fallbackRows : []).forEach((row) => {
      const key = String(
        row?.restaurantId || row?.mongoId || row?.slug || row?.name || row?.id || "",
      ).trim()
      if (!key) return

      if (!byRestaurant.has(key)) {
        const restaurantId = row?.restaurantId || row?.mongoId || row?.slug || key
        byRestaurant.set(key, {
          ...row,
          id: restaurantId,
          recommendedDishes: [],
        })
      }

      const entry = byRestaurant.get(key)
      entry.recommendedDishes.push(
        toRecommendedDish(
          {
            itemId: row?.dishId,
            id: row?.dishId,
            name: row?.categoryDishName,
            price: row?.categoryDishPrice,
            image: row?.categoryDishImage,
            foodType: row?.categoryDishFoodType,
          },
          row,
        ),
      )
    })

    return Array.from(byRestaurant.values())
      .map((row) => {
        const dishes = row.recommendedDishes || []
        if (dishes.length === 0) return null
        const first = dishes[0]
        return {
          ...row,
          recommendedDishes: dishes,
          dishId: first.id,
          categoryDishName: first.name,
          categoryDishPrice: first.price,
          categoryDishImage: first.image,
          categoryDishFoodType: first.foodType,
        }
      })
      .filter(Boolean)
  }

  // Helper function to get FIRST featured dish for a category from menu (for backward compatibility)
  const getCategoryDishFromMenu = (menu, categoryId) => {
    const allDishes = getAllCategoryDishesFromMenu(menu, categoryId)
    return allDishes.length > 0 ? allDishes[0] : null
  }

  // Fetch restaurants from API
  useEffect(() => {
    if (!isBrowseActive) return;
    if (loadingZone || loadingCategories) return; // Prevent fetching while zone or categories are resolving

    let isCancelled = false

    const fetchRestaurants = async () => {
      try {
        const catKey = String(selectedCategory || "").toLowerCase()

        // Always prefer memory cache (slug + id keys) — instant revisit
        const cachedHit = peekCategoryRestaurantsCache(catKey, zoneId, categories)
        if (cachedHit?.restaurants) {
          setRestaurantsData(cachedHit.restaurants)
          setLoadingRestaurants(false)
          setIsEnrichingMenus(false)
          lastFetchedCategoryRef.current = catKey
          return
        }

        if (lastFetchedCategoryRef.current === catKey) {
          setLoadingRestaurants(false)
          return
        }

        // No cache yet — clear and load
        setRestaurantsData([])
        setLoadingRestaurants(true)
        // Pass coordinates and category to backend for server-side optimization
        const params = {
          limit: CATEGORY_FETCH_LIMIT,
          page: 1,
        }

        if (location?.latitude && location?.longitude) {
          params.lat = parseFloat(location.latitude.toFixed(4));
          params.lng = parseFloat(location.longitude.toFixed(4));
        }

        if (zoneId) {
          params.zoneId = zoneId;
        }

        // When zone is known, list by zone (not city name) so villages inside a
        // zone still see that zone's restaurants.
        const normalizedUserCity = String(location?.city || "")
          .trim()
          .toLowerCase();
        const hasUsableUserCity =
          normalizedUserCity &&
          normalizedUserCity !== "current location" &&
          normalizedUserCity !== "unknown city" &&
          normalizedUserCity !== "select location";
        if (!zoneId && hasUsableUserCity) {
          params.city = String(location.city).trim();
        }

        // Compute active category inside the effect to avoid it as a dependency
        const resolvedCategory = (selectedCategory && selectedCategory !== 'all' && categories?.length > 0)
          ? categories.find(c =>
              c.slug === selectedCategory ||
              c.id === selectedCategory ||
              c.name?.toLowerCase().replace(/\s+/g, '-') === selectedCategory
            )
          : null

        let response
        if (selectedCategory && selectedCategory !== 'all') {
          if (resolvedCategory && resolvedCategory.id && resolvedCategory.id !== 'all' && /^[0-9a-fA-F]{24}$/.test(resolvedCategory.id)) {
            response = await searchAPI.unifiedSearch({
              categoryId: resolvedCategory.id,
              zoneId: params.zoneId,
              lat: params.lat,
              lng: params.lng,
              limit: CATEGORY_FETCH_LIMIT,
              page: 1,
            })
          } else {
            // Fallback to text query if categories are still loading or if ID is not ObjectId
            response = await searchAPI.unifiedSearch({
              q: selectedCategory,
              zoneId: params.zoneId,
              lat: params.lat,
              lng: params.lng,
              limit: CATEGORY_FETCH_LIMIT,
              page: 1,
            })
          }
        } else {
          response = await restaurantAPI.getRestaurants(params)
        }

        if (isCancelled) return

        if (response.data && response.data.success && response.data.data && response.data.data.restaurants) {
          const restaurantsArray = response.data.data.restaurants

          // Helper function to check if value is a default/mock value
          const isDefaultValue = (value, fieldName) => {
            if (!value) return false

            const defaultOffers = [
              "Flat ₹50 OFF above ₹199",
              "Flat 50% OFF",
              "Flat ₹40 OFF above ₹149"
            ]
            const defaultDeliveryTimes = ["25-30 mins", "20-25 mins", "30-35 mins"]
            const defaultDistances = ["1.2 km", "1 km", "0.8 km"]
            const defaultFeaturedPrice = 249

            if (fieldName === 'offer' && defaultOffers.includes(value)) return true
            if (fieldName === 'deliveryTime' && defaultDeliveryTimes.includes(value)) return true
            if (fieldName === 'distance' && defaultDistances.includes(value)) return true
            if (fieldName === 'featuredPrice' && value === defaultFeaturedPrice) return true

            return false
          }

          // Transform restaurants - filter out default values
          const restaurantsWithIds = restaurantsArray
            .filter((restaurant) => {
              const displayName = String(restaurant.restaurantName || restaurant.name || "").trim()
              const hasName = displayName.length > 0
              return hasName
            })
            .map((restaurant) => {
              const deliveryTime =
                restaurant.deliveryTime ||
                restaurant.estimatedDeliveryTime ||
                (restaurant.estimatedDeliveryTimeMinutes
                  ? `${restaurant.estimatedDeliveryTimeMinutes} mins`
                  : "25-30 mins")

              const userLat = location?.latitude
              const userLng = location?.longitude
              const coords = restaurant.location?.coordinates
              const restaurantLat = Number(
                Array.isArray(coords) ? coords[1] : (restaurant.latitude ?? restaurant.lat),
              )
              const restaurantLng = Number(
                Array.isArray(coords) ? coords[0] : (restaurant.longitude ?? restaurant.lng),
              )
              let distanceInKm = Number(restaurant.distanceInKm ?? restaurant.distanceScore)
              if (!Number.isFinite(distanceInKm) || distanceInKm < 0) {
                distanceInKm = calculateDistance(userLat, userLng, restaurantLat, restaurantLng)
              }
              let distance =
                restaurant.distance &&
                String(restaurant.distance).trim() &&
                !/^0\s*m$/i.test(String(restaurant.distance).trim())
                  ? restaurant.distance
                  : null
              if (!distance && Number.isFinite(distanceInKm) && distanceInKm >= 0) {
                distance = formatDistance(distanceInKm)
              }
              if (distance && /^0\s*m$/i.test(String(distance).trim())) {
                distance = null
              }

              let offer = restaurant.offer || null

              if (isDefaultValue(offer, 'offer')) offer = null

              const cuisine = restaurant.cuisines && restaurant.cuisines.length > 0
                ? restaurant.cuisines.join(", ")
                : null

              const coverImages = restaurant.coverImages && restaurant.coverImages.length > 0
                ? restaurant.coverImages.map(img => normalizeImageUrl(img.url || img)).filter(Boolean)
                : []

              const fallbackImages = restaurant.menuImages && restaurant.menuImages.length > 0
                ? restaurant.menuImages.map(img => normalizeImageUrl(img.url || img)).filter(Boolean)
                : []

              const allImages = coverImages.length > 0
                ? coverImages
                : (fallbackImages.length > 0
                  ? fallbackImages
                  : (restaurant.profileImage?.url ? [normalizeImageUrl(restaurant.profileImage.url)] : []))

              const image = allImages[0] || null
              const restaurantId = restaurant.restaurantId || restaurant._id

              let featuredDish = restaurant.featuredDish || null
              let featuredPrice = restaurant.featuredPrice || null

              if (featuredPrice && isDefaultValue(featuredPrice, 'featuredPrice')) {
                featuredPrice = null
              }

              const restaurantName = (restaurant.restaurantName || restaurant.name || "").toLowerCase()

              return {
                id: restaurantId,
                name: restaurant.restaurantName || restaurant.name,
                cuisine: cuisine,
                rating: restaurant.rating || null,
                deliveryTime: deliveryTime,
                distance: distance,
                distanceInKm: Number.isFinite(distanceInKm) ? distanceInKm : null,
                location: restaurant.location || null,
                topOrder: Number.isFinite(Number(restaurant.__topOrder ?? restaurant.topOrder))
                  ? Number(restaurant.__topOrder ?? restaurant.topOrder)
                  : 1000000,
                __topOrder: Number.isFinite(Number(restaurant.__topOrder ?? restaurant.topOrder))
                  ? Number(restaurant.__topOrder ?? restaurant.topOrder)
                  : 1000000,
                image: image,
                images: allImages,
                priceRange: restaurant.priceRange || null,
                featuredDish: featuredDish,
                featuredPrice: featuredPrice,
                offer: offer,
                slug: restaurant.slug || (restaurant.restaurantName || restaurant.name)?.toLowerCase().replace(/\s+/g, '-'),
                restaurantId: restaurantId,
                mongoId: restaurant._id || null,
                hasPaneer: false,
                category: 'all',
                isActive: restaurant.isActive !== false,
                isAcceptingOrders: restaurant.isAcceptingOrders !== false,
                openDays: Array.isArray(restaurant.openDays) ? restaurant.openDays : [],
                deliveryTimings: restaurant.deliveryTimings || null,
                outletTimings: restaurant.outletTimings || null,
                openingTime: restaurant.openingTime || restaurant?.deliveryTimings?.openingTime || null,
                closingTime: restaurant.closingTime || restaurant?.deliveryTimings?.closingTime || null,
                categoryDishes: Array.isArray(restaurant.categoryDishes)
                  ? restaurant.categoryDishes
                      .map((dish) => ({
                        itemId: dish?._id || dish?.id || dish?.itemId,
                        name: dish?.name,
                        price: Number(dish?.price || 0),
                        image: normalizeImageUrl(dish?.image) || dish?.image || null,
                        foodType: dish?.foodType || "Non-Veg",
                      }))
                      .filter((dish) => dish.name)
                  : [],
              }
            }).filter(Boolean)

          if (isCancelled) return

          lastFetchedCategoryRef.current = String(selectedCategory || "").toLowerCase()

          // Search already returned category dishes — paint instantly, skip N+1 menu fetches
          const withSearchDishes = restaurantsWithIds.map((restaurant) => {
            if (!Array.isArray(restaurant.categoryDishes) || restaurant.categoryDishes.length === 0) {
              return restaurant
            }
            return (
              buildRestaurantCardWithCategoryDishes(restaurant, restaurant.categoryDishes) ||
              restaurant
            )
          })
          const searchDishCoverage =
            withSearchDishes.filter(
              (r) => Array.isArray(r.recommendedDishes) && r.recommendedDishes.length > 0,
            ).length

          // Save immediately so switching away mid-enrichment still caches this category
          setCategoryRestaurantsCache(
            selectedCategory,
            zoneId,
            withSearchDishes,
            categories,
          )

          startTransition(() => {
            setRestaurantsData(withSearchDishes)
          })

          if (
            selectedCategory &&
            selectedCategory !== "all" &&
            searchDishCoverage > 0 &&
            searchDishCoverage >= Math.ceil(withSearchDishes.length * 0.5)
          ) {
            setIsEnrichingMenus(false)
            return
          }

          setIsEnrichingMenus(true)
          const enrichmentRequestId = ++menuEnrichmentRequestRef.current
          void (async () => {
            try {
              const transformedRestaurants = withSearchDishes.map((r) => ({ ...r }))

              for (let index = 0; index < withSearchDishes.length; index += MENU_ENRICH_BATCH) {
                if (isCancelled) return
                const batchRestaurants = withSearchDishes.slice(index, index + MENU_ENRICH_BATCH)
                const batchResults = await Promise.all(
                  batchRestaurants.map(async (restaurant) => {
                     // Already have category dishes from search — keep them
                     if (Array.isArray(restaurant.recommendedDishes) && restaurant.recommendedDishes.length > 0) {
                       return restaurant
                     }
                     try {
                      const lookupIds = [
                        restaurant.mongoId,
                        restaurant.restaurantId,
                        restaurant.id,
                      ]
                        .filter(Boolean)
                        .map((value) => String(value).trim())
                        .filter((value, valueIndex, arr) => arr.indexOf(value) === valueIndex)
                        .filter((value) => /^[0-9a-fA-F]{24}$/.test(value))

                      let menu = null
                      for (const lookupId of lookupIds) {
                        try {
                          const menuResponse = await restaurantAPI.getMenuByRestaurantId(lookupId)
                          const rawMenu = getMenuFromResponse(menuResponse)
                          const normalizedMenu = normalizeMenu(rawMenu)
                          if (menuResponse?.data?.success && normalizedMenu?.sections?.length > 0) {
                            menu = normalizedMenu
                            break
                          }
                        } catch (lookupError) {
                          if (lookupError?.response?.status !== 404) {
                            throw lookupError
                          }
                        }
                      }

                      if (menu?.sections?.length > 0) {
                        const hasPaneer = checkCategoryInMenu(menu, 'paneer-tikka')

                        let featuredDish = restaurant.featuredDish
                        let featuredPrice = restaurant.featuredPrice

                        if (!featuredDish || !featuredPrice) {
                          for (const section of (menu.sections || [])) {
                            if (section.items && section.items.length > 0) {
                              const firstItem = section.items[0]
                              if (!featuredDish) featuredDish = firstItem.name
                              if (!featuredPrice) {
                                const originalPrice = firstItem.originalPrice || firstItem.price || 0
                                const discountPercent = firstItem.discountPercent || 0
                                featuredPrice = discountPercent > 0
                                  ? Math.round(originalPrice * (1 - discountPercent / 100))
                                  : originalPrice
                              }
                              break
                            }
                          }
                        }

                        return {
                          ...restaurant,
                          menu: menu,
                          hasPaneer: hasPaneer,
                          featuredDish: featuredDish || null,
                          featuredPrice: featuredPrice || null,
                          categoryMatches: {},
                        }
                      }
                    } catch (error) {
                      debugWarn(`Failed to fetch menu for restaurant ${restaurant.restaurantId}:`, error)
                    }

                    return {
                      ...restaurant,
                      menu: null,
                      hasPaneer: false,
                      categoryMatches: {},
                    }
                  })
                )

                if (isCancelled || enrichmentRequestId !== menuEnrichmentRequestRef.current) return

                for (let i = 0; i < batchResults.length; i += 1) {
                  transformedRestaurants[index + i] = batchResults[i]
                }

                // Progressive UI update — first batches unlock Recommended quickly
                startTransition(() => {
                  setRestaurantsData([...transformedRestaurants])
                })
                // Keep cache fresh as batches complete (revisit stays instant)
                setCategoryRestaurantsCache(
                  selectedCategory,
                  zoneId,
                  transformedRestaurants,
                  categories,
                )
              }

              if (!isCancelled && enrichmentRequestId === menuEnrichmentRequestRef.current) {
                if (selectedCategory) {
                  setCategoryRestaurantsCache(
                    selectedCategory,
                    zoneId,
                    transformedRestaurants,
                    categories,
                  )
                }
              }
            } finally {
              if (!isCancelled && enrichmentRequestId === menuEnrichmentRequestRef.current) {
                setIsEnrichingMenus(false)
              }
            }
          })()
        } else {
          if (!isCancelled) setRestaurantsData([])
        }
      } catch (error) {
        debugError('Error fetching restaurants:', error)
        if (!isCancelled) setRestaurantsData([])
      } finally {
        if (!isCancelled) setLoadingRestaurants(false)
      }
    }

    fetchRestaurants()

    return () => {
      isCancelled = true
    }
  }, [zoneId, loadingZone, loadingCategories, location?.latitude, location?.longitude, location?.city, selectedCategory, isOutOfService, categories, isBrowseActive])

  // Update selected category when URL changes — hydrate restaurants from cache instantly
  useEffect(() => {
    let nextSlug = String(selectedCategory || "").toLowerCase()
    if (category && categories && categories.length > 0) {
      const categorySlug = category.toLowerCase()
      const matchedCategory = categories.find(cat =>
        cat.slug === categorySlug ||
        cat.id === categorySlug ||
        cat.name.toLowerCase().replace(/\s+/g, '-') === categorySlug
      )
      // Prefer URL slug (stable cache key) over mongo id
      nextSlug = matchedCategory?.slug
        ? String(matchedCategory.slug).toLowerCase()
        : categorySlug
      setSelectedCategory(nextSlug)
    } else if (category) {
      nextSlug = category.toLowerCase()
      setSelectedCategory(nextSlug)
    }

    const cached = peekCategoryRestaurantsCache(nextSlug, zoneId, categories)
    if (cached?.restaurants) {
      setRestaurantsData(cached.restaurants)
      setLoadingRestaurants(false)
      setIsEnrichingMenus(false)
      lastFetchedCategoryRef.current = nextSlug
    } else if (String(selectedCategory || "").toLowerCase() !== nextSlug) {
      setRestaurantsData([])
      setLoadingRestaurants(true)
      lastFetchedCategoryRef.current = null
    }
  }, [category, categories, zoneId])

  useEffect(() => {
    if (typeof window === "undefined" || !currentFilterStorageKey) return

    hasRestoredCategoryFiltersRef.current = false

    try {
      const raw = window.localStorage.getItem(CATEGORY_PAGE_FILTERS_STORAGE_KEY)
      if (!raw) return

      const stored = JSON.parse(raw)
      const categoryState = stored?.[currentFilterStorageKey]
      if (!categoryState || typeof categoryState !== "object") return

      setSortBy(categoryState.sortBy || null)
      setActiveFilters(new Set(Array.isArray(categoryState.activeFilters) ? categoryState.activeFilters : []))
    } catch {
      setSortBy(null)
      setActiveFilters(new Set())
    } finally {
      hasRestoredCategoryFiltersRef.current = true
    }
  }, [currentFilterStorageKey])

  useEffect(() => {
    if (typeof window === "undefined" || !currentFilterStorageKey) return
    if (!hasRestoredCategoryFiltersRef.current) return

    try {
      const raw = window.localStorage.getItem(CATEGORY_PAGE_FILTERS_STORAGE_KEY)
      const stored = raw ? JSON.parse(raw) : {}
      stored[currentFilterStorageKey] = {
        sortBy,
        activeFilters: Array.from(activeFilters),
      }
      window.localStorage.setItem(CATEGORY_PAGE_FILTERS_STORAGE_KEY, JSON.stringify(stored))
    } catch {
      // Ignore storage failures and keep in-memory filters working.
    }
  }, [currentFilterStorageKey, sortBy, activeFilters])

  useEffect(() => {
    const rail = categoryScrollRef.current
    if (!rail) return

    const selectedButton = rail.querySelector("[data-category-selected='true']")
    if (!(selectedButton instanceof HTMLElement)) return

    // Avoid scrollIntoView — it can move the window vertically and break back-restore.
    const railRect = rail.getBoundingClientRect()
    const btnRect = selectedButton.getBoundingClientRect()
    const delta =
      btnRect.left - railRect.left - (railRect.width / 2 - btnRect.width / 2)
    rail.scrollLeft += delta
  }, [selectedCategory, categories])

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
    // Show loading when filter is toggled
    setIsLoadingFilterResults(true)
    setTimeout(() => {
      setIsLoadingFilterResults(false)
    }, 500)
  }

  // Scroll tracking effect for filter modal
  useEffect(() => {
    if (!isFilterOpen || !rightContentRef.current) return

    const observerOptions = {
      root: rightContentRef.current,
      rootMargin: '-20% 0px -70% 0px',
      threshold: 0
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const sectionId = entry.target.getAttribute('data-section-id')
          if (sectionId) {
            setActiveScrollSection(sectionId)
            setActiveFilterTab(sectionId)
          }
        }
      })
    }, observerOptions)

    Object.values(filterSectionRefs.current).forEach(ref => {
      if (ref) observer.observe(ref)
    })

    return () => observer.disconnect()
  }, [isFilterOpen])

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

  // Recommended: one small card per matching dish (original horizontal 2-row slider).
  // All Restaurants (below): one card per restaurant with category dishes in carousel.
  const filteredRecommended = useMemo(() => {
    const sourceData = restaurantsData.length > 0 ? restaurantsData : []
    let filtered = [...sourceData]

    if (vegMode && vegModeOption === "pure-vegan") {
      filtered = filtered.filter((r) => {
        if (r?.isPureVegan === true) return true
        if (r?.isPureVegan === false) return false
        return r?.pureVeganRestaurant === true
      })
    } else if (vegMode && vegModeOption === "pure-veg") {
      filtered = filtered.filter((r) => {
        if (r?.hasNonVegMenu === true) return false
        if (r?.isPureVeg === true || r?.isPureVegan === true || r?.hasNonVegMenu === false) return true
        return r?.pureVegRestaurant === true || r?.pureVeganRestaurant === true
      })
    }

    if (selectedCategory && selectedCategory !== 'all') {
      const expandedDishes = []

      filtered.forEach((r) => {
        let categoryDishes = []

        if (Array.isArray(r.recommendedDishes) && r.recommendedDishes.length > 0) {
          categoryDishes = r.recommendedDishes.map((dish) => ({
            itemId: dish?.id || dish?.itemId || dish?._id,
            name: dish?.name,
            price: dish?.price,
            image: dish?.image,
            foodType: dish?.foodType,
          }))
        } else if (Array.isArray(r.categoryDishes) && r.categoryDishes.length > 0) {
          categoryDishes = r.categoryDishes.map((dish) => ({
            itemId: dish?._id || dish?.id || dish?.itemId,
            name: dish?.name,
            price: dish?.price,
            image: dish?.image,
            foodType: dish?.foodType,
          }))
        } else {
          if (!r.menu) return
          if (!checkCategoryInMenu(r.menu, selectedCategory)) return
          categoryDishes = getAllCategoryDishesFromMenu(r.menu, selectedCategory)
        }

        if (categoryDishes.length === 0) return

        const validDishes = vegMode
          ? categoryDishes.filter((dish) =>
              vegModeOption === "pure-vegan"
                ? isVeganMenuItem(dish)
                : isVegMenuItem(dish),
            )
          : categoryDishes

        const sourceRestaurantId = r.id || r.restaurantId || r.mongoId || r.slug

        validDishes.forEach((dishForCard) => {
          expandedDishes.push({
            ...r,
            id: `${sourceRestaurantId}-${dishForCard.itemId}`,
            sourceRestaurantId,
            dishId: dishForCard.itemId || `${sourceRestaurantId}-dish`,
            categoryDish: dishForCard,
            categoryDishName: dishForCard.name,
            categoryDishPrice: dishForCard.price,
            categoryDishImage: dishForCard.image,
            categoryDishFoodType: dishForCard.foodType,
          })
        })
      })

      filtered = expandedDishes

      if (filtered.length === 0) {
        const fallbackDishes = getCategoryFallbackDishesFromApprovedFoods(selectedCategory, sourceData)
        filtered = vegMode
          ? fallbackDishes.filter((dish) =>
              vegModeOption === "pure-vegan"
                ? dish.categoryDishFoodType === "Vegan" ||
                  isVeganMenuItem({ foodType: dish.categoryDishFoodType })
                : dish.categoryDishFoodType === "Veg" ||
                  dish.categoryDishFoodType === "Vegan" ||
                  isVegMenuItem({ foodType: dish.categoryDishFoodType }),
            )
          : fallbackDishes
        filtered = filtered.map((row) => ({
          ...row,
          sourceRestaurantId: row.restaurantId || row.mongoId || row.slug || row.id,
        }))
        if (vegMode && vegModeOption === "pure-vegan") {
          filtered = filtered.filter((r) => r?.pureVeganRestaurant === true || r?.isPureVegan === true)
        } else if (vegMode && vegModeOption === "pure-veg") {
          filtered = filtered.filter((r) => {
            if (r?.hasNonVegMenu === true) return false
            if (r?.isPureVeg === true || r?.isPureVegan === true || r?.hasNonVegMenu === false) return true
            return r?.pureVegRestaurant === true || r?.pureVeganRestaurant === true
          })
        }
      }
    }

    return applyFiltersAndSorting(filtered)
  }, [selectedCategory, activeFilters, deferredSearchQuery, restaurantsData, categoryKeywords, vegMode, vegModeOption, approvedFoodsData, sortBy])

  const filteredAllRestaurants = useMemo(() => {
    const sourceData = restaurantsData.length > 0 ? restaurantsData : []
    let filtered = [...sourceData]

    if (vegMode && vegModeOption === "pure-vegan") {
      filtered = filtered.filter((r) => {
        if (r?.isPureVegan === true) return true
        if (r?.isPureVegan === false) return false
        return r?.pureVeganRestaurant === true
      })
    } else if (vegMode && vegModeOption === "pure-veg") {
      filtered = filtered.filter((r) => {
        if (r?.hasNonVegMenu === true) return false
        if (r?.isPureVeg === true || r?.isPureVegan === true || r?.hasNonVegMenu === false) return true
        return r?.pureVegRestaurant === true || r?.pureVeganRestaurant === true
      })
    }

    if (selectedCategory && selectedCategory !== 'all') {
      filtered = groupRestaurantsByCategoryDishes(filtered, selectedCategory)

      if (filtered.length === 0) {
        const fallbackDishes = getCategoryFallbackDishesFromApprovedFoods(selectedCategory, sourceData)
        const vegFiltered = vegMode
          ? fallbackDishes.filter((dish) =>
              vegModeOption === "pure-vegan"
                ? dish.categoryDishFoodType === "Vegan" ||
                  isVeganMenuItem({ foodType: dish.categoryDishFoodType })
                : dish.categoryDishFoodType === "Veg" ||
                  dish.categoryDishFoodType === "Vegan" ||
                  isVegMenuItem({ foodType: dish.categoryDishFoodType }),
            )
          : fallbackDishes
        filtered = groupFallbackDishesByRestaurant(vegFiltered)
        if (vegMode && vegModeOption === "pure-vegan") {
          filtered = filtered.filter((r) => r?.pureVeganRestaurant === true || r?.isPureVegan === true)
        } else if (vegMode && vegModeOption === "pure-veg") {
          filtered = filtered.filter((r) => {
            if (r?.hasNonVegMenu === true) return false
            if (r?.isPureVeg === true || r?.isPureVegan === true || r?.hasNonVegMenu === false) return true
            return r?.pureVegRestaurant === true || r?.pureVeganRestaurant === true
          })
        }
      }
    }

    return applyFiltersAndSorting(filtered)
  }, [selectedCategory, activeFilters, deferredSearchQuery, restaurantsData, categoryKeywords, vegMode, vegModeOption, approvedFoodsData, sortBy])

  const showRestaurantSkeleton = useDelayedLoading(
    isLoadingFilterResults ||
      loadingRestaurants ||
      loadingZone ||
      loadingCategories ||
      (isEnrichingMenus &&
        filteredAllRestaurants.length === 0 &&
        filteredRecommended.length === 0),
    { delay: 80, minDuration: 280 }
  )

  const recommendedItems = useMemo(() => {
    const items = filteredRecommended.slice(0, RECOMMENDED_MAX_ITEMS)
    // Online first → pin order → nearest distance (same when all offline)
    return [...items]
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const byBrowse = compareRestaurantsByAvailabilityAndDistance(a.row, b.row)
        if (byBrowse !== 0) return byBrowse
        return a.index - b.index
      })
      .map((entry) => entry.row)
  }, [filteredRecommended])

  // Always show every matching restaurant in All Restaurants (do not hide ones that appear in Recommended dishes)
  const allRestaurantsWithoutRecommended = filteredAllRestaurants

  const visibleAllRestaurants = useMemo(
    () => allRestaurantsWithoutRecommended.slice(0, visibleAllCount),
    [allRestaurantsWithoutRecommended, visibleAllCount],
  )

  const isBootstrapping =
    (loadingRestaurants && restaurantsData.length === 0) ||
    loadingZone ||
    (loadingCategories && categories.length <= 1) ||
    (isEnrichingMenus && restaurantsData.length === 0) ||
    isLoadingFilterResults

  const isContentLoading = isBootstrapping || showRestaurantSkeleton

  const hasNoResults =
    !isBootstrapping &&
    !showRestaurantSkeleton &&
    allRestaurantsWithoutRecommended.length === 0 &&
    filteredRecommended.length === 0

  useEffect(() => {
    // Reset lazy window only when user changes category/filters — never on restaurant back.
    if (getCategoryLastClick() || peekBrowseScroll(categoryBackPath) || peekBrowseScrollAny()) return
    if (savedVisibleCountRef.current > ALL_LIST_INITIAL_VISIBLE) return
    setVisibleAllCount(ALL_LIST_INITIAL_VISIBLE)
  }, [selectedCategory, activeFilters, deferredSearchQuery, sortBy, categoryBackPath])

  useEffect(() => {
    if (!isBrowseActive) return undefined
    const node = allListSentinelRef.current
    if (!node) return undefined
    const total = allRestaurantsWithoutRecommended.length
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        setVisibleAllCount((prev) => {
          if (prev >= total) return prev
          return Math.min(prev + ALL_LIST_LOAD_MORE, total)
        })
      },
      { rootMargin: "240px 0px" },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [allRestaurantsWithoutRecommended.length, selectedCategory, isBrowseActive])

  const handleCategorySelect = (category) => {
    const categorySlug = String(category.slug || category.id || "").toLowerCase()
    const cached = peekCategoryRestaurantsCache(categorySlug, zoneId, categories)
    if (cached?.restaurants) {
      setSelectedCategory(categorySlug)
      setRestaurantsData(cached.restaurants)
      setLoadingRestaurants(false)
      setIsEnrichingMenus(false)
      lastFetchedCategoryRef.current = categorySlug
    } else {
      setSelectedCategory(categorySlug)
      setRestaurantsData([])
      setLoadingRestaurants(true)
      lastFetchedCategoryRef.current = null
    }
    // Replace history so back always returns Home — don't stack category hops.
    if (categorySlug === 'all') {
      navigate(toFoodUserPath('/user/category/all'), { replace: true })
    } else {
      navigate(toFoodUserPath(`/user/category/${categorySlug}`), { replace: true })
    }
  }

  // Zone out-of-service → whole page grayscale. Per-card closed timing handled below.
  const shouldShowGrayscale = isOutOfService
  const isCategoryView = selectedCategory && selectedCategory !== 'all'

  const isRestaurantClosed = (restaurant) => {
    if (isOutOfService) return true
    const availability = getRestaurantAvailabilityStatus(restaurant)
    return !availability?.isOpen
  }

  const rememberBrowsePosition = (focusId) => {
    const y = Math.max(
      typeof window !== "undefined" ? window.scrollY || 0 : 0,
      liveScrollYRef.current,
      savedScrollYRef.current,
    )
    const count = Math.max(visibleAllCount, ALL_LIST_INITIAL_VISIBLE)
    savedScrollYRef.current = y
    liveScrollYRef.current = y
    savedVisibleCountRef.current = count
    hasRestoredBrowseScrollRef.current = false
    trackCategoryWindowScrollY(y)
    saveCategoryBrowseClick({
      path: categoryBackPath,
      scrollY: y,
      focusId,
      visibleCount: count,
    })
  }

  // Track scroll while category is visible — click save can then avoid reading a raced 0
  useEffect(() => {
    if (!isBrowseActive) return undefined
    const onScroll = () => {
      const y = window.scrollY || 0
      liveScrollYRef.current = y
      trackCategoryWindowScrollY(y)
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [isBrowseActive])

  // Fixed header (like Home) — measure spacer so content doesn't jump under it
  useLayoutEffect(() => {
    const el = stickyHeaderRef.current
    if (!el || typeof ResizeObserver === "undefined") {
      if (el) setStickyHeaderHeight(el.getBoundingClientRect().height || 0)
      return undefined
    }
    const measure = () => {
      setStickyHeaderHeight(el.getBoundingClientRect().height || 0)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hideHeader, hideCategoryCarousel, showCategorySkeleton, displayCategories.length])

  // Expand lazy list so target Y / focus card exist (does not own scroll restore)
  useLayoutEffect(() => {
    if (!isBrowseActive) return
    if (!categoryBrowseNeedsRestore()) return

    const total = allRestaurantsWithoutRecommended.length
    if (!total) return

    const pending = getCategoryLastClick()
    // Only expand to what was visible at click — full expand makes back feel laggy
    let needed = Math.min(
      Math.max(
        Number(pending?.visibleCount) || 0,
        savedVisibleCountRef.current,
        ALL_LIST_INITIAL_VISIBLE,
      ),
      total,
    )

    if (pending?.focusId) {
      const focusKey = String(pending.focusId)
      const focusIndex = allRestaurantsWithoutRecommended.findIndex(
        (r) => String(r.id) === focusKey || String(r.sourceRestaurantId) === focusKey,
      )
      if (focusIndex >= 0) {
        needed = Math.min(Math.max(needed, focusIndex + 1), total)
      }
    }

    if (needed > visibleAllCount) {
      setVisibleAllCount(needed)
    }
  }, [
    isBrowseActive,
    allRestaurantsWithoutRecommended.length,
    visibleAllCount,
  ])

  // Mark restored-intent so auto-scroll-to-recommended stays off; lock lives in KeepAlive
  useLayoutEffect(() => {
    if (!isBrowseActive) {
      hasRestoredBrowseScrollRef.current = false
      return
    }
    if (categoryBrowseNeedsRestore()) {
      hasRestoredBrowseScrollRef.current = true
      const pending = getCategoryLastClick()
      const targetY = Math.max(
        0,
        Number(pending?.scrollY) || liveScrollYRef.current || 0,
      )
      if (targetY > 0) {
        window.scrollTo({ top: targetY, left: 0, behavior: "instant" })
      }
    }
  }, [isBrowseActive])

  // Auto-scroll to Recommended section on fresh navigation or category change (not on back)
  useEffect(() => {
    if (!isBrowseActive) return;
    if (disableAutoScroll) return;
    if (!embeddedCategorySlug) return;
    if (navType === "POP") return;
    if (hasRestoredBrowseScrollRef.current) return;
    if (getCategoryLastClick() || peekBrowseScroll(categoryBackPath) || peekBrowseScrollAny()) return;
    if (selectedCategory !== 'all' && filteredRecommended.length > 0 && recommendedSectionRef.current) {
      const categoryChanged = lastScrolledCategoryRef.current !== selectedCategory;
      const isFreshMount = !hasAutoScrolledRef.current;

      if (categoryChanged || isFreshMount) {
        hasAutoScrolledRef.current = true
        lastScrolledCategoryRef.current = selectedCategory
        
        const timer = setTimeout(() => {
          if (recommendedSectionRef.current && !hasRestoredBrowseScrollRef.current) {
            const headerOffset = stickyHeaderRef.current?.getBoundingClientRect().height || stickyHeaderHeight || 80
            const topOffset = recommendedSectionRef.current.getBoundingClientRect().top + window.scrollY - headerOffset
            window.scrollTo({ top: topOffset, behavior: 'smooth' })
          }
        }, 80)
        
        return () => clearTimeout(timer)
      }
    }
  }, [navType, selectedCategory, filteredRecommended.length, disableAutoScroll, embeddedCategorySlug, isBrowseActive, categoryBackPath])

  return (
    <div className={`min-h-screen bg-white dark:bg-[#0a0a0a] ${shouldShowGrayscale ? 'grayscale opacity-75' : ''}`}>
      {/* Fixed like Home — CSS sticky + backdrop-blur was jittering on scroll */}
      <div
        ref={stickyHeaderRef}
        className="fixed top-0 left-0 right-0 z-40 w-full bg-white dark:bg-[#1a1a1a] shadow-sm"
      >
        <div className="max-w-7xl mx-auto">
          {/* Search Bar with Back Button */}
          {!hideHeader && (
            <div className="flex items-center gap-2 px-3 md:px-6 py-3 border-b border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => navigate(toFoodUserPath("/user"), { replace: true })}
                className="w-9 h-9 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors flex-shrink-0 touch-manipulation relative z-50"
              >
                <ArrowLeft className="h-5 w-5 text-gray-700 dark:text-gray-300" />
              </button>

              <div className="flex-1 relative max-w-2xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <Input
                  placeholder="Restaurant name or a dish..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-4 h-11 md:h-12 rounded-lg border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#1a1a1a] focus:bg-white dark:focus:bg-[#2a2a2a] focus:border-gray-500 dark:focus:border-gray-600 text-sm md:text-base dark:text-white placeholder:text-gray-600 dark:placeholder:text-gray-400"
                />
              </div>
            </div>
          )}

          {/* Browse Category Section */}
          {!hideCategoryCarousel && (
            <div
              ref={categoryScrollRef}
              className="flex gap-4 md:gap-6 overflow-x-auto scrollbar-hide px-4 md:px-6 py-3 bg-white dark:bg-[#1a1a1a] border-b border-gray-100 dark:border-gray-800"
              style={{
                scrollbarWidth: "none",
                msOverflowStyle: "none",
              }}
            >
              {showCategorySkeleton || ((loadingCategories || loadingZone) && displayCategories.length <= 1) ? (
                <CategoryChipRowSkeleton className="py-3" />
              ) : displayCategories.length > 0 ? (
                displayCategories.map((cat) => {
                  const categorySlug = cat.slug || cat.id
                  const isSelected = selectedCategory === categorySlug || selectedCategory === cat.id
                  const isAllCategory = categorySlug === "all" || cat.id === "all"
                  return (
                    <button
                      key={cat.id}
                      onClick={() => handleCategorySelect(cat)}
                      data-category-selected={isSelected ? "true" : "false"}
                      className={`flex flex-col items-center gap-1.5 flex-shrink-0 pb-2 transition-all ${isSelected ? 'border-b-2 border-[#DC2626]' : ''
                        }`}
                    >
                      {isAllCategory ? (
                        <div className={`w-16 h-16 md:w-20 md:h-20 rounded-full border-2 transition-all flex items-center justify-center ${isSelected ? 'border-[#DC2626] shadow-lg bg-[#DC2626]/10 dark:bg-[#DC2626]/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-[#222222]'}`}>
                          <Grid2x2 className={`h-6 w-6 md:h-7 md:w-7 ${isSelected ? 'text-[#DC2626]' : 'text-gray-500 dark:text-gray-400'}`} />
                        </div>
                      ) : cat.image ? (
                    <div className={`w-16 h-16 md:w-20 md:h-20 rounded-full overflow-hidden border-2 transition-all ${isSelected ? 'border-[#DC2626] shadow-lg' : 'border-transparent'
                          }`}>
                          <img
                            src={cat.image}
                            alt={cat.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // If the backend image is missing/broken, show initials instead of fake assets.
                              e.target.style.display = 'none'
                            }}
                          />
                        </div>
                      ) : (
                        <div
                          className={`w-16 h-16 md:w-20 md:h-20 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center border-2 transition-all ${isSelected ? 'border-[#DC2626] shadow-lg bg-[#DC2626]/10 dark:bg-[#DC2626]/20' : 'border-transparent'
                            }`}
                          aria-label={`${cat.name} category`}
                        >
                          <span className="text-sm md:text-base font-semibold text-gray-600 dark:text-gray-300">
                            {String(cat.name || "?").trim().slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <span className={`text-xs md:text-sm font-medium whitespace-nowrap ${isSelected ? 'text-[#DC2626] dark:text-[#DC2626]' : 'text-gray-600 dark:text-gray-400'
                        }`}>
                        {cat.name}
                      </span>
                    </button>
                  )
                })
              ) : (
                  <div className="flex items-center justify-center py-4">
                    <span className="text-sm text-gray-600 dark:text-gray-400">No categories available</span>
                  </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div style={{ height: stickyHeaderHeight }} aria-hidden="true" />

      {/* Filters — scroll away with content (not sticky) */}
      {!hideFilters && (
        <div className="max-w-7xl mx-auto bg-white dark:bg-[#0a0a0a]">
          <div className="flex flex-col md:flex-row md:flex-wrap gap-2 px-4 md:px-6 py-3">
            {/* Row 1 */}
            <div
              className="flex items-center gap-2 overflow-x-auto md:overflow-x-visible scrollbar-hide pb-1 md:pb-0"
              style={{
                scrollbarWidth: "none",
                msOverflowStyle: "none",
              }}
            >
              <Button
                variant="outline"
                onClick={() => setIsFilterOpen(true)}
                className="h-7 md:h-8 px-2.5 md:px-3 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 md:h-4 md:w-4" />
                <span className="text-xs md:text-sm font-bold text-black dark:text-white">Filters</span>
              </Button>
              {[
                { id: 'under-30-mins', label: 'Under 30 mins' },
                { id: 'delivery-under-45', label: 'Under 45 mins' },
                { id: 'rating-4-plus', label: 'Rating 4.0+' },
                { id: 'rating-45-plus', label: 'Rating 4.5+' },
              ].map((filter) => {
                const isActive = activeFilters.has(filter.id)
                return (
                  <Button
                    key={filter.id}
                    variant="outline"
                    onClick={() => toggleFilter(filter.id)}
                    className={`h-7 md:h-8 px-2.5 md:px-3 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all ${isActive
                      ? 'bg-[#DC2626] text-white border border-[#DC2626] hover:bg-[#991B1B]'
                      : 'bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                  >
                    <span className={`text-xs md:text-sm text-black dark:text-white font-bold ${isActive ? 'text-white' : 'text-black dark:text-white'}`}>{filter.label}</span>
                  </Button>
                )
              })}
            </div>

            {/* Row 2 */}
            <div
              className="flex items-center gap-2 overflow-x-auto md:overflow-x-visible scrollbar-hide pb-1 md:pb-0"
              style={{
                scrollbarWidth: "none",
                msOverflowStyle: "none",
              }}
            >
              {[
                { id: 'distance-under-1km', label: 'Under 1km', icon: MapPin },
                { id: 'distance-under-2km', label: 'Under 2km', icon: MapPin },
                { id: 'flat-50-off', label: 'Flat 50% OFF' },
                { id: 'under-250', label: 'Under ₹250' },
              ].map((filter) => {
                const Icon = filter.icon
                const isActive = activeFilters.has(filter.id)
                return (
                  <Button
                    key={filter.id}
                    variant="outline"
                    onClick={() => toggleFilter(filter.id)}
                    className={`h-7 md:h-8 px-2.5 md:px-3 rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all ${isActive
                      ? 'bg-[#DC2626] text-white border border-[#DC2626] hover:bg-[#991B1B]'
                      : 'bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                  >
                    {Icon && <Icon className={`h-3.5 w-3.5 md:h-4 md:w-4 ${isActive ? 'text-white' : 'text-gray-900 dark:text-white'}`} />}
                    <span className={`text-xs md:text-sm font-bold ${isActive ? 'text-white' : 'text-black dark:text-white'}`}>{filter.label}</span>
                  </Button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="px-4 sm:px-6 md:px-8 lg:px-10 xl:px-12 py-4 sm:py-6 md:py-8 lg:py-10 space-y-6 md:space-y-8 lg:space-y-10">
        <div className="max-w-7xl mx-auto">
          {/* RECOMMENDED FOR YOU — show skeleton while loading, avoid blank white boxes */}
          {selectedCategory !== 'all' && (isContentLoading || filteredRecommended.length > 0) && (
            <section ref={recommendedSectionRef}>
              <h2 className="text-xs sm:text-sm md:text-base font-semibold text-gray-400 dark:text-gray-500 tracking-widest uppercase mb-4 md:mb-6">
                RECOMMENDED FOR YOU
              </h2>

              {isContentLoading && filteredRecommended.length === 0 ? (
                <div className="overflow-x-auto overscroll-x-contain pb-1 -mx-4 px-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  <div className="flex gap-3" style={{ width: "max-content" }}>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={`rec-skel-${i}`}
                        className="w-[calc((100vw-2rem-1.5rem)/3)] sm:w-[148px] md:w-[160px] lg:w-[168px] shrink-0 animate-pulse"
                      >
                        <div className="aspect-square rounded-xl md:rounded-2xl bg-gray-200 dark:bg-gray-800 mb-2" />
                        <div className="h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-800 mb-1" />
                        <div className="h-2.5 w-1/2 rounded bg-gray-100 dark:bg-gray-700" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                (() => {
                  const recCount = recommendedItems.length
                  const useTwoRows = recCount >= 6
                  // Always fixed ~1/3 viewport width — never stretch when 1–2 items
                  const cardWidthClass =
                    "w-[calc((100vw-2rem-1.5rem)/3)] sm:w-[148px] md:w-[160px] lg:w-[168px] shrink-0"

                  const renderRecCard = (restaurant) => {
                    const closed = isRestaurantClosed(restaurant)
                    return (
                      <Link
                        key={restaurant.id}
                        to={toFoodUserPath(`/user/restaurants/${getRestaurantRouteId(restaurant)}${restaurant.dishId ? `?dish=${restaurant.dishId}` : ''}`)}
                        state={{ restaurantData: restaurant, from: categoryBackPath }}
                        data-browse-focus={restaurant.id}
                        onClick={() => rememberBrowsePosition(restaurant.id)}
                        className={`block min-w-0 ${cardWidthClass}`}
                      >
                        <div className={`group ${shouldShowGrayscale || closed ? "grayscale opacity-75" : ""}`}>
                          <div className="relative aspect-square rounded-xl md:rounded-2xl overflow-hidden mb-2 bg-gray-200 dark:bg-gray-800">
                            {(() => {
                              const displayImg = isCategoryView
                                ? (restaurant.categoryDishImage || dishFallbackImage)
                                : (restaurant.categoryDishImage || restaurant.image || dishFallbackImage);

                              return (
                                <img
                                  src={displayImg}
                                  alt={restaurant.categoryDishName || restaurant.name}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 bg-gray-50 dark:bg-gray-800"
                                  onError={(e) => {
                                    if (!e.target.src.includes(dishFallbackImage)) {
                                      e.target.src = dishFallbackImage;
                                    }
                                  }}
                                />
                              );
                            })()}

                            {restaurant.offer && (
                              <div className="absolute top-1.5 left-1.5 bg-gradient-to-r from-[#DC2626] to-[#991B1B] text-white text-[10px] md:text-xs font-semibold px-1.5 py-0.5 rounded shadow-sm">
                                {restaurant.offer}
                              </div>
                            )}

                            <div className="absolute bottom-0 left-0 bg-green-600 border-[4px] rounded-md border-white text-white text-[11px] md:text-xs font-bold px-1.5 py-0.5 flex items-center gap-0.5">
                              {Number(restaurant.rating) > 0 ? Number(restaurant.rating).toFixed(1) : "NEW"}
                              <Star className="h-2.5 w-2.5 md:h-3 md:w-3 fill-white" />
                            </div>
                          </div>

                          <h3 className="font-semibold text-gray-900 dark:text-white text-xs md:text-sm line-clamp-1">
                            {isCategoryView
                              ? (restaurant.categoryDishName || restaurant.featuredDish || restaurant.name)
                              : restaurant.name}
                          </h3>
                          {isCategoryView && (
                            <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                              {restaurant.name}
                            </p>
                          )}
                        </div>
                      </Link>
                    )
                  }

                  // Fixed card size for 1–N items (matches multi-item carousel width)
                  if (!useTwoRows) {
                    return (
                      <div className="overflow-x-auto overscroll-x-contain pb-1 -mx-4 px-4 touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                        <div className="flex gap-3" style={{ width: "max-content", minWidth: "100%" }}>
                          {recommendedItems.map(renderRecCard)}
                        </div>
                      </div>
                    )
                  }

                  // 6+: exactly 2 rows — first 3 on top, next 3 below, then slide (no 3rd row)
                  const topRow = []
                  const bottomRow = []
                  recommendedItems.forEach((item, index) => {
                    if (Math.floor(index / 3) % 2 === 0) topRow.push(item)
                    else bottomRow.push(item)
                  })

                  return (
                    <div className="overflow-x-auto overscroll-x-contain pb-1 -mx-4 px-4 touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                      <div className="inline-flex flex-col gap-3" style={{ width: "max-content", minWidth: "100%" }}>
                        <div className="flex gap-3">
                          {topRow.map(renderRecCard)}
                        </div>
                        <div className="flex gap-3">
                          {bottomRow.map(renderRecCard)}
                        </div>
                      </div>
                    </div>
                  )
                })()
              )}
            </section>
          )}

          {/* ALL RESTAURANTS Section */}
          <section className="relative">
            <h2 className="text-xs sm:text-sm md:text-base font-semibold text-gray-400 dark:text-gray-500 tracking-widest uppercase mb-4 md:mb-6">
              ALL RESTAURANTS
            </h2>

            {/* Loading Overlay */}
            {showRestaurantSkeleton && (
              <div className="absolute inset-0 z-10 rounded-lg bg-white/92 backdrop-blur-sm dark:bg-[#1a1a1a]/92">
                <LoadingSkeletonRegion label="Loading restaurants" className="h-full p-1 sm:p-2">
                  <RestaurantGridSkeleton count={4} compact />
                </LoadingSkeletonRegion>
              </div>
            )}

            {/* Large Restaurant Cards */}
            <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5 lg:gap-6 xl:gap-7 items-stretch ${showRestaurantSkeleton ? 'opacity-50' : 'opacity-100'} transition-opacity duration-300`}>
              {isContentLoading && visibleAllRestaurants.length === 0 ? (
                <div className="col-span-full">
                  <RestaurantGridSkeleton count={4} compact />
                </div>
              ) : (
              visibleAllRestaurants.map((restaurant) => {
                const restaurantSlug = getRestaurantRouteId(restaurant) || "restaurant"
                const isFavorite = favorites.has(restaurant.id)
                const closed = isRestaurantClosed(restaurant)

                return (
                  <Link
                    key={restaurant.id}
                    to={toFoodUserPath(`/user/restaurants/${restaurantSlug}`)}
                    state={{ restaurantData: restaurant, from: categoryBackPath }}
                    data-browse-focus={restaurant.id}
                    onClick={() => rememberBrowsePosition(restaurant.id)}
                    className="h-full flex"
                  >
                    <Card className={`overflow-hidden cursor-pointer gap-0 border-0 dark:border-gray-800 group bg-white dark:bg-[#1a1a1a] shadow-md hover:shadow-xl transition-all duration-300 py-0 rounded-md h-full flex flex-col w-full ${shouldShowGrayscale || closed ? 'grayscale opacity-75' : ''
                      }`}>
                      {/* Image Section — Home-style dish carousel when category dishes exist */}
                      <div className="relative h-44 sm:h-52 md:h-60 lg:h-64 xl:h-72 w-full overflow-hidden rounded-t-md flex-shrink-0 isolate">
                        {isCategoryView && Array.isArray(restaurant.recommendedDishes) && restaurant.recommendedDishes.length > 0 ? (
                          <RestaurantImageCarousel
                            restaurant={restaurant}
                            backendOrigin={BACKEND_ORIGIN}
                            className="h-44 sm:h-52 md:h-60 lg:h-64 xl:h-72"
                            roundedClass="rounded-t-md"
                            backFrom={categoryBackPath}
                            focusId={restaurant.id}
                            visibleCount={visibleAllCount}
                            categoryFallbackImage={dishFallbackImage}
                          />
                        ) : (() => {
                          const singleImg = isCategoryView
                            ? (restaurant.categoryDishImage || dishFallbackImage)
                            : (restaurant.image || dishFallbackImage);

                          return (
                            <img
                              src={singleImg}
                              alt={restaurant.name}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 bg-gray-50 dark:bg-gray-800"
                              onError={(e) => {
                                if (!e.target.src.includes(dishFallbackImage)) {
                                  e.target.src = dishFallbackImage;
                                }
                              }}
                            />
                          );
                        })()}

                        {/* Featured dish badge only when not using category dish carousel */}
                        {!isCategoryView && (restaurant.categoryDishName || restaurant.featuredDish) && (
                          <div className="absolute top-3 left-3 z-10">
                            <div className="bg-gray-800/80 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg text-xs sm:text-sm md:text-base font-medium">
                              {`${restaurant.categoryDishName || restaurant.featuredDish} • ₹${restaurant.categoryDishPrice || restaurant.featuredPrice}`}
                            </div>
                          </div>
                        )}

                        {/* Ad Badge */}
                        {restaurant.isAd && (
                          <div className="absolute top-3 right-14 z-[3] bg-black/50 text-white text-[10px] md:text-xs px-2 py-0.5 rounded">
                            Ad
                          </div>
                        )}

                        {/* Bookmark Icon - Top Right */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="absolute top-3 right-3 z-[3] h-9 w-9 md:h-10 md:w-10 bg-white/90 dark:bg-[#1a1a1a]/90 backdrop-blur-sm rounded-lg hover:bg-white dark:hover:bg-[#2a2a2a] transition-colors"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            toggleFavorite(restaurant.id)
                          }}
                        >
                          <Bookmark className={`h-5 w-5 md:h-6 md:w-6 ${isFavorite ? "fill-gray-800 dark:fill-gray-200 text-gray-800 dark:text-gray-200" : "text-gray-600 dark:text-gray-400"}`} strokeWidth={2} />
                        </Button>
                      </div>

                      {/* Content Section */}
                      <CardContent className="p-3 sm:p-4 md:p-5 lg:p-6 gap-0 flex-1 flex flex-col">
                        {/* Restaurant Name & Rating — delivery row matches Home */}
                        <div className="flex items-start justify-between gap-2 mb-2 lg:mb-3">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-md md:text-xl lg:text-2xl font-bold text-[#1c1c1c] dark:text-white line-clamp-1 lg:line-clamp-2 leading-tight tracking-tight">
                              {restaurant.name}
                            </h3>
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <div className="flex items-center gap-1.5 text-sm font-semibold text-[#257d3c] transition-all duration-300">
                                <Zap
                                  className="h-4 w-4 fill-[#257d3c]"
                                  strokeWidth={2.5}
                                />
                                <span>
                                  {restaurant.deliveryTime || "25-30 mins"}
                                </span>
                                {restaurant.distance && (
                                  <>
                                    <span className="text-[#257d3c] mx-1 font-bold">|</span>
                                    <span>{restaurant.distance}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex-shrink-0 bg-[#257d3c] text-white px-2 py-1 rounded-lg flex items-center gap-1">
                            <Star className="h-3.5 w-3.5 fill-white text-white" strokeWidth={0} />
                            <span className="text-sm font-bold tracking-tight">
                              {Number(restaurant.rating) > 0 ? Number(restaurant.rating).toFixed(1) : "NEW"}
                            </span>
                          </div>
                        </div>

                        {/* Offer Badge */}
                        {restaurant.offer && (
                          <div className="flex items-center gap-2 text-sm md:text-base lg:text-lg mt-auto">
                            <BadgePercent className="h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6 text-[#DC2626]" strokeWidth={2} />
                            <span className="text-gray-700 dark:text-gray-300 font-medium">{restaurant.offer}</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                )
              })
              )}
            </div>

            {visibleAllCount < allRestaurantsWithoutRecommended.length && (
              <div ref={allListSentinelRef} className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            )}

            {/* Empty State — never flash while categories/menus still loading */}
            {hasNoResults && (
              <div className="text-center py-12 md:py-16">
                <p className="text-gray-500 dark:text-gray-400 text-sm md:text-base">
                  {searchQuery
                    ? `No restaurants found for "${searchQuery}"`
                    : "No restaurants found with selected filters"}
                </p>
                <Button
                  variant="outline"
                  className="mt-4 md:mt-6"
                  onClick={() => {
                    setIsLoadingFilterResults(true)
                    setActiveFilters(new Set())
                    setSearchQuery("")
                    setSortBy(null)
                    menuEnrichmentRequestRef.current += 1
                    setIsEnrichingMenus(false)
                    setTimeout(() => setIsLoadingFilterResults(false), 500)
                  }}
                >
                  Clear all filters
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Filter Modal - Bottom Sheet */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isFilterOpen && (
              <div className="fixed inset-0 z-[100]">
                {/* Backdrop */}
                <div
                  className="absolute inset-0 bg-black/50"
                  onClick={() => setIsFilterOpen(false)}
                />

                {/* Modal Content */}
                <div className="absolute bottom-0 left-0 right-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:max-w-4xl bg-white dark:bg-[#1a1a1a] rounded-t-3xl md:rounded-3xl max-h-[85vh] md:max-h-[90vh] flex flex-col animate-[slideUp_0.3s_ease-out]">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-gray-200 dark:border-gray-800">
                    <h2 className="text-lg md:text-xl font-bold text-gray-900 dark:text-white">Filters and sorting</h2>
                    <button
                      onClick={() => {
                        setIsLoadingFilterResults(true)
                        setActiveFilters(new Set())
                        setSortBy(null)
                        setTimeout(() => setIsLoadingFilterResults(false), 500)
                      }}
                      className="text-[#DC2626] font-medium text-sm md:text-base hover:underline"
                    >
                      Clear all
                    </button>
                  </div>

                  {/* Body */}
                  <div className="flex flex-1 overflow-hidden">
                    {/* Left Sidebar - Tabs */}
                    <div className="w-24 sm:w-28 md:w-32 bg-gray-50 dark:bg-[#0a0a0a] border-r border-gray-200 dark:border-gray-800 flex flex-col">
                      {[
                        { id: 'sort', label: 'Sort By', icon: ArrowDownUp },
                        { id: 'time', label: 'Time', icon: Timer },
                        { id: 'rating', label: 'Rating', icon: Star },
                        { id: 'distance', label: 'Distance', icon: MapPin },
                        { id: 'price', label: 'Dish Price', icon: IndianRupee },
                        { id: 'offers', label: 'Offers', icon: BadgePercent },
                        { id: 'trust', label: 'Trust', icon: ShieldCheck },
                      ].map((tab) => {
                        const Icon = tab.icon
                        const isActive = activeScrollSection === tab.id || activeFilterTab === tab.id
                        return (
                          <button
                            key={tab.id}
                            onClick={() => {
                              setActiveFilterTab(tab.id)
                              const section = filterSectionRefs.current[tab.id]
                              if (section) {
                                section.scrollIntoView({ behavior: 'smooth', block: 'start' })
                              }
                            }}
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
                      <div
                        ref={el => filterSectionRefs.current['sort'] = el}
                        data-section-id="sort"
                        className="space-y-4 mb-8"
                      >
                        <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-4">Sort by</h3>
                        <div className="flex flex-col gap-3">
                          {[
                            { id: null, label: 'Relevance' },
                            { id: 'price-low', label: 'Price: Low to High' },
                            { id: 'price-high', label: 'Price: High to Low' },
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
                              <span className={`text-sm md:text-base font-medium ${sortBy === option.id ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`}>
                                {option.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Time Tab */}
                      <div
                        ref={el => filterSectionRefs.current['time'] = el}
                        data-section-id="time"
                        className="space-y-4 mb-8"
                      >
                        <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-4">Estimated Time</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                          <button
                            onClick={() => toggleFilter('under-30-mins')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('under-30-mins')
                              ? 'border-[#DC2626] bg-[#F9F9FB] dark:bg-[#DC2626]/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-[#DC2626]'
                              }`}
                          >
                            <Timer className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('under-30-mins') ? 'text-[#DC2626]' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('under-30-mins') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Under 30 mins</span>
                          </button>
                          <button
                            onClick={() => toggleFilter('delivery-under-45')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('delivery-under-45')
                              ? 'border-[#DC2626] bg-[#F9F9FB] dark:bg-[#DC2626]/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-[#DC2626]'
                              }`}
                          >
                            <Timer className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('delivery-under-45') ? 'text-[#DC2626]' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('delivery-under-45') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Under 45 mins</span>
                          </button>
                        </div>
                      </div>

                      {/* Rating Tab */}
                      <div
                        ref={el => filterSectionRefs.current['rating'] = el}
                        data-section-id="rating"
                        className="space-y-4 mb-8"
                      >
                        <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-4">Restaurant Rating</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                          <button
                            onClick={() => toggleFilter('rating-35-plus')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('rating-35-plus')
                              ? 'border-[#DC2626] bg-[#F9F9FB] dark:bg-[#DC2626]/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-[#DC2626]'
                              }`}
                          >
                            <Star className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('rating-35-plus') ? 'text-[#DC2626] fill-[#DC2626]' : 'text-gray-400 dark:text-gray-500'}`} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('rating-35-plus') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Rated 3.5+</span>
                          </button>
                          <button
                            onClick={() => toggleFilter('rating-4-plus')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('rating-4-plus')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <Star className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('rating-4-plus') ? 'text-[#DC2626] fill-[#DC2626]' : 'text-gray-400 dark:text-gray-500'}`} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('rating-4-plus') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Rated 4.0+</span>
                          </button>
                          <button
                            onClick={() => toggleFilter('rating-45-plus')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('rating-45-plus')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <Star className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('rating-45-plus') ? 'text-[#DC2626] fill-[#DC2626]' : 'text-gray-400 dark:text-gray-500'}`} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('rating-45-plus') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Rated 4.5+</span>
                          </button>
                        </div>
                      </div>

                      {/* Distance Tab */}
                      <div
                        ref={el => filterSectionRefs.current['distance'] = el}
                        data-section-id="distance"
                        className="space-y-4 mb-8"
                      >
                        <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-4">Distance</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                          <button
                            onClick={() => toggleFilter('distance-under-1km')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('distance-under-1km')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <MapPin className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('distance-under-1km') ? 'text-[#DC2626]' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('distance-under-1km') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Under 1 km</span>
                          </button>
                          <button
                            onClick={() => toggleFilter('distance-under-2km')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('distance-under-2km')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <MapPin className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('distance-under-2km') ? 'text-[#DC2626]' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('distance-under-2km') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Under 2 km</span>
                          </button>
                        </div>
                      </div>

                      {/* Price Tab */}
                      <div
                        ref={el => filterSectionRefs.current['price'] = el}
                        data-section-id="price"
                        className="space-y-4 mb-8"
                      >
                        <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-4">Dish Price</h3>
                        <div className="flex flex-col gap-3 md:gap-4">
                          <button
                            onClick={() => toggleFilter('price-under-200')}
                            className={`px-4 md:px-5 py-3 md:py-4 rounded-xl border text-left transition-colors ${activeFilters.has('price-under-200')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('price-under-200') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Under ₹200</span>
                          </button>
                          <button
                            onClick={() => toggleFilter('under-250')}
                            className={`px-4 md:px-5 py-3 md:py-4 rounded-xl border text-left transition-colors ${activeFilters.has('under-250')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('under-250') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Under ₹250</span>
                          </button>
                          <button
                            onClick={() => toggleFilter('price-under-500')}
                            className={`px-4 md:px-5 py-3 md:py-4 rounded-xl border text-left transition-colors ${activeFilters.has('price-under-500')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('price-under-500') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Under ₹500</span>
                          </button>
                        </div>
                      </div>

                      {/* Offers Tab */}
                      <div
                        ref={el => filterSectionRefs.current['offers'] = el}
                        data-section-id="offers"
                        className="space-y-4 mb-8"
                      >
                        <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white mb-4">Offers</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                          <button
                            onClick={() => toggleFilter('flat-50-off')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('flat-50-off')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <BadgePercent className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('flat-50-off') ? 'text-[#DC2626]' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('flat-50-off') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Flat 50% OFF</span>
                          </button>
                          <button
                            onClick={() => toggleFilter('price-match')}
                            className={`flex flex-col items-center gap-2 p-4 md:p-5 rounded-xl border transition-colors ${activeFilters.has('price-match')
                              ? 'border-green-600 bg-green-50 dark:bg-green-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-green-600'
                              }`}
                          >
                            <BadgePercent className={`h-6 w-6 md:h-7 md:w-7 ${activeFilters.has('price-match') ? 'text-[#DC2626]' : 'text-gray-600 dark:text-gray-400'}`} strokeWidth={1.5} />
                            <span className={`text-sm md:text-base font-medium ${activeFilters.has('price-match') ? 'text-[#DC2626]' : 'text-gray-700 dark:text-gray-300'}`}>Price Match</span>
                          </button>
                        </div>
                      </div>

                      {/* Trust Markers Tab */}
                      {activeFilterTab === 'trust' && (
                        <div className="space-y-4">
                          <h3 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white">Trust Markers</h3>
                          <div className="flex flex-col gap-3 md:gap-4">
                            <button className="px-4 md:px-5 py-3 md:py-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-[#DC2626] text-left transition-colors">
                              <span className="text-sm md:text-base font-medium text-gray-700 dark:text-gray-300">Top Rated</span>
                            </button>
                            <button className="px-4 md:px-5 py-3 md:py-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-[#DC2626] text-left transition-colors">
                              <span className="text-sm md:text-base font-medium text-gray-700 dark:text-gray-300">Trusted by 1000+ users</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center gap-4 px-4 md:px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1a1a1a]">
                    <button
                      onClick={() => setIsFilterOpen(false)}
                      className="flex-1 py-3 md:py-4 text-center font-semibold text-gray-700 dark:text-gray-300 text-sm md:text-base"
                    >
                      Close
                    </button>
                    <button
                      onClick={() => {
                        setIsLoadingFilterResults(true)
                        setIsFilterOpen(false)
                        // Simulate loading for 500ms
                        setTimeout(() => {
                          setIsLoadingFilterResults(false)
                        }, 500)
                      }}
                      className={`flex-1 py-3 md:py-4 font-semibold rounded-xl transition-colors text-sm md:text-base ${activeFilters.size > 0 || sortBy
                        ? 'bg-[#DC2626] text-white hover:bg-[#991B1B]'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                        }`}
                    >
                      {activeFilters.size > 0 || sortBy
                        ? 'Show results'
                        : 'Show results'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}

      <style>{`
        @keyframes slideUp {
          0% {
            transform: translateY(100%);
          }
          100% {
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}


