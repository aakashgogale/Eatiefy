import * as bookingService from '../services/diningBooking.service.js';
import { sendResponse, sendError } from '../../../../utils/response.js';

export async function createBookingController(req, res, next) {
    try {
        const userId = req.user?.userId || req.user?._id || req.user?.id || null;
        const booking = await bookingService.createBooking(userId, req.body || {});
        return sendResponse(res, 201, 'Table booked successfully', booking);
    } catch (error) {
        next(error);
    }
}

export async function getMyBookingsController(req, res, next) {
    try {
        const userId = req.user?.userId || req.user?._id || req.user?.id;
        if (!userId) {
            return sendResponse(res, 200, 'Bookings fetched successfully', []);
        }

        const bookings = await bookingService.listUserBookings(userId);
        return sendResponse(res, 200, 'Bookings fetched successfully', bookings);
    } catch (error) {
        next(error);
    }
}

export async function getRestaurantBookingsController(req, res, next) {
    try {
        const { restaurantIdentifier } = req.params;
        if (!restaurantIdentifier) {
            return sendError(res, 400, 'Restaurant identifier is required');
        }

        const requesterRole = req.user?.role || 'RESTAURANT';
        const requesterId = req.user?.userId || req.user?._id || req.user?.id;

        const bookings = await bookingService.listRestaurantBookings(restaurantIdentifier, {
            requesterRole,
            requesterId
        });

        return sendResponse(res, 200, 'Restaurant bookings fetched successfully', bookings);
    } catch (error) {
        next(error);
    }
}

export async function updateBookingStatusController(req, res, next) {
    try {
        const { bookingId } = req.params;
        const { status } = req.body;
        const restaurantId = req.user?.userId || req.user?._id || req.user?.id || req.body?.restaurantId;

        if (!bookingId) {
            return sendError(res, 400, 'Booking ID is required');
        }
        if (!status) {
            return sendError(res, 400, 'Status is required');
        }

        const updated = await bookingService.updateBookingStatus(bookingId, status, restaurantId);
        return sendResponse(res, 200, 'Booking status updated successfully', updated);
    } catch (error) {
        next(error);
    }
}

export async function createBookingReviewController(req, res, next) {
    try {
        const { bookingId } = req.params;
        const { rating, comment } = req.body;
        const userId = req.user?.userId;

        if (!bookingId) {
            return sendError(res, 400, 'Booking ID is required');
        }
        if (!rating) {
            return sendError(res, 400, 'Rating is required');
        }
        if (!userId) {
            return sendError(res, 401, 'Unauthorized');
        }

        const booking = await bookingService.submitBookingReview(bookingId, userId, rating, comment);
        return sendResponse(res, 200, 'Review submitted successfully', booking);
    } catch (error) {
        next(error);
    }
}
