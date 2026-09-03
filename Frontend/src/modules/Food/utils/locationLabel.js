/**
 * One place that decides what a resolved location is *called* in the UI.
 *
 * The navbars and `buildDisplayAddressText` used to render `area, city` and fall
 * back to the bare city — which throws away everything reverse geocoding worked
 * out (the building, the street, the neighbourhood) and leaves the user staring
 * at "Indore" when they asked for their live location.
 *
 * The label built here reads most-specific-first and is anchored by the city, so
 * a precise fix renders as "MG Road, New Palasia, Indore" and a coarse one
 * degrades honestly instead of pretending to be precise.
 */

/** Kept short so it fits a navbar line without truncating mid-word. */
const MAX_SEGMENTS = 3

const PLACEHOLDERS = new Set(["select location", "current location", ""])

const clean = (value) => String(value ?? "").trim()

const isPlaceholder = (value) => {
  const text = clean(value).toLowerCase()
  if (PLACEHOLDERS.has(text)) return true
  // A bare "22.7196, 75.8577" is a failed geocode, not an address.
  return /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(text)
}

const firstUsable = (...candidates) => {
  for (const candidate of candidates) {
    const text = clean(candidate)
    if (text && !isPlaceholder(text)) return text
  }
  return ""
}

const splitParts = (value) =>
  String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)

/**
 * A `formatted_address` ends in administrative noise — "Indore, Madhya Pradesh
 * 452007, India". Keep only what comes before the city so the label stays local;
 * the city is appended separately afterwards.
 */
const localityPartsOf = (formattedAddress, city, state) => {
  const parts = splitParts(formattedAddress)
  const stop = parts.findIndex((part) => {
    const lower = part.toLowerCase()
    if (city && lower === city.toLowerCase()) return true
    if (state && lower.includes(state.toLowerCase())) return true
    // "Madhya Pradesh 452007" / "452007" / "India"
    return /\d{5,}/.test(part) || lower === "india"
  })
  return stop === -1 ? parts : parts.slice(0, stop)
}

/**
 * Short, specific label for a header/navbar.
 * @param {object|null} location a resolved location (live, saved, or effective)
 * @param {string} [fallback="Select location"] shown when nothing resolved
 * @returns {string}
 */
export function preciseLocationLabel(location, fallback = "Select location") {
  if (!location || typeof location !== "object") return fallback

  const city = clean(location.city)
  const area = clean(location.area)
  const state = clean(location.state)

  // `address` is already the trimmed "place, street, area" line built during
  // reverse geocoding, so it is the best starting point.
  const specific = firstUsable(location.address, location.mainTitle, location.placeName)
  const formatted = firstUsable(location.formattedAddress)

  // Trim the administrative tail off whichever line we use: a coarse `address` of
  // "Indore, Madhya Pradesh, India" must not read as two segments of detail.
  const segments = localityPartsOf(specific || formatted, city, state)

  const label = []
  const add = (value) => {
    const text = clean(value)
    if (!text || isPlaceholder(text)) return
    const lower = text.toLowerCase()
    // Skip anything an existing segment already says ("New Palasia" after
    // "Princess Centre, New Palasia").
    if (label.some((part) => part.toLowerCase().includes(lower))) return
    label.push(text)
  }

  // Two segments of detail, then the neighbourhood, then the city as the anchor.
  segments.slice(0, 2).forEach(add)
  add(area)
  add(city)

  return label.slice(0, MAX_SEGMENTS).join(", ") || fallback
}

/**
 * City names usable for splitting a formatted address into "locality" and "city"
 * parts: the geocoded city for this very location, plus whatever cities the admin
 * settings say the platform serves.
 *
 * Address parsing used to test against a literal `["Indore", "Bhopal", "Mumbai",
 * "Delhi"]` array, so in every other city the split silently failed and the label
 * fell back to the city name. Nothing here is baked into the app.
 * @param {object|null} location
 * @returns {string[]}
 */
export function getKnownCityNames(location) {
  const names = []
  const push = (value) => {
    const text = clean(value)
    if (text && !names.some((n) => n.toLowerCase() === text.toLowerCase())) names.push(text)
  }

  push(location?.city)
  try {
    const saved = JSON.parse(localStorage.getItem("eatify_customization_settings") || "{}")
    if (Array.isArray(saved.service_cities)) saved.service_cities.forEach(push)
  } catch {
    /* settings not cached yet — the geocoded city alone is still correct */
  }
  return names
}

export default preciseLocationLabel
