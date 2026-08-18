import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema(
    {
        phone: {
            type: String,
            required: true
        },
        otp: {
            type: String,
            required: true
        },
        otpExpiresAt: {
            type: Date,
            required: true
        },
        expiresAt: {
            type: Date,
            required: true
        },
        attempts: {
            type: Number,
            default: 0
        },
        requestCount: {
            type: Number,
            default: 1
        },
        lastRequestAt: {
            type: Date,
            default: Date.now
        },
        totalFailures: {
            type: Number,
            default: 0
        },
        blockedUntil: {
            type: Date
        }
    },
    {
        collection: 'food_otps',
        timestamps: true
    }
);

// TTL index for automatic expiry
otpSchema.index({ phone: 1 });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const FoodOtp = mongoose.model('FoodOtp', otpSchema);

