import mongoose from 'mongoose';
import { RESTAURANT_TYPE_VALUES } from '../../shared/restaurantTypes.js';

/**
 * Immutable-by-design record of a restaurant's one-time onboarding payment.
 *
 * `pricing` is a snapshot taken when the Razorpay order is created, so later admin
 * price/offer edits never rewrite history: the record always shows the exact
 * original -> offer -> final amounts that applied at payment time.
 */
const pricingSnapshotSchema = new mongoose.Schema(
    {
        originalPrice: { type: Number, required: true },
        offerPrice: { type: Number, default: null },
        finalAmount: { type: Number, required: true },
        currency: { type: String, default: 'INR' },
        /** Where the base price came from: 'zone_rule' | 'global_rule' | 'system_default' */
        priceSource: { type: String, default: 'system_default' },
        pricingRuleId: { type: mongoose.Schema.Types.ObjectId, default: null },
        offerId: { type: mongoose.Schema.Types.ObjectId, default: null },
        offerName: { type: String, default: '' },
        zoneName: { type: String, default: '' },
        restaurantTypeLabel: { type: String, default: '' }
    },
    { _id: false }
);

const onboardingPaymentSchema = new mongoose.Schema(
    {
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodRestaurant',
            required: true,
            index: true
        },
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            default: null,
            index: true
        },
        restaurantType: {
            type: String,
            enum: RESTAURANT_TYPE_VALUES,
            required: true
        },
        ownerPhone: { type: String, trim: true, default: '' },
        pricing: { type: pricingSnapshotSchema, required: true },
        /** Amount actually charged, in paise — what the gateway order was created for. */
        amountPaise: { type: Number, required: true },
        status: {
            type: String,
            enum: ['created', 'paid', 'failed', 'cancelled'],
            default: 'created',
            index: true
        },
        gateway: {
            provider: { type: String, default: 'razorpay' },
            razorpayOrderId: { type: String, default: '', trim: true },
            razorpayPaymentId: { type: String, default: '', trim: true },
            signatureVerified: { type: Boolean, default: false },
            /** 'checkout_verify' | 'webhook' — which path confirmed the payment first. */
            confirmedVia: { type: String, default: '' }
        },
        /** True while this record holds a reserved offer slot that has not been released. */
        offerSlotHeld: { type: Boolean, default: false },
        offerSlotRedeemed: { type: Boolean, default: false },
        /** Reservations older than this may be swept and their offer slot released. */
        reservationExpiresAt: { type: Date, default: null, index: true },
        paidAt: { type: Date, default: null },
        failureReason: { type: String, default: '' }
    },
    {
        collection: 'food_onboarding_payments',
        timestamps: true
    }
);

// Gateway ids are the idempotency keys for verify + webhook processing.
onboardingPaymentSchema.index(
    { 'gateway.razorpayOrderId': 1 },
    { unique: true, partialFilterExpression: { 'gateway.razorpayOrderId': { $type: 'string', $gt: '' } } }
);
onboardingPaymentSchema.index(
    { 'gateway.razorpayPaymentId': 1 },
    { unique: true, partialFilterExpression: { 'gateway.razorpayPaymentId': { $type: 'string', $gt: '' } } }
);
// A restaurant can retry as often as it likes but may only ever be paid once, so a
// duplicate webhook or a replayed verify can never create a second paid record.
onboardingPaymentSchema.index(
    { restaurantId: 1 },
    { unique: true, name: 'uniq_paid_per_restaurant', partialFilterExpression: { status: 'paid' } }
);
onboardingPaymentSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });

export const FoodOnboardingPayment = mongoose.model(
    'FoodOnboardingPayment',
    onboardingPaymentSchema
);
