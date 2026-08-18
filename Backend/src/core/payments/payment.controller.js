import { sendResponse, sendError } from '../../utils/response.js';
import { getPaymentsByOrder } from './payment.service.js';
import { getTransactionsByOrder } from './transaction.service.js';
import { getWalletBalance, getWalletWithTransactions, getUserWalletForFrontend } from './wallet.service.js';
import { getRefundsByOrder, listRefunds } from './refund.service.js';
import { createSettlement, processSettlement, listSettlements } from './settlement.service.js';
import { logger } from '../../utils/logger.js';

// ─── User Endpoints ───

export const getPaymentHistoryController = async (req, res, next) => {
    try {
        const { orderId } = req.params;
        // Ownership enforced below via order lookup when non-admin
        const role = String(req.user?.role || '').toUpperCase();
        if (role !== 'ADMIN') {
            const { FoodOrder } = await import('../../modules/food/orders/models/order.model.js');
            const order = await FoodOrder.findById(orderId).select('userId restaurantId').lean();
            if (!order) return sendError(res, 404, 'Order not found');
            const uid = String(req.user?.userId || '');
            if (role === 'USER' && String(order.userId) !== uid) {
                return sendError(res, 403, 'Forbidden');
            }
            if (role === 'RESTAURANT' && String(order.restaurantId) !== uid) {
                return sendError(res, 403, 'Forbidden');
            }
        }
        const payments = await getPaymentsByOrder(orderId);
        return sendResponse(res, 200, 'Payment history fetched', { payments });
    } catch (err) {
        next(err);
    }
};

export const getOrderTransactionsController = async (req, res, next) => {
    try {
        const { orderId } = req.params;
        const role = String(req.user?.role || '').toUpperCase();
        if (role !== 'ADMIN') {
            const { FoodOrder } = await import('../../modules/food/orders/models/order.model.js');
            const order = await FoodOrder.findById(orderId).select('userId restaurantId').lean();
            if (!order) return sendError(res, 404, 'Order not found');
            const uid = String(req.user?.userId || '');
            if (role === 'USER' && String(order.userId) !== uid) return sendError(res, 403, 'Forbidden');
            if (role === 'RESTAURANT' && String(order.restaurantId) !== uid) return sendError(res, 403, 'Forbidden');
        }
        const transactions = await getTransactionsByOrder(orderId);
        return sendResponse(res, 200, 'Transactions fetched', { transactions });
    } catch (err) {
        next(err);
    }
};

export const getUserWalletBalanceController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const data = await getWalletBalance('user', userId);
        return sendResponse(res, 200, 'Balance fetched', data);
    } catch (err) {
        next(err);
    }
};

export const getUserWalletTransactionsController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const data = await getWalletWithTransactions('user', userId, { page, limit });
        return sendResponse(res, 200, 'Wallet transactions fetched', data);
    } catch (err) {
        next(err);
    }
};

// ─── Restaurant Endpoints ───

export const getRestaurantWalletController = async (req, res, next) => {
    try {
        const role = String(req.user?.role || '').toUpperCase();
        const authedId = String(req.user?.userId || '');
        const paramId = String(req.params.restaurantId || '');
        if (role !== 'ADMIN' && authedId !== paramId) {
            return sendError(res, 403, 'Forbidden: cannot access another restaurant wallet');
        }
        const restaurantId = role === 'ADMIN' ? paramId : authedId;
        const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 10000);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const data = await getWalletWithTransactions('restaurant', restaurantId, { page, limit });
        return sendResponse(res, 200, 'Restaurant wallet fetched', data);
    } catch (err) {
        next(err);
    }
};

// ─── Delivery Partner Endpoints ───

