import express from 'express';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { sendError } from '../../../../utils/response.js';
import { cacheResponse } from '../../../../middleware/cache.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import { PUBLIC_OFFERS_CACHE_PREFIX } from '../services/restaurantOffer.service.js';
import {
    listRestaurantOffersController,
    getRestaurantOfferOptionsController,
    createRestaurantOfferController,
    updateRestaurantOfferController,
    toggleRestaurantOfferController,
    deleteRestaurantOfferController,
    listLiveRestaurantOffersController
} from '../controllers/restaurantOffer.controller.js';

/**
 * Restaurant-run menu offers, mounted at /api/v1/food/restaurant/item-offers.
 * (/food/restaurant/offers is the existing public list of admin coupons.)
 */
const router = express.Router();

// Same rule as the restaurant dashboard routes: a RESTAURANT token whose account is approved.
const requireApprovedRestaurant = async (req, res, next) => {
    if (req.user?.role !== 'RESTAURANT') {
        return sendError(res, 403, 'Restaurant access required');
    }
    try {
        const doc = await FoodRestaurant.findById(req.user.userId).select('status').lean();
        if (!doc) return sendError(res, 404, 'Restaurant not found');
        if (String(doc.status || '').toLowerCase() !== 'approved') {
            return sendError(res, 403, 'Restaurant account is not approved yet');
        }
        return next();
    } catch (error) {
        return next(error);
    }
};

// Public: what a customer can get from this restaurant right now. Short cache - offers
// start and stop by the clock - and every change clears it.
router.get('/public/:restaurantId', cacheResponse(60, PUBLIC_OFFERS_CACHE_PREFIX), listLiveRestaurantOffersController);

// Restaurant's own offers. Every query is scoped to the logged-in restaurant.
router.get('/', authMiddleware, requireApprovedRestaurant, listRestaurantOffersController);
router.get('/options', authMiddleware, requireApprovedRestaurant, getRestaurantOfferOptionsController);
router.post('/', authMiddleware, requireApprovedRestaurant, createRestaurantOfferController);
router.put('/:id', authMiddleware, requireApprovedRestaurant, updateRestaurantOfferController);
router.patch('/:id/toggle', authMiddleware, requireApprovedRestaurant, toggleRestaurantOfferController);
router.delete('/:id', authMiddleware, requireApprovedRestaurant, deleteRestaurantOfferController);

export default router;
