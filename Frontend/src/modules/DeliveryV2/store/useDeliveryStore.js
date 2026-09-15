import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { mapOrderLocations } from '@/modules/DeliveryV2/utils/orderMapping';
import {
  isOrderWithinOfferRange,
  sanitizeOrderDispatchMetrics,
} from '@/modules/DeliveryV2/utils/pickupMetrics';

export const DELIVERY_STORE_BASE_KEY = 'delivery-v2-online-pref';

/** Id of the rider currently logged in on this device, or '' when signed out. */
const currentDeliveryAccountId = () => {
  try {
    const raw = localStorage.getItem('delivery_user');
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return String(
      parsed?.id ||
        parsed?._id ||
        parsed?.userId ||
        parsed?.deliveryId ||
        parsed?.deliveryPartnerId ||
        '',
    );
  } catch {
    return '';
  }
};

/**
 * Per-account storage key. Signed-out state falls back to a guest bucket so it
 * can never be read back by the next rider who signs in.
 */
export const scopedStoreKey = (baseName = DELIVERY_STORE_BASE_KEY) => {
  const accountId = currentDeliveryAccountId();
  return accountId ? `${baseName}:${accountId}` : `${baseName}:guest`;
};

const safeStorageGet = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeStorageSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota or private mode - state simply does not survive reload */
  }
};

const safeStorageRemove = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};

const collectOrderKeys = (order) => {
  if (!order) return [];
  const candidates = [
    order._id,
    order.id,
    order.orderMongoId,
    order.order_mongo_id,
    order.orderId,
    order.order_id,
    order.mongoId,
  ];
  return [...new Set(candidates.map((value) => String(value || '').trim()).filter(Boolean))];
};

const resolveOrderKey = (order) => {
  const keys = collectOrderKeys(order);
  if (!keys.length) return null;
  const mongoLike = keys.find((key) => /^[a-f0-9]{24}$/i.test(key));
  return mongoLike || keys[0];
};

const ordersShareIdentity = (left, right) => {
  const leftKeys = collectOrderKeys(left);
  const rightKeys = collectOrderKeys(right);
  if (!leftKeys.length || !rightKeys.length) return false;
  const leftSet = new Set(leftKeys);
  return rightKeys.some((key) => leftSet.has(key));
};

const orderMatchesKey = (order, key) => {
  const needle = String(key || '').trim();
  if (!needle) return false;
  return collectOrderKeys(order).includes(needle);
};

const dedupeOrdersByIdentity = (orders = []) => {
  const unique = [];
  for (const order of orders) {
    if (!unique.some((existing) => ordersShareIdentity(existing, order))) {
      unique.push(order);
    }
  }
  return unique;
};

const defaultCapacity = () => ({ max: 1, active: 0, remaining: 1 });

/**
 * The offer window the backend stamped on this request.
 *
 * Every field is server-issued; nothing here invents an expiry. An offer with
 * no stamp at all is treated as already dead rather than as permanent - a card
 * with no backing expiry is exactly the stale request that survived logouts and
 * reinstalls.
 */
