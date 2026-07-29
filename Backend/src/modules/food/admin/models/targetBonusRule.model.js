import mongoose from 'mongoose';

const targetBonusRuleSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        targetType: {
            type: String,
            required: true,
            enum: ['daily', 'weekly', 'monthly'],
            index: true,
        },
        minimumOrders: { type: Number, required: true, min: 1 },
        bonusAmount: { type: Number, required: true, min: 0 },
        status: {
            type: String,
            required: true,
            enum: ['active', 'inactive'],
            default: 'active',
            index: true,
        },
        createdByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },
    { collection: 'food_target_bonus_rules', timestamps: true }
);

// Index to quickly query active rules per type
targetBonusRuleSchema.index({ targetType: 1, status: 1 });

export const TargetBonusRule = mongoose.model('TargetBonusRule', targetBonusRuleSchema);
