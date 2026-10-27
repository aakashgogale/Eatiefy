import mongoose from 'mongoose';

const restaurantMenuSchema = new mongoose.Schema(
    {
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodRestaurant',
            required: true,
            unique: true,
            index: true
        },
        // Stored as-is for UI; validated at service layer.
        sections: {
            type: [mongoose.Schema.Types.Mixed],
            default: []
        },
        /**
         * Restaurant's own category sequence: menu section ids (category ids, or the
         * lowercased section name when a section has no category). Sections listed
         * here come first in this order on the dashboard and the customer menu.
         */
        categoryOrder: {
            type: [String],
            default: []
        }
    },
    {
        collection: 'food_restaurant_menus',
        timestamps: true
    }
);

export const FoodRestaurantMenu = mongoose.model('FoodRestaurantMenu', restaurantMenuSchema);

