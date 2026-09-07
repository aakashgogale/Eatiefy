import dotenv from 'dotenv'; import mongoose from 'mongoose'; import fs from 'fs';
dotenv.config();
await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
const db = mongoose.connection.db;
const now = new Date();
const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
const filter = { createdAt: { $gte: start, $lte: end }, orderStatus: { $ne: 'delivered' } };

const targets = await db.collection('food_orders').find(filter).toArray();
console.log(`Incomplete today: ${targets.length}`);
targets.forEach(o => console.log(`  ${o.orderId}  ${o.orderStatus}  rider=${o.dispatch?.deliveryPartnerId || '-'}  dispatch=${o.dispatch?.status || '-'}  pay=${o.payment?.method}/${o.payment?.status}`));
const keep = await db.collection('food_orders').find({ createdAt: { $gte: start, $lte: end }, orderStatus: 'delivered' }).toArray();
console.log(`Delivered today (keeping): ${keep.length} -> ${keep.map(o=>o.orderId).join(', ') || 'none'}`);

if (!targets.length) { console.log('Nothing to remove.'); await mongoose.disconnect(); process.exit(0); }

const ids = targets.map(o => o._id);
const txns = await db.collection('food_transactions').find({ orderId: { $in: ids } }).toArray();

const stamp = now.toISOString().replace(/[:.]/g,'-');
fs.writeFileSync(`backups/incomplete-orders-${stamp}.json`, JSON.stringify(
  { takenAt: now.toISOString(), food_orders: targets, food_transactions: txns }, null, 2));
console.log(`Backup: backups/incomplete-orders-${stamp}.json`);

const t = await db.collection('food_transactions').deleteMany({ orderId: { $in: ids } });
const o = await db.collection('food_orders').deleteMany({ _id: { $in: ids } });
console.log(`Deleted transactions: ${t.deletedCount}  orders: ${o.deletedCount}`);
await mongoose.disconnect();
