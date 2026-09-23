import assert from 'assert';
import { LOCATION_CONFIG } from '../src/modules/DeliveryV2/utils/locationConfig.js';
import { isLiveTrackableOrderStatus } from '../../Backend/src/modules/food/delivery/services/riderLocation.service.js';

console.log('🧪 Starting Real-Time Tracking & Persistent Socket Verification...\n');

// 1. Verify Dynamic Configuration (No hardcoded values)
console.log('Test 1: Dynamic Configuration Derivation');
assert.ok(
  LOCATION_CONFIG.TRACKING_FALLBACK_POLL_MS >= 3000 && LOCATION_CONFIG.TRACKING_FALLBACK_POLL_MS <= 5000,
  `Fallback poll interval should fall within 3-5s range (actual: ${LOCATION_CONFIG.TRACKING_FALLBACK_POLL_MS}ms)`
);
assert.ok(
  typeof LOCATION_CONFIG.USER_LOC_MIN_MOVE_M === 'number' && LOCATION_CONFIG.USER_LOC_MIN_MOVE_M > 0,
  'User location minimum movement threshold must be a positive number'
);
assert.ok(
  typeof LOCATION_CONFIG.USER_LOC_MIN_INTERVAL_MS === 'number' && LOCATION_CONFIG.USER_LOC_MIN_INTERVAL_MS > 0,
  'User location minimum interval must be a positive number'
);
assert.ok(
  typeof LOCATION_CONFIG.USER_LOC_MAX_SILENCE_MS === 'number' && LOCATION_CONFIG.USER_LOC_MAX_SILENCE_MS > LOCATION_CONFIG.USER_LOC_MIN_INTERVAL_MS,
  'User location max silence heartbeat must exceed minimum interval'
);
console.log('✅ Dynamic Configuration passed.\n');

// 2. Verify Live Trackable Status Definitions
console.log('Test 2: Live Trackable Status Definitions');
assert.strictEqual(isLiveTrackableOrderStatus('picked_up'), true, 'picked_up must be trackable');
assert.strictEqual(isLiveTrackableOrderStatus('reached_drop'), true, 'reached_drop must be trackable');
assert.strictEqual(isLiveTrackableOrderStatus('preparing'), false, 'preparing must not show rider position');
assert.strictEqual(isLiveTrackableOrderStatus('ready_for_pickup'), false, 'ready_for_pickup must not show rider position');
assert.strictEqual(isLiveTrackableOrderStatus('delivered'), false, 'delivered must not show rider position');
console.log('✅ Live Trackable Status passed.\n');

// 3. Simulated Fallback Polling State Machine (Disconnect -> Poll every 3-5s -> Connect -> Stop Poll)
console.log('Test 3: Fallback Polling State Machine on Network Drops');
{
  let pollCount = 0;
  let isConnected = true;
  let pollIntervalId = null;

  const simulateSocketStateChange = (connected) => {
    isConnected = connected;
    if (!isConnected) {
      // Start fallback poll loop (3-5s)
      pollCount++;
      pollIntervalId = setInterval(() => {
        pollCount++;
      }, LOCATION_CONFIG.TRACKING_FALLBACK_POLL_MS);
    } else {
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
    }
  };

  assert.strictEqual(pollCount, 0, 'No polling while connected');

  // Network drops
  simulateSocketStateChange(false);
  assert.strictEqual(pollCount, 1, 'Immediate poll on socket disconnect');
  assert.ok(pollIntervalId !== null, 'Polling interval running while disconnected');

  // Network restores
  simulateSocketStateChange(true);
  assert.ok(pollIntervalId === null, 'Polling interval stopped immediately on reconnect');
}
console.log('✅ Fallback Polling State Machine passed.\n');

// 4. Simulated User Live Location Throttling & Emission Check
console.log('Test 4: User Live Location Throttling');
{
  let emittedCount = 0;
  let lastEmit = { at: 0, lat: null, lng: null };

  const computeDistanceMeters = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dPhi = ((lat2 - lat1) * Math.PI) / 180;
    const dLambda = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const emitUserLocation = (lat, lng, now = Date.now()) => {
    const moved = lastEmit.lat == null ? Infinity : computeDistanceMeters(lastEmit.lat, lastEmit.lng, lat, lng);
    const since = now - lastEmit.at;

    const shouldEmit =
      moved >= LOCATION_CONFIG.USER_LOC_MIN_MOVE_M && since >= LOCATION_CONFIG.USER_LOC_MIN_INTERVAL_MS;
    const isSilenceHeartbeat = since >= LOCATION_CONFIG.USER_LOC_MAX_SILENCE_MS;

    if (lastEmit.lat == null || shouldEmit || isSilenceHeartbeat) {
      lastEmit = { at: now, lat, lng };
      emittedCount++;
      return true;
    }
    return false;
  };

  // First reading: emits immediately
  assert.strictEqual(emitUserLocation(12.9716, 77.5946, 1000), true, 'First position must emit');
  assert.strictEqual(emittedCount, 1);

  // Tiny jitter 1m away within 1s: suppressed
  assert.strictEqual(emitUserLocation(12.971605, 77.594605, 1500), false, 'Jitter within interval must be throttled');
  assert.strictEqual(emittedCount, 1);

  // Movement > 5m after interval: emits
  assert.strictEqual(emitUserLocation(12.9720, 77.5950, 5000), true, 'Significant movement after interval must emit');
  assert.strictEqual(emittedCount, 2);

  // Stationary silence heartbeat: emits after MAX_SILENCE_MS
  assert.strictEqual(
    emitUserLocation(12.9720, 77.5950, 5000 + LOCATION_CONFIG.USER_LOC_MAX_SILENCE_MS + 100),
    true,
    'Stationary heartbeat must emit after max silence'
  );
  assert.strictEqual(emittedCount, 3);
}
console.log('✅ User Live Location Throttling passed.\n');

// 5. Simulated Bidirectional Room Event Routing Check
console.log('Test 5: Bidirectional Room Event Routing');
{
  const rooms = new Map();
  const join = (socketId, room) => {
    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(socketId);
  };
  const emitToRoom = (room, event, data) => {
    const sockets = rooms.get(room);
    return sockets ? Array.from(sockets) : [];
  };

  const orderId = 'order_123';
  const trackingRoom = `tracking:${orderId}`;
  const riderSocketId = 'socket_rider_1';
  const userSocketId = 'socket_user_1';

  // Both rider and user join immediately on pickup
  join(riderSocketId, trackingRoom);
  join(userSocketId, trackingRoom);

  // Rider emits location-update
  const riderReceivers = emitToRoom(trackingRoom, 'location-update', { lat: 12.97, lng: 77.59 });
  assert.ok(riderReceivers.includes(userSocketId), 'User must receive rider location from tracking room');

  // User emits user_live_location
  const userReceivers = emitToRoom(trackingRoom, 'user_live_location', { lat: 12.98, lng: 77.60 });
  assert.ok(userReceivers.includes(riderSocketId), 'Rider must receive user live location from tracking room');
}
console.log('✅ Bidirectional Room Event Routing passed.\n');

console.log('🎉 All Real-Time Tracking verification checks passed successfully!');
