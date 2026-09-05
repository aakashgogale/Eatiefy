import { useEffect, useRef, useState, useCallback } from 'react';
import io from 'socket.io-client';
import { toast } from 'sonner';
import { API_BASE_URL } from '@food/api/config';
import { restaurantAPI } from '@food/api';
import { dispatchNotificationInboxRefresh } from '@food/hooks/useNotificationInbox';
import {
  isNativeAppWebView,
  shouldSkipDuplicateOsNotification,
} from '@food/utils/firebaseMessaging';
import { normalizeRestaurantOrderView } from '@food/utils/restaurantOrderPricing';

const alertSound = '/assets/media/restaurant_alert.mp3';
const debugLog = (...args) => {};
const debugWarn = (...args) => {};
const debugError = (...args) => {};

let cachedAudioBlobUrl = null;
const preloadAudio = async () => {
  if (cachedAudioBlobUrl) return cachedAudioBlobUrl;
  try {
    const response = await fetch(alertSound);
    if (response.ok) {
      const blob = await response.blob();
      cachedAudioBlobUrl = URL.createObjectURL(blob);
      return cachedAudioBlobUrl;
    }
  } catch (e) {
    debugWarn('Failed to preload audio blob:', e);
  }
  return alertSound;
};

// Do NOT preload on import — this hook is imported from shared Food routes,
// and eager fetch() would load restaurant_alert.mp3 on user/delivery pages too.

const resolveAudioSource = (source) => {
  return cachedAudioBlobUrl || source;
};

const supportsBrowserNotifications = () =>
  typeof window !== 'undefined' && typeof Notification !== 'undefined';

const buildRestaurantOrderNotification = (orderData = {}) => {
  const orderId = orderData.orderId || orderData.orderMongoId || 'New';
  const itemCount = Array.isArray(orderData.items) ? orderData.items.length : 0;
  const total = Number(orderData.total || orderData.pricing?.total || 0);

  return {
    title: `New order #${orderId}`,
    body: itemCount > 0
      ? `${itemCount} item${itemCount === 1 ? '' : 's'} - ₹${total.toFixed(2)}`
      : 'A new order is waiting for review',
    tag: `restaurant-order-${orderId}`,
    data: {
      orderId,
      targetUrl: `/restaurant/orders/${orderData.orderMongoId || orderData.orderId || ''}`,
    },
  };
};

const triggerWebViewNativeNotification = async (orderData = {}) => {
  if (typeof window === 'undefined') return false;

  const bridgePayload = {
    title: 'New restaurant order',
    body: `Order #${orderData?.orderId || orderData?.orderMongoId || orderData?.id || ''}`.trim(),
    orderId: orderData?.orderId || orderData?.order_id || '',
    orderMongoId: orderData?.orderMongoId || orderData?.order_mongo_id || '',
    targetUrl: `/restaurant/orders/${orderData?.orderMongoId || orderData?.orderId || ''}`,
  };

  try {
    if (
      window.flutter_inappwebview &&
      typeof window.flutter_inappwebview.callHandler === 'function'
    ) {
      const handlerNames = [
        'playNotificationSound',
        'triggerNotificationFeedback',
        'onPushNotification',
        'onNewOrder'
      ];

      for (const handlerName of handlerNames) {
        try {
          await window.flutter_inappwebview.callHandler(handlerName, bridgePayload);
          return true;
        } catch {
          // Try next handler name
        }
      }
    }
  } catch {
    // Ignore bridge failures and fall back to browser/web audio
  }

  return false;
};

const stopWebViewNativeNotification = async () => {
  if (typeof window === 'undefined') return;
  try {
    if (
      window.flutter_inappwebview &&
      typeof window.flutter_inappwebview.callHandler === 'function'
    ) {
      const handlerNames = ['stopNotificationSound', 'stopOrderRingtone', 'dismissNotification'];
      for (const handlerName of handlerNames) {
        try {
          await window.flutter_inappwebview.callHandler(handlerName, {});
        } catch {
          // Try next handler
        }
      }
    }
  } catch {
    // Ignore bridge failures
  }
};

