import mongoose from 'mongoose';

/**
 * Document photos a delivery partner has already uploaded during signup, keyed by
 * the OTP-verified phone. The partner record only exists after the final submit,
 * so without this the photos lived in browser storage alone and could vanish on
 * refresh. Removed after a successful registration; expires if signup is abandoned.
 */
const DRAFT_TTL_DAYS = 30;

const deliveryOnboardingDraftSchema = new mongoose.Schema(
    {
        phoneLast10: { type: String, required: true, unique: true, index: true },
        uploads: {
            profilePhoto: { type: String, default: '' },
            aadharPhoto: { type: String, default: '' },
            panPhoto: { type: String, default: '' },
            drivingLicensePhoto: { type: String, default: '' }
        },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000)
        }
    },
    { timestamps: true }
);

deliveryOnboardingDraftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DELIVERY_ONBOARDING_DRAFT_TTL_DAYS = DRAFT_TTL_DAYS;

export const FoodDeliveryOnboardingDraft = mongoose.model(
    'FoodDeliveryOnboardingDraft',
    deliveryOnboardingDraftSchema
);
