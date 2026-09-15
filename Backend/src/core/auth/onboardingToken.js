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
 * A partner whose phone was just OTP-verified but who has no restaurant record yet
 * gets no access token either, so the registration form could never persist its
 * uploads server-side. This token proves "this phone was verified" and only
 * authorises the onboarding draft endpoints for that phone.
 */
export const REGISTRATION_TOKEN_SCOPE = 'restaurant_registration';
export const DELIVERY_REGISTRATION_TOKEN_SCOPE = 'delivery_registration';
const REGISTRATION_TOKEN_TTL = '7d';

const toPhoneLast10 = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);

export const signRegistrationToken = (phone, scope = REGISTRATION_TOKEN_SCOPE) => {
    const phoneLast10 = toPhoneLast10(phone);
    if (phoneLast10.length !== 10) return null;
    return jwt.sign(
        { phoneLast10, scope },
        config.jwtAccessSecret,
        { expiresIn: REGISTRATION_TOKEN_TTL }
    );
};

export const verifyRegistrationToken = (token, scope = REGISTRATION_TOKEN_SCOPE) => {
    const decoded = jwt.verify(String(token || ''), config.jwtAccessSecret);
    if (decoded?.scope !== scope) {
        throw new Error('Token is not a registration token');
    }
    if (toPhoneLast10(decoded?.phoneLast10).length !== 10) {
        throw new Error('Registration token has no valid phone');
    }
    return decoded;
};

/**
 * Builds middleware that populates `req.registration = { phoneLast10 }` from the
 * `X-Registration-Token` header. Scopes keep a restaurant token from authorising
 * delivery-partner uploads and vice versa.
 */
export const createRegistrationAuthMiddleware = (scope = REGISTRATION_TOKEN_SCOPE) => (req, res, next) => {
    const token = String(req.headers['x-registration-token'] || '').trim();
    if (!token) {
        return sendError(res, 401, 'Registration session token is required');
    }
    try {
        const decoded = verifyRegistrationToken(token, scope);
        req.registration = { phoneLast10: toPhoneLast10(decoded.phoneLast10) };
        return next();
    } catch (error) {
        return sendError(
            res,
            401,
            error?.name === 'TokenExpiredError'
                ? 'Your registration session expired. Please verify your phone again.'
                : 'Invalid registration session'
        );
    }
};

export const registrationAuthMiddleware = createRegistrationAuthMiddleware(REGISTRATION_TOKEN_SCOPE);
export const deliveryRegistrationAuthMiddleware = createRegistrationAuthMiddleware(DELIVERY_REGISTRATION_TOKEN_SCOPE);

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
