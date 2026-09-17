import mongoose from 'mongoose';

export const DELIVERY_INCENTIVE_ORDER_VALUE_BASES = ['subtotal', 'total'];

/**
 * Zone-wise Eatiefy incentive for delivery partners, paid ON TOP of the zone's
 * Delivery Boy Payout (FoodDeliveryCommissionRule). Admin-controlled only: a zone
 * without an enabled document gets no incentive.
 */
const deliveryIncentiveSettingsSchema = new mongoose.Schema(
    {
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            required: true
        },
        isEnabled: { type: Boolean, default: false },
        /** Percentage of the order value (0-100). */
        incentivePercent: { type: Number, default: 0, min: 0, max: 100 },
        /** Which order amount the percentage is applied to. */
        orderValueBasis: {
            type: String,
            enum: DELIVERY_INCENTIVE_ORDER_VALUE_BASES,
            default: 'subtotal'
        }
    },
    { collection: 'food_delivery_incentive_settings', timestamps: true }
);

deliveryIncentiveSettingsSchema.index({ zoneId: 1 }, { unique: true });

export const FoodDeliveryIncentiveSettings = mongoose.model(
    'FoodDeliveryIncentiveSettings',
    deliveryIncentiveSettingsSchema
);
