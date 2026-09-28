import express from 'express';
import mongoose from 'mongoose';
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
import { requireRoles } from '../roles/role.middleware.js';
import { sendError } from '../../utils/response.js';
import { FoodOrder } from '../../modules/food/orders/models/order.model.js';

/*
 * This router is mounted behind authMiddleware only, so every role guard lives
 * here. Without them any signed-in customer could read the platform finance
 * summary, read any restaurant's or rider's wallet by id, and create and
 * process settlements.
 */
const router = express.Router();

const isAdminRole = (role) => ['ADMIN', 'SUB_ADMIN'].includes(String(role || '').toUpperCase());

/** Order payment trails: admins, or the customer who placed the order. */
const requireOrderOwnerOrAdmin = async (req, res, next) => {
    try {
        if (isAdminRole(req.user?.role)) return next();
        if (String(req.user?.role || '').toUpperCase() !== 'USER') {
            return sendError(res, 403, 'Forbidden: insufficient permissions');
        }
        const { orderId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(orderId)) {
            return sendError(res, 400, 'Invalid order id');
        }
        const owned = await FoodOrder.exists({
            _id: new mongoose.Types.ObjectId(orderId),
            userId: new mongoose.Types.ObjectId(req.user.userId)
        });
        if (!owned) return sendError(res, 404, 'Order not found');
        return next();
    } catch (err) {
        return next(err);
    }
};

/** Wallet reads by id: admins, or the owner of that id. */
const requireSelfOrAdmin = (ownerRole, param) => (req, res, next) => {
    const role = String(req.user?.role || '').toUpperCase();
    if (isAdminRole(role)) return next();
    if (role === ownerRole && String(req.user?.userId) === String(req.params[param])) return next();
    return sendError(res, 403, 'Forbidden: insufficient permissions');
};

const adminOnly = requireRoles('ADMIN');
const adminOrSubAdmin = requireRoles('ADMIN', 'SUB_ADMIN');

// ─── Payment history for an order (user sees their payment trail) ───
router.get('/orders/:orderId/payments', requireOrderOwnerOrAdmin, getPaymentHistoryController);
router.get('/orders/:orderId/transactions', requireOrderOwnerOrAdmin, getOrderTransactionsController);
router.get('/orders/:orderId/refunds', requireOrderOwnerOrAdmin, getRefundsByOrderController);

// ─── User wallet (new transaction-based endpoints) ───
router.get('/wallet/balance', requireRoles('USER'), getUserWalletBalanceController);
router.get('/wallet/transactions', requireRoles('USER'), getUserWalletTransactionsController);

// ─── Restaurant wallet ───
router.get('/restaurant/:restaurantId/wallet', requireSelfOrAdmin('RESTAURANT', 'restaurantId'), getRestaurantWalletController);

// ─── Delivery partner wallet ───
router.get('/delivery/:deliveryPartnerId/wallet', requireSelfOrAdmin('DELIVERY_PARTNER', 'deliveryPartnerId'), getDeliveryWalletController);

// ─── Admin / Finance ───
router.get('/admin/wallet', adminOrSubAdmin, getAdminWalletController);
router.get('/admin/finance/summary', adminOrSubAdmin, getAdminFinanceSummaryController);
router.get('/admin/settlements', adminOrSubAdmin, listSettlementsController);
router.post('/admin/settlements', adminOnly, createSettlementController);
router.post('/admin/settlements/:id/process', adminOnly, processSettlementController);
router.get('/admin/refunds', adminOrSubAdmin, listRefundsController);

export default router;
