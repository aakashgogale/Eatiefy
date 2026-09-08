import mongoose from 'mongoose';
import { registerDeliveryPartner, updateDeliveryPartnerProfile, updateDeliveryPartnerBankDetails, listSupportTicketsByPartner, createSupportTicket, getSupportTicketByIdAndPartner, updateDeliveryPartnerDetails, updateDeliveryPartnerProfilePhotoBase64, updateDeliveryAvailability, getDeliveryPartnerWallet, getDeliveryPartnerEarnings, getDeliveryPartnerTripHistory, getDeliveryPocketDetails, getActiveEarningAddonsForPartner, getDeliveryPartnerReviews } from '../services/delivery.service.js';
import { createDeliveryCashDepositOrder, getDeliveryPartnerWalletEnhanced, requestDeliveryWithdrawal, verifyDeliveryCashDepositPayment, submitCashDepositByHand } from '../services/deliveryFinance.service.js';
import { getDeliveryCashLimitSettings, getDeliveryEmergencyHelp } from '../../admin/services/admin.service.js';
import { DeliveryBonusTransaction } from '../../admin/models/deliveryBonusTransaction.model.js';
import { FoodDeliveryWithdrawal } from '../models/foodDeliveryWithdrawal.model.js';
import { FoodDeliveryCashDeposit } from '../models/foodDeliveryCashDeposit.model.js';
import { validateDeliveryRegisterDto, validateDeliveryProfileUpdateDto, validateDeliveryBankDetailsDto } from '../validators/delivery.validator.js';
import { sendResponse } from '../../../../utils/response.js';
import { getDeliveryReferralStats } from '../services/deliveryReferral.service.js';

export const registerDeliveryPartnerController = async (req, res, next) => {
    try {
        const validated = validateDeliveryRegisterDto(req.body);
        const partner = await registerDeliveryPartner(validated, req.files);
        return sendResponse(res, 201, 'Delivery partner registered successfully', partner);
    } catch (error) {
        next(error);
    }
};

export const updateDeliveryPartnerProfileController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const validated = validateDeliveryProfileUpdateDto(req.body);
        const result = await updateDeliveryPartnerProfile(userId, validated, req.files);
        return sendResponse(res, 200, 'Profile updated successfully', result);
    } catch (error) {
        next(error);
    }
};

export const updateDeliveryPartnerDetailsController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const partner = await updateDeliveryPartnerDetails(userId, req.body || {});
        return sendResponse(res, 200, 'Profile updated successfully', { partner });
    } catch (error) {
        next(error);
    }
};

export const updateDeliveryPartnerProfilePhotoBase64Controller = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const partner = await updateDeliveryPartnerProfilePhotoBase64(userId, req.body || {});
        return sendResponse(res, 200, 'Profile photo updated successfully', { partner });
    } catch (error) {
        next(error);
    }
};

export const updateDeliveryPartnerBankDetailsController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const validated = validateDeliveryBankDetailsDto(req.body);
        const partner = await updateDeliveryPartnerBankDetails(userId, validated, req.files);
        const data = {
            bankDetails: {
                accountHolderName: partner.bankAccountHolderName,
                accountNumber: partner.bankAccountNumber,
                ifscCode: partner.bankIfscCode,
                bankName: partner.bankName,
                upiId: partner.upiId,
                upiQrCode: partner.upiQrCode
            },
            panNumber: partner.panNumber
        };
        return sendResponse(res, 200, 'Bank details updated successfully', data);
    } catch (error) {
        next(error);
    }
};

export const listSupportTicketsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const tickets = await listSupportTicketsByPartner(deliveryPartnerId);
        return sendResponse(res, 200, 'Tickets fetched successfully', { tickets });
    } catch (error) {
        next(error);
    }
};

export const createSupportTicketController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const ticket = await createSupportTicket(deliveryPartnerId, req.body);
        return sendResponse(res, 201, 'Ticket created successfully', ticket);
    } catch (error) {
        next(error);
    }
};