// --------------------------------------------------------------------------
// GLOBAL SINGLETON STATE (Shared across all component hook instances)
// --------------------------------------------------------------------------
let globalIsMuted = false;
if (typeof window !== 'undefined') {
  globalIsMuted = localStorage.getItem('restaurant_notifications_muted') === 'true';
}

let globalMutedOrderIds = new Set();
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem('restaurant_muted_order_ids');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        globalMutedOrderIds = new Set(parsed);
      }
    }
  } catch (e) {
    debugWarn('Failed to parse restaurant_muted_order_ids:', e);
  }
}

const saveMutedOrderIds = () => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('restaurant_muted_order_ids', JSON.stringify(Array.from(globalMutedOrderIds)));
    } catch (e) {
      debugWarn('Failed to save restaurant_muted_order_ids:', e);
    }
  }
};

let globalNewOrder = null;
let globalNewReservation = null;
let globalActiveOrder = null;

// Audio player references
let globalAudio = null;
let globalFallbackAudio = null;
let globalAlertLoopTimer = null;
let globalAlertLoopStartedAt = 0;

// Socket and Polling references
let globalSocket = null;
let globalSocketConnected = false;
let globalActiveRestaurantId = null;
let globalPollingIntervalId = null;

let processedOrderIds = new Set();
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem('restaurant_processed_order_ids');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        processedOrderIds = new Set(parsed);
      }
    }
  } catch (e) {}
}

const saveProcessedOrderIds = () => {
  if (typeof window !== 'undefined') {
    try {
      const arr = Array.from(processedOrderIds).slice(-200);
      localStorage.setItem('restaurant_processed_order_ids', JSON.stringify(arr));
    } catch (e) {}
  }
};

const lastAlertAtByOrder = new Map();
const lastBrowserNotificationAtByOrder = new Map();

// Hook subscribers
const subscribers = new Set();

const updateGlobalState = (updates) => {
  if ('isMuted' in updates) {
    globalIsMuted = updates.isMuted;
    localStorage.setItem('restaurant_notifications_muted', globalIsMuted ? 'true' : 'false');
  }
  if ('newOrder' in updates) {
    globalNewOrder = updates.newOrder;
  }
  if ('newReservation' in updates) {
    globalNewReservation = updates.newReservation;
  }
  if ('activeOrder' in updates) {
    globalActiveOrder = updates.activeOrder;
  }
  if ('socketConnected' in updates) {
    globalSocketConnected = updates.socketConnected;
  }
  
  subscribers.forEach((callback) => {
    try {
      callback({
        isMuted: globalIsMuted,
        mutedOrderIds: globalMutedOrderIds,
        newOrder: globalNewOrder,
        newReservation: globalNewReservation,
        isConnected: globalSocketConnected,
      });
    } catch (e) {
      // Ignore defunct subscribers
    }
  });
};

const stopGlobalAlertLoop = () => {
  if (globalAlertLoopTimer) {
    clearInterval(globalAlertLoopTimer);
    globalAlertLoopTimer = null;
  }
  globalAlertLoopStartedAt = 0;
  
  if (typeof window !== 'undefined') {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(k => {
        if (k.startsWith('alert_start_')) {
          localStorage.removeItem(k);
        }
      });
    } catch (_) {}
  }
  
  if (globalAudio) {
    try {
      globalAudio.pause();
      globalAudio.currentTime = 0;
    } catch (_) {}
  }
  if (globalFallbackAudio) {
    try {
      globalFallbackAudio.pause();
      globalFallbackAudio.currentTime = 0;
    } catch (_) {}
    globalFallbackAudio = null;
  }
  stopWebViewNativeNotification();
};

const playGlobalNotificationSound = async (orderData = {}) => {
  try {
    if (globalIsMuted || isOrderMuted(orderData)) return;
    void triggerWebViewNativeNotification(orderData).catch(() => {});
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate([200, 100, 200, 100, 300]);
      } catch (_) {}
    }

    if (!globalAudio && typeof window !== 'undefined') {
      globalAudio = new Audio();
      globalAudio.preload = 'auto';
      globalAudio.volume = 1;
      preloadAudio().then(src => {
        if (globalAudio) {
          globalAudio.src = src;
        }
      });
    }

    if (globalAudio) {
      globalAudio.muted = false;
      globalAudio.volume = 1;
      globalAudio.currentTime = 0;
      globalAudio.play().catch(error => {
        if (!error.message?.includes("user didn't interact") && !error.name?.includes('NotAllowedError')) {
          try {
            if (globalFallbackAudio) {
              globalFallbackAudio.pause();
              globalFallbackAudio = null;
            }
            globalFallbackAudio = new Audio(resolveAudioSource(alertSound));
            globalFallbackAudio.volume = 1;
            globalFallbackAudio.muted = false;
            globalFallbackAudio.play().catch(() => {});
          } catch (fallbackError) {
            // ignore
          }
        }
      });
    }
  } catch (error) {
    // ignore
  }
};

