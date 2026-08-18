import mongoose from 'mongoose';

const featureSchema = new mongoose.Schema(
    {
        icon: { type: String, default: 'Heart' },
        title: { type: String, default: '' },
        description: { type: String, default: '' },
        color: { type: String, default: '' },
        bgColor: { type: String, default: '' },
        order: { type: Number, default: 0 }
    },
    { _id: false }
);

const legalPageSchema = new mongoose.Schema(
    {
        title: { type: String, default: '' },
        content: { type: String, default: '' }, // stored as HTML string
        email: { type: String, default: '' },
        mobile: { type: String, default: '' },
        faq: { type: String, default: '' }
    },
    { _id: false }
);

const aboutPageSchema = new mongoose.Schema(
    {
        appName: { type: String, default: 'Appzeto Food' },
        version: { type: String, default: '1.0.0' },
        description: { type: String, default: '' },
        logo: { type: String, default: '' },
        features: { type: [featureSchema], default: [] },
        stats: { type: Array, default: [] }
    },
    { _id: false }
);

const pageContentSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            index: true,
            enum: [
                'terms', 'terms_user', 'terms_restaurant', 'terms_delivery',
                'privacy', 'privacy_user', 'privacy_restaurant', 'privacy_delivery',
                'refund', 'shipping', 'cancellation', 'about',
                'support_user', 'support_restaurant', 'support_delivery'
            ]
        },
        legal: { type: legalPageSchema, default: undefined },
        about: { type: aboutPageSchema, default: undefined },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
        updatedByRole: { type: String, default: 'ADMIN' }
    },
    { collection: 'food_page_contents', timestamps: true }
);

export const FoodPageContent = mongoose.model('FoodPageContent', pageContentSchema);

