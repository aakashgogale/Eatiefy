import { verifyAccessToken } from './token.util.js';
import { sendError } from '../../utils/response.js';
import { FoodUser } from '../users/user.model.js';
import { FoodRestaurant } from '../../modules/food/restaurant/models/restaurant.model.js';

export const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'ADMIN') {
        return sendError(res, 403, 'Admin access required');
    }
    next();
};

export const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
        return sendError(res, 401, 'Authentication token missing');
    }

    try {
        const decoded = verifyAccessToken(token);
        req.user = {
            userId: decoded.userId,
            role: decoded.role,
            adminType: decoded.adminType
        };
        if (decoded.role === 'USER') {
            // Enforce active status in real-time - deactivated users are logged out on next request.
            FoodUser.findById(decoded.userId).select('isActive').lean().then((doc) => {
                if (!doc || doc.isActive === false) {
                    return sendError(res, 401, 'User account is deactivated');
                }
                next();
            }).catch(() => sendError(res, 401, 'Authentication failed'));
            return;
        }
        if (decoded.role === 'RESTAURANT') {
            // Enforce real-time approval and active status for restaurants.
            FoodRestaurant.findById(decoded.userId).select('status isActive').lean().then((restaurant) => {
                if (!restaurant) {
                    return sendError(res, 401, 'Restaurant account not found');
                }
                if (restaurant.isActive === false) {
                    return sendError(res, 403, 'Your restaurant account has been deactivated. Please contact support.');
                }
                const status = String(restaurant.status || 'pending').toLowerCase();
                if (status === 'pending') {
                    return sendError(res, 403, 'Your restaurant registration is pending admin approval. You will be able to access your account once the admin approves your registration.');
                }
                if (status === 'rejected') {
                    return sendError(res, 403, 'Your restaurant registration has been rejected by the admin. Please contact support for more information.');
                }
                if (status !== 'approved') {
                    return sendError(res, 403, 'Restaurant access not approved');
                }
                req.restaurant = restaurant;
                next();
            }).catch(() => sendError(res, 401, 'Authentication failed'));
            return;
        }
        return next();
    } catch (error) {
        return sendError(res, 401, 'Invalid or expired token');
    }
};
export const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
        return next();
    }

    try {
        const decoded = verifyAccessToken(token);
        req.user = {
            userId: decoded.userId,
            role: decoded.role,
            adminType: decoded.adminType
        };
        next();
    } catch (error) {
        // Silently ignore invalid tokens in optional auth
        next();
    }
};
