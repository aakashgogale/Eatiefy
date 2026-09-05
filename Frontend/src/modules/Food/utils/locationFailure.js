import { toast } from "sonner"
import { GEO_ERROR } from "@food/utils/liveLocation"

/**
 * One toast id for the whole "use my current location" interaction.
 *
 * Loading, success and failure all reuse it, so a user tapping repeatedly
 * replaces the existing toast instead of stacking a column of identical errors.
 */
export const LOCATION_TOAST_ID = "location-request"

/**
 * What the user should actually do, per failure mode.
 *
 * Keyed by error code rather than message text: the timeout message reads
 * "…a location fix in time" and contains no "timeout", so substring matching
 * silently mislabelled the most common failure of all.
 */
const FAILURE_TEXT = {
  [GEO_ERROR.PERMISSION_DENIED]: {
    title: "Location permission is blocked",
    description: "Allow location for this site in your browser settings, then try again.",
    retryable: false,
  },
  [GEO_ERROR.INSECURE_CONTEXT]: {
    title: "Location needs a secure connection",
    description: "Open the site over HTTPS to use your current location.",
    retryable: false,
  },
  [GEO_ERROR.UNSUPPORTED]: {
    title: "Location isn't supported here",
    description: "This browser can't share location. Please pick an address instead.",
    retryable: false,
  },
  [GEO_ERROR.POSITION_UNAVAILABLE]: {
    title: "Couldn't find your location",
    description: "Turn on device location (GPS) and try again.",
    retryable: true,
  },
  [GEO_ERROR.TIMEOUT]: {
    title: "Taking longer than usual",
    description: "We couldn't get a GPS fix. Move near a window or try again.",
    retryable: true,
  },
  [GEO_ERROR.ABORTED]: {
    title: "Location request cancelled",
    description: "Try again when you're ready.",
    retryable: true,
  },
}

const DEFAULT_FAILURE = {
  title: "Couldn't get your location",
  description: "Please try again, or pick a saved address.",
  retryable: true,
}

/** The copy for a failure, without showing anything. */
export const describeLocationFailure = (error) =>
  FAILURE_TEXT[error?.code] || DEFAULT_FAILURE

/**
 * Explain why locating failed and, when retrying could actually help, offer it.
 *
 * Permission / HTTPS / unsupported failures get no retry button: pressing it
 * again cannot change the outcome, and offering it just invites the user to
 * hammer a dead end instead of fixing the setting.
 *
 * @param {{code?: string}} error   the rejected LocationError
 * @param {Function} [onRetry]      invoked by the Retry action
 * @param {string} [toastId]        override when a screen uses its own id
 */
export const showLocationFailureToast = (error, onRetry, toastId = LOCATION_TOAST_ID) => {
  const info = describeLocationFailure(error)
  toast.error(info.title, {
    id: toastId,
    description: info.description,
    duration: info.retryable ? 6000 : 8000,
    ...(info.retryable && typeof onRetry === "function"
      ? { action: { label: "Retry", onClick: () => onRetry() } }
      : {}),
  })
}
