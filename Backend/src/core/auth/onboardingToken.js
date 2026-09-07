import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { config } from '../../config/env.js';
import { sendError } from '../../utils/response.js';

/**
 * A restaurant has no access token until an admin approves it (see
 * verifyRestaurantOtpAndLogin), so the onboarding payment endpoints cannot use the
 * normal role middleware. This mints a narrowly scoped, short-lived token that only
 * authorises onboarding-payment calls for one restaurant id.
 */
export const ONBOARDING_TOKEN_SCOPE = 'restaurant_onboarding';
const ONBOARDING_TOKEN_TTL = '6h';

export const signOnboardingToken = (restaurantId) =>
    jwt.sign(
        { restaurantId: String(restaurantId), scope: ONBOARDING_TOKEN_SCOPE },
        config.jwtAccessSecret,
        { expiresIn: ONBOARDING_TOKEN_TTL }
    );

export const verifyOnboardingToken = (token) => {
    const decoded = jwt.verify(String(token || ''), config.jwtAccessSecret);
    if (decoded?.scope !== ONBOARDING_TOKEN_SCOPE) {
        throw new Error('Token is not an onboarding token');
    }
    if (!decoded?.restaurantId || !mongoose.Types.ObjectId.isValid(String(decoded.restaurantId))) {
        throw new Error('Onboarding token has no valid restaurant');
    }
    return decoded;
};

const readToken = (req) => {
    const header = req.headers['x-onboarding-token'];
    if (header) return String(header).trim();
    const auth = req.headers.authorization || '';
    if (auth.toLowerCase().startsWith('onboarding ')) return auth.slice(11).trim();
    return '';
};

/**
 * Populates `req.onboarding = { restaurantId }`. Rejects anything that is not a
 * valid, unexpired onboarding-scoped token — an ordinary restaurant access token
 * will not pass, because its payload carries no onboarding scope.
 */
export const onboardingAuthMiddleware = (req, res, next) => {
    const token = readToken(req);
    if (!token) {
        return sendError(res, 401, 'Onboarding session token is required');
    }
    try {
        const decoded = verifyOnboardingToken(token);
        req.onboarding = { restaurantId: String(decoded.restaurantId) };
        return next();
    } catch (error) {
        const expired = error?.name === 'TokenExpiredError';
        return sendError(
            res,
            401,
            expired
                ? 'Your onboarding session expired. Please sign in again to finish payment.'
                : 'Invalid onboarding session'
        );
    }
};
