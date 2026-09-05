import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import { FoodRestaurant } from '../models/restaurant.model.js';
import {
    registerRestaurantController,
    listApprovedRestaurantsController,
    getApprovedRestaurantController,
    listPublicOffersController,
    getCurrentRestaurantController,
    updateRestaurantProfileController,
    updateRestaurantAcceptingOrdersController,
    updateCurrentRestaurantDiningSettingsController,
    updateCurrentRestaurantTakeawaySettingsController,
    uploadRestaurantProfileImageController,
    uploadRestaurantMenuImageController,
    uploadRestaurantCoverImagesController,
    uploadRestaurantMenuImagesController,
    getRestaurantComplaintsController,
    listRestaurantsUnder250Controller,
    createDiningRequestController,
    getPendingDiningRequestController
} from '../controllers/restaurant.controller.js';
import {
    createRestaurantSupportTicketController,
    listRestaurantSupportTicketsController
} from '../controllers/supportTicket.controller.js';
import {
    createWithdrawalRequestController,
    listMyWithdrawalsController
} from '../controllers/withdrawal.controller.js';
import {
    listCategoriesController,
    createCategoryController,
    updateCategoryController,
    deleteCategoryController
} from '../controllers/restaurantCategory.controller.js';
import { getMenuController, updateMenuController, getPublicRestaurantMenuController } from '../controllers/restaurantMenu.controller.js';
import { getPublicRestaurantAddonsController } from '../controllers/publicAddons.controller.js';
import * as feedbackExperienceController from '../../admin/controllers/feedbackExperience.controller.js';
import {
    getOutletTimingsByRestaurantIdController,
    getCurrentRestaurantOutletTimingsController,
    upsertCurrentRestaurantOutletTimingsController
} from '../controllers/outletTimings.controller.js';
import {
    getRestaurantFoodByIdController,
    createRestaurantFoodController,
    updateRestaurantFoodController,
    deleteRestaurantFoodController
} from '../controllers/restaurantFood.controller.js';
import {
    listAddonsController,
    createAddonController,
    updateAddonController,
    deleteAddonController
} from '../controllers/restaurantAddon.controller.js';
import * as orderController from '../../orders/controllers/order.controller.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { sendError } from '../../../../utils/response.js';
import { getRestaurantFinanceController } from '../controllers/restaurantFinance.controller.js';

import { cacheResponse, invalidateCache, invalidateFoodBrowseCaches } from '../../../../middleware/cache.js';

const router = express.Router();

const requireRestaurant = (req, res, next) => {
    if (req.user?.role !== 'RESTAURANT') {
        return sendError(res, 403, 'Restaurant access required');
    }
    next();
};

const requireApprovedRestaurant = async (req, res, next) => {
    if (req.user?.role !== 'RESTAURANT') {
        return sendError(res, 403, 'Restaurant access required');
    }

    try {
        const doc = await FoodRestaurant.findById(req.user.userId).select('status').lean();
        if (!doc) {
            return sendError(res, 404, 'Restaurant not found');
        }

        const status = String(doc.status || '').toLowerCase();
        if (status !== 'approved') {
            return sendError(res, 403, 'Restaurant account is not approved yet');
        }

        next();
    } catch (error) {
        next(error);
    }
};

const uploadFields = upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'panImage', maxCount: 1 },
    { name: 'gstImage', maxCount: 1 },
    { name: 'fssaiImage', maxCount: 1 },
    { name: 'menuImages', maxCount: 10 }
]);

router.post('/register', uploadFields, registerRestaurantController);

// Public: approved restaurants list (for user app)
router.get('/restaurants', cacheResponse(300, 'restaurants'), listApprovedRestaurantsController);
router.get('/restaurants/:id', cacheResponse(600, 'restaurant_detail'), getApprovedRestaurantController);
router.get('/restaurants/:id/menu', cacheResponse(600, 'restaurant_menu'), getPublicRestaurantMenuController);
router.get('/restaurants/:id/outlet-timings', cacheResponse(600, 'restaurant_timings'), getOutletTimingsByRestaurantIdController);
router.get('/under-250', cacheResponse(180, 'under250'), listRestaurantsUnder250Controller);
router.get('/offers', cacheResponse(300, 'offers'), listPublicOffersController);
// Public: categories list (zone-aware; returns zone categories + global)
router.get('/categories/public', cacheResponse(600, 'categories'), listCategoriesController);

