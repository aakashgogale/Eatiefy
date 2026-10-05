import mongoose from 'mongoose';

/**
 * Zone-level overrides for the admin Deliveryman Management settings: cash
 * limit, minimum withdrawal, multi-order capacity and emergency numbers.
 *
 * One document per zone. A field left null means riders of that zone follow
 * the platform default (FoodDeliveryCashLimit / FoodDeliveryEmergencyHelp), so
 * a zone without a document behaves exactly like the global setting.
 */
const zoneDeliverySettingsSchema = new mongoose.Schema(
    {
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            required: true,
            unique: true,
        },
        deliveryCashLimit: { type: Number, min: 0, default: null },
        deliveryWithdrawalLimit: { type: Number, min: 0, default: null },
        maxConcurrentOrders: { type: Number, min: 1, max: 5, default: null },
        medicalEmergency: { type: String, trim: true, default: null },
        accidentHelpline: { type: String, trim: true, default: null },
        contactPolice: { type: String, trim: true, default: null },
        insurance: { type: String, trim: true, default: null },
        updatedBy: {
            role: { type: String },
            adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
            at: { type: Date, default: Date.now },
        },
    },
    { collection: 'food_zone_delivery_settings', timestamps: true }
);

export const FoodZoneDeliverySettings = mongoose.model(
    'FoodZoneDeliverySettings',
    zoneDeliverySettingsSchema
);
