import { geocodeAPI } from "@food/api"
import { getCurrentCoordinates } from "@food/utils/liveLocation"
import { isNoiseSegment } from "@food/utils/locationLabel"

/**
 * Read fresh GPS coordinates from the device (no cache).
 * Delegates to the converging acquisition engine so a coarse Wi-Fi fix is never
 * mistaken for the user's actual position.
 * @param {object} [options] forwarded to `acquireLocation`
 * @returns {Promise<{latitude:number, longitude:number, accuracy:number}>}
 */
export function getFreshGpsCoordinates(options) {
  return getCurrentCoordinates(options)
}

function getComponent(components, types, useShort = false) {
  const comp = components.find((c) => types.some((t) => c.types.includes(t)))
  if (!comp) return ""
  return useShort ? comp.short_name : comp.long_name
}

const PLACE_NAME_TYPES = ["establishment", "point_of_interest", "premise", "subpremise"]
const ADDRESS_RESULT_PRIORITY = [
  "establishment",
  "point_of_interest",
  "premise",
  "subpremise",
  "street_address",
  "route",
  "neighborhood",
  "sublocality_level_1",
  "sublocality",
]

function getPlaceNameFromComponents(components = []) {
  return getComponent(components, PLACE_NAME_TYPES)
}

function getPlaceNameFromFormattedAddress(formattedAddress = "") {
  const firstPart = String(formattedAddress).split(",")[0]?.trim()
  return firstPart || ""
}

function pickBestGeocodeResult(results = []) {
  if (!Array.isArray(results) || results.length === 0) return null

  for (const type of ADDRESS_RESULT_PRIORITY) {
    const match = results.find((result) => result.types?.includes(type))
    if (match) return match
  }

  return results[0]
}

function extractPlaceNameFromResults(results = []) {
  for (const result of results) {
    if (result.types?.some((type) => ["establishment", "point_of_interest"].includes(type))) {
      const fromComponents = getPlaceNameFromComponents(result.address_components)
      if (fromComponents) return fromComponents

      const fromFormatted = getPlaceNameFromFormattedAddress(result.formatted_address)
      if (fromFormatted) return fromFormatted
    }
  }

  for (const result of results) {
    const fromComponents = getPlaceNameFromComponents(result.address_components)
    if (fromComponents) return fromComponents
  }

  for (const result of results) {
    const fromFormatted = getPlaceNameFromFormattedAddress(result.formatted_address)
    if (fromFormatted && !/^\d+$/.test(fromFormatted)) {
      return fromFormatted
    }
  }

  return ""
}

async function fetchGeocodeResults(latitude, longitude, extraParams = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await geocodeAPI.reverse(latitude, longitude, extraParams, {
      signal: controller.signal,
    })
    const data = response?.data?.data
    if (data?.status !== "OK" || !Array.isArray(data.results) || data.results.length === 0) {
      return []
    }
    return data.results
  } finally {
    clearTimeout(timeoutId)
  }
}

async function fetchNearbyPlaceDetails(latitude, longitude) {
  try {
    const response = await geocodeAPI.nearby({
      latitude,
      longitude,
      radius: 60,
      maxResultCount: 5,
    })
    const data = response?.data?.data
    const places = Array.isArray(data?.places) ? data.places : []
    if (places.length === 0) return null

    const nearest = places[0]
    const displayName = nearest.displayName?.text || nearest.displayName || ""
    const formattedAddress = nearest.formattedAddress || ""
    const addressComponents = (nearest.addressComponents || []).map((component) => ({
      long_name: component.longText || component.shortText || "",
      short_name: component.shortText || component.longText || "",
      types: component.types || [],
    }))

    const placeLocation = nearest.location || {}
    const placeLat = Number(placeLocation.latitude)
    const placeLng = Number(placeLocation.longitude)

    return {
      displayName: String(displayName).trim(),
      formattedAddress,
      addressComponents,
      latitude: Number.isFinite(placeLat) ? placeLat : latitude,
      longitude: Number.isFinite(placeLng) ? placeLng : longitude,
      types: nearest.types || [],
    }
  } catch {
    return null
  }
}

export function buildLocationFromGeocode(parsed, latitude, longitude, nearbyPlace = null) {
  const placeName =
    nearbyPlace?.displayName ||
    parsed.placeName ||
    parsed.premise ||
    ""

  const streetLine =
    parsed.streetNumber && parsed.route
      ? `${parsed.streetNumber}, ${parsed.route}`
      : parsed.route || ""

  const area = parsed.area || ""
  const city = parsed.city || ""
  const pincode = parsed.pincode || ""

  let addressLine1 = placeName
  if (!addressLine1) {
    addressLine1 = streetLine || parsed.formattedAddress?.split(",")[0]?.trim() || ""
  }

  const addressLine2 =
    placeName && streetLine && !streetLine.includes(placeName) ? streetLine : ""

  return {
    formattedAddress: nearbyPlace?.formattedAddress || parsed.formattedAddress || "",
    addressLine1,
    addressLine2,
    area,
    city,
    state: parsed.state || "",
    pincode,
    landmark: placeName || "",
    latitude,
    longitude,
    placeName,
  }
}

