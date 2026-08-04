import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, RotateCcw, Loader2, Mic, X, Search } from "lucide-react"
import { restaurantAPI } from "@food/api"

const SEARCH_HISTORY_KEY = "user_recent_searches_v1"
const DEFAULT_RECENT_RESTAURANTS = [
  "Apna Eggless By...",
  "Mahakal Chat Cor...",
  "La Pino'z Pizza",
  "Hyderabadi Biryani"
]

export default function SearchOverlay({ isOpen, onClose, searchValue, onSearchChange, isListening, startVoiceSearch }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [allFoods, setAllFoods] = useState([])
  const [filteredFoods, setFilteredFoods] = useState([])
  const [recentSuggestions, setRecentSuggestions] = useState(DEFAULT_RECENT_RESTAURANTS)
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
      setRecentSuggestions(DEFAULT_RECENT_RESTAURANTS)
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
            image: typeof dish.image === "string" ? dish.image : (dish.image?.url || ""),
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
    <div className="fixed inset-0 z-[9999] flex flex-col justify-end sm:justify-start bg-black/50 backdrop-blur-xs transition-all duration-300">
      {/* Background Click to Dismiss */}
      <div className="absolute inset-0 z-0" onClick={onClose} />

      {/* Main Bottom Sheet / Search Modal Container */}
      <div className="relative z-10 w-full max-w-3xl mx-auto bg-white dark:bg-[#121212] rounded-t-[32px] sm:rounded-b-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-transform duration-300">
        
        {/* Top Header Bar */}
        <div className="flex-shrink-0 px-5 pt-4 pb-3 flex items-center justify-between border-b border-gray-100 dark:border-gray-800/80">
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
        <div className="flex-shrink-0 px-5 py-3">
          <form onSubmit={handleSearchSubmit} className="relative flex items-center">
            <input
              ref={inputRef}
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search, Order, Repeat"
              className="w-full h-12 sm:h-13 px-6 pr-12 bg-white dark:bg-[#1a1a1a] border-2 border-[#16a34a] focus:border-[#15803d] rounded-full text-base sm:text-lg font-medium text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-xs transition-all outline-none"
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

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto px-5 pb-6 scrollbar-hide">
          {searchValue.trim() === "" ? (
            /* RECENTLY SEARCHED RESTAURANTS Section */
            <div className="mt-2">
              <div className="flex items-center gap-3 mb-3.5">
                <span className="text-xs font-black uppercase tracking-wider text-gray-500 dark:text-gray-400 shrink-0">
                  RECENTLY SEARCHED RESTAURANTS
                </span>
                <div className="flex-1 h-[1px] bg-gray-200 dark:bg-gray-800" />
              </div>

              <div className="flex gap-2.5 overflow-x-auto scrollbar-hide pb-2">
                {recentSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-neutral-900 text-xs sm:text-sm font-semibold text-gray-800 dark:text-gray-200 hover:border-[#16a34a] transition-all shadow-2xs hover:shadow-xs active:scale-95"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-gray-400 shrink-0 stroke-[2.5]" />
                    <span className="truncate max-w-[170px]">{suggestion}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Live Search Results when typing */
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
      </div>
    </div>
  )
}
