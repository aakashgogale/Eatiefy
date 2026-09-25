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

/*
 * Same session key and cooldown as the inline chunk-failure handler in
 * index.html, so the two can never reload in a loop between them.
 */
const CHUNK_RELOAD_STORAGE_KEY = "chunk_reload_timestamp"
const CHUNK_RELOAD_COOLDOWN_MS = 10000

/**
 * Reloads once to pick up the current build after a chunk failed to load (a
 * deploy replaced the hashed files, or a flaky network dropped the request).
 *
 * index.html does this for uncaught errors, but an error boundary catches the
 * failure first and React then no longer reports it to `window` - so boundaries
 * must trigger it themselves. Returns false (no reload) inside the cooldown or
 * when session storage is unavailable, so a chunk that is really missing shows
 * the fallback screen instead of reloading forever.
 */
export function reloadForChunkError() {
  if (typeof window === "undefined") return false
  try {
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY) || 0)
    if (Date.now() - last <= CHUNK_RELOAD_COOLDOWN_MS) return false
    window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}
