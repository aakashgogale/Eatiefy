import express from 'express';
import {
    calculateOrderController,
    initiateOnlinePaymentController,
    createOrderController,
    verifyPaymentController,
    initiatePickupPaymentController,
    verifyPickupPaymentController,
    listOrdersUserController,
    getOrderPaymentsUserController,
    getOrderByIdUserController,
    cancelOrderController,
    submitOrderRatingsController,
    getOrderDropOtpUserController,
    updateOrderInstructionsController
} from '../controllers/order.controller.js';

const router = express.Router();

router.post('/calculate', calculateOrderController);
router.post('/initiate-online-payment', initiateOnlinePaymentController);
router.post('/', createOrderController);
router.post('/verify-payment', verifyPaymentController);
// Pay-at-Pickup: pay an existing unpaid takeaway order on arrival.
router.post('/:orderId/pay-initiate', initiatePickupPaymentController);
router.post('/:orderId/pay-verify', verifyPickupPaymentController);
router.get('/', listOrdersUserController);
router.get('/:orderId/payments', getOrderPaymentsUserController);
router.get('/:orderId/drop-otp', getOrderDropOtpUserController);
router.get('/:orderId', getOrderByIdUserController);
router.patch('/:orderId/cancel', cancelOrderController);
router.patch('/:orderId/ratings', submitOrderRatingsController);
router.patch('/:orderId/instructions', updateOrderInstructionsController);

export default router;
