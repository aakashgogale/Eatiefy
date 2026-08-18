import { useState, useEffect, useRef, useMemo } from "react"
import { locationAPI, userAPI } from "@food/api"
import { useProfile } from "@food/context/ProfileContext"
import apiClient from "@food/api/axios"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

let globalCustomizationSettings = null
let customizationFetchPromise = null

const loadCustomizationSettings = async () => {
  if (globalCustomizationSettings) return globalCustomizationSettings
  if (customizationFetchPromise) return customizationFetchPromise

  // Try loading from localStorage first
  try {
    const saved = localStorage.getItem("ometto_customization_settings")
    if (saved) {
      globalCustomizationSettings = JSON.parse(saved)
    }
  } catch (e) {}

  // Fetch in background to update
  customizationFetchPromise = (async () => {
    try {
      const response = await apiClient.get("/food/public/customization-settings")
      const settings = response?.data?.data || response?.data
      if (settings) {
        globalCustomizationSettings = settings
        try {
          localStorage.setItem("ometto_customization_settings", JSON.stringify(settings))
        } catch (e) {}
        // Fire a custom event to notify components that customization settings have loaded
        window.dispatchEvent(new CustomEvent("customizationSettingsLoaded"))
        return settings
      }
    } catch (error) {
      debugError("Error fetching public customization settings:", error)
    } finally {
      customizationFetchPromise = null
    }
    return globalCustomizationSettings || {}
  })()

  return globalCustomizationSettings || customizationFetchPromise
}

// Start loading customization settings immediately in background
loadCustomizationSettings()

// BigDataCloud reverse-geocode is expensive/noisy if many components mount `useLocation()`.
// This module-level guard dedupes concurrent calls + rate-limits starts across the whole app.
const GLOBAL_GEOCODE_MIN_INTERVAL_MS = 60_000
const GLOBAL_GEOCODE_REUSE_DISTANCE_METERS = 75
const geoDistanceMeters = (lat1, lng1, lat2, lng2) => {
  if (
    typeof lat1 !== "number" ||
    typeof lng1 !== "number" ||
    typeof lat2 !== "number" ||
    typeof lng2 !== "number"
  ) {
    return Number.POSITIVE_INFINITY
  }
  const latDiff = lat2 - lat1
  const lngDiff = lng2 - lng1
  return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111320
}

let globalReverseGeocodeInFlight = null
let globalReverseGeocodeLastStartAt = 0
let globalReverseGeocodeLastCoords = { latitude: null, longitude: null }
let globalReverseGeocodeLastSuccess = null

// --- Global Loading State Management ---
let globalLocationLoading = false
const loadingListeners = new Set()

const setGlobalLocationLoading = (isLoading) => {
  globalLocationLoading = isLoading
  loadingListeners.forEach(listener => listener(isLoading))
}

// Default behavior: only resolve an address once on initial app load,
// then rely on localStorage/DB. Live watching is enabled only via explicit user action.
const AUTO_START_LIVE_WATCH = false

const SERVICE_CITIES = [
  "Indore",
  "Bhopal",
  "Ujjain",
  "Dewas",
  "Mhow",
  "Pithampur",
  "Rau",
]

/**
 * Prefer metro/service city over village/locality (e.g. Dhabli → Indore)
 * so restaurant APIs filtered by city don't return empty lists.
 */
export function resolveServiceCity({
  locality = "",
  adminArea2 = "",
  formattedAddress = "",
  fallback = "Indore",
} = {}) {
  const findKnown = (text) => {
    const match = String(text || "").match(
      new RegExp(`\\b(${SERVICE_CITIES.join("|")})\\b`, "i"),
    )
    if (!match) return ""
    const hit = match[1]
    return (
      SERVICE_CITIES.find((city) => city.toLowerCase() === hit.toLowerCase()) ||
      hit
    )
  }

  const fromFormatted = findKnown(formattedAddress)
  if (fromFormatted) return fromFormatted

  const localityTrim = String(locality || "").trim()
  if (localityTrim) {
    const knownLocality = SERVICE_CITIES.find(
      (city) => city.toLowerCase() === localityTrim.toLowerCase(),
    )
    if (knownLocality) return knownLocality
  }

  const fromAdmin = findKnown(adminArea2)
  if (fromAdmin) return fromAdmin

  return localityTrim || fallback
}

const reverseGeocodeDirect = async (latitude, longitude) => {
  const now = Date.now()
  const movedMeters = geoDistanceMeters(
    globalReverseGeocodeLastCoords.latitude,
    globalReverseGeocodeLastCoords.longitude,
    latitude,
    longitude
  )
  const timeSinceLastStart = now - globalReverseGeocodeLastStartAt

  // If we recently geocoded a nearby point, reuse the last successful payload (no network).
  if (
    globalReverseGeocodeLastSuccess &&
    movedMeters < GLOBAL_GEOCODE_REUSE_DISTANCE_METERS &&
    timeSinceLastStart < GLOBAL_GEOCODE_MIN_INTERVAL_MS
  ) {
    return globalReverseGeocodeLastSuccess
  }

  // If another caller is already fetching, wait for it when it's "close enough".
  if (globalReverseGeocodeInFlight) {
    const inFlightMoved = geoDistanceMeters(
      globalReverseGeocodeLastCoords.latitude,
      globalReverseGeocodeLastCoords.longitude,
      latitude,
      longitude
    )
    if (inFlightMoved < GLOBAL_GEOCODE_REUSE_DISTANCE_METERS) {
      try {
        return await globalReverseGeocodeInFlight
      } catch {
        // fall through to a fresh attempt
      }
    }
  }

  globalReverseGeocodeLastStartAt = now
  globalReverseGeocodeLastCoords = { latitude, longitude }

  const run = (async () => {
    try {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 3000) // Faster timeout

      const res = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
        { signal: controller.signal }
      )

      const data = await res.json()

      // Extract parts from formatted address for better area/city isolation
      const formattedAddress = data.formattedAddress || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
      const addrParts = formattedAddress.split(',').map(p => p.trim()).filter(Boolean)
      
      // Dig into informative locations if available
      let area = data.subLocality || ""
      if (!area && data.localityInfo?.informative) {
        // Find sublocality in informative array
        const infoArea = data.localityInfo.informative.find(i => 
          i.description?.toLowerCase().includes("sublocality") || 
          i.description?.toLowerCase().includes("neighborhood")
        )
        if (infoArea) area = infoArea.name
      }

      if (!area && addrParts.length >= 1) {
        // Find the first part that isn't the city or state
        const cityLower = (data.city || data.locality || "").toLowerCase()
        const stateLower = (data.principalSubdivision || "").toLowerCase()
        
        for (const part of addrParts) {
          const partLower = part.toLowerCase()
          if (partLower !== cityLower && 
              partLower !== stateLower && 
              !/^-?\d/.test(part) && 
              part.length > 2) {
            area = part
            break
          }
        }
      }

      const city = resolveServiceCity({
        locality: data.city || data.locality || "",
        adminArea2: Array.isArray(data?.localityInfo?.administrative)
          ? data.localityInfo.administrative.find((entry) => {
              const desc = String(entry?.description || "").toLowerCase()
              return (
                desc.includes("city") ||
                desc.includes("district") ||
                desc.includes("municipality") ||
                desc.includes("order3") ||
                desc.includes("order 3")
              )
            })?.name || ""
          : "",
        formattedAddress,
        fallback: addrParts.length > 1 ? addrParts[addrParts.length - 2] : "Indore",
      })

      // Keep village/locality as area when city was upgraded to metro name
      const localityName = String(data.locality || data.city || "").trim()
      if (
        !area &&
        localityName &&
        localityName.toLowerCase() !== String(city).toLowerCase()
      ) {
        area = localityName
      }

      const value = {
        city: city,
        state: data.principalSubdivision || (addrParts.length > 0 ? addrParts[addrParts.length - 1] : ""),
        country: data.countryName || "",
        area: area,
        mainTitle: area || city, // Useful for components that prefer a single title
        address: formattedAddress,
        formattedAddress: formattedAddress,
      }

      globalReverseGeocodeLastSuccess = value
      return value
    } catch {
      const fallback = {
        city: "Current Location",
        address: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        formattedAddress: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      }
      // Don't cache failures as "success" (keeps retries possible), but still return something usable.
      return fallback
    } finally {
      globalReverseGeocodeInFlight = null
    }
  })()

  globalReverseGeocodeInFlight = run
  return run
}

// TEMPORARY DEFAULT: Indore (Vijay Nagar) - for App Store submission
// Remove this constant and revert useLocation initial state when reverting
const TEMPORARY_DEFAULT_INDORE_LOCATION = {
  latitude: 22.7533,
  longitude: 75.8937,
  city: "Indore",
  state: "Madhya Pradesh",
  country: "India",
  area: "Vijay Nagar",
  address: "Vijay Nagar, Indore, Madhya Pradesh",
  formattedAddress: "Vijay Nagar, Indore, Madhya Pradesh",
}

