/**
 * Food order payment state machine.
 * Client-reported payment status is never trusted — only server transitions.
 */

export const PAYMENT_STATUSES = Object.freeze({
    CREATED: 'created',
    PENDING: 'pending',
    PAID: 'paid',
    FAILED: 'failed',
    REFUNDED: 'refunded',
    COD_PENDING: 'cod_pending',
});

export const ORDER_PAYMENT_STATUSES = Object.freeze({
    PENDING_PAYMENT: 'pending_payment',
    CREATED: 'created',
});

/** Allowed payment.status transitions (from → Set(to)) */
const PAYMENT_TRANSITIONS = {
    [PAYMENT_STATUSES.CREATED]: new Set([
        PAYMENT_STATUSES.PENDING,
        PAYMENT_STATUSES.PAID,
        PAYMENT_STATUSES.FAILED,
    ]),
    [PAYMENT_STATUSES.PENDING]: new Set([
        PAYMENT_STATUSES.PAID,
        PAYMENT_STATUSES.FAILED,
    ]),
    [PAYMENT_STATUSES.FAILED]: new Set([
        PAYMENT_STATUSES.PAID, // late webhook after timeout path
        PAYMENT_STATUSES.FAILED,
    ]),
    [PAYMENT_STATUSES.COD_PENDING]: new Set([
        PAYMENT_STATUSES.PAID,
        PAYMENT_STATUSES.FAILED,
    ]),
    [PAYMENT_STATUSES.PAID]: new Set([
        PAYMENT_STATUSES.REFUNDED,
    ]),
    [PAYMENT_STATUSES.REFUNDED]: new Set([]),
};

export function canTransitionPayment(from, to) {
    const f = String(from || '').toLowerCase();
    const t = String(to || '').toLowerCase();
    if (f === t) return true;
    const allowed = PAYMENT_TRANSITIONS[f];
    return Boolean(allowed && allowed.has(t));
}

/**
 * Mongo filter fragment for activating an online order to paid+created.
 * Rejects already-paid and terminal refunded states.
 */
export function onlinePaymentActivationFilter(extra = {}) {
    return {
        ...extra,
        orderStatus: 'pending_payment',
        'payment.status': { $in: ['created', 'pending', 'failed'] },
    };
}

/**
 * Mongo filter for marking payment failed without activating the order.
 */
export function onlinePaymentFailureFilter(extra = {}) {
    return {
        ...extra,
        orderStatus: 'pending_payment',
        'payment.status': { $in: ['created', 'pending'] },
    };
}
