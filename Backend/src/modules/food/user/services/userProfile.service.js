import { FoodUser } from '../../../../core/users/user.model.js';
import { AuthError, ValidationError } from '../../../../core/auth/errors.js';
import { uploadImageBuffer, deleteReplacedAssets } from '../../../../services/storage.service.js';

const parseIsoDateOrNull = (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const d = new Date(`${String(value)}T00:00:00.000Z`);
    // Keep null for invalid; validation is handled by DTO, but be defensive.
    return Number.isNaN(d.getTime()) ? null : d;
};

export const getCurrentUserProfile = async (userId) => {
    const user = await FoodUser.findById(userId).lean();
    if (!user) throw new AuthError('Profile not found');
    return { user };
};

export const updateCurrentUserProfile = async (userId, body) => {
    const user = await FoodUser.findById(userId);
    if (!user) throw new AuthError('Profile not found');

    if (body.phone !== undefined) {
        const nextPhone = String(body.phone || '').trim();
        const currentPhone = String(user.phone || '').trim();
        
        if (nextPhone && nextPhone !== currentPhone) {
            // Check if phone is already taken by another user
            const existingUser = await FoodUser.findOne({ phone: nextPhone, _id: { $ne: userId } });
            if (existingUser) {
                throw new ValidationError('Phone number is already in use by another account');
            }
            user.phone = nextPhone;
        }
    }

    if (body.name !== undefined) user.name = String(body.name || '').trim();
    if (body.email !== undefined) user.email = String(body.email || '').trim().toLowerCase();
    if (body.profileImage !== undefined) {
        const nextImage = String(body.profileImage || '').trim();
        await deleteReplacedAssets(user.profileImage, nextImage);
        user.profileImage = nextImage;
    }
    if (body.gender !== undefined) user.gender = String(body.gender || '').trim();

    const dob = parseIsoDateOrNull(body.dateOfBirth);
    if (dob !== undefined) user.dateOfBirth = dob;
    const ann = parseIsoDateOrNull(body.anniversary);
    if (ann !== undefined) user.anniversary = ann;

    await user.save();
    return { user: user.toObject() };
};

export const uploadCurrentUserProfileImage = async (userId, file) => {
    if (!file || !file.buffer) {
        throw new ValidationError('File is required');
    }
    const user = await FoodUser.findById(userId);
    if (!user) throw new AuthError('Profile not found');

    const url = await uploadImageBuffer(file.buffer, 'food/users/profile', {
        replaceUrl: user.profileImage,
        maxWidth: 1024
    });
    user.profileImage = String(url || '').trim();
    await user.save();
    return { profileImage: user.profileImage, user: user.toObject() };
};