export function parseGoogleGeocodeResult(result, options = {}) {
  const components = result?.address_components || []
  const placeNameHint = options.placeName || ""

  const streetNumber = getComponent(components, ["street_number"])
  const route = getComponent(components, ["route"])

  // Locality-level components, most specific first. In India, Google puts the
  // colony/nagar name in `sublocality_level_1` (and a finer subdivision in
  // `sublocality_level_2`); reading only the administrative levels is what left
  // the label at city granularity.
  // Google sometimes fills a sublocality with a bare generic word — "Colony",
  // "area" — which names nothing. Skip those so the chain falls through to a
  // component that a person can actually place.
  const named = (value) => (value && !isNoiseSegment(value) ? value : "")

  const sublocality1 = named(getComponent(components, ["sublocality_level_1"]))
  const sublocality2 = named(getComponent(components, ["sublocality_level_2"]))
  const sublocalityGeneric = named(getComponent(components, ["sublocality"]))
  const neighborhood = named(getComponent(components, ["neighborhood"]))
  const sublocality =
    sublocality1 || neighborhood || sublocality2 || sublocalityGeneric
  const locality = getComponent(components, ["locality"])
  const adminArea2 = getComponent(components, ["administrative_area_level_2"])
  const postalTown = getComponent(components, ["postal_town"])
  const adminArea3 = getComponent(components, ["administrative_area_level_3"])
  const adminArea1 = getComponent(components, ["administrative_area_level_1"])

  // Google's own component hierarchy, most specific first. This resolves the city
  // correctly anywhere in the world — no city list to keep in sync, and no default
  // that silently reports the wrong city when a component is missing.
  const city = locality || postalTown || adminArea3 || adminArea2 || adminArea1 || ""
  const state = getComponent(components, ["administrative_area_level_1"])
  const country = getComponent(components, ["country"])
  const pincode = getComponent(components, ["postal_code"])
  const premise = getPlaceNameFromComponents(components)
  const placeName =
    placeNameHint ||
    premise ||
    (result?.types?.some((type) => ["establishment", "point_of_interest"].includes(type))
      ? getPlaceNameFromFormattedAddress(result?.formatted_address)
      : "")

  // Area fallback chain: sublocality_level_1 → neighborhood → sublocality_level_2
  // → generic sublocality → a locality that differs from the resolved city. Only
  // when every one of those is absent does the label collapse to the city.
  let area = sublocality || ""
  if (!area && locality && locality.toLowerCase() !== String(city).toLowerCase()) {
    area = locality
  }

  // A finer subdivision that isn't already implied by `area` — "Sahakar Nagar"
  // under "Vijay Nagar" — is worth keeping as the more specific half of the label.
  const subArea =
    sublocality2 && sublocality2.toLowerCase() !== area.toLowerCase() ? sublocality2 : ""

  const streetLine =
    streetNumber && route ? `${streetNumber}, ${route}` : route || ""

  // "[place], [street], [sub-area], [area]" — most specific first, so the header
  // reads "Sahakar Nagar, Indore" rather than "Indore".
  const addressParts = []
  if (placeName) addressParts.push(placeName)
  if (streetLine && streetLine !== placeName) addressParts.push(streetLine)
  if (subArea) addressParts.push(subArea)
  if (area) addressParts.push(area)

  const displayAddress = addressParts.join(", ") || result?.formatted_address?.split(",")[0] || ""

  const formattedAddress = result?.formatted_address || displayAddress

  return {
    city: city || "",
    state: state || "",
    country: country || "India",
    area,
    subArea,
    pincode,
    placeName: placeName || "",
    mainTitle: placeName || area || city || displayAddress,
    address: displayAddress,
    formattedAddress,
    premise: premise || placeName || "",
    streetNumber,
    route,
    placeId: result?.place_id || "",
  }
}

/**
 * Reverse geocode lat/lng via backend proxy (Google key never hits the browser).
 * Single geocode call (fast) — nearby Places skipped to keep map / selector snappy.
 */
export async function reverseGeocodeWithGoogle(latitude, longitude) {
  const [generalResults, poiResults] = await Promise.all([
    fetchGeocodeResults(latitude, longitude),
    fetchGeocodeResults(latitude, longitude, {
      result_type: "establishment|point_of_interest|premise|subpremise|street_address",
    }).catch(() => []),
  ])

  const combinedResults = [...poiResults, ...generalResults]
  if (combinedResults.length === 0) {
    throw new Error("Google reverse geocode failed")
  }

  const placeName =
    extractPlaceNameFromResults(poiResults) ||
    extractPlaceNameFromResults(generalResults)

  const result = pickBestGeocodeResult(poiResults) || pickBestGeocodeResult(generalResults)
  const parsed = result
    ? parseGoogleGeocodeResult(result, { placeName })
    : {
        city: "",
        state: "",
        area: "",
        pincode: "",
        placeName: placeName || "",
        formattedAddress: "",
        premise: placeName || "",
        streetNumber: "",
        route: "",
      }

  return {
    ...parsed,
    placeName: placeName || parsed.placeName || "",
    locationFields: buildLocationFromGeocode(parsed, latitude, longitude, null),
  }
}

/**
 * Forward geocode a place_id via backend proxy.
 */
export async function geocodeGooglePlaceId(placeId) {
  const response = await geocodeAPI.place(placeId)
  const data = response?.data?.data
  if (data?.status !== "OK" || !data.results?.[0]) {
    throw new Error(data?.status || "Place geocode failed")
  }

  const result = data.results[0]
  const location = result.geometry?.location
  const placeName = extractPlaceNameFromResults([result])

  return {
    ...parseGoogleGeocodeResult(result, { placeName }),
    latitude: Number(location?.lat),
    longitude: Number(location?.lng),
  }
}
