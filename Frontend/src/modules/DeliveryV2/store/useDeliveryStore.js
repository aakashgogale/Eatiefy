import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { mapOrderLocations } from '@/modules/DeliveryV2/utils/orderMapping';
import {
  isOrderWithinOfferRange,
  sanitizeOrderDispatchMetrics,
} from '@/modules/DeliveryV2/utils/pickupMetrics';

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

      setNewOrders: (orders) => set({ newOrders: dedupeOrdersByIdentity(Array.isArray(orders) ? orders : []) }),

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
      name: 'delivery-v2-online-pref',
      partialize: (state) => ({
        isOnline: state.isOnline,
        focusedOrderId: state.focusedOrderId,
      }),
    },
  ),
);

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
