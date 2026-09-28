/**
 * Who the restaurant order ringtone may ring for.
 *
 * Holds the restaurant this device is signed in to, as confirmed by the server
 * (current-restaurant API, approved account). Both ring paths - the socket
 * `new_order` event and the `new_order` push - check an order against it, so an
 * event for another restaurant (a device token still tied to an old account, a
 * rider push on a shared device) can never ring here. Empty until confirmed:
 * nothing rings before the signed-in account is known.
 */

/** Backend order statuses in which the restaurant still has to accept or reject. */
export const RESTAURANT_DECIDABLE_STATUSES = new Set(['created', 'pending', 'new']);

let activeRestaurantIds = new Set();

const toId = (value) => {
  if (value == null) return '';
  if (typeof value === 'object') {
    return value._id != null || value.id != null ? toId(value._id ?? value.id) : '';
  }
  return String(value).trim();
};

export const setActiveRestaurant = (restaurant) => {
  activeRestaurantIds = new Set(
    [restaurant?._id, restaurant?.id, restaurant?.restaurantId].map(toId).filter(Boolean),
  );
};

export const clearActiveRestaurant = () => {
  activeRestaurantIds = new Set();
};

export const hasActiveRestaurant = () => activeRestaurantIds.size > 0;

/** True when the restaurant reference (id or populated doc) is the signed-in restaurant. */
export const isForActiveRestaurant = (restaurantRef) => {
  const id = toId(restaurantRef);
  return Boolean(id) && activeRestaurantIds.has(id);
};

const PLACEHOLDER_ORDER_IDS = new Set(['new', 'undefined', 'null', 'nan', '0']);

/** A real order id - not empty and not a placeholder such as "New". */
export const isRealOrderId = (value) => {
  const id = String(value ?? '').trim();
  return id.length > 0 && !PLACEHOLDER_ORDER_IDS.has(id.toLowerCase());
};

/*
 * Orders the restaurant has already accepted or rejected (or that are gone).
 * A push is often delivered after the socket event - sometimes after the
 * order was already accepted - and its status field is the one at send time,
 * so on its own it rang the full ringtone again for a handled order.
 */
const HANDLED_KEY = 'restaurant_handled_order_ids';
const HANDLED_TTL_MS = 2 * 60 * 60 * 1000;

const readHandled = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HANDLED_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const markRestaurantOrdersHandled = (ids = []) => {
  const list = (Array.isArray(ids) ? ids : [ids]).map(toId).filter(isRealOrderId);
  if (!list.length) return;
  try {
    const now = Date.now();
    const handled = readHandled();
    Object.keys(handled).forEach((id) => {
      if (now - Number(handled[id]) > HANDLED_TTL_MS) delete handled[id];
    });
    list.forEach((id) => {
      handled[id] = now;
    });
    localStorage.setItem(HANDLED_KEY, JSON.stringify(handled));
  } catch {
    /* storage unavailable */
  }
};

const isRestaurantOrderHandled = (...ids) => {
  const handled = readHandled();
  const now = Date.now();
  return ids.map(toId).some((id) => id && handled[id] && now - Number(handled[id]) <= HANDLED_TTL_MS);
};

/**
 * Why a restaurant new-order push must not ring, or '' when it may - the same
 * rules as the socket path: a real order id, addressed to the signed-in
 * restaurant, still new. Riders' pushes also use type "new_order", and a device
 * token can still be tied to another account, so the type alone proves nothing.
 */
export const getRestaurantPushRingRefusal = (data = {}) => {
  const type = String(data?.type || data?.notificationType || '').toLowerCase();
  if (type !== 'new_order') return 'not a restaurant new-order push';
  if (!isRealOrderId(data.orderMongoId || data.orderId)) return 'no valid order id';
  if (!hasActiveRestaurant()) return 'signed-in restaurant not verified yet';
  if (!isForActiveRestaurant(data.restaurantId)) return 'order is not for the signed-in restaurant';
  const status = String(data.orderStatus || '').toLowerCase().trim();
  if (!RESTAURANT_DECIDABLE_STATUSES.has(status)) return `order status "${status || 'missing'}" is not new`;
  if (isRestaurantOrderHandled(data.orderMongoId, data.orderId)) return 'order already accepted or rejected';
  return '';
};

const loggedRefusals = new Set();

/**
 * Logs why a ring was refused - once per order and reason, so a list that
 * re-renders cannot flood the console. Refusals are never silent.
 */
export const logRefusedRing = (source, reason, details = {}) => {
  const key = `${source}|${reason}|${details?.orderId || ''}`;
  if (loggedRefusals.has(key)) return;
  loggedRefusals.add(key);
  if (loggedRefusals.size > 500) loggedRefusals.clear();
  console.warn(`[RestaurantAlert] Ring refused (${source}): ${reason}`, details);
};
