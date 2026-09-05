import { useEffect, useState, useMemo } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { restaurantAPI, diningAPI } from "@food/api"
import { useProfile } from "@food/context/ProfileContext"
import { getMenuFromResponse } from "@food/utils/menuItems"
import { isVegMenuItem, isVeganMenuItem } from "@food/utils/vegMode"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { isModuleAuthenticated } from "@food/utils/auth"
import {
    ArrowLeft,
    Bookmark,
    CheckCircle2,
  Clock3,
  IndianRupee,
  Loader2,
  MapPin,
  Percent,
  Share2,
  Tag,
  Ticket,
  X,
} from "lucide-react"
import { Button } from "@food/components/ui/button"
import { toast } from "sonner"

const formatAddress = (restaurant) =>
  restaurant?.location?.addressLine1 ||
  restaurant?.location?.formattedAddress ||
  restaurant?.location?.address ||
  [restaurant?.location?.area || restaurant?.area, restaurant?.location?.city || restaurant?.city]
    .filter(Boolean)
    .join(", ")

const buildImageList = (restaurant) => {
  const candidates = [
    restaurant?.coverImage?.url,
    restaurant?.coverImage,
    ...(Array.isArray(restaurant?.coverImages) ? restaurant.coverImages.map((image) => image?.url || image) : []),
    ...(Array.isArray(restaurant?.menuImages) ? restaurant.menuImages.map((image) => image?.url || image) : []),
    restaurant?.profileImage?.url,
    restaurant?.profileImage,
  ]
  return candidates
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
}

const buildFacilities = (restaurant) => {
  const facilities = []

  if (restaurant?.diningSettings?.tableBookingEnabled !== false) facilities.push("Dinner")
  if (restaurant?.isAcceptingOrders !== false) facilities.push("Lunch")
  if (restaurant?.diningSettings?.homeDeliveryAvailable || restaurant?.homeDeliveryAvailable) facilities.push("Home delivery")
  if (restaurant?.diningSettings?.takeawayAvailable || restaurant?.takeawayAvailable) facilities.push("Takeaway available")
  if (restaurant?.diningSettings?.vegOnly || restaurant?.vegOnly) facilities.push("Vegetarian only")
  if (restaurant?.diningSettings?.lessNoisy || restaurant?.ambience === "quiet") facilities.push("Less noisy")

  return facilities.length > 0
    ? facilities
    : ["Dinner", "Lunch", "Home delivery", "Takeaway available", "Vegetarian only", "Less noisy"]
}

const buildFeaturedSections = (menuSections, vegMode = false, vegModeOption = "all") =>
  menuSections
    .map((section, index) => {
      const items = [
        ...(Array.isArray(section?.items) ? section.items : []),
        ...((Array.isArray(section?.subsections) ? section.subsections : []).flatMap((subsection) => subsection?.items || [])),
      ]
      const visibleItems = vegMode
        ? items.filter((item) =>
            vegModeOption === "pure-vegan"
              ? isVeganMenuItem(item)
              : isVegMenuItem(item),
          )
        : items
      if (vegMode && visibleItems.length === 0) return null

      return {
        id: `${section?.name || "section"}-${index}`,
        title: section?.name || "Menu",
        pages: visibleItems.length || 1,
      }
    })
    .filter(Boolean)
    .slice(0, 2)

const formatTimeLabel = (value) => {
  if (!value) return null
  if (/[ap]m/i.test(value)) return value.toUpperCase()
  const date = new Date(`2000-01-01T${String(value).padStart(5, "0")}`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
}

const scrollToSection = (id) => {
  const element = document.getElementById(id)
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "start" })
  }
}

