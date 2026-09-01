/**
 * Length of the customer handover code.
 *
 * Must match `DELIVERY_OTP_LENGTH` in
 * `Backend/src/modules/food/orders/services/order.helpers.js`. These two drifted
 * apart once — the server issued six digits while this app rendered four boxes — and
 * handover became impossible for every order until someone noticed. The server now
 * rejects a wrong-length code with an explicit message rather than reporting it as a
 * wrong guess, so a future mismatch surfaces immediately instead of looking like the
 * customer read their code out incorrectly.
 */
export const DELIVERY_OTP_LENGTH = 4;
