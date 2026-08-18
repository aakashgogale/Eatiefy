import mongoose from 'mongoose';

const foodExploreIconSchema = new mongoose.Schema(
    {
        label: {
            type: String,
            required: true
        },
        iconUrl: {
            type: String,
            required: true
        },
        publicId: {
            type: String,
            required: true
        },
        linkType: {
            type: String,
            enum: ['offers', 'gourmet', 'top-10', 'collections', 'under-250', 'custom'],
            default: 'custom'
        },
        targetPath: {
            type: String
        },
        sortOrder: {
            type: Number,
            default: 0,
            index: true
        },
        isActive: {
            type: Boolean,
            default: true,
            index: true
        },
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FoodZone',
            default: null,
            index: true
        }
    },
    {
        collection: 'food_explore_icons',
        timestamps: true
    }
);

foodExploreIconSchema.index({ isActive: 1, sortOrder: 1 });

export const FoodExploreIcon = mongoose.model('FoodExploreIcon', foodExploreIconSchema);

