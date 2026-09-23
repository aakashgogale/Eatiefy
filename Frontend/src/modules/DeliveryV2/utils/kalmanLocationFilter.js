import { getHaversineDistance, calculateHeading } from './geo.js';
import { LOCATION_CONFIG } from './locationConfig.js';

/**
 * 2D Kalman Filter and outlier rejection engine for real-time GPS tracking.
 *
 * Solves:
 * 1. GPS jumping & multipath reflection outliers (teleportation glitches).
 * 2. Stationary oscillation & micro-jitter when stopped at traffic lights or restaurants.
 * 3. Backward movement & sudden 180-degree heading flips caused by noisy coordinates.
 *
 * Dynamically adjusts measurement noise based on reported GPS accuracy radius.
 */
export class KalmanLocationFilter {
  constructor(config = LOCATION_CONFIG) {
    this.config = config;
    this.reset();
  }

  reset() {
    this.lat = null;
    this.lng = null;
    this.accuracy = null;
    this.variance = -1; // Estimated position variance (meters^2)
    this.timestamp = 0;
    this.speed = 0;
    this.heading = 0;
    this.isStationary = false;
  }

  /**
   * Meters to degrees latitude conversion factor (~111,320 meters per degree).
   */
  metersToLatDegrees(meters) {
    return meters / 111320;
  }

  /**
   * Meters to degrees longitude conversion factor at a specific latitude.
   */
  metersToLngDegrees(meters, lat) {
    const rad = (lat * Math.PI) / 180;
    const cosLat = Math.max(Math.cos(rad), 0.01);
    return meters / (111320 * cosLat);
  }

  /**
   * Smooth heading along shortest circular path [-180, 180].
   */
  smoothHeading(currentHeading, targetHeading, weight = 0.35) {
    if (!Number.isFinite(targetHeading)) return currentHeading || 0;
    if (!Number.isFinite(currentHeading)) return targetHeading;

    let delta = ((targetHeading - currentHeading + 540) % 360) - 180;
    // If heading difference is extreme (e.g. momentary 180 deg reverse ping while moving),
    // heavily damp it so the bike icon doesn't snap backwards
    if (Math.abs(delta) > 120 && this.speed > this.config.MIN_SPEED_FOR_HEADING_MPS) {
      weight = 0.15;
    }
    const result = (currentHeading + delta * weight + 360) % 360;
    return result;
  }

