/**
 * Reports dishes that exist in the database but are NOT visible to customers,
 * and says why. Read-only: it changes nothing.
 *
 *   node check-menu-visibility.mjs                 # every approved restaurant
 *   node check-menu-visibility.mjs <restaurantId>  # one restaurant
 *
 * The customer menu only returns dishes whose approvalStatus is "approved" and
 * whose category is active, so a dish can quietly vanish when:
 *   - it is waiting for admin approval (a brand new dish, or an edit to a live
 *     one: any content change sends the dish back to "pending"),
 *   - it was rejected,
 *   - its category was switched off,
 *   - the restaurant itself is not approved / not accepting orders.
 * Run it after a release, or whenever someone reports a missing item.
 */
import mongoose from 'mongoose';
import { config } from './src/config/env.js';
import { FoodItem } from './src/modules/food/admin/models/food.model.js';
import { FoodRestaurant } from './src/modules/food/restaurant/models/restaurant.model.js';
import { FoodCategory } from './src/modules/food/admin/models/category.model.js';

const arg = String(process.argv[2] || '').trim();

await mongoose.connect(config.mongodbUri);

const restaurantFilter = arg && mongoose.Types.ObjectId.isValid(arg)
    ? { _id: new mongoose.Types.ObjectId(arg) }
    : { status: 'approved' };

const restaurants = await FoodRestaurant.find(restaurantFilter)
    .select('_id restaurantName status isActive isAcceptingOrders')
    .lean();

if (!restaurants.length) {
    console.log('No matching restaurants.');
    await mongoose.disconnect();
    process.exit(0);
}

const foods = await FoodItem.find({ restaurantId: { $in: restaurants.map((r) => r._id) } })
    .select('_id name restaurantId approvalStatus categoryId categoryName rejectionReason actionType updatedAt')
    .lean();

const categoryIds = [...new Set(foods.map((f) => String(f.categoryId || '')).filter(Boolean))];
const categories = await FoodCategory.find({ _id: { $in: categoryIds } })
    .select('_id name isActive')
    .lean();
const categoryById = new Map(categories.map((c) => [String(c._id), c]));

const reasonFor = (food, restaurant) => {
    if (restaurant.status !== 'approved') return `restaurant is ${restaurant.status}`;
    if (restaurant.isActive === false) return 'restaurant is switched off';
    if (restaurant.isAcceptingOrders === false) return 'restaurant is not accepting orders';
    if (food.approvalStatus === 'pending') {
        return food.actionType === 'UPDATED'
            ? 'EDIT waiting for admin approval (the live dish is hidden meanwhile)'
            : 'new dish waiting for admin approval';
    }
    if (food.approvalStatus === 'rejected') return `rejected: ${food.rejectionReason || 'no reason given'}`;
    const category = food.categoryId ? categoryById.get(String(food.categoryId)) : null;
    if (category && category.isActive === false) return `category "${category.name}" is switched off`;
    return null;
};

const byRestaurant = new Map(restaurants.map((r) => [String(r._id), r]));
const hidden = [];
for (const food of foods) {
    const restaurant = byRestaurant.get(String(food.restaurantId));
    if (!restaurant) continue;
    const reason = reasonFor(food, restaurant);
    if (reason) hidden.push({ food, restaurant, reason });
}

console.log(`\nRestaurants checked : ${restaurants.length}`);
console.log(`Dishes checked      : ${foods.length}`);
console.log(`Hidden from customers: ${hidden.length}\n`);

if (!hidden.length) {
    console.log('Every dish is visible to customers.');
} else {
    const grouped = new Map();
    for (const row of hidden) {
        const key = row.restaurant.restaurantName || String(row.restaurant._id);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row);
    }
    for (const [name, rows] of grouped) {
        console.log(`${name}  (${rows.length} hidden)`);
        for (const { food, reason } of rows.slice(0, 20)) {
            console.log(`   - ${String(food.name || food._id).padEnd(34)} ${reason}`);
        }
        if (rows.length > 20) console.log(`   ... and ${rows.length - 20} more`);
        console.log('');
    }
    console.log('Dishes marked "waiting for admin approval" appear once an admin approves them');
    console.log('in Admin > Food Management > approval requests.');
}

await mongoose.disconnect();
process.exit(0);
