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

/* ---------------------------------------------------------------------------
 * Production localhost guard
 *
 * The bundle is static: whatever VITE_API_BASE_URL / VITE_UPLOAD_BASE_URL held
 * at build time is shipped to every browser. Building without .env.production
 * therefore bakes the dev URL in, and every request from https://eatiefy.com
 * dies with net::ERR_CONNECTION_REFUSED against the visitor's own machine.
 *
 * When the page itself is served from a real domain, a localhost base URL is
 * always wrong, so fall back to the page origin — correct here because nginx
 * proxies /api/v1, /uploads and /socket.io on that same origin. The mistake is
 * logged loudly instead of failing silently.
 *
 * Local development is untouched: the page origin is localhost there, so the
 * condition never fires. This mirrors the same safety net in socketClient.js.
 * ------------------------------------------------------------------------- */

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

const isLocalHostname = (hostname) => LOCAL_HOSTNAMES.has(String(hostname || "").toLowerCase());

const pageOrigin = () =>
  typeof window !== "undefined" && window.location ? window.location.origin : "";

/** True when the page is NOT served from a real public domain (dev, or no DOM). */
const pageIsLocal = () => {
  const origin = pageOrigin();
  if (!origin) return true;
  try {
    return isLocalHostname(new URL(origin).hostname);
  } catch {
    return true;
  }
};

let warnedOnce = false;

/**
 * Rewrites a localhost base URL onto the page origin when the app is running on
 * a real domain. Returns the value untouched in every other case.
 * @param {string} value
 * @param {string} label env var name, used in the console message
 * @returns {string}
 */
export const preferPageOriginOverLocalhost = (value, label = "VITE_API_BASE_URL") => {
  const raw = String(value || "").trim();
  if (!raw) return raw;

  const origin = pageOrigin();
  if (!origin || pageIsLocal()) return raw;

  let parsed;
  try {
    parsed = new URL(raw, origin);
  } catch {
    return raw;
  }
  if (!isLocalHostname(parsed.hostname)) return raw;

  const target = new URL(origin);
  parsed.protocol = target.protocol;
  parsed.hostname = target.hostname;
  parsed.port = target.port;

  if (!warnedOnce) {
    warnedOnce = true;
    console.error(
      "[config] " + label + ' points at "' + raw + '" but this app is served from ' +
        origin + ". The build used the wrong env file (.env instead of " +
        ".env.production), so rebuild with the production env. Falling back to " +
        parsed.origin + " for now.",
    );
  }

  return parsed.toString().replace(/\/+$/, "");
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
  const sanitized = preferPageOriginOverLocalhost(sanitizeProtocol(rawBaseUrl), "VITE_API_BASE_URL");
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
