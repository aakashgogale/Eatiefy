import { useEffect, useRef, useState } from "react"
import { Loader2, MapPin, Search, X } from "lucide-react"
import { toast } from "sonner"
import {
  ensureGoogleMapsPlacesLoaded,
  fetchPlaceSuggestions,
  resolvePlaceSuggestion,
} from "@food/utils/googlePlaces"

const DEBOUNCE_MS = 350
const MIN_QUERY_LENGTH = 3

export default function LocationSearchInput({
  label = "Search location",
  placeholder = "Search area, street, landmark...",
  onLocationSelect,
  biasLocation = null,
  className = "",
  dropdownClassName = "",
}) {
  const inputRef = useRef(null)
  const skipSearchRef = useRef(false)
  const selectionLockRef = useRef(false)
  const activeRequestRef = useRef(0)
  const biasLocationRef = useRef(biasLocation)

  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState([])
  const [googleMapsLoaded, setGoogleMapsLoaded] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ensureGoogleMapsPlacesLoaded()
      .then(() => {
        if (!cancelled) setGoogleMapsLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setGoogleMapsLoaded(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    biasLocationRef.current = biasLocation
  }, [biasLocation])

  useEffect(() => {
    const trimmed = String(query || "").trim()

    if (skipSearchRef.current) {
      skipSearchRef.current = false
      return
    }

    if (selectionLockRef.current) {
      return
    }

    if (!googleMapsLoaded || trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([])
      setDropdownOpen(false)
      setIsSearching(false)
      return
    }

    const requestId = ++activeRequestRef.current

    const timer = setTimeout(async () => {
      try {
        setIsSearching(true)
        const bias = biasLocationRef.current
        const results = await fetchPlaceSuggestions(trimmed, {
          latitude: bias?.latitude,
          longitude: bias?.longitude,
        })

        if (requestId !== activeRequestRef.current) return
        if (selectionLockRef.current) return

        setSuggestions(results)
        setDropdownOpen(results.length > 0)
      } catch {
        if (requestId !== activeRequestRef.current) return
        setSuggestions([])
        setDropdownOpen(false)
      } finally {
        if (requestId === activeRequestRef.current) {
          setIsSearching(false)
        }
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, googleMapsLoaded])

  const closeDropdown = () => {
    activeRequestRef.current += 1
    setDropdownOpen(false)
    setSuggestions([])
    setIsSearching(false)
  }

  const handleQueryChange = (value) => {
    selectionLockRef.current = false
    setQuery(value)
    if (!String(value || "").trim()) {
      closeDropdown()
    }
  }

  const handleClear = () => {
    skipSearchRef.current = true
    selectionLockRef.current = false
    setQuery("")
    closeDropdown()
    inputRef.current?.focus()
  }

  const handleSelectSuggestion = async (suggestion) => {
    closeDropdown()
    selectionLockRef.current = true
    inputRef.current?.blur()

    try {
      setIsResolving(true)
      const location = await resolvePlaceSuggestion(suggestion)

      skipSearchRef.current = true
      setQuery(suggestion.mainText || suggestion.display || location.formattedAddress || "")

      onLocationSelect?.(location)
    } catch (error) {
      console.error("[LocationSearchInput] resolve failed:", error)
      selectionLockRef.current = false
      toast.error("Failed to load selected location. Please try again.")
    } finally {
      setIsResolving(false)
    }
  }

  const showDropdown = dropdownOpen && suggestions.length > 0 && !isResolving

  return (
    <div className={`relative ${className}`}>
      {label ? (
        <label className="text-xs font-bold text-gray-700 block mb-1.5 uppercase tracking-wide">
          {label}
        </label>
      ) : null}

      <div className="relative shadow-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => {
            if (!selectionLockRef.current && suggestions.length > 0 && !isResolving) {
              setDropdownOpen(true)
            }
          }}
          placeholder={googleMapsLoaded ? placeholder : "Loading search..."}
          disabled={!googleMapsLoaded || isResolving}
          className="w-full pl-10 pr-10 py-3 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#B80B3D]/30 focus:border-[#B80B3D] disabled:opacity-60"
        />
        {query && !isSearching && !isResolving ? (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-gray-100 text-gray-400"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
        {(isSearching || isResolving) && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B80B3D] animate-spin" />
        )}
      </div>

      {showDropdown && (
        <div
          className={`absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden z-[200] ${dropdownClassName}`}
        >
          <p className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-50">
            Nearby & matching places
          </p>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleSelectSuggestion(suggestion)
              }}
              className="w-full px-4 py-3 flex items-start gap-3 hover:bg-[#B80B3D]/5 transition-colors text-left border-b border-gray-50 last:border-none"
            >
              <MapPin className="w-4 h-4 text-[#B80B3D] mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {suggestion.mainText || suggestion.display}
                </p>
                {suggestion.secondaryText ? (
                  <p className="text-xs text-gray-500 truncate">{suggestion.secondaryText}</p>
                ) : suggestion.display && suggestion.display !== suggestion.mainText ? (
                  <p className="text-xs text-gray-500 truncate">{suggestion.display}</p>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
