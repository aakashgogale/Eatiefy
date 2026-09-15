import { getIO } from '../config/socket.js';
import { logger } from '../utils/logger.js';

/**
 * Broadcasts "the browsable catalog changed" to connected clients so the user
 * app can refresh itself instead of showing data from page load until a manual
 * reload (a restaurant that just came online, edited timings, a new dish...).
 *
 * Deliberately an allowlist, not "every mutation": order status updates fire
 * constantly and change nothing a browsing user sees, so broadcasting them
 * would make every user app refetch on every order in the system.
 */
export const CATALOG_CHANGED_EVENT = 'catalog_changed';

// Matched against the path within the router this middleware is mounted on.
const CATALOG_PATH_PATTERNS = [
    /^\/profile\b/,
    /^\/availability\b/,
    /^\/dining-settings\b/,
    /^\/takeaway-settings\b/,
    /^\/outlet-timings\b/,
    /^\/categories\b/,
    /^\/menu\b/,
    /^\/foods\b/,
    /^\/addons\b/,
    /^\/restaurants\b/, // admin-side edits to a restaurant
    /^\/food\b/,        // admin-side food approval / edits
];

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const isCatalogPath = (path) => {
    const clean = String(path || '').split('?')[0];
    return CATALOG_PATH_PATTERNS.some((pattern) => pattern.test(clean));
};

/**
 * Express middleware. Mount on the restaurant and admin routers.
 */
export const catalogChangeBroadcast = (req, res, next) => {
    if (!MUTATING_METHODS.has(req.method) || !isCatalogPath(req.path)) {
        return next();
    }

    // Capture before the handler runs - req.path is rewritten by nested routers.
    const changedPath = req.path;

    res.on('finish', () => {
        if (res.statusCode >= 400) return;
        try {
            const io = getIO();
            if (!io) return;
            // A restaurant's JWT userId is its restaurant id (see socket room setup).
            const restaurantId =
                req.user?.role === 'RESTAURANT' ? String(req.user.userId) : null;

            io.emit(CATALOG_CHANGED_EVENT, {
                restaurantId,
                path: changedPath,
                at: Date.now(),
            });
        } catch (err) {
            // Never let a broadcast failure affect the request that succeeded.
            logger.warn(`catalogChangeBroadcast emit failed: ${err?.message || err}`);
        }
    });

    return next();
};

export default catalogChangeBroadcast;
