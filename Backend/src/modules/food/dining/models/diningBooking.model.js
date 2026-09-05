import mongoose from 'mongoose';

const diningBookingSchema = new mongoose.Schema(
    {
        bookingId: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodRestaurant',
            required: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodUser',
            required: true
        },
        guests: {
            type: Number,
            required: true,
            min: 1
        },
        date: {
            type: Date,
            required: true
        },
        timeSlot: {
            type: String,
            required: true,
            trim: true
        },
        specialRequest: {
            type: String,
            default: '',
            trim: true
        },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'confirmed', 'checked-in', 'completed', 'cancelled', 'rejected'],
            default: 'pending'
        },
        review: {
            rating: { type: Number, min: 1, max: 5 },
            comment: { type: String, trim: true },
            createdAt: { type: Date }
        }
    },
    {
        collection: 'food_dining_bookings',
        timestamps: true
    }
);

// Optimize database lookups for queue list, seat checks, and history list
diningBookingSchema.index({ restaurantId: 1, date: 1 });
diningBookingSchema.index({ userId: 1, date: -1 });

export const FoodDiningBooking = mongoose.model('FoodDiningBooking', diningBookingSchema);
