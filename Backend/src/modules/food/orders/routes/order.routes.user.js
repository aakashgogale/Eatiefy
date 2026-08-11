import express from 'express';
import {
    calculateOrderController,
    createOrderController,
    verifyPaymentController,
    abandonOnlinePaymentController,
    listOrdersUserController,
    getOrderPaymentsUserController,
    getOrderByIdUserController,
    cancelOrderController,
    submitOrderRatingsController,
    getOrderDropOtpUserController,
    updateOrderInstructionsController
} from '../controllers/order.controller.js';
import { idempotencyMiddleware } from '../../../../middleware/idempotency.js';

const router = express.Router();

router.post('/calculate', calculateOrderController);
// Idempotency-Key is always required for order create (prevents duplicate successful orders).
router.post('/', idempotencyMiddleware({ ttlSeconds: 24 * 60 * 60, required: true }), createOrderController);
router.post('/verify-payment', idempotencyMiddleware({ ttlSeconds: 24 * 60 * 60, required: true }), verifyPaymentController);
router.delete('/:orderId/pending-payment', abandonOnlinePaymentController);
router.get('/', listOrdersUserController);
router.get('/:orderId/payments', getOrderPaymentsUserController);
router.get('/:orderId/drop-otp', getOrderDropOtpUserController);
router.get('/:orderId', getOrderByIdUserController);
router.patch('/:orderId/cancel', cancelOrderController);
router.patch('/:orderId/ratings', submitOrderRatingsController);
router.patch('/:orderId/instructions', updateOrderInstructionsController);

export default router;
