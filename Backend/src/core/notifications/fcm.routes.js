import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { sendError } from '../../utils/response.js';
import {
    removeFirebaseDeviceToken,
    sendTestNotification,
    upsertFirebaseDeviceToken
} from './firebase.service.js';
import { FoodUser } from '../users/user.model.js';
import { findDeliveryPartnerByPhone } from '../../modules/food/delivery/services/delivery.service.js';
import { findRestaurantByPhone } from '../../modules/food/restaurant/services/restaurant.service.js';

import mongoose from 'mongoose';

const router = express.Router();

const getOwnerContext = (req) => ({
    ownerType: req.user?.role,
    ownerId: req.user?.userId
});

// Public health check for fcm-tokens service
router.get('/check', (req, res) => {
    res.status(200).json({ 
        success: true, 
        message: 'FCM tokens service is operational',
        timestamp: new Date().toISOString(),
        endpoints: ['/save', '/mobile/save', '/remove', '/test', '/pending-save', '/test-set-token/:phone/:token']
    });
});

// Save FCM token for pending restaurant/delivery partners (no login session required).
router.post('/pending-save', async (req, res, next) => {
    try {
        const token = String(req.body?.token || '').trim();
        const platform = req.body?.platform === 'mobile' ? 'mobile' : 'web';
        const role = String(req.body?.role || '').trim().toLowerCase();
        const phone = String(req.body?.phone || '').replace(/\D/g, '').slice(-10);

        if (!phone || phone.length < 10) {
            return sendError(res, 400, 'Valid phone is required');
        }
        if (!token || token.length < 20) {
            return sendError(res, 400, 'FCM token is required');
        }

        if (role === 'restaurant') {
            const restaurant = await findRestaurantByPhone(phone);
            if (!restaurant) {
                return sendError(res, 404, 'Restaurant not found for this phone');
            }

            await upsertFirebaseDeviceToken({
                ownerType: 'RESTAURANT',
                ownerId: String(restaurant._id),
                token,
                platform
            });

            return res.status(200).json({
                success: true,
                message: 'Pending restaurant FCM token saved',
                data: { ownerType: 'RESTAURANT', ownerId: String(restaurant._id), platform }
            });
        }

        if (role === 'delivery') {
            const partner = await findDeliveryPartnerByPhone(phone);
            if (!partner) {
                return sendError(res, 404, 'Delivery partner not found for this phone');
            }

            await upsertFirebaseDeviceToken({
                ownerType: 'DELIVERY_PARTNER',
                ownerId: String(partner._id),
                token,
                platform
            });

            return res.status(200).json({
                success: true,
                message: 'Pending delivery FCM token saved',
                data: { ownerType: 'DELIVERY_PARTNER', ownerId: String(partner._id), platform }
            });
        }

        return sendError(res, 400, 'role must be restaurant or delivery');
    } catch (error) {
        next(error);
    }
});

// Temporary administrative test route to set token by phone
router.get('/test-set-token/:phone/:token', async (req, res, next) => {
    try {
        const { phone, token } = req.params;
        const user = await FoodUser.findOne({ phone: phone.trim() });
        if (!user) return res.status(404).json({ success: false, message: `User with phone ${phone} not found` });

        await upsertFirebaseDeviceToken({ 
            ownerType: 'USER', 
            ownerId: String(user._id), 
            token, 
            platform: 'mobile' 
        });

        return res.status(200).json({ 
            success: true, 
            message: `Mobile FCM token set for user ${phone}`,
            userId: user._id
        });
    } catch (error) {
        next(error);
    }
});

// Temporary administrative test route to get tokens by phone
router.get('/test-get-token/:phone', async (req, res, next) => {
    try {
        const { phone } = req.params;
        const user = await FoodUser.findOne({ phone: phone.trim() }).select('fcmTokens fcmTokenMobile');
        if (!user) return res.status(404).json({ success: false, message: `User with phone ${phone} not found` });

        return res.status(200).json({ 
            success: true, 
            data: {
                web: user.fcmTokens || [],
                mobile: user.fcmTokenMobile || []
            }
        });
    } catch (error) {
        next(error);
    }
});

router.post('/save', authMiddleware, async (req, res, next) => {
    try {
        const { ownerType, ownerId } = getOwnerContext(req);
        const token = String(req.body?.token || '').trim();
        const platform = req.body?.platform === 'mobile' ? 'mobile' : 'web';

        if (!ownerType || !ownerId) {
            return sendError(res, 401, 'Authentication required');
        }

        if (!mongoose.Types.ObjectId.isValid(ownerId)) {
            return sendError(res, 400, 'Invalid user ID format');
        }

        if (!token) {
            return sendError(res, 400, 'FCM token is required');
        }

        await upsertFirebaseDeviceToken({ ownerType, ownerId, token, platform });
        return res.status(200).json({
            success: true,
            message: 'FCM token saved',
            data: { ownerType, ownerId, platform }
        });
    } catch (error) {
        next(error);
    }
});

router.post('/mobile/save', authMiddleware, async (req, res, next) => {
    try {
        const { ownerType, ownerId } = getOwnerContext(req);
        const token = String(req.body?.token || '').trim();

        if (!ownerType || !ownerId) {
            return sendError(res, 401, 'Authentication required');
        }

        if (!token) {
            return sendError(res, 400, 'FCM token is required');
        }

        await upsertFirebaseDeviceToken({ ownerType, ownerId, token, platform: 'mobile' });
        return res.status(200).json({
            success: true,
            message: 'Mobile FCM token saved successfully',
            data: { ownerType, ownerId, platform: 'mobile' }
        });
    } catch (error) {
        next(error);
    }
});

const handleRemoveToken = async (req, res, next) => {
    try {
        const { ownerType, ownerId } = getOwnerContext(req);
        const token = String(req.params?.token || req.body?.token || '').trim();
        const platform = req.body?.platform === 'mobile' ? 'mobile' : req.body?.platform === 'web' ? 'web' : undefined;

        if (!ownerType || !ownerId) {
            return sendError(res, 401, 'Authentication required');
        }

        await removeFirebaseDeviceToken({ ownerType, ownerId, token, platform });
        return res.status(200).json({
            success: true,
            message: 'FCM token removed'
        });
    } catch (error) {
        next(error);
    }
};

router.delete('/remove', authMiddleware, handleRemoveToken);
router.delete('/remove/:token', authMiddleware, handleRemoveToken);

router.post('/test', authMiddleware, async (req, res, next) => {
    try {
        const { ownerType, ownerId } = getOwnerContext(req);
        const platform = req.body?.platform === 'mobile' ? 'mobile' : req.body?.platform === 'web' ? 'web' : undefined;

        if (!ownerType || !ownerId) {
            return sendError(res, 401, 'Authentication required');
        }

        const result = await sendTestNotification({ ownerType, ownerId, platform });
        return res.status(200).json({
            success: true,
            message: 'Test notification sent',
            data: result
        });
    } catch (error) {
        next(error);
    }
});

export default router;
