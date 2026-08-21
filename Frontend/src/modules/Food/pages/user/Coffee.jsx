import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Star, ArrowLeft } from "lucide-react"
import { Button } from "@food/components/ui/button"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { useLocationSelector } from "@food/components/user/UserLayout"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { useLocation as useLocationHook } from "@food/hooks/useLocation"
import { FaLocationDot } from "react-icons/fa6"
import { diningAPI } from "@food/api"
import { resolveMediaUrl } from "@food/utils/common"

const coffeeBanner = "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&h=400&fit=crop"

export default function Coffee() {
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const { openLocationSelector } = useLocationSelector()
  const { location } = useLocationHook()
  const [stores, setStores] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const cityName = location?.city || "Select"

  useEffect(() => {
    const fetchCoffeeStores = async () => {
      try {
        setIsLoading(true)
        const response = await diningAPI.getRestaurants(
          location?.city ? { category: 'cafe-bistro', city: location.city } : { category: 'cafe-bistro' }
        )
        const list = response?.data?.success ? (response.data.data || []) : []
        const mapped = list.map((r, index) => {
          const rawImage = String(
            r?.diningSettings?.coverImage ||
            r?.coverImages?.[0]?.url ||
            r?.coverImages?.[0] ||
            r?.coverImage ||
            r?.profileImage?.url ||
            r?.profileImage ||
            ""
          ).trim()
          const logo = rawImage ? resolveMediaUrl(rawImage) : "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=400"
          const rawRating = Number(r?.rating || r?.avgRating || 4.2)
          const displayRating = Number.isFinite(rawRating) && rawRating > 0 ? (rawRating > 5 ? rawRating / 20 : rawRating) : 4.2

          return {
            id: r?._id || r?.id || `store-${index}`,
            name: r?.restaurantName || r?.name || "Cafe & Coffee",
            slug: r?.restaurantNameNormalized || String(r?.restaurantName || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            rating: parseFloat(displayRating.toFixed(1)),
            location: r?.location?.area || r?.address?.area || r?.area || "Nearby",
            distance: "1.2 km",
            price: r?.diningSettings?.costForTwo || r?.costForTwo || "₹450 for two",
            offer: r?.diningSettings?.offer || r?.offer || "Flat 15% OFF",
            logo,
          }
        })
        setStores(mapped)
      } catch (err) {
        setStores([])
      } finally {
        setIsLoading(false)
      }
    }
    fetchCoffeeStores()
  }, [location?.city])

  const handleLocationClick = useCallback(() => {
    openLocationSelector()
  }, [openLocationSelector])

  const renderStoreList = (stores, sectionTitle) => {
    return (
      <div className="mb-8">
        {/* Section Header */}
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide text-center">
            {sectionTitle}
          </h3>
        </div>

        {/* Store List */}
        <div className="space-y-0">
          {stores.map((store, index) => {
            const storeSlug = store.name.toLowerCase().replace(/\s+/g, "-")
            const isHighRating = store.rating >= 4.0

            return (
              <Link
                key={store.id}
                to={`/user/restaurants/${storeSlug}`}
                className="block"
              >
                <div className={`flex items-start gap-4 py-4 ${index !== stores.length - 1 ? 'border-b border-gray-200' : ''}`}>
                  {/* Logo - Circular */}
                  <div className="flex-shrink-0">
                    <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center">
                      {store.logo ? (
                        <img
                          src={store.logo}
                          alt={store.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.target.style.display = 'none'
                          }}
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                          <span className="text-gray-400 text-xs font-semibold">
                            {store.name.charAt(0)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Store Info */}
                  <div className="flex-1 min-w-0">
                    {/* Location Name */}
                    <h4 className="text-base font-bold text-gray-900 mb-2">
                      {store.location}
                    </h4>

                    {/* Rating Badge */}
                    <div className="mb-2">
                      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded ${isHighRating
                          ? 'bg-green-600 text-white'
                          : 'bg-[#EB590E] text-white'
                        }`}>
                        <span className="text-sm font-semibold">{store.rating}</span>
                        <Star className={`h-3 w-3 ${isHighRating ? 'fill-white text-white' : 'fill-white text-white'}`} />
                      </div>
                    </div>

                    {/* Distance */}
                    <p className="text-sm text-gray-500 mb-1">
                      {store.distance}
                    </p>

                    {/* Price and Offer */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="text-sm text-gray-700">
                        {store.price}
                      </p>
                      {store.offer && (
                        <span className="text-sm font-medium text-[#EB590E]">
                          {store.offer}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <AnimatedPage className="bg-white" style={{ minHeight: '100vh', paddingBottom: '80px', overflow: 'visible' }}>
      {/* Banner Section with Back Button and Location */}
      <div className="relative w-full overflow-hidden">
        {/* Background with coffee banner */}
        <div className="relative w-full z-0">
          <img
            src={coffeeBanner}
            alt="Coffee"
            className="w-full h-auto object-contain"
            style={{ display: 'block' }}
           loading="lazy" decoding="async" />
        </div>

        {/* Navbar with Back Button - Overlay on top of image */}
        <nav className="absolute top-0 left-0 right-0 z-20 w-full px-3 sm:px-6 lg:px-8 py-3 sm:py-4 backdrop-blur-sm">
          <div className="flex items-center justify-start gap-3 sm:gap-4">
            {/* Back Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={goBack}
              className="h-9 w-9 sm:h-10 sm:w-10 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition-colors flex-shrink-0"
            >
              <ArrowLeft className="h-5 w-5 text-gray-800" strokeWidth={2.5} />
            </Button>

            {/* Location with Dotted Underline */}
            <Button
              variant="ghost"
              onClick={handleLocationClick}
              className="text-left text-white text-sm sm:text-base font-semibold backdrop-blur-sm rounded-full px-3 sm:px-4 py-2 hover:bg-white transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FaLocationDot className="h-4 w-4 sm:h-5 sm:w-5 text-white flex-shrink-0" />
                <span className="text-sm sm:text-base font-semibold text-white truncate border-b-2 border-dotted border-white">
                  {cityName}
                </span>
              </div>
            </Button>
          </div>
        </nav>
      </div>

      {/* Content */}
      <div className="px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
        <div className="max-w-4xl mx-auto">
          {/* Header Section */}
          <div className="mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
              Cafe & Coffee Dining
            </h1>
            <p className="text-sm sm:text-base text-gray-500">
              Handcrafted coffee, beverages & dining outlets
            </p>
            <div className="h-px bg-gray-200 mt-4"></div>
          </div>

          {/* Dynamic Store List */}
          {isLoading ? (
            <div className="py-12 text-center text-sm text-gray-400">Loading cafes...</div>
          ) : stores.length > 0 ? (
            renderStoreList(stores, "DINING OUTLETS NEAR YOU")
          ) : (
            <div className="py-12 text-center text-sm text-gray-400">No cafes available right now.</div>
          )}
        </div>
      </div>
    </AnimatedPage>
  )
}