const offerExpiryMs = (order) => {
  const raw =
    order?.offerExpiresAt ||
    order?.dispatch?.offeredTo?.[0]?.expiresAt ||
    null;
  if (!raw) return 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

/** True while the backend's own expiry for this offer is still in the future. */
export const isOfferStillValid = (order, now = Date.now()) => offerExpiryMs(order) > now;

const mapDeliveryPhaseToTripStatus = (order) => {
  const backendStatus = String(
    order?.deliveryStatus ||
      order?.orderState?.status ||
      order?.orderStatus ||
      order?.status ||
      '',
  ).toLowerCase();
  const currentPhase = order?.deliveryState?.currentPhase;

  if (['delivered', 'completed'].includes(backendStatus)) return 'COMPLETED';
  if (currentPhase === 'at_drop' || backendStatus === 'reached_drop') return 'REACHED_DROP';
  if (['picked_up', 'delivering'].includes(backendStatus) || currentPhase === 'en_route_to_delivery') {
    return 'PICKED_UP';
  }
  if (currentPhase === 'at_pickup' || backendStatus === 'reached_pickup') return 'REACHED_PICKUP';
  if (['confirmed', 'preparing', 'ready_for_pickup'].includes(backendStatus)) return 'PICKING_UP';
  return 'PICKING_UP';
};

export const useDeliveryStore = create(
  persist(
    (set, get) => ({
      isOnline: false,
      riderLocation: null,

      newOrders: [],
      acceptedOrders: [],
      focusedOrderId: null,
      orderSessions: {},
      capacity: defaultCapacity(),

      settings: {
        pickupRangeLimit: 500,
        deliveryRangeLimit: 500,
      },

      toggleOnline: () => set((state) => ({ isOnline: !state.isOnline })),
      setOnline: (online) => set({ isOnline: online }),
      setRiderLocation: (location) => {
        set((state) => {
          const next = { riderLocation: location };
          if (location && Array.isArray(state.newOrders) && state.newOrders.length) {
            next.newOrders = state.newOrders.filter((order) =>
              isOrderWithinOfferRange(order, location),
            );
          }
          return next;
        });
      },
      setSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        })),

      setCapacity: (capacity) =>
        set({
          capacity: {
            max: Number(capacity?.max ?? 1),
            active: Number(capacity?.active ?? 0),
            remaining: Number(capacity?.remaining ?? 0),
          },
        }),

      getFocusedOrder: () => {
        const { acceptedOrders, focusedOrderId } = get();
        if (!focusedOrderId) return acceptedOrders[0] || null;
        return (
          acceptedOrders.find((order) => orderMatchesKey(order, focusedOrderId)) ||
          acceptedOrders[0] ||
          null
        );
      },

      getFocusedTripStatus: () => {
        const order = get().getFocusedOrder();
        const orderId = resolveOrderKey(order);
        if (!orderId) return 'IDLE';
        const session = get().orderSessions[orderId];
        if (session?.tripStatus) return session.tripStatus;
        return mapDeliveryPhaseToTripStatus(order);
      },

      addNewOrder: (order) => {
        const normalized = sanitizeOrderDispatchMetrics(mapOrderLocations(order) || order);
        const incomingKeys = collectOrderKeys(normalized);
        if (!incomingKeys.length) return;
        // An offer the backend has already expired never enters the queue, so a
        // late socket frame or a push opened minutes later cannot resurrect a
        // dead request.
        if (!isOfferStillValid(normalized)) return;
        const riderLocation = get().riderLocation;
        if (!isOrderWithinOfferRange(normalized, riderLocation)) return;
        set((state) => {
          const acceptedExists = state.acceptedOrders.some((item) => ordersShareIdentity(item, normalized));
          if (acceptedExists) return state;

          const existingIndex = state.newOrders.findIndex((item) => ordersShareIdentity(item, normalized));
          if (existingIndex >= 0) {
            const next = [...state.newOrders];
            next[existingIndex] = { ...next[existingIndex], ...normalized };
            return { newOrders: next };
          }

          return { newOrders: [normalized, ...state.newOrders] };
        });
      },

      removeNewOrder: (orderIdOrOrder) => {
        const keys = new Set(
          typeof orderIdOrOrder === 'object' && orderIdOrOrder !== null
            ? collectOrderKeys(orderIdOrOrder)
            : [String(orderIdOrOrder || '').trim()].filter(Boolean),
        );
        if (!keys.size) return;
        set((state) => ({
          newOrders: state.newOrders.filter(
            (order) => !collectOrderKeys(order).some((key) => keys.has(key)),
          ),
        }));
      },

      setNewOrders: (orders) =>
        set({
          newOrders: dedupeOrdersByIdentity(
            (Array.isArray(orders) ? orders : []).filter((order) => isOfferStillValid(order)),
          ),
        }),

      /**
       * Drops offers whose server-issued window has closed.
       *
       * Called on a ticker and on every wake-up, so a request that expires while
       * the app sits open or backgrounded leaves the screen on its own rather
       * than waiting for the rider to tap a card the backend will refuse.
       *
       * @returns {object[]} the offers that were just removed
       */
      pruneExpiredOffers: () => {
        const now = Date.now();
        const current = get().newOrders || [];
        const expired = current.filter((order) => !isOfferStillValid(order, now));
        if (!expired.length) return [];
        set({ newOrders: current.filter((order) => isOfferStillValid(order, now)) });
        return expired;
      },

      /**
       * Wipes every trace of the previous rider from this device's memory.
       *
       * The persisted slice is already namespaced per account, but this store is
       * a module singleton: on a logout/login inside one app session the live
       * in-memory queues, sessions and capacity were simply carried over, so the
       * next rider opened the app looking at the previous rider's orders. Called
       * on logout, on account switch and whenever the authenticated id changes.
       */
      resetAccountState: () =>
        set({
          newOrders: [],
          acceptedOrders: [],
          orderSessions: {},
          focusedOrderId: null,
          capacity: defaultCapacity(),
          riderLocation: null,
          isOnline: false,
        }),

      acceptOrderToQueue: (order) => {
        const orderId = resolveOrderKey(order);
        if (!orderId) return;
        set((state) => {
          const newOrders = state.newOrders.filter((item) => !ordersShareIdentity(item, order));
          const acceptedOrders = [
            order,
            ...state.acceptedOrders.filter((item) => !ordersShareIdentity(item, order)),
          ];
          const hadAcceptedOrders = state.acceptedOrders.length > 0;
          const focusedOrderId = hadAcceptedOrders || state.focusedOrderId
            ? (state.focusedOrderId || resolveOrderKey(state.acceptedOrders[0]) || orderId)
            : orderId;
          const orderSessions = {
            ...state.orderSessions,
            [orderId]: {
              tripStatus: 'PICKING_UP',
              showVerification: false,
              isModalMinimized: false,
              ...(state.orderSessions[orderId] || {}),
            },
          };
          const active = acceptedOrders.length;
          const max = state.capacity?.max ?? 1;
          return {
            acceptedOrders,
            newOrders,
            focusedOrderId,
            orderSessions,
            capacity: {
              max,
              active,
              remaining: Math.max(0, max - active),
            },
          };
        });
      },

      setAcceptedOrders: (orders, options = {}) => {
        const list = Array.isArray(orders) ? orders : [];
        set((state) => {
          const focusedOrderId =
            options.focusedOrderId ??
            state.focusedOrderId ??
            resolveOrderKey(list[0]) ??
            null;
          const max = options.capacity?.max ?? state.capacity?.max ?? 1;
          const active = list.length;
          const orderSessions = { ...state.orderSessions };
          list.forEach((order) => {
            const orderId = resolveOrderKey(order);
            if (!orderId) return;
            if (!orderSessions[orderId]) {
              orderSessions[orderId] = {
                tripStatus: mapDeliveryPhaseToTripStatus(order),
                showVerification: false,
                isModalMinimized: false,
              };
            }
          });
          return {
            acceptedOrders: list,
            focusedOrderId,
            orderSessions,
            capacity: options.capacity || {
              max,
              active,
              remaining: Math.max(0, max - active),
            },
          };
        });
      },

      setFocusedOrder: (orderId) => {
        const key = String(orderId || '');
        if (!key) return;
        set({ focusedOrderId: key });
      },

      updateOrderSession: (orderId, patch = {}) => {
        const key = String(orderId || '');
        if (!key) return;
        set((state) => ({
          orderSessions: {
            ...state.orderSessions,
            [key]: {
              ...(state.orderSessions[key] || {}),
              ...patch,
            },
          },
        }));
      },

      updateTripStatus: (status, orderId) => {
        const key = String(orderId || get().focusedOrderId || resolveOrderKey(get().getFocusedOrder()) || '');
        if (!key) return;
        get().updateOrderSession(key, { tripStatus: status });
      },

      removeAcceptedOrder: (orderIdOrOrder) => {
        const keys = new Set(
          typeof orderIdOrOrder === 'object' && orderIdOrOrder !== null
            ? collectOrderKeys(orderIdOrOrder)
            : [String(orderIdOrOrder || '').trim()].filter(Boolean),
        );
        if (!keys.size) return;
        set((state) => {
          const acceptedOrders = state.acceptedOrders.filter(
            (order) => !collectOrderKeys(order).some((key) => keys.has(key)),
          );
          const orderSessions = { ...state.orderSessions };
          Object.keys(orderSessions).forEach((sessionKey) => {
            if (keys.has(sessionKey)) {
              delete orderSessions[sessionKey];
            }
          });
          const focusedOrderId = keys.has(state.focusedOrderId || '')
            ? resolveOrderKey(acceptedOrders[0]) || null
            : state.focusedOrderId;
          const max = state.capacity?.max ?? 1;
          const active = acceptedOrders.length;
          return {
            acceptedOrders,
            orderSessions,
            focusedOrderId,
            capacity: {
              max,
              active,
              remaining: Math.max(0, max - active),
            },
          };
        });
      },

      clearAcceptedOrders: () =>
        set({
          acceptedOrders: [],
          focusedOrderId: null,
          orderSessions: {},
          capacity: defaultCapacity(),
        }),

      setActiveOrder: (order) => {
        if (!order) {
          get().clearAcceptedOrders();
          return;
        }
        get().setAcceptedOrders([order]);
        const orderId = resolveOrderKey(order);
        if (orderId) get().setFocusedOrder(orderId);
      },

      clearActiveOrder: () => {
        const focused = get().getFocusedOrder();
        const orderId = resolveOrderKey(focused);
        if (orderId) {
          get().removeAcceptedOrder(orderId);
        } else {
          get().clearAcceptedOrders();
        }
      },

      canAdvanceToPickup: () => {
        const order = get().getFocusedOrder();
        const orderId = resolveOrderKey(order);
        const tripStatus = orderId
          ? get().orderSessions[orderId]?.tripStatus || mapDeliveryPhaseToTripStatus(order)
          : 'IDLE';
        return Boolean(order) && tripStatus === 'PICKING_UP';
      },

      canAdvanceToDeliver: () => {
        const order = get().getFocusedOrder();
        const orderId = resolveOrderKey(order);
        const tripStatus = orderId
          ? get().orderSessions[orderId]?.tripStatus || mapDeliveryPhaseToTripStatus(order)
          : 'IDLE';
        return Boolean(order) && tripStatus === 'PICKED_UP';
      },
    }),
    {
      name: DELIVERY_STORE_BASE_KEY,
      // Namespaced per rider. The key used to be shared by every account on the
      // device, so after a logout/login the next rider rehydrated the previous
      // rider's focusedOrderId (their active order) and isOnline - and because
      // isOnline is pushed to the server on mount, the new rider was silently
      // put online and started receiving offers. Resolved at call time, not at
      // module load, because this store is created before anyone logs in.
      storage: createJSONStorage(() => ({
        getItem: (name) => safeStorageGet(scopedStoreKey(name)),
        setItem: (name, value) => safeStorageSet(scopedStoreKey(name), value),
        removeItem: (name) => safeStorageRemove(scopedStoreKey(name)),
      })),
      partialize: (state) => ({
        isOnline: state.isOnline,
        focusedOrderId: state.focusedOrderId,
      }),
    },
  ),
);

/*
 * Wipe the store whenever a rider session ends.
 *
 * Subscribed at module load, not from a component, because logout can happen
 * from a screen where no delivery hook is mounted - and this store is a
 * singleton, so anything left in it is what the next rider to sign in sees.
 * The auth layer fires this event on logout, account switch and forced session
 * teardown.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('deliverySessionReset', () => {
    try {
      useDeliveryStore.getState().resetAccountState();
    } catch {
      /* nothing to reset */
    }
  });
}

export { resolveOrderKey, mapDeliveryPhaseToTripStatus, collectOrderKeys, ordersShareIdentity, dedupeOrdersByIdentity };

export const useFocusedOrder = () =>
  useDeliveryStore((state) => state.getFocusedOrder());

export const useFocusedTripStatus = () =>
  useDeliveryStore((state) => state.getFocusedTripStatus());

export const useFocusedOrderSession = () =>
  useDeliveryStore((state) => {
    const order = state.getFocusedOrder();
    const orderId = resolveOrderKey(order);
    return orderId ? state.orderSessions[orderId] || {} : {};
  });
