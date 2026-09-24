import { geocodeAPI } from "@food/api"

/**
 * Read fresh GPS coordinates from the device (no cache).
 */
export function getFreshGpsCoordinates() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported"))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    )
  })
}

function getComponent(components = [], types = [], useShort = false) {
  if (!Array.isArray(components)) return ""
  const comp = components.find((c) => types.some((t) => c.types?.includes(t)))
  if (!comp) return ""
  return useShort ? (comp.short_name || comp.long_name || "") : (comp.long_name || comp.short_name || "")
}

const PLACE_NAME_TYPES = ["establishment", "point_of_interest", "premise", "subpremise"]
const ADDRESS_RESULT_PRIORITY = [
  "street_address",
  "premise",
  "subpremise",
  "route",
  "establishment",
  "point_of_interest",
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

export function buildLocationFromGeocode(parsed, latitude, longitude, nearbyPlace = null) {
  const placeName =
    nearbyPlace?.displayName ||
    parsed.placeName ||
    parsed.premise ||
    ""

  const streetLine =
    parsed.streetNumber && parsed.route
      ? `${parsed.streetNumber}, ${parsed.route}`
      : parsed.street || parsed.route || ""

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

/**
 * Extract address parts from a primary result and optionally search additional results
 * in the response hierarchy to fill missing components (such as locality, postal code, or state).
 */
export function parseGoogleGeocodeResult(result, options = {}) {
  if (!result) {
    return {
      city: "",
      state: "",
      country: "India",
      area: "",
      street: "",
      pincode: "",
      placeName: "",
      mainTitle: "",
      address: "",
      formattedAddress: "",
      premise: "",
      streetNumber: "",
      route: "",
      placeId: "",
    }
  }

  const allResults = Array.isArray(options.allResults) && options.allResults.length > 0
    ? options.allResults
    : [result]

  const components = result?.address_components || []
  const placeNameHint = options.placeName || ""

  // Helper to extract a component across the results list
  const findInResults = (types, useShort = false) => {
    // 1. Try in primary result first
    const primary = getComponent(components, types, useShort)
    if (primary) return primary

    // 2. Scan other results for missing component
    for (const res of allResults) {
      const val = getComponent(res?.address_components || [], types, useShort)
      if (val) return val
    }
    return ""
  }

  const streetNumber = findInResults(["street_number"])
  const route = findInResults(["route"])
  const sublocality =
    findInResults(["sublocality_level_1"]) ||
    findInResults(["sublocality"]) ||
    findInResults(["sublocality_level_2"])
  const neighborhood = findInResults(["neighborhood"])
  const locality = findInResults(["locality"])
  const adminArea3 = findInResults(["administrative_area_level_3"])
  const adminArea2 = findInResults(["administrative_area_level_2"])
  const state = findInResults(["administrative_area_level_1"])
  const country = findInResults(["country"]) || "India"
  const pincode = findInResults(["postal_code"])

  // Clean administrative area 2 (e.g. "Ujjain Division" -> "Ujjain", "Indore District" -> "Indore")
  const cleanedAdmin2 = adminArea2 ? adminArea2.replace(/\s+(division|district|mandal)$/i, "").trim() : ""

  // City Resolution:
  // 1. Locality is the exact standard city/town in Google Maps.
  // 2. If locality is missing (rural/village), use administrative_area_level_3 (taluk/subdistrict) or cleaned adminArea2 or sublocality.
  const city = locality || adminArea3 || cleanedAdmin2 || sublocality || ""

  const premise = getPlaceNameFromComponents(components)
  const placeName =
    placeNameHint ||
    premise ||
    (result?.types?.some((type) => ["establishment", "point_of_interest"].includes(type))
      ? getPlaceNameFromFormattedAddress(result?.formatted_address)
      : "")

  let area = sublocality || neighborhood || ""
  if (!area && locality && locality.toLowerCase() !== String(city).toLowerCase()) {
    area = locality
  }

  const streetLine =
    streetNumber && route ? `${streetNumber}, ${route}` : route || ""

  const addressParts = []
  if (placeName) addressParts.push(placeName)
  if (streetLine && streetLine !== placeName) addressParts.push(streetLine)
  if (area && !addressParts.includes(area)) addressParts.push(area)

  const cleanFormatted = (result?.formatted_address || "")
    .replace(/^[a-z0-9]{2,8}\+[a-z0-9]{0,3}[,\s]*/i, "")
    .replace(/,\s*India$/, "")
    .trim()

  const displayAddress = addressParts.join(", ") || cleanFormatted.split(",")[0] || ""
  const street = streetLine || area || cleanFormatted.split(",")[0]?.trim() || ""

  return {
    city: city || "",
    state: state || "",
    country: country || "India",
    area: area || "",
    street: street || "",
    pincode: pincode || "",
    placeName: placeName || "",
    mainTitle: placeName || area || city || displayAddress,
    address: displayAddress,
    formattedAddress: cleanFormatted || displayAddress,
    premise: premise || placeName || "",
    streetNumber,
    route,
    placeId: result?.place_id || "",
  }
}

/**
 * Reverse geocode lat/lng via backend proxy (Google key never hits the browser).
 * Fetches fresh results and aggregates address components without hardcoded fallbacks.
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

  // Use generalResults[0] (street address / premise) if available for most complete address components,
  // or fallback to best POI result.
  const result = generalResults[0] || pickBestGeocodeResult(poiResults) || pickBestGeocodeResult(generalResults)
  
  const parsed = result
    ? parseGoogleGeocodeResult(result, { placeName, allResults: combinedResults })
    : {
        city: "",
        state: "",
        area: "",
        street: "",
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
  const placeName = extractPlaceNameFromResults(data.results)

  return {
    ...parseGoogleGeocodeResult(result, { placeName, allResults: data.results }),
    latitude: Number(location?.lat),
    longitude: Number(location?.lng),
  }
}
