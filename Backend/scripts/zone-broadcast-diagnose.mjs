/**
 * READ-ONLY diagnostic for zone-based broadcast targeting.
 *
 * Run ON THE SERVER (where the real DB is):
 *   cd /path/to/Eatiefy/Backend
 *   node scripts/zone-broadcast-diagnose.mjs
 *
 * It changes NOTHING. It prints, for each active zone, how many users /
 * restaurants / delivery partners the broadcast would target, and flags the
 * common data problems (missing polygon, users without address coordinates,
 * orders without zoneId).
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
console.log('Connecting to:', uri.replace(/\/\/[^@]+@/, '//***@'));
await mongoose.connect(uri);

const { FoodZone } = await import('../src/modules/food/admin/models/zone.model.js');
const { FoodUser } = await import('../src/core/users/user.model.js');
const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
const { zoneToGeoPolygon } = await import('../src/modules/food/shared/zoneLocation.js');

const line = '-'.repeat(70);

// 1. Overall data health
const totalUsers = await FoodUser.countDocuments({ isActive: true });
const usersWithAddr = await FoodUser.countDocuments({ isActive: true, 'addresses.0': { $exists: true } });
const usersWithLoc = await FoodUser.countDocuments({ isActive: true, 'addresses.location': { $exists: true, $ne: null } });
const ordersTotal = await FoodOrder.estimatedDocumentCount();
const ordersWithZone = await FoodOrder.countDocuments({ zoneId: { $exists: true, $ne: null } });

console.log('\n' + line);
console.log('DATA HEALTH');
console.log(line);
console.log(`active users: ${totalUsers}`);
console.log(`  with >=1 address: ${usersWithAddr}`);
console.log(`  with address location(geo): ${usersWithLoc}   <-- geo targeting needs this`);
console.log(`orders total(≈): ${ordersTotal}`);
console.log(`  orders with zoneId set: ${ordersWithZone}   <-- order targeting needs this`);

// 2. Geo index check
const idx = await FoodUser.collection.indexes();
const hasGeoIdx = idx.some((i) => i.name === 'addresses.location_2dsphere' || JSON.stringify(i.key).includes('2dsphere'));
console.log(`users 2dsphere index present: ${hasGeoIdx}   <-- required for $geoWithin`);

// 3. Per-zone breakdown
const zones = await FoodZone.find({ isActive: true }).select('name zoneName serviceLocation coordinates').lean();
console.log('\n' + line);
console.log(`ACTIVE ZONES: ${zones.length}`);
console.log(line);

for (const zone of zones) {
  const name = zone.name || zone.zoneName || zone.serviceLocation || '(unnamed)';
  const polygon = zoneToGeoPolygon(zone);
  const coordCount = Array.isArray(zone.coordinates) ? zone.coordinates.length : 0;

  let geoUsers = 0;
  if (polygon) {
    const rows = await FoodUser.find({ isActive: true, 'addresses.location': { $geoWithin: { $geometry: polygon } } }).select('_id').lean();
    geoUsers = rows.length;
  }
  const orderUserIds = await FoodOrder.find({ zoneId: zone._id }).distinct('userId');
  const unionUsers = new Set([...(polygon ? [] : []), ...orderUserIds.map(String)]);
  // recompute union properly
  const geoRows = polygon ? await FoodUser.find({ isActive: true, 'addresses.location': { $geoWithin: { $geometry: polygon } } }).select('_id').lean() : [];
  const union = new Set(geoRows.map((r) => String(r._id)));
  orderUserIds.forEach((id) => { if (id) union.add(String(id)); });

  const delCount = await FoodDeliveryPartner.countDocuments({ status: 'approved', zoneId: zone._id });
  const restClauses = [{ zoneId: zone._id }];
  if (polygon) restClauses.push({ location: { $geoWithin: { $geometry: polygon } } });
  const restCount = await FoodRestaurant.countDocuments({ status: 'approved', $or: restClauses });

  console.log(`\nZONE "${name}"  id=${zone._id}`);
  console.log(`  polygon: ${polygon ? 'OK' : '*** INVALID / MISSING ***'}  (coordinates stored: ${coordCount})`);
  console.log(`  USERS targeted: ${union.size}   (geo=${geoUsers}, order=${orderUserIds.length})`);
  console.log(`  RESTAURANTS targeted: ${restCount}`);
  console.log(`  DELIVERY targeted: ${delCount}`);
  if (union.size >= totalUsers && totalUsers > 0) {
    console.log('  !!! This zone matches ALL users — filter would look like it is not scoping.');
  }
  if (!polygon) {
    console.log('  !!! Polygon invalid: geo user match + legacy restaurant match are DISABLED for this zone.');
  }
}

console.log('\n' + line);
console.log('If USERS targeted == total users for a zone, the data (not the code) is the issue:');
console.log(' - users have no address geo AND no zoned orders -> only order/geo-scoped ones count;');
console.log(' - a zone with INVALID polygon cannot geo-match users at all.');
console.log(line);

await mongoose.disconnect();
console.log('\ndone (nothing was modified)');