export const getSupportTicketByIdController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const ticket = await getSupportTicketByIdAndPartner(req.params.id, deliveryPartnerId);
        if (!ticket) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }
        return sendResponse(res, 200, 'Ticket fetched successfully', ticket);
    } catch (error) {
        next(error);
    }
};

export const updateAvailabilityController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const data = await updateDeliveryAvailability(userId, req.body || {});
        return sendResponse(res, 200, 'Availability updated successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getWalletController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const requestedTypeRaw = String(req.query?.type || '').trim().toLowerCase();
        const rawLimit = Number.parseInt(String(req.query?.limit || ''), 10);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

        const normalizeWalletTransaction = (tx) => ({
            ...tx,
            id: tx?.id || tx?._id,
            _id: tx?._id || tx?.id,
            amount: Number(tx?.amount) || 0,
            date: tx?.date || tx?.createdAt,
            createdAt: tx?.createdAt || tx?.date
        });

        if (
            requestedTypeRaw === 'bonus' ||
            requestedTypeRaw === 'deposit' ||
            requestedTypeRaw === 'deduction' ||
            requestedTypeRaw === 'withdrawal' ||
            requestedTypeRaw === 'payment'
        ) {
            if (!deliveryPartnerId || !mongoose.Types.ObjectId.isValid(deliveryPartnerId)) {
                return sendResponse(res, 200, 'Wallet fetched successfully', { wallet: { transactions: [] } });
            }

            const wallet = await getDeliveryPartnerWalletEnhanced(deliveryPartnerId);
            if (requestedTypeRaw === 'bonus') {
                const bonusList = await DeliveryBonusTransaction.find({ deliveryPartnerId })
                    .sort({ createdAt: -1 })
                    .limit(limit)
                    .lean();

                wallet.transactions = (bonusList || []).map((b) => ({
                    id: b._id,
                    _id: b._id,
                    type: 'bonus',
                    amount: b.amount || 0,
                    status: 'Completed',
                    date: b.createdAt,
                    createdAt: b.createdAt,
                    description: b.reference || 'Bonus',
                    transactionId: b.transactionId
                }));
            } else {
                const allowedTypes =
                    requestedTypeRaw === 'deposit'
                        ? new Set(['deposit'])
                        : requestedTypeRaw === 'deduction'
                          ? new Set(['withdrawal', 'deposit'])
                          : new Set([requestedTypeRaw]);

                // Withdrawals and deposits are read straight from their own
                // collections. Filtering the wallet's merged feed instead meant
                // the type filter ran *after* that feed had already been cut to
                // its newest 50 rows across every type — so a payout could be
                // pushed out by delivery earnings and vanish from history.
                const directRows = [];

                if (allowedTypes.has('withdrawal')) {
                    const withdrawals = await FoodDeliveryWithdrawal.find({ deliveryPartnerId })
                        .sort({ createdAt: -1 })
                        .limit(limit)
                        .lean();
                    directRows.push(
                        ...(withdrawals || []).map((w) => ({
                            id: w._id,
                            _id: w._id,
                            type: 'withdrawal',
                            amount: w.amount,
                            status:
                                w.status === 'pending'
                                    ? 'Pending'
                                    : w.status === 'approved'
                                      ? 'Completed'
                                      : 'Rejected',
                            date: w.createdAt,
                            createdAt: w.createdAt,
                            processedAt: w.processedAt || null,
                            failureReason: w.rejectionReason || null,
                            transactionId: w.transactionId || null,
                            description: `Withdrawal Request - ${w.paymentMethod}`,
                            payoutMethod: w.paymentMethod
                        }))
                    );
                }

                if (allowedTypes.has('deposit')) {
                    const deposits = await FoodDeliveryCashDeposit.find({ deliveryPartnerId })
                        .sort({ createdAt: -1 })
                        .limit(limit)
                        .lean();
                    directRows.push(
                        ...(deposits || []).map((d) => ({
                            id: d._id,
                            _id: d._id,
                            type: 'deposit',
                            amount: d.amount,
                            status: d.status || 'Pending',
                            date: d.createdAt,
                            createdAt: d.createdAt,
                            description: 'Cash limit settlement',
                            paymentMethod: d.paymentMethod || 'cash',
                            razorpayPaymentId: d.razorpayPaymentId || '',
                            razorpayOrderId: d.razorpayOrderId || ''
                        }))
                    );
                }

                if (directRows.length || allowedTypes.has('withdrawal') || allowedTypes.has('deposit')) {
                    wallet.transactions = directRows
                        .map(normalizeWalletTransaction)
                        .sort((a, b) => new Date(b.date) - new Date(a.date))
                        .slice(0, limit);
                } else {
                    wallet.transactions = (wallet.transactions || [])
                        .filter((tx) => allowedTypes.has(String(tx?.type || '').trim().toLowerCase()))
                        .map(normalizeWalletTransaction)
                        .slice(0, limit);
                }
            }

            return sendResponse(res, 200, 'Wallet fetched successfully', { wallet });
        }

        const wallet = await getDeliveryPartnerWalletEnhanced(deliveryPartnerId);
        return sendResponse(res, 200, 'Wallet fetched successfully', { wallet });
    } catch (error) {
        next(error);
    }
};