export const getDeliveryWalletController = async (req, res, next) => {
    try {
        const role = String(req.user?.role || '').toUpperCase();
        const authedId = String(req.user?.userId || '');
        const paramId = String(req.params.deliveryPartnerId || '');
        if (role !== 'ADMIN' && authedId !== paramId) {
            return sendError(res, 403, 'Forbidden: cannot access another delivery wallet');
        }
        const deliveryPartnerId = role === 'ADMIN' ? paramId : authedId;
        const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 10000);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
        const data = await getWalletWithTransactions('deliveryBoy', deliveryPartnerId, { page, limit });
        return sendResponse(res, 200, 'Delivery wallet fetched', data);
    } catch (err) {
        next(err);
    }
};

// ─── Admin Endpoints ───

export const getAdminWalletController = async (req, res, next) => {
    try {
        const data = await getWalletBalance('admin', 'platform');
        return sendResponse(res, 200, 'Admin wallet fetched', data);
    } catch (err) {
        next(err);
    }
};

export const getAdminFinanceSummaryController = async (req, res, next) => {
    try {
        const { FoodAdminWallet } = await import('../../modules/food/admin/models/adminWallet.model.js');
        const adminWallet = await FoodAdminWallet.findOne({ key: 'platform' }).lean();
        const pendingSettlements = await listSettlements({ status: 'pending', limit: 100 });
        const pendingRefunds = await listRefunds({ status: 'pending', limit: 100 });

        return sendResponse(res, 200, 'Finance summary', {
            platform: {
                balance: adminWallet?.balance || 0,
                totalRevenue: adminWallet?.totalRevenue || 0,
                totalPayouts: adminWallet?.totalPayouts || 0,
                totalRefunds: adminWallet?.totalRefunds || 0
            },
            pendingSettlements: {
                count: pendingSettlements.total,
                totalAmount: pendingSettlements.settlements.reduce((s, v) => s + (v.amount || 0), 0)
            },
            pendingRefunds: {
                count: pendingRefunds.total,
                totalAmount: pendingRefunds.refunds.reduce((s, v) => s + (v.amount || 0), 0)
            }
        });
    } catch (err) {
        next(err);
    }
};

export const listSettlementsController = async (req, res, next) => {
    try {
        const { entityType, entityId, status } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const data = await listSettlements({ entityType, entityId, status, page, limit });
        return sendResponse(res, 200, 'Settlements fetched', data);
    } catch (err) {
        next(err);
    }
};

export const createSettlementController = async (req, res, next) => {
    try {
        const { entityType, entityId, amount, notes, periodStart, periodEnd } = req.body;
        const settlement = await createSettlement({ entityType, entityId, amount, notes, periodStart, periodEnd });
        return sendResponse(res, 201, 'Settlement created', { settlement });
    } catch (err) {
        next(err);
    }
};

export const processSettlementController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const adminId = req.user?.userId;
        const { payoutRef } = req.body;
        const settlement = await processSettlement(id, { processedBy: adminId, payoutRef });
        return sendResponse(res, 200, 'Settlement processed', { settlement });
    } catch (err) {
        next(err);
    }
};

export const listRefundsController = async (req, res, next) => {
    try {
        const { status } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const data = await listRefunds({ status, page, limit });
        return sendResponse(res, 200, 'Refunds fetched', data);
    } catch (err) {
        next(err);
    }
};

export const getRefundsByOrderController = async (req, res, next) => {
    try {
        const { orderId } = req.params;
        const role = String(req.user?.role || '').toUpperCase();
        if (role !== 'ADMIN') {
            const { FoodOrder } = await import('../../modules/food/orders/models/order.model.js');
            const order = await FoodOrder.findById(orderId).select('userId restaurantId').lean();
            if (!order) return sendError(res, 404, 'Order not found');
            const uid = String(req.user?.userId || '');
            if (role === 'USER' && String(order.userId) !== uid) return sendError(res, 403, 'Forbidden');
            if (role === 'RESTAURANT' && String(order.restaurantId) !== uid) return sendError(res, 403, 'Forbidden');
        }
        const refunds = await getRefundsByOrder(orderId);
        return sendResponse(res, 200, 'Refunds fetched', { refunds });
    } catch (err) {
        next(err);
    }
};
