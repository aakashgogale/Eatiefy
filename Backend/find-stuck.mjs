import dotenv from 'dotenv'; import mongoose from 'mongoose';
dotenv.config();
await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
const db = mongoose.connection.db;
const stuck = await db.collection('food_orders').find({ orderStatus: { $ne: 'delivered' } }).sort({ createdAt: -1 }).toArray();
console.log(`All incomplete orders in DB: ${stuck.length}\n`);
for (const o of stuck) {
  let rider = '-';
  if (o.dispatch?.deliveryPartnerId) {
    const p = await db.collection('food_delivery_partners').findOne({ _id: o.dispatch.deliveryPartnerId }, { projection:{name:1,phone:1} });
    rider = `${p?.name||'?'}/${p?.phone||''}`;
  }
  console.log(`  ${o.orderId}  status=${o.orderStatus}  dispatch=${o.dispatch?.status||'-'}  rider=${rider}  created=${new Date(o.createdAt).toLocaleString()}`);
}
await mongoose.disconnect();
