/**
 * Live location acquisition.
 *
 * A single `getCurrentPosition({ enableHighAccuracy: true })` is the wrong tool for
 * a "use my current location" button. The browser resolves it with whatever fix is
 * available first — usually a Wi-Fi/cell estimate accurate to 1-3 km — and you are
 * stuck with it. That is why the pin lands in the wrong place.
 *
 * Apps like Zomato and Swiggy do not take one reading. They open a *stream* of
 * fixes, show the first one instantly so the UI never feels stuck, and keep the
 * stream open while the GPS converges — settling on a fix once it is accurate
 * enough, or when a deadline is reached. This module implements that:
 *
 *   1. Fail fast on the things that can never succeed (insecure context, denied
 *      permission) instead of burning a 20 s timeout on them.
 *   2. `watchPosition` with high accuracy, tracking the best fix seen so far.
 *   3. Resolve as soon as accuracy reaches `desiredAccuracyM` ("one go" success).
 *   4. Resolve at `quickWaitMs` if the fix is already good enough to use.
 *   5. Resolve when the GPS stops improving (it has converged).
 *   6. Resolve at `maxWaitMs` with the best fix seen, rather than failing.
 *   7. Always clear the watch.
 *
 * Every threshold is a parameter — nothing about any city, region or coordinate is
 * assumed anywhere in this file.
 */

/**
 * Above this radius a fix cannot have come from GPS.
 *
 * Android 12+ lets a user grant "Approximate" location instead of "Precise", and
 * iOS has the same switch. The browser does not expose which was granted — the
 * only signal is the accuracy it reports, which sits in the 1–3 km range and,
 * crucially, never improves however long the watch stays open. That is
 * indistinguishable from a locality, so the address can only ever be city-level.
 * Detect it and tell the user, rather than silently showing them the wrong place.
 */
export const APPROXIMATE_ACCURACY_M = 500

export const GEO_ERROR = {
  UNSUPPORTED: 'UNSUPPORTED',
  INSECURE_CONTEXT: 'INSECURE_CONTEXT',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  POSITION_UNAVAILABLE: 'POSITION_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  ABORTED: 'ABORTED',
};

const MESSAGES = {
  [GEO_ERROR.UNSUPPORTED]: 'This browser does not support location access.',
  [GEO_ERROR.INSECURE_CONTEXT]:
    'Location needs a secure connection. Open the site over HTTPS and try again.',
  [GEO_ERROR.PERMISSION_DENIED]:
    'Location permission is blocked. Allow it from the address bar or your browser settings.',
  [GEO_ERROR.POSITION_UNAVAILABLE]:
    'Your device could not determine a position. Turn on device location and try again.',
  [GEO_ERROR.TIMEOUT]:
    'Could not get a location fix in time. Move near a window or try again.',
  [GEO_ERROR.ABORTED]: 'Location request was cancelled.',
};

export class LocationError extends Error {
  constructor(code, cause) {
    super(MESSAGES[code] || 'Could not get your location.');
    this.name = 'LocationError';
    this.code = code;
    this.cause = cause;
  }
}

const mapBrowserError = (err) => {
  if (!err) return GEO_ERROR.POSITION_UNAVAILABLE;
  switch (err.code) {
    case 1:
      return GEO_ERROR.PERMISSION_DENIED;
    case 2:
      return GEO_ERROR.POSITION_UNAVAILABLE;
    case 3:
      return GEO_ERROR.TIMEOUT;
    default:
      return GEO_ERROR.POSITION_UNAVAILABLE;
  }
};

/**
 * Geolocation is only exposed in a secure context. Served over plain http on a real
 * domain, `navigator.geolocation` exists but every call fails — which reads as
 * "location just doesn't work on the server" while it works on localhost (which
 * browsers treat as secure). Detect it explicitly.
 * @returns {boolean}
 */
export const isGeolocationUsable = () =>
  typeof navigator !== 'undefined' &&
  'geolocation' in navigator &&
  (typeof window === 'undefined' || window.isSecureContext !== false);

/**
 * Reads the permission state without triggering a prompt.
 * @returns {Promise<'granted'|'denied'|'prompt'|'unknown'>}
 */
export const getPermissionState = async () => {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status?.state || 'unknown';
  } catch {
    return 'unknown';
  }
};

const toFix = (position) => ({
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : Infinity,
  altitude: position.coords.altitude ?? null,
  heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
  speed: Number.isFinite(position.coords.speed) ? position.coords.speed : null,
  timestamp: position.timestamp || Date.now(),
});

