import { useState, useEffect, useRef } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { X, Search, Clock, Loader2, Mic, Store } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { searchAPI } from "@/services/api"
import { useVoiceSearch } from "@food/hooks/useVoiceSearch"
import { useLocation as useGeoLocation } from "@food/hooks/useLocation"
import { useZone } from "@food/hooks/useZone"
import { useProfile } from "@food/context/ProfileContext"

const SEARCH_HISTORY_KEY = "user_recent_searches_v1"

// Typing should feel instant, so keep the debounce short enough to stay ahead
// of the user but long enough to avoid a request per keystroke.
const SEARCH_DEBOUNCE_MS = 180

const EMPTY_RESULTS = { dishes: [], restaurants: [] }

/** Give up waiting for the destination and close anyway after this long. */
const NAVIGATION_CLOSE_FALLBACK_MS = 8000

/*
 * Warm the pages a result can open.
 *
 * Both are lazy routes. The router renders navigations inside a transition, so
 * while a chunk downloads it keeps the PREVIOUS screen on display - which, from
 * the search overlay, is the kept-alive Home page. Fetching the chunks as soon
 * as search opens means the tap lands on an already-loaded page.
 */
let destinationsPreloaded = false
const preloadSearchDestinations = () => {
  if (destinationsPreloaded) return
  destinationsPreloaded = true
  Promise.all([
    import("@food/pages/user/restaurants/RestaurantDetails"),
    import("@food/pages/user/search/ProfessionalSearch"),
  ]).catch(() => {
    destinationsPreloaded = false
  })
}

