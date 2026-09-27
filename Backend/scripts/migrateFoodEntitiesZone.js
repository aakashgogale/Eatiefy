import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/eatiefy';

async function runMigration() {
    console.log('--- STARTING FOOD ENTITIES ZONE MIGRATION & BACKFILL ---');
    console.log(`Connecting to MongoDB at: ${MONGODB_URI}`);

    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB successfully.');

    const db = mongoose.connection.db;

    // 1. Ensure a default active FoodZone exists
    const zonesColl = db.collection('food_zones');
    let defaultZone = await zonesColl.findOne({ isActive: true });

    if (!defaultZone) {
        defaultZone = await zonesColl.findOne({});
    }

    if (!defaultZone) {
        console.log('No existing zones found in food_zones. Creating a default operational zone...');
        const newZone = {
            name: 'Default City Zone',
            zoneName: 'Default City Zone',
            country: 'India',
            serviceLocation: 'City Center',
            unit: 'kilometer',
            coordinates: [
                { latitude: 28.6139, longitude: 77.2090 },
                { latitude: 28.7041, longitude: 77.1025 },
                { latitude: 28.5355, longitude: 77.3910 }
            ],
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        const insertRes = await zonesColl.insertOne(newZone);
        defaultZone = { _id: insertRes.insertedId, ...newZone };
        console.log(`Created default zone with ID: ${defaultZone._id}`);
    } else {
        console.log(`Using existing zone as baseline: "${defaultZone.name || defaultZone.zoneName}" (${defaultZone._id})`);
    }

    const defaultZoneId = defaultZone._id;

    // 2. Restaurants backfill
    const restaurantsColl = db.collection('food_restaurants');
    const restaurantsWithoutZone = await restaurantsColl.countDocuments({
        $or: [{ zoneId: null }, { zoneId: { $exists: false } }]
    });
    if (restaurantsWithoutZone > 0) {
        const restRes = await restaurantsColl.updateMany(
            { $or: [{ zoneId: null }, { zoneId: { $exists: false } }] },
            { $set: { zoneId: defaultZoneId, updatedAt: new Date() } }
        );
        console.log(`Backfilled ${restRes.modifiedCount} restaurant(s) with zoneId.`);
    } else {
        console.log('All restaurants already have a zoneId assigned.');
    }

    // Map all restaurants to their zoneId for accurate inheritance
    const allRestaurants = await restaurantsColl.find({}, { projection: { _id: 1, zoneId: 1 } }).toArray();
    const restZoneMap = new Map(
        allRestaurants.map((r) => [String(r._id), r.zoneId || defaultZoneId])
    );

    // 3. Food Items backfill
    const foodsColl = db.collection('food_items');
    const unzonedFoods = await foodsColl.find(
        { $or: [{ zoneId: null }, { zoneId: { $exists: false } }] },
        { projection: { _id: 1, restaurantId: 1 } }
    ).toArray();

    if (unzonedFoods.length > 0) {
        const bulkOps = unzonedFoods.map((food) => {
            const inheritedZone = food.restaurantId ? restZoneMap.get(String(food.restaurantId)) : null;
            return {
                updateOne: {
                    filter: { _id: food._id },
                    update: {
                        $set: {
                            zoneId: inheritedZone || defaultZoneId,
                            updatedAt: new Date()
                        }
                    }
                }
            };
        });

        if (bulkOps.length > 0) {
            const bulkRes = await foodsColl.bulkWrite(bulkOps, { ordered: false });
            console.log(`Backfilled ${bulkRes.modifiedCount} food item(s) with zoneId.`);
        }
    } else {
        console.log('All food items already have a zoneId assigned.');
    }

    // 4. Food Addons backfill
    const addonsColl = db.collection('food_addons');
    const unzonedAddons = await addonsColl.find(
        { $or: [{ zoneId: null }, { zoneId: { $exists: false } }] },
        { projection: { _id: 1, restaurantId: 1 } }
    ).toArray();

    if (unzonedAddons.length > 0) {
        const bulkOps = unzonedAddons.map((addon) => {
            const inheritedZone = addon.restaurantId ? restZoneMap.get(String(addon.restaurantId)) : null;
            return {
                updateOne: {
                    filter: { _id: addon._id },
                    update: {
                        $set: {
                            zoneId: inheritedZone || defaultZoneId,
                            updatedAt: new Date()
                        }
                    }
                }
            };
        });

        if (bulkOps.length > 0) {
            const bulkRes = await addonsColl.bulkWrite(bulkOps, { ordered: false });
            console.log(`Backfilled ${bulkRes.modifiedCount} add-on(s) with zoneId.`);
        }
    } else {
        console.log('All add-ons already have a zoneId assigned.');
    }

    // 5. Food Categories backfill
    const categoriesColl = db.collection('food_categories');
    const unzonedCategories = await categoriesColl.countDocuments({
        $or: [{ zoneId: null }, { zoneId: { $exists: false } }, { zoneId: 'global' }]
    });

    if (unzonedCategories > 0) {
        const catRes = await categoriesColl.updateMany(
            { $or: [{ zoneId: null }, { zoneId: { $exists: false } }, { zoneId: 'global' }] },
            { $set: { zoneId: defaultZoneId, updatedAt: new Date() } }
        );
        console.log(`Backfilled ${catRes.modifiedCount} category/categories with zoneId.`);
    } else {
        console.log('All categories already have a zoneId assigned.');
    }

    // 6. Food Pricing Rules backfill
    const pricingColl = db.collection('food_pricing_rules');
    const unzonedPricingRules = await pricingColl.countDocuments({
        $or: [{ zoneId: null }, { zoneId: { $exists: false } }]
    });

    if (unzonedPricingRules > 0) {
        const priceRes = await pricingColl.updateMany(
            { $or: [{ zoneId: null }, { zoneId: { $exists: false } }] },
            { $set: { zoneId: defaultZoneId, updatedAt: new Date() } }
        );
        console.log(`Backfilled ${priceRes.modifiedCount} pricing rule(s) with zoneId.`);
    } else {
        console.log('All pricing rules already have a zoneId assigned.');
    }

    console.log('--- ZONE MIGRATION & BACKFILL COMPLETED SUCCESSFULLY ---');
    await mongoose.disconnect();
}

runMigration().catch((error) => {
    console.error('Migration failed with error:', error);
    process.exit(1);
});