// Restaurant dashboard/profile (Bearer token + RESTAURANT role)
router.get('/current', authMiddleware, requireRestaurant, getCurrentRestaurantController);
router.patch('/profile', authMiddleware, requireRestaurant, async (req, res, next) => {
    // Invalidate caches when profile is updated
    await invalidateCache('restaurants:*');
    await invalidateCache('restaurant_detail:*');
    await invalidateCache('search:*');
    next();
}, updateRestaurantProfileController);
router.patch('/availability', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurants:*');
    await invalidateCache('search:*');
    next();
}, updateRestaurantAcceptingOrdersController);
// DINING DISABLED — re-enable with Frontend DINING_ENABLED
// router.patch('/dining-settings', authMiddleware, requireApprovedRestaurant, updateCurrentRestaurantDiningSettingsController);
router.patch('/takeaway-settings', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurants:*');
    await invalidateCache('restaurant_detail:*');
    await invalidateCache('search:*');
    next();
}, updateCurrentRestaurantTakeawaySettingsController);
// DINING DISABLED
// router.post('/dining-settings/request', authMiddleware, requireApprovedRestaurant, createDiningRequestController);
// router.get('/dining-settings/pending', authMiddleware, requireApprovedRestaurant, getPendingDiningRequestController);
router.get('/outlet-timings', authMiddleware, requireApprovedRestaurant, getCurrentRestaurantOutletTimingsController);
router.put('/outlet-timings', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurants:*');
    await invalidateCache('restaurant_detail:*');
    await invalidateCache('restaurant_timings:*');
    await invalidateCache('under_250:*');
    await invalidateCache('search:*');
    next();
}, upsertCurrentRestaurantOutletTimingsController);
router.get('/finance', authMiddleware, requireApprovedRestaurant, getRestaurantFinanceController);
router.post('/withdraw', authMiddleware, requireApprovedRestaurant, createWithdrawalRequestController);
router.get('/withdrawals', authMiddleware, requireApprovedRestaurant, listMyWithdrawalsController);
router.post(
    '/profile/profile-image',
    authMiddleware,
    requireApprovedRestaurant,
    upload.single('file'),
    async (req, res, next) => {
        await invalidateCache('restaurants:*');
        await invalidateCache('restaurant_detail:*');
        next();
    },
    uploadRestaurantProfileImageController
);
router.post(
    '/profile/menu-image',
    authMiddleware,
    requireApprovedRestaurant,
    upload.single('file'),
    async (req, res, next) => {
        await invalidateCache('restaurant_menu:*');
        next();
    },
    uploadRestaurantMenuImageController
);
router.post(
    '/profile/cover-images',
    authMiddleware,
    requireApprovedRestaurant,
    upload.array('files', 20),
    async (req, res, next) => {
        await invalidateCache('restaurant_detail:*');
        next();
    },
    uploadRestaurantCoverImagesController
);
router.post(
    '/profile/menu-images',
    authMiddleware,
    requireApprovedRestaurant,
    upload.array('files', 20),
    async (req, res, next) => {
        await invalidateCache('restaurant_menu:*');
        next();
    },
    uploadRestaurantMenuImagesController
);

// Categories (restaurant dashboard). Read-only for item creation, CRUD for Menu Categories page.
router.get('/categories', authMiddleware, requireApprovedRestaurant, listCategoriesController);
router.post('/categories', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateFoodBrowseCaches(['categories', 'search']);
    next();
}, createCategoryController);
router.patch('/categories/:id', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateFoodBrowseCaches(['categories', 'search']);
    next();
}, updateCategoryController);
router.delete('/categories/:id', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateFoodBrowseCaches(['categories', 'search']);
    next();
}, deleteCategoryController);

// Menu (restaurant dashboard) - only fields needed by UI
router.get('/menu', authMiddleware, requireApprovedRestaurant, getMenuController);
router.patch('/menu', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    await invalidateCache('search:*');
    await invalidateCache('under_250:*');
    next();
}, updateMenuController);

// Feedback (restaurant dashboard)
router.post('/feedback-experience', authMiddleware, requireApprovedRestaurant, feedbackExperienceController.createFeedbackExperience);

// Public: restaurant add-ons (user app)
router.get('/restaurants/:id/addons', cacheResponse(600, 'restaurant_addons'), getPublicRestaurantAddonsController);

// Foods (restaurant creates/updates items -> stored in food_items collection)
router.get('/foods/:id', authMiddleware, requireApprovedRestaurant, getRestaurantFoodByIdController);
router.post('/foods', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    await invalidateCache('search:*');
    await invalidateCache('categories:*');
    await invalidateCache('under_250:*');
    next();
}, createRestaurantFoodController);
router.patch('/foods/:id', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    await invalidateCache('search:*');
    await invalidateCache('categories:*');
    await invalidateCache('under_250:*');
    next();
}, updateRestaurantFoodController);
router.delete('/foods/:id', authMiddleware, requireApprovedRestaurant, async (req, res, next) => {
    await invalidateCache('restaurant_menu:*');
    await invalidateCache('search:*');
    await invalidateCache('categories:*');
    await invalidateCache('under_250:*');
    next();
}, deleteRestaurantFoodController);

// Add-ons (restaurant dashboard) - approval handled by admin
router.get('/addons', authMiddleware, requireApprovedRestaurant, listAddonsController);
router.post('/addons', authMiddleware, requireApprovedRestaurant, createAddonController);
router.patch('/addons/:id', authMiddleware, requireApprovedRestaurant, updateAddonController);
router.delete('/addons/:id', authMiddleware, requireApprovedRestaurant, deleteAddonController);

// Orders (restaurant dashboard)
router.get('/orders', authMiddleware, requireApprovedRestaurant, orderController.listOrdersRestaurantController);
router.get('/orders/:orderId', authMiddleware, requireApprovedRestaurant, orderController.getOrderByIdRestaurantController);
router.patch('/orders/:orderId/status', authMiddleware, requireApprovedRestaurant, orderController.updateOrderStatusRestaurantController);
router.post('/orders/:orderId/resend-notification', authMiddleware, requireApprovedRestaurant, orderController.resendDeliveryNotificationRestaurantController);
router.post('/orders/:orderId/complete-takeaway', authMiddleware, requireApprovedRestaurant, orderController.completeTakeawayOrderRestaurantController);

// Complaints (restaurant dashboard)
router.get('/complaints', authMiddleware, requireApprovedRestaurant, getRestaurantComplaintsController);
router.post('/support/tickets', authMiddleware, requireApprovedRestaurant, createRestaurantSupportTicketController);
router.get('/support/tickets', authMiddleware, requireApprovedRestaurant, listRestaurantSupportTicketsController);



export default router;