/**
 * Acquires the device position, refining it until it is accurate enough.
 *
 * @param {object} [options]
 * @param {number} [options.desiredAccuracyM=50]     resolve immediately at or below this radius
 * @param {number} [options.acceptableAccuracyM=150] good enough to stop waiting at `quickWaitMs`
 * @param {number} [options.quickWaitMs=3500]        when an acceptable fix is returned early
 * @param {number} [options.maxWaitMs=15000]         hard deadline; best fix so far wins
 * @param {number} [options.maximumAge=0]            0 = never reuse a cached fix
 * @param {number} [options.settleAfterStaleFixes=3] stop once accuracy stops improving
 * @param {(fix: object) => void} [options.onProgress] called on every improved fix
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{latitude:number,longitude:number,accuracy:number,heading:number|null,
 *                    speed:number|null,timestamp:number,isPrecise:boolean,elapsedMs:number}>}
 */
export const acquireLocation = ({
  desiredAccuracyM = 50,
  acceptableAccuracyM = 150,
  quickWaitMs = 3500,
  maxWaitMs = 15000,
  maximumAge = 0,
  settleAfterStaleFixes = 3,
  onProgress,
  signal,
} = {}) =>
  new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new LocationError(GEO_ERROR.UNSUPPORTED));
      return;
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      reject(new LocationError(GEO_ERROR.INSECURE_CONTEXT));
      return;
    }

    const startedAt = Date.now();
    let best = null;
    let staleFixes = 0;
    let watchId = null;
    let quickTimer = null;
    let hardTimer = null;
    let done = false;

    const cleanup = () => {
      if (watchId !== null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          /* watch already gone */
        }
        watchId = null;
      }
      if (quickTimer) clearTimeout(quickTimer);
      if (hardTimer) clearTimeout(hardTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    const settle = (fix) => {
      if (done) return;
      done = true;
      cleanup();
      resolve({
        ...fix,
        isPrecise: fix.accuracy <= acceptableAccuracyM,
        // The receiver had its full window and still could not do better than a
        // kilometre — the device is withholding precise location.
        isApproximate: fix.accuracy > APPROXIMATE_ACCURACY_M,
        elapsedMs: Date.now() - startedAt,
      });
    };

    const fail = (code, cause) => {
      if (done) return;
      // A usable fix beats an error — a late timeout should not throw away a good
      // reading we already have.
      if (best && code === GEO_ERROR.TIMEOUT) {
        settle(best);
        return;
      }
      done = true;
      cleanup();
      reject(new LocationError(code, cause));
    };

    function onAbort() {
      fail(GEO_ERROR.ABORTED);
    }

    if (signal) {
      if (signal.aborted) {
        reject(new LocationError(GEO_ERROR.ABORTED));
        return;
      }
      signal.addEventListener('abort', onAbort);
    }

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const fix = toFix(position);

        // Keep the tightest fix seen. GPS often reports worse readings in between
        // good ones, so never let accuracy regress.
        if (!best || fix.accuracy < best.accuracy) {
          best = fix;
          staleFixes = 0;
          if (typeof onProgress === 'function') {
            try {
              onProgress({ ...fix, isPrecise: fix.accuracy <= acceptableAccuracyM });
            } catch {
              /* progress callbacks must never break acquisition */
            }
          }
        } else {
          staleFixes += 1;
        }

        // Accurate enough — this is the "got it in one go" path.
        if (best.accuracy <= desiredAccuracyM) {
          settle(best);
          return;
        }

        // The receiver has converged: further waiting will not improve anything.
        if (staleFixes >= settleAfterStaleFixes && best.accuracy <= acceptableAccuracyM) {
          settle(best);
        }
      },
      (err) => {
        const code = mapBrowserError(err);
        // A denied permission or dead receiver cannot recover by waiting.
        if (code === GEO_ERROR.PERMISSION_DENIED) {
          fail(code, err);
          return;
        }
        if (!best && code === GEO_ERROR.POSITION_UNAVAILABLE) {
          fail(code, err);
        }
        // Otherwise keep the watch open until a timer fires.
      },
      { enableHighAccuracy: true, maximumAge, timeout: maxWaitMs },
    );

    quickTimer = setTimeout(() => {
      if (best && best.accuracy <= acceptableAccuracyM) settle(best);
    }, quickWaitMs);

    hardTimer = setTimeout(() => {
      if (best) settle(best);
      else fail(GEO_ERROR.TIMEOUT);
    }, maxWaitMs);
  });

/**
 * Convenience wrapper for callers that just need coordinates.
 * @param {object} [options] forwarded to {@link acquireLocation}
 * @returns {Promise<{latitude:number,longitude:number,accuracy:number}>}
 */
export const getCurrentCoordinates = async (options) => {
  const fix = await acquireLocation(options);
  return { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy };
};

export default acquireLocation;
