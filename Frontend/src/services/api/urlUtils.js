/**
 * Centralized API URL Normalizer
 * Guarantees every API request uses a valid http/https protocol and correct /api/v1 path.
 */

/**
 * Ensures protocol starts with http:// or https:// and fixes protocol typos (e.g. ttps://, tps://)
 * @param {string} urlStr 
 * @returns {string}
 */
export const sanitizeProtocol = (urlStr) => {
  let str = String(urlStr || "").trim();
  if (!str) return "";

  // Fix protocol corruption (e.g. "ttps://", "tps://", "ps://")
  if (/^ttps:\/\//i.test(str) || /^tps:\/\//i.test(str) || /^ps:\/\//i.test(str)) {
    str = "https://" + str.replace(/^[^:]+:\/\//, "");
  } else if (/^http:\/\//i.test(str)) {
    // Keep valid http://
  } else if (/^https:\/\//i.test(str)) {
    // Keep valid https://
  } else if (/^https?:\/(?!\/)/i.test(str)) {
    str = str.replace(/^(https?):\/(?!\/)/i, "$1://");
  } else if (/^\/\//.test(str)) {
    str = "https:" + str;
  } else if (!/^https?:\/\//i.test(str)) {
    str = "https://" + str.replace(/^[:/]+/, "");
  }

  // Fix multiple slashes in protocol (e.g. https:///)
  str = str.replace(/^(https?):\/\/+/i, "$1://");

  return str;
};

/**
 * Normalizes API Base URL to ensure:
 * 1. Protocol is valid (http:// or https://)
 * 2. Path includes /api/v1 suffix
 * 3. No trailing slashes
 * @param {string} rawBaseUrl 
 * @returns {string}
 */
export const normalizeApiBaseUrl = (rawBaseUrl) => {
  const sanitized = sanitizeProtocol(rawBaseUrl);
  if (!sanitized) return "";

  // Remove trailing slashes
  let clean = sanitized.replace(/\/+$/, "");

  // Ensure /api/v1 is present at end of base URL if not already present
  if (!/\/api\/v\d+$/i.test(clean)) {
    if (/\/api$/i.test(clean)) {
      clean = `${clean}/v1`;
    } else {
      clean = `${clean}/api/v1`;
    }
  }

  return clean;
};

/**
 * Normalizes backend origin (without /api/v1) for media uploads and sockets
 * @param {string} rawBaseUrl 
 * @returns {string}
 */
export const normalizeBackendOrigin = (rawBaseUrl) => {
  const fullBase = normalizeApiBaseUrl(rawBaseUrl);
  if (!fullBase) return "";
  return fullBase
    .replace(/\/api\/v\d+\/?$/i, "")
    .replace(/\/api\/?$/i, "")
    .replace(/\/+$/, "");
};