export default function DiningRestaurantDetails() {
  const { category, slug } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const { addFavorite, removeFavorite, isFavorite, vegMode, vegModeOption } = useProfile()

  const [restaurant, setRestaurant] = useState(location.state?.restaurant || null)
  const [menuSections, setMenuSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedGuests, setSelectedGuests] = useState(2)
  const [isBookingSheetOpen, setIsBookingSheetOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("menu")
  const [currentBookings, setCurrentBookings] = useState([])
  const [isFetchingBookings, setIsFetchingBookings] = useState(false)
  const [outletTimings, setOutletTimings] = useState({})

  const fetchRestaurantData = async () => {
    try {
      setLoading(true)
      setError(null)

      const routeRestaurant = location.state?.restaurant || null
      const preferredRestaurantLookup =
        routeRestaurant?._id ||
        routeRestaurant?.restaurantId ||
        routeRestaurant?.id ||
        slug

      let restaurantResponse = null;
      let resolvedRestaurant = null;
      
      try {
        // Since we are in Dining, try diningAPI FIRST!
        const diningRes = await diningAPI.getRestaurantBySlug(slug);
        if (diningRes?.data?.success && diningRes?.data?.data) {
           resolvedRestaurant = diningRes.data.data?.restaurant || diningRes.data.data;
           restaurantResponse = diningRes;
        }
      } catch (e) {
        // ignored
      }

      // If diningAPI failed, try restaurantAPI with ID
      if (!resolvedRestaurant) {
        try {
          restaurantResponse = await restaurantAPI.getRestaurantById(preferredRestaurantLookup)
          if (restaurantResponse?.data?.success) {
             resolvedRestaurant = restaurantResponse.data.data?.restaurant || restaurantResponse.data.data;
          }
        } catch (err) {
          // Ignored
        }
      }

      // If ID lookup failed, try restaurantAPI with slug
      if (!resolvedRestaurant && preferredRestaurantLookup !== slug) {
        try {
          restaurantResponse = await restaurantAPI.getRestaurantById(slug)
          if (restaurantResponse?.data?.success) {
             resolvedRestaurant = restaurantResponse.data.data?.restaurant || restaurantResponse.data.data;
          }
        } catch (err) {
          // Ignored
        }
      }

      // Last resort fallback using search
      if (!resolvedRestaurant) {
        try {
          // Change: Use diningAPI instead of restaurantAPI for search
          const searchResponse = await diningAPI.getRestaurants({ limit: 100 })
          const restaurants = searchResponse?.data?.data?.restaurants || searchResponse?.data?.data || []
          const restaurantNameStr = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
          const matchingRestaurant = restaurants.find(r => {
            const nameToUse = r.restaurantName || r.name;
            if (!nameToUse) return false;
            
            return r.slug === slug ||
              nameToUse.toLowerCase().replace(/\s+/g, '-') === slug.toLowerCase().replace(/\s+/g, '-') ||
              nameToUse.toLowerCase() === restaurantNameStr.toLowerCase() ||
              nameToUse.toLowerCase() === slug.toLowerCase()
          })
          
          if (matchingRestaurant) {
             const fullResponse = await restaurantAPI.getRestaurantById(matchingRestaurant._id || matchingRestaurant.restaurantId || matchingRestaurant.slug)
             if (fullResponse?.data?.success) {
                restaurantResponse = fullResponse
                resolvedRestaurant = fullResponse.data.data?.restaurant || fullResponse.data.data;
             } else {
                // If getRestaurantById fails for this matching restaurant, just use the matching one directly!
                resolvedRestaurant = matchingRestaurant;
             }
          }
        } catch (err) {}
      }

      if (!resolvedRestaurant) {
        setError("Restaurant not found")
        setRestaurant(null)
        return
      }

      setRestaurant(resolvedRestaurant)
      
      const restaurantId = resolvedRestaurant?._id || resolvedRestaurant?.id || slug
      
      // Fetch Bookings for Availability Check
      if (isModuleAuthenticated('user')) {
        setIsFetchingBookings(true)
        try {
            const bookingsRes = await diningAPI.getRestaurantBookings(resolvedRestaurant)
            if (bookingsRes.data.success) {
                setCurrentBookings(Array.isArray(bookingsRes.data.data) ? bookingsRes.data.data : [])
            }
        } catch (err) {
            debugError("Error fetching bookings:", err)
        } finally {
            setIsFetchingBookings(false)
        }
      } else {
        // Guest users cannot fetch bookings
        setCurrentBookings([])
        setIsFetchingBookings(false)
      }

      restaurantAPI.getOutletTimingsByRestaurantId(restaurantId)
        .then(r => setOutletTimings(r?.data?.data?.outletTimings || {}))
        .catch(() => {})

      const menuResponse = await restaurantAPI.getMenuByRestaurantId(restaurantId).catch(() => null)
      const resolvedMenu = menuResponse ? getMenuFromResponse(menuResponse) : null
      setMenuSections(Array.isArray(resolvedMenu?.sections) ? resolvedMenu.sections : [])
    } catch {
      setError("Failed to load restaurant")
      setRestaurant(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRestaurantData()
  }, [location.state?.restaurant, slug])

  useEffect(() => {
    if (isBookingSheetOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isBookingSheetOpen])

  // Calculate current occupied seats
  const occupiedSeats = useMemo(() => {
      const now = new Date()
      const THIRTY_MINUTES = 30 * 60 * 1000

      return currentBookings
          .filter(b => {
              // Only count approved bookings or pending bookings that are NOT expired (within 30 mins)
              const isApproved = b.status === "approved"
              const isPending = b.status === "pending"
              
              if (isApproved) return true
              if (isPending) {
                  const createdAt = new Date(b.createdAt || b.date)
                  const ageMs = now - createdAt
                  return ageMs < THIRTY_MINUTES // Only count if less than 30 mins old
              }
              return false
          })
          .reduce((sum, b) => sum + (Number(b.guests) || 0), 0)
  }, [currentBookings])

  const maxCapacity = restaurant?.diningSettings?.maxGuests || 6
  const remainingSeats = Math.max(0, maxCapacity - occupiedSeats)

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f7fb]">
        <Loader2 className="h-8 w-8 animate-spin text-[#DC2626]" />
      </div>
    )
  }

  if (error || !restaurant) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#f6f7fb] px-4 text-center">
        <h2 className="text-2xl font-bold text-[#23180f]">Restaurant not found</h2>
        <Button onClick={goBack} variant="outline">
          Go Back
        </Button>
      </div>
    )
  }

  const restaurantName = restaurant.name || restaurant.restaurantName || "Restaurant"
  const address = formatAddress(restaurant) || "Address unavailable"
  const imageGallery = buildImageList(restaurant)
  const heroImage = imageGallery[0] || ""
  const menuPreviewImages = imageGallery.length > 0 ? imageGallery : [""]
  const featuredSections = buildFeaturedSections(menuSections, vegMode, vegModeOption)
  const cuisines =
    Array.isArray(restaurant?.cuisines) && restaurant.cuisines.length > 0
      ? restaurant.cuisines.join(", ")
      : "Asian, Italian, Continental, Chinese, North Indian, Desserts, Beverages, Coffee"
  const costForTwo = restaurant?.costForTwo ? `${"\u20B9"}${restaurant.costForTwo} for two` : `${"\u20B9"}1900 for two`
  const facilities = buildFacilities(restaurant)
  const rating = Number(restaurant?.rating || restaurant?.avgRating || 0).toFixed(1)
  const reviewCount = restaurant?.totalRatings || restaurant?.reviewCount || restaurant?.reviewsCount || 0
  const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" })
  const todayTiming = outletTimings?.[todayName] || null
  const rawOpeningTime = todayTiming?.openingTime || restaurant?.openingTime || restaurant?.diningSettings?.openingTime || "12:00"
  const rawClosingTime = todayTiming?.closingTime || restaurant?.closingTime || restaurant?.diningSettings?.closingTime || "23:59"
  const openingTime = formatTimeLabel(rawOpeningTime)
  const closingTime = formatTimeLabel(rawClosingTime)

  const isOpenNow = (() => {
    if (todayTiming?.isOpen === false) return false
    const parseMin = (val) => {
      if (!val) return null
      const raw = String(val).trim()
      // HH:MM 24h format
      const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/)
      if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2])
      // 12h AM/PM format e.g. "1:00 AM", "11:30 PM"
      const ampm = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i)
      if (ampm) {
        let h = Number(ampm[1])
        const m = Number(ampm[2] || 0)
        const period = ampm[3].toUpperCase()
        if (period === 'PM' && h !== 12) h += 12
        if (period === 'AM' && h === 12) h = 0
        return h * 60 + m
      }
      return null
    }
    const now = new Date()
    const cur = now.getHours() * 60 + now.getMinutes()
    const open = parseMin(rawOpeningTime)
    let close = parseMin(rawClosingTime)
    if (open === null || close === null) return true
    if (close <= open) close += 24 * 60
    return cur >= open && cur <= close
  })()
  const isDiningEnabled = restaurant?.diningSettings?.isEnabled !== false
  const topTabs = [
    { id: "menu", label: "Menu", target: "restaurant-menu" },
    { id: "photos", label: "Photos", target: "restaurant-photos" },
    { id: "about", label: "About", target: "restaurant-about" },
  ]

  const handleShare = async () => {
    const shareData = {
      title: restaurantName,
      text: `Check out ${restaurantName} on Ometto!`,
      url: window.location.href,
    }

    try {
      if (navigator.share) {
        await navigator.share(shareData)
        return
      }
      
      // Fallback for desktop
      await navigator.clipboard.writeText(window.location.href)
      toast.success("Link copied to clipboard!")
    } catch (err) {
      if (err.name !== 'AbortError') {
        toast.error("Sharing failed. Please try again.")
      }
    }
  }

  const restaurantFavoriteSlug =
    restaurant?.restaurantNameNormalized ||
    restaurant?.slug ||
    slug

  const favorite = isFavorite(restaurantFavoriteSlug)

  const handleBack = () => {
    if (window.history.length > 1) {
      goBack()
      return
    }

    if (category) {
      navigate(`/food/user/dining/${category}`)
      return
    }

    navigate("/food/user/dining")
  }

  const handleToggleFavorite = () => {
    if (favorite) {
      removeFavorite(restaurantFavoriteSlug)
      return
    }

    addFavorite({
      slug: restaurantFavoriteSlug,
      name: restaurantName,
      cuisine: cuisines,
      rating,
      image: heroImage,
    })
  }

  const handleContinueBooking = () => {
    if (!isDiningEnabled) return
    setIsBookingSheetOpen(false)
    navigate(`/food/user/dining/book/${slug}`, {
      state: {
        guestCount: selectedGuests,
        restaurant,
      },
    })
  }

  const handleOpenBookingSheet = () => {
    if (!isDiningEnabled) return
    if (!isModuleAuthenticated('user')) {
      window.dispatchEvent(new CustomEvent('show-login-required'))
      return
    }
    setIsBookingSheetOpen(true)
  }

  return (
    <div className="min-h-screen bg-[#f6f7fb] dark:bg-slate-950 pb-28 transition-colors">
      <section className="mx-auto max-w-md bg-[#f6f7fb] dark:bg-slate-950 uppercase-fix">
        <div className="relative h-[392px] overflow-hidden">
          {heroImage ? (
            <img src={heroImage} alt={restaurantName} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-[radial-gradient(circle_at_top,#eadcc7,#a09279_58%,#655749)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/78 via-black/18 to-black/0" />

          <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-3 pt-3">
            <button
              onClick={handleBack}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#51586a]/75 text-white backdrop-blur-md transition-all active:scale-90"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <button
              onClick={handleShare}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#51586a]/75 text-white backdrop-blur-md transition-all active:scale-90"
            >
              <Share2 className="h-5 w-5" />
            </button>
          </div>

          <div className="absolute inset-x-0 bottom-0 px-3 pb-4 text-white">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="text-[36px] font-black leading-none tracking-[-0.03em]">{restaurantName}</h1>
                <p className="mt-2 max-w-[94%] text-[14px] leading-5 text-white/92">{address}</p>
                <p className="mt-2 text-[14px] text-white/90">
                  {costForTwo}
                  <span className="mx-1.5 text-white/65">•</span>
                  {cuisines}
                </p>
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-black/28 px-2.5 py-1 text-[13px] font-medium backdrop-blur-sm">
                  {isOpenNow ? (
                    <CheckCircle2 className="h-4 w-4 text-[#48d597]" />
                  ) : (
                    <span className="h-4 w-4 rounded-full bg-red-500 inline-block" />
                  )}
                  <span className={isOpenNow ? "text-[#48d597]" : "text-red-400"}>{isOpenNow ? "Open now" : "Closed"}</span>
                  {openingTime && closingTime && (
                    <>
                      <span className="text-white/70">|</span>
                      <span>{openingTime} to {closingTime}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="mb-1 shrink-0 rounded-[18px] bg-white dark:bg-slate-800 px-3 py-2 text-center text-[#1f2328] dark:text-slate-100 shadow-xl border border-white/20">
                <div className="flex items-center justify-center gap-1 text-[31px] font-black leading-none">
                  <span>{rating}</span>
                  <span className="text-[18px] text-[#18b54f]">★</span>
                </div>
                <p className="mt-1 text-[13px] leading-4 text-[#6e7481] dark:text-slate-400">{reviewCount} Reviews</p>
              </div>
            </div>
          </div>
        </div>

          <div className="px-3 pb-1 pt-3">
            <div className="w-full">
              <button
                onClick={handleOpenBookingSheet}
                disabled={!isDiningEnabled}
                className={`flex h-[52px] w-full items-center justify-center gap-2 rounded-full border px-3 text-[15px] font-medium shadow-[0_10px_24px_rgba(15,23,42,0.05)] transition-all ${
                  isDiningEnabled
                    ? "border-[#f1ebee] dark:border-slate-800 bg-white dark:bg-slate-900 text-[#2b2118] dark:text-slate-100"
                    : "cursor-not-allowed border-[#f2d7da] dark:border-red-900/30 bg-[#fff5f6] dark:bg-red-950/20 text-[#c06a79] opacity-80"
                }`}
              >
              <Ticket className="h-[15px] w-[15px] text-[#DC2626]" />
              <span>{isDiningEnabled ? "Book a table" : "Dining paused"}</span>
              </button>
            </div>

            {!isDiningEnabled && (
              <div className="mt-3 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Dining bookings are currently turned off by the restaurant.
              </div>
            )}

        </div>
      </section>

      <div className="sticky top-0 z-30 border-b border-[#ececf3] dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl transition-colors">
        <div className="mx-auto max-w-md px-3 py-2">
          <div className="flex gap-2 justify-center">
            {topTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id)
                  scrollToSection(tab.target)
                }}
                className={`shrink-0 rounded-full border px-5 py-2 text-sm transition-colors ${
                  activeTab === tab.id
                    ? "border-[#DC2626] bg-white dark:bg-slate-900 text-[#2a2018] dark:text-slate-100"
                    : "border-[#ece9e1] dark:border-slate-800 bg-[#fafafa] dark:bg-slate-900 text-[#8b8881] dark:text-slate-400"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-md px-4 pt-2">
        <section id="restaurant-menu" className="mt-2">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-[28px] font-black leading-none text-[#23180f] dark:text-slate-100">Menu</h2>
              <p className="mt-2 text-[13px] text-[#e19135] dark:text-orange-400">Last updated a month ago</p>
            </div>
            <div className="rounded-full bg-[#fff3e6] dark:bg-orange-950/30 px-3 py-1 text-xs font-semibold text-[#e58a2c] dark:text-orange-300">
              {featuredSections.length || 2} dishes
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {(featuredSections.length > 0
              ? featuredSections
              : [
                  { id: "food", title: "Food", pages: 16 },
                  { id: "beverages", title: "Beverages", pages: 10 },
                ]).map((section, index) => (
              <div key={section.id} className="overflow-hidden rounded-[18px] border border-[#ede8dd] dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="aspect-[0.88] bg-[#f7f1e7] dark:bg-slate-800">
                  {menuPreviewImages[index] ? (
                    <img src={menuPreviewImages[index]} alt={section.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,#fff3e0,#f3eadf)] dark:bg-slate-800 text-sm font-medium text-[#a28868] dark:text-slate-400">
                      Menu preview
                    </div>
                  )}
                </div>
                <div className="px-2 pb-3 pt-2 text-center">
                  <p className="text-[16px] font-medium leading-tight text-[#2b2218] dark:text-slate-100">{section.title}</p>
                  <p className="mt-1 text-[12px] text-[#7f7a73] dark:text-slate-400">{section.pages} pages</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="restaurant-photos" className="mt-5 border-t border-[#e8e8ef] dark:border-slate-800 pt-4">
          <h2 className="text-[28px] font-black leading-none text-[#23180f] dark:text-slate-100">Photos</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {(imageGallery.length > 0 ? imageGallery.slice(0, 4) : menuPreviewImages.slice(0, 2)).map((image, index) => (
              <div
                key={`${image || "placeholder"}-${index}`}
                className={`overflow-hidden rounded-[18px] bg-[#f6efe4] dark:bg-slate-800 ${
                  index === 0 ? "col-span-2 aspect-[1.72]" : "aspect-[1.08]"
                }`}
              >
                {image ? (
                  <img src={image} alt={`${restaurantName} ${index + 1}`} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-[#a28868] dark:text-slate-400">Photo coming soon</div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section id="restaurant-about" className="mt-5 border-t border-[#e8e8ef] dark:border-slate-800 pt-4">
          <h2 className="text-[28px] font-black leading-none text-[#23180f] dark:text-slate-100">About the restaurant</h2>
          <div className="mt-4 rounded-[18px] border border-[#ececf4] dark:border-slate-800 bg-[#fafbff] dark:bg-slate-900 p-4 transition-colors">
            <div className="space-y-4 text-[14px] text-[#5f6474] dark:text-slate-400">
              <div className="flex items-start gap-3">
                <IndianRupee className="mt-0.5 h-4 w-4 shrink-0 text-[#f0b500]" />
                <p>{costForTwo}</p>
              </div>

              <div className="flex items-start gap-3">
                <div className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-[#8a8f9d]" />
                <p>{cuisines}</p>
              </div>

              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
                <p>{address}</p>
              </div>
            </div>

            <div className="mt-5 border-t border-[#e8e8ef] dark:border-slate-800 pt-4">
              <h3 className="text-[20px] font-semibold text-[#23180f] dark:text-slate-100">Featured In</h3>
              <div className="mt-3 overflow-hidden rounded-[16px] bg-white dark:bg-slate-800 shadow-sm">
                <div className="aspect-[1.2] bg-[#efe8df] dark:bg-slate-700">
                  {heroImage ? (
                    <img src={heroImage} alt={restaurantName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-[#a28868] dark:text-slate-400">Featured image</div>
                  )}
                </div>
                <div className="-mt-14 bg-[linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,0.72))] p-3 pt-10 text-sm font-medium text-white">
                  Pan-Asian Restaurants
                </div>
              </div>
            </div>

            <div className="mt-5 border-t border-[#e8e8ef] dark:border-slate-800 pt-4">
              <h3 className="text-[20px] font-semibold text-[#23180f] dark:text-slate-100">Facilities</h3>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                {facilities.slice(0, 6).map((facility) => (
                  <div key={facility} className="flex items-center gap-2 text-[14px] text-[#5f6474] dark:text-slate-400">
                    <span className="inline-block h-[7px] w-[7px] rounded-full border border-[#8a8f9d]" />
                    <span>{facility}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#ebe5da] dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 p-4 backdrop-blur-xl transition-colors">
        <div className="mx-auto max-w-md">
          <Button
            onClick={handleOpenBookingSheet}
            disabled={!isDiningEnabled}
            className={`h-12 w-full rounded-2xl border text-[17px] font-medium transition-all ${
              isDiningEnabled
                ? "border-[#FEE2E2] bg-white dark:bg-slate-900 text-[#DC2626] dark:text-purple-400 hover:bg-[#fdfafc] dark:hover:bg-slate-800"
                : "cursor-not-allowed border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-900 text-gray-400 dark:text-slate-600 opacity-80"
            }`}
          >
            {isDiningEnabled ? "Book a table" : "Dining paused"}
          </Button>
        </div>
      </div>

      {isBookingSheetOpen && (
        <div className="fixed inset-0 z-40">
          <button
            aria-label="Close booking sheet"
            className="absolute inset-0 bg-black/35"
            onClick={() => setIsBookingSheetOpen(false)}
          />

          <div className="absolute bottom-0 left-0 right-0 rounded-t-[28px] bg-white dark:bg-slate-900 px-4 pb-6 pt-4 shadow-[0_-20px_60px_rgba(15,23,42,0.18)] border-t border-white/5 transition-colors">
            <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-[#e7e5e4] dark:bg-slate-700" />

            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-black text-[#23180f] dark:text-slate-100">Select number of guests</h3>
                <p className="mt-1 text-sm text-[#7b6651] dark:text-slate-400">
                    {remainingSeats > 0 
                        ? `Only ${remainingSeats} out of ${maxCapacity} seats available now.` 
                        : "Fully booked for now. Try later!"}
                </p>
              </div>
              <button
                onClick={() => setIsBookingSheetOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f5f5f5] dark:bg-slate-800 text-[#5b5b5b] dark:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-3">
              {Array.from({ length: maxCapacity }, (_, index) => {
                const count = index + 1
                const isBooked = count <= occupiedSeats
                const isTooLarge = count > remainingSeats && !isBooked

                return (
                    <button
                      key={`sheet-${count}`}
                      disabled={isBooked || isTooLarge}
                      onClick={() => setSelectedGuests(count)}
                      className={`relative rounded-2xl border px-3 py-4 text-sm font-bold transition-all ${
                          selectedGuests === count
                            ? "border-[#DC2626] bg-[#fdfafc] dark:bg-purple-950/30 text-[#DC2626] scale-[1.02] shadow-sm"
                            : isBooked
                              ? "border-red-100 dark:border-red-900/30 bg-red-50 dark:bg-red-950/20 text-red-400 cursor-not-allowed opacity-70"
                              : isTooLarge
                                ? "border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-950 text-gray-300 dark:text-slate-600 cursor-not-allowed"
                                : "border-[#ece7de] dark:border-slate-800 bg-white dark:bg-slate-800 text-[#23180f] dark:text-slate-100 hover:border-[#DC2626]/30"
                      }`}
                    >
                      {isBooked ? (
                          <div className="flex flex-col items-center gap-0.5">
                              <span className="text-[10px] uppercase font-black tracking-tighter opacity-60">Booked</span>
                              <span>{count}</span>
                          </div>
                      ) : (
                          count
                      )}
                    </button>
                )
              })}
            </div>

            <Button
              onClick={handleContinueBooking}
              disabled={remainingSeats === 0 || selectedGuests > remainingSeats}
              className="mt-6 h-12 w-full rounded-2xl bg-[#DC2626] text-base font-bold text-white hover:bg-[#991B1B] disabled:bg-gray-200 disabled:text-gray-400"
            >
              {remainingSeats === 0 ? "Fully Booked" : "Continue"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
