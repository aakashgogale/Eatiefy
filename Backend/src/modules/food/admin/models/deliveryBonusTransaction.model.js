import mongoose from 'mongoose';

const deliveryBonusTransactionSchema = new mongoose.Schema(
    {
        deliveryPartnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodDeliveryPartner',
            required: true,
            index: true
        },
        transactionId: { type: String, required: true, trim: true, unique: true, index: true },
        amount: { type: Number, required: true, min: 0 },
        reference: { type: String, trim: true, default: '' },
        createdByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        // 'manual' = admin gave bonus manually; 'target' = from target bonus rule
        bonusType: { type: String, enum: ['manual', 'target'], default: 'manual' },
        // Reference to DeliveryTargetEligibility record when bonusType = 'target'
        eligibilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryTargetEligibility', default: null }
    },
    { collection: 'food_delivery_bonus_transactions', timestamps: true }
);

deliveryBonusTransactionSchema.index({ deliveryPartnerId: 1, createdAt: -1 });

export const DeliveryBonusTransaction = mongoose.model('DeliveryBonusTransaction', deliveryBonusTransactionSchema);

