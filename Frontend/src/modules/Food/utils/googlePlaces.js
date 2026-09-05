import { getGoogleMapsApiKey } from "./googleMapsApiKey"
import { geocodeGooglePlaceId } from "./googleGeocoding"
import { Loader } from "@googlemaps/js-api-loader"

let mapsLoadPromise = null
let autocompleteService = null

const normalizePlaceId = (placeId = "") => {
  const raw = String(placeId).trim()
  if (!raw) return ""
  return raw.startsWith("places/") ? raw.slice("places/".length) : raw
}

export async function ensureGoogleMapsPlacesLoaded() {
  if (window.google?.maps?.places?.AutocompleteService) {
    if (!autocompleteService) {
      autocompleteService = new window.google.maps.places.AutocompleteService()
    }
    return window.google
  }

  if (!mapsLoadPromise) {
    mapsLoadPromise = (async () => {
      const apiKey = await getGoogleMapsApiKey()
      if (!apiKey) throw new Error("Google Maps API key is not configured")

      const loader = new Loader({
        apiKey,
        version: "weekly",
        libraries: ["places"],
      })

      const google = await loader.load()
      autocompleteService = new google.maps.places.AutocompleteService()
      return google
    })()
  }

  const google = await mapsLoadPromise
  if (!autocompleteService && google?.maps?.places?.AutocompleteService) {
    autocompleteService = new google.maps.places.AutocompleteService()
  }
  return google
}

export function mapGeocodeParsedToLocation(parsed) {
  if (!parsed) return null

  const placeName = parsed.placeName || parsed.premise || ""
  const streetLine =
    parsed.streetNumber && parsed.route
      ? `${parsed.streetNumber}, ${parsed.route}`
      : parsed.route || ""

  const addressLine1 =
    placeName ||
    streetLine ||
    parsed.address?.split(",")[0]?.trim() ||
    parsed.formattedAddress?.split(",")[0]?.trim() ||
    ""

  return {
    formattedAddress: parsed.formattedAddress || "",
    addressLine1,
    addressLine2: placeName && streetLine && !streetLine.includes(placeName) ? streetLine : "",
    area: parsed.area || "",
    city: parsed.city || "Indore",
    state: parsed.state || "Madhya Pradesh",
    pincode: parsed.pincode || "",
    landmark: placeName || "",
    latitude: Number(parsed.latitude),
    longitude: Number(parsed.longitude),
    placeName,
  }
}

function rankSuggestion(query, suggestion) {
  const q = String(query || "").trim().toLowerCase()
  const main = String(suggestion.mainText || suggestion.display || "").toLowerCase()
  const full = String(suggestion.display || "").toLowerCase()

  if (!q) return 0
  if (main === q || full === q) return 100
  if (main.startsWith(q) || full.startsWith(q)) return 80
  if (main.includes(q) || full.includes(q)) return 60
  if (suggestion.source === "text_search") return 55
  if (suggestion.source === "autocomplete_new") return 50
  return 30
}

function mergeSuggestions(query, lists = []) {
  const merged = new Map()

  for (const list of lists) {
    for (const item of list) {
      const placeId = normalizePlaceId(item.placeId || item.id)
      if (!placeId) continue

      const existing = merged.get(placeId)
      if (!existing || rankSuggestion(query, item) > rankSuggestion(query, existing)) {
        merged.set(placeId, {
          id: placeId,
          placeId,
          display: item.display || item.mainText || "",
          mainText: item.mainText || item.display || "",
          secondaryText: item.secondaryText || "",
          source: item.source || "autocomplete",
          latitude: item.latitude ?? null,
          longitude: item.longitude ?? null,
        })
      }
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => rankSuggestion(query, b) - rankSuggestion(query, a))
    .slice(0, 8)
}

function fetchLegacyAutocompletePredictions(google, query, options = {}) {
  return new Promise((resolve) => {
    if (!autocompleteService) {
      resolve([])
      return
    }

    const request = {
      input: query,
      componentRestrictions: { country: "in" },
    }

    const lat = Number(options.latitude)
    const lng = Number(options.longitude)
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      request.location = new google.maps.LatLng(lat, lng)
      request.radius = 50000
    }

    autocompleteService.getPlacePredictions(request, (predictions, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !Array.isArray(predictions)) {
        resolve([])
        return
      }

      resolve(
        predictions.map((prediction) => ({
          id: prediction.place_id,
          placeId: prediction.place_id,
          display: prediction.description,
          mainText: prediction.structured_formatting?.main_text || prediction.description,
          secondaryText: prediction.structured_formatting?.secondary_text || "",
          source: "autocomplete_legacy",
        }))
      )
    })
  })
}

