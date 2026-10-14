import { sendResponse, sendError } from '../../../../utils/response.js';
import { invalidateFoodBrowseCaches } from '../../../../middleware/cache.js';
import {
    listPendingFoodApprovals,
    approveFoodItem,
    rejectFoodItem,
    listPendingApprovalRestaurants,
    bulkApprovePending
} from '../services/foodApproval.service.js';

export async function getPendingFoodApprovals(req, res, next) {
    try {
        const data = await listPendingFoodApprovals(req.query || {});
        return sendResponse(res, 200, 'Pending food approvals fetched successfully', data);
    } catch (error) {
        next(error);
    }
}

export async function approveFoodItemController(req, res, next) {
    try {
        const updated = await approveFoodItem(req.params.id);
        if (!updated) return sendError(res, 404, 'Food item not found or not pending');

        await invalidateFoodBrowseCaches([
            'restaurant_menu',
            'search',
            'categories',
            'under_250',
            'restaurants',
        ]);

        return sendResponse(res, 200, 'Food item approved successfully', { food: updated });
    } catch (error) {
        next(error);
    }
}

export async function getPendingApprovalRestaurantsController(req, res, next) {
    try {
        const data = await listPendingApprovalRestaurants(req.query || {});
        return sendResponse(res, 200, 'Pending approval restaurants fetched successfully', data);
    } catch (error) {
        next(error);
    }
}

export async function bulkApprovePendingController(req, res, next) {
    try {
        const result = await bulkApprovePending(req.body || {});

        if (result.approvedCount > 0) {
            await invalidateFoodBrowseCaches([
                'restaurant_menu',
                'search',
                'categories',
                'under_250',
                'restaurants',
            ]);
        }

        const message = result.skippedCount > 0
            ? `${result.approvedCount} item(s) approved, ${result.skippedCount} already processed`
            : `${result.approvedCount} item(s) approved successfully`;
        return sendResponse(res, 200, message, result);
    } catch (error) {
        next(error);
    }
}

export async function rejectFoodItemController(req, res, next) {
    try {
        const updated = await rejectFoodItem(req.params.id, req.body?.reason);
        if (!updated) return sendError(res, 404, 'Food item not found or not pending');

        await invalidateFoodBrowseCaches([
            'restaurant_menu',
            'search',
            'categories',
            'under_250',
            'restaurants',
        ]);

        return sendResponse(res, 200, 'Food item rejected successfully', { food: updated });
    } catch (error) {
        next(error);
    }
}