const startGlobalAlertLoop = (orderData) => {
  stopGlobalAlertLoop();
  
  const orderId = getOrderAlertKey(orderData);
  const storageKey = `alert_start_${orderId}`;
  let alertStartTime = typeof window !== 'undefined' ? Number(localStorage.getItem(storageKey)) : 0;
  
  if (!alertStartTime) {
    alertStartTime = Date.now();
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(storageKey, String(alertStartTime));
      } catch (_) {}
    }
  }

  globalAlertLoopStartedAt = alertStartTime;
  globalActiveOrder = orderData;
  updateGlobalState({ activeOrder: orderData });

  const elapsed = Date.now() - globalAlertLoopStartedAt;
  const ALERT_LOOP_MAX_MS = 120000;
  const ALERT_LOOP_INTERVAL_MS = 4500;

  if (elapsed >= ALERT_LOOP_MAX_MS) {
    stopGlobalAlertLoop();
    return;
  }

  if (!globalIsMuted && !isOrderMuted(orderData)) {
    playGlobalNotificationSound(orderData);
  }

  globalAlertLoopTimer = setInterval(() => {
    if (!globalActiveOrder) {
      stopGlobalAlertLoop();
      return;
    }

    const currentElapsed = Date.now() - globalAlertLoopStartedAt;

    if (currentElapsed >= ALERT_LOOP_MAX_MS) {
      stopGlobalAlertLoop();
      return;
    }

    // Respect BOTH the global mute and the per-order mute — muting an order must
    // silence its alert even if the loop wasn't torn down for any reason.
    if (!globalIsMuted && !isOrderMuted(globalActiveOrder)) {
      playGlobalNotificationSound(globalActiveOrder);
    }
  }, ALERT_LOOP_INTERVAL_MS);
};

const isProcessedOrder = (orderData) => {
  if (!orderData) return false;
  const ids = [
    orderData.orderMongoId,
    orderData.orderId,
    orderData._id,
    orderData.id,
    orderData.mongoId,
    orderData.order_id,
    orderData.order_mongo_id
  ].filter(Boolean);
  return ids.some(id => processedOrderIds.has(String(id).trim()));
};

const getOrderAlertKey = (orderData = {}) => (
  String(
    orderData?.orderMongoId ||
    orderData?.order_mongo_id ||
    orderData?.orderId ||
    orderData?.order_id ||
    orderData?._id ||
    orderData?.id ||
    ''
  ).trim()
);

// True if ANY of the order's id variants is muted. Different call sites resolve
// the "order id" with slightly different priorities, so checking all variants
// avoids a mute being missed just because a different id field was stored.
const isOrderMuted = (orderData = {}) => {
  const ids = [
    orderData?.orderMongoId,
    orderData?.order_mongo_id,
    orderData?.orderId,
    orderData?.order_id,
    orderData?._id,
    orderData?.id,
  ]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean);
  return ids.some((id) => globalMutedOrderIds.has(id));
};

const shouldProcessOrderAlert = (orderData = {}) => {
  const key = getOrderAlertKey(orderData);
  if (!key) return true;
  const now = Date.now();
  const last = lastAlertAtByOrder.get(key) || 0;
  const ALERT_DEDUPE_MS = 15000;
  if (now - last < ALERT_DEDUPE_MS) return false;
  lastAlertAtByOrder.set(key, now);
  return true;
};