  /**
   * Ingest a new raw GPS point and return the filtered, smoothed coordinate.
   *
   * @param {Object} raw - { lat, lng, accuracy, speed, heading, timestamp }
   * @returns {Object} Filtered fix: { lat, lng, accuracy, speed, heading, timestamp, isStationary }
   */
  filter(raw) {
    if (!raw || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) {
      return this.getState();
    }

    const now = Number(raw.timestamp) || Date.now();
    const rawAcc = Number.isFinite(raw.accuracy) ? Math.max(raw.accuracy, 1) : 15;
    const rawSpeed = Number.isFinite(raw.speed) && raw.speed >= 0 ? raw.speed : null;
    const rawHeading = Number.isFinite(raw.heading) && raw.heading >= 0 ? raw.heading : null;

    // First valid point initializes the filter
    if (this.variance < 0 || this.lat === null || this.lng === null) {
      this.lat = raw.lat;
      this.lng = raw.lng;
      this.accuracy = rawAcc;
      this.variance = rawAcc * rawAcc;
      this.timestamp = now;
      this.speed = rawSpeed ?? 0;
      this.heading = rawHeading ?? 0;
      this.isStationary = this.speed < this.config.STATIONARY_SPEED_THRESHOLD_MPS;
      return this.getState();
    }

    const dtMs = now - this.timestamp;
    const dt = dtMs / 1000; // seconds

    // If gap between fixes is too large (> 30s), vehicle could be anywhere. Re-initialize.
    if (dt > 30) {
      this.lat = raw.lat;
      this.lng = raw.lng;
      this.accuracy = rawAcc;
      this.variance = rawAcc * rawAcc;
      this.timestamp = now;
      this.speed = rawSpeed ?? 0;
      if (rawHeading != null) this.heading = rawHeading;
      return this.getState();
    }

    // Ignore backwards or duplicate timestamps
    if (dt <= 0) {
      return this.getState();
    }

    const distanceMoved = getHaversineDistance(this.lat, this.lng, raw.lat, raw.lng);

    // --- Outlier Rejection (Speed Gating) ---
    // If distance jumped implies a speed exceeding MAX_REALISTIC_SPEED_MPS and exceeds
    // the accuracy radius, it is a GPS multipath glitch or cell-tower jump.
    const impliedSpeed = distanceMoved / dt;
    if (impliedSpeed > this.config.MAX_REALISTIC_SPEED_MPS && distanceMoved > rawAcc) {
      // Discard outlier, but update timestamp slightly to prevent time stall
      this.timestamp = now;
      return this.getState();
    }

    // --- Stationary Detection & Jitter Suppression ---
    // Determine speed: prefer hardware reported speed, otherwise derive from distance/time
    const currentSpeed = rawSpeed !== null ? rawSpeed : impliedSpeed;
    const isStationaryCandidate = currentSpeed < this.config.STATIONARY_SPEED_THRESHOLD_MPS;

    // If candidate is stationary and displacement is within normal GPS noise radius,
    // lock position and preserve heading so the marker doesn't wobble or spin
    const noiseRadius = Math.max(this.config.MIN_UPDATE_DISTANCE_M, Math.min(rawAcc * 0.4, 6));
    if (isStationaryCandidate && distanceMoved < noiseRadius) {
      this.isStationary = true;
      this.speed = 0;
      this.timestamp = now;
      // Variance decays slightly while stationary
      this.variance = Math.max(this.variance * 0.95, this.config.KALMAN_MIN_ACCURACY_VARIANCE);
      return this.getState();
    }

    this.isStationary = false;
    this.speed = currentSpeed;

    // --- 2D Kalman Filter Update ---
    // 1. Process Noise Prediction
    // Q = process noise: position uncertainty grows with time and vehicle movement
    const qFactor = Math.max(this.config.KALMAN_PROCESS_NOISE_Q, currentSpeed);
    const processNoiseMetersSq = (qFactor * dt) ** 2;
    let predictedVariance = this.variance + processNoiseMetersSq;

    // 2. Measurement Variance R
    // R is proportional to reported GPS accuracy squared
    const measurementVariance = Math.max(rawAcc * rawAcc, this.config.KALMAN_MIN_ACCURACY_VARIANCE);

    // 3. Kalman Gain K
    const kalmanGain = predictedVariance / (predictedVariance + measurementVariance);

    // 4. State Update (in meters converted to lat/lng)
    const latMetersToDeg = this.metersToLatDegrees(1);
    const lngMetersToDeg = this.metersToLngDegrees(1, this.lat);

    const deltaLatDeg = raw.lat - this.lat;
    const deltaLngDeg = raw.lng - this.lng;

    // Apply Kalman gain
    this.lat += deltaLatDeg * kalmanGain;
    this.lng += deltaLngDeg * kalmanGain;

    // 5. Covariance Update
    this.variance = (1 - kalmanGain) * predictedVariance;
    this.accuracy = Math.sqrt(this.variance);
    this.timestamp = now;

    // --- Heading Resolution & Smoothing ---
    // If device supplies reliable heading while moving, smooth towards it.
    // If not, derive heading from vector displacement only if movement is meaningful.
    if (this.speed >= this.config.MIN_SPEED_FOR_HEADING_MPS) {
      let targetHeading = rawHeading;
      if (targetHeading == null && distanceMoved > this.config.MIN_UPDATE_DISTANCE_M) {
        targetHeading = calculateHeading(this.lat, this.lng, raw.lat, raw.lng);
      }
      if (Number.isFinite(targetHeading)) {
        this.heading = this.smoothHeading(this.heading, targetHeading, 0.4);
      }
    }

    return this.getState();
  }

  getState() {
    return {
      lat: this.lat,
      lng: this.lng,
      accuracy: this.accuracy,
      speed: this.speed,
      heading: this.heading,
      timestamp: this.timestamp,
      isStationary: this.isStationary,
    };
  }
}

export default KalmanLocationFilter;
