import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Search, Clock, RotateCcw, Loader2, Mic, X, Sparkles } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { restaurantAPI } from "@food/api"
import cloudinaryImages from "@food/constants/cloudinaryImages.json"

const SEARCH_HISTORY_KEY = "user_recent_searches_v1"

const THINK_IT_TAGS = [
  { label: "Desk-friendly options", query: "Desk friendly" },
  { label: "Crunchy and crispy", query: "Crispy" },
  { label: "Guilt-free treats", query: "Healthy" },
  { label: "Late night cravings", query: "Fast food" },
  { label: "Sweet tooth", query: "Desserts" },
]

const WHATS_ON_YOUR_MIND_ITEMS = [
  { name: "Biryani", image: cloudinaryImages.biryani_clean, query: "Biryani" },
  { name: "Thali", image: cloudinaryImages.thali, query: "Thali" },
  { name: "Sandwich", image: cloudinaryImages.sandwich, query: "Sandwich" },
  { name: "Beverages", image: cloudinaryImages.food, query: "Beverages" },
  { name: "Burger", image: cloudinaryImages.burger, query: "Burger" },
  { name: "Rolls", image: cloudinaryImages.rolls, query: "Rolls" },
  { name: "Pizza", image: cloudinaryImages.pizza, query: "Pizza" },
  { name: "Tea", image: cloudinaryImages.hotel, query: "Tea" },
  { name: "Veg Meal", image: cloudinaryImages.thali, query: "Veg Meal" },
  { name: "Paneer", image: cloudinaryImages.paneer, query: "Paneer" },
  { name: "Cold Coffee", image: cloudinaryImages.food, query: "Cold Coffee" },
  { name: "North Indian", image: cloudinaryImages.north_indian, query: "North Indian" },
  { name: "Cake", image: cloudinaryImages.cake, query: "Cake" },
  { name: "Noodles", image: cloudinaryImages.noodles, query: "Noodles" },
  { name: "Chole Bhature", image: cloudinaryImages.chole_bhature, query: "Chole Bhature" },
  { name: "Dosa", image: cloudinaryImages.dosa, query: "Dosa" },
  { name: "Momos", image: cloudinaryImages.momos, query: "Momos" },
  { name: "Paratha", image: cloudinaryImages.paratha, query: "Paratha" },
]

