import { sendResponse } from '../../../../utils/response.js';
import {
    getOutletTimingsForRestaurant,
    getRestaurantOperatingStatus,
    upsertOutletTimingsForRestaurant
} from '../services/outletTimings.service.js';

export const getOutletTimingsByRestaurantIdController = async (req, res, next) => {
    try {
        const data = await getOutletTimingsForRestaurant(req.params.id);
        return sendResponse(res, 200, 'Outlet timings fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

// Authenticated responses are not cached, so they can carry the live open/closed state.
export const getCurrentRestaurantOutletTimingsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const [data, operatingStatus] = await Promise.all([
            getOutletTimingsForRestaurant(restaurantId),
            getRestaurantOperatingStatus(restaurantId)
        ]);
        return sendResponse(res, 200, 'Outlet timings fetched successfully', { ...data, operatingStatus });
    } catch (error) {
        next(error);
    }
};

export const upsertCurrentRestaurantOutletTimingsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const data = await upsertOutletTimingsForRestaurant(restaurantId, req.body?.outletTimings);
        const operatingStatus = await getRestaurantOperatingStatus(restaurantId);
        return sendResponse(res, 200, 'Outlet timings saved successfully', { ...data, operatingStatus });
    } catch (error) {
        next(error);
    }
};
