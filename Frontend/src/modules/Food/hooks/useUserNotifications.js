import { useEffect, useState } from 'react';
import io from 'socket.io-client';
import { toast } from 'sonner';
import { API_BASE_URL } from '@food/api/config';
import { userAPI } from '@food/api';
import { dispatchNotificationInboxRefresh } from '@food/hooks/useNotificationInbox';
import { isModuleAuthenticated } from '@food/utils/auth';
import { shouldSkipDuplicateOsNotification } from '@food/utils/firebaseMessaging';

const debugLog = (...args) => {
  if (import.meta.env.DEV) {
    console.log('📬 [UserSocket]', ...args);
  }
};

/** Fired on every (re)connect so screens refetch whatever they missed while offline. */
export const ORDER_REALTIME_RESYNC_EVENT = 'orderRealtimeResync';

const DROP_OTP_TOAST_ID = 'user-delivery-drop-otp';
const DROP_OTP_DEDUPE_MS = 15000;
const ORDER_STATUS_DEDUPE_MS = 4000;
/** Keeps the socket through route changes and StrictMode's mount/unmount/mount. */
const IDLE_DISCONNECT_MS = 5000;

/*
 * ONE socket for the whole user app.
 *
 * This hook used to open its own connection per caller - UserLayout and the
 * order tracking page both call it. socket.io-client hands back the same cached
 * socket for the same URL, so both callers attached their own handlers (every
 * status event was dispatched twice), and when the tracking page unmounted its
 * cleanup disconnected that shared socket - killing live updates for the layout
 * and every other screen until the tracking page was opened again. The tracking
 * page also never saw 'connect' for a socket that was already up, so it thought
 * it was offline.
 *
 * Now the connection lives at module level: handlers are attached exactly once,
 * callers are ref-counted, and it closes only when nobody has used it for a
 * few seconds.
 */
const shared = {
  socket: null,
  token: null,
  userId: null,
  refCount: 0,
  isConnected: false,
  idleTimer: null,
  listeners: new Set(),
  lastDropOtp: { key: '', at: 0 },
  lastStatusToast: { key: '', at: 0 },
};

let userIdPromise = null;
/** Token the cached id was resolved for; a different token means a different session. */
let userIdPromiseToken = null;

const setConnected = (value) => {
  shared.isConnected = value;
  if (typeof window !== 'undefined') {
    window.orderSocketConnected = value;
    window.dispatchEvent(
      new CustomEvent('userSocketConnectionChange', { detail: { isConnected: value } }),
    );
  }
  shared.listeners.forEach((fn) => fn(value));
};

const readUserToken = () => {
  try {
    return localStorage.getItem('user_accessToken') || localStorage.getItem('accessToken');
  } catch {
    return null;
  }
};

const resolveSocketUrl = () => {
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return String(API_BASE_URL || '')
      .replace(/\/api\/v\d+\/?$/i, '')
      .replace(/\/api\/?$/i, '')
      .replace(/\/+$/, '');
  }
};

/** Resolve the signed-in user's id once per session instead of once per caller. */
const fetchUserIdOnce = () => {
  const token = readUserToken();
  if (userIdPromise && userIdPromiseToken !== token) userIdPromise = null;
  if (!userIdPromise) {
    userIdPromiseToken = token;
    userIdPromise = userAPI
      .getProfile()
      .then((response) => {
        const user = response?.data?.success ? response.data.data?.user : null;
        return user ? String(user._id || user.userId || user.id || '') || null : null;
      })
      .catch(() => null)
      .then((id) => {
        // Don't cache a failure - let the next caller retry.
        if (!id) userIdPromise = null;
        return id;
      });
  }
  return userIdPromise;
};

const teardownSocket = () => {
  if (shared.idleTimer) {
    clearTimeout(shared.idleTimer);
    shared.idleTimer = null;
  }
  if (shared.socket) {
    try {
      shared.socket.removeAllListeners();
      shared.socket.disconnect();
    } catch {
      /* already gone */
    }
  }
  shared.socket = null;
  shared.token = null;
  shared.userId = null;
  if (shared.isConnected) setConnected(false);
};

