import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { deliveryAPI } from '@food/api';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { getHaversineDistance, calculateHeading } from '@/modules/DeliveryV2/utils/geo';

/**
 * The rider app's single GPS source and live-location publisher.
 *
 * Mounted once in DeliveryRealtimeShell, so it runs on every delivery screen.
 * It used to live inside the Feed map with a callback frozen at mount time:
 * the active order captured there was usually `null` (the rider went online
 * before accepting), so no order location was ever published, and switching to
 * another tab stopped GPS altogether. Customers therefore never saw the bike.
 *
 * Transports:
 *  - socket `update-location` — low latency while the app is in the foreground;
 *  - HTTP availability heartbeat — keeps working when the socket drops (app
 *    backgrounded, network switch). The server publishes from both, and resolves
 *    which orders the rider is assigned to itself.
 *
 * No fallback or simulated coordinates are ever used: without a real fix the
 * rider is told why and nothing is published.
 */

const GEO_OPTIONS = { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 };
const SOCKET_MIN_INTERVAL_MS = 2000;
const SOCKET_MAX_SILENCE_MS = 5000;
const SOCKET_MIN_MOVE_M = 8;
const HTTP_HEARTBEAT_MS = 10000;
const HTTP_FALLBACK_MS = 4000;
/** Ignore a very inaccurate fix when a reasonably accurate one arrived recently. */
const POOR_ACCURACY_M = 150;
const GOOD_FIX_FRESH_MS = 15000;
const GPS_TOAST_ID = 'rider-gps-status';

/** Kept for existing imports. */
export function isOrdersRoute(pathname = '') {
  return /\/orders\/?$/.test(pathname) || pathname.endsWith('/orders');
}

/*
 * Simulation switch (test builds only - see VITE_ENABLE_MAP_SIMULATION).
 *
 * While the test ride is running, the phone's real GPS must not publish: the
 * two would fight, and the customer would see the bike jump between the
 * simulated route and the phone's actual position. Paused means the watch keeps
 * running (so the fix is still fresh the moment the test stops) but nothing is
 * sent to the server. Real riders never reach this: the button that flips it is
 * not rendered unless the build enables simulation.
 */
let riderGpsPaused = false;
export const setRiderGpsPaused = (paused) => {
  riderGpsPaused = Boolean(paused);
};
export const isRiderGpsPaused = () => riderGpsPaused;

const describeGpsError = (error) => {
  if (!error) return null;
  if (error.code === 1) {
    return {
      kind: 'permission_denied',
      title: 'Location permission denied',
      description: 'Allow location access for this app in your phone settings. Customers cannot track your delivery without it.',
    };
  }
  if (error.code === 2) {
    return {
      kind: 'unavailable',
      title: 'GPS signal unavailable',
      description: 'Turn on location/GPS and move to an open area. Retrying automatically.',
    };
  }
  return {
    kind: 'timeout',
    title: 'Waiting for GPS…',
    description: 'Your location is taking longer than usual. Retrying automatically.',
  };
};

