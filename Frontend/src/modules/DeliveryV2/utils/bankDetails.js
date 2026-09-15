/**
 * Bank detail normalisation + validation shared by the delivery bank screens.
 * Mirrors Backend/src/modules/food/delivery/validators/delivery.validator.js so
 * the app never rejects details the server accepts (or the reverse).
 */

export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/
export const BANK_ACCOUNT_NUMBER_REGEX = /^[A-Z0-9]{6,20}$/
export const UPI_ID_REGEX = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,64}$/
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/

export const normalizeAccountNumber = (value) =>
  String(value ?? "").replace(/[\s-]/g, "").toUpperCase()
export const normalizeIfsc = (value) => String(value ?? "").replace(/\s/g, "").toUpperCase()
export const normalizePan = (value) => String(value ?? "").replace(/\s/g, "").toUpperCase()
const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim()

/** Returns normalised values ready to send to the API. */
export const normalizeBankDetails = (details = {}) => ({
  accountHolderName: normalizeText(details.accountHolderName),
  accountNumber: normalizeAccountNumber(details.accountNumber),
  ifscCode: normalizeIfsc(details.ifscCode),
  bankName: normalizeText(details.bankName),
  upiId: String(details.upiId ?? "").trim(),
  panNumber: normalizePan(details.panNumber),
})

/** Returns `{ field: message }` for invalid fields; empty object when valid. */
export const validateBankDetails = (details = {}) => {
  const d = normalizeBankDetails(details)
  const errors = {}

  if (d.accountHolderName && (d.accountHolderName.length < 2 || d.accountHolderName.length > 100 || !/[A-Za-z]/.test(d.accountHolderName))) {
    errors.accountHolderName = "Enter a valid account holder name"
  }
  if (d.accountNumber && (!BANK_ACCOUNT_NUMBER_REGEX.test(d.accountNumber) || !/\d/.test(d.accountNumber))) {
    errors.accountNumber = "Enter a valid bank account number (6-20 characters)"
  }
  if (d.ifscCode && !IFSC_REGEX.test(d.ifscCode)) {
    errors.ifscCode = "Enter a valid 11-character IFSC code (e.g. SBIN0001234)"
  }
  if (d.accountNumber && !d.ifscCode) {
    errors.ifscCode = "IFSC code is required with the account number"
  }
  if (d.ifscCode && !d.accountNumber) {
    errors.accountNumber = "Account number is required with the IFSC code"
  }
  if ((d.accountNumber || d.ifscCode) && !d.accountHolderName) {
    errors.accountHolderName = "Account holder name is required"
  }
  if (d.bankName.length > 100) {
    errors.bankName = "Bank name is too long"
  }
  if (d.upiId && !UPI_ID_REGEX.test(d.upiId)) {
    errors.upiId = "Enter a valid UPI ID (e.g. name@bank)"
  }
  if (d.panNumber && !PAN_REGEX.test(d.panNumber)) {
    errors.panNumber = "Enter a valid PAN number (e.g. ABCDE1234F)"
  }

  return errors
}

const ifscLookupCache = new Map()

/**
 * Best-effort bank/branch lookup for an IFSC code (Razorpay's public IFSC
 * directory). Never blocks saving: resolves null on any failure or timeout.
 */
export const lookupIfsc = async (ifsc) => {
  const code = normalizeIfsc(ifsc)
  if (!IFSC_REGEX.test(code)) return null
  if (ifscLookupCache.has(code)) return ifscLookupCache.get(code)

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null
  const timer = setTimeout(() => controller?.abort(), 5000)
  try {
    const res = await fetch(`https://ifsc.razorpay.com/${code}`, { signal: controller?.signal })
    if (!res.ok) {
      // 404 means the directory does not know this code; do not treat as invalid.
      ifscLookupCache.set(code, null)
      return null
    }
    const data = await res.json()
    const result = data?.BANK ? { bankName: String(data.BANK), branch: String(data.BRANCH || "") } : null
    ifscLookupCache.set(code, result)
    return result
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