const shouldShowBrowserNotification = (orderData = {}) => {
  const key = getOrderAlertKey(orderData);
  if (!key) return true;
  const now = Date.now();
  const last = lastBrowserNotificationAtByOrder.get(key) || 0;
  const BROWSER_NOTIFICATION_DEDUPE_MS = 20000;
  if (now - last < BROWSER_NOTIFICATION_DEDUPE_MS) return false;
  lastBrowserNotificationAtByOrder.set(key, now);
  return true;
};

const showBackgroundOrderNotification = async (orderData) => {
  if (isNativeAppWebView()) {
    return;
  }

  if (
    shouldSkipDuplicateOsNotification({
      orderMongoId: orderData?.orderMongoId || orderData?._id,
      orderId: orderData?.orderId || orderData?.order_id,
      orderStatus: orderData?.status || orderData?.orderStatus || 'new',
    })
  ) {
    return;
  }

  if (!shouldShowBrowserNotification(orderData)) {
    return;
  }

  if (!supportsBrowserNotifications() || Notification.permission !== 'granted') {
    return;
  }

  const notificationOptions = buildRestaurantOrderNotification(orderData);

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(notificationOptions.title, {
          body: notificationOptions.body,
          tag: notificationOptions.tag,
          renotify: false,
          requireInteraction: true,
          silent: false,
          vibrate: [200, 100, 200, 100, 300],
          data: notificationOptions.data,
        });
        return;
      }
    }

    new Notification(notificationOptions.title, {
      body: notificationOptions.body,
      tag: notificationOptions.tag,
      requireInteraction: true,
      silent: false,
      data: notificationOptions.data,
    });
  } catch (error) {
    // ignore
  }
};

/**
 * Hook for restaurant to receive real-time order notifications with sound
 * @returns {object} - { newOrder, playSound, isConnected, isMuted, setMuted, clearNewOrder, stopSound }
 */
