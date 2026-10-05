/**
 * One-line delivery address for the restaurant and rider screens: the house /
 * flat number first, the landmark right after the street. Takes the order's
 * deliveryAddress object; a string is returned as it is.
 */
export function formatOrderAddress(address) {
  if (!address) return ""
  if (typeof address === "string") return address.trim()

  const landmark = String(address.landmark || "").trim().replace(/^near\s+/i, "")
  const parts = [
    address.houseNumber,
    address.street || address.addressLine1,
    address.additionalDetails || address.addressLine2,
    address.area,
    landmark ? `Near ${landmark}` : "",
    address.city,
    address.state,
    address.zipCode || address.pincode,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)

  // Area is often also saved as the additional details; show it once.
  return parts.filter((part, index) => parts.indexOf(part) === index).join(", ")
}
