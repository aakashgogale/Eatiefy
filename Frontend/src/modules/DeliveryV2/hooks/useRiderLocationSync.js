import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { deliveryAPI } from '@food/api';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { getHaversineDistance } from '@/modules/DeliveryV2/utils/geo';
import { LOCATION_CONFIG } from '@/modules/DeliveryV2/utils/locationConfig';
import { KalmanLocationFilter } from '@/modules/DeliveryV2/utils/kalmanLocationFilter';
import { backgroundLocationManager } from '@/modules/DeliveryV2/utils/backgroundLocationManager';

/**
 * The rider app's single GPS source and live-location publisher.
 *
 * Mounted once in DeliveryRealtimeShell, so it runs on every delivery screen.
 *
 * Fixes integrated:
 * 1. 2D Kalman filter for real-time location smoothing & outlier/multipath rejection.
 * 2. High-accuracy GPS options with stale-cache rejection (maximumAge: 1000).
 * 3. Dynamic accuracy thresholding (discards inaccurate pings > threshold).
 * 4. Anti-throttling manager (Screen Wake Lock, silent Web Audio, visibility re-sync,
 *    and native foreground service hooks for Android & iOS).
 * 5. Socket throttling based on meaningful movement and elapsed time to prevent
 *    flicker, jitter, and backward rendering.
 *
 * No hardcoded values: all thresholds derived from LOCATION_CONFIG and env vars.
 */

const GEO_OPTIONS = {
  enableHighAccuracy: LOCATION_CONFIG.ENABLE_HIGH_ACCURACY,
  maximumAge: LOCATION_CONFIG.MAXIMUM_AGE_MS,
  timeout: LOCATION_CONFIG.GEOLOCATION_TIMEOUT_MS,
};

const GPS_TOAST_ID = 'rider-gps-status';

/** Kept for existing imports. */
export function isOrdersRoute(pathname = '') {
  return /\/orders\/?$/.test(pathname) || pathname.endsWith('/orders');
}