export const useRestaurantNotifications = () => {
  const [localState, setLocalState] = useState({
    isMuted: globalIsMuted,
    mutedOrderIds: globalMutedOrderIds,
    newOrder: globalNewOrder,
    newReservation: globalNewReservation,
    isConnected: globalSocketConnected,
  });

  const [restaurantId, setRestaurantId] = useState(null);

  // Subscribe to global updates
  useEffect(() => {
    const callback = (newState) => {
      setLocalState(newState);
    };
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  }, []);

  // Fetch restaurant ID from API on mount
  useEffect(() => {
    const fetchRestaurantId = async () => {
      try {
        const response = await restaurantAPI.getCurrentRestaurant();
        if (response.data?.success && response.data.data?.restaurant) {
          const restaurant = response.data.data.restaurant;
          if (restaurant.status !== "approved") {
            return;
          }
          const id = restaurant._id?.toString() || restaurant.restaurantId;
          setRestaurantId(id);
        }
      } catch (error) {
        // ignore
      }
    };
    fetchRestaurantId();
  }, []);

  const handleIncomingOrderAlert = useCallback((orderData, source = 'unknown') => {
    const isSocket = source === 'socket';
    const normalizedOrder = normalizeRestaurantOrderView(orderData);
    
    if (isProcessedOrder(normalizedOrder)) {
      return;
    }

    if (normalizedOrder?.scheduledAt) {
      const scheduledTime = new Date(normalizedOrder.scheduledAt).getTime();
      const now = Date.now();
      if (scheduledTime > now + 15 * 60000) {
        return;
      }
    }

    const deduped = !shouldProcessOrderAlert(normalizedOrder);
    if (deduped && !isSocket) {
      return;
    }

    updateGlobalState({ newOrder: normalizedOrder });

    if (!isOrderMuted(normalizedOrder)) {
      // startGlobalAlertLoop already plays the sound immediately (and then loops),
      // so we must NOT play here as well — that caused the double sound.
      startGlobalAlertLoop(normalizedOrder);
    }

    const isTabHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (isTabHidden) {
      showBackgroundOrderNotification(normalizedOrder);
    }
  }, []);

  // Handle socket connection and listeners globally
  useEffect(() => {
    if (!API_BASE_URL || !String(API_BASE_URL).trim()) {
      updateGlobalState({ socketConnected: false });
      return;
    }
    if (!restaurantId) {
      return;
    }

    // Check if we need to initialize or update socket
    if (globalSocket && globalActiveRestaurantId === restaurantId) {
      return;
    }

    if (globalSocket) {
      globalSocket.disconnect();
      globalSocket = null;
      globalSocketConnected = false;
      updateGlobalState({ socketConnected: false });
    }

    globalActiveRestaurantId = restaurantId;

    let backendUrl = API_BASE_URL;
    try {
      const urlObj = new URL(backendUrl);
      let pathname = urlObj.pathname.replace(/^\/api\/?$/, '');
      backendUrl = `${urlObj.protocol}//${urlObj.hostname}${urlObj.port ? `:${urlObj.port}` : ''}${pathname}`;
    } catch (e) {
      backendUrl = backendUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '');
      if (backendUrl.startsWith('https:') || backendUrl.startsWith('http:')) {
        const protocolMatch = backendUrl.match(/^(https?):/i);
        if (protocolMatch) {
          const protocol = protocolMatch[1].toLowerCase();
          const cleanPath = backendUrl.substring(protocol.length + 1).replace(/^\/+/, '');
          backendUrl = `${protocol}://${cleanPath}`;
        }
      }
    }
    backendUrl = backendUrl.replace(/^(https?):\/+/gi, '$1://').replace(/\/+$/, '');

    const frontendHostname = window.location.hostname;
    const isLocalhost = frontendHostname === 'localhost' || frontendHostname === '127.0.0.1' || frontendHostname === '';
    const isProductionBuild = import.meta.env.MODE === 'production' || import.meta.env.PROD;
    const isProductionDeployment = !isLocalhost && (window.location.protocol === 'https:' || frontendHostname.includes('.'));
    const backendIsLocalhost = backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1');

    if (backendIsLocalhost && (isProductionBuild || isProductionDeployment) && !isLocalhost) {
      updateGlobalState({ socketConnected: false });
      return;
    }

    let socketOrigin = backendUrl;
    try {
      socketOrigin = new URL(backendUrl).origin;
    } catch {
      socketOrigin = String(backendUrl || "").replace(/\/api\/v\d+\/?$/i, "").replace(/\/api\/?$/i, "").replace(/\/+$/, "");
    }

    const socketUrl = `${socketOrigin}`;

    try {
      new URL(socketUrl);
    } catch {
      updateGlobalState({ socketConnected: false });
      return;
    }

    globalSocket = io(socketUrl, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
      forceNew: false,
      autoConnect: true,
      auth: {
        token: localStorage.getItem('restaurant_accessToken') || localStorage.getItem('accessToken')
      }
    });

    globalSocket.on('connect', () => {
      globalSocketConnected = true;
      updateGlobalState({ socketConnected: true });
      globalSocket?.emit('join-restaurant', restaurantId);
    });

    globalSocket.on('connect_error', () => {
      globalSocketConnected = false;
      updateGlobalState({ socketConnected: false });
    });

    globalSocket.on('disconnect', (reason) => {
      globalSocketConnected = false;
      updateGlobalState({ socketConnected: false });
      if (reason === 'io server disconnect') {
        globalSocket?.connect();
      }
    });

    globalSocket.on('reconnect', () => {
      globalSocketConnected = true;
      updateGlobalState({ socketConnected: true });
      globalSocket?.emit('join-restaurant', restaurantId);
    });

    globalSocket.on('new_order', (orderData) => {
      const normalizedOrder = normalizeRestaurantOrderView({
        ...orderData,
        orderMongoId: orderData?.orderMongoId || orderData?._id || orderData?.order_id,
        orderId: orderData?.orderId || orderData?.order_id || orderData?._id,
      });
      updateGlobalState({ newOrder: normalizedOrder });
      handleIncomingOrderAlert(normalizedOrder, 'socket');
    });

    globalSocket.on('new_dining_booking', (bookingData) => {
      updateGlobalState({ newReservation: bookingData });
      if (!globalIsMuted) {
        playGlobalNotificationSound(bookingData);
      }
    });

    globalSocket.on('play_notification_sound', (data) => {
      const normalizedData = {
        orderId: data?.orderId || data?.order_id,
        orderMongoId: data?.orderMongoId || data?.order_meta_id || data?.order_mongo_id,
        ...data
      };
      handleIncomingOrderAlert(normalizedData, 'socket');
    });

    globalSocket.on('order_status_update', (data) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('restaurantOrderStatusUpdate', {
            detail: data || {},
          }),
        );
      }
      const status = String(data?.orderStatus || data?.status || '').toLowerCase();

      // A Mongo ObjectId is a 24-char hex string — not a human order id, so don't show it.
      const isMongoId = (val) => /^[0-9a-fA-F]{24}$/.test(String(val || '').trim());
      const friendlyOrderId = (() => {
        const candidate = data?.orderId || data?.order_id || '';
        return candidate && !isMongoId(candidate) ? `#${candidate}` : '';
      })();

      // Order accepted — stop popup & sound immediately. Admin accept moves the
      // order straight to "preparing", so treat that (and the acceptedBy flag) as
      // accepted too, otherwise the restaurant popup would not dismiss.
      if (status === 'confirmed' || status === 'accepted' || status === 'preparing' || data?.acceptedBy === 'admin') {
        const orderId = data?.orderMongoId || data?._id || data?.orderId || data?.order_id;
        if (orderId) {
          const cleanId = String(orderId).trim();
          processedOrderIds.add(cleanId);
          globalMutedOrderIds.delete(cleanId);
        }
        stopGlobalAlertLoop();
        updateGlobalState({ newOrder: null, activeOrder: null, mutedOrderIds: new Set(globalMutedOrderIds) });
        // Toast only if admin accepted (not restaurant itself)
        if (data?.acceptedBy === 'admin') {
          toast.success(`Order ${friendlyOrderId} Accepted By Admin`, {
            duration: 6000,
            id: `admin-accepted-${data?.orderId || Date.now()}`
          });
        }
        dispatchNotificationInboxRefresh();
      }

      if (status === 'cancelled_by_admin') {
        toast.error(`Order ${friendlyOrderId} Rejected By Admin`, {
          duration: 6000,
          id: `admin-rejected-${data?.orderId || Date.now()}`
        });
        dispatchNotificationInboxRefresh();
      }

      if (status === 'delivered') {
        // Only announce a delivery for an order this restaurant actually tracked as
        // a real order (a valid display id). Guards against stray/stale events that
        // carry only a Mongo id firing a bogus "delivered" toast on new orders.
        if (friendlyOrderId) {
          toast.success(`Order ${friendlyOrderId} delivered successfully!`, {
            description: 'The order has been delivered to the customer.',
            duration: 6000,
            id: `delivered-${data?.orderId || Date.now()}`
          });
        }
        dispatchNotificationInboxRefresh();
      }
    });

    globalSocket.on('admin_notification', () => {
      dispatchNotificationInboxRefresh();
    });

    return () => {
      // Don't disconnect here to keep active room listeners alive across components
    };
  }, [restaurantId, handleIncomingOrderAlert]);

  // Handle REST polling fallback globally
  useEffect(() => {
    if (!restaurantId) return;
    if (globalPollingIntervalId) return;

    const ALERT_POLL_MS = 8000;

    const pollOrders = async () => {
      try {
        const token = localStorage.getItem('restaurant_accessToken') || localStorage.getItem('accessToken');
        const isAuthPage = window.location.pathname.includes('/login') || window.location.pathname.includes('/otp') || window.location.pathname.includes('/signup');
        
        if (!token || isAuthPage) {
          if (globalActiveOrder) {
            globalActiveOrder = null;
            updateGlobalState({ activeOrder: null });
            stopGlobalAlertLoop();
          }
          return;
        }

        const response = await restaurantAPI.getOrders({ page: 1, limit: 30 });
        const rows = response?.data?.data?.orders || response?.data?.data?.data?.orders || [];

        const confirmed = (rows || [])
          .filter((o) => {
            const status = String(o?.status || "").toLowerCase();
            // Only show alert for orders that are still pending/created (not yet accepted by admin)
            if (status !== "created" && status !== "pending") return false;
            if (isProcessedOrder(o)) return false;

            if (o.scheduledAt) {
              const scheduledTime = new Date(o.scheduledAt).getTime();
              const now = Date.now();
              return scheduledTime <= now + 30 * 60000;
            }
            
            // Ignore stale test/bugged orders older than 30 minutes to prevent sound playing repeatedly on login
            const createdAt = new Date(o.createdAt || o.updatedAt || 0).getTime();
            if (!createdAt || Date.now() - createdAt > 30 * 60 * 1000) {
              return false;
            }
            
            return true;
          })
          .sort((a, b) => {
            const at = a?.updatedAt || a?.createdAt || 0;
            const bt = b?.updatedAt || b?.createdAt || 0;
            return new Date(bt).getTime() - new Date(at).getTime();
          });

        if (confirmed.length > 0) {
          confirmed.slice(0, 5).forEach((o) => {
            const orderId = o.orderMongoId || o.orderId || o._id || o.id;
            const currentOrderId = globalNewOrder?.orderMongoId || globalNewOrder?.orderId || globalNewOrder?._id || globalNewOrder?.id;
            if (String(orderId) !== String(currentOrderId)) {
              handleIncomingOrderAlert(o, 'poll');
            }
          });
        } else {
          // If there are NO pending orders, ensure we clear any stale active order that might be playing sound
          if (globalActiveOrder) {
            globalActiveOrder = null;
            updateGlobalState({ activeOrder: null });
            stopGlobalAlertLoop();
          }
        }
      } catch (error) {
        // ignore
      }
    };

    pollOrders();
    globalPollingIntervalId = setInterval(pollOrders, ALERT_POLL_MS);

    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        pollOrders();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      // Polling remains alive globally
    };
  }, [restaurantId, handleIncomingOrderAlert]);

  // Request browser notification permission once on user interaction
  useEffect(() => {
    if (!supportsBrowserNotifications()) return;
    const askPermissionKey = 'restaurant_notification_permission_asked';
    if (Notification.permission !== 'default' || localStorage.getItem(askPermissionKey) === 'true') return;

    const requestPermissionOnce = async () => {
      localStorage.setItem(askPermissionKey, 'true');
      try {
        await Notification.requestPermission();
      } catch (error) {
        debugWarn('Failed to request restaurant notification permission:', error);
      }
    };

    const askOnInteraction = () => {
      requestPermissionOnce();
      window.removeEventListener('pointerdown', askOnInteraction);
      window.removeEventListener('keydown', askOnInteraction);
    };

    window.addEventListener('pointerdown', askOnInteraction, { once: true, passive: true });
    window.addEventListener('keydown', askOnInteraction, { once: true });

    return () => {
      window.removeEventListener('pointerdown', askOnInteraction);
      window.removeEventListener('keydown', askOnInteraction);
    };
  }, []);

  // Visibility change background browser notifications handler
  useEffect(() => {
    const onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden' && globalActiveOrder && !globalIsMuted) {
        showBackgroundOrderNotification(globalActiveOrder);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Track user interaction for audio unlocking
  useEffect(() => {
    const handleUserInteraction = async () => {
      if (typeof window === 'undefined') return;

      try {
        window.__userHasInteracted = true;

        // Unlock WebAudio silently
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          try {
            const ctx = new AudioCtx();
            if (ctx.state === 'suspended') {
              await ctx.resume();
            }
            const buf = ctx.createBuffer(1, 1, 22050);
            const srcNode = ctx.createBufferSource();
            srcNode.buffer = buf;
            srcNode.connect(ctx.destination);
            srcNode.start(0);
          } catch (_) {}
        }

        // Unlock HTML5 Audio element specifically for iOS WebKit using a tiny silent audio clip
        if (!globalAudio && typeof window !== 'undefined') {
          globalAudio = new Audio();
          globalAudio.preload = 'auto';
          globalAudio.volume = 1;
          // Silent MP3 base64 to safely unlock the Audio element without any "leaked" sound
          globalAudio.src = 'data:audio/mpeg;base64,//OlkAAAAAAAAAAAAAAAAAAAAAAASWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        }
        if (globalAudio) {
          try {
            const p = globalAudio.play();
            if (p && typeof p.then === 'function') {
              p.then(() => {
                globalAudio.pause();
                globalAudio.currentTime = 0;
                // Once unlocked, switch to the actual alert sound so it's ready
                preloadAudio().then(src => {
                  if (globalAudio) globalAudio.src = src;
                });
              }).catch(() => {
                // If it failed to play, still try to load the actual source
                preloadAudio().then(src => {
                  if (globalAudio) globalAudio.src = src;
                });
              });
            }
          } catch (_) {}
        }

        // If there's an active order pending that isn't muted, resume the alarm immediately!
        if (globalActiveOrder && !globalIsMuted && !isOrderMuted(globalActiveOrder)) {
          playGlobalNotificationSound(globalActiveOrder);
          startGlobalAlertLoop(globalActiveOrder);
        }
      } catch (error) {
        // ignore
      }

      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('touchstart', handleUserInteraction);
      document.removeEventListener('keydown', handleUserInteraction);
      window.removeEventListener('pointerdown', handleUserInteraction);
    };

    document.addEventListener('click', handleUserInteraction, { once: true });
    document.addEventListener('touchstart', handleUserInteraction, { once: true });
    document.addEventListener('keydown', handleUserInteraction, { once: true });
    window.addEventListener('pointerdown', handleUserInteraction, { once: true, passive: true });

    return () => {
      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('touchstart', handleUserInteraction);
      document.removeEventListener('keydown', handleUserInteraction);
      window.removeEventListener('pointerdown', handleUserInteraction);
    };
  }, []);

  const setMuted = useCallback((nextMuted) => {
    const muted = Boolean(nextMuted);
    updateGlobalState({ isMuted: muted });
    if (muted) {
      stopGlobalAlertLoop();
    } else if (globalActiveOrder) {
      playGlobalNotificationSound(globalActiveOrder);
      startGlobalAlertLoop(globalActiveOrder);
    }
  }, []);

  const clearNewOrder = useCallback((orderOrId) => {
    let targetId = null;
    if (orderOrId) {
      if (typeof orderOrId === 'object') {
        const ids = [
          orderOrId.orderMongoId,
          orderOrId.orderId,
          orderOrId._id,
          orderOrId.id,
          orderOrId.mongoId,
          orderOrId.order_id,
          orderOrId.order_mongo_id
        ].filter(Boolean);
        ids.forEach(id => {
          const cleanId = String(id).trim();
          processedOrderIds.add(cleanId);
          globalMutedOrderIds.delete(cleanId);
        });
        targetId = getOrderAlertKey(orderOrId);
      } else {
        targetId = String(orderOrId).trim();
        processedOrderIds.add(targetId);
        globalMutedOrderIds.delete(targetId);
      }
      saveProcessedOrderIds();
      saveMutedOrderIds();
    }
    stopGlobalAlertLoop();
    updateGlobalState({ newOrder: null, activeOrder: null, mutedOrderIds: new Set(globalMutedOrderIds) });
  }, []);

  const muteOrders = useCallback((orderIds) => {
    if (!Array.isArray(orderIds)) return;
    orderIds.forEach(id => {
      if (id) globalMutedOrderIds.add(String(id).trim());
    });
    saveMutedOrderIds();
    
    // Stop alarm loop if active order is among the muted ones
    if (globalActiveOrder && isOrderMuted(globalActiveOrder)) {
      stopGlobalAlertLoop();
    }
    
    updateGlobalState({ mutedOrderIds: new Set(globalMutedOrderIds) });
  }, []);

  const unmuteOrder = useCallback((orderId) => {
    if (!orderId) return;
    const cleanId = String(orderId).trim();
    globalMutedOrderIds.delete(cleanId);
    saveMutedOrderIds();

    // Restart the alert for the active order once it is no longer muted.
    if (globalActiveOrder && !isOrderMuted(globalActiveOrder)) {
      startGlobalAlertLoop(globalActiveOrder);
    }

    updateGlobalState({ mutedOrderIds: new Set(globalMutedOrderIds) });
  }, []);

  const clearNewReservation = useCallback(() => {
    updateGlobalState({ newReservation: null });
  }, []);

  return {
    newOrder: localState.newOrder,
    newReservation: localState.newReservation,
    clearNewOrder,
    clearNewReservation,
    isConnected: localState.isConnected,
    isMuted: localState.isMuted,
    setMuted,
    playNotificationSound: playGlobalNotificationSound,
    stopSound: stopGlobalAlertLoop,
    startAlertLoop: startGlobalAlertLoop,
    mutedOrderIds: localState.mutedOrderIds || new Set(),
    muteOrders,
    unmuteOrder,
  };
};