export default function SearchOverlay({ isOpen, onClose, searchValue, onSearchChange, isListening, startVoiceSearch }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [allFoods, setAllFoods] = useState([])
  const [filteredFoods, setFilteredFoods] = useState([])
  const [recentSuggestions, setRecentSuggestions] = useState([])
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
        if (Array.isArray(parsed)) {
          setRecentSuggestions(parsed.filter((item) => typeof item === "string" && item.trim()).slice(0, 8))
          return
        }
      } catch {
        // Ignore parse errors
      }
      setRecentSuggestions([])
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

    const fetchDishesFromDB = async () => {
      setLoadingFoods(true)
      try {
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
            image: getImageUrl(dish?.image),
          }))

        setAllFoods(normalized)
      } catch {
        setAllFoods([])
      } finally {
        setLoadingFoods(false)
      }
    }

    loadRecentSuggestions()
    fetchDishesFromDB()
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

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col bg-white dark:bg-[#0a0a0a] transition-all duration-200">
      {/* Top Header Row with Arrow Left & Title */}
      <div className="flex-shrink-0 bg-white dark:bg-[#121212] px-4 pt-3 pb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          className="p-2 -ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200 transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="h-6 w-6 stroke-[2.2]" />
        </button>

        <span className="text-base sm:text-lg font-bold text-gray-800 dark:text-white tracking-tight">
          Search for tasty & budget meals
        </span>

        <div className="w-8" />
      </div>

      {/* Green Pill Search Input Bar */}
      <div className="flex-shrink-0 px-4 py-2 bg-white dark:bg-[#121212]">
        <div className="max-w-3xl mx-auto w-full">
          <form onSubmit={handleSearchSubmit} className="relative flex items-center">
            <input
              ref={inputRef}
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search, Order, Repeat"
              className="w-full h-12 sm:h-13 px-5 pr-12 bg-white dark:bg-[#1a1a1a] border-2 border-[#16a34a] focus:border-[#15803d] rounded-full text-base font-medium text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-xs transition-all outline-none"
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

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto max-w-3xl mx-auto w-full px-4 sm:px-6 py-4 scrollbar-hide">
        {searchValue.trim() === "" ? (
          <>
            {/* "RECENTLY SEARCHED RESTAURANTS" Section */}
            {recentSuggestions.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs font-black uppercase tracking-wider text-gray-500 dark:text-gray-400 shrink-0">
                    RECENTLY SEARCHED RESTAURANTS
                  </span>
                  <div className="flex-1 h-[1px] bg-gray-200 dark:bg-gray-800" />
                  <button
                    type="button"
                    onClick={clearRecentSearches}
                    className="text-xs font-bold text-rose-500 dark:text-rose-400 hover:underline shrink-0"
                  >
                    Clear
                  </button>
                </div>

                <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-1">
                  {recentSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-neutral-900 text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-200 hover:border-[#16a34a] transition-all shadow-2xs hover:shadow-xs active:scale-95"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-gray-400 shrink-0 stroke-[2.5]" />
                      <span className="truncate max-w-[160px]">{suggestion}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* "Think it, search it" Section */}
            <div className="mb-6">
              <h3 className="text-sm sm:text-base font-bold italic text-rose-500 dark:text-rose-400 mb-3 tracking-wide font-serif">
                Think it, search it
              </h3>

              <div className="flex gap-2 sm:gap-2.5 overflow-x-auto scrollbar-hide pb-1">
                {THINK_IT_TAGS.map((tag) => (
                  <button
                    key={tag.label}
                    type="button"
                    onClick={() => handleSuggestionClick(tag.query)}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-neutral-900 hover:border-gray-300 dark:hover:border-gray-700 text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-300 transition-all shadow-2xs hover:shadow-xs active:scale-95"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                    <span>{tag.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* "WHAT'S ON YOUR MIND?" Section */}
            <div>
              <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-5">
                WHAT'S ON YOUR MIND?
              </h3>

              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-y-7 gap-x-4">
                {WHATS_ON_YOUR_MIND_ITEMS.map((item) => (
                  <div
                    key={item.name}
                    onClick={() => handleSuggestionClick(item.query)}
                    className="flex flex-col items-center cursor-pointer group"
                  >
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-white dark:bg-neutral-900 border border-gray-100 dark:border-gray-800 shadow-xs p-1 flex items-center justify-center transition-transform duration-300 group-hover:scale-105">
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-full h-full object-cover rounded-full"
                        loading="lazy"
                      />
                    </div>
                    <span className="mt-2 text-xs sm:text-sm font-bold text-gray-900 dark:text-gray-100 group-hover:text-[#16a34a] transition-colors text-center line-clamp-1">
                      {item.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          /* Live Search Results */
          <div>
            <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-4">
              Search Results ({filteredFoods.length})
            </h3>

            {filteredFoods.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-y-6 gap-x-4">
                {filteredFoods.map((food) => (
                  <div
                    key={food.id}
                    onClick={() => handleSuggestionClick(food.name)}
                    className="flex flex-col items-center cursor-pointer group"
                  >
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-white dark:bg-neutral-900 border border-gray-100 dark:border-gray-800 shadow-xs p-1 flex items-center justify-center transition-transform duration-300 group-hover:scale-105">
                      {food.image ? (
                        <img
                          src={food.image}
                          alt={food.name}
                          className="w-full h-full object-cover rounded-full"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                          <Search className="h-5 w-5 text-gray-400" />
                        </div>
                      )}
                    </div>
                    <span className="mt-2 text-xs font-bold text-gray-900 dark:text-gray-100 group-hover:text-[#16a34a] transition-colors text-center line-clamp-1">
                      {food.name}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                {loadingFoods ? (
                  <>
                    <Loader2 className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3 animate-spin" />
                    <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">Searching dishes...</p>
                  </>
                ) : (
                  <>
                    <Search className="h-12 w-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-700 dark:text-gray-300 text-base font-bold">
                      No results found for "{searchValue}"
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      Try searching for Biryani, Pizza, Burger, or Thali
                    </p>
                  </>
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
