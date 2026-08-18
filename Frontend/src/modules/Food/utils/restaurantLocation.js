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

export function formatRestaurantDisplayAddress(location, restaurantFallback = null) {
  if (!location && !restaurantFallback) return ""

  const formatted = location?.formattedAddress || location?.address || ""
  if (formatted && formatted !== "Select location" && !isCoordinateString(formatted)) {
    return String(formatted).trim()
  }

  const parts = []

  if (location?.addressLine1) parts.push(String(location.addressLine1).trim())
  if (location?.addressLine2) parts.push(String(location.addressLine2).trim())
  if (location?.area) parts.push(String(location.area).trim())
  if (location?.landmark) parts.push(String(location.landmark).trim())

  if (location?.city) {
    const city = String(location.city).trim()
    const cityAlreadyIncluded = parts.some((part) => part.toLowerCase().includes(city.toLowerCase()))
    if (!cityAlreadyIncluded) parts.push(city)
  }

  if (location?.state) {
    const state = String(location.state).trim()
    const stateAlreadyIncluded = parts.some((part) => part.toLowerCase().includes(state.toLowerCase()))
    if (!stateAlreadyIncluded) parts.push(state)
  }

  if (location?.pincode) parts.push(String(location.pincode).trim())

  if (parts.length > 0) return parts.join(", ")

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
