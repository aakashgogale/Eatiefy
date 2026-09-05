import { useEffect, useRef, useState, useCallback } from 'react';
import io from 'socket.io-client';
import { API_BASE_URL } from '@food/api/config';
import { deliveryAPI } from '@food/api';
const alertSound = '/assets/media/restaurant_alert.mp3';
const originalSound = '/assets/media/restaurant_alert.mp3';
import { dispatchNotificationInboxRefresh } from '@food/hooks/useNotificationInbox';
import { useDeliveryStore, resolveOrderKey, ordersShareIdentity } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { mapOrderLocations } from '@/modules/DeliveryV2/utils/orderMapping';
import {
  isOrderWithinOfferRange,
  sanitizeOrderDispatchMetrics,
} from '@/modules/DeliveryV2/utils/pickupMetrics';
import {
  isNativeAppWebView,
  shouldSkipDuplicateOsNotification,
} from '@food/utils/firebaseMessaging';
import { toast } from 'sonner';

const shouldLogDeliverySocket = () => {
  if (typeof window === 'undefined') return import.meta.env.DEV;
  try {
    return (
      import.meta.env.DEV ||
      window.localStorage.getItem('delivery_socket_debug') === '1' ||
      window.location.search.includes('delivery_socket_debug=1')
    );
  } catch {
    return import.meta.env.DEV;
  }
};

const debugLog = (...args) => {
  if (shouldLogDeliverySocket()) {
    console.log('[DeliverySocket]', ...args);
  }
};
const debugWarn = (...args) => {
  if (shouldLogDeliverySocket()) {
    console.warn('[DeliverySocket]', ...args);
  }
};
const debugError = (...args) => {
  console.error('[DeliverySocket]', ...args);
};

if (typeof window !== 'undefined') {
  debugLog('alertSound URL:', alertSound);
  debugLog('originalSound URL:', originalSound);
}

const resolveAudioSource = (source) => {
  if (!source) return '';
  // Handle ES6 module imports where the URL might be in a 'default' property
  const url = typeof source === 'object' ? (source.default || source) : source;
  return url;
};

const safeReadJson = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const decodeJwtPayload = (token) => {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((ch) => `%${(`00${ch.charCodeAt(0).toString(16)}`).slice(-2)}`)
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const resolveDeliveryPartnerIdFromClient = () => {
  try {
    const storedUser =
      safeReadJson('delivery_user') ||
      safeReadJson('deliveryUser') ||
      safeReadJson('user');

    const nestedCandidate =
      storedUser?.id ||
      storedUser?._id ||
      storedUser?.userId ||
      storedUser?.deliveryId ||
      storedUser?.deliveryPartnerId ||
      storedUser?.user?.id ||
      storedUser?.user?._id ||
      storedUser?.deliveryPartner?.id ||
      storedUser?.deliveryPartner?._id;

    if (nestedCandidate) return String(nestedCandidate);

    const token =
      localStorage.getItem('delivery_accessToken') ||
      localStorage.getItem('accessToken');
    const payload = decodeJwtPayload(token);
    const tokenCandidate =
      payload?.userId ||
      payload?.id ||
      payload?._id ||
      payload?.sub;

    return tokenCandidate ? String(tokenCandidate) : null;
  } catch {
    return null;
  }
};

const supportsBrowserNotifications = () =>
  typeof window !== 'undefined' && typeof Notification !== 'undefined';

const buildDeliveryOrderNotification = (orderData = {}) => {
  const orderId = orderData.orderId || orderData.orderMongoId || orderData.id || 'New';
  const itemCount = Array.isArray(orderData.items) ? orderData.items.length : 0;
  const total = Number(orderData.total || orderData.pricing?.total || orderData.orderTotal || 0);

  return {
    title: `New order #${orderId}`,
    body: itemCount > 0
      ? `${itemCount} item${itemCount === 1 ? '' : 's'} - ₹${total.toFixed(2)}`
      : 'A new order is available to accept',
    tag: `delivery-order-${orderId}`,
    data: {
      orderId,
      targetUrl: '/delivery',
    },
  };
}

const triggerWebViewNativeNotification = async (orderData = {}) => {
  if (typeof window === 'undefined') return false;

  const bridgePayload = {
    title: 'New delivery order',
    body: `Order #${orderData?.orderId || orderData?.orderMongoId || orderData?.id || ''}`.trim(),
    orderId: orderData?.orderId || orderData?.order_id || '',
    orderMongoId: orderData?.orderMongoId || orderData?.order_mongo_id || '',
    targetUrl: '/delivery',
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
      ];

      for (const handlerName of handlerNames) {
        try {
          await window.flutter_inappwebview.callHandler(handlerName, bridgePayload);
          return true;
        } catch {
          // Try next handler name.
        }
      }
    }
  } catch {
    // Ignore bridge failures and fall back to browser/web audio.
  }

  return false;
}


