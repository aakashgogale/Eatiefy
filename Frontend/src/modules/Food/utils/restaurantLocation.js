export function isCoordinateString(str) {
  if (!str) return false
  const trimmed = String(str).trim()
  return /^-?\d+\.\d+,\s*-?\d+\.\d+/.test(trimmed)
}

export function normalizeRestaurantLocationFields(source = {}) {
  if (!source || typeof source !== "object") return null

  const lat =
    source.latitude != null && source.latitude !== ""
      ? Number(source.latitude)
      : Array.isArray(source.coordinates)
        ? Number(source.coordinates[1])
        : null
  const lng =
    source.longitude != null && source.longitude !== ""
      ? Number(source.longitude)
      : Array.isArray(source.coordinates)
        ? Number(source.coordinates[0])
        : null

  return {
    formattedAddress: source.formattedAddress || source.address || "",
    addressLine1: source.addressLine1 || source.placeName || "",
    addressLine2: source.addressLine2 || "",
    area: source.area || "",
    city: source.city || "",
    state: source.state || "",
    pincode: source.pincode || "",
    landmark: source.landmark || source.placeName || "",
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    placeName: source.placeName || source.addressLine1 || "",
  }
}

/** Real text only — never the strings "undefined"/"null" that leak in from bad mappings. */
const cleanAddressPart = (value) => {
  const text = String(value ?? "").trim()
  if (!text) return ""
  const lowered = text.toLowerCase()
  if (lowered === "undefined" || lowered === "null") return ""
  return text
}

export function formatRestaurantDisplayAddress(location, restaurantFallback = null) {
  if (!location && !restaurantFallback) return ""

  const parts = []
  const addPart = (value) => {
    const text = cleanAddressPart(value)
    if (!text) return
    const lowered = text.toLowerCase()
    // Skip anything an earlier, longer part already covers (e.g. a city that is
    // part of addressLine1) so nothing is repeated.
    if (parts.some((part) => part.toLowerCase().includes(lowered))) return
    parts.push(text)
  }

  addPart(location?.addressLine1)
  addPart(location?.addressLine2)
  addPart(location?.area)
  addPart(location?.landmark)
  addPart(location?.city)
  addPart(location?.state)
  addPart(location?.pincode)

  const rawFormatted = cleanAddressPart(location?.formattedAddress || location?.address)
  const formatted =
    rawFormatted && rawFormatted !== "Select location" && !isCoordinateString(rawFormatted)
      ? rawFormatted
      : ""

  if (parts.length > 0) {
    // `formattedAddress` is a geocoder summary and is frequently shorter than
    // what the restaurant actually saved — returning it first, as this used to,
    // dropped the building, street and pincode from the displayed address.
    // Prefer it only when it already contains every structured part, i.e. it is
    // strictly the richer string.
    const lowerFormatted = formatted.toLowerCase()
    const formattedCoversEverything =
      formatted && parts.every((part) => lowerFormatted.includes(part.toLowerCase()))
    if (formattedCoversEverything && formatted.length >= parts.join(", ").length) {
      return formatted
    }
    return parts.join(", ")
  }

  if (formatted) return formatted

  if (restaurantFallback) {
    const flatParts = [restaurantFallback.area, restaurantFallback.city].filter(Boolean)
    if (flatParts.length > 0) return flatParts.join(", ")

    if (restaurantFallback.address && !isCoordinateString(restaurantFallback.address)) {
      return String(restaurantFallback.address).trim()
    }
  }

  return ""
}

export function buildRestaurantLocationUpdatePayload(fields = {}) {
  const lat = fields.latitude != null && fields.latitude !== "" ? Number(fields.latitude) : null
  const lng = fields.longitude != null && fields.longitude !== "" ? Number(fields.longitude) : null

  const formattedAddress = String(fields.formattedAddress || "").trim()
  const addressLine1 = String(fields.addressLine1 || fields.placeName || "").trim()
  const addressLine2 = String(fields.addressLine2 || "").trim()
  const area = String(fields.area || "").trim()
  const city = String(fields.city || "").trim()
  const state = String(fields.state || "").trim()
  const pincode = String(fields.pincode || "").trim()
  const landmark = String(fields.landmark || fields.placeName || "").trim()

  return {
    formattedAddress: formattedAddress || addressLine1 || area || city,
    addressLine1,
    addressLine2,
    area,
    city,
    state,
    pincode,
    landmark,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
  }
}

export function getRestaurantDisplayAddress(restaurant) {
  if (!restaurant || typeof restaurant !== "object") return ""

  const nested = restaurant.location || restaurant.onboarding?.step1?.location || null

  const locationForDisplay = {
    formattedAddress:
      nested?.formattedAddress ||
      nested?.address ||
      restaurant.formattedAddress ||
      restaurant.address ||
      "",
    addressLine1: nested?.addressLine1 || restaurant.addressLine1 || "",
    addressLine2: nested?.addressLine2 || restaurant.addressLine2 || "",
    area: nested?.area || restaurant.area || "",
    city: nested?.city || restaurant.city || "",
    state: nested?.state || restaurant.state || "",
    pincode: nested?.pincode || restaurant.pincode || "",
    landmark: nested?.landmark || restaurant.landmark || "",
    latitude: nested?.latitude ?? restaurant.latitude,
    longitude: nested?.longitude ?? restaurant.longitude,
  }

  return formatRestaurantDisplayAddress(locationForDisplay, restaurant)
}

export function dispatchRestaurantLocationUpdated() {
  window.dispatchEvent(new Event("ownerDataUpdated"))
  window.dispatchEvent(new Event("addressUpdated"))
}
