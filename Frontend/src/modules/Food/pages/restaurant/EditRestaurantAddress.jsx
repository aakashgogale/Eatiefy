import { useState, useEffect, useRef, useCallback } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import Lenis from "lenis"
import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react"
import BottomPopup from "@delivery/components/BottomPopup"
import LocationSearchInput from "@food/components/restaurant/LocationSearchInput"
import { restaurantAPI } from "@food/api"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"
import { reverseGeocodeWithGoogle } from "@food/utils/googleGeocoding"
import { formatLocationPreview } from "@food/utils/googlePlaces"
import { Loader } from "@googlemaps/js-api-loader"

const debugError = (...args) => console.error("[EditRestaurantAddress]", ...args)

const ADDRESS_STORAGE_KEY = "restaurant_address"
const MAP_ZOOM = 15
const MAP_ZOOM_SELECTED = 17

const DEFAULT_LAT = 22.7196
const DEFAULT_LNG = 75.8577

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
      swappedLat >= -90 &&
      swappedLat <= 90 &&
      swappedLng >= -180 &&
      swappedLng <= 180
    ) {
      return { lat: swappedLat, lng: swappedLng }
    }

    return null
  }

  return { lat, lng }
}

const toLocationFields = (source = {}) => ({
  formattedAddress: source.formattedAddress || "",
  addressLine1: source.addressLine1 || source.placeName || "",
  addressLine2: source.addressLine2 || "",
  area: source.area || "",
  city: source.city || "",
  state: source.state || "",
  pincode: source.pincode || "",
  landmark: source.landmark || source.placeName || "",
  latitude: source.latitude,
  longitude: source.longitude,
  placeName: source.placeName || source.addressLine1 || "",
})