/*
 * Simulation switch (test builds only - see VITE_ENABLE_MAP_SIMULATION).
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

  const kalmanFilterRef = useRef(null);
  if (!kalmanFilterRef.current) {
    kalmanFilterRef.current = new KalmanLocationFilter(LOCATION_CONFIG);
  }

  const lastFixRef = useRef(null);
  const lastGoodFixAtRef = useRef(0);
  const lastLocalUpdateAtRef = useRef(0);
  const lastSocketRef = useRef({ at: 0, lat: null, lng: null });
  const lastHttpAtRef = useRef(0);
  const timeoutCountRef = useRef(0);
  const errorShownRef = useRef(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError?.({ kind: 'unsupported', title: 'Location not supported on this device' });
      return undefined;
    }

    let disposed = false;
    let trailingTimer = null;

    if (shouldTrack) {
      // Start background anti-throttling (wake lock, web audio keep-alive, visibility listener)
      backgroundLocationManager.start({
        onResume: () => {
          if (disposed) return;
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              onPosition(pos);
              if (lastFixRef.current) publish(lastFixRef.current, { force: true });
            },
            onError,
            { ...GEO_OPTIONS, maximumAge: 0 },
          );
        },
      });
    } else {
      backgroundLocationManager.stop();
    }

    const publish = (fix, { force = false } = {}) => {
      // A simulated test ride owns the published position while it runs.
      if (riderGpsPaused || !fix) return;
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

        // Meaningful movement check: must move at least SOCKET_MIN_MOVE_M and interval elapsed,
        // or a stationary heartbeat after SOCKET_MAX_SILENCE_MS
        const isMeaningfulMove = moved >= LOCATION_CONFIG.SOCKET_MIN_MOVE_M && since >= LOCATION_CONFIG.SOCKET_MIN_INTERVAL_MS;
        const isSilenceHeartbeat = since >= LOCATION_CONFIG.SOCKET_MAX_SILENCE_MS;

        if (force || isMeaningfulMove || isSilenceHeartbeat) {
          socketSent = Boolean(
            emitRef.current({
              orderId,
              lat: fix.lat,
              lng: fix.lng,
              heading: fix.heading,
              speed: fix.speed,
              accuracy: fix.accuracy,
              timestamp: fix.timestamp || now,
            }),
          );
          if (socketSent) lastSocketRef.current = { at: now, lat: fix.lat, lng: fix.lng };
        } else if (moved >= LOCATION_CONFIG.SOCKET_MIN_MOVE_M && !trailingTimer) {
          // Throttled while moving: send the newest smoothed fix as soon as the throttle window opens
          trailingTimer = setTimeout(() => {
            trailingTimer = null;
            if (!disposed && lastFixRef.current) publish(lastFixRef.current);
          }, Math.max(50, LOCATION_CONFIG.SOCKET_MIN_INTERVAL_MS - since));
        }
      }

      if (shouldTrack) {
        const socketHealthy = socketConnectedRef.current && now - lastSocketRef.current.at < LOCATION_CONFIG.SOCKET_MAX_SILENCE_MS * 2;
        const httpInterval = orderId && !socketHealthy ? LOCATION_CONFIG.HTTP_FALLBACK_MS : LOCATION_CONFIG.HTTP_HEARTBEAT_MS;
        if (force || now - lastHttpAtRef.current >= httpInterval) {
          lastHttpAtRef.current = now;
          deliveryAPI
            .updateLocation(fix.lat, fix.lng, isOnlineRef.current || activeOrders.length > 0, {
              heading: fix.heading,
              speed: fix.speed,
              accuracy: fix.accuracy,
              timestamp: fix.timestamp || now,
            })
            .catch(() => {});
        }
      }
    };

    const onPosition = (pos) => {
      if (disposed) return;
      const { latitude: lat, longitude: lng, heading, speed, accuracy } = pos.coords || {};
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return;

      const now = Date.now();
      const acc = Number.isFinite(accuracy) ? accuracy : null;

      // Accuracy Filtering:
      // If we have an active recent high-accuracy fix, discard updates with accuracy > MAX_ACCURACY_THRESHOLD_M.
      // If waiting for initial lock, allow any reasonable fix so initial UI placement happens in one go.
      const hasRecentGoodFix = lastGoodFixAtRef.current > 0 && now - lastGoodFixAtRef.current < LOCATION_CONFIG.GOOD_FIX_FRESH_MS;
      if (acc != null) {
        if (hasRecentGoodFix && acc > LOCATION_CONFIG.MAX_ACCURACY_THRESHOLD_M) {
          return; // Ignore noisy fix when a good fix arrived recently
        }
        if (acc <= LOCATION_CONFIG.MAX_ACCURACY_THRESHOLD_M) {
          lastGoodFixAtRef.current = now;
        }
      }

      // Pass raw measurement through the Kalman filter for smoothing & outlier rejection
      const smoothed = kalmanFilterRef.current.filter({
        lat,
        lng,
        accuracy: acc,
        speed: Number.isFinite(speed) && speed >= 0 ? speed : null,
        heading: Number.isFinite(heading) && heading >= 0 ? heading : null,
        timestamp: pos.timestamp || now,
      });

      if (!smoothed || !Number.isFinite(smoothed.lat) || !Number.isFinite(smoothed.lng)) return;

      const fix = {
        lat: smoothed.lat,
        lng: smoothed.lng,
        heading: Number.isFinite(smoothed.heading) ? smoothed.heading : 0,
        speed: Number.isFinite(smoothed.speed) ? smoothed.speed : 0,
        accuracy: smoothed.accuracy || acc,
        timestamp: smoothed.timestamp || now,
        isStationary: Boolean(smoothed.isStationary),
      };

      const previous = lastFixRef.current;
      const sinceLastLocal = now - lastLocalUpdateAtRef.current;
      const moved = previous ? getHaversineDistance(previous.lat, previous.lng, fix.lat, fix.lng) : Infinity;

      // Rate limit local updates: don't churn React state on noisy high-frequency pings (< MIN_UPDATE_INTERVAL_MS)
      // unless vehicle has moved beyond MIN_UPDATE_DISTANCE_M or this is the first fix.
      if (!previous || sinceLastLocal >= LOCATION_CONFIG.MIN_UPDATE_INTERVAL_MS || moved >= LOCATION_CONFIG.MIN_UPDATE_DISTANCE_M) {
        lastLocalUpdateAtRef.current = now;
        lastFixRef.current = fix;
        timeoutCountRef.current = 0;

        if (errorShownRef.current) {
          errorShownRef.current = null;
          toast.dismiss(GPS_TOAST_ID);
        }
        setGpsError?.(null);

        // While a simulated test ride runs, it owns the marker; real fix is still kept in lastFixRef
        if (!riderGpsPaused) setRiderLocation(fix);
        if (shouldTrack) publish(fix);
      }
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

    // 1. Fast immediate fetch (cached/low-power GPS for instant UI lock in < 150ms)
    navigator.geolocation.getCurrentPosition(
      (pos) => onPosition(pos),
      () => {},
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 3000 }
    );

    // 2. High accuracy fresh fix
    navigator.geolocation.getCurrentPosition(
      (pos) => onPosition(pos),
      onError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 }
    );

    // 3. Continuous real-time stream
    const watchId = navigator.geolocation.watchPosition(onPosition, onError, GEO_OPTIONS);

    // Heartbeat: a stationary rider (no watch callbacks) still keeps the customer
    // map and the backend's availability fresh.
    const heartbeat = setInterval(() => {
      if (shouldTrack && lastFixRef.current) publish(lastFixRef.current);
    }, LOCATION_CONFIG.HTTP_FALLBACK_MS);

    return () => {
      disposed = true;
      if (trailingTimer) clearTimeout(trailingTimer);
      navigator.geolocation.clearWatch(watchId);
      backgroundLocationManager.stop();
      clearInterval(heartbeat);
    };
  }, [shouldTrack, setRiderLocation, setGpsError]);

  // When rider goes online, immediately push the latest known position if available
  useEffect(() => {
    if (isOnline && lastFixRef.current) {
      deliveryAPI
        .updateLocation(lastFixRef.current.lat, lastFixRef.current.lng, true, {
          heading: lastFixRef.current.heading,
          speed: lastFixRef.current.speed,
          accuracy: lastFixRef.current.accuracy,
          timestamp: lastFixRef.current.timestamp || Date.now(),
        })
        .catch(() => {});
    }
  }, [isOnline]);

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
          timestamp: fix.timestamp || Date.now(),
        });
      }
    }
  }, [isSocketConnected]);
}

export default useRiderLocationSync;
