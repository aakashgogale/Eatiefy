import mongoose from 'mongoose';

const deliveryCommissionRuleSchema = new mongoose.Schema(
    {
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            index: true
        },
        name: { type: String, trim: true, default: '' },
        minDistance: { type: Number, required: true, min: 0 },
        maxDistance: { type: Number, default: null },
        commissionPerKm: { type: Number, required: true, min: 0 },
        basePayout: { type: Number, required: true, min: 0 },
        status: { type: Boolean, default: true, index: true }
    },
    { collection: 'food_delivery_commission_rules', timestamps: true }
);

deliveryCommissionRuleSchema.index({ zoneId: 1, status: 1 }, { sparse: true });
deliveryCommissionRuleSchema.index({ zoneId: 1, minDistance: 1 }, { sparse: true });
deliveryCommissionRuleSchema.index({ createdAt: -1 });

export const FoodDeliveryCommissionRule = mongoose.model('FoodDeliveryCommissionRule', deliveryCommissionRuleSchema);
