import { isDiningEnabled } from '../../admin/services/moduleAccess.service.js';
import { sendError } from '../../../../utils/response.js';

/**
 * Gate for every Dining endpoint.
 *
 * Dining is a single backend-owned toggle (`dining_enabled` in FoodSystemConfig,
 * read through moduleAccess.service). The apps hide their Dining entry points
 * from the same flag, but hiding a button is not access control — this makes the
 * API itself unavailable while the feature is off, so a stale client or a direct
 * request cannot create bookings for a disabled module.
 *
 * 404 rather than 403: while the feature is off the route effectively does not
 * exist, and that is what a client should see.
 */
export const requireDiningEnabled = async (req, res, next) => {
    try {
        const enabled = await isDiningEnabled();
        if (!enabled) {
            return sendError(res, 404, 'Dining is not available');
        }
        next();
    } catch (error) {
        next(error);
    }
};
