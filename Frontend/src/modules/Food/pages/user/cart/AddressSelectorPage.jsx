import { useMemo, useState, useEffect, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import { ChevronLeft, ChevronRight, Plus, MapPin, Navigation, Home, Building2, Briefcase, X, Crosshair, Search, Pencil, Trash2 } from "lucide-react"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { Label } from "@food/components/ui/label"
import { Textarea } from "@food/components/ui/textarea"
import { useLocation as useGeoLocation } from "@food/hooks/useLocation"
import { useProfile } from "@food/context/ProfileContext"
import { toast } from "sonner"
import { locationAPI, userAPI } from "@food/api"
import { Loader } from '@googlemaps/js-api-loader'
import AnimatedPage from "@food/components/user/AnimatedPage"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { reverseGeocodeWithGoogle, geocodeGooglePlaceId, getFreshGpsCoordinates } from "@food/utils/googleGeocoding"

const MAP_SEARCH_INPUT_CLASS =
  "pl-12 pr-10 h-14 bg-white dark:bg-[#1a1a1a] border-2 border-zinc-200/90 dark:border-zinc-700 rounded-2xl focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:border-zinc-400 dark:focus:border-zinc-500 text-zinc-900 dark:text-zinc-50 placeholder:!text-neutral-400 dark:placeholder:!text-neutral-500 font-medium text-sm transition-all shadow-sm w-full"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

// Enable Maps if API Key is available, otherwise fallback to coordinates-only mode
const MAPS_ENABLED = !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY

// Calculate distance between two coordinates using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3 // Earth's radius in meters
  const lat1Rad = lat1 * Math.PI / 180
  const lat2Rad = lat2 * Math.PI / 180
  const deltaLat = (lat2 - lat1) * Math.PI / 180
  const deltaLon = (lon2 - lon1) * Math.PI / 180

  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) *
    Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c // Distance in meters
}

// Get icon based on address type/label
const getAddressIcon = (address) => {
  const label = (address.label || address.additionalDetails || "").toLowerCase()
  if (label.includes("home")) return Home
  if (label.includes("work") || label.includes("office")) return Briefcase
  if (label.includes("building") || label.includes("apt")) return Building2
  return Home
}

const getAddressCoordinates = (address) => {
  const coords = address?.location?.coordinates
  if (Array.isArray(coords) && coords.length >= 2) {
    const lng = Number(coords[0])
    const lat = Number(coords[1])
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
  }
  const lat = Number(address?.latitude ?? address?.lat)
  const lng = Number(address?.longitude ?? address?.lng)
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
  return null
}

const normalizeLabelForForm = (label) => {
  const value = String(label || "Home").toLowerCase()
  if (value.includes("office") || value.includes("work")) return "Work"
  if (value.includes("other")) return "Other"
  return "Home"
}

const formatAddressPreview = (address) => {
  if (!address) return ""
  return [address.additionalDetails, address.street, address.city, address.state, address.zipCode]
    .filter(Boolean)
    .join(", ")
}

const DELETE_MODAL_ANIM_MS = 220

const showAddressRemovedBrandedToast = () => {
  toast.custom(
    () => (
      <div className="w-[calc(100vw-28px)] sm:w-[340px] flex items-center gap-2.5 py-2 px-3 rounded-2xl bg-white/72 dark:bg-zinc-900/72 backdrop-blur-xl border border-white/60 dark:border-white/10 shadow-[0_8px_28px_rgba(0,0,0,0.14)] ring-1 ring-black/5 animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#DC2626]/95 to-[#991B1B]/95 flex items-center justify-center p-0.5 shadow-md flex-shrink-0">
          <img
            src="/assets/images/ometto-toast-logo.png"
            alt="Ometto"
            className="w-full h-full object-contain brightness-0 invert scale-110"
          />
        </div>
        <p className="text-[13px] font-semibold text-gray-900/90 dark:text-white leading-none pr-1">
          Address Removed Successfully
        </p>
      </div>
    ),
    {
      id: "address-removed-toast",
      duration: 4000,
      position: "top-center",
      unstyled: true,
    }
  )
}

