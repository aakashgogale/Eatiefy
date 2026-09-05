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
  const city = parsed.city || "Indore"
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
    state: parsed.state || "Madhya Pradesh",
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
  const sublocality =
    getComponent(components, ["sublocality_level_1"]) || getComponent(components, ["sublocality"])
  const neighborhood = getComponent(components, ["neighborhood"])
  const locality = getComponent(components, ["locality"])
  const adminArea2 = getComponent(components, ["administrative_area_level_2"])
  const formattedAddressRaw = result?.formatted_address || ""
  const knownCityMatch = String(formattedAddressRaw).match(
    /\b(Indore|Bhopal|Ujjain|Dewas|Mhow|Pithampur|Rau)\b/i,
  )
  const city =
    (knownCityMatch
      ? knownCityMatch[1].replace(/^[a-z]/, (c) => c.toUpperCase())
      : "") ||
    (["indore", "bhopal", "ujjain", "dewas", "mhow", "pithampur", "rau"].includes(
      String(locality).toLowerCase(),
    )
      ? locality
      : "") ||
    (adminArea2.match(/\b(Indore|Bhopal|Ujjain|Dewas)\b/i)?.[1] || "") ||
    locality ||
    adminArea2
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

  let area = sublocality || neighborhood || ""
  if (!area && locality && locality.toLowerCase() !== String(city).toLowerCase()) {
    area = locality
  }

  const streetLine =
    streetNumber && route ? `${streetNumber}, ${route}` : route || ""

  const addressParts = []
  if (placeName) addressParts.push(placeName)
  if (streetLine && streetLine !== placeName) addressParts.push(streetLine)
  if (area) addressParts.push(area)

  const displayAddress = addressParts.join(", ") || result?.formatted_address?.split(",")[0] || ""

  const formattedAddress = result?.formatted_address || displayAddress

  return {
    city: city || "",
    state: state || "",
    country: country || "India",
    area,
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