export const useDeliveryNotifications = () => {
  // CRITICAL: All hooks must be called unconditionally and in the same order every render
  // Order: useRef -> useState -> useEffect -> useCallback
  
  // Step 1: All refs first (unconditional)
  const socketRef = useRef(null);
  const audioRef = useRef(null);
  const audioUnlockAttemptedRef = useRef(false);
  const activeOrderRef = useRef(null);
  const alertLoopTimerRef = useRef(null);
  const alertLoopStartedAtRef = useRef(0);
  const userInteractedRef = useRef(false);
  const lastAlertAtByOrderRef = useRef(new Map());
  const lastBrowserNotificationAtByOrderRef = useRef(new Map());
  const processedOrderIdsRef = useRef(new Set());
  const mutedOrderIdsRef = useRef((() => {
    const ids = new Set();
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('delivery_muted_order_ids');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            parsed.forEach((id) => {
              const key = String(id || '').trim();
              if (key) ids.add(key);
            });
          }
        }
        localStorage.removeItem('delivery_notifications_muted');
      } catch (_) {}
    }
    return ids;
  })());
  const [muteUiTick, setMuteUiTick] = useState(0);
  
  // Step 2: All state hooks (unconditional)
  const [newOrder, setNewOrder] = useState(null);
  const [orderReady, setOrderReady] = useState(null);
  const [orderStatusUpdate, setOrderStatusUpdate] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [deliveryPartnerId, setDeliveryPartnerId] = useState(null);
  const [claimedOrderId, setClaimedOrderId] = useState(null); // set when another partner claims an order
  const [adminNotification, setAdminNotification] = useState(null);
  const joinedDeliveryRoomRef = useRef(null);
  const ALERT_LOOP_INTERVAL_MS = 1000;
  const ALERT_LOOP_MAX_MS = 10000; // 10 seconds max ring time per request as requested
  const ALERT_DEDUPE_MS = 15000;
  const BROWSER_NOTIFICATION_DEDUPE_MS = 20000;
  const NOTIFICATION_PERMISSION_ASKED_KEY = 'delivery_notification_permission_asked';
  const DELIVERY_MUTED_ORDER_IDS_KEY = 'delivery_muted_order_ids';

  // Step 3: All callbacks before effects (unconditional)
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

  const collectOrderAlertKeys = (orderData) => {
    if (!orderData) return [];
    if (typeof orderData === 'string') {
      const key = String(orderData).trim();
      return key ? [key] : [];
    }
    return [
      ...new Set(
        [
          orderData.orderMongoId,
          orderData.order_mongo_id,
          orderData.orderId,
          orderData.order_id,
          orderData._id,
          orderData.id,
          orderData.mongoId,
        ]
          .map((id) => String(id || '').trim())
          .filter(Boolean),
      ),
    ];
  };

  const saveMutedOrderIds = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        DELIVERY_MUTED_ORDER_IDS_KEY,
        JSON.stringify([...mutedOrderIdsRef.current]),
      );
    } catch (_) {}
  }, []);

  const isOrderAlertMuted = useCallback((orderData) => {
    const keys = collectOrderAlertKeys(orderData);
    if (!keys.length) return false;
    return keys.some((key) => mutedOrderIdsRef.current.has(key));
  }, []);

  const clearOrderMuteState = useCallback(
    (orderData) => {
      const keys = collectOrderAlertKeys(orderData);
      if (!keys.length) return;
      let changed = false;
      keys.forEach((key) => {
        if (mutedOrderIdsRef.current.delete(key)) {
          changed = true;
        }
      });
      if (changed) {
        saveMutedOrderIds();
        setMuteUiTick((tick) => tick + 1);
      }
    },
    [saveMutedOrderIds],
  );

  const isProcessedOrder = useCallback((orderData) => {
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
    return ids.some(id => processedOrderIdsRef.current.has(String(id).trim()));
  }, []);

  const isOrderInAcceptedQueue = useCallback((orderData) => {
    if (!orderData) return false;
    const accepted = useDeliveryStore.getState().acceptedOrders || [];
    return accepted.some((item) => ordersShareIdentity(item, orderData));
  }, []);

  const markOrderIdsProcessed = useCallback((orderData) => {
    if (!orderData) return;
    const ids = [
      orderData.orderMongoId,
      orderData.order_mongo_id,
      orderData.orderId,
      orderData.order_id,
      orderData._id,
      orderData.id,
      orderData.mongoId,
    ].filter(Boolean);
    ids.forEach((id) => processedOrderIdsRef.current.add(String(id).trim()));
  }, []);

  const shouldProcessOrderAlert = (orderData = {}) => {
    const key = getOrderAlertKey(orderData);
    if (!key) return true;
    const now = Date.now();
    const last = lastAlertAtByOrderRef.current.get(key) || 0;
    if (now - last < ALERT_DEDUPE_MS) return false;
    lastAlertAtByOrderRef.current.set(key, now);
    return true;
  };

  const shouldShowBrowserNotification = (orderData = {}) => {
    const key = getOrderAlertKey(orderData);
    if (!key) return true;
    const now = Date.now();
    const last = lastBrowserNotificationAtByOrderRef.current.get(key) || 0;
    if (now - last < BROWSER_NOTIFICATION_DEDUPE_MS) return false;
    lastBrowserNotificationAtByOrderRef.current.set(key, now);
    return true;
  };

  const clearAlertLoopTimer = useCallback(() => {
    if (alertLoopTimerRef.current) {
      clearInterval(alertLoopTimerRef.current);
      alertLoopTimerRef.current = null;
    }
  }, []);

  const stopAlertLoop = useCallback(() => {
    clearAlertLoopTimer();
    alertLoopStartedAtRef.current = 0;

    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.loop = false;
      } catch (_) {}
    }
  }, [clearAlertLoopTimer]);

  const startAlertLoop = useCallback((playSoundFn, orderData) => {
    clearAlertLoopTimer();
    const targetOrder = orderData || activeOrderRef.current;
    if (!targetOrder || isOrderAlertMuted(targetOrder)) return;

    alertLoopStartedAtRef.current = Date.now();

    alertLoopTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - alertLoopStartedAtRef.current;
      if (elapsed >= 10000 || !activeOrderRef.current) {
        stopAlertLoop();
        return;
      }
    }, 1000);
  }, [clearAlertLoopTimer, isOrderAlertMuted, stopAlertLoop]);


  
  const playSynthDeliveryBeep = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      let ctx = window.__deliverySynthCtx;
      if (!ctx) {
        ctx = new AudioCtx();
        window.__deliverySynthCtx = ctx;
      }
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const now = ctx.currentTime;
      const pulses = [
        { start: 0, duration: 0.25, freq: 880 },
        { start: 0.28, duration: 0.25, freq: 1100 },
        { start: 0.56, duration: 0.35, freq: 880 },
      ];
      pulses.forEach(({ start, duration, freq }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + start);
        gain.gain.setValueAtTime(0.9, now + start);
        gain.gain.exponentialRampToValueAtTime(0.001, now + start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + duration);
      });
    } catch (err) {
      debugWarn('Synth delivery beep failed:', err);
    }
  }, []);

  const playNotificationSound = useCallback((orderData = {}) => {
    if (isOrderAlertMuted(orderData)) {
      return;
    }

    // Native bridge must not block the first web ring
    void triggerWebViewNativeNotification(orderData).catch(() => {});

    try {
      if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate([200, 100, 200, 100, 300]);
        } catch (_) {}
      }

      const selectedSound = localStorage.getItem('delivery_alert_sound') || 'zomato_tone';
      const soundFile = selectedSound === 'original'
        ? resolveAudioSource(originalSound, 'delivery-original')
        : resolveAudioSource(alertSound, 'delivery-alert');
      
      if (audioRef.current) {
        const currentSrc = audioRef.current.src;
        const newSrc = soundFile;
        if (!currentSrc.includes(newSrc.split('/').pop())) {
          audioRef.current.pause();
          audioRef.current.src = newSrc;
          audioRef.current.load();
          debugLog('Audio source updated to:', selectedSound === 'original' ? 'Original' : 'Zomato Tone');
        }
      } else {
        audioRef.current = new Audio();
        audioRef.current.src = soundFile;
        audioRef.current.preload = 'auto';
        audioRef.current.volume = 1.0;
        audioRef.current.load();
        debugLog('Audio initialized with:', selectedSound === 'original' ? 'Original' : 'Zomato Tone', 'Source:', soundFile);
      }
      
      if (audioRef.current) {
        audioRef.current.muted = false;
        audioRef.current.volume = 1.0;
        audioRef.current.currentTime = 0;
        audioRef.current.loop = true;
        const p = audioRef.current.play();
        if (p && typeof p.catch === 'function') {
          p.catch(async (error) => {
            debugWarn('HTML5 Audio play failed, running WebAudio synth fallback:', error);
            await playSynthDeliveryBeep();
          });
        }
      } else {
        void playSynthDeliveryBeep();
      }
    } catch (error) {
      void playSynthDeliveryBeep();
    }
  }, [isOrderAlertMuted, playSynthDeliveryBeep]);

  const triggerOrderAlertFor10Sec = useCallback((orderData) => {
    const target = orderData || activeOrderRef.current || newOrder;
    if (!target) return;
    if (isOrderAlertMuted(target)) return;

    activeOrderRef.current = target;
    playNotificationSound(target);
    startAlertLoop(playNotificationSound, target);
  }, [isOrderAlertMuted, playNotificationSound, startAlertLoop, newOrder]);

  const setOrderAlertMuted = useCallback(
    (orderData, nextMuted) => {
      const keys = collectOrderAlertKeys(orderData);
      if (!keys.length) return;

      const muted = Boolean(nextMuted);
      keys.forEach((key) => {
        if (muted) {
          mutedOrderIdsRef.current.add(key);
        } else {
          mutedOrderIdsRef.current.delete(key);
        }
      });
      saveMutedOrderIds();
      setMuteUiTick((tick) => tick + 1);

      if (muted) {
        stopAlertLoop();
        return;
      }

      const targetOrder = orderData || activeOrderRef.current || newOrder;
      if (targetOrder) {
        activeOrderRef.current = targetOrder;
        triggerOrderAlertFor10Sec(targetOrder);
      }
    },
    [saveMutedOrderIds, stopAlertLoop, triggerOrderAlertFor10Sec, newOrder],
  );

  const toggleOrderAlertMuted = useCallback(
    (orderData) => {
      setOrderAlertMuted(orderData, !isOrderAlertMuted(orderData));
    },
    [isOrderAlertMuted, setOrderAlertMuted],
  );

  const stopAlertsWhenQueueEmpty = useCallback(() => {
    const pending = useDeliveryStore.getState().newOrders || [];
    if (pending.length === 0) {
      stopAlertLoop();
      activeOrderRef.current = null;
      setNewOrder(null);
    }
  }, [stopAlertLoop]);

  const showBackgroundOrderNotification = useCallback(async (orderData = {}) => {
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

    const notificationOptions = buildDeliveryOrderNotification(orderData);

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
            icon: '/favicon.ico',
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
        icon: '/favicon.ico',
        data: notificationOptions.data,
      });
    } catch (error) {
      debugWarn('Error showing background delivery notification:', error);
    }
  }, []);

  const handleIncomingOrderAlert = useCallback((orderData = {}) => {
    if (isOrderInAcceptedQueue(orderData)) {
      return;
    }
    if (isProcessedOrder(orderData)) {
      return;
    }
    if (!shouldProcessOrderAlert(orderData)) {
      return;
    }

    const mappedOrder = sanitizeOrderDispatchMetrics(mapOrderLocations(orderData) || orderData);
    const riderLocation = useDeliveryStore.getState().riderLocation;
    if (!isOrderWithinOfferRange(mappedOrder, riderLocation)) {
      debugLog('Ignored out-of-range order offer', {
        orderId: mappedOrder?.orderId || mappedOrder?._id,
      });
      return;
    }
    activeOrderRef.current = mappedOrder || { id: Date.now() };
    useDeliveryStore.getState().addNewOrder(mappedOrder);
    // Play first, then schedule loop (loop must not pause the first play)
    playNotificationSound(mappedOrder);
    startAlertLoop(playNotificationSound);

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      showBackgroundOrderNotification(orderData);
    }
  }, [isOrderInAcceptedQueue, isProcessedOrder, playNotificationSound, showBackgroundOrderNotification, startAlertLoop]);

  const recoverDeliveryState = useCallback(async () => {
    if (!deliveryPartnerId) return;

    try {
      const [availableResult, currentTripResult] = await Promise.allSettled([
        deliveryAPI.getOrders({ limit: 20, page: 1 }),
        deliveryAPI.getCurrentDelivery(),
      ]);

      const currentPayload =
        currentTripResult.status === 'fulfilled'
          ? currentTripResult.value?.data?.data ??
            currentTripResult.value?.data ??
            null
          : null;

      const activeOrders = Array.isArray(currentPayload?.activeOrders)
        ? currentPayload.activeOrders
        : currentPayload?.activeOrder
          ? [currentPayload.activeOrder]
          : [];

      if (currentPayload?.capacity) {
        useDeliveryStore.getState().setCapacity(currentPayload.capacity);
      }

      if (activeOrders.length) {
        useDeliveryStore.getState().setAcceptedOrders(
          activeOrders.map(mapOrderLocations).filter(Boolean),
          { capacity: currentPayload?.capacity },
        );
        return;
      }

      if (currentPayload && (currentPayload._id || currentPayload.orderId)) {
        debugLog('Recovered current delivery trip after reconnect/focus:', currentPayload);
        setOrderStatusUpdate({
          ...currentPayload,
          recoverySource: 'delivery_reconnect',
        });
        return;
      }

      const availablePayload =
        availableResult.status === 'fulfilled'
          ? availableResult.value?.data?.data ??
            availableResult.value?.data ??
            {}
          : {};
      const availableOrders = Array.isArray(availablePayload?.docs)
        ? availablePayload.docs
        : Array.isArray(availablePayload?.items)
          ? availablePayload.items
          : Array.isArray(availablePayload)
            ? availablePayload
            : [];

      const recoverableOrder = availableOrders.find((order) => {
        const dispatchStatus = order?.dispatch?.status;
        const isEligibleStatus = ['unassigned', 'assigned'].includes(dispatchStatus) &&
          ['preparing', 'ready_for_pickup'].includes(order?.orderStatus);
          
        if (!isEligibleStatus) return false;
        
        // Ignore stale test/bugged orders older than 2 hours to prevent sound playing repeatedly on login
        const createdAt = new Date(order.createdAt || order.updatedAt).getTime();
        if (Date.now() - createdAt > 2 * 60 * 60 * 1000) {
          return false;
        }
        
        return true;
      });

      if (availablePayload?.capacity) {
        useDeliveryStore.getState().setCapacity(availablePayload.capacity);
      }

      const newOffers = Array.isArray(availablePayload?.newOffers)
        ? availablePayload.newOffers
        : [];

      newOffers.forEach((order) => useDeliveryStore.getState().addNewOrder(order));

      if (recoverableOrder && !isProcessedOrder(recoverableOrder)) {
        debugLog('Recovered available delivery order after reconnect/focus:', recoverableOrder);
        setNewOrder(recoverableOrder);
        useDeliveryStore.getState().addNewOrder(recoverableOrder);
        handleIncomingOrderAlert(recoverableOrder);
      }
    } catch (error) {
      debugWarn('Delivery recovery sync failed:', error?.message || error);
    }
  }, [deliveryPartnerId, handleIncomingOrderAlert, isProcessedOrder]);

  const joinDeliveryRoomIfPossible = useCallback(() => {
    if (!socketRef.current?.connected || !deliveryPartnerId) {
      return false;
    }

    if (joinedDeliveryRoomRef.current === deliveryPartnerId) {
      return true;
    }

    debugLog('Joining delivery room', {
      deliveryPartnerId,
      socketId: socketRef.current?.id,
    });
    socketRef.current.emit('join-delivery', deliveryPartnerId);
    joinedDeliveryRoomRef.current = deliveryPartnerId;
    return true;
  }, [deliveryPartnerId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    window.__deliverySocketDebug = {
      enabled: shouldLogDeliverySocket(),
      apiBaseUrl: API_BASE_URL,
      get deliveryPartnerId() {
        return deliveryPartnerId;
      },
      get isConnected() {
        return isConnected;
      },
      get socketId() {
        return socketRef.current?.id || null;
      },
      get socketConnected() {
        return Boolean(socketRef.current?.connected);
      },
      forceReconnect() {
        if (socketRef.current) {
          socketRef.current.connect();
        }
      },
      dump() {
        return {
          enabled: shouldLogDeliverySocket(),
          apiBaseUrl: API_BASE_URL,
          deliveryPartnerId,
          isConnected,
          socketId: socketRef.current?.id || null,
          socketConnected: Boolean(socketRef.current?.connected),
          socketAuthTokenPresent: Boolean(
            localStorage.getItem('delivery_accessToken') || localStorage.getItem('accessToken')
          ),
        };
      },
    };

    return () => {
      if (window.__deliverySocketDebug) {
        delete window.__deliverySocketDebug;
      }
    };
  }, [deliveryPartnerId, isConnected]);

  // Step 4: All effects (unconditional hook calls, conditional logic inside)
  useEffect(() => {
    if (!supportsBrowserNotifications()) return;

    if (Notification.permission !== 'default') return;
    if (localStorage.getItem(NOTIFICATION_PERMISSION_ASKED_KEY) === 'true') return;

    const requestPermissionOnce = async () => {
      localStorage.setItem(NOTIFICATION_PERMISSION_ASKED_KEY, 'true');
      try {
        await Notification.requestPermission();
      } catch (error) {
        debugWarn('Failed to request delivery notification permission:', error);
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

  useEffect(() => {
    const onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'hidden') return;
      if (!activeOrderRef.current) return;

      playNotificationSound(activeOrderRef.current);
      showBackgroundOrderNotification(activeOrderRef.current);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [playNotificationSound, showBackgroundOrderNotification]);

  // Track user interaction for autoplay policy (one-time audio unlock)
  useEffect(() => {
    const handleUserInteraction = async () => {
      userInteractedRef.current = true;
      if (typeof window !== 'undefined') {
        window.__userHasInteracted = true;
      }

      const selectedSound = localStorage.getItem('delivery_alert_sound') || 'zomato_tone';
      const soundFile = selectedSound === 'original'
        ? resolveAudioSource(originalSound, 'delivery-original')
        : resolveAudioSource(alertSound, 'delivery-alert');

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        try {
          if (!window.__deliverySynthCtx) {
            window.__deliverySynthCtx = new AudioCtx();
          }
          if (window.__deliverySynthCtx.state === 'suspended') {
            await window.__deliverySynthCtx.resume();
          }
          const buf = window.__deliverySynthCtx.createBuffer(1, 1, 22050);
          const srcNode = window.__deliverySynthCtx.createBufferSource();
          srcNode.buffer = buf;
          srcNode.connect(window.__deliverySynthCtx.destination);
          srcNode.start(0);
        } catch (_) {}
      }

      if (!audioRef.current) {
        audioRef.current = new Audio(soundFile);
        audioRef.current.preload = 'auto';
        audioRef.current.volume = 1.0;
      }

      if (!audioUnlockAttemptedRef.current && audioRef.current) {
        audioUnlockAttemptedRef.current = true;
        try {
          audioRef.current.muted = true;
          if (!audioRef.current.src || audioRef.current.src === window.location.href) {
            audioRef.current.src = soundFile;
          }
          audioRef.current.load();
          await audioRef.current.play();
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          debugLog('?? Audio unlocked successfully');
        } catch (error) {
          audioUnlockAttemptedRef.current = false;
          if (!error.message?.includes('user didn\'t interact') && !error.name?.includes('NotAllowedError')) {
            debugWarn('Error unlocking notification audio:', error, 'Audio src:', audioRef.current?.src);
          }
        } finally {
          if (audioRef.current) {
            audioRef.current.muted = false;
          }
        }
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
  
  // Initialize audio on mount - use selected preference from localStorage
  useEffect(() => {
    // Get selected alert sound preference from localStorage
    const selectedSound = localStorage.getItem('delivery_alert_sound') || 'zomato_tone';
    const soundFile = selectedSound === 'original'
      ? resolveAudioSource(originalSound, 'delivery-original')
      : resolveAudioSource(alertSound, 'delivery-alert');
    
    if (!audioRef.current) {
      audioRef.current = new Audio(soundFile);
      audioRef.current.preload = 'auto';
      audioRef.current.volume = 0.7;
      debugLog('?? Audio initialized with:', selectedSound === 'original' ? 'Original' : 'Zomato Tone');
    } else {
      // Update audio source if preference changed
      const currentSrc = audioRef.current.src;
      const newSrc = soundFile;
      if (!currentSrc.includes(newSrc.split('/').pop())) {
        audioRef.current.pause();
        audioRef.current.src = newSrc;
        audioRef.current.load();
        debugLog('?? Audio updated to:', selectedSound === 'original' ? 'Original' : 'Zomato Tone');
      }
    }
    
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []); // Note: This runs once on mount. To update dynamically, we'd need to listen to storage events

  // Fetch delivery partner ID
  useEffect(() => {
    const fallbackId = resolveDeliveryPartnerIdFromClient();
    if (fallbackId) {
      setDeliveryPartnerId(fallbackId);
      debugLog('? Delivery Partner ID restored from local client auth:', fallbackId);
    }

    const fetchDeliveryPartnerId = async () => {
      try {
        const response = await deliveryAPI.getMe();
        if (response.data?.success && response.data.data) {
          const deliveryPartner = response.data.data.user || response.data.data.deliveryPartner;
          if (deliveryPartner) {
            const id = deliveryPartner.id?.toString() || 
                      deliveryPartner._id?.toString() || 
                      deliveryPartner.deliveryId;
            if (id) {
              setDeliveryPartnerId(id);
              debugLog('? Delivery Partner ID fetched:', id);
            } else {
              debugWarn('?? Could not extract delivery partner ID from response');
            }
          } else {
            debugWarn('?? No delivery partner data in API response');
          }
        } else {
          debugWarn('?? Could not fetch delivery partner ID from API');
        }
      } catch (error) {
        debugError('Error fetching delivery partner:', error);
      }
    };
    fetchDeliveryPartnerId();
  }, []);

  // Socket connection effect (no backend when API_BASE_URL is empty)
  useEffect(() => {
    if (!API_BASE_URL || !String(API_BASE_URL).trim()) {
      setIsConnected(false);
      return;
    }

    // IMPORTANT: Socket.IO server is on the origin (not /api/v1).
    // Our API baseURL is typically like: http://localhost:5000/api/v1
    // So for sockets we always connect to: http://localhost:5000
    let backendUrl = API_BASE_URL;
    try {
      const base =
        String(backendUrl).startsWith('http')
          ? undefined
          : (typeof window !== 'undefined' ? window.location.origin : undefined);
      backendUrl = new URL(backendUrl, base).origin;
    } catch {
      // best-effort fallback: strip common API prefixes
      backendUrl = String(backendUrl || "")
        .replace(/\/api\/v\d+\/?$/i, "")
        .replace(/\/api\/?$/i, "")
        .replace(/\/+$/, "");

      if ((!backendUrl || !backendUrl.startsWith('http')) && typeof window !== 'undefined') {
        backendUrl = window.location.origin;
      }
    }
    
    // Backend uses default namespace; rooms handle role separation.
    const socketUrl = `${backendUrl}`;
    
    debugLog('?? Attempting to connect to Delivery Socket.IO:', socketUrl);
    debugLog('?? Backend URL:', backendUrl);
    debugLog('?? API_BASE_URL:', API_BASE_URL);
    debugLog('?? Delivery Partner ID:', deliveryPartnerId);
    debugLog('?? Environment: (ui-only mode)');
    
    // Block localhost only in production builds. In dev, localhost is expected.
    if (import.meta.env.PROD && backendUrl.includes('localhost')) {
      debugError('? CRITICAL: Trying to connect Socket.IO to localhost in production!');
      debugError('?? Current socketUrl:', socketUrl);
      debugError('?? Current API_BASE_URL:', API_BASE_URL);
      setIsConnected(false);
      return;
    }
    
    // Validate backend URL format
    if (!backendUrl || !backendUrl.startsWith('http')) {
      debugError('? CRITICAL: Invalid backend URL format:', backendUrl);
      debugError('?? API_BASE_URL:', API_BASE_URL);
      debugError('?? Expected format: https://your-domain.com or ');
      return; // Don't try to connect with invalid URL
    }
    
    // Validate socket URL format
    try {
      new URL(socketUrl); // This will throw if URL is invalid
    } catch (urlError) {
      debugError('? CRITICAL: Invalid Socket.IO URL:', socketUrl);
      debugError('?? URL validation error:', urlError.message);
      debugError('?? Backend URL:', backendUrl);
      debugError('?? API_BASE_URL:', API_BASE_URL);
      return; // Don't try to connect with invalid URL
    }

    const token = localStorage.getItem('delivery_accessToken') || localStorage.getItem('accessToken');
    const tokenPreview = token ? `${String(token).slice(0, 12)}...` : null;
    debugLog('Preparing socket auth payload', {
      tokenPresent: Boolean(token),
      tokenPreview,
      deliveryPartnerId,
      socketUrl,
    });

    socketRef.current = io(socketUrl, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'], // WebSocket first for instant connection
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
      auth: {
        token: token || ""
      },
      query: token ? { token } : undefined,
    });

    debugLog('Socket.IO client created', {
      socketUrl,
      path: '/socket.io/',
      transports: ['polling', 'websocket'],
      tokenPresent: Boolean(token),
      tokenPreview,
      deliveryPartnerId,
    });

    socketRef.current.on('connect', () => {
      debugLog('Socket connected', {
        socketId: socketRef.current?.id,
        deliveryPartnerId,
        transport: socketRef.current?.io?.engine?.transport?.name || 'unknown',
      });
      setIsConnected(true);

      joinedDeliveryRoomRef.current = null;
      if (!joinDeliveryRoomIfPossible()) {
        debugLog('Socket connected before deliveryPartnerId was ready; waiting to join room.');
      }
      debugLog('Requesting resync after connect', {
        deliveryPartnerId,
        socketId: socketRef.current?.id,
      });
      socketRef.current.emit('resync');
      void recoverDeliveryState();
    });

    socketRef.current.on('delivery-room-joined', (data) => {
      debugLog('Delivery room joined successfully', data);
    });

    socketRef.current.on('resync_complete', (data) => {
      debugLog('Resync completed', data);
    });

    socketRef.current.on('connect_error', (error) => {
      debugError('Socket connection error', {
        message: error?.message,
        type: error?.type,
        description: error?.description,
        context: error?.context,
        data: error?.data,
        socketUrl,
        apiBaseUrl: API_BASE_URL,
        deliveryPartnerId,
        tokenPresent: Boolean(token),
        tokenPreview,
        transport: socketRef.current?.io?.engine?.transport?.name || 'unknown',
      });
      setIsConnected(false);
    });

    socketRef.current.on('disconnect', (reason) => {
      debugWarn('Socket disconnected', {
        reason,
        socketId: socketRef.current?.id,
        deliveryPartnerId,
      });
      setIsConnected(false);
      joinedDeliveryRoomRef.current = null;
      
      if (reason === 'io server disconnect') {
        socketRef.current.connect();
      }
    });

    socketRef.current.on('reconnect_attempt', (attemptNumber) => {
      debugWarn('Reconnection attempt', {
        attemptNumber,
        socketUrl,
        deliveryPartnerId,
      });
    });

    socketRef.current.on('reconnect', (attemptNumber) => {
      debugLog('Socket reconnected', {
        attemptNumber,
        socketId: socketRef.current?.id,
        deliveryPartnerId,
        transport: socketRef.current?.io?.engine?.transport?.name || 'unknown',
      });
      setIsConnected(true);

      joinedDeliveryRoomRef.current = null;
      joinDeliveryRoomIfPossible();
      socketRef.current.emit('resync');
      void recoverDeliveryState();
    });

    socketRef.current.on('new_order', (orderData) => {
      debugLog('New order received via socket', {
        orderId: orderData?.orderId || orderData?.orderMongoId || orderData?._id,
        dispatchStatus: orderData?.dispatch?.status,
      });
      if (isOrderInAcceptedQueue(orderData) || isProcessedOrder(orderData)) {
        return;
      }
      setNewOrder(orderData);
      handleIncomingOrderAlert(orderData);
    });

    // Same payload as new_order — also ring so retry-only offers are not silent
    socketRef.current.on('new_order_available', (orderData) => {
      debugLog('New order available received via socket', {
        orderId: orderData?.orderId || orderData?.orderMongoId || orderData?._id,
        phase: orderData?.phase || 'unknown',
        dispatchStatus: orderData?.dispatch?.status,
      });
      if (isOrderInAcceptedQueue(orderData) || isProcessedOrder(orderData)) {
        return;
      }
      setNewOrder(orderData);
      handleIncomingOrderAlert(orderData);
    });

    socketRef.current.on('active_orders', (orders = []) => {
      if (!Array.isArray(orders) || orders.length === 0) return;
      useDeliveryStore.getState().setAcceptedOrders(
        orders.map(mapOrderLocations).filter(Boolean),
      );
    });

    socketRef.current.on('delivery_capacity', (capacity) => {
      if (capacity) {
        useDeliveryStore.getState().setCapacity(capacity);
      }
    });

    socketRef.current.on('active_order', (orderData) => {
      if (!orderData) return;
      const mapped = mapOrderLocations(orderData);
      if (mapped) {
        markOrderIdsProcessed(mapped);
        clearOrderMuteState(mapped);
        useDeliveryStore.getState().acceptOrderToQueue(mapped);
        stopAlertLoop();
        activeOrderRef.current = null;
        setNewOrder(null);
      }
    });

    socketRef.current.on('play_notification_sound', (data) => {
      debugLog('play_notification_sound received', {
        orderId: data?.orderId || data?.orderMongoId || data?.order_id,
      });
      const normalizedData = {
        orderId: data?.orderId || data?.order_id,
        orderMongoId: data?.orderMongoId || data?.order_mongo_id,
        ...data
      };
      if (isOrderAlertMuted(normalizedData) || isOrderInAcceptedQueue(normalizedData) || isProcessedOrder(normalizedData)) {
        return;
      }
      handleIncomingOrderAlert(normalizedData);
    });

    socketRef.current.on('order_ready', (orderData) => {
      debugLog('order_ready received via socket', {
        orderId: orderData?.orderId || orderData?.orderMongoId || orderData?._id,
      });
      setOrderReady(orderData);
      playNotificationSound(orderData);
    });

    socketRef.current.on('order_status_update', (statusData) => {
      debugLog('?? Delivery order status update received via socket:', statusData);
      setOrderStatusUpdate(statusData || null);
    });

    socketRef.current.on('order_cancelled', (statusData) => {
      debugLog('?? Delivery order cancelled event received via socket:', statusData);
      setOrderStatusUpdate({
        ...(statusData || {}),
        status: 'cancelled'
      });
    });

    socketRef.current.on('order_deleted', (statusData) => {
      debugLog('?? Delivery order deleted event received via socket:', statusData);
      setOrderStatusUpdate({
        ...(statusData || {}),
        status: 'deleted'
      });
    });

    const handleOfferTakenElsewhere = (data, { showToast }) => {
      const claimedId = data?.orderId || data?.orderMongoId || data?.order_id;
      const claimedBy = String(data?.claimedBy || '');
      const isSelf =
        Boolean(claimedBy) &&
        Boolean(deliveryPartnerId) &&
        claimedBy === String(deliveryPartnerId);

      if (claimedId) {
        markOrderIdsProcessed({ _id: claimedId, orderId: claimedId, orderMongoId: claimedId });
        useDeliveryStore.getState().removeNewOrder(claimedId);
        setClaimedOrderId(claimedId);
      }

      if (showToast && !isSelf) {
        toast.info('This request accepted by another rider', {
          id: `order-claimed-${claimedId || 'unknown'}`,
          duration: 4000,
        });
      }

      const remaining = useDeliveryStore.getState().newOrders || [];
      if (remaining.length > 0) {
        const nextOffer = remaining[0];
        activeOrderRef.current = nextOffer;
        setNewOrder(nextOffer);
        if (!isOrderAlertMuted(nextOffer)) {
          playNotificationSound(nextOffer);
          startAlertLoop(playNotificationSound);
        } else {
          stopAlertLoop();
        }
        return;
      }

      stopAlertLoop();
      activeOrderRef.current = null;
      setNewOrder(null);
    };

    socketRef.current.on('order_reassigned_elsewhere', (data) => {
      debugLog('?? Order reassigned to another partner:', data);
      handleOfferTakenElsewhere(data, { showToast: true });
    });

    // Backend emits 'order_claimed' when another delivery boy accepts an offered order
    socketRef.current.on('order_claimed', (data) => {
      debugLog('?? order_claimed received - order taken by another partner:', data);
      handleOfferTakenElsewhere(data, { showToast: true });
    });

    socketRef.current.on('admin_notification', (payload) => {
      debugLog('Admin broadcast received via socket', payload);
      setAdminNotification(payload);
      dispatchNotificationInboxRefresh();
    });

    // Auth change/refresh listeners
    const handleAuthChange = () => {
      const newToken = localStorage.getItem('delivery_accessToken') || localStorage.getItem('accessToken');
      if (socketRef.current && newToken) {
        debugLog('?? Auth changed, updating socket token');
        socketRef.current.auth.token = newToken;
        // Only reconnect if not already connecting/connected or if token changed significantly
        if (!socketRef.current.connected) {
          socketRef.current.connect();
        }
      }
    };

    const handleAuthRefreshed = (e) => {
      if (e.detail?.module === 'delivery' && socketRef.current && e.detail.token) {
        debugLog('?? Auth refreshed for delivery, updating socket token');
        socketRef.current.auth.token = e.detail.token;
        if (!socketRef.current.connected) {
          socketRef.current.connect();
        }
      }
    };

    const handleWindowFocus = () => {
      void recoverDeliveryState();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void recoverDeliveryState();
      }
    };

    window.addEventListener('deliveryAuthChanged', handleAuthChange);
    window.addEventListener('authRefreshed', handleAuthRefreshed);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      debugLog('? Cleaning up socket connection...');
      stopAlertLoop();
      joinedDeliveryRoomRef.current = null;
      window.removeEventListener('deliveryAuthChanged', handleAuthChange);
      window.removeEventListener('authRefreshed', handleAuthRefreshed);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [deliveryPartnerId, handleIncomingOrderAlert, isOrderAlertMuted, isOrderInAcceptedQueue, isProcessedOrder, joinDeliveryRoomIfPossible, markOrderIdsProcessed, clearOrderMuteState, playNotificationSound, recoverDeliveryState, showBackgroundOrderNotification, startAlertLoop, stopAlertLoop]);

  useEffect(() => {
    if (!deliveryPartnerId) {
      debugLog('? Waiting for deliveryPartnerId...');
      return;
    }

    joinDeliveryRoomIfPossible();

    if (socketRef.current?.connected) {
      debugLog('Requesting resync after deliveryPartnerId resolved', {
        deliveryPartnerId,
        socketId: socketRef.current?.id,
      });
      socketRef.current.emit('resync');
      void recoverDeliveryState();
    }
  }, [deliveryPartnerId, joinDeliveryRoomIfPossible, recoverDeliveryState]);

  // Helper functions
  const clearNewOrder = useCallback((orderOrId) => {
    const target = orderOrId || newOrder || activeOrderRef.current;
    if (target) {
      if (typeof target === 'object') {
        markOrderIdsProcessed(target);
        clearOrderMuteState(target);
      } else {
        processedOrderIdsRef.current.add(String(target).trim());
        clearOrderMuteState(target);
      }
    }
    stopAlertLoop();
    activeOrderRef.current = null;
    setNewOrder(null);
    const removeId =
      typeof target === 'object'
        ? resolveOrderKey(target)
        : String(target || '').trim();
    if (removeId) {
      useDeliveryStore.getState().removeNewOrder(removeId);
    }
    stopAlertsWhenQueueEmpty();
  }, [clearOrderMuteState, markOrderIdsProcessed, newOrder, stopAlertLoop, stopAlertsWhenQueueEmpty]);

  const clearClaimedOrderId = () => setClaimedOrderId(null);

  const clearOrderReady = () => {
    setOrderReady(null);
  };

  const clearOrderStatusUpdate = () => {
    setOrderStatusUpdate(null);
  };

  const clearAdminNotification = () => {
    setAdminNotification(null);
  };

  const emitLocation = useCallback((data) => {
    if (socketRef.current && socketRef.current.connected) {
      // debugLog('? Emitting location via socket:', data);
      socketRef.current.emit('update-location', data);
      return true;
    }
    return false;
  }, []);

  return {
    newOrder,
    clearNewOrder,
    orderReady,
    clearOrderReady,
    orderStatusUpdate,
    clearOrderStatusUpdate,
    adminNotification,
    clearAdminNotification,
    claimedOrderId,
    clearClaimedOrderId,
    isConnected,
    playNotificationSound,
    stopSound: stopAlertLoop,
    triggerOrderAlertFor10Sec,
    isOrderAlertMuted,
    setOrderAlertMuted,
    toggleOrderAlertMuted,
    muteUiTick,
    emitLocation
  };
};


