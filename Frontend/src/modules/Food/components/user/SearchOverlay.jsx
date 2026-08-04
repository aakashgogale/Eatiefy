import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, RotateCcw, Loader2, Mic, X, Search } from "lucide-react"
import { restaurantAPI } from "@food/api"

const SEARCH_HISTORY_KEY = "user_recent_searches_v1"

export default function SearchOverlay({ isOpen, onClose, searchValue, onSearchChange, isListening, startVoiceSearch }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [allFoods, setAllFoods] = useState([])
  const [filteredFoods, setFilteredFoods] = useState([])
  const [recentSuggestions, setRecentSuggestions] = useState([])
  const [dynamicPopularRestaurants, setDynamicPopularRestaurants] = useState([])
  const [loadingFoods, setLoadingFoods] = useState(false)

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const loadRecentSuggestions = () => {
      try {
        const raw = localStorage.getItem(SEARCH_HISTORY_KEY)
        const parsed = raw ? JSON.parse(raw) : []
        if (Array.isArray(parsed) && parsed.length > 0) {
          setRecentSuggestions(parsed.filter((item) => typeof item === "string" && item.trim()).slice(0, 8))
          return
        }
      } catch {
        // Ignore parse errors
      }
      setRecentSuggestions([])
    }

    const fetchDynamicDataFromDB = async () => {
      setLoadingFoods(true)
      try {
        // Fetch dishes for live search
        const dishesRes = await restaurantAPI.getPublicDishes({ limit: 800 })
        const dishes =
          dishesRes?.data?.data?.dishes ||
          dishesRes?.data?.dishes ||
          []

        const normalized = (Array.isArray(dishes) ? dishes : [])
          .filter((dish) => dish?.name)
          .map((dish, index) => ({
            id: dish?.id || dish?._id || `dish-${index}`,
            name: String(dish.name).trim(),
            image: typeof dish.image === "string" ? dish.image : (dish.image?.url || ""),
          }))

        setAllFoods(normalized)

        // Fetch real dynamic restaurants from backend database for recent/popular fallback
        const restRes = await restaurantAPI.getPublicRestaurants({ limit: 10 })
        const restList =
          restRes?.data?.data?.restaurants ||
          restRes?.data?.restaurants ||
          []

        const restNames = restList
          .map((r) => r.name || r.restaurantName)
          .filter(Boolean)
          .slice(0, 8)

        if (restNames.length > 0) {
          setDynamicPopularRestaurants(restNames)
        } else {
          // Fallback to top dish names from DB if restaurant list empty
          const topDishNames = normalized.map((d) => d.name).slice(0, 6)
          setDynamicPopularRestaurants(topDishNames)
        }
      } catch {
        setAllFoods([])
        setDynamicPopularRestaurants([])
      } finally {
        setLoadingFoods(false)
      }
    }

    loadRecentSuggestions()
    fetchDynamicDataFromDB()
  }, [isOpen])

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

  useEffect(() => {
    if (searchValue.trim() === "") {
      setFilteredFoods(allFoods)
    } else {
      const filtered = allFoods.filter((food) =>
        food.name.toLowerCase().includes(searchValue.toLowerCase())
      )
      setFilteredFoods(filtered)
    }
  }, [searchValue, allFoods])

  const saveRecentSearch = (term) => {
    const value = String(term || "").trim()
    if (!value) return

    setRecentSuggestions((prev) => {
      const next = [value, ...prev.filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(0, 8)
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }

  const clearRecentSearches = () => {
    localStorage.removeItem(SEARCH_HISTORY_KEY)
    setRecentSuggestions([])
  }

  const handleSuggestionClick = (suggestion) => {
    saveRecentSearch(suggestion)
    navigate(`/food/user/search?q=${encodeURIComponent(suggestion.trim())}`)
    onClose()
    onSearchChange("")
  }

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (searchValue.trim()) {
      saveRecentSearch(searchValue)
      navigate(`/food/user/search?q=${encodeURIComponent(searchValue.trim())}`)
      onClose()
      onSearchChange("")
    }
  }

  if (!isOpen) return null

  // Combine user real search history or dynamic database fallback items
  const activeDisplaySuggestions =
    recentSuggestions.length > 0 ? recentSuggestions : dynamicPopularRestaurants

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col justify-start bg-white dark:bg-[#0a0a0a] transition-all duration-200 overflow-hidden">
      {/* Top Header Bar starting directly at Top */}
      <div className="flex-shrink-0 bg-white dark:bg-[#121212] px-4 pt-4 pb-3 flex items-center justify-between border-b border-gray-100 dark:border-gray-800/80 shadow-2xs">
        <button
          type="button"
          onClick={onClose}
          className="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200 transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="h-6 w-6 stroke-[2.5]" />
        </button>

        <span className="text-base sm:text-lg font-bold text-gray-900 dark:text-white tracking-tight">
          Search for tasty & budget meals
        </span>

        <div className="w-8" />
      </div>

      {/* Green Pill Search Input Bar */}
      <div className="flex-shrink-0 px-4 py-3 bg-white dark:bg-[#121212]">
        <div className="max-w-3xl mx-auto w-full">
          <form onSubmit={handleSearchSubmit} className="relative flex items-center">
            <input
              ref={inputRef}
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search, Order, Repeat"
              className="w-full h-12 sm:h-13 px-5 pr-12 bg-white dark:bg-[#1a1a1a] border-2 border-[#16a34a] focus:border-[#15803d] rounded-full text-base sm:text-lg font-medium text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-xs transition-all outline-none"
            />

            {searchValue ? (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute right-4 p-1 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={startVoiceSearch}
                className={`absolute right-3.5 p-2 rounded-full transition-all ${
                  isListening
                    ? "bg-[#16a34a] text-white animate-pulse"
                    : "text-[#16a34a] hover:bg-green-50 dark:hover:bg-green-950/40"
                }`}
                aria-label="Voice Search"
              >
                <Mic className="h-5 w-5" />
              </button>
            )}
          </form>
        </div>
      </div>

      {/* Content Area starting right below Header */}
      <div className="flex-1 overflow-y-auto max-w-3xl mx-auto w-full px-4 sm:px-6 py-3 scrollbar-hide">
        {searchValue.trim() === "" ? (
          /* DYNAMIC RECENTLY SEARCHED RESTAURANTS Section */
          activeDisplaySuggestions.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-3 mb-3.5">
                <span className="text-xs font-black uppercase tracking-wider text-gray-500 dark:text-gray-400 shrink-0">
                  {recentSuggestions.length > 0 ? "RECENTLY SEARCHED RESTAURANTS" : "POPULAR RESTAURANTS & DISHES"}
                </span>
                <div className="flex-1 h-[1px] bg-gray-200 dark:bg-gray-800" />
                {recentSuggestions.length > 0 && (
                  <button
                    type="button"
                    onClick={clearRecentSearches}
                    className="text-xs font-bold text-rose-500 dark:text-rose-400 hover:underline shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Horizontal Scroll Chips */}
              <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-2">
                {activeDisplaySuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-neutral-900 text-xs sm:text-sm font-semibold text-gray-800 dark:text-gray-200 hover:border-[#16a34a] transition-all shadow-2xs hover:shadow-xs active:scale-95"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-gray-400 shrink-0 stroke-[2.5]" />
                    <span className="truncate max-w-[180px]">{suggestion}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        ) : (
          /* Live Dynamic Search Results when typing */
          <div className="mt-2">
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-3">
              Search Results ({filteredFoods.length})
            </h3>

            {filteredFoods.length > 0 ? (
              <div className="flex flex-col gap-2">
                {filteredFoods.map((food) => (
                  <div
                    key={food.id}
                    onClick={() => handleSuggestionClick(food.name)}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                  >
                    <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 shrink-0 overflow-hidden flex items-center justify-center">
                      {food.image ? (
                        <img src={food.image} alt={food.name} className="w-full h-full object-cover" />
                      ) : (
                        <Search className="h-4 w-4 text-gray-400" />
                      )}
                    </div>
                    <span className="text-sm font-bold text-gray-900 dark:text-white flex-1">
                      {food.name}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                {loadingFoods ? (
                  <Loader2 className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto animate-spin" />
                ) : (
                  <p className="text-sm font-bold text-gray-500">No results found for "{searchValue}"</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Voice Search Modal */}
      {isListening && (
        <div className="absolute inset-0 z-[10000] flex flex-col items-center justify-center bg-white/95 dark:bg-[#0a0a0a]/95 backdrop-blur-md">
          <div className="relative flex items-center justify-center">
            <div className="absolute w-40 h-40 bg-emerald-500/20 rounded-full animate-ping" />
            <div className="absolute w-32 h-32 bg-emerald-500/30 rounded-full animate-pulse" />

            <div className="relative bg-gradient-to-tr from-[#16a34a] to-emerald-400 p-8 rounded-full text-white shadow-xl border-4 border-white dark:border-gray-800">
              <Mic className="h-12 w-12" />
            </div>
          </div>

          <div className="mt-16 text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Speak Now</h2>
            <p className="mt-2 text-gray-500 dark:text-gray-400 text-sm font-medium">Listening for dishes or restaurants...</p>
          </div>

          <Button
            variant="ghost"
            onClick={onClose}
            className="mt-12 text-gray-400 hover:text-[#16a34a] rounded-full px-8"
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
