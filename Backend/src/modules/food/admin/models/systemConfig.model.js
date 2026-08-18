import mongoose from 'mongoose';

const foodSystemConfigSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true },
        value: { type: mongoose.Schema.Types.Mixed, required: true },
        description: { type: String },
        updatedBy: {
            role: { type: String },
            adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
            at: { type: Date, default: Date.now }
        }
    },
    { timestamps: true }
);

export const FoodSystemConfig = mongoose.model('FoodSystemConfig', foodSystemConfigSchema);
