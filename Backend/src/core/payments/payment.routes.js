import express from 'express';
import { requireRoles } from '../roles/role.middleware.js';
import {
    getPaymentHistoryController,
    getOrderTransactionsController,
    getUserWalletBalanceController,
    getUserWalletTransactionsController,
    getRestaurantWalletController,
    getDeliveryWalletController,
    getAdminWalletController,
    getAdminFinanceSummaryController,
    listSettlementsController,
    createSettlementController,
    processSettlementController,
    listRefundsController,
    getRefundsByOrderController
} from './payment.controller.js';

const router = express.Router();

// ─── Payment history for an order (user / restaurant / admin) ───
router.get(
    '/orders/:orderId/payments',
    requireRoles('USER', 'RESTAURANT', 'ADMIN'),
    getPaymentHistoryController
);
router.get(
    '/orders/:orderId/transactions',
    requireRoles('USER', 'RESTAURANT', 'ADMIN'),
    getOrderTransactionsController
);
router.get(
    '/orders/:orderId/refunds',
    requireRoles('USER', 'RESTAURANT', 'ADMIN'),
    getRefundsByOrderController
);

// ─── User wallet ───
router.get('/wallet/balance', requireRoles('USER'), getUserWalletBalanceController);
router.get('/wallet/transactions', requireRoles('USER'), getUserWalletTransactionsController);

// ─── Restaurant wallet (own wallet only — controller enforces ownership) ───
router.get(
    '/restaurant/:restaurantId/wallet',
    requireRoles('RESTAURANT', 'ADMIN'),
    getRestaurantWalletController
);

// ─── Delivery partner wallet ───
router.get(
    '/delivery/:deliveryPartnerId/wallet',
    requireRoles('DELIVERY_PARTNER', 'ADMIN'),
    getDeliveryWalletController
);

// ─── Admin / Finance ───
router.get('/admin/wallet', requireRoles('ADMIN'), getAdminWalletController);
router.get('/admin/finance/summary', requireRoles('ADMIN'), getAdminFinanceSummaryController);
router.get('/admin/settlements', requireRoles('ADMIN'), listSettlementsController);
router.post('/admin/settlements', requireRoles('ADMIN'), createSettlementController);
router.post('/admin/settlements/:id/process', requireRoles('ADMIN'), processSettlementController);
router.get('/admin/refunds', requireRoles('ADMIN'), listRefundsController);

export default router;
