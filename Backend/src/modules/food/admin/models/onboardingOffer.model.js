import mongoose from 'mongoose';
import { RESTAURANT_TYPE_VALUES } from '../../shared/restaurantTypes.js';

/**
 * Limited promotional onboarding offer, e.g. "first 10 Family Restaurants in Indore
 * pay ₹899 instead of ₹999".
 *
 * Slot accounting uses two counters so that in-flight checkouts hold a slot without
 * permanently burning it:
 *   consumedCount = reserved (checkout open) + redeemed (payment verified)
 *   redeemedCount = verified payments only  ("Used slots" in the admin UI)
 *
 * A slot is reserved atomically at order creation guarded by
 * `consumedCount < maxRedemptions`, promoted to redeemed on verified payment, and
 * released (consumedCount -1) on failure, cancellation or reservation expiry.
 * Because both the guard and the increment live in one findOneAndUpdate on a single
 * document, two racing checkouts can never claim the same final slot.
 */
const onboardingOfferSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            required: true,
            index: true
        },
        restaurantType: {
            type: String,
            enum: RESTAURANT_TYPE_VALUES,
            required: true,
            index: true
        },
        /** Price shown struck-through. Informational: the payable base always comes
         *  from the pricing rules, so an admin typo here cannot change what is charged. */
        originalPrice: {
            type: Number,
            required: true,
            min: [0, 'Original price cannot be negative']
        },
        offerPrice: {
            type: Number,
            required: true,
            min: [0, 'Offer price cannot be negative']
        },
        maxRedemptions: {
            type: Number,
            required: true,
            min: [1, 'An offer must allow at least one restaurant']
        },
        consumedCount: {
            type: Number,
            default: 0,
            min: 0
        },
        redeemedCount: {
            type: Number,
            default: 0,
            min: 0
        },
        startsAt: {
            type: Date,
            required: true
        },
        endsAt: {
            type: Date,
            required: true
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true
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
        collection: 'food_onboarding_offers',
        timestamps: true
    }
);

onboardingOfferSchema.index({ zoneId: 1, restaurantType: 1, isActive: 1, startsAt: 1, endsAt: 1 });

onboardingOfferSchema.virtual('remainingSlots').get(function remainingSlots() {
    return Math.max(0, (this.maxRedemptions || 0) - (this.consumedCount || 0));
});

export const FoodOnboardingOffer = mongoose.model('FoodOnboardingOffer', onboardingOfferSchema);
