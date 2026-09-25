/**
 * Single place runtime failures are reported from.
 *
 * Every report is written to the console with its scope and context, so the
 * exact failure point is visible in production device / webview logs. When an
 * error-monitoring SDK exposing `captureException` (e.g. Sentry) has been loaded
 * on the page, the same error is forwarded to it. The SDK is looked up at call
 * time, so there is no hard dependency: the app behaves identically without it.
 *
 * Context must stay free of personal data (addresses, phone numbers, payment
 * payloads) - pass ids, stages and status codes only.
 */

const toError = (value) => {
  if (value instanceof Error) return value
  const message =
    (value && typeof value === "object" && (value.message || value.description)) ||
    (value == null ? "Unknown error" : String(value))
  return new Error(String(message))
}

const getMonitor = () => {
  if (typeof window === "undefined") return null
  const monitor = window.Sentry
  return monitor && typeof monitor.captureException === "function" ? monitor : null
}

export function reportError(error, context = {}) {
  const err = toError(error)
  const { scope = "app", ...extra } = context || {}

  try {
    console.error(`[${scope}]`, err, extra)
  } catch {
    // console can be unavailable in some embedded webviews
  }

  try {
    getMonitor()?.captureException(err, { tags: { scope }, extra })
  } catch {
    // reporting must never throw into the caller
  }

  return err
}

/**
 * True when a lazily loaded route chunk failed to download (flaky / slow
 * network, or a deploy replaced the hashed file). React.lazy caches the rejected
 * import, so only a full reload can recover from it.
 */
const CHUNK_LOAD_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading (CSS )?chunk [\w-]+ failed|ChunkLoadError|Expected a JavaScript(-or-Wasm)? module script/i

export function isChunkLoadError(error) {
  if (!error) return false
  return CHUNK_LOAD_ERROR_PATTERN.test(`${error.name || ""} ${error.message || error}`)
}
