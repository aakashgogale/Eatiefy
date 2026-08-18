import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, RotateCcw, Loader2, Mic, X, Search } from "lucide-react"
import { restaurantAPI } from "@food/api"

const SEARCH_HISTORY_KEY = "user_recent_searches_v1"
const DEFAULT_RECENT = [
  "Apna Eggless By...",
  "Mahakal Chat Cor...",
  "La Pino'z Pizza",
  "Hyderabadi Biryani"
]

export default function SearchOverlay({ isOpen, onClose, searchValue, onSearchChange, isListening, startVoiceSearch }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const openedAtRef = useRef(0)
  const [allFoods, setAllFoods] = useState([])
  const [filteredFoods, setFilteredFoods] = useState([])
  const [recentSuggestions, setRecentSuggestions] = useState(DEFAULT_RECENT)
  const [loadingFoods, setLoadingFoods] = useState(false)

  useEffect(() => {
    if (isOpen) {
      openedAtRef.current = Date.now()
      if (inputRef.current) {
        setTimeout(() => inputRef.current?.focus(), 100)
      }
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
      setRecentSuggestions(DEFAULT_RECENT)
    }

    const fetchDynamicDataFromDB = async () => {
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
    setRecentSuggestions(DEFAULT_RECENT)
  }

  const handleBackdropClick = (e) => {
    e.stopPropagation()
    if (Date.now() - openedAtRef.current < 350) return
    onClose()
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
    <div className="fixed inset-0 z-[9999] bg-black/40 backdrop-blur-xs flex flex-col justify-start transition-all duration-200">
      {/* Dimmed Backdrop Click to Dismiss */}
      <div className="absolute inset-0 z-0" onClick={handleBackdropClick} />

      {/* Top Drawer Search Popup (Full Width Top/Left/Right, Compact Height, Rounded Bottom) */}
      <div 
        className="relative z-10 w-full max-w-4xl mx-auto bg-white dark:bg-[#121212] rounded-b-3xl shadow-2xl border-b border-gray-100 dark:border-gray-800 overflow-hidden flex flex-col max-h-[42vh] sm:max-h-[360px] transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className="flex-shrink-0 px-4 pt-3.5 pb-2 flex items-center justify-between border-b border-gray-100 dark:border-gray-800/80">
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -ml-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200 transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5 stroke-[2.5]" />
          </button>

          <span className="text-sm sm:text-base font-bold text-gray-900 dark:text-white tracking-tight">
            Search for tasty & budget meals
          </span>

          <div className="w-7" />
        </div>

        {/* Green Pill Search Input Bar */}
        <div className="flex-shrink-0 px-4 py-2.5 bg-white dark:bg-[#121212]">
          <form onSubmit={handleSearchSubmit} className="relative flex items-center">
            <input
              ref={inputRef}
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search, Order, Repeat"
              className="w-full h-11 px-4 pr-11 bg-white dark:bg-[#1a1a1a] border-2 border-[#16a34a] focus:border-[#15803d] rounded-full text-sm font-medium text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-2xs transition-all outline-none"
            />

            {searchValue ? (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                className="absolute right-3.5 p-1 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={startVoiceSearch}
                className={`absolute right-3.5 p-1.5 rounded-full transition-all ${
                  isListening
                    ? "bg-[#16a34a] text-white animate-pulse"
                    : "text-[#16a34a] hover:bg-green-50 dark:hover:bg-green-950/40"
                }`}
                aria-label="Voice Search"
              >
                <Mic className="h-4.5 w-4.5" />
              </button>
            )}
          </form>
        </div>

        {/* Scrollable Content inside Popup */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 scrollbar-hide">
          {searchValue.trim() === "" ? (
            /* RECENTLY SEARCHED RESTAURANTS Section */
            <div className="mt-1">
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className="text-[11px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400 shrink-0">
                  RECENTLY SEARCHED RESTAURANTS
                </span>
                <div className="flex-1 h-[1px] bg-gray-200 dark:bg-gray-800" />
                {recentSuggestions.length > 0 && (
                  <button
                    type="button"
                    onClick={clearRecentSearches}
                    className="text-[11px] font-bold text-rose-500 dark:text-rose-400 hover:underline shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Horizontal Scroll Chips */}
              <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                {recentSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-neutral-900 text-xs font-semibold text-gray-800 dark:text-gray-200 hover:border-[#16a34a] transition-all shadow-2xs active:scale-95"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-gray-400 shrink-0 stroke-[2.5]" />
                    <span className="truncate max-w-[150px]">{suggestion}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Live Search Results when typing */
            <div className="mt-1">
              <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2">
                Search Results ({filteredFoods.length})
              </h3>

              {filteredFoods.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {filteredFoods.map((food) => (
                    <div
                      key={food.id}
                      onClick={() => handleSuggestionClick(food.name)}
                      className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 shrink-0 overflow-hidden flex items-center justify-center">
                        {food.image ? (
                          <img src={food.image} alt={food.name} className="w-full h-full object-cover"  loading="lazy" decoding="async" />
                        ) : (
                          <Search className="h-3.5 w-3.5 text-gray-400" />
                        )}
                      </div>
                      <span className="text-xs font-bold text-gray-900 dark:text-white flex-1">
                        {food.name}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6">
                  {loadingFoods ? (
                    <Loader2 className="h-6 w-6 text-gray-300 dark:text-gray-600 mx-auto animate-spin" />
                  ) : (
                    <p className="text-xs font-bold text-gray-500">No results found for "{searchValue}"</p>
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
