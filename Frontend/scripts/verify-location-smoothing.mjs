import { KalmanLocationFilter } from '../src/modules/DeliveryV2/utils/kalmanLocationFilter.js';
import { LOCATION_CONFIG } from '../src/modules/DeliveryV2/utils/locationConfig.js';
import { getHaversineDistance, calculateHeading } from '../src/modules/DeliveryV2/utils/geo.js';

console.log('=== Real-Time Location Tracking & Smoothing Verification ===\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests += 1;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ PASS: ${message}`);
    passedTests += 1;
  }
}

// Test 1: Configuration is dynamic and properly populated
assert(LOCATION_CONFIG.ENABLE_HIGH_ACCURACY === true, 'High accuracy is enabled');
assert(LOCATION_CONFIG.MAX_ACCURACY_THRESHOLD_M > 0, `Max accuracy threshold is ${LOCATION_CONFIG.MAX_ACCURACY_THRESHOLD_M}m`);
assert(LOCATION_CONFIG.SOCKET_MIN_MOVE_M > 0, `Socket min move is ${LOCATION_CONFIG.SOCKET_MIN_MOVE_M}m`);
assert(LOCATION_CONFIG.MAXIMUM_AGE_MS === 1000, 'Max cache age is 1000ms (rejecting stale cache)');

// Test 2: Kalman Filter initialization
const filter = new KalmanLocationFilter(LOCATION_CONFIG);
const t0 = 1700000000000;
const origin = { lat: 22.7196, lng: 75.8577, accuracy: 12, speed: 0, heading: 45, timestamp: t0 };

const initFix = filter.filter(origin);
assert(initFix.lat === origin.lat && initFix.lng === origin.lng, 'Filter initializes to first fix');
assert(initFix.isStationary === true, 'Initial stationary state correctly detected');
assert(initFix.heading === 45, 'Initial heading retained');

// Test 3: Stationary Jitter Suppression
// Simulate 10 stationary pings with random ±3 meter GPS jitter around Indore center
console.log('\nTesting stationary jitter suppression over 10 pings...');
let maxDrift = 0;
for (let i = 1; i <= 10; i++) {
  const jitterLat = origin.lat + (Math.sin(i) * 0.00002); // ~2.2 meters jitter
  const jitterLng = origin.lng + (Math.cos(i) * 0.00002);
  const fix = filter.filter({
    lat: jitterLat,
    lng: jitterLng,
    accuracy: 15,
    speed: 0.2, // ~0.7 km/h (standing still)
    heading: (i * 70) % 360, // Noisy random sensor heading
    timestamp: t0 + i * 1000,
  });
  const drift = getHaversineDistance(origin.lat, origin.lng, fix.lat, fix.lng);
  if (drift > maxDrift) maxDrift = drift;
}
assert(maxDrift < 2.0, `Stationary drift heavily suppressed (max drift: ${maxDrift.toFixed(2)}m < 2.0m)`);
assert(filter.getState().heading === 45, 'Heading preserved without spinning during stationary jitter');

// Test 4: Outlier / Teleportation Jump Rejection
console.log('\nTesting outlier / speed-gating rejection...');
const jumpFix = filter.filter({
  lat: origin.lat + 0.005, // ~550 meters away in 1 second (~1980 km/h)
  lng: origin.lng + 0.005,
  accuracy: 30,
  speed: 15,
  heading: 90,
  timestamp: t0 + 11000,
});
const jumpDistance = getHaversineDistance(origin.lat, origin.lng, jumpFix.lat, jumpFix.lng);
assert(jumpDistance < 5, `Impossible GPS jump rejected (distance from origin: ${jumpDistance.toFixed(2)}m)`);

// Test 5: Smooth Movement along a Route
console.log('\nTesting route tracking with realistic GPS noise...');
const movingFilter = new KalmanLocationFilter(LOCATION_CONFIG);
// Moving eastward at ~8 m/s (~29 km/h)
let currentLat = 22.7196;
let currentLng = 75.8577;
const stepLng = 0.00008; // ~8.1m east per second
movingFilter.filter({ lat: currentLat, lng: currentLng, accuracy: 8, speed: 8, heading: 90, timestamp: t0 });

let smoothPoints = [];
for (let s = 1; s <= 5; s++) {
  currentLng += stepLng;
  // Add noise of ±5 meters
  const noisyLat = currentLat + ((s % 2 === 0 ? 1 : -1) * 0.00004);
  const fix = movingFilter.filter({
    lat: noisyLat,
    lng: currentLng,
    accuracy: 10,
    speed: 8,
    heading: 90,
    timestamp: t0 + s * 1000,
  });
  smoothPoints.push(fix);
}

// Verify latitude variance is smoothed compared to noisy inputs
const lastPoint = smoothPoints[smoothPoints.length - 1];
const lateralDeviation = Math.abs(lastPoint.lat - currentLat) * 111320;
assert(lateralDeviation < 3.0, `Lateral GPS noise smoothed (lateral deviation: ${lateralDeviation.toFixed(2)}m < 3.0m)`);
assert(Math.abs(lastPoint.heading - 90) < 15, `Heading smoothly tracked movement direction (${lastPoint.heading.toFixed(1)} deg ~ 90 deg)`);

// Test 6: Socket Throttling Logic Simulation
console.log('\nTesting socket emission throttling logic...');
const SOCKET_MIN_INTERVAL = LOCATION_CONFIG.SOCKET_MIN_INTERVAL_MS;
const SOCKET_MIN_MOVE = LOCATION_CONFIG.SOCKET_MIN_MOVE_M;

let lastSocket = { at: t0, lat: origin.lat, lng: origin.lng };
function shouldEmit(newFix, time) {
  const moved = getHaversineDistance(lastSocket.lat, lastSocket.lng, newFix.lat, newFix.lng);
  const since = time - lastSocket.at;
  return (moved >= SOCKET_MIN_MOVE && since >= SOCKET_MIN_INTERVAL) || (since >= LOCATION_CONFIG.SOCKET_MAX_SILENCE_MS);
}

// 1 second later, moved only 2 meters -> should NOT emit
assert(!shouldEmit({ lat: origin.lat + 0.000018, lng: origin.lng }, t0 + 1000), 'Did not emit for small micro-move (2m) before min interval');

// 2.5 seconds later, moved 10 meters -> SHOULD emit
const movedPoint = { lat: origin.lat, lng: origin.lng + 0.0001 }; // ~10.2m
assert(shouldEmit(movedPoint, t0 + 2500), 'Emits for meaningful movement (10m >= 6m && 2.5s >= 2s)');

console.log(`\n========================================`);
console.log(`Results: ${passedTests} / ${totalTests} assertions passed.`);
if (passedTests === totalTests) {
  console.log('🎉 All smoothing and throttling verifications PASSED successfully!');
}