function handleOrderStatusUpdate(data = {}) {
  debugLog('🔔 Order status update received:', data);

  const rawOrderId = String(data.orderId || '');
  const mongoId = String(data.orderMongoId || data._id || '');
  const displayId = String(data.displayOrderId || data.orderDisplayId || '');
  const readableId =
    displayId ||
    (rawOrderId.length > 20 ? `FOD-${rawOrderId.slice(-6).toUpperCase()}` : rawOrderId) ||
    'Update';

  const rawTitle = String(data.title || '');
  const title =
    rawTitle && (!rawOrderId || !rawTitle.includes(rawOrderId) || rawOrderId.length <= 20)
      ? rawTitle
      : `Order #${readableId}`;
  const message =
    data.message || `Your order status is now ${String(data.orderStatus || '').replace(/_/g, ' ')}`;

  const isImportant =
    String(data.orderStatus || data.status || '').includes('cancel') ||
    ['ready_for_pickup', 'ready', 'confirmed', 'delivered', 'out_for_delivery', 'picked_up', 'at_drop', 'on_way'].includes(
      data.orderStatus || data.status,
    );

  const statusKey = `${mongoId || readableId}:${String(data.orderStatus || data.status || '')}`;
  const now = Date.now();
  const isDuplicateToast =
    statusKey === shared.lastStatusToast.key &&
    now - shared.lastStatusToast.at < ORDER_STATUS_DEDUPE_MS;

  if (isImportant && !isDuplicateToast && !shouldSkipDuplicateOsNotification(data)) {
    shared.lastStatusToast = { key: statusKey, at: now };
    window.dispatchEvent(
      new CustomEvent('show-user-notification-toast', { detail: { title, message } }),
    );
    if (data.orderStatus === 'delivered' || data.status === 'delivered') {
      dispatchNotificationInboxRefresh();
    }
  }

  window.dispatchEvent(
    new CustomEvent('orderStatusNotification', {
      detail: {
        orderMongoId: mongoId || undefined,
        orderId: rawOrderId || undefined,
        displayOrderId: readableId,
        status: data.orderStatus || data.status,
        orderStatus: data.orderStatus || data.status,
        dispatchStatus: data.dispatchStatus,
        deliveryPartnerId: data.deliveryPartnerId,
        deliveryState: data.deliveryState,
        deliveryVerification: data.deliveryVerification,
        cancellationReason: data.cancellationReason,
        cancelledBy: data.cancelledBy,
        cancelledAt: data.cancelledAt,
        note: data.note,
        updatedAt: data.updatedAt,
        title,
        message,
        timestamp: new Date().toISOString(),
      },
    }),
  );
}

function handleDropOtp(payload = {}) {
  debugLog('🔐 Delivery handover OTP:', payload?.orderId);
  const otp = payload?.otp != null ? String(payload.otp) : '';
  const orderId = payload?.orderId != null ? String(payload.orderId) : '';
  const message = payload?.message != null ? String(payload.message) : '';

  const otpKey = `${orderId}:${otp}`;
  const now = Date.now();
  if (otpKey === shared.lastDropOtp.key && now - shared.lastDropOtp.at < DROP_OTP_DEDUPE_MS) {
    return;
  }
  shared.lastDropOtp = { key: otpKey, at: now };

  window.dispatchEvent(
    new CustomEvent('deliveryDropOtp', {
      detail: {
        orderMongoId: payload?.orderMongoId,
        orderId,
        otp,
        message,
        orderType: payload?.orderType || 'delivery',
      },
    }),
  );
  const isTakeaway = payload?.orderType === 'takeaway';
  const title = orderId
    ? `Order #${orderId} — ${isTakeaway ? 'Takeaway OTP' : 'Delivery OTP'}`
    : isTakeaway
      ? 'Takeaway OTP'
      : 'Delivery OTP';
  const parts = [message, otp ? `OTP: ${otp}` : ''].filter(Boolean);

  toast.dismiss(DROP_OTP_TOAST_ID);
  toast.message(title, {
    id: DROP_OTP_TOAST_ID,
    description:
      parts.join(' — ') ||
      (isTakeaway
        ? 'Verification OTP for your takeaway pickup.'
        : 'Handover OTP from your delivery partner.'),
    duration: 12_000,
  });
}

