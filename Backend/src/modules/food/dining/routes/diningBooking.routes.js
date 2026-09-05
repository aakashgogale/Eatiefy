import express from 'express';
import {
    createBookingController,
    getMyBookingsController,
    getRestaurantBookingsController,
    updateBookingStatusController,
    createBookingReviewController
} from '../controllers/diningBooking.controller.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../../core/roles/role.middleware.js';

const router = express.Router();

// User bookings endpoints
router.post('/', authMiddleware, requireRoles('USER'), createBookingController);
router.get('/', authMiddleware, requireRoles('USER'), getMyBookingsController);
router.post('/:bookingId/review', authMiddleware, requireRoles('USER'), createBookingReviewController);

// Shared booking view (User checking seating OR Restaurant viewing queue)
router.get('/by-restaurant/:restaurantIdentifier', authMiddleware, requireRoles('USER', 'RESTAURANT'), getRestaurantBookingsController);

// Restaurant status update
router.patch('/:bookingId/status', authMiddleware, requireRoles('RESTAURANT'), updateBookingStatusController);

export default router;
