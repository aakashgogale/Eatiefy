import mongoose from 'mongoose';

/**
 * Admin-curated "Top Restaurants" per zone.
 *
 * One document per (zoneId, type) pair. `restaurants` is an ordered list where
 * index 0 = rank #1 (#Top1), index 1 = #Top2, etc. Maximum 10 entries.
 *
 * `type` separates the Delivery list from the Takeaway list so a restaurant can
 * be promoted independently in each. Users never see the ranking labels — these
 * ids are simply surfaced first in the user-facing restaurant list (default sort).
 */
const topRestaurantSchema = new mongoose.Schema(
    {
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: ['delivery', 'takeaway'],
            required: true,
        },
        restaurants: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'FoodRestaurant',
            },
        ],
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },
    },
    { collection: 'food_top_restaurants', timestamps: true }
);

// Only one curated list per zone + type.
topRestaurantSchema.index({ zoneId: 1, type: 1 }, { unique: true });

export const FoodTopRestaurant = mongoose.model('FoodTopRestaurant', topRestaurantSchema);