export default function AddressSelectorPage() {
  const navigate = useNavigate()
  const goBack = useAppBackNavigation()
  const { location, loading, requestLocation, requestLocationFast } = useGeoLocation()
  const { addresses = [], addAddress, updateAddress, deleteAddress, setDefaultAddress, userProfile, isAuthenticated, loading: profileLoading } = useProfile()
  const [showAddressForm, setShowAddressForm] = useState(false)
  const [editingAddressId, setEditingAddressId] = useState(null)
  const [deleteDialog, setDeleteDialog] = useState(null)
  const [isDeletingAddress, setIsDeletingAddress] = useState(false)
  const deleteCloseTimerRef = useRef(null)
  const [mapPosition, setMapPosition] = useState(() => {
    try {
      const stored = localStorage.getItem("userLocation")
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Number.isFinite(parsed?.latitude) && Number.isFinite(parsed?.longitude)) {
          return [parsed.latitude, parsed.longitude]
        }
      }
    } catch {}
    return [22.7196, 75.8577]
  })
  const [addressFormData, setAddressFormData] = useState({
    street: "",
    city: "",
    state: "",
    zipCode: "",
    additionalDetails: "",
    label: "Home",
    phone: "",
  })
  const [isFetchingLocationState, setIsFetchingLocationState] = useState(false)
  const [mapGpsLoading, setMapGpsLoading] = useState(false)
  const [loadingAddress, setLoadingAddress] = useState(false)
  const [mapLoading, setMapLoading] = useState(false)
  const mapContainerRef = useRef(null)
  const googleMapRef = useRef(null) // Google Maps instance
  const greenMarkerRef = useRef(null) // Green marker for address selection
  const userLocationMarkerRef = useRef(null) // Blue dot marker for user location
  const blueDotCircleRef = useRef(null) // Accuracy circle for Google Maps
  const [currentAddress, setCurrentAddress] = useState("")
  const [addressAutocompleteValue, setAddressAutocompleteValue] = useState("")
  const [keywordAddressSuggestions, setKeywordAddressSuggestions] = useState([])
  const [isKeywordSearching, setIsKeywordSearching] = useState(false)
  const [lockMapToAutocomplete, setLockMapToAutocomplete] = useState(true)
  const [GOOGLE_MAPS_API_KEY, setGOOGLE_MAPS_API_KEY] = useState(null)
  const [googleMapsLoaded, setGoogleMapsLoaded] = useState(false)
  const googleMapsRef = useRef(null)
  const autocompleteServiceRef = useRef(null)
  const geocodeDebounceRef = useRef(null)
  const initialMapCenterRef = useRef(mapPosition)
  const pendingMapCenterRef = useRef(null)
  const [formScrollTop, setFormScrollTop] = useState(0)
  const [keyboardInset, setKeyboardInset] = useState(0)
  const [baseMapHeight, setBaseMapHeight] = useState(320)
  const formBodyRef = useRef(null)
  const manualFieldRefs = useRef({})
  
  const ENABLE_LOCATION_REVERSE_GEOCODE = import.meta.env.VITE_ENABLE_LOCATION_REVERSE_GEOCODE !== "false"
  const getAddressId = (address) => address?.id || address?._id || null

  const getDeleteModalMotion = useCallback((phase) => {
    const isOpen = phase === "open"
    return {
      opacity: isOpen ? 1 : 0,
      transform: isOpen ? "translateY(0) scale(1)" : "translateY(10px) scale(0.97)",
      transition: `transform ${DELETE_MODAL_ANIM_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${DELETE_MODAL_ANIM_MS - 40}ms ease`,
      willChange: "transform, opacity",
    }
  }, [])

  const closeDeleteDialog = useCallback(() => {
    setDeleteDialog((prev) => (prev ? { ...prev, phase: "exit" } : null))
    if (deleteCloseTimerRef.current) clearTimeout(deleteCloseTimerRef.current)
    deleteCloseTimerRef.current = setTimeout(() => {
      setDeleteDialog(null)
      deleteCloseTimerRef.current = null
    }, DELETE_MODAL_ANIM_MS)
  }, [])

  useEffect(() => {
    if (deleteDialog?.phase !== "enter") return
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setDeleteDialog((prev) => (prev?.phase === "enter" ? { ...prev, phase: "open" } : prev))
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [deleteDialog?.phase])

  useEffect(() => {
    return () => {
      if (deleteCloseTimerRef.current) clearTimeout(deleteCloseTimerRef.current)
    }
  }, [])

  const handleBack = () => {
    goBack()
  }

  const addressAutocompleteSuggestions = useMemo(() => {
    const q = String(addressAutocompleteValue || "").trim().toLowerCase()
    if (!q) return []
    const list = Array.isArray(addresses) ? addresses : []
    return list
      .map((addr) => {
        const text = [
          addr?.label,
          addr?.additionalDetails,
          addr?.street,
          addr?.city,
          addr?.state,
          addr?.zipCode,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        return { addr, text }
      })
      .filter((x) => x.text.includes(q))
      .slice(0, 6)
      .map((x) => x.addr)
  }, [addresses, addressAutocompleteValue])

  // Load Google Maps API key + Places library for search/geocoding
  useEffect(() => {
    if (!MAPS_ENABLED) return
    let cancelled = false
    import('@food/utils/googleMapsApiKey.js').then(({ getGoogleMapsApiKey }) => {
      getGoogleMapsApiKey().then(async (key) => {
        if (cancelled || !key) return
        setGOOGLE_MAPS_API_KEY(key)
        try {
          const loader = new Loader({ apiKey: key, version: "weekly", libraries: ["places"] })
          const google = await loader.load()
          if (cancelled) return
          googleMapsRef.current = google
          autocompleteServiceRef.current = new google.maps.places.AutocompleteService()
          setGoogleMapsLoaded(true)
        } catch (err) {
          debugError("Google Maps load error:", err)
        }
      })
    })
    return () => { cancelled = true }
  }, [])

  // Instant: reuse location Home already has. Do NOT call requestLocation() on open
  // (that clears cache + force-fresh GPS and feels slow). Explicit "Use current location" still refreshes.
  useEffect(() => {
    const applyLoc = (loc) => {
      if (!loc) return
      const formatted = loc.formattedAddress || loc.address || ""
      const cleanFormatted = formatted.replace(/^[a-z0-9]{2,8}\+[a-z0-9]{0,3}[,\s]*/i, '').replace(/,\s*India$/, '')
      if (cleanFormatted) setCurrentAddress(cleanFormatted)
      if (Number.isFinite(Number(loc.latitude)) && Number.isFinite(Number(loc.longitude))) {
        const coords = [Number(loc.latitude), Number(loc.longitude)]
        setMapPosition(coords)
        initialMapCenterRef.current = coords
      }
    }

    applyLoc(location)
    try {
      const stored = localStorage.getItem("userLocation")
      if (stored) applyLoc(JSON.parse(stored))
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const formatted = location?.formattedAddress || location?.address
    const cleanFormatted = formatted ? formatted.replace(/^[a-z0-9]{2,8}\+[a-z0-9]{0,3}[,\s]*/i, '').replace(/,\s*India$/, '') : ""
    if (cleanFormatted) setCurrentAddress(cleanFormatted)
  }, [location?.formattedAddress, location?.address, location?.latitude, location?.longitude])

  // Google Places autocomplete search
  useEffect(() => {
    const q = String(addressAutocompleteValue || "").trim()
    if (!googleMapsLoaded || !autocompleteServiceRef.current || q.length < 3) {
      setKeywordAddressSuggestions([])
      setIsKeywordSearching(false)
      return
    }

    const t = setTimeout(() => {
      setIsKeywordSearching(true)
      const google = googleMapsRef.current
      const service = autocompleteServiceRef.current
      const request = {
        input: q,
        componentRestrictions: { country: "in" },
      }
      if (Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude)) {
        request.location = new google.maps.LatLng(location.latitude, location.longitude)
        request.radius = 50000
      }

      service.getPlacePredictions(request, (predictions, status) => {
        setIsKeywordSearching(false)
        if (status !== google.maps.places.PlacesServiceStatus.OK || !Array.isArray(predictions)) {
          setKeywordAddressSuggestions([])
          return
        }
        setKeywordAddressSuggestions(
          predictions.slice(0, 6).map((p) => ({
            id: p.place_id,
            placeId: p.place_id,
            display: p.description,
          }))
        )
      })
    }, 350)

    return () => clearTimeout(t)
  }, [addressAutocompleteValue, googleMapsLoaded, location?.latitude, location?.longitude])

  const applyGeocodedAddressToForm = useCallback((parsed, formattedOverride) => {
    const formatted = formattedOverride || parsed?.formattedAddress || parsed?.address || ""
    const cleanFormatted = formatted.replace(/^[a-z0-9]{2,8}\+[a-z0-9]{0,3}[,\s]*/i, '').replace(/,\s*India$/, '')
    setCurrentAddress(cleanFormatted)
    
    setAddressFormData((prev) => {
      let streetVal = parsed?.area || parsed?.address || formatted.split(",")[0] || prev.street
      if (streetVal) {
        streetVal = streetVal.replace(/^[a-z0-9]{2,8}\+[a-z0-9]{0,3}[,\s]*/i, '').replace(/,\s*India$/, '').trim()
        if (streetVal.endsWith(',')) streetVal = streetVal.slice(0, -1).trim()
      }
      return {
        ...prev,
        street: streetVal || prev.street,
        city: parsed?.city || prev.city,
        state: parsed?.state || prev.state,
        zipCode: parsed?.pincode || prev.zipCode,
      }
    })
  }, [])

  const handleMapMoveEnd = useCallback(async (lat, lng) => {
    if (!ENABLE_LOCATION_REVERSE_GEOCODE) return
    if (geocodeDebounceRef.current) clearTimeout(geocodeDebounceRef.current)
    geocodeDebounceRef.current = setTimeout(async () => {
      try {
        const parsed = await reverseGeocodeWithGoogle(lat, lng)
        applyGeocodedAddressToForm(parsed)
      } catch (e) {
        debugError("Reverse geocode error:", e)
      }
    }, 400)
  }, [ENABLE_LOCATION_REVERSE_GEOCODE, applyGeocodedAddressToForm])

  // Map Initialization logic
  useEffect(() => {
    if (!MAPS_ENABLED || !showAddressForm || !GOOGLE_MAPS_API_KEY) return

    let isMounted = true
    setMapLoading(true)

    const initializeGoogleMap = async () => {
      try {
        // Retry a few times if the container ref isn't immediately populated in the DOM
        let retries = 0
        while (!mapContainerRef.current && retries < 10) {
          await new Promise(resolve => setTimeout(resolve, 50))
          retries++
        }

        if (!isMounted || !mapContainerRef.current) {
          setMapLoading(false)
          return
        }

        const loader = new Loader({ apiKey: GOOGLE_MAPS_API_KEY, version: "weekly", libraries: ["places"] })
        const google = await loader.load()
        if (!isMounted || !mapContainerRef.current) return
        googleMapsRef.current = google
        if (!autocompleteServiceRef.current) {
          autocompleteServiceRef.current = new google.maps.places.AutocompleteService()
        }

        const initialPos = {
          lat: initialMapCenterRef.current[0],
          lng: initialMapCenterRef.current[1],
        }
        
        const map = new google.maps.Map(mapContainerRef.current, {
          center: initialPos,
          zoom: 16,
          mapTypeId: google.maps.MapTypeId.ROADMAP,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
        })
        googleMapRef.current = map

        if (pendingMapCenterRef.current) {
          const pending = pendingMapCenterRef.current
          map.panTo({ lat: pending.lat, lng: pending.lng })
          map.setZoom(pending.zoom || 17)
          pendingMapCenterRef.current = null
        }

        // Update coordinates on map idle (center of the map is the chosen location)
        map.addListener("idle", () => {
          const center = map.getCenter()
          const lat = center.lat()
          const lng = center.lng()
          setMapPosition([lat, lng])
          handleMapMoveEnd(lat, lng)
        })

        setMapLoading(false)
      } catch (err) {
        debugError("Map init error:", err)
        setMapLoading(false)
      }
    }
    initializeGoogleMap()
    return () => { isMounted = false }
  }, [showAddressForm, GOOGLE_MAPS_API_KEY, handleMapMoveEnd])

  const handleUseCurrentLocation = async () => {
    try {
      setIsFetchingLocationState(true)

      // Fast GPS + single geocode (no cache clear / no global loader)
      const loc =
        typeof requestLocationFast === "function"
          ? await requestLocationFast()
          : await requestLocation()

      if (loc) {
        sessionStorage.setItem("manual_location_update", "true")
        localStorage.setItem("deliveryAddressMode", "current")
        window.dispatchEvent(new CustomEvent("userLocationUpdated"))
        handleBack()
      } else {
        setIsFetchingLocationState(false)
      }
    } catch (e) {
      setIsFetchingLocationState(false)
      toast.error("Failed to get current location", { id: "geo" })
    }
  }

  const handleSelectSavedAddress = async (address) => {
    const id = getAddressId(address)
    if (id) {
      sessionStorage.setItem("manual_location_update", "true")
      
      // Perform optimistic default address set instantly
      setDefaultAddress(id)
      
      try { 
        localStorage.setItem("deliveryAddressMode", "saved")
        window.dispatchEvent(new CustomEvent("userLocationUpdated"))
        // Go back immediately!
        handleBack()
      } catch (e) {
        console.error("Failed to select saved address:", e)
      }
    }
  }

  const panMapToCoordinates = useCallback(async (latitude, longitude, zoom = 17) => {
    setMapPosition([latitude, longitude])
    initialMapCenterRef.current = [latitude, longitude]

    const tryPan = () => {
      if (!googleMapRef.current) return false
      googleMapRef.current.panTo({ lat: latitude, lng: longitude })
      googleMapRef.current.setZoom(zoom)
      return true
    }

    if (tryPan()) return

    pendingMapCenterRef.current = { lat: latitude, lng: longitude, zoom }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (tryPan()) {
        pendingMapCenterRef.current = null
        return
      }
    }
  }, [])

  const handleCenterMapOnMyLocation = async () => {
    if (mapGpsLoading) return
    setMapGpsLoading(true)
    try {
      const coords = await getFreshGpsCoordinates()
      const { latitude, longitude } = coords
      await panMapToCoordinates(latitude, longitude)
      const parsed = await reverseGeocodeWithGoogle(latitude, longitude)
      applyGeocodedAddressToForm(parsed)
      toast.success("Moved to your current location", { id: "geo-map" })
    } catch (err) {
      console.error("Map GPS error:", err)
      if (location?.latitude && location?.longitude) {
        await panMapToCoordinates(location.latitude, location.longitude)
        applyGeocodedAddressToForm(location, location.formattedAddress || location.address)
        toast.info("Using last known location", { id: "geo-map" })
      } else {
        toast.error("Allow location permission to use GPS", { id: "geo-map" })
      }
    } finally {
      setMapGpsLoading(false)
    }
  }

  const handleSelectOuterSuggestion = async (s) => {
    setIsFetchingLocationState(true)
    try {
      let lat
      let lng
      let display
      let parsed

      if (s.placeId) {
        parsed = await geocodeGooglePlaceId(s.placeId)
        lat = parsed.latitude
        lng = parsed.longitude
        display = parsed.formattedAddress
      } else if (s.lat && s.lng) {
        lat = s.lat
        lng = s.lng
        display = s.display
        parsed = await reverseGeocodeWithGoogle(lat, lng)
      } else {
        toast.error("Could not resolve location coordinates")
        return
      }

      const finalLoc = {
        latitude: lat,
        longitude: lng,
        city: parsed.city || "",
        state: parsed.state || "",
        country: parsed.country || "India",
        area: parsed.area || "",
        address: parsed.address || display,
        formattedAddress: display || parsed.formattedAddress,
        pincode: parsed.pincode || "",
      }

      localStorage.setItem("userLocation", JSON.stringify(finalLoc))
      sessionStorage.setItem("manual_location_update", "true")
      localStorage.setItem("deliveryAddressMode", "current")
      window.dispatchEvent(new CustomEvent("userLocationUpdated"))
      handleBack()
    } catch (err) {
      console.error("Error selecting search suggestion:", err)
      toast.error("Failed to select location")
    } finally {
      setIsFetchingLocationState(false)
    }
  }

  const handleSelectMapSuggestion = async (s) => {
    try {
      const parsed = await geocodeGooglePlaceId(s.placeId || s.id)
      const lat = parsed.latitude
      const lng = parsed.longitude
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        toast.error("Could not resolve location coordinates")
        return
      }
      await panMapToCoordinates(lat, lng)
      setAddressAutocompleteValue(parsed.formattedAddress || s.display || "")
      applyGeocodedAddressToForm(parsed)
      setKeywordAddressSuggestions([])
    } catch (err) {
      console.error("Error selecting map suggestion:", err)
      toast.error("Failed to select location")
    }
  }

  const resolveExistingLocation = useCallback(() => {
    if (Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude)) {
      return location
    }
    try {
      const stored = localStorage.getItem("userLocation")
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Number.isFinite(parsed?.latitude) && Number.isFinite(parsed?.longitude)) {
          return parsed
        }
      }
    } catch {}
    if (Number.isFinite(mapPosition[0]) && Number.isFinite(mapPosition[1])) {
      return {
        latitude: mapPosition[0],
        longitude: mapPosition[1],
        formattedAddress: currentAddress,
        address: currentAddress,
      }
    }
    return null
  }, [location, mapPosition, currentAddress])

  const handleAddAddressClick = () => {
    if (!isAuthenticated) {
      toast.info("Please login to add an address")
      navigate("/user/auth/login")
      return
    }

    setEditingAddressId(null)
    setAddressAutocompleteValue("")
    setKeywordAddressSuggestions([])

    const loc = resolveExistingLocation()
    if (loc?.latitude && loc?.longitude) {
      initialMapCenterRef.current = [loc.latitude, loc.longitude]
      setMapPosition([loc.latitude, loc.longitude])
      applyGeocodedAddressToForm(loc, loc.formattedAddress || loc.address || currentAddress)
    }

    setShowAddressForm(true)
  }

  const handleEditAddressClick = (event, addr) => {
    event.stopPropagation()
    if (!isAuthenticated) {
      toast.info("Please login to edit an address")
      navigate("/user/auth/login")
      return
    }

    const id = getAddressId(addr)
    if (!id) return

    const coords = getAddressCoordinates(addr)
    setEditingAddressId(id)
    setAddressAutocompleteValue("")
    setKeywordAddressSuggestions([])
    setAddressFormData({
      street: addr.street || "",
      city: addr.city || "",
      state: addr.state || "",
      zipCode: addr.zipCode || "",
      additionalDetails: addr.additionalDetails || "",
      label: normalizeLabelForForm(addr.label),
      phone: addr.phone || "",
    })
    setCurrentAddress(
      [addr.additionalDetails, addr.street, addr.city, addr.state, addr.zipCode].filter(Boolean).join(", ")
    )

    if (coords) {
      initialMapCenterRef.current = [coords.lat, coords.lng]
      setMapPosition([coords.lat, coords.lng])
    }

    setShowAddressForm(true)
  }

  const handleDeleteAddressClick = (event, addr) => {
    event.stopPropagation()
    if (!isAuthenticated) {
      toast.info("Please login to delete an address")
      navigate("/user/auth/login")
      return
    }
    if (deleteCloseTimerRef.current) clearTimeout(deleteCloseTimerRef.current)
    setDeleteDialog({
      address: addr,
      phase: "enter",
    })
  }

  const confirmDeleteAddress = async () => {
    const id = getAddressId(deleteDialog?.address)
    if (!id) {
      closeDeleteDialog()
      return
    }

    setIsDeletingAddress(true)
    try {
      await deleteAddress(id)
      closeDeleteDialog()
      showAddressRemovedBrandedToast()
    } catch {
      toast.error("Failed to delete address")
    } finally {
      setIsDeletingAddress(false)
    }
  }

  const handleCancelAddressForm = () => {
    setAddressAutocompleteValue("")
    setKeywordAddressSuggestions([])
    setEditingAddressId(null)
    setShowAddressForm(false)
  }

  const scrollFieldIntoView = useCallback((fieldName) => {
    const el = manualFieldRefs.current?.[fieldName]
    if (!el) return
    setTimeout(() => {
      try {
        const scrollHost = formBodyRef.current
        if (!scrollHost) {
          el.scrollIntoView({ behavior: "smooth", block: "center" })
          return
        }
        const hostRect = scrollHost.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        const viewportHeight =
          typeof window !== "undefined" && window.visualViewport
            ? window.visualViewport.height
            : window.innerHeight
        const safeBottom = viewportHeight - keyboardInset - 90
        const overBy = elRect.bottom - safeBottom
        if (overBy > 0) {
          scrollHost.scrollTo({
            top: scrollHost.scrollTop + overBy + 24,
            behavior: "smooth",
          })
          return
        }
        if (elRect.top < hostRect.top + 70) {
          const upBy = hostRect.top + 70 - elRect.top
          scrollHost.scrollTo({
            top: Math.max(0, scrollHost.scrollTop - upBy - 12),
            behavior: "smooth",
          })
          return
        }
        el.scrollIntoView({ behavior: "smooth", block: "center" })
      } catch {
        // Ignore scrolling errors.
      }
    }, 120)
  }, [keyboardInset])

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

  const handleAddressFormSubmit = async (e) => {
    e.preventDefault()
    if (!isAuthenticated) {
       toast.info("Please login to save an address")
       navigate("/user/auth/login")
       return
    }
    if (!addressFormData.street || !addressFormData.city) {
      toast.error("Please fill required fields")
      return
    }
    setLoadingAddress(true)
    try {
      const payload = {
        ...addressFormData,
        label: addressFormData.label === "Work" ? "Office" : addressFormData.label,
        location: { type: "Point", coordinates: [mapPosition[1], mapPosition[0]] },
        latitude: mapPosition[0],
        longitude: mapPosition[1]
      }

      if (editingAddressId) {
        const updated = await updateAddress(editingAddressId, payload)
        if (updated) {
          try {
            const defaultAddr = addresses.find((a) => a.isDefault) || updated
            const isEditingDefault =
              String(getAddressId(defaultAddr)) === String(editingAddressId) ||
              Boolean(updated?.isDefault)
            if (isEditingDefault) {
              sessionStorage.setItem("manual_location_update", "true")
              localStorage.setItem("deliveryAddressMode", "saved")
              const locationData = {
                latitude: mapPosition[0],
                longitude: mapPosition[1],
                city: addressFormData.city || "",
                state: addressFormData.state || "",
                address: [addressFormData.street, addressFormData.city, addressFormData.state, addressFormData.zipCode]
                  .filter(Boolean)
                  .join(", "),
                area: addressFormData.additionalDetails || addressFormData.street || "",
                pincode: addressFormData.zipCode || "",
                formattedAddress: [addressFormData.street, addressFormData.city, addressFormData.state, addressFormData.zipCode]
                  .filter(Boolean)
                  .join(", "),
              }
              localStorage.setItem("userLocation", JSON.stringify(locationData))
              window.dispatchEvent(new CustomEvent("userLocationUpdated"))
            }
          } catch {}
          toast.success("Address updated")
          setEditingAddressId(null)
          setShowAddressForm(false)
        }
        return
      }

      const created = await addAddress(payload)
      if (created) {
        const id = getAddressId(created)
        if (id) await setDefaultAddress(id)
        try {
          sessionStorage.setItem("manual_location_update", "true");
          localStorage.setItem("deliveryAddressMode", "saved")
          // Keep active delivery location in sync with the exact map pin
          // (city text alone is not enough for zone / restaurant fetching).
          const locationData = {
            latitude: mapPosition[0],
            longitude: mapPosition[1],
            city: addressFormData.city || "",
            state: addressFormData.state || "",
            address: [addressFormData.street, addressFormData.city, addressFormData.state, addressFormData.zipCode]
              .filter(Boolean)
              .join(", "),
            area: addressFormData.additionalDetails || addressFormData.street || "",
            pincode: addressFormData.zipCode || "",
            formattedAddress: [addressFormData.street, addressFormData.city, addressFormData.state, addressFormData.zipCode]
              .filter(Boolean)
              .join(", "),
          }
          localStorage.setItem("userLocation", JSON.stringify(locationData))
          window.dispatchEvent(new CustomEvent("userLocationUpdated"))
        } catch {}
        handleBack()
      }
    } catch (error) {
      toast.error("Failed to save address")
    } finally {
      setLoadingAddress(false)
    }
  }

  useEffect(() => {
    if (!showAddressForm) return
    const updateBaseMapHeight = () => {
      const vh = typeof window !== "undefined" ? window.innerHeight : 800
      const target = Math.round(vh * 0.45)
      setBaseMapHeight(Math.max(260, Math.min(420, target)))
    }
    updateBaseMapHeight()
    window.addEventListener("resize", updateBaseMapHeight)
    return () => window.removeEventListener("resize", updateBaseMapHeight)
  }, [showAddressForm])

  useEffect(() => {
    if (!showAddressForm) return
    setFormScrollTop(0)
  }, [showAddressForm])

  useEffect(() => {
    if (!showAddressForm || typeof window === "undefined" || !window.visualViewport) return
    const viewport = window.visualViewport
    const updateKeyboardInset = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      setKeyboardInset(inset > 0 ? inset : 0)
    }
    updateKeyboardInset()
    viewport.addEventListener("resize", updateKeyboardInset)
    viewport.addEventListener("scroll", updateKeyboardInset)
    return () => {
      viewport.removeEventListener("resize", updateKeyboardInset)
      viewport.removeEventListener("scroll", updateKeyboardInset)
    }
  }, [showAddressForm])

  if (showAddressForm) {
    const mapHeight = baseMapHeight 
    return (
      <AnimatedPage
        className="fixed inset-0 z-50 bg-white dark:bg-[#0a0a0a] flex flex-col h-screen overflow-hidden"
      >
        <div className="flex-shrink-0 bg-white dark:bg-[#1a1a1a] border-b border-gray-100 dark:border-gray-800 px-4 py-3 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleCancelAddressForm} className="rounded-full">
            <ChevronLeft className="h-6 w-6" />
          </Button>
          <h1 className="text-lg font-bold">{editingAddressId ? "Edit delivery location" : "Add delivery location"}</h1>
        </div>

        <div
          ref={formBodyRef}
          onScroll={(e) => {
            setFormScrollTop(e.currentTarget.scrollTop)
          }}
          className="flex-1 overflow-y-auto"
          style={{ paddingBottom: `${96 + keyboardInset}px` }}
        >
          {/* Map Section - Parallax enabled */}
          <div
            className="flex-shrink-0 relative z-0"
            style={{ 
              height: `${mapHeight}px`,
              transform: `translateY(${formScrollTop * 0.4}px)`,
              opacity: clamp(1 - (formScrollTop / 500), 0.4, 1)
            }}
          >
            <div className="absolute top-4 left-4 right-4 z-20">
              <div className="relative group shadow-2xl">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Search className="h-5 w-5 text-neutral-400 dark:text-neutral-500" />
                </div>
                <Input
                  value={addressAutocompleteValue}
                  onChange={(e) => setAddressAutocompleteValue(e.target.value)}
                  placeholder="Search area, street, landmark..."
                  className={MAP_SEARCH_INPUT_CLASS}
                />
                {addressAutocompleteValue && (
                  <button 
                    onClick={() => setAddressAutocompleteValue("")}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                {isKeywordSearching && (
                  <div className="absolute right-10 top-1/2 -translate-y-1/2">
                     <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#DC2626] border-t-transparent" />
                  </div>
                )}

                {keywordAddressSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-[#1a1a1a] rounded-xl shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden z-30 animate-in fade-in slide-in-from-top-2 duration-200">
                    <p className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-50 dark:bg-gray-800/50">Suggestions</p>
                    {keywordAddressSuggestions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => handleSelectMapSuggestion(s)}
                        className="w-full px-4 py-3 flex items-start gap-3 hover:bg-[#DC2626]/5 dark:hover:bg-[#DC2626]/10 transition-colors text-left border-b border-gray-50 dark:border-gray-800 last:border-none"
                      >
                        <MapPin className="h-4 w-4 text-gray-400 mt-1 flex-shrink-0" />
                        <div className="min-w-0">
                           <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{s.display}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div ref={mapContainerRef} className="w-full h-full bg-gray-100 dark:bg-gray-800" />
            
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
               <div className="relative mb-8 flex flex-col items-center">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center p-2 mb-[-6px] shadow-sm animate-bounce-short">
                     <div className="w-6 h-6 rounded-full bg-green-600 flex items-center justify-center border-2 border-white">
                        <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                     </div>
                  </div>
                  <div className="w-1.5 h-6 bg-green-600 border-x border-white shadow-xl rounded-b-full shadow-green-900/40" />
                  <div className="w-3 h-1.5 bg-black/20 rounded-full blur-[1px] transform scale-x-150 absolute bottom-[-4px]" />
               </div>
            </div>

            {mapLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-sm z-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#DC2626]" />
              </div>
            )}
            
            <div className="absolute bottom-10 right-4 z-10 pointer-events-auto">
              <Button
                type="button"
                onClick={handleCenterMapOnMyLocation}
                disabled={mapGpsLoading}
                className="bg-white text-black hover:bg-gray-100 shadow-xl border border-gray-200 rounded-full h-12 px-6 disabled:opacity-70"
              >
                {mapGpsLoading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#DC2626] border-t-transparent mr-2" />
                ) : (
                  <Navigation className="h-4 w-4 mr-2 text-[#DC2626]" />
                )}
                {mapGpsLoading ? "Locating..." : "Use My Location"}
              </Button>
            </div>
          </div>

          <div className="relative bg-white dark:bg-[#0a0a0a] rounded-t-[32px] -mt-8 z-10 p-4 space-y-6 shadow-[0_-12px_24px_-10px_rgba(0,0,0,0.1)]">
            <div className="bg-[#DC2626]/5 dark:bg-[#DC2626]/10 border border-[#DC2626]/10 dark:border-[#DC2626]/20 rounded-xl p-4 flex gap-3">
               <MapPin className="h-5 w-5 text-[#DC2626] mt-0.5" />
               <div className="min-w-0">
                  <p className="text-xs font-bold text-[#DC2626] dark:text-[#DC2626]/80 uppercase mb-1">Pinnned Location</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2">{currentAddress || "Select a location on map"}</p>
               </div>
            </div>

            <div>
              <Label className="text-sm font-bold mb-2 block">Primary Address (Street / Area / Landmark)</Label>
              <Input 
                placeholder="Search or drag to update street/area" 
                value={addressFormData.street} 
                onChange={e => setAddressFormData({...addressFormData, street: e.target.value})}
                onFocus={() => scrollFieldIntoView("street")}
                ref={(el) => { manualFieldRefs.current.street = el }}
                className="mb-4 h-12 rounded-xl bg-gray-50 dark:bg-gray-800/50"
                required
              />

              <Label className="text-sm font-bold mb-2 block text-gray-700 dark:text-gray-300">Secondary Address (House No. / Flat / Floor)</Label>
              <Input 
                placeholder="E.g. Flat 402, 4th Floor, AppZeto Building" 
                value={addressFormData.additionalDetails} 
                onChange={e => setAddressFormData({...addressFormData, additionalDetails: e.target.value})}
                onFocus={() => scrollFieldIntoView("additionalDetails")}
                ref={(el) => { manualFieldRefs.current.additionalDetails = el }}
                className="h-12 rounded-xl border-gray-200 dark:border-gray-800 focus:ring-[#DC2626]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs mb-1 block">City</Label>
                <Input 
                  value={addressFormData.city} 
                  onChange={e => setAddressFormData({...addressFormData, city: e.target.value})} 
                  onFocus={() => scrollFieldIntoView("city")}
                  ref={(el) => { manualFieldRefs.current.city = el }}
                  className="h-12 rounded-xl"
                  required 
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">State</Label>
                <Input 
                  value={addressFormData.state} 
                  onChange={e => setAddressFormData({...addressFormData, state: e.target.value})} 
                  onFocus={() => scrollFieldIntoView("state")}
                  ref={(el) => { manualFieldRefs.current.state = el }}
                  className="h-12 rounded-xl"
                  required 
                />
              </div>
            </div>

            <div>
              <Label className="text-xs mb-1 block">Pincode / ZIP</Label>
              <Input 
                placeholder="Pincode" 
                value={addressFormData.zipCode || ""} 
                onChange={e => setAddressFormData({...addressFormData, zipCode: e.target.value})} 
                onFocus={() => scrollFieldIntoView("zipCode")}
                ref={(el) => { manualFieldRefs.current.zipCode = el }}
                className="h-12 rounded-xl"
              />
            </div>

            <div>
               <Label className="text-sm font-bold mb-2 block">Save address as</Label>
               <div className="flex gap-2">
                 {[
                   { value: "Home", label: "Home" },
                   { value: "Work", label: "Work" },
                   { value: "Other", label: "Other" },
                 ].map(({ value, label }) => {
                   const isSelected = addressFormData.label === value
                   return (
                     <button
                       key={value}
                       type="button"
                       onClick={() => setAddressFormData({ ...addressFormData, label: value })}
                       className={`flex-1 h-11 rounded-xl text-sm font-semibold transition-colors ${
                         isSelected
                           ? "bg-[#DC2626] text-white shadow-sm"
                           : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700"
                       }`}
                     >
                       {label}
                     </button>
                   )
                 })}
               </div>
            </div>
          </div>
        </div>

        <div
          className="fixed left-0 right-0 p-4 bg-white dark:bg-[#1a1a1a] border-t dark:border-gray-800 transition-[bottom] duration-150"
          style={{ bottom: `${keyboardInset}px` }}
        >
          <Button 
            className="w-full h-12 text-white font-bold text-lg" 
            style={{backgroundColor: '#DC2626'}}
            onClick={handleAddressFormSubmit}
            disabled={loadingAddress}
          >
            {loadingAddress ? (editingAddressId ? "Updating..." : "Saving...") : editingAddressId ? "Update Address" : "Save Address \u0026 Proceed"}
          </Button>
        </div>
      </AnimatedPage>
    )
  }

  return (
    <AnimatedPage className="min-h-screen bg-white dark:bg-[#0a0a0a] flex flex-col">
      <div className="flex-shrink-0 bg-white dark:bg-[#1a1a1a] border-b border-gray-100 dark:border-gray-800 px-4 py-4 flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={handleBack} className="rounded-full">
          <ChevronLeft className="h-6 w-6" />
        </Button>
        <h1 className="text-xl font-bold">Select Location</h1>
      </div>

      <div className="flex-1 overflow-y-auto pb-10">
        {/* Search Bar */}
        <div className="p-4 bg-white dark:bg-[#0a0a0a] border-b dark:border-gray-800/10">
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-neutral-400 dark:text-neutral-500" />
            </div>
            <Input
              value={addressAutocompleteValue}
              onChange={(e) => setAddressAutocompleteValue(e.target.value)}
              placeholder="Search for area, street name..."
              className={MAP_SEARCH_INPUT_CLASS}
            />
            {addressAutocompleteValue && (
              <button 
                onClick={() => setAddressAutocompleteValue("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Search Suggestions List */}
        {keywordAddressSuggestions.length > 0 && (
          <div className="mx-4 mt-2 mb-4 bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800 rounded-2xl shadow-xl overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-850 z-50 animate-in fade-in duration-200">
            {keywordAddressSuggestions.map((s) => {
              const title = s.display.split(",")[0] || s.display
              const subtitle = s.display.split(",").slice(1).join(",").trim() || s.display
              return (
                <button
                  key={s.id}
                  onClick={() => handleSelectOuterSuggestion(s)}
                  className="w-full px-4 py-3.5 flex items-start gap-3.5 hover:bg-[#DC2626]/5 dark:hover:bg-[#DC2626]/10 transition-colors text-left"
                >
                  <div className="h-9 w-9 rounded-full bg-red-50 dark:bg-red-950/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <MapPin className="h-4.5 w-4.5 text-[#DC2626]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50 truncate">{title}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">{subtitle}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-300 dark:text-zinc-600 mt-2.5 flex-shrink-0" />
                </button>
              )
            })}
          </div>
        )}

        {isKeywordSearching && (
          <div className="mx-4 mt-2 mb-4 p-4 flex items-center justify-center gap-2 text-xs text-zinc-500 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#DC2626] border-t-transparent" />
            Searching location...
          </div>
        )}

        {/* Action Rows: Use Current Location & Add Address */}
        <div className="bg-white dark:bg-[#0a0a0a] border-b border-zinc-100 dark:border-zinc-800/60 divide-y divide-zinc-100 dark:divide-zinc-800/40">
          <button 
            onClick={handleUseCurrentLocation}
            className="w-full flex items-center gap-4 py-4 px-6 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-all text-left"
          >
            <div className="h-10 w-10 rounded-full bg-red-50 dark:bg-red-950/10 flex items-center justify-center flex-shrink-0">
              <Crosshair className="h-5 w-5 text-[#DC2626]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[#DC2626] text-[15px]">Use current location</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-0.5">
                {currentAddress ? currentAddress.replace(/^[a-z0-9]{2,8}\+[a-z0-9]{0,3}[,\s]*/i, '').replace(/,\s*India$/, '') : "Enable GPS for accuracy"}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
          </button>

          <button 
            onClick={handleAddAddressClick}
            className="w-full flex items-center gap-4 py-4 px-6 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-all text-left"
          >
            <div className="h-10 w-10 rounded-full bg-red-50 dark:bg-red-950/10 flex items-center justify-center flex-shrink-0">
              <Plus className="h-5 w-5 text-[#DC2626]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[#DC2626] text-[15px]">Add Address</p>
            </div>
            <ChevronRight className="h-5 w-5 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
          </button>
        </div>

        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Saved Addresses</h2>
          </div>

          <div className="space-y-4">
            {profileLoading && addresses.length === 0 ? (
              // Skeleton loading state
              [1, 2].map((i) => (
                <div key={i} className="w-full flex items-start gap-4 p-4 bg-slate-50 dark:bg-[#1a1a1a] rounded-xl animate-pulse">
                  <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-800 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-1/4" />
                    <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-3/4" />
                  </div>
                </div>
              ))
            ) : addresses.length === 0 ? (
              <div className="text-center py-10 opacity-50">
                 <MapPin className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                 <p>No addresses saved yet</p>
              </div>
            ) : (
              addresses.map((addr, idx) => {
                const Icon = getAddressIcon(addr)
                const addressLine = [addr.additionalDetails, addr.street, addr.city, addr.state].filter(Boolean).join(", ").replace(/^[a-z0-9]{2,8}\+[a-z0-9]{0,3}[,\s]*/i, '')
                return (
                  <div
                    key={getAddressId(addr) || idx}
                    className="w-full flex items-start gap-3 p-4 bg-slate-50 dark:bg-[#1a1a1a] rounded-xl border border-transparent hover:border-[#DC2626]/15 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectSavedAddress(addr)}
                      className="flex flex-1 items-start gap-3 text-left min-w-0 pr-1"
                    >
                      <div className="h-10 w-10 rounded-full bg-white dark:bg-gray-800 flex items-center justify-center shadow-sm flex-shrink-0">
                        <Icon className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="font-bold text-gray-900 dark:text-white capitalize truncate">
                            {addr.label || "Address"}
                          </p>
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#DC2626]/10 flex-shrink-0">
                            <ChevronRight className="h-4 w-4 text-[#DC2626]" strokeWidth={2.5} />
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-1 pr-2">{addressLine}</p>
                      </div>
                    </button>
                    <div className="flex flex-col gap-1.5 pt-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={(e) => handleEditAddressClick(e, addr)}
                        className="h-9 w-9 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-500 hover:text-[#DC2626] hover:border-[#DC2626]/30 transition-colors"
                        aria-label="Edit address"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteAddressClick(e, addr)}
                        className="h-9 w-9 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-500 hover:text-red-600 hover:border-red-200 transition-colors"
                        aria-label="Delete address"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes bounce-short {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        .animate-bounce-short {
          animation: bounce-short 1s infinite ease-in-out;
        }
      `}</style>
      
      {isFetchingLocationState && (
        <div className="fixed inset-0 z-[10000] bg-white/60 dark:bg-[#0a0a0a]/60 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-300 pointer-events-auto">
          <div className="relative">
            <div className="w-10 h-10 border-[3px] border-gray-100/30 rounded-full"></div>
            <div className="absolute top-0 left-0 w-10 h-10 border-[3px] border-[#DC2626] border-t-transparent rounded-full animate-spin"></div>
          </div>
          <p className="mt-4 text-[13px] font-bold text-gray-800 dark:text-gray-200 tracking-tight animate-pulse">Fetching Location...</p>
        </div>
      )}

      {deleteDialog &&
        createPortal(
          <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-black/45"
              style={{
                opacity: deleteDialog.phase === "open" ? 1 : 0,
                transition: `opacity ${DELETE_MODAL_ANIM_MS}ms ease`,
              }}
              onClick={() => !isDeletingAddress && closeDeleteDialog()}
              aria-label="Close delete dialog"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-address-title"
              className="relative w-full max-w-[340px] rounded-3xl bg-white dark:bg-[#1a1a1a] shadow-2xl"
              style={getDeleteModalMotion(deleteDialog.phase)}
            >
              <div className="px-6 pt-8 pb-6">
                <div className="flex flex-col items-center text-center">
                  <div className="h-14 w-14 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center mb-4 ring-8 ring-red-50/60 dark:ring-red-950/20">
                    <Trash2 className="h-6 w-6 text-red-600" />
                  </div>
                  <div className="space-y-2 w-full">
                    <h2 id="delete-address-title" className="text-xl font-bold text-zinc-900 dark:text-white">
                      Delete address?
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      This action cannot be undone. You will need to add this address again.
                    </p>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 px-4 py-3.5 text-left">
                  <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1">
                    {deleteDialog.address?.label || "Address"}
                  </p>
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100 leading-relaxed break-words">
                    {formatAddressPreview(deleteDialog.address) || "Saved delivery address"}
                  </p>
                </div>

                <div className="mt-6 flex flex-col gap-3">
                  <Button
                    onClick={confirmDeleteAddress}
                    disabled={isDeletingAddress}
                    className="w-full h-12 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-[15px] shadow-sm"
                  >
                    {isDeletingAddress ? "Deleting..." : "Delete address"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={closeDeleteDialog}
                    disabled={isDeletingAddress}
                    className="w-full h-12 rounded-xl border border-zinc-200/80 dark:border-zinc-700 bg-zinc-100 hover:bg-zinc-200/90 dark:bg-zinc-800/90 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-100 font-semibold text-[15px] shadow-sm"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </AnimatedPage>
  )
}
