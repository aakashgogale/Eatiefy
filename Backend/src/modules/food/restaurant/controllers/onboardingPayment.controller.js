import {
    getOnboardingPaymentQuote,
    createOnboardingPaymentOrder,
    verifyOnboardingPayment,
    cancelOnboardingPayment
} from '../services/onboardingPayment.service.js';
import { sendResponse } from '../../../../utils/response.js';

/** GET /food/restaurant/onboarding/payment/quote */
export const getOnboardingPaymentQuoteController = async (req, res, next) => {
    try {
        const data = await getOnboardingPaymentQuote(req.onboarding.restaurantId);
        return sendResponse(res, 200, 'Onboarding payment quote fetched', data);
    } catch (error) {
        next(error);
    }
};

/** POST /food/restaurant/onboarding/payment/order */
export const createOnboardingPaymentOrderController = async (req, res, next) => {
    try {
        const data = await createOnboardingPaymentOrder(req.onboarding.restaurantId);
        return sendResponse(res, 201, 'Onboarding payment order created', data);
    } catch (error) {
        next(error);
    }
};

/** POST /food/restaurant/onboarding/payment/verify */
export const verifyOnboardingPaymentController = async (req, res, next) => {
    try {
        const data = await verifyOnboardingPayment(req.onboarding.restaurantId, req.body || {});
        return sendResponse(res, 200, 'Payment verified. Your restaurant is now awaiting admin approval.', data);
    } catch (error) {
        next(error);
    }
};

/** POST /food/restaurant/onboarding/payment/cancel */
export const cancelOnboardingPaymentController = async (req, res, next) => {
    try {
        const data = await cancelOnboardingPayment(req.onboarding.restaurantId, req.body || {});
        return sendResponse(res, 200, 'Payment attempt closed', data);
    } catch (error) {
        next(error);
    }
};