/** Thumbnail that falls back to an icon instead of leaking its alt text when the URL is broken. */
function ResultImage({ src, alt, className, fallback }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return fallback
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

const getImageUrl = (value) => {
  if (!value) return ""
  if (typeof value === "string") return value
  if (typeof value === "object") {
    return (
      value.url ||
      value.secure_url ||
      value.imageUrl ||
      value.image ||
      value.src ||
      ""
    )
  }
  return ""
}

export default function SearchOverlay({ isOpen, onClose, searchValue, onSearchChange, autoStartVoice = false }) {
  const navigate = useNavigate()
  const location = useLocation()
  const inputRef = useRef(null)
  /** Result the user tapped, while its page is still loading behind the overlay. */
  const [pendingKey, setPendingKey] = useState(null)
  const pendingFromLocationKeyRef = useRef(null)
  // The provider recreates these every render; read them through refs so the
  // close/fallback effects below are not torn down and restarted each time.
  const onCloseRef = useRef(onClose)
  const onSearchChangeRef = useRef(onSearchChange)
  onCloseRef.current = onClose
  onSearchChangeRef.current = onSearchChange

  useEffect(() => {
    if (isOpen) preloadSearchDestinations()
  }, [isOpen])
  const [results, setResults] = useState(EMPTY_RESULTS)
  const [recentSuggestions, setRecentSuggestions] = useState([])
  const [searching, setSearching] = useState(false)

  const { location: userCoords } = useGeoLocation()
  const { zoneId, loading: zoneLoading } = useZone(userCoords)
  const { vegMode } = useProfile()

  // Depend on the primitives: the coords object gets a new identity on every
  // parent render, which would otherwise refire the search endlessly.
  const lat = userCoords?.latitude
  const lng = userCoords?.longitude

  // Guards against out-of-order responses - a slow "piz" must never overwrite
  // the results for "pizza".
  const requestIdRef = useRef(0)

  const { isListening, startListening, stopListening } = useVoiceSearch((transcript) => {
    onSearchChange(transcript)
  })

  useEffect(() => {
    if (isOpen && autoStartVoice) {
      startListening()
    }
  }, [isOpen, autoStartVoice, startListening])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const loadRecentSuggestions = () => {
      try {
        const raw = localStorage.getItem(SEARCH_HISTORY_KEY)
        const parsed = raw ? JSON.parse(raw) : []
        if (Array.isArray(parsed)) {
          setRecentSuggestions(parsed.filter((item) => typeof item === "string" && item.trim()).slice(0, 8))
          return
        }
      } catch {
        // Ignore parse errors.
      }
      setRecentSuggestions([])
    }

    loadRecentSuggestions()
  }, [isOpen])

  // Live search: fires as the user types, no Enter required.
  useEffect(() => {
    if (!isOpen) return

    const term = searchValue.trim()
    if (!term) {
      requestIdRef.current += 1 // discard anything still in flight
      setResults(EMPTY_RESULTS)
      setSearching(false)
      return
    }

    // The API returns nothing without a resolved zone, so wait for it rather
    // than rendering a misleading "no results".
    if (!zoneId) {
      setResults(EMPTY_RESULTS)
      setSearching(Boolean(zoneLoading))
      return
    }

    setSearching(true)
    const requestId = ++requestIdRef.current

    const timer = setTimeout(async () => {
      try {
        const res = await searchAPI.unifiedSearch({
          q: term,
          lat,
          lng,
          limit: 30,
          zoneId,
          orderType: "delivery",
          ...(vegMode ? { isVeg: "true" } : {}),
        })
        if (requestId !== requestIdRef.current) return

        const all = res.data?.success ? res.data?.data?.restaurants || [] : []

        // The server already decided what matches - re-filtering by name here
        // would drop valid hits on description, category or restaurant name.
        setResults({
          dishes: all
            .filter((item) => item?.matchType === "food" && item?.matchedDish)
            .map((item, index) => ({
              id: item.matchedDishId || `dish-${item._id || index}`,
              name: item.matchedDish,
              image: getImageUrl(item.matchedDishImage || item.profileImage || item.image),
              restaurantId: item._id,
              restaurantName: item.restaurantName,
            })),
          restaurants: all
            .filter((item) => item?.matchType === "restaurant" || !item?.matchType)
            .map((item, index) => ({
              id: item._id || `restaurant-${index}`,
              name: item.restaurantName || item.name,
              image: getImageUrl(item.profileImage || item.image),
              cuisines: Array.isArray(item.cuisines) ? item.cuisines.slice(0, 3).join(", ") : "",
            })),
        })
      } catch {
        if (requestId !== requestIdRef.current) return
        setResults(EMPTY_RESULTS)
      } finally {
        if (requestId === requestIdRef.current) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [isOpen, searchValue, zoneId, zoneLoading, lat, lng, vegMode])

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleEscape)
      document.body.style.overflow = "hidden"
    }

    return () => {
      document.removeEventListener("keydown", handleEscape)
      document.body.style.overflow = "unset"
    }
  }, [isOpen, onClose])

  const saveRecentSearch = (term) => {
    const value = String(term || "").trim()
    if (!value) return

    setRecentSuggestions((prev) => {
      const next = [value, ...prev.filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(0, 8)
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }

  const handleSuggestionClick = (suggestion) => {
    onSearchChange(suggestion)
    inputRef.current?.focus()
  }

  /*
   * Navigate, and close the overlay only once the destination is on screen.
   *
   * This used to navigate and close in the same tick. The router commits a
   * navigation inside a transition - it keeps the old screen until the lazy
   * page is ready - but closing the overlay is an ordinary update that lands at
   * once. So for the length of the chunk download the user was looking at the
   * Home page underneath, then got "redirected" to the page they tapped.
   * useLocation() only reports the new location when that transition commits,
   * which makes it the exact signal to close on.
   */
  const openFromSearch = (to, key, term) => {
    if (pendingKey) return
    saveRecentSearch(term)
    pendingFromLocationKeyRef.current = location.key
    setPendingKey(key)
    navigate(to)
  }

  useEffect(() => {
    if (!pendingKey) return
    if (location.key === pendingFromLocationKeyRef.current) return
    pendingFromLocationKeyRef.current = null
    setPendingKey(null)
    onCloseRef.current()
    onSearchChangeRef.current("")
  }, [location.key, pendingKey])

  // Never trap the user behind the overlay if the page fails to load.
  useEffect(() => {
    if (!pendingKey) return
    const timer = setTimeout(() => {
      pendingFromLocationKeyRef.current = null
      setPendingKey(null)
      onCloseRef.current()
      onSearchChangeRef.current("")
    }, NAVIGATION_CLOSE_FALLBACK_MS)
    return () => clearTimeout(timer)
  }, [pendingKey])

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    const term = searchValue.trim()
    if (term) {
      openFromSearch(`/food/user/search?q=${encodeURIComponent(term)}&mode=delivery`, "submit", term)
    }
  }

  const handleFoodClick = (food) => {
    openFromSearch(
      `/food/user/search?q=${encodeURIComponent(food.name)}&mode=delivery`,
      `dish:${food.id}`,
      food.name,
    )
  }

  const handleRestaurantClick = (restaurant) => {
    openFromSearch(
      `/food/user/restaurants/${restaurant.id}`,
      `restaurant:${restaurant.id}`,
      restaurant.name,
    )
  }

  if (!isOpen) return null

  const totalResults = results.dishes.length + results.restaurants.length

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-white dark:bg-[#141414]"
      style={{
        animation: 'fadeIn 0.3s ease-out'
      }}
    >
      {/* Header with Search Bar */}
      <div className="flex-shrink-0 bg-white dark:bg-[#242424] border-b border-gray-100 dark:border-gray-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-5 top-1/2 transform -translate-y-1/2 h-5 w-5 text-[#1F6B45] dark:text-[#6BAF8C] z-10" strokeWidth={2.5} />
              <Input
                ref={inputRef}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search dishes or restaurants"
                className="pl-14 pr-16 h-13 w-full bg-white dark:bg-[#242424] border-gray-200 dark:border-gray-800 focus:ring-2 focus:ring-[#1F6B45]/20 focus:border-[#1F6B45] dark:focus:border-[#1F6B45] rounded-2xl text-base dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-sm transition-all duration-200"
              />
              <div className="absolute right-4 top-1/2 transform -translate-y-1/2 flex items-center gap-3">
                <div className="h-6 w-[1px] bg-gray-200 dark:bg-gray-700" />
                {isListening ? (
                  <button
                    type="button"
                    onClick={stopListening}
                    className="p-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-500 animate-pulse shadow-sm"
                  >
                    <Mic className="h-5 w-5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startListening}
                    className="p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-[#1F6B45] dark:text-[#6BAF8C] transition-all active:scale-90"
                  >
                    <Mic className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="h-5 w-5 text-gray-700 dark:text-gray-300" />
            </Button>
          </form>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 scrollbar-hide bg-white dark:bg-[#141414]">
        {/* Suggestions Row */}
        <div
          className="mb-6"
          style={{
            animation: 'slideDown 0.3s ease-out 0.1s both'
          }}
        >
          <h3 className="text-sm sm:text-base font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-[#1F6B45]" />
            Recent Searches
          </h3>
          <div className="flex gap-2 sm:gap-3 flex-wrap">
            {recentSuggestions.slice(0, 8).map((suggestion, index) => (
              <button
                key={suggestion}
                onClick={() => handleSuggestionClick(suggestion)}
                className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30 border border-orange-200 dark:border-orange-800 hover:border-orange-300 dark:hover:border-orange-700 text-gray-700 dark:text-gray-300 hover:text-[#1F6B45] dark:hover:text-orange-400 transition-all duration-200 text-xs sm:text-sm font-medium shadow-sm hover:shadow-md"
                style={{
                  animation: `scaleIn 0.3s ease-out ${0.1 + index * 0.02}s both`
                }}
              >
                <Clock className="h-3 w-3 sm:h-4 sm:w-4 text-[#1F6B45] flex-shrink-0" />
                <span>{suggestion}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Food Grid */}
        <div
          style={{
            animation: 'fadeIn 0.3s ease-out 0.2s both'
          }}
        >
          <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-4 sm:mb-6">
            {searchValue.trim() === ""
              ? "Start typing to search dishes and restaurants"
              : `Search Results (${totalResults})`}
          </h3>

          {results.restaurants.length > 0 && (
            <div className="mb-8">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                Restaurants
              </h4>
              <div className="flex flex-col gap-2">
                {results.restaurants.map((restaurant, index) => (
                  <button
                    key={restaurant.id}
                    type="button"
                    onClick={() => handleRestaurantClick(restaurant)}
                    disabled={Boolean(pendingKey)}
                    aria-busy={pendingKey === `restaurant:${restaurant.id}`}
                    className="flex items-center gap-3 disabled:cursor-wait rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#242424] p-3 text-left transition-all hover:border-[#1F6B45]/40 hover:shadow-md active:scale-[0.99]"
                    style={{
                      animation: `slideUp 0.3s ease-out ${0.2 + 0.04 * (index % 10)}s both`,
                    }}
                  >
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800">
                      <ResultImage
                        src={restaurant.image}
                        alt={restaurant.name}
                        className="h-full w-full object-cover"
                        fallback={
                          <div className="flex h-full w-full items-center justify-center">
                            <Store className="h-5 w-5 text-gray-400" />
                          </div>
                        }
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                        {restaurant.name}
                      </p>
                      {restaurant.cuisines && (
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {restaurant.cuisines}
                        </p>
                      )}
                    </div>
                    {pendingKey === `restaurant:${restaurant.id}` && (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#1F6B45]" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {results.dishes.length > 0 && (
            <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
              Dishes
            </h4>
          )}
          {totalResults > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
              {results.dishes.map((food, index) => (
                <div
                  key={food.id}
                  role="button"
                  aria-busy={pendingKey === `dish:${food.id}`}
                  className={`flex flex-col items-center gap-2 sm:gap-3 group ${pendingKey ? "cursor-wait" : "cursor-pointer"}`}
                  style={{
                    animation: `slideUp 0.3s ease-out ${0.25 + 0.05 * (index % 12)}s both`
                  }}
                  onClick={() => handleFoodClick(food)}
                >
                  <div className="relative w-full aspect-square rounded-full overflow-hidden transition-all duration-200 shadow-md group-hover:shadow-lg bg-white dark:bg-[#242424] p-1 sm:p-1.5">
                    <ResultImage
                      src={food.image}
                      alt={food.name}
                      className="w-full h-full object-cover rounded-full"
                      fallback={
                        <div className="w-full h-full rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                          <Search className="h-5 w-5 text-gray-400" />
                        </div>
                      }
                    />
                    {pendingKey === `dish:${food.id}` && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-full bg-white/60 dark:bg-black/40">
                        <Loader2 className="h-6 w-6 animate-spin text-[#1F6B45]" />
                      </div>
                    )}
                  </div>
                  <div className="px-1 sm:px-2 text-center">
                    <span className="text-xs sm:text-sm font-semibold text-gray-800 dark:text-gray-200 group-hover:text-[#1F6B45] dark:group-hover:text-orange-400 transition-colors line-clamp-2">
                      {food.name}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 sm:py-16">
              {searching ? (
                <>
                  <Loader2 className="h-12 w-12 sm:h-16 sm:w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4 animate-spin" />
                  <p className="text-gray-600 dark:text-gray-400 text-base sm:text-lg font-semibold">Searching...</p>
                </>
              ) : !searchValue.trim() ? (
                <>
                  <Search className="h-12 w-12 sm:h-16 sm:w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-600 dark:text-gray-400 text-base sm:text-lg font-semibold">
                    Type a dish or restaurant name
                  </p>
                  <p className="text-sm sm:text-base text-gray-500 dark:text-gray-500 mt-2">
                    Results appear as you type
                  </p>
                </>
              ) : !zoneId ? (
                <>
                  <Search className="h-12 w-12 sm:h-16 sm:w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-600 dark:text-gray-400 text-base sm:text-lg font-semibold">
                    Set your delivery location to search
                  </p>
                  <p className="text-sm sm:text-base text-gray-500 dark:text-gray-500 mt-2">
                    We search restaurants that deliver to you
                  </p>
                </>
              ) : (
                <>
                  <Search className="h-12 w-12 sm:h-16 sm:w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-600 dark:text-gray-400 text-base sm:text-lg font-semibold">
                    No results found for "{searchValue}"
                  </p>
                  <p className="text-sm sm:text-base text-gray-500 dark:text-gray-500 mt-2">
                    Try a different search term
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes slideDown {
            from {
              opacity: 0;
              transform: translateY(-20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes slideUp {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes scaleIn {
            from {
              opacity: 0;
              transform: scale(0.9);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}</style>
    </div>
  )
}
