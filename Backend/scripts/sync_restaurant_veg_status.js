import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

// Simple schemas to avoid loading whole modules
const restaurantSchema = new mongoose.Schema({}, { strict: false, collection: 'food_restaurants' });
const Restaurant = mongoose.model('SyncFoodRestaurant', restaurantSchema);

const foodSchema = new mongoose.Schema({}, { strict: false, collection: 'food_items' });
const FoodItem = mongoose.model('SyncFoodItem', foodSchema);

const syncVegStatus = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB.');

        const restaurants = await Restaurant.find({ status: 'approved' }).select('_id restaurantName pureVegRestaurant');
        console.log(`Found ${restaurants.length} approved restaurants.`);

        let updatedCount = 0;

        for (const restaurant of restaurants) {
            const foods = await FoodItem.find({ restaurantId: restaurant._id, approvalStatus: 'approved' }).select('foodType');
            
            if (foods.length === 0) continue;

            let hasVeg = false;
            let hasNonVeg = false;

            for (const food of foods) {
                const type = String(food.foodType || '').toLowerCase();
                if (type === 'veg') hasVeg = true;
                if (type === 'non-veg' || type === 'nonveg' || type === 'non veg') hasNonVeg = true;
            }

            const isPureVeg = hasVeg && !hasNonVeg;

            if (restaurant.pureVegRestaurant !== isPureVeg) {
                await Restaurant.updateOne({ _id: restaurant._id }, { $set: { pureVegRestaurant: isPureVeg } });
                console.log(`Updated ${restaurant.restaurantName}: pureVegRestaurant = ${isPureVeg}`);
                updatedCount++;
            }
        }

        console.log(`Finished syncing. Updated ${updatedCount} restaurants.`);
        process.exit(0);
    } catch (error) {
        console.error('Error syncing veg status:', error);
        process.exit(1);
    }
};

syncVegStatus();
