import mongoose from 'mongoose';

/**
 * Zone-level overrides for the admin "Restaurant Settings" page.
 *
 * One document per zone. A field left null means the zone inherits the
 * platform default stored in FoodSystemConfig, so a zone without a document
 * (or with both fields null) behaves exactly like the global setting.
 */
const zoneRestaurantSettingsSchema = new mongoose.Schema(
    {
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            required: true,
            unique: true,
        },
        deliveryAcceptOrderTimeMinutes: {
            type: Number,
            min: 1,
            max: 60,
            default: null,
        },
        takeawayAcceptOrderTimeMinutes: {
            type: Number,
            min: 1,
            max: 60,
            default: null,
        },
        updatedBy: {
            role: { type: String },
            adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
            at: { type: Date, default: Date.now },
        },
    },
    { collection: 'food_zone_restaurant_settings', timestamps: true }
);

export const FoodZoneRestaurantSettings = mongoose.model(
    'FoodZoneRestaurantSettings',
    zoneRestaurantSettingsSchema
);
