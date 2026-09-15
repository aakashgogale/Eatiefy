import mongoose from 'mongoose';

/**
 * Server-side record of the files a partner has already uploaded while filling
 * the restaurant onboarding form, keyed by the OTP-verified phone.
 *
 * The restaurant document only exists after the final submit, so without this
 * the uploaded menu/profile/document images lived only in the browser and were
 * lost on refresh. The draft is removed once registration succeeds and expires
 * on its own if the partner abandons onboarding.
 */
const DRAFT_TTL_DAYS = 30;

const onboardingDraftSchema = new mongoose.Schema(
    {
        phoneLast10: { type: String, required: true, unique: true, index: true },
        uploads: {
            profileImage: { type: String, default: '' },
            menuImages: { type: [String], default: [] },
            panImage: { type: String, default: '' },
            gstImage: { type: String, default: '' },
            fssaiImage: { type: String, default: '' }
        },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000)
        }
    },
    { timestamps: true }
);

onboardingDraftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ONBOARDING_DRAFT_TTL_DAYS = DRAFT_TTL_DAYS;

export const FoodRestaurantOnboardingDraft = mongoose.model(
    'FoodRestaurantOnboardingDraft',
    onboardingDraftSchema
);
