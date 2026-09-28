import mongoose from 'mongoose';

/**
 * Who uploaded each stored file through the generic upload endpoint. Deleting or
 * replacing a file is limited to its uploader (or an admin); before this any
 * signed-in account could delete any stored file - restaurant logos, banners,
 * rider KYC documents - by URL.
 */
const uploadOwnerSchema = new mongoose.Schema(
    {
        filename: { type: String, required: true, unique: true },
        ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
        ownerRole: { type: String, required: true }
    },
    {
        collection: 'food_upload_owners',
        timestamps: true
    }
);

export const FoodUploadOwner = mongoose.model('FoodUploadOwner', uploadOwnerSchema);