export default function EditRestaurantAddress() {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const editOwnerPath = routerLocation.state?.from || "/food/restaurant/edit-owner"
  const outletFrom = routerLocation.state?.outletFrom || "/food/restaurant/outlet-info"

  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const geocodeDebounceRef = useRef(null)
  const skipIdleGeocodeRef = useRef(false)
  const pendingMapCenterRef = useRef(null)
  const initialCoordsRef = useRef({ lat: DEFAULT_LAT, lng: DEFAULT_LNG })
  const locationRef = useRef(null)
  const hasPrefilledLocationRef = useRef(false)
  const mapInitializedRef = useRef(false)

  const [restaurantName, setRestaurantName] = useState("")
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mapLoading, setMapLoading] = useState(true)
  const [geocoding, setGeocoding] = useState(false)
  const [showSelectOptionDialog, setShowSelectOptionDialog] = useState(false)
  const [selectedOption, setSelectedOption] = useState("minor_correction")
  const [lat, setLat] = useState(DEFAULT_LAT)
  const [lng, setLng] = useState(DEFAULT_LNG)
  const [hasMovedPin, setHasMovedPin] = useState(false)

  const applyResolvedLocation = useCallback((fields, markMoved = true) => {
    const next = toLocationFields(fields)
    locationRef.current = next
    setSelectedLocation(next)
    if (next.latitude != null) setLat(Number(next.latitude))
    if (next.longitude != null) setLng(Number(next.longitude))
    if (markMoved) setHasMovedPin(true)
  }, [])

  const goBackToEditOwner = useCallback(() => {
    navigate(editOwnerPath, {
      state: {
        from: outletFrom,
        activeTab: routerLocation.state?.returnTab || "restaurant",
      },
    })
  }, [navigate, editOwnerPath, outletFrom, routerLocation.state?.returnTab])

  const updateAddressFromCoords = useCallback(
    async (nextLat, nextLng, markMoved = true) => {
      setLat(nextLat)
      setLng(nextLng)
      if (markMoved) setHasMovedPin(true)

      if (geocodeDebounceRef.current) clearTimeout(geocodeDebounceRef.current)

      geocodeDebounceRef.current = setTimeout(async () => {
        try {
          if (markMoved) {
            setGeocoding(true)
          }
          const parsed = await reverseGeocodeWithGoogle(nextLat, nextLng)
          const fields = parsed.locationFields || {
            ...toLocationFields(parsed),
            latitude: nextLat,
            longitude: nextLng,
          }

          applyResolvedLocation(
            {
              ...fields,
              latitude: nextLat,
              longitude: nextLng,
            },
            markMoved
          )
        } catch (error) {
          debugError("Reverse geocode failed:", error)
          applyResolvedLocation(
            {
              ...(locationRef.current || {}),
              latitude: nextLat,
              longitude: nextLng,
              formattedAddress: `${nextLat.toFixed(6)}, ${nextLng.toFixed(6)}`,
            },
            markMoved
          )
        } finally {
          if (markMoved) {
            setGeocoding(false)
          }
        }
      }, markMoved ? 450 : 0)
    },
    [applyResolvedLocation]
  )

  const panMapToCoordinates = useCallback(async (latitude, longitude, zoom = MAP_ZOOM_SELECTED) => {
    const nextLat = Number(latitude)
    const nextLng = Number(longitude)
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return

    setLat(nextLat)
    setLng(nextLng)
    skipIdleGeocodeRef.current = true

    const tryPan = () => {
      const map = mapInstanceRef.current
      if (!map) return false
      map.panTo({ lat: nextLat, lng: nextLng })
      map.setZoom(zoom)
      return true
    }

    if (tryPan()) {
      window.setTimeout(() => {
        skipIdleGeocodeRef.current = false
      }, 400)
      return
    }

    pendingMapCenterRef.current = { lat: nextLat, lng: nextLng, zoom }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (tryPan()) {
        pendingMapCenterRef.current = null
        window.setTimeout(() => {
          skipIdleGeocodeRef.current = false
        }, 400)
        return
      }
    }
  }, [])

  const initializeMap = useCallback(
    (google, centerLat, centerLng) => {
      if (!mapRef.current) {
        setMapLoading(false)
        return
      }

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: centerLat, lng: centerLng },
        zoom: MAP_ZOOM,
        mapTypeControl: false,
        zoomControl: true,
        streetViewControl: false,
        fullscreenControl: false,
        scrollwheel: true,
        gestureHandling: "greedy",
        disableDoubleClickZoom: false,
      })

      mapInstanceRef.current = map

      if (pendingMapCenterRef.current) {
        const pending = pendingMapCenterRef.current
        map.panTo({ lat: pending.lat, lng: pending.lng })
        map.setZoom(pending.zoom || MAP_ZOOM_SELECTED)
        pendingMapCenterRef.current = null
      }

      map.addListener("idle", () => {
        if (skipIdleGeocodeRef.current) return

        const center = map.getCenter()
        const nextLat = center.lat()
        const nextLng = center.lng()
        const initial = initialCoordsRef.current

        const moved =
          Math.abs(nextLat - initial.lat) > 0.00001 ||
          Math.abs(nextLng - initial.lng) > 0.00001

        // Skip the first idle after map load when we already have saved outlet details.
        if (!mapInitializedRef.current) {
          mapInitializedRef.current = true
          if (!moved && hasPrefilledLocationRef.current) {
            return
          }
        }

        if (!moved && hasPrefilledLocationRef.current) {
          return
        }

        updateAddressFromCoords(nextLat, nextLng, moved)
      })

      setMapLoading(false)
    },
    [updateAddressFromCoords]
  )

  const loadGoogleMaps = useCallback(
    async (centerLat, centerLng) => {
      try {
        const apiKey = await getGoogleMapsApiKey()
        if (!apiKey?.trim()) {
          setMapLoading(false)
          alert("Google Maps API key not found. Please contact administrator.")
          return
        }

        let retries = 0
        while (!mapRef.current && retries < 50) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          retries++
        }

        if (!mapRef.current) {
          setMapLoading(false)
          return
        }

        if (window.google?.maps?.Map) {
          initializeMap(window.google, centerLat, centerLng)
          return
        }

        const loader = new Loader({
          apiKey,
          version: "weekly",
          libraries: ["places"],
        })

        const google = await loader.load()
        initializeMap(google, centerLat, centerLng)
      } catch (error) {
        debugError("Error loading Google Maps:", error)
        setMapLoading(false)
        alert("Failed to load map. Please refresh and try again.")
      }
    },
    [initializeMap]
  )

  const applyLocationData = useCallback(
    (locationData, name = "") => {
      if (name) setRestaurantName(name)

      if (locationData) {
        const fields = toLocationFields(locationData)
        hasPrefilledLocationRef.current = Boolean(
          fields.addressLine1 || fields.formattedAddress || fields.area || fields.city
        )
        applyResolvedLocation(fields, false)

        const savedCoords = getSavedLocationCoords(locationData)
        const nextLat = savedCoords?.lat ?? DEFAULT_LAT
        const nextLng = savedCoords?.lng ?? DEFAULT_LNG

        initialCoordsRef.current = { lat: nextLat, lng: nextLng }
        setLat(nextLat)
        setLng(nextLng)
        loadGoogleMaps(nextLat, nextLng)
        return
      }

      initialCoordsRef.current = { lat: DEFAULT_LAT, lng: DEFAULT_LNG }
      loadGoogleMaps(DEFAULT_LAT, DEFAULT_LNG)
    },
    [applyResolvedLocation, loadGoogleMaps]
  )

  useEffect(() => {
    const fetchRestaurantData = async () => {
      const passedLocation = routerLocation.state?.currentLocation

      if (passedLocation) {
        applyLocationData(passedLocation, "")
        setLoading(false)

        restaurantAPI
          .getCurrentRestaurant()
          .then((response) => {
            const data = response?.data?.data?.restaurant || response?.data?.restaurant
            if (data?.name || data?.restaurantName) {
              setRestaurantName(data.name || data.restaurantName || "")
            }
          })
          .catch(() => {})
        return
      }

      try {
        setLoading(true)

        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant

        if (data) {
          applyLocationData(data.location, data.name || data.restaurantName || "")
        } else {
          applyLocationData(null)
        }
      } catch (error) {
        if (
          error.code !== "ERR_NETWORK" &&
          error.code !== "ECONNABORTED" &&
          !error.message?.includes("timeout")
        ) {
          debugError("Error fetching restaurant data:", error)
        }

        try {
          const savedName =
            localStorage.getItem("restaurant_name") ||
            localStorage.getItem("restaurantName") ||
            ""
          setRestaurantName(savedName)
        } catch (e) {
          debugError("Error loading from localStorage:", e)
        }
        applyLocationData(null)
      } finally {
        setLoading(false)
      }
    }

    fetchRestaurantData()

    return () => {
      if (geocodeDebounceRef.current) clearTimeout(geocodeDebounceRef.current)
    }
  }, [applyLocationData, routerLocation.state?.currentLocation])

  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    })

    function raf(time) {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }

    requestAnimationFrame(raf)

    return () => {
      lenis.destroy()
    }
  }, [])

  const handleSearchLocationSelect = async (location) => {
    if (!location?.latitude || !location?.longitude) return

    if (geocodeDebounceRef.current) clearTimeout(geocodeDebounceRef.current)
    setGeocoding(false)
    hasPrefilledLocationRef.current = false

    applyResolvedLocation(location, true)
    await panMapToCoordinates(location.latitude, location.longitude, MAP_ZOOM_SELECTED)
  }

  const handleUpdateClick = () => {
    if (!hasMovedPin) {
      alert("Please move the map or search your outlet location before updating.")
      return
    }
    setShowSelectOptionDialog(true)
  }

  const handleProceedUpdate = () => {
    if (selectedOption === "update_address") {
      alert("For major address updates, FSSAI verification may be required. Please contact support.")
      setShowSelectOptionDialog(false)
      return
    }

    const currentLocation = locationRef.current || selectedLocation || {}
    const updatedLocation = {
      ...currentLocation,
      latitude: lat,
      longitude: lng,
      coordinates: [lng, lat],
      formattedAddress:
        currentLocation.formattedAddress ||
        formatLocationPreview(currentLocation) ||
        `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
    }

    navigate(editOwnerPath, {
      state: {
        from: outletFrom,
        activeTab: routerLocation.state?.returnTab || "restaurant",
        updatedLocation,
      },
    })
  }

  const previewText = formatLocationPreview(selectedLocation)
  const simplifiedAddress = previewText || "Set your outlet location"

  return (
    <div className="h-screen bg-white overflow-hidden flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-[100] shrink-0 overflow-visible">
        <div className="flex items-center gap-3">
          <button
            onClick={goBackToEditOwner}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
            aria-label="Go back"
          >
            <ArrowLeft className="w-6 h-6 text-[#B80B3D]" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <h1 className="text-base font-bold text-gray-900 truncate">{restaurantName}</h1>
              <ChevronDown className="w-4 h-4 text-gray-900 shrink-0" />
            </div>
            <p className="text-xs text-gray-600 truncate">{simplifiedAddress}</p>
          </div>
        </div>

        <div className="mt-3 relative z-[110]">
          <LocationSearchInput
            label=""
            placeholder="Search area, street, landmark..."
            biasLocation={{ latitude: lat, longitude: lng }}
            onLocationSelect={handleSearchLocationSelect}
          />
        </div>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div className="absolute inset-0 bottom-[280px]">
          <div ref={mapRef} className="absolute inset-0 w-full h-full" />

          {mapLoading && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-30">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-[#B80B3D] mx-auto mb-2" />
                <p className="text-sm text-gray-600">Loading map...</p>
              </div>
            </div>
          )}

          <div className="absolute top-[36%] left-1/2 -translate-x-1/2 -translate-y-full pointer-events-none z-10 flex flex-col items-center">
            <div className="bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white px-3 py-2 rounded-lg mb-2 max-w-[220px] text-center shadow-lg">
              <p className="text-xs font-semibold">Your outlet location</p>
              <p className="text-[10px] text-white/80">Drag map or search above</p>
            </div>
            <div className="w-5 h-5 bg-[#B80B3D] rounded-full border-[3px] border-white shadow-lg" />
            <div className="w-0.5 h-3 bg-[#B80B3D]" />
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl z-20 px-4 pt-5 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] min-h-[280px]">
          <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
          <h2 className="text-lg font-bold text-gray-900 mb-3">Selected location</h2>

          {geocoding && hasMovedPin ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-4 min-h-[148px]">
              <Loader2 className="w-4 h-4 animate-spin text-[#B80B3D]" />
              Fetching exact place details...
            </div>
          ) : selectedLocation ? (
            <div className="space-y-2 mb-4 min-h-[148px]">
              {selectedLocation.placeName || selectedLocation.addressLine1 ? (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Place</p>
                  <p className="text-base font-semibold text-gray-900">
                    {selectedLocation.placeName || selectedLocation.addressLine1}
                  </p>
                </div>
              ) : null}
              {selectedLocation.addressLine2 ? (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Street</p>
                  <p className="text-sm text-gray-800">{selectedLocation.addressLine2}</p>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Area</p>
                  <p className="text-sm text-gray-800">{selectedLocation.area || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">City</p>
                  <p className="text-sm text-gray-800">{selectedLocation.city || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Pincode</p>
                  <p className="text-sm text-gray-800">{selectedLocation.pincode || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">State</p>
                  <p className="text-sm text-gray-800">{selectedLocation.state || "—"}</p>
                </div>
              </div>
              {hasMovedPin && (
                <p className="text-[11px] text-gray-400 pt-1">
                  {lat.toFixed(6)}, {lng.toFixed(6)}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500 mb-4">
              Search your outlet or drag the map until the pin is on your exact location.
            </p>
          )}

          <div className="pb-4">
            <button
              onClick={handleUpdateClick}
              disabled={loading || mapLoading || geocoding}
              className="w-full bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white font-bold py-4 text-base rounded-xl shadow-lg shadow-[#B80B3D]/20 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Update Address
            </button>
          </div>
        </div>
      </div>

      <BottomPopup
        isOpen={showSelectOptionDialog}
        onClose={() => setShowSelectOptionDialog(false)}
        title="Select an option"
        maxHeight="auto"
      >
        <div className=" space-y-0">
          <button
            onClick={() => setSelectedOption("update_address")}
            className="w-full flex items-start justify-between py-4 border-b border-dashed border-gray-300"
          >
            <div className="flex-1 text-left">
              <p className="text-base font-semibold text-gray-900 mb-1">
                Update outlet address (FSSAI required)
              </p>
              <p className="text-sm text-gray-500">{previewText}</p>
            </div>
            <div className="ml-4 shrink-0">
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  selectedOption === "update_address"
                    ? "border-[#B80B3D] bg-gradient-to-br from-[#B80B3D] to-[#66001D]"
                    : "border-gray-300"
                }`}
              >
                {selectedOption === "update_address" && (
                  <div className="w-2 h-2 rounded-full bg-white" />
                )}
              </div>
            </div>
          </button>

          <button
            onClick={() => setSelectedOption("minor_correction")}
            className="w-full flex items-start justify-between py-4"
          >
            <div className="flex-1 text-left">
              <p className="text-base font-semibold text-gray-900 mb-1">
                Make a minor correction to the location pin
              </p>
              <p className="text-sm text-gray-500">
                If location pin on the map is slightly misplaced
              </p>
            </div>
            <div className="ml-4 shrink-0">
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  selectedOption === "minor_correction"
                    ? "border-[#B80B3D] bg-gradient-to-br from-[#B80B3D] to-[#66001D]"
                    : "border-gray-300"
                }`}
              >
                {selectedOption === "minor_correction" && (
                  <div className="w-2 h-2 rounded-full bg-white" />
                )}
              </div>
            </div>
          </button>

          <button
            onClick={handleProceedUpdate}
            className="w-full bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white font-bold py-4 rounded-xl mt-6 shadow-lg shadow-[#B80B3D]/20 transition-all active:scale-[0.98]"
          >
            Proceed to update
          </button>
        </div>
      </BottomPopup>
    </div>
  )
}