export const isPlaceholderLocation = (loc) => {
  if (!loc || typeof loc !== "object") return true
  const lat = Number(loc.latitude)
  const lng = Number(loc.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true
  const formatted = String(loc.formattedAddress || "").trim().toLowerCase()
  const address = String(loc.address || "").trim().toLowerCase()
  const city = String(loc.city || "").trim().toLowerCase()
  if (formatted === "select location" || address === "select location") return true
  if (city === "current location" || city === "select location") return true
  return false
}

export const hasValidStoredUserLocation = () => {
  try {
    const raw = localStorage.getItem("userLocation")
    if (!raw) return false
    return !isPlaceholderLocation(JSON.parse(raw))
  } catch {
    return false
  }
}

let pageLoadAutoRefreshStarted = false
let pageLoadDeliveryModeBootstrapped = false
let cachedIsNewAppSession = false
let autoLocationRefreshInFlight = null
const AUTO_LOCATION_REFRESH_COOLDOWN_MS = 15_000
let lastAutoLocationRefreshAt = 0

/** Marks an active tab after boot; not used alone for stickiness (Chrome can restore it). */
export const LOCATION_APP_SESSION_KEY = "ometto_location_session"

function isBrowserPageReload() {
  try {
    return (
      performance.getEntriesByType("navigation")[0]?.type === "reload" ||
      window.performance?.navigation?.type === 1
    )
  } catch {
    return false
  }
}

/**
 * Stick selected delivery location only on F5/reload.
 * New tab / cold open / reopened closed tab → force current GPS
 * (sessionStorage alone is unreliable — Chrome often restores it on reopen).
 * @returns {{ isNewAppSession: boolean }}
 */
function bootstrapLocationModeOnAppOpen() {
  if (pageLoadDeliveryModeBootstrapped) {
    return { isNewAppSession: cachedIsNewAppSession }
  }
  pageLoadDeliveryModeBootstrapped = true

  if (isBrowserPageReload()) {
    cachedIsNewAppSession = false
    try {
      sessionStorage.setItem(LOCATION_APP_SESSION_KEY, "1")
    } catch {
      /* ignore */
    }
    return { isNewAppSession: false }
  }

  cachedIsNewAppSession = true
  try {
    sessionStorage.setItem(LOCATION_APP_SESSION_KEY, "1")
    localStorage.setItem("deliveryAddressMode", "current")
  } catch {
    /* ignore */
  }
  return { isNewAppSession: true }
}

const runDedupedAutoRefresh = (refreshFn) => {
  const now = Date.now()
  if (now - lastAutoLocationRefreshAt < AUTO_LOCATION_REFRESH_COOLDOWN_MS && autoLocationRefreshInFlight) {
    return autoLocationRefreshInFlight
  }
  lastAutoLocationRefreshAt = now
  autoLocationRefreshInFlight = Promise.resolve(refreshFn()).finally(() => {
    autoLocationRefreshInFlight = null
  })
  return autoLocationRefreshInFlight
}

export function useLocation() {
  // Must run before addressMode state init so first paint knows session mode.
  const { isNewAppSession } = bootstrapLocationModeOnAppOpen()

  const [isDefaultLocationMode, setIsDefaultLocationMode] = useState(() => {
    try {
      const saved = localStorage.getItem("ometto_customization_settings")
      if (saved) {
        return JSON.parse(saved).default_location_enabled === true
      }
    } catch {}
    return false
  })

  const [location, setLocation] = useState(() => {
    try {
      const cached = localStorage.getItem("userLocation")
      if (cached) return JSON.parse(cached)
      
      const savedSettings = localStorage.getItem("ometto_customization_settings")
      const isEnabled = savedSettings ? JSON.parse(savedSettings).default_location_enabled === true : false
      return isEnabled ? TEMPORARY_DEFAULT_INDORE_LOCATION : null
    } catch {
      const savedSettings = localStorage.getItem("ometto_customization_settings")
      const isEnabled = savedSettings ? JSON.parse(savedSettings).default_location_enabled === true : false
      return isEnabled ? TEMPORARY_DEFAULT_INDORE_LOCATION : null
    }
  })
  const [loading, setLoading] = useState(globalLocationLoading)

  useEffect(() => {
    const handleSettingsLoaded = () => {
      try {
        const saved = localStorage.getItem("ometto_customization_settings")
        if (saved) {
          const enabled = JSON.parse(saved).default_location_enabled === true
          setIsDefaultLocationMode(enabled)
          
          if (!enabled) {
            // If default location mode is disabled, check if the current userLocation is the default Indore one
            const currentStored = localStorage.getItem("userLocation")
            if (currentStored) {
              const parsed = JSON.parse(currentStored)
              if (parsed?.latitude === TEMPORARY_DEFAULT_INDORE_LOCATION.latitude && 
                  parsed?.longitude === TEMPORARY_DEFAULT_INDORE_LOCATION.longitude) {
                // Clear it so the original flow triggers location prompt
                localStorage.removeItem("userLocation")
                setLocation(null)
                debugLog("?? Default location mode disabled. Cleared default Indore location from storage.")
              }
            }
          }
        }
      } catch {}
    }
    
    window.addEventListener("customizationSettingsLoaded", handleSettingsLoaded)
    handleSettingsLoaded()

    return () => {
      window.removeEventListener("customizationSettingsLoaded", handleSettingsLoaded)
    }
  }, [])

  useEffect(() => {
    loadingListeners.add(setLoading)
    return () => loadingListeners.delete(setLoading)
  }, [])

  const [error, setError] = useState(null)
  const [permissionGranted, setPermissionGranted] = useState(false)

  const watchIdRef = useRef(null)
  const updateTimerRef = useRef(null)
  const prevLocationCoordsRef = useRef({ latitude: null, longitude: null })
  const lastGeocodeAtRef = useRef(0)
  const lastGeocodedCoordsRef = useRef({ latitude: null, longitude: null })
  const lastResolvedAddressRef = useRef(null)
  const lastDbLocationFetchAtRef = useRef(0)
  const lastDbLocationRef = useRef(null)
  const lastDbUpdateAtRef = useRef(0)
  const lastDbUpdatedCoordsRef = useRef({ latitude: null, longitude: null })

  const GEOCODE_REUSE_DISTANCE_METERS = 120
  const GEOCODE_REUSE_TIME_MS = 10 * 60 * 1000
  const DB_LOCATION_FETCH_TTL_MS = 2 * 60 * 1000
  const DB_UPDATE_MIN_DISTANCE_METERS = 30
  const DB_UPDATE_MIN_INTERVAL_MS = 90 * 1000
  const getDistanceMeters = (lat1, lng1, lat2, lng2) => {
    if (
      typeof lat1 !== "number" ||
      typeof lng1 !== "number" ||
      typeof lat2 !== "number" ||
      typeof lng2 !== "number"
    ) {
      return Number.POSITIVE_INFINITY
    }
    const latDiff = lat2 - lat1
    const lngDiff = lng2 - lng1
    return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111320
  }

  /* ===================== DB UPDATE (LIVE LOCATION TRACKING) ===================== */
  const updateLocationInDB = async (locationData) => {
    try {
      // Check if location has placeholder values - don't save placeholders
      const hasPlaceholder =
        locationData?.city === "Current Location" ||
        locationData?.address === "Select location" ||
        locationData?.formattedAddress === "Select location" ||
        (!locationData?.city && !locationData?.address && !locationData?.formattedAddress);

      if (hasPlaceholder) {
        debugLog("?? Skipping DB update - location contains placeholder values:", {
          city: locationData?.city,
          address: locationData?.address,
          formattedAddress: locationData?.formattedAddress
        });
        return;
      }

      // Check if user is authenticated before trying to update DB
      const userToken = localStorage.getItem('user_accessToken') || localStorage.getItem('accessToken')
      if (!userToken || userToken === 'null' || userToken === 'undefined') {
        // User not logged in - skip DB update, just use localStorage
        debugLog("?? User not authenticated, skipping DB update (using localStorage only)")
        return
      }

      const dbUpdateDistanceMeters = getDistanceMeters(
        lastDbUpdatedCoordsRef.current.latitude,
        lastDbUpdatedCoordsRef.current.longitude,
        locationData.latitude,
        locationData.longitude
      )
      const dbUpdateAgeMs = Date.now() - lastDbUpdateAtRef.current
      const shouldSkipDbUpdate =
        dbUpdateDistanceMeters < DB_UPDATE_MIN_DISTANCE_METERS &&
        dbUpdateAgeMs < DB_UPDATE_MIN_INTERVAL_MS
      if (shouldSkipDbUpdate) {
        debugLog("Skipping DB update (small movement + recent update):", {
          dbUpdateDistanceMeters: dbUpdateDistanceMeters.toFixed(1),
          dbUpdateAgeMs
        })
        return
      }

      // Prepare complete location data for database storage
      const locationPayload = {
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        address: locationData.address || "",
        city: locationData.city || "",
        state: locationData.state || "",
        area: locationData.area || "",
        formattedAddress: locationData.formattedAddress || locationData.address || "",
      }

      // Add optional fields if available
      if (locationData.accuracy !== undefined && locationData.accuracy !== null) {
        locationPayload.accuracy = locationData.accuracy
      }
      if (locationData.postalCode) {
        locationPayload.postalCode = locationData.postalCode
      }
      if (locationData.street) {
        locationPayload.street = locationData.street
      }
      if (locationData.streetNumber) {
        locationPayload.streetNumber = locationData.streetNumber
      }

      debugLog("?? Updating live location in database:", {
        coordinates: `${locationPayload.latitude}, ${locationPayload.longitude}`,
        formattedAddress: locationPayload.formattedAddress,
        city: locationPayload.city,
        area: locationPayload.area,
        accuracy: locationPayload.accuracy
      })

      await userAPI.updateLocation(locationPayload)
      lastDbUpdatedCoordsRef.current = {
        latitude: locationPayload.latitude,
        longitude: locationPayload.longitude
      }
      lastDbUpdateAtRef.current = Date.now()

      debugLog("? Live location successfully stored in database")
    } catch (err) {
      // Only log non-network and non-auth errors
      if (err.code !== "ERR_NETWORK" && err.response?.status !== 404 && err.response?.status !== 401) {
        debugError("? DB location update error:", err)
      } else if (err.response?.status === 404 || err.response?.status === 401) {
        // 404 or 401 means user not authenticated or route doesn't exist
        // Silently skip - this is expected for non-authenticated users
        debugLog("?? Location update skipped (user not authenticated or route not available)")
      }
    }
  }

  // Google Places API removed - using OLA Maps only

  /* Reverse geocode via backend proxy so the Maps key never hits the browser Network tab. */
  const reverseGeocodeWithGoogleMaps = async (latitude, longitude, _options = {}) => {
    try {
      debugLog("?? Fetching exact address from Google Maps (proxy) for:", latitude, longitude)

      const { geocodeAPI } = await import("@food/api")
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)

      let response
      try {
        response = await geocodeAPI.reverse(latitude, longitude, {}, { signal: controller.signal })
      } finally {
        clearTimeout(timeoutId)
      }

      const data = response?.data?.data

      if (data?.status !== "OK" || !data.results || data.results.length === 0) {
        debugWarn("?? Google Geocoding failed or returned no results:", data?.status)
        return reverseGeocodeDirect(latitude, longitude)
      }

      // We use the first result which is usually the most specific (premise/street address)
      const result = data.results[0]
      const components = result.address_components
      
      const getComponent = (types) => {
        const comp = components.find(c => types.some(t => c.types.includes(t)))
        return comp ? comp.long_name : ""
      }

      // Extract parts
      const streetNumber = getComponent(["street_number"])
      const route = getComponent(["route"])
      const sublocality = getComponent(["sublocality_level_1"]) || getComponent(["sublocality"])
      const neighborhood = getComponent(["neighborhood"])
      const locality = getComponent(["locality"])
      const adminArea2 = getComponent(["administrative_area_level_2"])
      const state = getComponent(["administrative_area_level_1"])
      const country = getComponent(["country"])
      const pincode = getComponent(["postal_code"])

      // Prefer Indore (etc.) over village locality like Dhabli so restaurant city filter works
      const city = resolveServiceCity({
        locality,
        adminArea2,
        formattedAddress: result.formatted_address,
        fallback: "Indore",
      })
      
      // Determine area - prioritize sublocality/neighborhood for "Exact" feel
      let area = sublocality || neighborhood || ""
      if (
        !area &&
        locality &&
        locality.toLowerCase() !== String(city).toLowerCase()
      ) {
        area = locality
      }
      
      // If we have building/apartment info (premise/subpremise)
      const premise = getComponent(["premise"]) || getComponent(["subpremise"]) || getComponent(["point_of_interest"])

      // Construct a clean display address
      // e.g. "B-204, Silver Oak Apartment, New Palasia"
      let addressParts = []
      if (premise) addressParts.push(premise)
      if (streetNumber && route) addressParts.push(`${streetNumber}, ${route}`)
      else if (route) addressParts.push(route)
      if (area) addressParts.push(area)
      
      const displayAddress = addressParts.join(", ") || result.formatted_address.split(",")[0]

      const value = {
        city: city || "Indore",
        state: state,
        country: country,
        area: area,
        pincode: pincode,
        mainTitle: area || city,
        address: displayAddress,
        formattedAddress: result.formatted_address,
        premise: premise || "",
        streetNumber: streetNumber,
        route: route,
        placeId: result.place_id
      }

      debugLog("? Google Geocoding successful (Exact):", value)
      return value
    } catch (err) {
      debugError("?? Google Geocoding error:", err.message)
      return reverseGeocodeDirect(latitude, longitude)
    }
  }


  /* ===================== OLA MAPS REVERSE GEOCODE (DEPRECATED - KEPT FOR FALLBACK) ===================== */
  const reverseGeocodeWithOLAMaps = async (latitude, longitude) => {
    try {
      debugLog("?? Fetching address from OLA Maps for:", latitude, longitude)

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("OLA Maps API timeout")), 10000)
      )

      const apiPromise = locationAPI.reverseGeocode(latitude, longitude)
      const res = await Promise.race([apiPromise, timeoutPromise])

      // Log full response for debugging
      debugLog("?? Full OLA Maps API Response:", JSON.stringify(res?.data, null, 2))

      // Check if response is valid
      if (!res || !res.data) {
        throw new Error("Invalid response from OLA Maps API")
      }

      // Check if API call was successful
      if (res.data.success === false) {
        throw new Error(res.data.message || "OLA Maps API returned error")
      }

      // Backend returns: { success: true, data: { results: [{ formatted_address, address_components: { city, state, country, area } }] } }
      const backendData = res?.data?.data || {}

      // Debug: Check backend data structure
      debugLog("?? Backend data structure:", {
        hasResults: !!backendData.results,
        hasResult: !!backendData.result,
        keys: Object.keys(backendData),
        dataType: typeof backendData,
        backendData: JSON.stringify(backendData, null, 2).substring(0, 500) // First 500 chars
      })

      // Handle different OLA Maps response structures
      // Backend processes OLA Maps response and returns: { results: [{ formatted_address, address_components: { city, state, area } }] }
      let result = null;
      if (backendData.results && Array.isArray(backendData.results) && backendData.results.length > 0) {
        result = backendData.results[0];
        debugLog("? Using results[0] from backend")
      } else if (backendData.result && Array.isArray(backendData.result) && backendData.result.length > 0) {
        result = backendData.result[0];
        debugLog("? Using result[0] from backend")
      } else if (backendData.results && !Array.isArray(backendData.results)) {
        result = backendData.results;
        debugLog("? Using results object from backend")
      } else {
        result = backendData;
        debugLog("?? Using backendData directly (fallback)")
      }

      if (!result) {
        debugWarn("?? No result found in backend data")
        result = {};
      }

      debugLog("?? Parsed result:", {
        hasFormattedAddress: !!result.formatted_address,
        hasAddressComponents: !!result.address_components,
        formattedAddress: result.formatted_address,
        addressComponents: result.address_components
      })

      // Extract address_components - handle both object and array formats
      let addressComponents = {};
      if (result.address_components) {
        if (Array.isArray(result.address_components)) {
          // Google Maps style array
          result.address_components.forEach(comp => {
            const types = comp.types || [];
            if (types.includes('sublocality') || types.includes('sublocality_level_1')) {
              addressComponents.area = comp.long_name || comp.short_name;
            } else if (types.includes('neighborhood') && !addressComponents.area) {
              addressComponents.area = comp.long_name || comp.short_name;
            } else if (types.includes('locality')) {
              addressComponents.city = comp.long_name || comp.short_name;
            } else if (types.includes('administrative_area_level_1')) {
              addressComponents.state = comp.long_name || comp.short_name;
            } else if (types.includes('country')) {
              addressComponents.country = comp.long_name || comp.short_name;
            }
          });
        } else {
          // Object format
          addressComponents = result.address_components;
        }
      } else if (result.components) {
        addressComponents = result.components;
      }

      debugLog("?? Parsed result structure:", {
        result,
        addressComponents,
        hasArrayComponents: Array.isArray(result.address_components),
        hasObjectComponents: !Array.isArray(result.address_components) && !!result.address_components
      })

      // Extract address details - try multiple possible response structures
      let city = addressComponents?.city ||
        result?.city ||
        result?.locality ||
        result?.address_components?.city ||
        ""

      let state = addressComponents?.state ||
        result?.state ||
        result?.administrative_area_level_1 ||
        result?.address_components?.state ||
        ""

      let country = addressComponents?.country ||
        result?.country ||
        result?.country_name ||
        result?.address_components?.country ||
        ""

      let formattedAddress = result?.formatted_address ||
        result?.formattedAddress ||
        result?.address ||
        ""

      // PRIORITY 1: Extract area from formatted_address FIRST (most reliable for Indian addresses)
      // Indian address format: "Area, City, State" e.g., "New Palasia, Indore, Madhya Pradesh"
      // ALWAYS try formatted_address FIRST - it's the most reliable source and preserves full names like "New Palasia"
      let area = ""
      if (formattedAddress) {
        const addressParts = formattedAddress.split(',').map(part => part.trim()).filter(part => part.length > 0)

        debugLog("?? Parsing formatted address for area:", { formattedAddress, addressParts, city, state, currentArea: area })

        // ZOMATO-STYLE: If we have 3+ parts, first part is ALWAYS the area/locality
        // Format: "New Palasia, Indore, Madhya Pradesh" -> area = "New Palasia"
        if (addressParts.length >= 3) {
          const firstPart = addressParts[0]
          const secondPart = addressParts[1] // Usually city
          const thirdPart = addressParts[2]  // Usually state

          // First part is the area (e.g., "New Palasia")
          // Second part is usually city (e.g., "Indore")
          // Third part is usually state (e.g., "Madhya Pradesh")
          if (firstPart && firstPart.length > 2 && firstPart.length < 50) {
            // Make sure first part is not the same as city or state
            const firstLower = firstPart.toLowerCase()
            const cityLower = (city || secondPart || "").toLowerCase()
            const stateLower = (state || thirdPart || "").toLowerCase()

            if (firstLower !== cityLower &&
              firstLower !== stateLower &&
              !firstPart.match(/^\d+/) && // Not a number
              !firstPart.match(/^\d+\s*(km|m|meters?)$/i) && // Not a distance
              !firstLower.includes("district") && // Not a district name
              !firstLower.includes("city")) { // Not a city name
              area = firstPart
              debugLog("??? EXTRACTED AREA from formatted address (3+ parts):", area)

              // Also update city if second part matches better
              if (secondPart && (!city || secondPart.toLowerCase() !== city.toLowerCase())) {
                city = secondPart
              }
              // Also update state if third part matches better
              if (thirdPart && (!state || thirdPart.toLowerCase() !== state.toLowerCase())) {
                state = thirdPart
              }
            }
          }
        } else if (addressParts.length === 2 && !area) {
          // Two parts: Could be "Area, City" or "City, State"
          const firstPart = addressParts[0]
          const secondPart = addressParts[1]

          // Check if first part is city (if we already have city name)
          const isFirstCity = city && firstPart.toLowerCase() === city.toLowerCase()

          // If first part is NOT the city, it's likely the area
          if (!isFirstCity &&
            firstPart.length > 2 &&
            firstPart.length < 50 &&
            !firstPart.toLowerCase().includes("district") &&
            !firstPart.toLowerCase().includes("city") &&
            !firstPart.match(/^\d+/)) {
            area = firstPart
            debugLog("? Extracted area from 2 part address:", area)
            // Update city if second part exists
            if (secondPart && !city) {
              city = secondPart
            }
          } else if (isFirstCity) {
            // First part is city, second part might be state
            // No area in this case, but update state if needed
            if (secondPart && !state) {
              state = secondPart
            }
          }
        } else if (addressParts.length === 1 && !area) {
          // Single part - could be just city or area
          const singlePart = addressParts[0]
          if (singlePart && singlePart.length > 2 && singlePart.length < 50) {
            // If it doesn't match city exactly, it might be an area
            if (!city || singlePart.toLowerCase() !== city.toLowerCase()) {
              // Don't use as area if it looks like a city name (contains common city indicators)
              if (!singlePart.toLowerCase().includes("city") &&
                !singlePart.toLowerCase().includes("district")) {
                // Could be area, but be cautious - only use if we're sure
                debugLog("?? Single part address - ambiguous, not using as area:", singlePart)
              }
            }
          }
        }
      }

      // PRIORITY 2: If still no area from formatted_address, try from address_components (fallback)
      // Note: address_components might have incomplete/truncated names like "Palacia" instead of "New Palasia"
      // So we ALWAYS prefer formatted_address extraction over address_components
      if (!area && addressComponents) {
        // Try all possible area fields (but exclude state and generic names!)
        const possibleAreaFields = [
          addressComponents.sublocality,
          addressComponents.sublocality_level_1,
          addressComponents.neighborhood,
          addressComponents.sublocality_level_2,
          addressComponents.locality,
          addressComponents.area, // Check area last
        ].filter(field => {
          // Filter out invalid/generic area names
          if (!field) return false
          const fieldLower = field.toLowerCase()
          return fieldLower !== state.toLowerCase() &&
            fieldLower !== city.toLowerCase() &&
            !fieldLower.includes("district") &&
            !fieldLower.includes("city") &&
            field.length > 3 // Minimum length
        })

        if (possibleAreaFields.length > 0) {
          const fallbackArea = possibleAreaFields[0]
          // CRITICAL: If formatted_address exists and has a different area, prefer formatted_address
          // This ensures "New Palasia" from formatted_address beats "Palacia" from address_components
          if (formattedAddress && formattedAddress.toLowerCase().includes(fallbackArea.toLowerCase())) {
            // formatted_address contains the fallback area, so it's likely more complete
            // Try one more time to extract from formatted_address
            debugLog("?? address_components has area but formatted_address might have full name, re-checking formatted_address")
          } else {
            area = fallbackArea
            debugLog("? Extracted area from address_components (fallback):", area)
          }
        }
      }

      // Also check address_components array structure (Google Maps style)
      if (!area && result?.address_components && Array.isArray(result.address_components)) {
        const components = result.address_components
        // Find sublocality or neighborhood in the components array
        const sublocality = components.find(comp =>
          comp.types?.includes('sublocality') ||
          comp.types?.includes('sublocality_level_1') ||
          comp.types?.includes('neighborhood')
        )
        if (sublocality?.long_name || sublocality?.short_name) {
          area = sublocality.long_name || sublocality.short_name
        }
      }

      // FINAL FALLBACK: If area is still empty, force extract from formatted_address
      // This is the last resort - be very aggressive (ZOMATO-STYLE)
      // Even if formatted_address only has 2 parts (City, State), try to extract area
      if (!area && formattedAddress) {
        const parts = formattedAddress.split(',').map(p => p.trim()).filter(p => p.length > 0)
        debugLog("?? Final fallback: Parsing formatted_address for area", { parts, city, state })

        if (parts.length >= 2) {
          const potentialArea = parts[0]
          // Very lenient check - if it's not obviously city/state, use it as area
          const potentialAreaLower = potentialArea.toLowerCase()
          const cityLower = (city || "").toLowerCase()
          const stateLower = (state || "").toLowerCase()

          if (potentialArea &&
            potentialArea.length > 2 &&
            potentialArea.length < 50 &&
            !potentialArea.match(/^\d+/) &&
            potentialAreaLower !== cityLower &&
            potentialAreaLower !== stateLower &&
            !potentialAreaLower.includes("district") &&
            !potentialAreaLower.includes("city")) {
            area = potentialArea
            debugLog("??? FORCE EXTRACTED area (final fallback):", area)
          }
        }
      }

      // Final validation and logging
      debugLog("??? FINAL PARSED OLA Maps response:", {
        city,
        state,
        country,
        area,
        formattedAddress,
        hasArea: !!area,
        areaLength: area?.length || 0
      })

      // CRITICAL: If formattedAddress has only 2 parts, OLA Maps didn't provide sublocality
      // Try to get more detailed location using coordinates-based search
      if (!area && formattedAddress) {
        const parts = formattedAddress.split(',').map(p => p.trim()).filter(p => p.length > 0)

        // If we have 3+ parts, extract area from first part
        if (parts.length >= 3) {
          // ZOMATO PATTERN: "New Palasia, Indore, Madhya Pradesh"
          // First part = Area, Second = City, Third = State
          const potentialArea = parts[0]
          // Validate it's not state, city, or generic names
          const potentialAreaLower = potentialArea.toLowerCase()
          if (potentialAreaLower !== state.toLowerCase() &&
            potentialAreaLower !== city.toLowerCase() &&
            !potentialAreaLower.includes("district") &&
            !potentialAreaLower.includes("city")) {
            area = potentialArea
            if (!city && parts[1]) city = parts[1]
            if (!state && parts[2]) state = parts[2]
            debugLog("??? ZOMATO-STYLE EXTRACTION:", { area, city, state })
          }
        } else if (parts.length === 2) {
          // Only 2 parts: "Indore, Madhya Pradesh" - area is missing
          // OLA Maps API didn't provide sublocality
          debugWarn("?? Only 2 parts in address - OLA Maps didn't provide sublocality")
          // Try to extract from other fields in the response
          // Check if result has any other location fields
          if (result.locality && result.locality !== city) {
            area = result.locality
            debugLog("? Using locality as area:", area)
          } else if (result.neighborhood) {
            area = result.neighborhood
            debugLog("? Using neighborhood as area:", area)
          } else {
            // Leave area empty - will show city instead
            area = ""
          }
        }
      }

      // FINAL VALIDATION: Never use state as area!
      if (area && state && area.toLowerCase() === state.toLowerCase()) {
        debugWarn("?????? REJECTING area (same as state):", area)
        area = ""
      }

      // FINAL VALIDATION: Reject district names
      if (area && area.toLowerCase().includes("district")) {
        debugWarn("?????? REJECTING area (contains district):", area)
        area = ""
      }

      // If we have a valid formatted address or city, return it
      if (formattedAddress || city) {
        const finalLocation = {
          city: city || "Unknown City",
          state: state || "",
          country: country || "",
          area: area || "", // Area is CRITICAL - must be extracted
          address: formattedAddress || `${city || "Current Location"}`,
          formattedAddress: formattedAddress || `${city || "Current Location"}`,
        }

        debugLog("??? RETURNING LOCATION DATA:", finalLocation)
        return finalLocation
      }

      // If no valid data, throw to trigger fallback
      throw new Error("No valid address data from OLA Maps")
    } catch (err) {
      debugWarn("?? OLA Maps geocoding failed, trying BigDataCloud:", err.message)
      // Fallback to direct reverse geocoding (BigDataCloud)
      try {
        return await reverseGeocodeWithGoogleMaps(latitude, longitude)
      } catch (fallbackErr) {
        // If all fail, return minimal location data
        debugError("? All reverse geocoding failed:", fallbackErr)
        return {
          city: "Current Location",
          address: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
          formattedAddress: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        }
      }
    }
  }

  /* ===================== DB FETCH ===================== */
  const fetchLocationFromDB = async () => {
    try {
      // Check if user is authenticated before trying to fetch from DB
      const userToken = localStorage.getItem('user_accessToken') || localStorage.getItem('accessToken')
      if (!userToken || userToken === 'null' || userToken === 'undefined') {
        // User not logged in - skip DB fetch, return null to use localStorage
        return null
      }

      const dbLocationAgeMs = Date.now() - lastDbLocationFetchAtRef.current
      if (lastDbLocationRef.current && dbLocationAgeMs < DB_LOCATION_FETCH_TTL_MS) {
        return lastDbLocationRef.current
      }

      const res = await userAPI.getLocation()
      const loc = res?.data?.data?.location
      if (loc?.latitude && loc?.longitude) {
        // Validate coordinates are in India range BEFORE attempting geocoding
        const isInIndiaRange = loc.latitude >= 6.5 && loc.latitude <= 37.1 && loc.longitude >= 68.7 && loc.longitude <= 97.4 && loc.longitude > 0

        if (!isInIndiaRange || loc.longitude < 0) {
          // Coordinates are outside India - return placeholder
          debugWarn("?? Coordinates from DB are outside India range:", { latitude: loc.latitude, longitude: loc.longitude })
          const outOfRangeLocation = {
            latitude: loc.latitude,
            longitude: loc.longitude,
            city: "Current Location",
            state: "",
            country: "",
            area: "",
            address: "Select location",
            formattedAddress: "Select location",
          }
          lastDbLocationRef.current = outOfRangeLocation
          lastDbLocationFetchAtRef.current = Date.now()
          return outOfRangeLocation
        }

        const hasUsableStoredAddress =
          (loc.formattedAddress && loc.formattedAddress !== "Select location") ||
          (loc.address && loc.address !== "Select location") ||
          (loc.city && loc.city !== "Current Location")

        if (hasUsableStoredAddress) {
          const storedLocation = {
            latitude: loc.latitude,
            longitude: loc.longitude,
            city: loc.city || "Current Location",
            area: loc.area || "",
            state: loc.state || "",
            country: loc.country || "",
            address: loc.address || loc.formattedAddress || "Select location",
            formattedAddress: loc.formattedAddress || loc.address || "Select location"
          }
          lastDbLocationRef.current = storedLocation
          lastDbLocationFetchAtRef.current = Date.now()
          return storedLocation
        }

        try {
          const addr = await reverseGeocodeWithGoogleMaps(
            loc.latitude,
            loc.longitude,
            { includePlaceDetails: false }
          )
          const resolvedLocation = { ...addr, latitude: loc.latitude, longitude: loc.longitude }
          lastDbLocationRef.current = resolvedLocation
          lastDbLocationFetchAtRef.current = Date.now()
          return resolvedLocation
        } catch (geocodeErr) {
          // If reverse geocoding fails, return location without coordinates in address
          debugWarn("?? Reverse geocoding failed in fetchLocationFromDB:", geocodeErr.message)
          const fallbackLocation = {
            latitude: loc.latitude,
            longitude: loc.longitude,
            city: "Current Location",
            area: "",
            state: "",
            address: "Select location", // Don't show coordinates
            formattedAddress: "Select location", // Don't show coordinates
          }
          lastDbLocationRef.current = fallbackLocation
          lastDbLocationFetchAtRef.current = Date.now()
          return fallbackLocation
        }
      }
    } catch (err) {
      // Silently fail for 404/401 (user not authenticated) or network errors
      if (err.code !== "ERR_NETWORK" && err.response?.status !== 404 && err.response?.status !== 401) {
        debugError("DB location fetch error:", err)
      }
    }
    return null
  }

  /* ===================== MAIN LOCATION ===================== */
  const getLocation = async (updateDB = true, forceFresh = false, showLoading = false) => {
    // If not forcing fresh, try DB first (faster)
    let dbLocation = !forceFresh ? await fetchLocationFromDB() : null
    if (dbLocation && !forceFresh) {
      setLocation(dbLocation)
      if (showLoading) setGlobalLocationLoading(false)
      return dbLocation
    }

    if (!navigator.geolocation) {
      setError("Geolocation not supported")
      if (showLoading) setGlobalLocationLoading(false)
      return dbLocation
    }

    // Helper function to get position with retry mechanism
    const getPositionWithRetry = (options, retryCount = 0) => {
      return new Promise((resolve, reject) => {
        const isRetry = retryCount > 0
        debugLog(`?? Requesting location${isRetry ? ' (retry with lower accuracy)' : ' (high accuracy)'}...`)
        debugLog(`?? Force fresh: ${forceFresh ? 'YES' : 'NO'}, maximumAge: ${options.maximumAge || (forceFresh ? 0 : 60000)}`)

        // Use cached location if available and not too old (faster response)
        // If forceFresh is true, don't use cache (maximumAge: 0)
        const cachedOptions = {
          ...options,
          maximumAge: forceFresh ? 0 : (options.maximumAge || 60000), // If forceFresh, get fresh location
        }

        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            try {
              const { latitude, longitude, accuracy } = pos.coords
              const timestamp = pos.timestamp || Date.now()

              debugLog(`? Got location${isRetry ? ' (lower accuracy)' : ' (high accuracy)'}:`, {
                latitude,
                longitude,
                accuracy: `${accuracy}m`,
                timestamp: new Date(timestamp).toISOString(),
                coordinates: `${latitude.toFixed(8)}, ${longitude.toFixed(8)}`
              })

              // Validate coordinates are in India range BEFORE attempting geocoding
              // India: Latitude 6.5� to 37.1� N, Longitude 68.7� to 97.4� E
              let finalLat = latitude
              let finalLng = longitude
              const isInIndiaRange = latitude >= 6.5 && latitude <= 37.1 && longitude >= 68.7 && longitude <= 97.4 && longitude > 0

              if (!isInIndiaRange || longitude < 0) {
                debugWarn("?? Coordinates outside India range:", { latitude, longitude })
              }

              debugLog("?? Calling reverse geocode with coordinates:", { latitude: finalLat, longitude: finalLng })
              let addr
              try {
                addr = await reverseGeocodeWithGoogleMaps(finalLat, finalLng, {
                  includePlaceDetails: Boolean(forceFresh && showLoading)
                })
                debugLog("? Reverse geocoding successful:", addr)
              } catch (geocodeErr) {
                debugWarn("?? Primary geocoding failed, trying fallback:", geocodeErr.message)
                try {
                  // Fallback to direct reverse geocode (BigDataCloud)
                  addr = await reverseGeocodeDirect(finalLat, finalLng)
                  debugLog("? Fallback geocoding successful:", addr)

                  // Validate fallback result - if it still has placeholder values, don't use it
                  if (addr.city === "Current Location" || addr.address.includes(finalLat.toFixed(4))) {
                    debugWarn("?? Fallback geocoding returned placeholder, will use Vijay Nagar default")
                    addr = {
                      city: "Indore",
                      state: "Madhya Pradesh",
                      country: "India",
                      area: "Vijay Nagar",
                      address: "Vijay Nagar, Indore, Madhya Pradesh",
                      formattedAddress: "Vijay Nagar, Indore, Madhya Pradesh",
                    }
                  }
                } catch (fallbackErr) {
                  debugError("? All geocoding methods failed:", fallbackErr.message)
                  addr = {
                    city: "Indore",
                    state: "Madhya Pradesh",
                    country: "India",
                    area: "Vijay Nagar",
                    address: "Vijay Nagar, Indore, Madhya Pradesh",
                    formattedAddress: "Vijay Nagar, Indore, Madhya Pradesh",
                  }
                }
              }

              // Update coordinates in original variables for consistency
              let finalLocLatitude = finalLat
              let finalLocLongitude = finalLng
              debugLog("Reverse geocode result:", addr)
              if (addr?.formattedAddress && addr.formattedAddress !== "Select location") {
                lastResolvedAddressRef.current = addr
                lastGeocodedCoordsRef.current = { latitude, longitude }
                lastGeocodeAtRef.current = Date.now()
              }
              // Ensure we don't use coordinates as address if we have area/city
              // Keep the complete formattedAddress from geocoder when available
              const completeFormattedAddress = addr.formattedAddress || "";
              let displayAddress = addr.address || "";

              // If address contains coordinates pattern, use area/city instead
              const isCoordinatesPattern = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(displayAddress.trim());
              if (isCoordinatesPattern) {
                if (addr.area && addr.area.trim() !== "") {
                  displayAddress = addr.area;
                } else if (addr.city && addr.city.trim() !== "" && addr.city !== "Unknown City") {
                  displayAddress = addr.city;
                }
              }

              // Build location object with ALL fields from reverse geocoding
              const finalLoc = {
                ...addr, // This includes: city, state, area, street, streetNumber, postalCode, formattedAddress
                latitude: finalLocLatitude,
                longitude: finalLocLongitude,
                accuracy: accuracy || null,
                address: displayAddress, // Locality parts for navbar display
                formattedAddress: completeFormattedAddress || addr.formattedAddress || displayAddress // Complete detailed address
              }

              // Check if location has placeholder values - don't save placeholders
              const hasPlaceholder =
                finalLoc.city === "Current Location" ||
                finalLoc.address === "Select location" ||
                finalLoc.formattedAddress === "Select location" ||
                (!finalLoc.city && !finalLoc.address && !finalLoc.formattedAddress && !finalLoc.area);

              if (hasPlaceholder) {
                debugWarn("?? Skipping save - location contains placeholder values:", finalLoc)
                // Don't save placeholder values to localStorage or DB
                // Just set in state for display but don't persist
                const coordOnlyLoc = {
                  latitude,
                  longitude,
                  accuracy: accuracy || null,
                  city: finalLoc.city,
                  address: finalLoc.address,
                  formattedAddress: finalLoc.formattedAddress
                }
                setLocation(coordOnlyLoc)
                setPermissionGranted(true)
                if (showLoading) setGlobalLocationLoading(false)
                setError(null)
                resolve(coordOnlyLoc)
                return
              }

              debugLog("?? Saving location:", finalLoc)
              localStorage.setItem("userLocation", JSON.stringify(finalLoc))
              setLocation(finalLoc)
              setPermissionGranted(true)
              if (showLoading) setGlobalLocationLoading(false)
              setError(null)

              if (updateDB) {
                await updateLocationInDB(finalLoc).catch(err => {
                  debugWarn("Failed to update location in DB:", err)
                })
              }
              resolve(finalLoc)
            } catch (err) {
              debugError("? Error processing location:", err)
              // Try one more time with direct reverse geocode as last resort
              const { latitude, longitude } = pos.coords

              try {
                debugLog("?? Last attempt: trying direct reverse geocode...")
                const lastResortAddr = await reverseGeocodeDirect(latitude, longitude)

                // Check if we got valid data (not just coordinates)
                if (lastResortAddr &&
                  lastResortAddr.city !== "Current Location" &&
                  !lastResortAddr.address.includes(latitude.toFixed(4)) &&
                  lastResortAddr.formattedAddress &&
                  !lastResortAddr.formattedAddress.includes(latitude.toFixed(4))) {
                  const lastResortLoc = {
                    ...lastResortAddr,
                    latitude,
                    longitude,
                    accuracy: pos.coords.accuracy || null
                  }
                  debugLog("? Last resort geocoding succeeded:", lastResortLoc)
                  localStorage.setItem("userLocation", JSON.stringify(lastResortLoc))
                  setLocation(lastResortLoc)
                  setPermissionGranted(true)
                  if (showLoading) setLoading(false)
                  setError(null)
                  if (updateDB) await updateLocationInDB(lastResortLoc).catch(() => { })
                  resolve(lastResortLoc)
                  return
                } else {
                  debugWarn("?? Last resort geocoding returned invalid data:", lastResortAddr)
                }
              } catch (lastErr) {
                debugError("? Last resort geocoding also failed:", lastErr.message)
              }

              // If all geocoding fails, use placeholder but don't save
              const fallbackLoc = {
                latitude,
                longitude,
                city: "Current Location",
                area: "",
                state: "",
                address: "Select location", // Don't show coordinates
                formattedAddress: "Select location", // Don't show coordinates
              }
              // Don't save placeholder values to localStorage
              // Only set in state for display
              debugWarn("?? Skipping save - all geocoding failed, using placeholder")
              setLocation(fallbackLoc)
              setPermissionGranted(true)
              if (showLoading) setLoading(false)
              // Don't try to update DB with placeholder
              resolve(fallbackLoc)
            }
          },
          async (err) => {
            // If timeout and we haven't retried yet, try with lower accuracy
            if (err.code === 3 && retryCount === 0 && options.enableHighAccuracy) {
              debugWarn("?? High accuracy timeout, retrying with lower accuracy...")
              // Retry with lower accuracy - faster response (uses network-based location)
              getPositionWithRetry({
                enableHighAccuracy: false,
                timeout: forceFresh ? 12000 : 8000,
                maximumAge: forceFresh ? 0 : 300000,
              }, 1).then(resolve).catch(reject)
              return
            }

            // Don't log timeout errors as errors - they're expected in some cases
            if (err.code === 3) {
              debugWarn("?? Geolocation timeout (code 3) - using fallback location")
            } else {
              debugError("? Geolocation error:", err.code, err.message)
            }

            // Explicit user action must not silently reuse stale cached coordinates.
            if (forceFresh && showLoading) {
              setPermissionGranted(false)
              if (showLoading) setGlobalLocationLoading(false)
              reject(err)
              return
            }

            // Try multiple fallback strategies
            try {
              // Strategy 1: Use DB location if available
              let fallback = dbLocation
              if (!fallback) {
                fallback = await fetchLocationFromDB()
              }

              // Strategy 2: Use cached location from localStorage
              if (!fallback) {
                const stored = localStorage.getItem("userLocation")
                if (stored) {
                  try {
                    fallback = JSON.parse(stored)
                    debugLog("? Using cached location from localStorage")
                  } catch (parseErr) {
                    debugWarn("?? Failed to parse stored location:", parseErr)
                  }
                }
              }

              if (fallback) {
                debugLog("? Using fallback location:", fallback)
                setLocation(fallback)
                // Don't set error for timeout when we have fallback
                if (err.code !== 3) {
                  setError(err.message)
                }
                setPermissionGranted(true) // Still grant permission if we have location
                if (showLoading) setGlobalLocationLoading(false)
                resolve(fallback)
              } else {
                // No fallback available - set a default location so UI doesn't hang
                debugWarn("?? No fallback location available, setting default")
                const defaultLocation = {
                  city: "Select location",
                  address: "Select location",
                  formattedAddress: "Select location"
                }
                setLocation(defaultLocation)
                setError(err.code === 3 ? "Location request timed out. Please try again." : err.message)
                setPermissionGranted(false)
                if (showLoading) setGlobalLocationLoading(false)
                resolve(defaultLocation) // Always resolve with something
              }
            } catch (fallbackErr) {
              debugWarn("?? Fallback retrieval failed:", fallbackErr)
              setLocation(null)
              setError(err.code === 3 ? "Location request timed out. Please try again." : err.message)
              setPermissionGranted(false)
              if (showLoading) setLoading(false)
              resolve(null)
            }
          },
          options
        )
      })
    }

    // Try with high accuracy first
    // If forceFresh is true, don't use cached location (maximumAge: 0)
    // Otherwise, allow cached location for faster response
    return getPositionWithRetry({
      enableHighAccuracy: true,
      timeout: forceFresh ? 15000 : 10000,
      maximumAge: forceFresh ? 0 : 120000,
    })
  }

  /* ===================== WATCH LOCATION ===================== */
  const startWatchingLocation = () => {
    if (!navigator.geolocation) {
      debugWarn("?? Geolocation not supported")
      return
    }

    // Clear any existing watch
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }

    debugLog("?? Starting to watch location for live updates...")

    let retryCount = 0
    const maxRetries = 2

    const startWatch = (options) => {
      watchIdRef.current = navigator.geolocation.watchPosition(
        async (pos) => {
          try {
            const { latitude, longitude, accuracy } = pos.coords
            debugLog("?? Location updated:", { latitude, longitude, accuracy: `${accuracy}m` })

            // Reset retry count on success
            retryCount = 0

            // Validate coordinates are in India range BEFORE attempting geocoding
            // India: Latitude 6.5� to 37.1� N, Longitude 68.7� to 97.4� E
            const isInIndiaRange = latitude >= 6.5 && latitude <= 37.1 && longitude >= 68.7 && longitude <= 97.4 && longitude > 0

            // "Geocode once" mode:
            // Do NOT reverse-geocode on every watch tick (it causes frequent api-bdc.io calls).
            // Instead reuse the last resolved address (from the initial page load / explicit request).
            let addr
            if (!isInIndiaRange || longitude < 0) {
              debugWarn("?? Coordinates outside India range; skipping reverse geocoding:", { latitude, longitude })
              addr = {
                city: "Current Location",
                state: "",
                country: "",
                area: "",
                address: "Select location",
                formattedAddress: "Select location",
              }
            } else if (lastResolvedAddressRef.current && lastResolvedAddressRef.current.formattedAddress) {
              addr = lastResolvedAddressRef.current
            } else {
              // If we don't have an address yet, avoid network calls and keep placeholders.
              // (The initial location fetch should set `lastResolvedAddressRef`.)
              addr = {
                city: "Current Location",
                state: "",
                country: "",
                area: "",
                address: "Select location",
                formattedAddress: "Select location",
              }
            }

            // CRITICAL: Ensure formattedAddress is NEVER coordinates
            // Check if reverse geocoding returned proper address or just coordinates
            let completeFormattedAddress = addr.formattedAddress || "";
            let displayAddress = addr.address || "";

            // Check if formattedAddress is coordinates pattern
            const isFormattedAddressCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(completeFormattedAddress.trim());
            const isDisplayAddressCoordinates = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(displayAddress.trim());

            // If formattedAddress is coordinates, it means reverse geocoding failed
            // Build proper address from components or use fallback
            if (isFormattedAddressCoordinates || !completeFormattedAddress || completeFormattedAddress === "Select location") {
              debugWarn("?????? Reverse geocoding returned coordinates or empty address!")
              debugWarn("?? Attempting to build address from components:", {
                city: addr.city,
                state: addr.state,
                area: addr.area,
                street: addr.street,
                streetNumber: addr.streetNumber
              })

              // Build address from components
              const addressParts = [];
              if (addr.area && addr.area.trim() !== "") {
                addressParts.push(addr.area);
              }
              if (addr.city && addr.city.trim() !== "") {
                addressParts.push(addr.city);
              }
              if (addr.state && addr.state.trim() !== "") {
                addressParts.push(addr.state);
              }

              if (addressParts.length > 0) {
                completeFormattedAddress = addressParts.join(', ');
                displayAddress = addr.area || addr.city || "Select location";
                debugLog("? Built address from components:", completeFormattedAddress);
              } else {
                // Final fallback - don't use coordinates
                completeFormattedAddress = addr.city || "Select location";
                displayAddress = addr.city || "Select location";
                debugWarn("?? Using fallback address:", completeFormattedAddress);
              }
            }

            // Also check displayAddress
            if (isDisplayAddressCoordinates) {
              displayAddress = addr.area || addr.city || "Select location";
            }

            // Build location object with ALL fields from reverse geocoding
            // NEVER include coordinates in formattedAddress or address
            const loc = {
              ...addr, // This includes: city, state, area, street, streetNumber, postalCode
              latitude,
              longitude,
              accuracy: accuracy || null,
              address: displayAddress, // Locality parts for navbar display (NEVER coordinates)
              formattedAddress: completeFormattedAddress // Complete detailed address (NEVER coordinates)
            }

            // STABILITY: Only update if location changed significantly (>10m) OR address improved
            const currentLoc = location
            if (currentLoc && currentLoc.latitude && currentLoc.longitude) {
              // Calculate distance in meters (Haversine formula simplified for small distances)
              const latDiff = latitude - currentLoc.latitude
              const lngDiff = longitude - currentLoc.longitude
              const distanceMeters = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111320 // ~111320m per degree

              // Check if address is better (more parts = more complete)
              const currentParts = (currentLoc.formattedAddress || "").split(',').filter(p => p.trim()).length
              const newParts = completeFormattedAddress.split(',').filter(p => p.trim()).length
              const addressImproved = newParts > currentParts

              // Only update if moved >10 meters OR address significantly improved
              if (distanceMeters <= 10 && !addressImproved) {
                debugLog(`?? Location unchanged (${distanceMeters.toFixed(1)}m change), keeping stable address`)
                return // Don't update - keep current stable address
              }

              debugLog(`?? Location updated: ${distanceMeters.toFixed(1)}m change, address parts: ${currentParts} ? ${newParts}`)
            }

            // Final validation - ensure formattedAddress is never coordinates
            if (loc.formattedAddress && /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(loc.formattedAddress.trim())) {
              debugError("??? CRITICAL: formattedAddress is still coordinates! Replacing with city/area")
              loc.formattedAddress = loc.area || loc.city || "Select location";
              loc.address = loc.area || loc.city || "Select location";
            }

            // Check if location has placeholder values - don't save placeholders
            const hasPlaceholder =
              loc.city === "Current Location" ||
              loc.address === "Select location" ||
              loc.formattedAddress === "Select location" ||
              (!loc.city && !loc.address && !loc.formattedAddress && !loc.area);

            if (hasPlaceholder) {
              debugWarn("?? Skipping live location update - contains placeholder values:", loc)
              return // Don't update location or save to DB
            }

            // Check if coordinates have changed significantly (threshold: ~10 meters)
            const coordThreshold = 0.0001 // approximately 10 meters
            const coordsChanged =
              !prevLocationCoordsRef.current.latitude ||
              !prevLocationCoordsRef.current.longitude ||
              Math.abs(prevLocationCoordsRef.current.latitude - loc.latitude) > coordThreshold ||
              Math.abs(prevLocationCoordsRef.current.longitude - loc.longitude) > coordThreshold
            let persistedLocation = loc
            try {
              const storedRaw = localStorage.getItem("userLocation")
              const storedLocation = storedRaw ? JSON.parse(storedRaw) : null
              const savedLabel = loc?.label || storedLocation?.label
              if (savedLabel && String(savedLabel).trim()) {
                persistedLocation = { ...loc, label: String(savedLabel).trim() }
              }
            } catch {
              persistedLocation = loc
            }

            // Only update location state if coordinates changed significantly
            if (coordsChanged) {
              prevLocationCoordsRef.current = { latitude: loc.latitude, longitude: loc.longitude }
              debugLog("?? Updating live location:", loc)
              localStorage.setItem("userLocation", JSON.stringify(persistedLocation))
              setLocation(persistedLocation)
              setPermissionGranted(true)
              setError(null)
            } else {
              // Coordinates haven't changed significantly, skip state update to prevent re-renders
              // Still update localStorage silently for persistence
              localStorage.setItem("userLocation", JSON.stringify(persistedLocation))
            }

            // Debounce DB updates - only update every 5 seconds
            clearTimeout(updateTimerRef.current)
            updateTimerRef.current = setTimeout(() => {
              updateLocationInDB(loc).catch(err => {
                debugWarn("Failed to update location in DB:", err)
              })
            }, 5000)
          } catch (err) {
            debugError("? Error processing live location update:", err)
            // If reverse geocoding fails, DON'T use coordinates - use placeholder
            const { latitude, longitude } = pos.coords
            const fallbackLoc = {
              latitude,
              longitude,
              city: "Current Location",
              area: "",
              state: "",
              address: "Select location", // NEVER use coordinates
              formattedAddress: "Select location", // NEVER use coordinates
            }
            debugWarn("?? Using fallback location (reverse geocoding failed):", fallbackLoc)
            // Don't save placeholder values to localStorage
            // Only set in state for display
            debugWarn("?? Skipping localStorage save - fallback location contains placeholder values")
            setLocation(fallbackLoc)
            setPermissionGranted(true)
          }
        },
        (err) => {
          // Don't log timeout errors for watchPosition (it's a background operation)
          // Only log non-timeout errors
          if (err.code !== 3) {
            debugWarn("?? Watch position error (non-timeout):", err.code, err.message)
          }

          // If timeout and we haven't exceeded max retries, retry with HIGH ACCURACY GPS
          // CRITICAL: Keep using GPS (not network-based) for accurate location
          // Network-based location won't give exact landmarks like "Mama Loca Cafe"
          if (err.code === 3 && retryCount < maxRetries) {
            retryCount++
            debugLog(`?? GPS timeout, retrying with high accuracy GPS (attempt ${retryCount}/${maxRetries})...`)

            // Clear current watch
            if (watchIdRef.current) {
              navigator.geolocation.clearWatch(watchIdRef.current)
              watchIdRef.current = null
            }

            // Retry with HIGH ACCURACY GPS (don't use network-based location)
            // Network-based location is less accurate and won't give exact landmarks
            setTimeout(() => {
              startWatch({
                enableHighAccuracy: true,   // Keep using GPS (not network-based)
                timeout: 20000,              // 20 seconds timeout (give GPS more time)
                maximumAge: 0                // Always get fresh GPS location
              })
            }, 3000) // 3 second delay before retry
            return
          }

          // If all retries failed, silently continue - don't set error state for background watch
          // The watch will keep trying in background, user won't notice
          // Only set error for non-timeout errors that are critical
          if (err.code !== 3) {
            setError(err.message)
            setPermissionGranted(false)
          }

          // Don't clear the watch - let it keep trying in background
          // The user might move to a location with better GPS signal
        },
        options
      )
    }

    // Start with HIGH ACCURACY GPS for live location tracking
    // CRITICAL: enableHighAccuracy: true forces GPS (not network-based) for accurate location
    // Network-based location won't give exact landmarks like "Mama Loca Cafe"
    startWatch({
      enableHighAccuracy: true,   // CRITICAL: Use GPS (not network-based) for accurate location
      timeout: 15000,             // 15 seconds timeout (gives GPS more time to get accurate fix)
      maximumAge: 0               // Always get fresh GPS location (no cache for live tracking)
    })

    debugLog("??? GPS High Accuracy enabled for live location tracking")
    debugLog("? GPS will provide accurate coordinates for reverse geocoding")
    debugLog("? Network-based location disabled (less accurate)")
  }

  const stopWatchingLocation = () => {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    clearTimeout(updateTimerRef.current)
  }

  const refreshLocationIfPermitted = async ({ showLoading = false } = {}) => {
    if (isDefaultLocationMode || !navigator.geolocation) return null

    let permissionState = "unknown"
    if (navigator.permissions?.query) {
      try {
        const result = await navigator.permissions.query({ name: "geolocation" })
        permissionState = result.state
        if (permissionState === "denied") return null
      } catch {
        permissionState = "unknown"
      }
    }

    const hasPriorSavedLocation = hasValidStoredUserLocation()

    // First visit: wait for the location popup button so we don't trigger a browser prompt on load.
    if (permissionState !== "granted" && !hasPriorSavedLocation) {
      return null
    }

    try {
      if (showLoading) setGlobalLocationLoading(true)
      const loc = await getLocation(true, true, showLoading)
      if (loc && !isPlaceholderLocation(loc)) {
        setLocation(loc)
        setPermissionGranted(true)
        window.dispatchEvent(new CustomEvent("userLocationUpdated"))
      }
      return loc
    } catch (err) {
      debugWarn("Background location refresh failed:", err?.message || err)
      return null
    } finally {
      if (showLoading) setGlobalLocationLoading(false)
    }
  }

  /* ===================== INIT ===================== */
  useEffect(() => {
    // Check if location should be suppressed on the current path/auth state
    const pathname = window.location.pathname.toLowerCase();
    const isSuppressedPath = 
      pathname.includes('terms') ||
      pathname.includes('privacy') ||
      pathname.includes('support') ||
      pathname.includes('login') ||
      pathname.includes('otp');

    const isAuthenticated = !!(localStorage.getItem('user_accessToken') || localStorage.getItem('accessToken'));

    // Load stored location first for IMMEDIATE display (no loading state)
    const stored = localStorage.getItem("userLocation")
    let shouldForceRefresh = false
    let hasInitialLocation = false

    if (stored) {
      try {
        const parsedLocation = JSON.parse(stored)

        // Show cached location immediately.
        // Requirement: only geocode again on explicit manual change.
        const lat = Number(parsedLocation?.latitude)
        const lng = Number(parsedLocation?.longitude)
        const hasLatLng = Number.isFinite(lat) && Number.isFinite(lng)

        if (parsedLocation && hasLatLng) {
          setLocation(parsedLocation)
          setPermissionGranted(true)
          setLoading(false) // Set loading to false immediately
          hasInitialLocation = true
          shouldForceRefresh = false
          debugLog("?? Loaded stored location instantly (no auto-refresh):", parsedLocation)
        } else {
          // If we don't have usable coordinates, we must fetch once on first open.
          debugLog("?? Stored location missing coordinates; will fetch once")
          shouldForceRefresh = true
        }
      } catch (err) {
        debugError("Failed to parse stored location:", err)
        shouldForceRefresh = true
      }
    } else {
      if (isDefaultLocationMode) {
        // TEMPORARY: No stored location found - set default Indore in localStorage
        // This ensures PageNavbar and other components see the default immediately.
        try {
          localStorage.setItem("userLocation", JSON.stringify(TEMPORARY_DEFAULT_INDORE_LOCATION))
          setLocation(TEMPORARY_DEFAULT_INDORE_LOCATION)
          setLoading(false)
          hasInitialLocation = true
          debugLog("?? TEMPORARY: Set default Indore location in localStorage")
        } catch (e) {
          debugError("Failed to set default Indore location:", e)
        }
      }
    }

    // If no cached location, try DB (only if authenticated and path is not suppressed)
    if (!hasInitialLocation && !isSuppressedPath && isAuthenticated) {
      fetchLocationFromDB()
        .then((dbLoc) => {
          if (dbLoc && Number.isFinite(Number(dbLoc.latitude)) && Number.isFinite(Number(dbLoc.longitude))) {
            setLocation(dbLoc)
            setPermissionGranted(true)
            setGlobalLocationLoading(false)
            hasInitialLocation = true
            debugLog("?? Loaded location from DB:", dbLoc)
          } else {
            // No location found - set loading to false and show fallback
            setGlobalLocationLoading(false)
            shouldForceRefresh = true
          }
        })
        .catch(() => {
          setGlobalLocationLoading(false)
          shouldForceRefresh = true
        })
    } else if (!isAuthenticated || isSuppressedPath) {
      setGlobalLocationLoading(false)
    }

    // Always ensure loading is false after initial check
    // Safety timeout to prevent infinite loading
    const loadingTimeout = setTimeout(() => {
      setLoading((currentLoading) => {
        if (currentLoading) {
          debugWarn("?? Loading timeout - setting loading to false")
          // Only set fallback if we still don't have a location
          setLocation((currentLocation) => {
            if (!currentLocation ||
              (currentLocation.formattedAddress === "Select location" &&
                !currentLocation.latitude && !currentLocation.city)) {
              if (isDefaultLocationMode) {
                return TEMPORARY_DEFAULT_INDORE_LOCATION
              } else {
                return {
                  city: "Select location",
                  address: "Select location",
                  formattedAddress: "Select location"
                }
              }
            }
            return currentLocation
          })
        }
        return false
      })
    }, 5000) // 5 second safety timeout

    // Fresh tab/app open → force current GPS (F5 keeps selected city via isNewAppSession=false).
    const startAutoLocationRefresh = () => {
      runDedupedAutoRefresh(() => refreshLocationIfPermitted({ showLoading: false }))
    }

    if (!isDefaultLocationMode && !isSuppressedPath && isNewAppSession) {
      if (!pageLoadAutoRefreshStarted) {
        pageLoadAutoRefreshStarted = true
        try {
          sessionStorage.setItem("manual_location_update", "true")
          localStorage.setItem("deliveryAddressMode", "current")
          window.dispatchEvent(new CustomEvent("deliveryAddressModeUpdated"))
        } catch {}
        // requestLocation clears the prior city pin and pulls live GPS (not a silent cache hit).
        runDedupedAutoRefresh(() =>
          requestLocation().catch((err) => {
            debugError("New-tab current location fetch failed, falling back:", err)
            return refreshLocationIfPermitted({ showLoading: true })
          }),
        )
      }
    } else {
      setLoading(false)
    }

    // Listen for storage changes to keep location in sync across components/tabs
    const handleStorageChange = (e) => {
      if (e.key === "userLocation" && e.newValue) {
        try {
          const newLoc = JSON.parse(e.newValue)
          setLocation(newLoc)
          debugLog("?? Location updated from storage event:", newLoc)
        } catch (err) {
          debugError("Failed to parse location from storage event:", err)
        }
      }
    }

    // Also listen for custom event that might be fired within the same window
    const handleCustomUpdate = () => {
      const stored = localStorage.getItem("userLocation")
      if (stored) {
        try {
          const newLoc = JSON.parse(stored)
          setLocation(newLoc)
          debugLog("?? Location updated from custom update event:", newLoc)
        } catch {}
      }
    }

    window.addEventListener('storage', handleStorageChange)
    window.addEventListener('userLocationUpdated', handleCustomUpdate)
    
    // Auto-fetch current location on login (even if this tab already had a session).
    const handleLoginSuccess = () => {
      if (isDefaultLocationMode) {
        debugLog("?? Default Location Mode is active. Suppressing login success location fetch.")
        return
      }

      const hasFetchedThisLogin = sessionStorage.getItem('lastLoginLocationFetch');
      if (hasFetchedThisLogin) return;

      debugLog("?? Login success, triggering one-time automatic location fetch...")
      try {
        sessionStorage.setItem(LOCATION_APP_SESSION_KEY, "1")
        localStorage.setItem("deliveryAddressMode", "current")
        window.dispatchEvent(new CustomEvent("deliveryAddressModeUpdated"))
      } catch {}
      setTimeout(() => {
        requestLocation().then(() => {
          sessionStorage.setItem('lastLoginLocationFetch', 'true');
        }).catch(err => {
          debugError("Failed to auto-fetch location after login:", err)
        })
      }, 1000)
    }
    
    window.addEventListener('userLoginSuccess', handleLoginSuccess)

    // Cleanup timeout and watcher
    return () => {
      clearTimeout(loadingTimeout)
      debugLog("?? Cleaning up location watcher")
      stopWatchingLocation()
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('userLocationUpdated', handleCustomUpdate)
      window.removeEventListener('userLoginSuccess', handleLoginSuccess)
    }
  }, [])

  const requestLocation = async () => {
    debugLog("?????? User requested location update - clearing cache and fetching fresh")
    setGlobalLocationLoading(true)
    setError(null)

    try {
      try {
        localStorage.setItem("deliveryAddressMode", "current")
        window.dispatchEvent(new CustomEvent("deliveryAddressModeUpdated"))
      } catch {}

      // Clear cached location to force fresh fetch
      localStorage.removeItem("userLocation")
      debugLog("??? Cleared cached location from localStorage")

      // Show loading, so pass showLoading = true
      // forceFresh = true, updateDB = true, showLoading = true
      // This ensures we get fresh GPS coordinates and reverse geocode
      const location = await getLocation(true, true, true)

      debugLog("??? Fresh location requested successfully:", location)
      debugLog("??? Complete Location details:", {
        formattedAddress: location?.formattedAddress,
        address: location?.address,
        city: location?.city,
        state: location?.state,
        area: location?.area,
        pointOfInterest: location?.pointOfInterest,
        premise: location?.premise,
        coordinates: location?.latitude && location?.longitude ?
          `${location.latitude.toFixed(8)}, ${location.longitude.toFixed(8)}` : "N/A",
        hasCompleteAddress: location?.formattedAddress &&
          location.formattedAddress !== "Select location" &&
          !location.formattedAddress.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/) &&
          location.formattedAddress.split(',').length >= 4
      })

      // Verify we got complete address (POI, building, floor, area, city, state, pincode)
      if (!location?.formattedAddress ||
        location.formattedAddress === "Select location" ||
        location.formattedAddress.match(/^-?\d+\.\d+,\s*-?\d+\.\d+$/) ||
        location.formattedAddress.split(',').length < 4) {
        debugWarn("?????? Location received but address is incomplete!")
        debugWarn("?? Address parts count:", location?.formattedAddress?.split(',').length || 0)
        debugWarn("?? This might be due to:")
        debugWarn("   1. Geocoding service unavailable or rate-limited")
        debugWarn("   2. Location permission not granted")
        debugWarn("   3. GPS accuracy too low (try on mobile device)")
      } else {
        debugLog("??? SUCCESS: Complete detailed address received!")
        debugLog("? Full address:", location.formattedAddress)
      }

      // Dispatch custom event to notify all other mounted hook instances (Navbar, Home, etc.)
      try {
        window.dispatchEvent(new CustomEvent("userLocationUpdated"))
      } catch (evtErr) {
        debugWarn("Failed to dispatch custom event:", evtErr)
      }

      return location
    } catch (err) {
      debugError("? Failed to request location:", err)
      setError(err.message || "Failed to get location")
      throw err
    } finally {
      setGlobalLocationLoading(false)
    }
  }

  /**
   * Fast path for Address Selector "Use current location".
   * - Does not clear cache first
   * - Prefers recent GPS (≤30s) + low-accuracy first (much faster)
   * - Single reverse-geocode, DB update in background
   */
  const requestLocationFast = async () => {
    setError(null)

    if (!navigator.geolocation) {
      throw new Error("Geolocation not supported")
    }

    try {
      try {
        localStorage.setItem("deliveryAddressMode", "current")
        window.dispatchEvent(new CustomEvent("deliveryAddressModeUpdated"))
      } catch {}

      const getPosition = (options) =>
        new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, options)
        })

      let pos
      try {
        // Fast path: network/wifi location + accept a recent fix
        pos = await getPosition({
          enableHighAccuracy: false,
          timeout: 6000,
          maximumAge: 30000,
        })
      } catch {
        // Fallback: true GPS if low-accuracy fails
        pos = await getPosition({
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        })
      }

      const { latitude, longitude, accuracy } = pos.coords
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error("Invalid coordinates")
      }

      let addr
      try {
        addr = await reverseGeocodeWithGoogleMaps(latitude, longitude)
      } catch {
        addr = await reverseGeocodeDirect(latitude, longitude)
      }

      const finalLoc = {
        ...addr,
        city: resolveServiceCity({
          locality: addr?.city || "",
          formattedAddress: addr?.formattedAddress || addr?.address || "",
          fallback: addr?.city || "Indore",
        }),
        latitude,
        longitude,
        accuracy: accuracy ?? null,
      }

      localStorage.setItem("userLocation", JSON.stringify(finalLoc))
      setLocation(finalLoc)
      setPermissionGranted(true)

      // Don't block UI on DB write
      updateLocationInDB(finalLoc).catch(() => {})

      try {
        window.dispatchEvent(new CustomEvent("userLocationUpdated"))
      } catch {}

      return finalLoc
    } catch (err) {
      debugError("? Fast location request failed:", err)
      setError(err.message || "Failed to get location")
      throw err
    }
  }

  const { getDefaultAddress } = useProfile()
  const defaultSavedAddress = getDefaultAddress?.() || null

  const defaultSavedAddressLocation = useMemo(() => {
    if (!defaultSavedAddress) return null
    const coordinates = defaultSavedAddress?.location?.coordinates
    if (Array.isArray(coordinates) && coordinates.length >= 2) {
      const lng = parseFloat(coordinates[0])
      const lat = parseFloat(coordinates[1])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { latitude: lat, longitude: lng }
      }
    }

    const lat = parseFloat(defaultSavedAddress?.latitude || defaultSavedAddress?.lat)
    const lng = parseFloat(defaultSavedAddress?.longitude || defaultSavedAddress?.lng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng }
    }

    return null
  }, [defaultSavedAddress])

  // Listen to deliveryAddressMode changes using a local state
  const [addressMode, setAddressMode] = useState(() => {
    try {
      // New app/tab sessions force "current"; same-session refresh keeps prior mode.
      return localStorage.getItem("deliveryAddressMode") || "current"
    } catch {
      return "current"
    }
  })

  useEffect(() => {
    const handleModeUpdate = () => {
      try {
        setAddressMode(localStorage.getItem("deliveryAddressMode") || "current")
      } catch {}
    }
    window.addEventListener("userLocationUpdated", handleModeUpdate)
    window.addEventListener("deliveryAddressModeUpdated", handleModeUpdate)
    return () => {
      window.removeEventListener("userLocationUpdated", handleModeUpdate)
      window.removeEventListener("deliveryAddressModeUpdated", handleModeUpdate)
    }
  }, [])

  const effectiveLocation = useMemo(() => {
    if (addressMode === "current") {
      return location
    }

    if (
      defaultSavedAddressLocation &&
      Number.isFinite(defaultSavedAddressLocation.latitude) &&
      Number.isFinite(defaultSavedAddressLocation.longitude)
    ) {
      const parts = [
        defaultSavedAddress?.additionalDetails,
        defaultSavedAddress?.street,
        defaultSavedAddress?.city,
        defaultSavedAddress?.state,
        defaultSavedAddress?.zipCode,
      ].filter(Boolean)

      const resolvedAddress = parts.length > 0 ? parts.join(", ") : defaultSavedAddress?.formattedAddress || defaultSavedAddress?.address || ""

      return {
        ...(location || {}),
        latitude: defaultSavedAddressLocation.latitude,
        longitude: defaultSavedAddressLocation.longitude,
        area: defaultSavedAddress?.additionalDetails || defaultSavedAddress?.street || defaultSavedAddress?.area || "",
        city: defaultSavedAddress?.city || "",
        state: defaultSavedAddress?.state || "",
        address: resolvedAddress,
        formattedAddress: resolvedAddress,
        pincode: defaultSavedAddress?.zipCode || "",
      }
    }

    return location
  }, [location, defaultSavedAddressLocation, addressMode, defaultSavedAddress])

  return {
    location: effectiveLocation,
    geoLocation: location,
    effectiveLocation,
    loading,
    error,
    permissionGranted,
    requestLocation,
    requestLocationFast,
    startWatchingLocation,
    stopWatchingLocation,
  }
}

