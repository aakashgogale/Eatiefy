import express from 'express';
import { authMiddleware } from '../auth/auth.middleware.js';
import { sendError } from '../../utils/response.js';
import {
    removeFirebaseDeviceToken,
    sendTestNotification,
    upsertFirebaseDeviceToken
} from './firebase.service.js';
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
        endpoints: ['/save', '/mobile/save', '/remove', '/test', '/pending-save']
    });
});

/*
 * Only partners still waiting for approval can be reached through this route.
 * It is unauthenticated (pending partners hold no session), so for an approved
 * restaurant or rider it would let anyone attach their own device by phone
 * number and receive that account's order notifications - customer names,
 * addresses and phone numbers. Approved accounts register through /save.
 */
const PENDING_PARTNER_STATUSES = new Set(['pending', 'payment_pending', 'rejected']);
const isPendingPartner = (doc) =>
    PENDING_PARTNER_STATUSES.has(String(doc?.status || 'pending').toLowerCase());

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
            if (!isPendingPartner(restaurant)) {
                return sendError(res, 403, 'Please sign in to register notifications');
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
            if (!isPendingPartner(partner)) {
                return sendError(res, 403, 'Please sign in to register notifications');
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