export const createWithdrawalRequestController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const result = await requestDeliveryWithdrawal(deliveryPartnerId, req.body || {});
        return sendResponse(res, 201, 'Withdrawal request submitted successfully', { withdrawal: result });
    } catch (error) {
        next(error);
    }
};

export const getEarningsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await getDeliveryPartnerEarnings(deliveryPartnerId, req.query || {});
        return sendResponse(res, 200, 'Earnings fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getActiveEarningAddonsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await getActiveEarningAddonsForPartner(deliveryPartnerId);
        return sendResponse(res, 200, 'Active earning addons fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const createCashDepositOrderController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const amount = req.body?.amount;
        const data = await createDeliveryCashDepositOrder(deliveryPartnerId, amount);
        return sendResponse(res, 201, 'Cash deposit order created successfully', data);
    } catch (error) {
        next(error);
    }
};

export const verifyCashDepositPaymentController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await verifyDeliveryCashDepositPayment(deliveryPartnerId, {
            razorpayOrderId: req.body?.razorpay_order_id,
            razorpayPaymentId: req.body?.razorpay_payment_id,
            razorpaySignature: req.body?.razorpay_signature,
            amount: req.body?.amount
        });
        return sendResponse(res, 200, 'Cash deposit verified successfully', data);
    } catch (error) {
        next(error);
    }
};

export const submitCashDepositByHandController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const amount = req.body?.amount;
        const data = await submitCashDepositByHand(deliveryPartnerId, amount);
        return sendResponse(res, 201, 'Cash submitted successfully. Waiting for admin confirmation.', data);
    } catch (error) {
        next(error);
    }
};

export const getTripHistoryController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await getDeliveryPartnerTripHistory(deliveryPartnerId, req.query || {});
        return sendResponse(res, 200, 'Trip history fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getPocketDetailsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await getDeliveryPocketDetails(deliveryPartnerId, req.query || {});
        return sendResponse(res, 200, 'Pocket details fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getMyReviewsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const data = await getDeliveryPartnerReviews(deliveryPartnerId, req.query || {});
        return sendResponse(res, 200, 'Reviews fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getEmergencyHelpController = async (req, res, next) => {
    try {
        const data = await getDeliveryEmergencyHelp();
        return sendResponse(res, 200, 'Emergency help fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getCashLimitController = async (req, res, next) => {
    try {
        const data = await getDeliveryCashLimitSettings();
        return sendResponse(res, 200, 'Cash limit fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getDeliveryReferralStatsController = async (req, res, next) => {
    try {
        const deliveryPartnerId = req.user?.userId;
        const stats = await getDeliveryReferralStats(deliveryPartnerId);
        return sendResponse(res, 200, 'Referral stats fetched successfully', { stats });
    } catch (error) {
        next(error);
    }
};

