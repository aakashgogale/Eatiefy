import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { X, Search, Clock, Loader2, Mic } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { searchAPI } from "@/services/api"
import { useVoiceSearch } from "@food/hooks/useVoiceSearch"

const SEARCH_HISTORY_KEY = "user_recent_searches_v1"

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
  const inputRef = useRef(null)
  const [allFoods, setAllFoods] = useState([])
  const [filteredFoods, setFilteredFoods] = useState([])
  const [recentSuggestions, setRecentSuggestions] = useState([])
  const [loadingFoods, setLoadingFoods] = useState(false)

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

  useEffect(() => {
    if (!isOpen) return

    const term = searchValue.trim()
    if (!term) {
      setAllFoods([])
      setFilteredFoods([])
      setLoadingFoods(false)
      return
    }

    const timer = setTimeout(async () => {
      setLoadingFoods(true)
      try {
        const res = await searchAPI.unifiedSearch({ q: term, limit: 40 })
        const results = res.data?.data?.restaurants || []
        const normalized = results
          .filter((item) => item?.matchedDish || item?.matchType === "food")
          .map((item, index) => ({
            id: item.matchedDishId || item._id || `dish-${index}`,
            name: item.matchedDish || item.restaurantName || item.name,
            image: getImageUrl(item.matchedDishImage || item.profileImage || item.image),
          }))

        setAllFoods(normalized)
        setFilteredFoods(normalized)
      } catch {
        setAllFoods([])
        setFilteredFoods([])
      } finally {
        setLoadingFoods(false)
      }
    }, 400)

    return () => clearTimeout(timer)
  }, [isOpen, searchValue])

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
    onSearchChange(suggestion)
    inputRef.current?.focus()
  }

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (searchValue.trim()) {
      saveRecentSearch(searchValue)
      navigate(`/food/user/search?q=${encodeURIComponent(searchValue.trim())}&mode=delivery`)
      onClose()
      onSearchChange("")
    }
  }

  const handleFoodClick = (food) => {
    saveRecentSearch(food.name)
    navigate(`/food/user/search?q=${encodeURIComponent(food.name)}&mode=delivery`)
    onClose()
    onSearchChange("")
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-white dark:bg-[#0a0a0a]"
      style={{
        animation: 'fadeIn 0.3s ease-out'
      }}
    >
      {/* Header with Search Bar */}
      <div className="flex-shrink-0 bg-white dark:bg-[#1a1a1a] border-b border-gray-100 dark:border-gray-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-5 top-1/2 transform -translate-y-1/2 h-5 w-5 text-[#DC2626] dark:text-[#F87171] z-10" strokeWidth={2.5} />
              <Input
                ref={inputRef}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search dishes or restaurants"
                className="pl-14 pr-16 h-13 w-full bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800 focus:ring-2 focus:ring-[#DC2626]/20 focus:border-[#DC2626] dark:focus:border-[#DC2626] rounded-2xl text-base dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-sm transition-all duration-200"
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
                    className="p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-[#DC2626] dark:text-[#F87171] transition-all active:scale-90"
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

      <div className="flex-1 overflow-y-auto max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 scrollbar-hide bg-white dark:bg-[#0a0a0a]">
        {/* Suggestions Row */}
        <div
          className="mb-6"
          style={{
            animation: 'slideDown 0.3s ease-out 0.1s both'
          }}
        >
          <h3 className="text-sm sm:text-base font-semibold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-[#DC2626]" />
            Recent Searches
          </h3>
          <div className="flex gap-2 sm:gap-3 flex-wrap">
            {recentSuggestions.slice(0, 8).map((suggestion, index) => (
              <button
                key={suggestion}
                onClick={() => handleSuggestionClick(suggestion)}
                className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30 border border-orange-200 dark:border-orange-800 hover:border-orange-300 dark:hover:border-orange-700 text-gray-700 dark:text-gray-300 hover:text-[#DC2626] dark:hover:text-orange-400 transition-all duration-200 text-xs sm:text-sm font-medium shadow-sm hover:shadow-md"
                style={{
                  animation: `scaleIn 0.3s ease-out ${0.1 + index * 0.02}s both`
                }}
              >
                <Clock className="h-3 w-3 sm:h-4 sm:w-4 text-[#DC2626] flex-shrink-0" />
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
            {searchValue.trim() === "" ? "Start typing to search dishes" : `Search Results (${filteredFoods.length})`}
          </h3>
          {filteredFoods.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 sm:gap-4 md:gap-5 lg:gap-6">
              {filteredFoods.map((food, index) => (
                <div
                  key={food.id}
                  className="flex flex-col items-center gap-2 sm:gap-3 cursor-pointer group"
                  style={{
                    animation: `slideUp 0.3s ease-out ${0.25 + 0.05 * (index % 12)}s both`
                  }}
                  onClick={() => handleFoodClick(food)}
                >
                  <div className="relative w-full aspect-square rounded-full overflow-hidden transition-all duration-200 shadow-md group-hover:shadow-lg bg-white dark:bg-[#1a1a1a] p-1 sm:p-1.5">
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
                  <div className="px-1 sm:px-2 text-center">
                    <span className="text-xs sm:text-sm font-semibold text-gray-800 dark:text-gray-200 group-hover:text-[#DC2626] dark:group-hover:text-orange-400 transition-colors line-clamp-2">
                      {food.name}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 sm:py-16">
              {loadingFoods ? (
                <>
                  <Loader2 className="h-12 w-12 sm:h-16 sm:w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4 animate-spin" />
                  <p className="text-gray-600 dark:text-gray-400 text-base sm:text-lg font-semibold">Loading dishes from database...</p>
                </>
              ) : (
                <>
                  <Search className="h-12 w-12 sm:h-16 sm:w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-600 dark:text-gray-400 text-base sm:text-lg font-semibold">
                    {searchValue.trim() ? `No results found for "${searchValue}"` : "No dishes found in database"}
                  </p>
                  <p className="text-sm sm:text-base text-gray-500 dark:text-gray-500 mt-2">
                    {searchValue.trim() ? "Try a different search term" : "Type a dish name to see matching results"}
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
