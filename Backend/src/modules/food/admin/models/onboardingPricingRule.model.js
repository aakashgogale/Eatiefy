import mongoose from 'mongoose';
import { RESTAURANT_TYPE_VALUES } from '../../shared/restaurantTypes.js';

/**
 * Admin-managed one-time onboarding fee per (zone, restaurant type).
 *
 * `zoneId: null` is the global default rule for a restaurant type, used when the
 * restaurant's zone has no rule of its own. Resolution order is:
 *   zone rule -> global rule -> DEFAULT_ONBOARDING_BASE_PRICE constant.
 */
const onboardingPricingRuleSchema = new mongoose.Schema(
    {
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            default: null,
            index: true
        },
        restaurantType: {
            type: String,
            enum: RESTAURANT_TYPE_VALUES,
            required: true,
            index: true
        },
        basePrice: {
            type: Number,
            required: true,
            min: [0, 'Base price cannot be negative']
        },
        currency: {
            type: String,
            default: 'INR',
            uppercase: true,
            trim: true
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true
        },
        notes: {
            type: String,
            trim: true,
            default: ''
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            default: null
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            default: null
        }
    },
    {
        collection: 'food_onboarding_pricing_rules',
        timestamps: true
    }
);

// At most one ACTIVE rule per (zone, type) — disabled rules may pile up freely so
// admins can keep history. The partial filter is what allows that coexistence.
onboardingPricingRuleSchema.index(
    { zoneId: 1, restaurantType: 1 },
    {
        unique: true,
        name: 'uniq_active_zone_type',
        partialFilterExpression: { isActive: true }
    }
);

export const FoodOnboardingPricingRule = mongoose.model(
    'FoodOnboardingPricingRule',
    onboardingPricingRuleSchema
);
