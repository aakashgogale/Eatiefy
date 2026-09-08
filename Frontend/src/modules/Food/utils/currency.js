/**
 * Currency Conversion Utility
 * Converts USD to INR (Indian Rupees)
 */

// Exchange rate: 1 USD = 83 INR (approximate)
const USD_TO_INR_RATE = 83

/**
 * Convert USD amount to INR
 * @param {number} usdAmount - Amount in USD
 * @returns {number} - Amount in INR
 */
export const usdToInr = (usdAmount) => {
  return parseFloat((usdAmount * USD_TO_INR_RATE).toFixed(2))
}

/**
 * Format amount with currency symbol
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency symbol (default: '₹')
 * @returns {string} - Formatted amount string
 */
export const formatCurrency = (amount, currency = '₹') => {
  return `${currency} ${parseFloat(amount).toFixed(2)}`
}

/**
 * Convert and format USD to INR
 * @param {number} usdAmount - Amount in USD
 * @returns {string} - Formatted amount in INR
 */
export const formatUsdToInr = (usdAmount) => {
  return formatCurrency(usdToInr(usdAmount))
}

export const RUPEE = "₹"

/** Strips any currency prefix/suffix and returns a finite number (0 when unparseable). */
export const toAmount = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (value === null || value === undefined) return 0

  const cleaned = String(value)
    // Every way a rupee amount shows up as text, plus stray replacement chars
    // from an earlier bad encoding pass.
    .replace(/[₹�?]/g, "")
    .replace(/\b(?:INR|Rs\.?)\b/gi, "")
    .replace(/,/g, "")
    .trim()

  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * "₹249.00" — exactly one symbol, always.
 * @param {number|string} value
 * @param {{ decimals?: number, withSymbol?: boolean }} [options]
 */
export const formatInr = (value, { decimals = 2, withSymbol = true } = {}) => {
  const amount = toAmount(value)
  const text = amount.toFixed(decimals)
  return withSymbol ? `${RUPEE}${text}` : text
}

/** "-₹50.00" for discount lines; the sign sits outside the symbol. */
export const formatInrDiscount = (value, options) =>
  `-${formatInr(Math.abs(toAmount(value)), options)}`

/**
 * Distance in the app's convention (km, one decimal).
 * Returns "" when there is genuinely no distance, so callers can show their own
 * unavailable state rather than a misleading "0 km".
 */
export const formatKm = (value) => {
  if (value === null || value === undefined || value === "") return ""
  const km = Number.parseFloat(String(value).replace(/km/i, "").trim())
  if (!Number.isFinite(km) || km < 0) return ""
  return `${km.toFixed(1)} km`
}
