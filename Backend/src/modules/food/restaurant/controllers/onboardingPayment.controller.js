import {
    getOnboardingPaymentQuote,
    createOnboardingPaymentOrder,
    verifyOnboardingPayment,
    cancelOnboardingPayment,
    createOnboardingPaymentQr,
    getOnboardingQrPaymentStatus
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

/** POST /food/restaurant/onboarding/payment/qr - scan-to-pay UPI QR for the same attempt */
export const createOnboardingPaymentQrController = async (req, res, next) => {
    try {
        const data = await createOnboardingPaymentQr(req.onboarding.restaurantId);
        return sendResponse(res, 201, 'UPI QR ready', data);
    } catch (error) {
        next(error);
    }
};

/** GET /food/restaurant/onboarding/payment/qr/status?qrCodeId= - polled while the QR is shown */
export const getOnboardingQrPaymentStatusController = async (req, res, next) => {
    try {
        const data = await getOnboardingQrPaymentStatus(req.onboarding.restaurantId, req.query?.qrCodeId);
        return sendResponse(res, 200, data.paid ? 'Payment received' : 'Waiting for payment', data);
    } catch (error) {
        next(error);
    }
};
