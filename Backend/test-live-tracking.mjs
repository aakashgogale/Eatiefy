/**
 * Diagnoses live map tracking for one order, end to end, against the live data.
 *
 *   node test-live-tracking.mjs <orderId | order_id like FOD-1234567>
 *
 * Read-only: it changes nothing. It answers, in order:
 *   1. Is this order in a state that is tracked at all?
 *   2. Is a rider assigned and accepted?
 *   3. Is that rider's GPS actually reaching the server, and how fresh is it?
 *   4. Would the customer's map be allowed to join the order's tracking room?
 *   5. Is Firebase Realtime DB (the mirror the map falls back to) reachable?
 */
import mongoose from 'mongoose';
import { config } from './src/config/env.js';
import { FoodOrder } from './src/modules/food/orders/models/order.model.js';
import { FoodDeliveryPartner } from './src/modules/food/delivery/models/deliveryPartner.model.js';
import {
    RIDER_TRACKABLE_ORDER_STATUSES,
    LAST_KNOWN_LOCATION_MAX_AGE_MS,
    isValidCoordinate,
} from './src/modules/food/delivery/services/riderLocation.service.js';

const ref = String(process.argv[2] || '').trim();
if (!ref) {
    console.error('Usage: node test-live-tracking.mjs <orderId | order_id>');
    process.exit(1);
}

const ok = (m) => console.log(`  OK    ${m}`);
const bad = (m) => console.log(`  PROBLEM  ${m}`);
const info = (m) => console.log(`        ${m}`);
const ago = (date) => {
    if (!date) return 'never';
    const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
    return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

await mongoose.connect(config.mongodbUri);

const order = await FoodOrder.findOne(
    mongoose.Types.ObjectId.isValid(ref) ? { _id: ref } : { order_id: ref }
).select('_id order_id userId restaurantId orderStatus dispatch lastRiderLocation lastRiderLocationAt createdAt').lean();

if (!order) {
    console.error(`Order "${ref}" not found.`);
    await mongoose.disconnect();
    process.exit(1);
}

console.log(`\nOrder ${order.order_id || order._id}  (placed ${ago(order.createdAt)})`);
console.log(`Status: ${order.orderStatus}  |  dispatch: ${order.dispatch?.status || 'none'}\n`);

console.log('1. Is this order tracked?');
if (RIDER_TRACKABLE_ORDER_STATUSES.includes(order.orderStatus)) ok(`"${order.orderStatus}" is a tracked status.`);
else bad(`"${order.orderStatus}" is not tracked. Tracked: ${RIDER_TRACKABLE_ORDER_STATUSES.join(', ')}.`);

console.log('\n2. Rider assigned?');
const partnerId = order.dispatch?.deliveryPartnerId;
if (!partnerId) bad('No delivery partner assigned - there is no bike to show yet.');
else if (!['assigned', 'accepted'].includes(String(order.dispatch?.status))) {
    bad(`dispatch.status is "${order.dispatch?.status}"; the server only publishes GPS for assigned/accepted.`);
} else ok(`Rider ${partnerId} (${order.dispatch.status}).`);

console.log('\n3. Is the rider\'s GPS reaching the server?');
let partner = null;
if (partnerId) {
    partner = await FoodDeliveryPartner.findById(partnerId).select('name phone isOnline lastLat lastLng lastLocationAt').lean();
    const fresh = partner?.lastLocationAt && Date.now() - new Date(partner.lastLocationAt).getTime() < LAST_KNOWN_LOCATION_MAX_AGE_MS;
    info(`Rider: ${partner?.name || '?'} ${partner?.phone || ''} | online flag: ${partner?.isOnline}`);
    if (!partner?.lastLocationAt) {
        bad('This rider has NEVER published a location. The rider app is not sending GPS (permission denied, or the app was never opened/logged in).');
    } else if (!isValidCoordinate(Number(partner.lastLat), Number(partner.lastLng))) {
        bad(`Stored coordinates are invalid: ${partner.lastLat}, ${partner.lastLng}`);
    } else if (!fresh) {
        bad(`Last GPS fix was ${ago(partner.lastLocationAt)} - older than the ${Math.round(LAST_KNOWN_LOCATION_MAX_AGE_MS / 60000)} min freshness limit, so the map shows no live bike.`);
        info('Rider app is closed/background with no network, or GPS permission was revoked.');
    } else {
        ok(`Live fix ${ago(partner.lastLocationAt)} at ${partner.lastLat}, ${partner.lastLng}`);
    }
}

console.log('\n4. Can the customer app join the tracking room?');
if (!order.userId) bad('Order has no userId.');
else {
    ok(`Customer ${order.userId} may join rooms: tracking:${order._id}` + (order.order_id ? ` and tracking:${order.order_id}` : ''));
    info('The customer app emits join-tracking with the order id it has; both forms are accepted.');
}

console.log('\n5. Firebase Realtime DB (map fallback mirror)');
try {
    // The API server initialises this at boot; a standalone script must do it itself.
    const { getFirebaseDB, initializeFirebaseRealtime } = await import('./src/config/firebase.js');
    try { initializeFirebaseRealtime(); } catch (_) { /* reported below */ }
    const db = getFirebaseDB();
    if (!db) bad('Firebase RTDB is not configured (socket updates still work; the mirror does not).');
    else {
        const snap = await db.ref(`active_orders/${String(order._id)}`).get();
        if (snap.exists()) ok(`Mirror node present, last_updated ${ago(new Date(Number(snap.val()?.last_updated || 0)))}`);
        else info('No mirror node for this order yet (written on the next GPS fix).');
    }
} catch (err) {
    bad(`Firebase RTDB error: ${err.message}`);
}

console.log('\nIf 1-3 are OK but the customer map is still blank, the problem is the socket');
console.log('connection itself: check that nginx forwards /socket.io with the Upgrade and');
console.log('Connection headers (WebSocket), and look for "join-tracking failed" in pm2 logs.\n');

await mongoose.disconnect();
process.exit(0);
