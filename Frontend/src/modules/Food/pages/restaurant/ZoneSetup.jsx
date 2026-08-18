import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { MapPin, Search, Save, Loader2, ArrowLeft } from "lucide-react"
import RestaurantNavbar from "@food/components/restaurant/RestaurantNavbar"
import { restaurantAPI } from "@food/api"
import { reverseGeocodeWithGoogle } from "@food/utils/googleGeocoding"
import {
  buildRestaurantLocationUpdatePayload,
  dispatchRestaurantLocationUpdated,
  formatRestaurantDisplayAddress,
  normalizeRestaurantLocationFields,
} from "@food/utils/restaurantLocation"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"
import { Loader } from "@googlemaps/js-api-loader"
import { toast } from "sonner"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => console.error("[ZoneSetup]", ...args)

const parseCoordinate = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const getSavedLocationCoords = (location) => {
  if (!location) return null

  let lat = null
  let lng = null

  if (Array.isArray(location.coordinates) && location.coordinates.length >= 2) {
    lng = parseCoordinate(location.coordinates[0])
    lat = parseCoordinate(location.coordinates[1])
  }

  if (lat === null || lng === null) {
    lat = parseCoordinate(location.latitude)
    lng = parseCoordinate(location.longitude)
  }

  if (lat === null || lng === null) return null

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    const swappedLat = lng
    const swappedLng = lat

    if (
      swappedLat >= -90 && swappedLat <= 90 &&
      swappedLng >= -180 && swappedLng <= 180
    ) {
      return { lat: swappedLat, lng: swappedLng }
    }

    return null
  }

  return { lat, lng }
}

