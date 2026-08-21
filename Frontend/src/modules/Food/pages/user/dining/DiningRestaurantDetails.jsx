import { useEffect, useState, useMemo } from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { restaurantAPI } from "@food/api"
import { useProfile } from "@food/context/ProfileContext"
import { getMenuFromResponse } from "@food/utils/menuItems"
import { resolveMediaUrl } from "@food/utils/common"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import {
  ArrowLeft,
  Bookmark,
  CheckCircle2,
  Clock,
  Clock3,
  IndianRupee,
  Loader2,
  MapPin,
  Percent,
  Share2,
  Star,
  Tag,
  Ticket,
  UtensilsCrossed,
  X,
  ChevronLeft,
  ChevronRight,
  Phone,
  Navigation
} from "lucide-react"
import { Button } from "@food/components/ui/button"

const DEFAULT_DINING_IMAGES = [
  "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1200&h=800&fit=crop",
  "https://images.unsplash.com/photo-1544025162-d76694265947?w=1200&h=800&fit=crop"
]

const formatAddress = (restaurant) =>
  restaurant?.location?.formattedAddress ||
  restaurant?.location?.addressLine1 ||
  restaurant?.location?.address ||
  [restaurant?.location?.area || restaurant?.area, restaurant?.location?.city || restaurant?.city]
    .filter(Boolean)
    .join(", ")

const buildImageList = (restaurant) => {
  const candidates = [
    restaurant?.diningSettings?.coverImage,
    restaurant?.coverImage?.url,
    restaurant?.coverImage,
    ...(Array.isArray(restaurant?.coverImages) ? restaurant.coverImages.map((image) => image?.url || image) : []),
    ...(Array.isArray(restaurant?.diningSettings?.images) ? restaurant.diningSettings.images.map((img) => img?.url || img) : []),
    ...(Array.isArray(restaurant?.menuImages) ? restaurant.menuImages.map((image) => image?.url || image) : []),
    restaurant?.profileImage?.url,
    restaurant?.profileImage,
  ]
  const resolved = candidates
    .map((value) => (typeof value === "string" ? resolveMediaUrl(value.trim()) : ""))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)

  if (resolved.length === 0) {
    return DEFAULT_DINING_IMAGES
  }
  return resolved
}

const buildFacilities = (restaurant) => {
  const facilities = []

  if (restaurant?.diningSettings?.tableBookingEnabled !== false) facilities.push("Table Reservation")
  if (restaurant?.isAcceptingOrders !== false) facilities.push("Lunch & Dinner")
  if (restaurant?.diningSettings?.homeDeliveryAvailable || restaurant?.homeDeliveryAvailable) facilities.push("Home delivery")
  if (restaurant?.diningSettings?.takeawayAvailable || restaurant?.takeawayAvailable) facilities.push("Takeaway available")
  if (restaurant?.diningSettings?.vegOnly || restaurant?.vegOnly) facilities.push("Pure Vegetarian")
  if (restaurant?.diningSettings?.lessNoisy || restaurant?.ambience === "quiet") facilities.push("Peaceful Ambience")
  facilities.push("Air Conditioned", "Valet Parking Available")

  return facilities
}

