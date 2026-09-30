/**
 * Which delivery offers a `new_order` push may still ring for.
 *
 * A push is often delivered a few seconds after the socket event, and its
 * payload is frozen at send time. A rider who accepted or passed quickly then
 * heard the push play the full ringtone for an offer that was already handled,
 * so the sound seemed to carry on after the accept. The delivery app records
 * every offer it has finished with here, and the push path checks it before
 * ringing - the rider-side counterpart of restaurantAlertSession.
 */

const HANDLED_KEY = 'delivery_handled_offer_ids';

/** Longer than any offer window (the backend caps offers at ten minutes). */
export const DELIVERY_HANDLED_OFFER_TTL_MS = 15 * 60 * 1000;

const toId = (value) => String(value ?? '').trim();

const readHandled = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HANDLED_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

/** Records offers the rider accepted, passed, or lost to another rider or to expiry. */
export const markDeliveryOffersHandled = (ids = []) => {
  const list = (Array.isArray(ids) ? ids : [ids]).map(toId).filter(Boolean);
  if (!list.length) return;
  try {
    const now = Date.now();
    const handled = readHandled();
    Object.keys(handled).forEach((id) => {
      if (now - Number(handled[id]) > DELIVERY_HANDLED_OFFER_TTL_MS) delete handled[id];
    });
    list.forEach((id) => {
      handled[id] = now;
    });
    localStorage.setItem(HANDLED_KEY, JSON.stringify(handled));
  } catch {
    /* storage unavailable */
  }
};

/** Forgets every handled offer: the next rider on this device starts clean. */
export const clearDeliveryHandledOffers = () => {
  try {
    localStorage.removeItem(HANDLED_KEY);
  } catch {
    /* storage unavailable */
  }
};

const isDeliveryOfferHandled = (...ids) => {
  const handled = readHandled();
  const now = Date.now();
  return ids
    .map(toId)
    .some((id) => id && handled[id] && now - Number(handled[id]) <= DELIVERY_HANDLED_OFFER_TTL_MS);
};

/**
 * Why a delivery new-order push must not ring, or '' when it may. Same rules as
 * the in-app offer card: its server-issued window must still be open, and the
 * rider must not have dealt with it already.
 */
export const getDeliveryPushRingRefusal = (data = {}) => {
  const expiresAtMs = new Date(data?.expiresAt || data?.offerExpiresAt || 0).getTime();
  if (Number.isFinite(expiresAtMs) && expiresAtMs > 0 && expiresAtMs <= Date.now()) {
    return 'offer already expired';
  }
  if (isDeliveryOfferHandled(data?.orderMongoId, data?.orderId, data?.order_id, data?._id)) {
    return 'offer already accepted, passed or taken';
  }
  return '';
};
