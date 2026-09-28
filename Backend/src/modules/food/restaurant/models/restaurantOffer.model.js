import mongoose from 'mongoose';
import { DAY_NAMES } from '../utils/operatingHours.js';

export const OFFER_APPLICABLE_TO = Object.freeze(['specific_items', 'category', 'entire_menu']);
export const OFFER_DISCOUNT_TYPES = Object.freeze(['percentage', 'flat']);

/**
 * A discount a restaurant runs on its own menu (e.g. "20% off all Pizzas, Mon-Fri 3-6 PM").
 *
 * Applied automatically at checkout by the server (orders/services/
 * restaurantOfferPricing.service.js) and funded by the restaurant: the discount comes
 * off the restaurant's own item price, never the platform markup.
 *
 *  - percentage: `discountValue`% off each eligible item.
 *  - flat: ₹`discountValue` off the eligible items, once per order.
 *
 * Empty `activeDays` means every day; an empty `activeTimeSlot` means all day. Days and
 * times are evaluated in the app timezone, and a slot whose end is before its start
 * runs overnight (22:00-02:00), matching outlet timings.
 *
 * Separate from FoodOffer (admin coupons that need a code).
 */
const timeSlotSchema = new mongoose.Schema(
    {
        start: { type: String, trim: true, default: '' },
        end: { type: String, trim: true, default: '' }
    },
    { _id: false }
);

const restaurantOfferSchema = new mongoose.Schema(
    {
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodRestaurant',
            required: true,
            index: true
        },
        title: { type: String, required: true, trim: true, maxlength: 80 },
        description: { type: String, trim: true, maxlength: 300, default: '' },
        applicableTo: { type: String, enum: OFFER_APPLICABLE_TO, required: true },
        itemIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem' }],
        categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FoodCategory' }],
        discountType: { type: String, enum: OFFER_DISCOUNT_TYPES, required: true },
        discountValue: { type: Number, required: true, min: 0 },
        minOrderValue: { type: Number, default: 0, min: 0 },
        validFrom: { type: Date, required: true },
        validTill: { type: Date, required: true },
        activeDays: [{ type: String, enum: DAY_NAMES }],
        activeTimeSlot: { type: timeSlotSchema, default: () => ({}) },
        isActive: { type: Boolean, default: true },
        approvalStatus: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending',
            index: true
        },
        rejectionReason: { type: String, trim: true, default: null },
        approvedAt: { type: Date, default: null },
        approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodAdmin', default: null }
    },
    {
        collection: 'food_restaurant_offers',
        timestamps: true
    }
);

// Checkout and the customer menu look up a restaurant's currently valid approved offers.
restaurantOfferSchema.index({ restaurantId: 1, isActive: 1, approvalStatus: 1, validFrom: 1, validTill: 1 });
// Restaurant dashboard list.
restaurantOfferSchema.index({ restaurantId: 1, createdAt: -1 });
// Admin approvals list.
restaurantOfferSchema.index({ approvalStatus: 1, createdAt: -1 });

export const FoodRestaurantOffer = mongoose.model('FoodRestaurantOffer', restaurantOfferSchema);