export default function ZoneSetup() {
  const navigate = useNavigate()
  const goBack = useRestaurantBackNavigation()
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markerRef = useRef(null)
  const sessionTokenRef = useRef(null)
  const debounceRef = useRef(null)
  const geocodeDebounceRef = useRef(null)
  const locationRef = useRef(null)

  const [googleMapsApiKey, setGoogleMapsApiKey] = useState("")
  const [mapLoading, setMapLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [restaurantData, setRestaurantData] = useState(null)
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [locationSearch, setLocationSearch] = useState("")
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)

  const applyResolvedLocation = (fields) => {
    const next = normalizeRestaurantLocationFields(fields)
    if (!next) return
    locationRef.current = next
    setSelectedLocation(next)
    if (next.latitude != null) updateMarker(next.latitude, next.longitude, formatRestaurantDisplayAddress(next))
  }

  const updateLocationFromCoords = async (nextLat, nextLng) => {
    if (geocodeDebounceRef.current) clearTimeout(geocodeDebounceRef.current)

    geocodeDebounceRef.current = setTimeout(async () => {
      try {
        setGeocoding(true)
        const parsed = await reverseGeocodeWithGoogle(nextLat, nextLng)
        applyResolvedLocation(parsed.locationFields || {
          ...(locationRef.current || {}),
          latitude: nextLat,
          longitude: nextLng,
          formattedAddress: `${nextLat.toFixed(6)}, ${nextLng.toFixed(6)}`,
        })
      } catch (error) {
        debugError("Reverse geocode failed:", error)
        applyResolvedLocation({
          ...(locationRef.current || {}),
          latitude: nextLat,
          longitude: nextLng,
          formattedAddress: `${nextLat.toFixed(6)}, ${nextLng.toFixed(6)}`,
        })
      } finally {
        setGeocoding(false)
      }
    }, 450)
  }

  useEffect(() => {
    fetchRestaurantData()
    loadGoogleMaps()
  }, [])

  // Fetch place suggestions from the new Places API (AutocompleteSuggestion).
  // We keep our own styled input + dropdown; the legacy Autocomplete widget is
  // blocked by Google for projects created after March 1st 2025.
  const fetchSuggestions = async (input) => {
    if (!input || input.trim().length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    if (!window.google?.maps?.importLibrary) return

    try {
      const { AutocompleteSuggestion, AutocompleteSessionToken } =
        await window.google.maps.importLibrary("places")

      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new AutocompleteSessionToken()
      }

      const { suggestions: results } =
        await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
          sessionToken: sessionTokenRef.current,
          includedRegionCodes: ["in"], // Restrict to India
        })

      const mapped = (results || [])
        .map((s) => s.placePrediction)
        .filter(Boolean)
      setSuggestions(mapped)
      setShowSuggestions(mapped.length > 0)
    } catch (err) {
      debugError("Error fetching suggestions:", err)
      setSuggestions([])
      setShowSuggestions(false)
    }
  }

  const handleSearchChange = (value) => {
    setLocationSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300)
  }

  const handleSelectSuggestion = async (prediction) => {
    try {
      const place = prediction.toPlace()
      await place.fetchFields({ fields: ["location", "formattedAddress", "displayName"] })
      if (!mapInstanceRef.current) return

      const loc = place.location
      const lat = typeof loc.lat === "function" ? loc.lat() : loc.lat
      const lng = typeof loc.lng === "function" ? loc.lng() : loc.lng

      mapInstanceRef.current.setCenter({ lat, lng })
      mapInstanceRef.current.setZoom(17)

      setLocationSearch(place.formattedAddress || place.displayName || "")
      setSuggestions([])
      setShowSuggestions(false)
      sessionTokenRef.current = null
      await updateLocationFromCoords(lat, lng)
    } catch (err) {
      debugError("Error resolving selected place:", err)
    }
  }

  // Load existing restaurant location when data is fetched
  useEffect(() => {
    if (restaurantData?.location && mapInstanceRef.current && !mapLoading && window.google) {
      const location = restaurantData.location
      const savedCoords = getSavedLocationCoords(location)

      if (savedCoords) {
        const { lat, lng } = savedCoords
        const locationObj = new window.google.maps.LatLng(lat, lng)
        mapInstanceRef.current.setCenter(locationObj)
        mapInstanceRef.current.setZoom(17)

        const normalized = normalizeRestaurantLocationFields(location)
        if (normalized) {
          applyResolvedLocation(normalized)
        } else {
          updateLocationFromCoords(lat, lng)
        }
      }
    }
  }, [restaurantData, mapLoading])

  const fetchRestaurantData = async () => {
    try {
      const response = await restaurantAPI.getCurrentRestaurant()
      const data = response?.data?.data?.restaurant || response?.data?.restaurant
      if (data) {
        setRestaurantData(data)
      }
    } catch (error) {
      debugError("Error fetching restaurant data:", error)
    }
  }

  const loadGoogleMaps = async () => {
    try {
      debugLog("?? Starting Google Maps load...")
      
      // Fetch API key from database
      let apiKey = null
      try {
        apiKey = await getGoogleMapsApiKey()
        debugLog("?? API Key received:", apiKey ? `Yes (${apiKey.substring(0, 10)}...)` : "No")
        
        if (!apiKey || apiKey.trim() === "") {
          debugError("? API key is empty or not found in database")
          setMapLoading(false)
          alert("Google Maps API key not found in database. Please contact administrator to add the API key in admin panel.")
          return
        }
      } catch (apiKeyError) {
        debugError("? Error fetching API key from database:", apiKeyError)
        setMapLoading(false)
        alert("Failed to fetch Google Maps API key from database. Please check your connection or contact administrator.")
        return
      }
      
      setGoogleMapsApiKey(apiKey)
      
      // Wait for Google Maps to be loaded from main.jsx if it's loading
      let retries = 0
      const maxRetries = 100 // Wait up to 10 seconds
      
      debugLog("?? Waiting for Google Maps to load from main.jsx...")
      while (!window.google && retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100))
        retries++
      }

      // Wait for mapRef to be available (retry mechanism)
      let refRetries = 0
      const maxRefRetries = 50 // Wait up to 5 seconds for ref
      while (!mapRef.current && refRetries < maxRefRetries) {
        await new Promise(resolve => setTimeout(resolve, 100))
        refRetries++
      }

      if (!mapRef.current) {
        debugError("? mapRef.current is still null after waiting")
        setMapLoading(false)
        alert("Failed to initialize map container. Please refresh the page.")
        return
      }

      // If Google Maps is already loaded WITH the Places library, use it directly.
      // The Places library is required for the search/autocomplete to work.
      if (window.google?.maps?.places?.Autocomplete) {
        debugLog("? Google Maps (with Places) already loaded, initializing map...")
        initializeMap(window.google)
        return
      }

      // If Maps was loaded by another page WITHOUT the Places library, that stale
      // script must be removed so we can reload it with libraries=places. Otherwise
      // the search bar autocomplete silently fails (window.google.maps.places is undefined).
      const mapsScript = Array.from(document.getElementsByTagName("script"))
        .find(s => s.src?.includes("maps.googleapis.com/maps/api/js"))
      if (mapsScript && !mapsScript.src.includes("libraries=places")) {
        debugWarn("Found Google Maps script without Places library, reloading with Places...")
        mapsScript.remove()
        // Best-effort clear so the Loader re-injects a fresh script
        try { delete window.google } catch (e) { window.google = undefined }
      }

      // Load (or reload) Google Maps with the Places library via Loader.
      if (apiKey) {
        debugLog("?? Loading Google Maps with Places library via Loader...")
        const loader = new Loader({
          apiKey: apiKey,
          version: "weekly",
          libraries: ["places"]
        })

        const google = await loader.load()
        debugLog("? Google Maps loaded via Loader, initializing map...")
        initializeMap(google)
      } else {
        debugError("? No API key available")
        setMapLoading(false)
        alert("Google Maps API key not found. Please contact administrator.")
      }
    } catch (error) {
      debugError("? Error loading Google Maps:", error)
      setMapLoading(false)
      alert(`Failed to load Google Maps: ${error.message}. Please refresh the page or contact administrator.`)
    }
  }

  const initializeMap = (google) => {
    try {
      if (!mapRef.current) {
        debugError("? mapRef.current is null in initializeMap")
        setMapLoading(false)
        return
      }

      debugLog("?? Initializing map...")
      // Initial location (India center)
      const initialLocation = { lat: 20.5937, lng: 78.9629 }

      // Create map
      const map = new google.maps.Map(mapRef.current, {
        center: initialLocation,
        zoom: 5,
        mapTypeControl: true,
        mapTypeControlOptions: {
          style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
          position: google.maps.ControlPosition.TOP_RIGHT,
          mapTypeIds: [google.maps.MapTypeId.ROADMAP, google.maps.MapTypeId.SATELLITE]
        },
        zoomControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        scrollwheel: true,
        gestureHandling: 'greedy',
        disableDoubleClickZoom: false,
      })

      mapInstanceRef.current = map
      debugLog("? Map initialized successfully")

      // Add click listener to place marker
      map.addListener('click', (event) => {
        const lat = event.latLng.lat()
        const lng = event.latLng.lng()
        updateMarker(lat, lng, "Resolving address...")
        updateLocationFromCoords(lat, lng)
      })

      setMapLoading(false)
      debugLog("? Map loading complete")
    } catch (error) {
      debugError("? Error in initializeMap:", error)
      setMapLoading(false)
      alert("Failed to initialize map. Please refresh the page.")
    }
  }

  const updateMarker = (lat, lng, address) => {
    if (!mapInstanceRef.current || !window.google) return

    // Remove existing marker
    if (markerRef.current) {
      markerRef.current.setMap(null)
    }

    // Create new marker
    const marker = new window.google.maps.Marker({
      position: { lat, lng },
      map: mapInstanceRef.current,
      draggable: true,
      animation: window.google.maps.Animation.DROP,
      title: address || "Restaurant Location"
    })

    // Add info window
    const infoWindow = new window.google.maps.InfoWindow({
      content: `
        <div style="padding: 8px; max-width: 250px;">
          <strong>Restaurant Location</strong><br/>
          <small>${address || `${lat.toFixed(6)}, ${lng.toFixed(6)}`}</small>
        </div>
      `
    })

    marker.addListener('click', () => {
      infoWindow.open(mapInstanceRef.current, marker)
    })

    // Update location when marker is dragged
    marker.addListener('dragend', (event) => {
      const newLat = event.latLng.lat()
      const newLng = event.latLng.lng()
      updateLocationFromCoords(newLat, newLng)
    })

    markerRef.current = marker
  }

  const handleSaveLocation = async () => {
    if (!selectedLocation?.latitude || !selectedLocation?.longitude) {
      toast.error("Please select a location on the map first")
      return
    }

    try {
      setSaving(true)

      const response = await restaurantAPI.updateProfile({
        location: buildRestaurantLocationUpdatePayload(selectedLocation),
      })

      if (response?.data?.data?.restaurant) {
        setRestaurantData(response.data.data.restaurant)
        toast.success("Location saved successfully. Awaiting admin approval.", { duration: 4000 })
        dispatchRestaurantLocationUpdated()
      } else {
        throw new Error("Failed to save location")
      }
    } catch (error) {
      debugError("Error saving location:", error)
      toast.error(error.response?.data?.message || "Failed to save location. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const selectedAddress = formatRestaurantDisplayAddress(selectedLocation, restaurantData)

  return (
    <div className="min-h-screen bg-gray-50">
      <RestaurantNavbar hideSearch />
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
          <div className="flex items-center gap-3 mb-4 md:mb-0">
            {/* Back Button */}
            <button
              onClick={goBack}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5 text-gray-700" />
            </button>
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#B80B3D] to-[#66001D] flex items-center justify-center">
              <MapPin className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Zone Setup</h1>
              <p className="text-sm text-gray-600">Set your restaurant location on the map</p>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 sm:p-4 mb-6 overflow-visible">
          <div className="flex flex-col gap-3">
            <div className="relative w-full min-w-0">
              <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 z-10 pointer-events-none" />
              <input
                type="text"
                value={locationSearch}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="Search for your restaurant location..."
                className="w-full min-w-0 pl-10 sm:pl-12 pr-4 py-3.5 text-sm sm:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#B80B3D] focus:border-transparent"
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute z-[200] left-0 right-0 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
                  {suggestions.map((prediction, idx) => {
                    const main = prediction.mainText?.text || prediction.text?.text || ""
                    const secondary = prediction.secondaryText?.text || ""
                    return (
                      <li
                        key={prediction.placeId || idx}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          handleSelectSuggestion(prediction)
                        }}
                        className="flex items-start gap-2.5 px-3 sm:px-4 py-3 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                      >
                        <MapPin className="w-4 h-4 text-[#B80B3D] mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900 font-medium leading-snug break-words">{main}</p>
                          {secondary && (
                            <p className="text-xs text-gray-500 mt-0.5 leading-snug break-words">{secondary}</p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <button
              onClick={handleSaveLocation}
              disabled={!selectedLocation || saving}
              className="w-full sm:w-auto sm:self-end flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white text-sm sm:text-base font-semibold rounded-lg hover:opacity-95 transition-opacity disabled:bg-gray-400 disabled:cursor-not-allowed shrink-0"
            >
              {saving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  <span>Save Location</span>
                </>
              )}
            </button>
          </div>
          {selectedLocation && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-gray-700">
                <strong>Selected Location:</strong> {selectedAddress || "Resolving address..."}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Coordinates: {Number(selectedLocation.latitude).toFixed(6)}, {Number(selectedLocation.longitude).toFixed(6)}
              </p>
              {geocoding && (
                <p className="text-xs text-[#B80B3D] mt-1">Updating address details...</p>
              )}
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">How to set your location:</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>Search for your location using the search bar above, or</li>
            <li>Click anywhere on the map to place a pin at that location</li>
            <li>You can drag the pin to adjust the exact position</li>
            <li>Click "Save Location" to save your restaurant location</li>
          </ul>
        </div>

        {/* Map Container */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden relative">
          {/* Always render the map div, show loading overlay on top */}
          <div ref={mapRef} className="w-full h-[600px]" style={{ minHeight: '600px' }} />
          {mapLoading && (
            <div className="absolute inset-0 bg-white flex items-center justify-center z-10">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-[#B80B3D] mx-auto mb-2" />
                <p className="text-gray-600">Loading map...</p>
                <p className="text-xs text-gray-400 mt-2">If this takes too long, please refresh the page</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}