const buildFeaturedSections = (menuSections) =>
  menuSections
    .map((section, index) => {
      const items = [
        ...(Array.isArray(section?.items) ? section.items : []),
        ...((Array.isArray(section?.subsections) ? section.subsections : []).flatMap((subsection) => subsection?.items || [])),
      ]

      return {
        id: `${section?.name || "section"}-${index}`,
        title: section?.name || "Menu",
        pages: items.length || 1,
      }
    })
    .slice(0, 4)

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
  const { addFavorite, removeFavorite, isFavorite } = useProfile()

  const [restaurant, setRestaurant] = useState(location.state?.restaurant || null)
  const [menuSections, setMenuSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedGuests, setSelectedGuests] = useState(2)
  const [isBookingSheetOpen, setIsBookingSheetOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("prebook")
  const [activeImageIndex, setActiveImageIndex] = useState(0)

  useEffect(() => {
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

        const restaurantResponse = await restaurantAPI.getRestaurantById(preferredRestaurantLookup)
        if (!restaurantResponse?.data?.success) {
          setError("Restaurant not found")
          setRestaurant(null)
          return
        }

        const resolvedRestaurant =
          restaurantResponse?.data?.data?.restaurant ||
          restaurantResponse?.data?.data ||
          null

        if (!resolvedRestaurant) {
          setError("Restaurant not found")
          setRestaurant(null)
          return
        }

        const restaurantId = resolvedRestaurant?._id || resolvedRestaurant?.id || slug
        const menuResponse = await restaurantAPI.getMenuByRestaurantId(restaurantId).catch(() => null)
        const resolvedMenu = menuResponse ? getMenuFromResponse(menuResponse) : null

        setRestaurant(resolvedRestaurant)
        setMenuSections(Array.isArray(resolvedMenu?.sections) ? resolvedMenu.sections : [])
      } catch {
        setError("Failed to load restaurant")
        setRestaurant(null)
      } finally {
        setLoading(false)
      }
    }

    fetchRestaurantData()
  }, [location.state?.restaurant, slug])

  const imageGallery = useMemo(() => buildImageList(restaurant), [restaurant])
  const heroImage = imageGallery[activeImageIndex] || imageGallery[0] || DEFAULT_DINING_IMAGES[0]

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fcfaf7] dark:bg-zinc-950">
        <Loader2 className="h-8 w-8 animate-spin text-[#EB590E]" />
      </div>
    )
  }

  if (error || !restaurant) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#fcfaf7] px-4 text-center">
        <h2 className="text-2xl font-bold text-gray-900">Restaurant not found</h2>
        <Button onClick={goBack} variant="outline">
          Go Back
        </Button>
      </div>
    )
  }

  const restaurantName = restaurant.name || restaurant.restaurantName || "Restaurant"
  const address = formatAddress(restaurant) || "Address unavailable"
  const menuPreviewImages = imageGallery.length > 0 ? imageGallery : DEFAULT_DINING_IMAGES
  const featuredSections = buildFeaturedSections(menuSections)
  const cuisines =
    Array.isArray(restaurant?.cuisines) && restaurant.cuisines.length > 0
      ? restaurant.cuisines.join(", ")
      : (restaurant?.cuisine || "North Indian, Chinese, Continental, Desserts, Beverages")
  const costForTwo = restaurant?.costForTwo ? `₹${restaurant.costForTwo} for two` : `₹600 for two`
  const facilities = buildFacilities(restaurant)
  const rawRating = Number(restaurant?.rating || restaurant?.avgRating || 4.2)
  const rating = Number.isFinite(rawRating) && rawRating > 0 ? (rawRating > 5 ? (rawRating / 20).toFixed(1) : rawRating.toFixed(1)) : "4.2"
  const reviewCount = restaurant?.totalRatings || restaurant?.reviewCount || restaurant?.reviewsCount || 12
  const openingTime = formatTimeLabel(restaurant?.openingTime || restaurant?.diningSettings?.openingTime || "09:00")
  const closingTime = formatTimeLabel(restaurant?.closingTime || restaurant?.diningSettings?.closingTime || "22:00")
  const isDiningEnabled = restaurant?.diningSettings?.isEnabled !== false
  
  const topTabs = [
    { id: "prebook", label: "Pre-book offers", target: "restaurant-prebook" },
    { id: "menu", label: "Menu", target: "restaurant-menu" },
    { id: "photos", label: "Photos", target: "restaurant-photos" },
    { id: "about", label: "About", target: "restaurant-about" },
  ]

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: restaurantName,
          text: `Reserve a table at ${restaurantName} on Eatiefy!`,
          url: window.location.href,
        })
      }
    } catch {}
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

  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-zinc-950 pb-28">
      {/* Top Hero Image Banner */}
      <section className="mx-auto max-w-lg bg-black relative">
        <div className="relative h-[360px] sm:h-[400px] overflow-hidden">
          <img
            src={heroImage}
            alt={restaurantName}
            className="h-full w-full object-cover transition-all duration-500"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = DEFAULT_DINING_IMAGES[0];
            }}
          />

          {/* Deep Dark Gradient Scrim to guarantee 100% readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/60 to-black/20" />

          {/* Top Bar Actions */}
          <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-4 pt-4">
            <button
              onClick={handleBack}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md border border-white/20 hover:bg-black/70 transition-all active:scale-95 shadow-md"
              title="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleFavorite}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md border border-white/20 hover:bg-black/70 transition-all active:scale-95 shadow-md"
                title="Save to favorites"
              >
                <Bookmark className={`h-4 w-4 ${favorite ? "fill-amber-400 text-amber-400" : "text-white"}`} />
              </button>
              <button
                onClick={handleShare}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md border border-white/20 hover:bg-black/70 transition-all active:scale-95 shadow-md"
                title="Share"
              >
                <Share2 className="h-4 w-4 text-white" />
              </button>
            </div>
          </div>

          {/* Photo Navigation if Multiple Photos */}
          {imageGallery.length > 1 && (
            <div className="absolute right-4 top-16 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md text-[11px] font-bold text-white border border-white/10">
              <span>{activeImageIndex + 1} / {imageGallery.length} Photos</span>
            </div>
          )}

          {/* Bottom Hero Restaurant Info */}
          <div className="absolute inset-x-0 bottom-0 px-4 pb-5 text-white z-10">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-300 text-[10px] font-extrabold uppercase tracking-wider mb-1.5 backdrop-blur-sm">
                  <UtensilsCrossed className="w-3 h-3" />
                  Table Booking Available
                </div>
                <h1 className="text-2xl sm:text-3xl font-black leading-tight tracking-tight text-white drop-shadow-md">
                  {restaurantName}
                </h1>
                <p className="mt-1 text-xs sm:text-sm font-medium text-amber-200/90 truncate">
                  {cuisines}
                </p>
                <p className="mt-1 text-xs text-white/80 line-clamp-2 leading-relaxed flex items-start gap-1">
                  <MapPin className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />
                  <span>{address}</span>
                </p>

                <div className="mt-2.5 flex items-center gap-2 flex-wrap text-xs text-white/90 font-medium">
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/25 border border-emerald-400/30 text-emerald-300 backdrop-blur-sm">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Open now</span>
                  </div>
                  <span>•</span>
                  <span>{openingTime} - {closingTime}</span>
                  <span>•</span>
                  <span className="font-bold text-amber-300">{costForTwo}</span>
                </div>
              </div>

              {/* Rating Card */}
              <div className="shrink-0 rounded-2xl bg-white dark:bg-zinc-900 px-3.5 py-2.5 text-center text-gray-900 dark:text-white shadow-2xl border border-white/20">
                <div className="flex items-center justify-center gap-1 text-2xl font-black leading-none text-emerald-600">
                  <span>{rating}</span>
                  <Star className="h-4 w-4 fill-emerald-600 text-emerald-600" />
                </div>
                <p className="mt-1 text-[11px] font-bold text-gray-500 dark:text-gray-400">{reviewCount} Reviews</p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="px-4 pb-3 pt-3 bg-white dark:bg-zinc-900 border-b border-slate-100 dark:border-zinc-800">
          <div className="grid grid-cols-3 gap-2.5">
            <button
              onClick={() => isDiningEnabled && setIsBookingSheetOpen(true)}
              disabled={!isDiningEnabled}
              style={{
                background: isDiningEnabled ? "linear-gradient(135deg, #EB590E 0%, #FF6F1E 100%)" : undefined,
              }}
              className={`flex h-11 items-center justify-center gap-2 rounded-xl px-3 text-xs sm:text-sm font-bold shadow-sm transition-all active:scale-95 ${
                isDiningEnabled
                  ? "text-white shadow-orange-500/25 hover:opacity-95"
                  : "cursor-not-allowed bg-slate-100 text-slate-400"
              }`}
            >
              <Ticket className="h-4 w-4" />
              <span>{isDiningEnabled ? "Book Table" : "Paused"}</span>
            </button>

            <button
              onClick={() => scrollToSection("restaurant-prebook")}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-orange-200/90 bg-orange-50/50 hover:bg-orange-100/50 text-[#EB590E] text-xs sm:text-sm font-bold transition-all active:scale-95 shadow-sm"
            >
              <Percent className="h-4 w-4 text-[#EB590E]" />
              <span>Offers</span>
            </button>

            <button
              onClick={() => scrollToSection("restaurant-menu")}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-bold transition-all active:scale-95 shadow-sm"
            >
              <UtensilsCrossed className="h-4 w-4 text-slate-500" />
              <span>Menu</span>
            </button>
          </div>

          {/* Light Luxury Cashback Banner */}
          <div
            style={{ background: "linear-gradient(135deg, #FFF7ED 0%, #FFEDD5 100%)" }}
            className="mt-3 overflow-hidden rounded-2xl border border-amber-200/80 p-3 text-amber-900 shadow-sm flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div
                style={{ background: "linear-gradient(135deg, #EB590E 0%, #FF6F1E 100%)" }}
                className="rounded-xl p-2 text-white shadow-sm"
              >
                <Percent className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-extrabold text-[#9A3412] leading-tight">20% Instant Cashback</p>
                <p className="text-[11px] text-[#C2410C] font-medium">on all dining bills paid via app</p>
              </div>
            </div>
            <span
              style={{ background: "linear-gradient(135deg, #EB590E 0%, #FF6F1E 100%)" }}
              className="px-2.5 py-1 rounded-full text-white font-black text-[10px] tracking-wider shadow-sm"
            >
              EATIEFY
            </span>
          </div>
        </div>
      </section>

      {/* Sticky Category Tabs */}
      <div className="sticky top-0 z-30 border-b border-slate-200/80 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl shadow-sm">
        <div className="mx-auto max-w-lg px-4 py-2.5">
          <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-hide">
            {topTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id)
                  scrollToSection(tab.target)
                }}
                style={{
                  background: activeTab === tab.id ? "#EB590E" : undefined,
                  borderColor: activeTab === tab.id ? "#EB590E" : undefined,
                }}
                className={`shrink-0 rounded-full border px-4 py-1.5 text-xs font-bold transition-all active:scale-95 ${
                  activeTab === tab.id
                    ? "text-white shadow-sm"
                    : "border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-600 dark:text-slate-300 hover:border-slate-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content Container */}
      <div className="mx-auto max-w-lg px-4 pt-4 space-y-5">
        {/* Pre-book Offers Section - Light & Polished */}
        <section id="restaurant-prebook" className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Pre-book Offers</h2>
            <p className="text-xs font-semibold text-[#EB590E] mt-0.5">Instant confirmation with exclusive table discount</p>
          </div>

          <div
            style={{ background: "linear-gradient(135deg, #FFFDFB 0%, #FFF7ED 100%)" }}
            className="mt-3 overflow-hidden rounded-2xl border border-orange-200/90 p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-orange-100/80 text-[#EB590E] border border-orange-200 font-extrabold text-[10px] uppercase tracking-wider">
                  Carnival Special
                </span>
                <p className="text-2xl font-black text-slate-900 mt-1.5">{restaurant?.offer || "Flat 20% OFF"}</p>
                <p className="text-xs text-slate-600 mt-0.5 font-medium">Applicable on total food & beverages bill</p>
              </div>
              <button
                onClick={() => isDiningEnabled && setIsBookingSheetOpen(true)}
                disabled={!isDiningEnabled}
                style={{
                  background: "linear-gradient(135deg, #EB590E 0%, #FF6F1E 100%)",
                }}
                className="shrink-0 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-md shadow-orange-500/20 hover:opacity-95 transition-all active:scale-95"
              >
                Book Slot
              </button>
            </div>
            <div className="mt-3 pt-2.5 border-t border-orange-200/50 flex items-center justify-between text-xs text-slate-500 font-medium">
              <span>Slots available today</span>
              <span className="text-emerald-600 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Free Cancellation
              </span>
            </div>
          </div>
        </section>

        {/* Menu Section */}
        <section id="restaurant-menu" className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Menu</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Explore popular dishes and beverages</p>
            </div>
            <span className="rounded-full bg-orange-50 dark:bg-orange-950/40 border border-orange-200/80 px-3 py-1 text-xs font-bold text-[#EB590E]">
              {featuredSections.length || 2} Sections
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            {(featuredSections.length > 0
              ? featuredSections
              : [
                  { id: "food", title: "Main Course & Starters", pages: 12 },
                  { id: "beverages", title: "Beverages & Drinks", pages: 6 },
                ]).map((section, index) => (
              <div key={section.id} className="overflow-hidden rounded-xl border border-slate-200/80 bg-white hover:border-orange-200 transition-all shadow-sm">
                <div className="h-28 bg-slate-100 overflow-hidden">
                  <img
                    src={menuPreviewImages[index % menuPreviewImages.length] || DEFAULT_DINING_IMAGES[0]}
                    alt={section.title}
                    className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src = DEFAULT_DINING_IMAGES[index % DEFAULT_DINING_IMAGES.length];
                    }}
                  />
                </div>
                <div className="p-2.5 text-center">
                  <p className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">{section.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 font-medium">{section.pages} items</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Photos Section */}
        <section id="restaurant-photos" className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">Ambience & Photos</h2>
            <span className="text-xs font-semibold text-slate-500">{imageGallery.length} Photos</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {imageGallery.slice(0, 4).map((image, index) => (
              <div
                key={index}
                onClick={() => {
                  setActiveImageIndex(index)
                  window.scrollTo({ top: 0, behavior: "smooth" })
                }}
                className={`overflow-hidden rounded-xl bg-slate-100 cursor-pointer group border border-slate-100 ${
                  index === 0 ? "col-span-2 h-44" : "h-28"
                }`}
              >
                <img
                  src={image}
                  alt={`${restaurantName} ${index + 1}`}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = DEFAULT_DINING_IMAGES[index % DEFAULT_DINING_IMAGES.length];
                  }}
                />
              </div>
            ))}
          </div>
        </section>

        {/* About & Facilities Section */}
        <section id="restaurant-about" className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm">
          <h2 className="text-lg font-extrabold text-slate-900 dark:text-white mb-3">About The Restaurant</h2>

          <div className="space-y-3 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-start gap-2.5">
              <IndianRupee className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <p className="font-bold text-slate-900 dark:text-white">{costForTwo}</p>
            </div>

            <div className="flex items-start gap-2.5">
              <UtensilsCrossed className="h-4 w-4 shrink-0 text-[#EB590E] mt-0.5" />
              <p className="font-medium">{cuisines}</p>
            </div>

            <div className="flex items-start gap-2.5">
              <MapPin className="h-4 w-4 shrink-0 text-orange-500 mt-0.5" />
              <p className="font-medium">{address}</p>
            </div>
          </div>

          <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-zinc-800">
            <h3 className="font-bold text-xs text-slate-900 dark:text-white mb-2.5">Highlights & Facilities</h3>
            <div className="grid grid-cols-2 gap-2">
              {facilities.slice(0, 8).map((facility, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#EB590E]" />
                  <span>{facility}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Sticky Bottom Booking Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200/80 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 p-3.5 backdrop-blur-xl shadow-lg">
        <div className="mx-auto max-w-lg flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500 font-medium">Instant Table Reservation</p>
            <p className="text-sm font-black text-slate-900 dark:text-white">{restaurantName}</p>
          </div>
          <Button
            onClick={() => isDiningEnabled && setIsBookingSheetOpen(true)}
            disabled={!isDiningEnabled}
            style={{
              background: isDiningEnabled ? "linear-gradient(135deg, #EB590E 0%, #FF6F1E 100%)" : undefined,
            }}
            className={`h-11 px-6 rounded-xl text-xs sm:text-sm font-bold transition-all shadow-md active:scale-95 ${
              isDiningEnabled
                ? "text-white shadow-orange-500/25 hover:opacity-95"
                : "cursor-not-allowed bg-slate-200 text-slate-500"
            }`}
          >
            {isDiningEnabled ? "Book A Table" : "Dining Paused"}
          </Button>
        </div>
      </div>

      {/* Guest Selection Modal Sheet */}
      {isBookingSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => setIsBookingSheetOpen(false)}
          />

          <div className="relative w-full max-w-lg rounded-t-3xl bg-white dark:bg-zinc-900 px-5 pb-7 pt-4 shadow-2xl border-t border-slate-100 dark:border-zinc-800 z-10 animate-in slide-in-from-bottom duration-300">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-300 dark:bg-zinc-700" />

            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">Select Guests</h3>
                <p className="text-xs text-slate-500 mt-0.5">How many guests will be dining?</p>
              </div>
              <button
                onClick={() => setIsBookingSheetOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2.5">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => (
                <button
                  key={`guest-${count}`}
                  onClick={() => setSelectedGuests(count)}
                  style={{
                    background: selectedGuests === count ? "#EB590E" : undefined,
                    borderColor: selectedGuests === count ? "#EB590E" : undefined,
                  }}
                  className={`rounded-xl border py-3 text-sm font-bold transition-all active:scale-95 ${
                    selectedGuests === count
                      ? "text-white shadow-md shadow-orange-500/20"
                      : "border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300"
                  }`}
                >
                  {count} {count === 1 ? "Guest" : "Guests"}
                </button>
              ))}
            </div>

            <Button
              onClick={handleContinueBooking}
              style={{
                background: "linear-gradient(135deg, #EB590E 0%, #FF6F1E 100%)",
              }}
              className="mt-6 h-12 w-full rounded-xl text-sm font-bold text-white shadow-lg shadow-orange-500/25 transition-all active:scale-95 hover:opacity-95"
            >
              Continue with {selectedGuests} {selectedGuests === 1 ? "Guest" : "Guests"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