async function fetchNewAutocompletePredictions(query, options = {}) {
  if (!window.google?.maps?.importLibrary) return []

  try {
    const { AutocompleteSuggestion, AutocompleteSessionToken } =
      await window.google.maps.importLibrary("places")

    const sessionToken = new AutocompleteSessionToken()
    const request = {
      input: query,
      sessionToken,
      includedRegionCodes: ["in"],
    }

    const lat = Number(options.latitude)
    const lng = Number(options.longitude)
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      request.locationBias = {
        circle: {
          center: { lat, lng },
          radius: 50000,
        },
      }
    }

    const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request)

    return (suggestions || [])
      .map((item) => item.placePrediction)
      .filter(Boolean)
      .map((prediction) => ({
        id: normalizePlaceId(prediction.placeId),
        placeId: normalizePlaceId(prediction.placeId),
        display:
          prediction.text?.text ||
          `${prediction.mainText?.text || ""}${prediction.secondaryText?.text ? `, ${prediction.secondaryText.text}` : ""}`,
        mainText: prediction.mainText?.text || prediction.text?.text || "",
        secondaryText: prediction.secondaryText?.text || "",
        source: "autocomplete_new",
      }))
  } catch {
    return []
  }
}

async function fetchTextSearchPredictions(query, options = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 7000)

  try {
    const { geocodeAPI } = await import("@food/api")
    const lat = Number(options.latitude)
    const lng = Number(options.longitude)

    const body = {
      textQuery: query,
      maxResultCount: 6,
    }

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      body.latitude = lat
      body.longitude = lng
    }

    const response = await geocodeAPI.textSearch(body, { signal: controller.signal })
    const data = response?.data?.data
    const places = Array.isArray(data?.places) ? data.places : []

    return places.map((place) => {
      const placeId = normalizePlaceId(place.id)
      const mainText = place.displayName?.text || place.displayName || ""
      const formattedAddress = place.formattedAddress || ""
      return {
        id: placeId,
        placeId,
        display: formattedAddress || mainText,
        mainText: mainText || formattedAddress.split(",")[0] || "",
        secondaryText: formattedAddress && mainText ? formattedAddress : "",
        source: "text_search",
        latitude: place.location?.latitude ?? null,
        longitude: place.location?.longitude ?? null,
      }
    })
  } catch {
    return []
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Fetch Google place suggestions using legacy autocomplete + new autocomplete + text search.
 */
export async function fetchPlaceSuggestions(input, options = {}) {
  const query = String(input || "").trim()
  if (query.length < 3) return []

  const google = await ensureGoogleMapsPlacesLoaded()

  const [legacyResults, newResults, textResults] = await Promise.all([
    fetchLegacyAutocompletePredictions(google, query, options),
    fetchNewAutocompletePredictions(query, options),
    fetchTextSearchPredictions(query, options),
  ])

  return mergeSuggestions(query, [textResults, legacyResults, newResults])
}

export async function resolvePlaceSuggestion(suggestion) {
  const placeId = normalizePlaceId(suggestion?.placeId || suggestion?.id)
  if (!placeId) throw new Error("Missing place id")

  const parsed = await geocodeGooglePlaceId(placeId)
  const location = mapGeocodeParsedToLocation(parsed)

  if (location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
    return location
  }

  if (Number.isFinite(suggestion?.latitude) && Number.isFinite(suggestion?.longitude)) {
    return {
      formattedAddress: suggestion.display || "",
      addressLine1: suggestion.mainText || suggestion.display || "",
      addressLine2: "",
      area: "",
      city: "Indore",
      state: "Madhya Pradesh",
      pincode: "",
      landmark: suggestion.mainText || "",
      latitude: Number(suggestion.latitude),
      longitude: Number(suggestion.longitude),
      placeName: suggestion.mainText || "",
    }
  }

  throw new Error("Could not resolve location coordinates")
}

export function formatLocationPreview(location) {
  if (!location) return ""
  const parts = []
  if (location.placeName || location.addressLine1) {
    parts.push((location.placeName || location.addressLine1).trim())
  }
  if (location.area) parts.push(location.area.trim())
  if (location.city) parts.push(location.city.trim())
  if (location.pincode) parts.push(location.pincode.trim())
  return parts.filter(Boolean).join(", ")
}
