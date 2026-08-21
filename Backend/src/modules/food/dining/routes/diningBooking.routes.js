import express from 'express';
import {
    createBookingController,
    getMyBookingsController,
    getRestaurantBookingsController,
    updateBookingStatusController,
    createBookingReviewController
} from '../controllers/diningBooking.controller.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';

const router = express.Router();

// User bookings endpoints
router.post('/', (req, res, next) => {
    authMiddleware(req, res, () => {
        next();
    });
}, createBookingController);

router.get('/', (req, res, next) => {
    authMiddleware(req, res, () => {
        next();
    });
}, getMyBookingsController);

router.post('/:bookingId/review', authMiddleware, createBookingReviewController);

// Shared booking view (User checking seating OR Restaurant viewing queue)
router.get('/by-restaurant/:restaurantIdentifier', (req, res, next) => {
    authMiddleware(req, res, () => {
        next();
    });
}, getRestaurantBookingsController);

// Restaurant status update
router.patch('/:bookingId/status', (req, res, next) => {
    authMiddleware(req, res, () => {
        next();
    });
}, updateBookingStatusController);

export default router;
