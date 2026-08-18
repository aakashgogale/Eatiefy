import mongoose from 'mongoose';

/**
 * Tracks whether a delivery partner has achieved the bonus target for a given rule & date.
 * One record per (deliveryPartnerId + ruleId + date).
 * Status flow: eligible → bonus_given (never auto-credited)
 */
const deliveryTargetEligibilitySchema = new mongoose.Schema(
    {
        deliveryPartnerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodDeliveryPartner',
            required: true,
            index: true,
        },
        ruleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'TargetBonusRule',
            required: true,
        },
        // ISO date string YYYY-MM-DD for daily; week-start date for weekly; month-start for monthly
        date: { type: String, required: true, index: true },
        ordersCompleted: { type: Number, required: true, default: 0 },
        targetOrders: { type: Number, required: true },
        bonusAmount: { type: Number, required: true },
        // eligible = target reached, pending admin approval
        // bonus_given = admin approved and bonus credited
        status: {
            type: String,
            enum: ['eligible', 'bonus_given'],
            default: 'eligible',
            index: true,
        },
        // Filled in after admin approves and credits bonus
        bonusTransactionId: { type: String, default: null },
        approvedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        approvedAt: { type: Date, default: null },
    },
    { collection: 'food_delivery_target_eligibility', timestamps: true }
);

// Unique constraint: one eligibility record per partner per rule per date
deliveryTargetEligibilitySchema.index(
    { deliveryPartnerId: 1, ruleId: 1, date: 1 },
    { unique: true }
);

deliveryTargetEligibilitySchema.index({ date: -1, status: 1 });

export const DeliveryTargetEligibility = mongoose.model(
    'DeliveryTargetEligibility',
    deliveryTargetEligibilitySchema
);