const ensureSocket = (userId) => {
  if (!API_BASE_URL || !String(API_BASE_URL).trim() || !userId) return;
  const token = readUserToken();
  if (!token) return;

  // Same user, same token: reuse. A different account or a new token means the
  // old connection is authenticated as someone else - replace it.
  if (shared.socket && shared.userId === userId && shared.token === token) return;
  if (shared.socket) teardownSocket();

  const socketUrl = resolveSocketUrl();
  debugLog('🔌 Connecting to User Socket.IO:', socketUrl);

  const socket = io(socketUrl, {
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    auth: { token },
    // Own manager: no other caller can hand back or tear down this connection.
    forceNew: true,
  });

  shared.socket = socket;
  shared.token = token;
  shared.userId = userId;

  socket.on('connect', () => {
    debugLog('✅ User Socket connected, userId:', userId);
    setConnected(true);
    // Covers both first connect and every reconnect: status changes that
    // happened while offline were never delivered, so screens must refetch.
    window.dispatchEvent(new CustomEvent(ORDER_REALTIME_RESYNC_EVENT));
  });

  socket.on('catalog_changed', (payload) => {
    window.dispatchEvent(new CustomEvent('catalog-changed', { detail: payload || {} }));
  });

  socket.on('order_status_update', handleOrderStatusUpdate);
  socket.on('delivery_drop_otp', handleDropOtp);

  socket.on('dining_booking_update', (payload) => {
    debugLog('🍽️ Dining booking update:', payload);
    window.dispatchEvent(new CustomEvent('diningBookingStatusUpdate', { detail: payload }));
  });

  socket.on('admin_notification', (payload) => {
    window.dispatchEvent(
      new CustomEvent('show-user-notification-toast', {
        detail: { title: payload?.title || 'Notification', message: payload?.message || '' },
      }),
    );
    dispatchNotificationInboxRefresh();
  });

  socket.on('connect_error', () => setConnected(false));

  socket.on('disconnect', (reason) => {
    debugLog('🔌 Socket disconnected:', reason);
    setConnected(false);
    // Server-initiated disconnects are not retried automatically by socket.io.
    if (reason === 'io server disconnect' && shared.socket === socket) {
      const fresh = readUserToken();
      if (fresh) {
        socket.auth = { token: fresh };
        shared.token = fresh;
        socket.connect();
      }
    }
  });
};

if (typeof window !== 'undefined') {
  // Keep the live connection authenticated across silent token refreshes.
  window.addEventListener('authRefreshed', (event) => {
    const detail = event?.detail || {};
    if (detail.module && detail.module !== 'user') return;
    if (!shared.socket || !detail.token) return;
    shared.socket.auth = { token: detail.token };
    shared.token = detail.token;
    if (!shared.socket.connected) shared.socket.connect();
  });
}

/**
 * Real-time order notifications for the signed-in user.
 * Dispatches 'orderStatusNotification' for tracking screens and cards, and
 * ORDER_REALTIME_RESYNC_EVENT whenever the connection (re)establishes.
 */
export const useUserNotifications = () => {
  const [isConnected, setIsConnected] = useState(shared.isConnected);

  useEffect(() => {
    let cancelled = false;
    shared.refCount += 1;
    if (shared.idleTimer) {
      clearTimeout(shared.idleTimer);
      shared.idleTimer = null;
    }

    const onChange = (value) => {
      if (!cancelled) setIsConnected(value);
    };
    shared.listeners.add(onChange);
    setIsConnected(shared.isConnected);

    if (isModuleAuthenticated('user')) {
      fetchUserIdOnce().then((id) => {
        if (!cancelled && id) ensureSocket(id);
      });
    }

    return () => {
      cancelled = true;
      shared.listeners.delete(onChange);
      shared.refCount = Math.max(0, shared.refCount - 1);
      if (shared.refCount === 0 && !shared.idleTimer) {
        shared.idleTimer = setTimeout(() => {
          shared.idleTimer = null;
          if (shared.refCount === 0) {
            teardownSocket();
            userIdPromise = null;
          }
        }, IDLE_DISCONNECT_MS);
      }
    };
  }, []);

  return { isConnected };
};
