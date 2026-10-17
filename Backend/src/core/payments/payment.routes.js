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
import { sendResponse, sendError } from '../../utils/response.js';
import { logger } from '../../utils/logger.js';
import { FoodOrder } from '../../modules/food/orders/models/order.model.js';
import { FoodTransaction } from '../../modules/food/orders/models/foodTransaction.model.js';
import * as foodTransactionService from '../../modules/food/orders/services/foodTransaction.service.js';
import {
    createRazorpayQrCode,
    fetchRazorpayQrCodePayments
} from '../../modules/food/orders/helpers/razorpay.helper.js';

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

// ─── Razorpay Dynamic Single-Use UPI QR Endpoints ───

/**
 * POST /v1/food/payments/qr/create
 * Create a single-use dynamic UPI QR code with exact payment amount in paise & notes
 */
router.post('/qr/create', async (req, res, next) => {
    try {
        const { amount, amountPaise, orderId, name, description, notes = {} } = req.body || {};
        const totalPaise = Number.isFinite(Number(amountPaise)) && Number(amountPaise) > 0
            ? Math.round(Number(amountPaise))
            : Math.round(Number(amount || 0) * 100);

        if (!totalPaise || totalPaise < 100) {
            return sendError(res, 400, 'Valid payment amount is required (minimum ₹1.00)');
        }

        const foodOrderId = orderId ? String(orderId) : (notes.foodOrderId ? String(notes.foodOrderId) : '');
        const rzQr = await createRazorpayQrCode({
            amountPaise: totalPaise,
            name: name || (foodOrderId ? `Order #${foodOrderId.slice(-6)}` : 'Payment'),
            description: description || `Payment for order ${foodOrderId}`,
            notes: {
                ...(notes || {}),
                ...(foodOrderId ? { foodOrderId } : {}),
            },
        });

        const directImageUrl = rzQr.image_url || rzQr.imageUrl || rzQr.image;

        return sendResponse(res, 201, 'Dynamic UPI QR Code created successfully', {
            qrCodeId: rzQr.id,
            imageUrl: directImageUrl,
            shortUrl: rzQr.short_url || directImageUrl,
            amount: totalPaise / 100,
            amountPaise: totalPaise,
            status: rzQr.status || 'active',
            usage: rzQr.usage || 'single_use',
            type: rzQr.type || 'upi_qr',
            notes: rzQr.notes,
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /v1/food/payments/qr/:qrCodeId/status
 * Check payment status using Razorpay qrCode.fetchAllPayments() to verify captured or authorized
 */
router.get('/qr/:qrCodeId/status', async (req, res, next) => {
    try {
        const { qrCodeId } = req.params;
        if (!qrCodeId) {
            return sendError(res, 400, 'qrCodeId is required');
        }

        const resList = await fetchRazorpayQrCodePayments(qrCodeId);
        const items = Array.isArray(resList?.items) ? resList.items : Array.isArray(resList) ? resList : [];
        const capturedPayment = items.find((p) =>
            ['captured', 'authorized'].includes(String(p?.status || '').toLowerCase())
        );

        const isPaid = Boolean(capturedPayment);

        // If payment is captured and has associated foodOrderId in notes, update order
        const foodOrderId = capturedPayment?.notes?.foodOrderId;
        if (isPaid && foodOrderId) {
            try {
                const paidAt = new Date();
                await FoodOrder.updateOne(
                    { _id: foodOrderId },
                    {
                        $set: {
                            'payment.status': 'paid',
                            'payment.paidAt': paidAt,
                            'payment.razorpay.paymentId': capturedPayment.id,
                        },
                    }
                );
                await FoodTransaction.updateOne(
                    { orderId: foodOrderId },
                    {
                        $set: {
                            'payment.qr.status': 'paid',
                            'payment.status': 'paid',
                            'payment.paidAt': paidAt,
                            'gateway.razorpayPaymentId': capturedPayment.id,
                        },
                    }
                );
                await foodTransactionService.updateTransactionStatus(
                    foodOrderId,
                    'captured',
                    {
                        status: 'captured',
                        razorpayPaymentId: capturedPayment.id,
                        note: 'Dynamic UPI QR payment verified on Razorpay',
                    }
                );
            } catch (syncErr) {
                logger.warn(`[QrPaymentStatus] Sync error for order ${foodOrderId}: ${syncErr?.message}`);
            }
        }

        return sendResponse(res, 200, 'QR payment status fetched', {
            qrCodeId,
            isPaid,
            status: isPaid ? 'captured' : 'active',
            payment: capturedPayment || null,
            payments: items,
        });
    } catch (err) {
        next(err);
    }
});

export default router;