export function useRiderLocationSync({ emitLocation, isSocketConnected } = {}) {
  const isOnline = useDeliveryStore((state) => state.isOnline);
  const hasActiveOrder = useDeliveryStore((state) => (state.acceptedOrders || []).length > 0);
  const setRiderLocation = useDeliveryStore((state) => state.setRiderLocation);
  const setGpsError = useDeliveryStore((state) => state.setGpsError);

  // A rider carrying an order is tracked even if they toggled themselves offline.
  const shouldTrack = isOnline || hasActiveOrder;

  const emitRef = useRef(emitLocation);
  const socketConnectedRef = useRef(Boolean(isSocketConnected));
  const isOnlineRef = useRef(isOnline);
  emitRef.current = emitLocation;
  socketConnectedRef.current = Boolean(isSocketConnected);
  isOnlineRef.current = isOnline;

  const lastFixRef = useRef(null);
  const lastGoodFixAtRef = useRef(0);
  const lastSocketRef = useRef({ at: 0, lat: null, lng: null });
  const lastHttpAtRef = useRef(0);
  const timeoutCountRef = useRef(0);
  const errorShownRef = useRef(null);

  useEffect(() => {
    if (!shouldTrack) return undefined;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError?.({ kind: 'unsupported', title: 'Location not supported on this device' });
      return undefined;
    }

    let disposed = false;
    let trailingTimer = null;

    const publish = (fix, { force = false } = {}) => {
      // A simulated test ride owns the published position while it runs.
      if (riderGpsPaused) return;
      const now = Date.now();
      const state = useDeliveryStore.getState();
      const activeOrders = state.acceptedOrders || [];
      const focused = typeof state.getFocusedOrder === 'function' ? state.getFocusedOrder() : null;
      const orderId = focused?.orderId || focused?._id || activeOrders[0]?.orderId || activeOrders[0]?._id || null;

      let socketSent = false;
      if (orderId && socketConnectedRef.current && typeof emitRef.current === 'function') {
        const last = lastSocketRef.current;
        const moved = last.lat == null ? Infinity : getHaversineDistance(last.lat, last.lng, fix.lat, fix.lng);
        const since = now - last.at;
        if (force || (since >= SOCKET_MIN_INTERVAL_MS && (moved >= SOCKET_MIN_MOVE_M || since >= SOCKET_MAX_SILENCE_MS))) {
          socketSent = Boolean(
            emitRef.current({
              orderId,
              lat: fix.lat,
              lng: fix.lng,
              heading: fix.heading,
              speed: fix.speed,
              accuracy: fix.accuracy,
            }),
          );
          if (socketSent) lastSocketRef.current = { at: now, lat: fix.lat, lng: fix.lng };
        } else if (moved >= SOCKET_MIN_MOVE_M && !trailingTimer) {
          // Throttled while moving: send the newest fix as soon as the window opens
          // instead of leaving the customer's bike still until the next heartbeat.
          trailingTimer = setTimeout(() => {
            trailingTimer = null;
            if (!disposed && lastFixRef.current) publish(lastFixRef.current);
          }, Math.max(50, SOCKET_MIN_INTERVAL_MS - since));
        }
      }

      const socketHealthy = socketConnectedRef.current && now - lastSocketRef.current.at < SOCKET_MAX_SILENCE_MS * 2;
      const httpInterval = orderId && !socketHealthy ? HTTP_FALLBACK_MS : HTTP_HEARTBEAT_MS;
      if (force || now - lastHttpAtRef.current >= httpInterval) {
        lastHttpAtRef.current = now;
        deliveryAPI
          .updateLocation(fix.lat, fix.lng, isOnlineRef.current || activeOrders.length > 0, {
            heading: fix.heading,
            speed: fix.speed,
            accuracy: fix.accuracy,
          })
          .catch(() => {});
      }
    };

    const onPosition = (pos) => {
      if (disposed) return;
      const { latitude: lat, longitude: lng, heading, speed, accuracy } = pos.coords || {};
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const now = Date.now();
      const acc = Number.isFinite(accuracy) ? accuracy : null;
      if (acc != null && acc > POOR_ACCURACY_M && now - lastGoodFixAtRef.current < GOOD_FIX_FRESH_MS) return;
      if (acc == null || acc <= POOR_ACCURACY_M) lastGoodFixAtRef.current = now;

      const previous = lastFixRef.current;
      let resolvedHeading = Number.isFinite(heading) ? heading : null;
      if (resolvedHeading == null && previous) {
        resolvedHeading =
          getHaversineDistance(previous.lat, previous.lng, lat, lng) > 5
            ? calculateHeading(previous.lat, previous.lng, lat, lng)
            : previous.heading;
      }

      const fix = {
        lat,
        lng,
        heading: Number.isFinite(resolvedHeading) ? resolvedHeading : 0,
        speed: Number.isFinite(speed) && speed >= 0 ? speed : 0,
        accuracy: acc,
        timestamp: pos.timestamp || now,
      };
      lastFixRef.current = fix;
      timeoutCountRef.current = 0;

      if (errorShownRef.current) {
        errorShownRef.current = null;
        toast.dismiss(GPS_TOAST_ID);
      }
      setGpsError?.(null);
      // While a simulated test ride runs, it owns the marker; the real fix is
      // still kept in lastFixRef so normal tracking resumes the moment it stops.
      if (!riderGpsPaused) setRiderLocation(fix);
      publish(fix);
    };

    const onError = (error) => {
      if (disposed) return;
      const info = describeGpsError(error);
      if (!info) return;

      // A single timeout while moving is normal; only surface a persistent one.
      if (info.kind === 'timeout') {
        timeoutCountRef.current += 1;
        if (timeoutCountRef.current < 3) return;
      }

      setGpsError?.(info);
      if (errorShownRef.current !== info.kind) {
        errorShownRef.current = info.kind;
        const show = info.kind === 'permission_denied' ? toast.error : toast.warning;
        show(info.title, {
          id: GPS_TOAST_ID,
          description: info.description,
          duration: info.kind === 'permission_denied' ? Infinity : 8000,
        });
      }
    };

    navigator.geolocation.getCurrentPosition(onPosition, onError, GEO_OPTIONS);
    const watchId = navigator.geolocation.watchPosition(onPosition, onError, GEO_OPTIONS);

    // Coming back to the foreground: get a fresh fix and publish immediately.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          onPosition(pos);
          if (lastFixRef.current) publish(lastFixRef.current, { force: true });
        },
        onError,
        { ...GEO_OPTIONS, maximumAge: 0 },
      );
    };
    document.addEventListener('visibilitychange', onVisible);

    // Heartbeat: a stationary rider (no watch callbacks) still keeps the customer
    // map and the backend's availability fresh.
    const heartbeat = setInterval(() => {
      if (lastFixRef.current) publish(lastFixRef.current);
    }, HTTP_FALLBACK_MS);

    return () => {
      disposed = true;
      if (trailingTimer) clearTimeout(trailingTimer);
      navigator.geolocation.clearWatch(watchId);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(heartbeat);
    };
  }, [shouldTrack, setRiderLocation, setGpsError]);

  // The socket just (re)connected: send the latest fix straight away.
  useEffect(() => {
    if (isSocketConnected && lastFixRef.current) {
      lastSocketRef.current = { at: 0, lat: null, lng: null };
      const { acceptedOrders = [] } = useDeliveryStore.getState();
      if (acceptedOrders.length && typeof emitRef.current === 'function') {
        const fix = lastFixRef.current;
        const order = acceptedOrders[0];
        emitRef.current({
          orderId: order?.orderId || order?._id,
          lat: fix.lat,
          lng: fix.lng,
          heading: fix.heading,
          speed: fix.speed,
          accuracy: fix.accuracy,
        });
      }
    }
  }, [isSocketConnected]);
}
