/**
 * Dynamic configuration for Rider App GPS tracking, smoothing, and socket synchronization.
 *
 * All values are configurable via Vite environment variables (VITE_GPS_*, VITE_SOCKET_LOC_*)
 * with production-tuned defaults designed for two-wheeler delivery riders.
 *
 * NO hardcoded values: any parameter can be adjusted per environment without code changes.
 */

const parseNumber = (val, fallback) => {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const parseBoolean = (val, fallback) => {
  if (val === undefined || val === null || val === '') return fallback;
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
};

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

export const LOCATION_CONFIG = {
  // --- Geolocation Hardware API Options ---
  ENABLE_HIGH_ACCURACY: parseBoolean(env.VITE_GPS_HIGH_ACCURACY, true),
  // Maximum age of cached GPS reading allowed (ms). Set to 1000ms to reject stale fixes
  MAXIMUM_AGE_MS: parseNumber(env.VITE_GPS_MAX_AGE_MS, 1000),
  // Timeout before geolocation watch returns an error callback (ms)
  GEOLOCATION_TIMEOUT_MS: parseNumber(env.VITE_GPS_TIMEOUT_MS, 15000),

  // --- Accuracy Filtering (Meters) ---
  // Reject updates when GPS accuracy radius exceeds this threshold (standard city GPS is 5-25m)
  MAX_ACCURACY_THRESHOLD_M: parseNumber(env.VITE_GPS_MAX_ACCURACY_M, 35),
  // Looser accuracy threshold allowed on initial lock if no good fix has been established yet
  MAX_INITIAL_ACCURACY_M: parseNumber(env.VITE_GPS_INITIAL_ACCURACY_M, 65),
  // How long a previous good fix remains considered fresh (ms)
  GOOD_FIX_FRESH_MS: parseNumber(env.VITE_GPS_GOOD_FIX_FRESH_MS, 15000),

  // --- Distance & Time Thresholds for Local Updates ---
  // Minimum time between local state updates to prevent processing every noisy high-frequency ping
  MIN_UPDATE_INTERVAL_MS: parseNumber(env.VITE_GPS_MIN_INTERVAL_MS, 800),
  // Minimum distance in meters to consider actual displacement rather than stationary noise
  MIN_UPDATE_DISTANCE_M: parseNumber(env.VITE_GPS_MIN_DISTANCE_M, 2.5),

  // --- Socket Emission Throttling (meaningful movement) ---
  // Minimum time between socket emits (ms)
  SOCKET_MIN_INTERVAL_MS: parseNumber(env.VITE_SOCKET_LOC_MIN_INTERVAL_MS, 2000),
  // Minimum distance moved before emitting via socket (meters)
  SOCKET_MIN_MOVE_M: parseNumber(env.VITE_SOCKET_LOC_MIN_MOVE_M, 6),
  // Maximum time without a socket emit when stationary before sending a heartbeat update (ms)
  SOCKET_MAX_SILENCE_MS: parseNumber(env.VITE_SOCKET_LOC_MAX_SILENCE_MS, 8000),

  // --- HTTP Heartbeat & Fallback ---
  HTTP_HEARTBEAT_MS: parseNumber(env.VITE_HTTP_HEARTBEAT_MS, 10000),
  HTTP_FALLBACK_MS: parseNumber(env.VITE_HTTP_FALLBACK_MS, 4000),

  // --- Vehicle & Movement Dynamics ---
  // Speed below which rider is considered stationary (m/s) -> 0.8 m/s is ~2.88 km/h
  STATIONARY_SPEED_THRESHOLD_MPS: parseNumber(env.VITE_GPS_STATIONARY_SPEED_MPS, 0.8),
  // Maximum realistic speed for a delivery vehicle in city (m/s) -> 35 m/s is 126 km/h
  // Fixes implying speeds exceeding this are rejected as GPS multipath glitches/jumps
  MAX_REALISTIC_SPEED_MPS: parseNumber(env.VITE_GPS_MAX_SPEED_MPS, 35),
  // Minimum speed before updating heading based on trajectory (m/s)
  MIN_SPEED_FOR_HEADING_MPS: parseNumber(env.VITE_GPS_MIN_SPEED_FOR_HEADING_MPS, 1.2),

  // --- Kalman Filter Dynamics ---
  // Process noise factor (how much the vehicle position is expected to change per second)
  KALMAN_PROCESS_NOISE_Q: parseNumber(env.VITE_KALMAN_PROCESS_NOISE_Q, 3.0),
  // Minimum measurement variance floor (meters^2)
  KALMAN_MIN_ACCURACY_VARIANCE: parseNumber(env.VITE_KALMAN_MIN_ACC_VARIANCE, 9.0), // 3m standard deviation

  // --- Marker Interpolation ---
  // Animation duration cap for smooth marker interpolation (ms)
  MIN_INTERP_DURATION_MS: parseNumber(env.VITE_MARKER_MIN_INTERP_MS, 400),
  MAX_INTERP_DURATION_MS: parseNumber(env.VITE_MARKER_MAX_INTERP_MS, 2500),

  // --- User App Tracking & Network Fallback ---
  // Fallback short-interval polling when socket connection drops (3-5s window)
  TRACKING_FALLBACK_POLL_MS: parseNumber(env.VITE_TRACKING_FALLBACK_POLL_MS, 4000),
  // Customer live location emission throttling
  USER_LOC_MIN_MOVE_M: parseNumber(env.VITE_USER_LOC_MIN_MOVE_M, 5),
  USER_LOC_MIN_INTERVAL_MS: parseNumber(env.VITE_USER_LOC_MIN_INTERVAL_MS, 3000),
  USER_LOC_MAX_SILENCE_MS: parseNumber(env.VITE_USER_LOC_MAX_SILENCE_MS, 15000),
};

export default LOCATION_CONFIG;
