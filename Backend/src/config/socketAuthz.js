/**
 * Pure authorization helper for delivery location updates (unit-testable).
 */
export function canDeliveryPartnerUpdateOrderLocation({
    role,
    partnerId,
    orderDispatchPartnerId,
    dispatchStatus,
}) {
    if (role !== 'DELIVERY_PARTNER') return false;
    if (!partnerId || !orderDispatchPartnerId) return false;
    if (String(dispatchStatus || '') !== 'accepted') return false;
    return String(partnerId) === String(orderDispatchPartnerId);
}
