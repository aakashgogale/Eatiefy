import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { GoogleMap, useJsApiLoader, OverlayView, Polyline } from '@react-google-maps/api';
import { createAppSocket } from '@food/api/socketClient';
import { orderAPI } from '@food/api';
import { LOCATION_CONFIG } from '@/modules/DeliveryV2/utils/locationConfig';
import bikeLogo from '@food/assets/deliveryboy-3d.jpeg';
import mapRiderIcon from '@food/assets/MapRider.png';
import { subscribeOrderTracking, subscribeDeliveryLocation } from '@food/realtimeTracking';
import { useMapTheme } from '@food/utils/mapTheme';
import { computeDrivingRoute } from '@food/utils/drivingRoute';
import { motion } from 'framer-motion';

const LIBRARIES = ['geometry', 'places'];

/**
 * Order statuses in which the rider is carrying the food. Before any of these the
 * map shows the restaurant → customer leg; from here on it tracks the rider.
 */
const PICKED_UP_STATUSES = new Set([
  'picked_up',
  'out_for_delivery',
  'on_way',
  'en_route_to_delivery',
  'reached_drop',
  'at_drop',
  'delivered',
]);

/** Tracking stops for good once an order reaches one of these. */
const TERMINAL_STATUSES = new Set([
  'delivered',
  'completed',
  'cancelled',
  'cancelled_by_user',
  'cancelled_by_restaurant',
  'cancelled_by_admin',
]);

/** Packets older than this (by their own timestamp) are ignored as stale. */
const STALE_PACKET_MS = 10 * 60 * 1000;
/** Allowed clock skew when ordering packets from different sources. */
const PACKET_ORDER_TOLERANCE_MS = 1500;

/** Re-route only after the rider has moved this far — roads don't change faster. */
const ROUTE_REFRESH_DISTANCE_M = 120;
/** …or after this long, so a stationary rider still gets a fresh ETA. */
const ROUTE_REFRESH_INTERVAL_MS = 20000;
/** How often the route conditions are evaluated. */
const ROUTE_TICK_MS = 5000;
/** No packet for this long: tell the customer the rider's position may be out of date. */
const SIGNAL_WEAK_MS = 45 * 1000;
/** Rider marker interpolation bounds, matched to the server's ~1 s packet rate. */
const MIN_INTERP_MS = 800;
const MAX_INTERP_MS = 2500;
/** Distance from route polyline at which rider is considered off-route → immediate reroute. */
const OFF_ROUTE_DISTANCE_M = 60;
/** Max distance to snap rider marker onto the route polyline for smooth on-road rendering. */
const SNAP_TO_ROUTE_MAX_M = 30;

function computeBearing(fromLat, fromLng, toLat, toLng) {
  const fromLatRad = (fromLat * Math.PI) / 180;
  const fromLngRad = (fromLng * Math.PI) / 180;
  const toLatRad = (toLat * Math.PI) / 180;
  const toLngRad = (toLng * Math.PI) / 180;
  const dLng = toLngRad - fromLngRad;
  const y = Math.sin(dLng) * Math.cos(toLatRad);
  const x =
    Math.cos(fromLatRad) * Math.sin(toLatRad) -
    Math.sin(fromLatRad) * Math.cos(toLatRad) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function computeDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** @param {number} meters @returns {string} e.g. "450 m" / "3.2 km" */
const formatDistance = (meters) => {
  if (!Number.isFinite(meters) || meters < 0) return '';
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
};

/** @param {number} seconds @returns {string} e.g. "12 min" */
const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const mins = Math.max(1, Math.round(seconds / 60));
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
};

/**
 * Projects a point onto a line segment A→B and returns the closest point on that segment.
 * @returns {{lat:number, lng:number, t:number}} where t is 0..1 along the segment.
 */
function projectPointOnSegment(p, a, b) {
  const dx = b.lat - a.lat;
  const dy = b.lng - a.lng;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { lat: a.lat, lng: a.lng, t: 0 };
  const t = Math.max(0, Math.min(1, ((p.lat - a.lat) * dx + (p.lng - a.lng) * dy) / lenSq));
  return { lat: a.lat + t * dx, lng: a.lng + t * dy, t };
}

/**
 * Finds the closest point on a polyline path to a given GPS point.
 * @returns {{index:number, snappedPoint:{lat,lng}, distance:number}}
 */
function findClosestPointOnPath(path, point) {
  if (!path || path.length === 0 || !point) return { index: 0, snappedPoint: point, distance: Infinity };
  if (path.length === 1) {
    return { index: 0, snappedPoint: path[0], distance: computeDistanceMeters(point.lat, point.lng, path[0].lat, path[0].lng) };
  }
  let bestDist = Infinity;
  let bestSnap = path[0];
  let bestIdx = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const proj = projectPointOnSegment(point, path[i], path[i + 1]);
    const d = computeDistanceMeters(point.lat, point.lng, proj.lat, proj.lng);
    if (d < bestDist) {
      bestDist = d;
      bestSnap = { lat: proj.lat, lng: proj.lng };
      bestIdx = proj.t >= 0.5 ? i + 1 : i;
    }
  }
  return { index: bestIdx, snappedPoint: bestSnap, distance: bestDist };
}

/** Sum of haversine distances along a path array. */
function computePathLengthM(path) {
  if (!path || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += computeDistanceMeters(path[i - 1].lat, path[i - 1].lng, path[i].lat, path[i].lng);
  }
  return total;
}

/**
 * Trims a route polyline so only the un-traveled portion is returned.
 * @returns {{remainingPath:{lat,lng}[], snappedPoint:{lat,lng}, offRouteDistance:number}}
 */
function computeRemainingPath(fullPath, riderPos) {
  if (!fullPath || fullPath.length < 2 || !riderPos) {
    return { remainingPath: fullPath || [], snappedPoint: riderPos, offRouteDistance: 0 };
  }
  const { index, snappedPoint, distance } = findClosestPointOnPath(fullPath, riderPos);
  // Build remaining path: snapped point → rest of route
  const remaining = [snappedPoint, ...fullPath.slice(index + 1)];
  // Deduplicate if snapped point is essentially the same as the next vertex
  if (remaining.length >= 2 && computeDistanceMeters(remaining[0].lat, remaining[0].lng, remaining[1].lat, remaining[1].lng) < 1) {
    remaining.shift();
  }
  return { remainingPath: remaining.length >= 2 ? remaining : fullPath, snappedPoint, offRouteDistance: distance };
}

/** Interpolates remaining ETA based on how much of the route is left. */
function interpolateRemainingEta(remainingLenM, fullLenM, fullDurationS) {
  if (!Number.isFinite(remainingLenM) || !Number.isFinite(fullLenM) || !Number.isFinite(fullDurationS)) return null;
  if (fullLenM <= 0 || fullDurationS <= 0) return null;
  const ratio = Math.max(0, Math.min(1, remainingLenM / fullLenM));
  return ratio * fullDurationS;
}

const restaurantFallbackIcon = (color) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="${color}"><path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="3" fill="#FFFFFF"/></svg>`,
  )}`;

/**
 * Reads a rider coordinate out of any of the shapes the order payload uses.
 * @returns {{lat:number, lng:number, heading:number}|null}
 */
const readOrderRiderPosition = (order) => {
  const loc =
    order?.deliveryState?.currentLocation ||
    order?.tracking?.location ||
    order?.deliveryPartner?.location ||
    order?.dispatch?.currentLocation ||
    order?.dispatch?.location;
  if (!loc) return null;

  const lat = Number(
    loc.lat ?? loc.latitude ?? (Array.isArray(loc.coordinates) ? loc.coordinates[1] : NaN),
  );
  const lng = Number(
    loc.lng ?? loc.longitude ?? (Array.isArray(loc.coordinates) ? loc.coordinates[0] : NaN),
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // Untimestamped or old positions are not shown as live; join-tracking paints
  // the server's last known fix (with its real age) moments later anyway.
  const at = Number(loc.at ?? loc.timestamp);
  if (!Number.isFinite(at) || at <= 0 || Date.now() - at > STALE_PACKET_MS) return null;

  return { lat, lng, heading: Number(loc.bearing ?? loc.heading) || 0, at };
};

/**
 * Live order tracking map.
 *
 * Two phases, matching how a delivery trip actually reads to a customer:
 *
 *  - Before pickup — restaurant and customer pins with a dashed link between them
 *    and the trip distance. No road route is requested here: the backend already
 *    stored the road distance on the order, so this phase costs no Directions
 *    quota at all.
 *  - After pickup — a road route from the rider's live position to the customer,
 *    refreshed as the rider moves, with the bike gliding along it at 60 fps.
 *
 * Colours come from the app's `--map-*` design tokens via `useMapTheme`, so the
 * map follows the active theme instead of carrying a palette of its own.
 */
const DeliveryTrackingMap = ({
  orderId,
  orderTrackingIds = [],
  restaurantCoords,
  customerCoords,
  userLiveCoords = null,
  userLocationAccuracy = null,
  order = null,
  onEtaUpdate = null,
  disableAutoCenterOnUserInteraction = true,
}) => {
  const [map, setMap] = useState(null);
  const [riderLocation, setRiderLocation] = useState(null);
  const [smoothLocation, setSmoothLocation] = useState(null);
  const [routePath, setRoutePath] = useState(null);
  const [routeMeta, setRouteMeta] = useState({ distanceMeters: null, durationSeconds: null });

  const socketRef = useRef(null);
  const currentSmoothPosRef = useRef(null);
  const interpStateRef = useRef({ startPos: null, targetPos: null, startTime: 0, duration: 1500 });
  const lastPacketTimeRef = useRef(0);
  const routeStateRef = useRef({ lastAt: 0, lastOrigin: null, inFlight: false });
  const userPannedRef = useRef(false);
  const [userInteracted, setUserInteracted] = useState(false);
  const userInteractedRef = useRef(false);
  const isGestureActiveRef = useRef(false);
  const initialCenterRef = useRef(null);
  if (!initialCenterRef.current && (restaurantCoords || customerCoords || userLiveCoords)) {
    initialCenterRef.current = userLiveCoords || restaurantCoords || customerCoords;
  }
  const initialCenter = initialCenterRef.current || { lat: 20.5937, lng: 78.9629 };
  const lastPacketTsRef = useRef(0);
  const animatingRef = useRef(false);
  const startAnimationRef = useRef(() => {});
  const [trackingEnded, setTrackingEnded] = useState(false);
  // Age of the newest rider fix and the live connection state, for honest UI.
  const [lastFixAt, setLastFixAt] = useState(0);
  const [socketState, setSocketState] = useState('connecting');
  const [clock, setClock] = useState(() => Date.now());

  const { palette, mapStyles } = useMapTheme();

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  const trackingIdsKey = useMemo(() => {
    const ids = [
      orderId,
      order?._id,
      order?.orderId,
      order?.orderMongoId,
      ...(Array.isArray(orderTrackingIds) ? orderTrackingIds : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    return [...new Set(ids)].join(',');
  }, [orderId, order?._id, order?.orderId, order?.orderMongoId, orderTrackingIds]);

  const deliveryPartnerId = useMemo(
    () =>
      String(
        order?.deliveryPartnerId ||
          order?.dispatch?.deliveryPartnerId ||
          order?.deliveryPartner?._id ||
          order?.deliveryPartner?.id ||
          '',
      ).trim(),
    [
      order?.deliveryPartnerId,
      order?.dispatch?.deliveryPartnerId,
      order?.deliveryPartner?._id,
      order?.deliveryPartner?.id,
    ],
  );

  const [liveOrderStatus, setLiveOrderStatus] = useState(() =>
    String(order?.status || order?.orderStatus || '').toLowerCase(),
  );

  useEffect(() => {
    const nextStatus = String(order?.status || order?.orderStatus || '').toLowerCase();
    if (nextStatus) {
      setLiveOrderStatus((prev) => {
        if (PICKED_UP_STATUSES.has(prev) && !PICKED_UP_STATUSES.has(nextStatus) && !TERMINAL_STATUSES.has(nextStatus)) {
          return prev;
        }
        return nextStatus;
      });
    }
  }, [order?.status, order?.orderStatus]);

  const isTerminal = TERMINAL_STATUSES.has(liveOrderStatus) || trackingEnded;
  // Delivered/cancelled orders show no live bike or route.
  const isPickedUp = !isTerminal && PICKED_UP_STATUSES.has(liveOrderStatus) && liveOrderStatus !== 'delivered';
  const deliveryPhase = String(order?.deliveryState?.currentPhase || order?.deliveryState?.status || '').toLowerCase();
  const riderAtRestaurant = !isPickedUp && (deliveryPhase === 'at_pickup' || deliveryPhase === 'reached_pickup');
  const riderAssigned = Boolean(deliveryPartnerId);
  /*
   * Live tracking begins at pickup, never before.
   *
   * Until the food is collected the customer was shown the rider's live
   * position and a road route to the RESTAURANT - a bike moving away from the
   * delivery address, with a distance that had nothing to do with the food
   * arriving. Before pickup the map is a plain restaurant-to-address overview;
   * the rider only appears once they are actually carrying the order.
   */
  const effectiveCustomerCoords = userLiveCoords || customerCoords;
  const routeTarget = isPickedUp && !isTerminal ? effectiveCustomerCoords : null;
  const routeLeg = routeTarget ? 'to_customer' : null;
  const routeLegRef = useRef(routeLeg);
  routeLegRef.current = routeLeg;

  /* ─────────────────── Realtime rider position ─────────────────── */

  useEffect(() => {
    if (currentSmoothPosRef.current) return;
    // Not before pickup: an older order row can still carry a rider position.
    if (!isPickedUp) return;
    const initial = readOrderRiderPosition(order);
    if (!initial) return;
    currentSmoothPosRef.current = initial;
    lastPacketTsRef.current = Math.max(lastPacketTsRef.current, initial.at);
    setLastFixAt((prev) => Math.max(prev, initial.at));
    setRiderLocation(initial);
    setSmoothLocation(initial);
  }, [order, isPickedUp]);

  const handleNewRiderPosition = useCallback((data) => {
    const lat = Number(data?.lat ?? data?.boy_lat ?? data?.latitude);
    const lng = Number(data?.lng ?? data?.boy_lng ?? data?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return;
    if (TERMINAL_STATUSES.has(String(data?.orderStatus || '').toLowerCase())) return;

    const now = Date.now();
    // Socket, Realtime DB and the order payload can all deliver the same fix, in any
    // order. Applying an older one after a newer one made the bike jump backwards.
    const packetTs = Number(data?.timestamp ?? data?.last_updated ?? 0);
    if (Number.isFinite(packetTs) && packetTs > 0) {
      if (now - packetTs > STALE_PACKET_MS) return;
      if (packetTs + PACKET_ORDER_TOLERANCE_MS < lastPacketTsRef.current) return;
      lastPacketTsRef.current = Math.max(lastPacketTsRef.current, packetTs);
    }
    // Even an unmoved fix proves the rider is still reporting.
    const fixAt = Number.isFinite(packetTs) && packetTs > 0 ? Math.min(packetTs, now) : now;
    setLastFixAt((prev) => Math.max(prev, fixAt));
    const currentTarget = interpStateRef.current.targetPos;
    if (currentTarget && computeDistanceMeters(currentTarget.lat, currentTarget.lng, lat, lng) < 0.5) return;

    const rendered = currentSmoothPosRef.current;
    const rawHeading = Number(data?.heading ?? data?.bearing);

    // Prefer the device's own heading; derive one from movement only when the rider
    // actually moved, otherwise the marker spins on GPS jitter.
    let heading = Number.isFinite(rawHeading) && rawHeading !== 0 ? rawHeading : null;
    if (heading == null && rendered) {
      heading =
        computeDistanceMeters(rendered.lat, rendered.lng, lat, lng) > 1.5
          ? computeBearing(rendered.lat, rendered.lng, lat, lng)
          : rendered.heading || 0;
    }

    const target = { lat, lng, heading: heading ?? 0 };
    const sinceLast = lastPacketTimeRef.current ? now - lastPacketTimeRef.current : 1500;
    lastPacketTimeRef.current = now;

    interpStateRef.current = {
      startPos: rendered || target,
      targetPos: target,
      startTime: now,
      duration: Math.min(Math.max(sinceLast, MIN_INTERP_MS), MAX_INTERP_MS),
    };

    setRiderLocation(target);
    startAnimationRef.current();
  }, []);

  useEffect(() => {
    const trackingIds = trackingIdsKey ? trackingIdsKey.split(',') : [];
    if (!trackingIds.length || isTerminal) return undefined;

    const unsubs = [];
    if (isPickedUp) {
      trackingIds.forEach((id) => {
        unsubs.push(subscribeOrderTracking(id, handleNewRiderPosition));
      });
      if (deliveryPartnerId) {
        unsubs.push(subscribeDeliveryLocation(deliveryPartnerId, handleNewRiderPosition));
      }
    }

    // The global user socket also republishes rider positions as a window event.
    const handleGlobalLocation = (event) => {
      const data = event?.detail;
      if (!data) return;
      const matches = trackingIds.some(
        (id) => String(id) === String(data.orderId) || String(id) === String(data.orderMongoId),
      );
      if (matches) handleNewRiderPosition(data);
    };
    window.addEventListener('riderLocationUpdate', handleGlobalLocation);

    const teardown = (socket) => () => {
      unsubs.forEach((unsub) => unsub?.());
      window.removeEventListener('riderLocationUpdate', handleGlobalLocation);
      if (socket) {
        trackingIds.forEach((id) => socket.emit('leave-tracking', id));
        socket.disconnect();
        socketRef.current = null;
      }
    };

    const socket = createAppSocket({ role: 'user', label: 'DeliveryTrackingMap' });
    if (!socket) return teardown(null);
    socketRef.current = socket;

    // (Re)join on every connect: rooms are lost when the connection drops.
    socket.on('connect', () => {
      setSocketState('connected');
      trackingIds.forEach((id) => socket.emit('join-tracking', id));
    });
    socket.on('disconnect', () => setSocketState('disconnected'));
    socket.on('connect_error', () => setSocketState('disconnected'));

    // Status update: immediately flip to picked_up without waiting for HTTP refresh!
    socket.on('order_status_update', (data) => {
      if (!data) return;
      const status = String(data.orderStatus || data.status || '').toLowerCase();
      const matches = trackingIds.some(
        (id) => String(id) === String(data.orderId) || String(id) === String(data.orderMongoId),
      );
      if (matches || !data.orderId) {
        if (status) {
          setLiveOrderStatus(status);
        }
        window.dispatchEvent(
          new CustomEvent('orderStatusNotification', {
            detail: {
              orderMongoId: data.orderMongoId,
              orderId: data.orderId,
              displayOrderId: data.displayOrderId || data.orderId,
              status: status,
              orderStatus: status,
              deliveryState: data.deliveryState,
              dispatchStatus: data.dispatchStatus,
              deliveryPartnerId: data.deliveryPartnerId,
              deliveryVerification: data.deliveryVerification,
              updatedAt: data.updatedAt,
              message: data.message,
              timestamp: new Date().toISOString(),
            },
          }),
        );
      }
    });

    socket.on('location-update', (data) => {
      if (!data) return;
      const incomingStatus = String(data.orderStatus || '').toLowerCase();
      if (incomingStatus && PICKED_UP_STATUSES.has(incomingStatus)) {
        setLiveOrderStatus((prev) => (PICKED_UP_STATUSES.has(prev) ? prev : incomingStatus));
      }
      handleNewRiderPosition(data);
    });

    socket.on('tracking-ended', (data) => {
      const matches = trackingIds.some(
        (id) => String(id) === String(data?.orderId) || String(id) === String(data?.orderMongoId),
      );
      if (matches) setTrackingEnded(true);
    });

    // Back online / back in the foreground: reconnect now instead of waiting for backoff.
    const reconnect = () => {
      if (document.visibilityState === 'hidden') return;
      if (!socket.connected) socket.connect();
    };
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', reconnect);
    const stopSocket = teardown(socket);

    return () => {
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', reconnect);
      stopSocket();
    };
  }, [trackingIdsKey, deliveryPartnerId, handleNewRiderPosition, isTerminal, isPickedUp]);

  // Fallback short-interval polling (3-5s): activates ONLY when socket drops
  useEffect(() => {
    if (isTerminal) return undefined;
    if (socketState === 'connected') return undefined;

    const primaryId = orderId || (trackingIdsKey ? trackingIdsKey.split(',')[0] : '');
    if (!primaryId) return undefined;

    const pollInterval = LOCATION_CONFIG.TRACKING_FALLBACK_POLL_MS;
    let inFlight = false;

    const pollFallback = async () => {
      if (inFlight) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      inFlight = true;
      try {
        const res = await orderAPI.getOrderDetails(primaryId, { force: true });
        const fetchedOrder = res?.data?.data?.order || res?.data?.order || res?.data;
        if (fetchedOrder) {
          const fetchedStatus = String(fetchedOrder.status || fetchedOrder.orderStatus || '').toLowerCase();
          if (fetchedStatus) {
            setLiveOrderStatus((prev) =>
              PICKED_UP_STATUSES.has(prev) && !PICKED_UP_STATUSES.has(fetchedStatus) && !TERMINAL_STATUSES.has(fetchedStatus)
                ? prev
                : fetchedStatus,
            );
          }
          const riderPos = readOrderRiderPosition(fetchedOrder);
          if (riderPos) {
            handleNewRiderPosition({
              lat: riderPos.lat,
              lng: riderPos.lng,
              heading: riderPos.heading,
              timestamp: riderPos.at,
              orderStatus: fetchedStatus,
              source: 'fallback_poll',
            });
          }
        }
      } catch (err) {
        // Silently retry on next tick
      } finally {
        inFlight = false;
      }
    };

    pollFallback();
    const intervalId = setInterval(pollFallback, pollInterval);

    return () => clearInterval(intervalId);
  }, [socketState, isTerminal, orderId, trackingIdsKey, handleNewRiderPosition]);

  // Emit user's live location over the same persistent channel (bidirectional tracking)
  const lastUserEmitRef = useRef({ at: 0, lat: null, lng: null });

  useEffect(() => {
    if (!userLiveCoords || isTerminal) return;
    const lat = Number(userLiveCoords.lat ?? userLiveCoords.latitude);
    const lng = Number(userLiveCoords.lng ?? userLiveCoords.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return;

    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    const now = Date.now();
    const last = lastUserEmitRef.current;
    const moved = last.lat == null ? Infinity : computeDistanceMeters(last.lat, last.lng, lat, lng);
    const since = now - last.at;

    const shouldEmit =
      moved >= LOCATION_CONFIG.USER_LOC_MIN_MOVE_M && since >= LOCATION_CONFIG.USER_LOC_MIN_INTERVAL_MS;
    const isSilenceHeartbeat = since >= LOCATION_CONFIG.USER_LOC_MAX_SILENCE_MS;

    if (last.lat == null || shouldEmit || isSilenceHeartbeat) {
      lastUserEmitRef.current = { at: now, lat, lng };
      const primaryId = orderId || (trackingIdsKey ? trackingIdsKey.split(',')[0] : '');
      if (primaryId) {
        socket.emit('update-user-location', {
          orderId: primaryId,
          lat,
          lng,
          accuracy: Number(userLocationAccuracy) || null,
        });
      }
    }
  }, [userLiveCoords, userLocationAccuracy, orderId, trackingIdsKey, isTerminal, socketState]);

  // Re-evaluate the "last updated" state even when no packets arrive.
  useEffect(() => {
    if (isTerminal) return undefined;
    const id = setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(id);
  }, [isTerminal]);

  // Clear the bike as soon as tracking ends.
  useEffect(() => {
    if (!isTerminal) return;
    interpStateRef.current = { startPos: null, targetPos: null, startTime: 0, duration: 1500 };
    currentSmoothPosRef.current = null;
    setRiderLocation(null);
    setSmoothLocation(null);
    setRoutePath(null);
  }, [isTerminal]);

  /* ─────────────────── 60 fps marker interpolation ─────────────────── */

  useEffect(() => {
    let frameId;
    const step = () => {
      const { startPos, targetPos, startTime, duration } = interpStateRef.current;
      if (!startPos || !targetPos) {
        animatingRef.current = false;
        return;
      }
      {
        const progress = Math.min((Date.now() - startTime) / (duration || 1500), 1);
        const eased = 1 - (1 - progress) ** 2;

        // Interpolate heading the short way around the circle.
        let delta = ((targetPos.heading || 0) - (startPos.heading || 0)) % 360;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;

        const next = {
          lat: startPos.lat + (targetPos.lat - startPos.lat) * eased,
          lng: startPos.lng + (targetPos.lng - startPos.lng) * eased,
          heading: ((startPos.heading || 0) + delta * eased + 360) % 360,
        };
        currentSmoothPosRef.current = next;
        setSmoothLocation(next);
        // Idle between packets instead of re-rendering the map 60 times a second.
        if (progress >= 1) {
          animatingRef.current = false;
          return;
        }
      }
      frameId = requestAnimationFrame(step);
    };

    startAnimationRef.current = () => {
      if (animatingRef.current) return;
      animatingRef.current = true;
      frameId = requestAnimationFrame(step);
    };
    startAnimationRef.current();

    return () => {
      animatingRef.current = false;
      startAnimationRef.current = () => {};
      cancelAnimationFrame(frameId);
    };
  }, []);

  const riderPosition = smoothLocation || riderLocation;

  /* ─────────────────── Route: rider → restaurant, then rider → customer ─────────────────── */

  const requestRoute = useCallback(
    (origin) => {
      if (!isLoaded || !origin || !routeTarget || routeStateRef.current.inFlight) return;
      routeStateRef.current.inFlight = true;
      const leg = routeLeg;

      // Legacy DirectionsService alone is blocked on newer Google Cloud projects, which
      // left customers with only a dashed straight line; the helper tries Routes API first.
      computeDrivingRoute(origin, routeTarget)
        .then((route) => {
          // The rider changed leg while this was in flight; the next tick re-routes.
          if (leg !== routeLegRef.current) return;
          routeStateRef.current.lastAt = Date.now();
          routeStateRef.current.lastOrigin = origin;
          setRoutePath(route.path);
          setRouteMeta({
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
          });
          // The customer ETA only makes sense once the food is on its way.
          if (leg === 'to_customer' && onEtaUpdate && Number.isFinite(route.durationSeconds)) {
            onEtaUpdate(formatDuration(route.durationSeconds));
          }
        })
        .catch(() => {
          // Retry on the next tick instead of hammering the API.
          routeStateRef.current.lastAt = Date.now();
        })
        .finally(() => {
          routeStateRef.current.inFlight = false;
        });
    },
    [isLoaded, routeTarget, routeLeg, onEtaUpdate],
  );

  // A new leg (restaurant → customer) needs its own route immediately, not after
  // the rider has moved far enough from where the previous leg was routed.
  useEffect(() => {
    setRoutePath(null);
    setRouteMeta({ distanceMeters: null, durationSeconds: null });
    routeStateRef.current = { lastAt: 0, lastOrigin: null, inFlight: false };
  }, [routeLeg]);

  // Poll rather than react to every position packet: the rider emits ~1/s, and one
  // Directions request per packet would be both slow and needlessly expensive.
  useEffect(() => {
    if (!routeLeg || !isLoaded) {
      setRoutePath(null);
      setRouteMeta({ distanceMeters: null, durationSeconds: null });
      routeStateRef.current = { lastAt: 0, lastOrigin: null, inFlight: false };
      return undefined;
    }

    const tick = () => {
      const origin = currentSmoothPosRef.current;
      if (!origin) return;

      const { lastAt, lastOrigin } = routeStateRef.current;
      const movedFar =
        !lastOrigin ||
        computeDistanceMeters(lastOrigin.lat, lastOrigin.lng, origin.lat, origin.lng) >
          ROUTE_REFRESH_DISTANCE_M;

      // Off-route detection: if rider is far from current polyline, reroute immediately
      let isOffRoute = false;
      if (routePath && routePath.length >= 2) {
        const { distance: distFromRoute } = findClosestPointOnPath(routePath, origin);
        if (distFromRoute > OFF_ROUTE_DISTANCE_M) {
          isOffRoute = true;
        }
      }

      if (isOffRoute || movedFar || Date.now() - lastAt > ROUTE_REFRESH_INTERVAL_MS) {
        requestRoute({ lat: origin.lat, lng: origin.lng });
      }
    };

    tick();
    const intervalId = setInterval(tick, ROUTE_TICK_MS);
    return () => clearInterval(intervalId);
  }, [routeLeg, isLoaded, requestRoute, routePath]);

  /* ─────────────────── Route trimming & snapping (Zomato-style) ─────────────────── */

  // Trim the route to show only the remaining (un-traveled) portion
  const routeTrimResult = useMemo(() => {
    if (!isPickedUp || !routePath || routePath.length < 2 || !riderPosition) {
      return { remainingPath: routePath, snappedPoint: null, offRouteDistance: 0 };
    }
    return computeRemainingPath(routePath, riderPosition);
  }, [isPickedUp, routePath, riderPosition]);

  const remainingPath = routeTrimResult.remainingPath;
  const fullPathLengthM = useMemo(() => computePathLengthM(routePath), [routePath]);
  const remainingPathLengthM = useMemo(() => computePathLengthM(remainingPath), [remainingPath]);

  // Snap rider marker to the route for smooth on-road rendering (Zomato-style glide)
  const snappedRiderPos = useMemo(() => {
    if (!isPickedUp || !routeTrimResult.snappedPoint || !riderPosition) return null;
    if (routeTrimResult.offRouteDistance > SNAP_TO_ROUTE_MAX_M) return null;
    return {
      lat: routeTrimResult.snappedPoint.lat,
      lng: routeTrimResult.snappedPoint.lng,
      heading: riderPosition.heading || 0,
    };
  }, [isPickedUp, routeTrimResult, riderPosition]);

  // The position used for the rider marker: snapped to route when close, raw GPS otherwise
  const displayRiderPos = snappedRiderPos || riderPosition;

  /* ─────────────────── Distance and ETA shown to the customer ─────────────────── */

  const tripDistanceMeters = useMemo(() => {
    // While the rider is en route, prefer live remaining distance for accuracy
    if (isPickedUp && remainingPathLengthM > 0) return remainingPathLengthM;
    if (isPickedUp && Number.isFinite(routeMeta.distanceMeters)) return routeMeta.distanceMeters;

    // Before pickup, reuse the road distance the backend already resolved for
    // pricing rather than spending a Directions call on it.
    const storedKm = Number(order?.tripDistanceKm ?? order?.pricing?.roadDistanceKm);
    if (Number.isFinite(storedKm) && storedKm > 0) return storedKm * 1000;

    if (restaurantCoords && customerCoords) {
      return computeDistanceMeters(
        restaurantCoords.lat,
        restaurantCoords.lng,
        customerCoords.lat,
        customerCoords.lng,
      );
    }
    return null;
  }, [
    isPickedUp,
    remainingPathLengthM,
    routeMeta.distanceMeters,
    order?.tripDistanceKm,
    order?.pricing?.roadDistanceKm,
    restaurantCoords,
    customerCoords,
  ]);

  // Live interpolated ETA that ticks down as rider progresses, without waiting for a new API call
  const liveEtaSeconds = useMemo(() => {
    if (!isPickedUp) return null;
    return interpolateRemainingEta(remainingPathLengthM, fullPathLengthM, routeMeta.durationSeconds);
  }, [isPickedUp, remainingPathLengthM, fullPathLengthM, routeMeta.durationSeconds]);

  const etaText = useMemo(() => {
    // Prefer live interpolated ETA when available (ticks down between API calls)
    if (isPickedUp && Number.isFinite(liveEtaSeconds) && liveEtaSeconds > 0) {
      return formatDuration(liveEtaSeconds);
    }
    if (isPickedUp && Number.isFinite(routeMeta.durationSeconds)) {
      return formatDuration(routeMeta.durationSeconds);
    }
    const storedMins = Number(order?.tripDurationMins ?? order?.pricing?.roadDurationMins);
    return Number.isFinite(storedMins) && storedMins > 0 ? `${Math.round(storedMins)} min` : '';
  }, [
    isPickedUp,
    liveEtaSeconds,
    routeMeta.durationSeconds,
    order?.tripDurationMins,
    order?.pricing?.roadDurationMins,
  ]);

  /* ─────────────────── Camera ─────────────────── */

  // Responsive padding calculation for pre-pickup bounds (leaving room for top header & bottom sheet)
  const getPrePickupPadding = useCallback(() => {
    const windowH = typeof window !== 'undefined' ? window.innerHeight : 800;
    return {
      top: 90,
      bottom: Math.min(Math.round(windowH * 0.48), 380),
      left: 45,
      right: 45,
    };
  }, []);

  // Recalculates map bounds using both markers (restaurant + user) with dynamic padding
  const fitPrePickupBounds = useCallback((mapInstance = map) => {
    if (!mapInstance || !window.google?.maps) return;
    if (!restaurantCoords || !customerCoords) return;

    const rLat = Number(restaurantCoords.lat ?? restaurantCoords.latitude);
    const rLng = Number(restaurantCoords.lng ?? restaurantCoords.longitude);
    const cLat = Number(customerCoords.lat ?? customerCoords.latitude);
    const cLng = Number(customerCoords.lng ?? customerCoords.longitude);
    if (!Number.isFinite(rLat) || !Number.isFinite(rLng) || !Number.isFinite(cLat) || !Number.isFinite(cLng)) return;

    const bounds = new window.google.maps.LatLngBounds();
    bounds.extend(new window.google.maps.LatLng(rLat, rLng));
    bounds.extend(new window.google.maps.LatLng(cLat, cLng));

    try {
      mapInstance.fitBounds(bounds, getPrePickupPadding());
    } catch (err) {
      console.warn('[DeliveryTrackingMap] fitPrePickupBounds error:', err);
    }
  }, [map, restaurantCoords, customerCoords, getPrePickupPadding]);

  // Pre-pickup signature: only changes when actual marker coordinates change (not on re-renders)
  const prePickupDataKey = useMemo(() => {
    if (isPickedUp) return null;
    const rLat = Number(restaurantCoords?.lat ?? restaurantCoords?.latitude)?.toFixed(5) || '';
    const rLng = Number(restaurantCoords?.lng ?? restaurantCoords?.longitude)?.toFixed(5) || '';
    const cLat = Number(customerCoords?.lat ?? customerCoords?.latitude)?.toFixed(5) || '';
    const cLng = Number(customerCoords?.lng ?? customerCoords?.longitude)?.toFixed(5) || '';
    return `${rLat},${rLng}|${cLat},${cLng}`;
  }, [isPickedUp, restaurantCoords, customerCoords]);

  // Pre-pickup camera fitting: triggers on actual marker/route data change, not on re-renders
  useEffect(() => {
    if (isPickedUp || !map || !prePickupDataKey) return;

    // Reset manual interaction state when a new location update arrives
    userInteractedRef.current = false;
    setUserInteracted(false);
    userPannedRef.current = false;

    fitPrePickupBounds(map);
  }, [map, isPickedUp, prePickupDataKey, fitPrePickupBounds]);

  // User manual pan and zoom interaction listeners
  useEffect(() => {
    if (!map) return undefined;

    const onDragStart = () => {
      userPannedRef.current = true;
      if (disableAutoCenterOnUserInteraction) {
        userInteractedRef.current = true;
        setUserInteracted(true);
      }
    };

    const onZoomChanged = () => {
      // If zoom changed as a result of active user gesture (touch/wheel/drag)
      if (isGestureActiveRef.current) {
        userPannedRef.current = true;
        if (disableAutoCenterOnUserInteraction) {
          userInteractedRef.current = true;
          setUserInteracted(true);
        }
      }
    };

    const dragListener = map.addListener('dragstart', onDragStart);
    const zoomListener = map.addListener('zoom_changed', onZoomChanged);

    return () => {
      dragListener?.remove();
      zoomListener?.remove();
    };
  }, [map, disableAutoCenterOnUserInteraction]);

  // Post-pickup live tracking camera (scoped strictly to isPickedUp === true)
  useEffect(() => {
    if (!isPickedUp || !map || !customerCoords) return;

    // A new phase re-frames the trip and clears earlier manual pan
    userPannedRef.current = false;

    const bounds = new window.google.maps.LatLngBounds();
    const rider = currentSmoothPosRef.current;
    bounds.extend(customerCoords);
    if (rider) bounds.extend(rider);
    else if (restaurantCoords) bounds.extend(restaurantCoords);

    map.fitBounds(bounds, {
      top: 90,
      bottom: Math.min(window.innerHeight * 0.48, 380),
      left: 45,
      right: 45,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isPickedUp, routeLeg]);

  useEffect(() => {
    if (!isPickedUp || !map || isTerminal || !displayRiderPos || userPannedRef.current) return;
    const viewport = map.getBounds();
    if (viewport && !viewport.contains(displayRiderPos)) map.panTo(displayRiderPos);
  }, [isPickedUp, map, isTerminal, displayRiderPos]);

  /* ─────────────────── Render ─────────────────── */

  // Before pickup this links restaurant → customer. After pickup it is the safety
  // net for the live route: if Directions is unavailable (quota, network) the
  // customer still sees the rider connected to their address rather than a bare map.
  const pendingLinePath = useMemo(() => {
    if (!customerCoords) return null;
    const origin = isPickedUp ? displayRiderPos || restaurantCoords : restaurantCoords;
    return origin ? [origin, customerCoords] : null;
  }, [isPickedUp, displayRiderPos, restaurantCoords, customerCoords]);

  const dashedLineOptions = useMemo(
    () => ({
      strokeOpacity: 0,
      geodesic: true,
      zIndex: 4,
      icons: [
        {
          icon: {
            path: 'M 0,-1 0,1',
            strokeColor: palette.routePending,
            strokeOpacity: 0.95,
            strokeWeight: 3,
            scale: 3,
          },
          offset: '0',
          repeat: '14px',
        },
      ],
    }),
    [palette.routePending],
  );

  const mapOptions = useMemo(
    () => ({
      styles: mapStyles,
      backgroundColor: palette.surface,
      disableDefaultUI: true,
      zoomControl: true,
      clickableIcons: false,
      gestureHandling: 'greedy',
    }),
    [mapStyles, palette.surface],
  );

  if (!isLoaded) {
    return (
      <div className="w-full h-full animate-pulse" style={{ backgroundColor: palette.surface }} />
    );
  }

  const badgeStyle = { backgroundColor: palette.badge, color: palette.badgeForeground };
  const distanceText = formatDistance(tripDistanceMeters);

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      onPointerDown={() => { isGestureActiveRef.current = true; }}
      onPointerUp={() => { setTimeout(() => { isGestureActiveRef.current = false; }, 300); }}
      onTouchStart={() => { isGestureActiveRef.current = true; }}
      onTouchEnd={() => { setTimeout(() => { isGestureActiveRef.current = false; }, 300); }}
      onWheel={() => {
        isGestureActiveRef.current = true;
        setTimeout(() => { isGestureActiveRef.current = false; }, 300);
      }}
    >
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={initialCenter}
        onLoad={(mapInstance) => {
          setMap(mapInstance);
          if (!isPickedUp) {
            fitPrePickupBounds(mapInstance);
          }
        }}
        options={mapOptions}
      >
        {/* Dashed link: the whole leg before pickup, the fallback after it. */}
        {(!isPickedUp || !routePath) && pendingLinePath && (
          <Polyline path={pendingLinePath} options={dashedLineOptions} />
        )}

        {/* After pickup only: live road route (remaining portion only, trimmed as rider progresses). */}
        {isPickedUp && remainingPath && remainingPath.length >= 2 && (
          <>
            <Polyline
              path={remainingPath}
              options={{
                strokeColor: palette.routeCasing,
                strokeOpacity: 0.9,
                strokeWeight: 9,
                zIndex: 8,
              }}
            />
            <Polyline
              path={remainingPath}
              options={{
                strokeColor: palette.route,
                strokeOpacity: 1,
                strokeWeight: 5,
                zIndex: 9,
              }}
            />
          </>
        )}

        {restaurantCoords && (
          <OverlayView position={restaurantCoords} mapPaneName={OverlayView.MARKER_LAYER}>
            <div className="relative flex flex-col items-center pointer-events-none -translate-x-1/2 -translate-y-1/2">
              <div
                className="absolute -top-12 z-50 rounded-full flex items-center px-2 py-1 shadow-lg gap-1.5"
                style={badgeStyle}
              >
                <img
                  src={
                    order?.restaurantLogo ||
                    order?.restaurantId?.logo ||
                    order?.restaurantId?.profileImage ||
                    restaurantFallbackIcon(palette.restaurant)
                  }
                  alt=""
                  className="w-5 h-5 rounded-full object-cover bg-white"
                  onError={(e) => {
                    e.target.src = restaurantFallbackIcon(palette.restaurant);
                  }}
                />
                <span className="text-[11px] font-bold pr-1">
                  {order?.restaurantName || order?.restaurantId?.name || 'Restaurant'}
                </span>
                <div
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45"
                  style={{ backgroundColor: palette.badge }}
                />
              </div>
              <div
                className="w-4 h-4 border-[3px] border-white rounded-full shadow-md z-10"
                style={{ backgroundColor: palette.restaurant }}
              />
            </div>
          </OverlayView>
        )}

        {effectiveCustomerCoords && (
          <OverlayView position={effectiveCustomerCoords} mapPaneName={OverlayView.MARKER_LAYER}>
            <div className="relative flex flex-col items-center pointer-events-none -translate-x-1/2 -translate-y-1/2">
              <div
                className="absolute -top-12 z-50 rounded-full flex items-center px-2.5 py-1 shadow-lg gap-1.5"
                style={badgeStyle}
              >
                <span className="text-[11px] font-bold">{userLiveCoords ? 'You (Live)' : 'You'}</span>
                <div
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45"
                  style={{ backgroundColor: palette.badge }}
                />
              </div>
              <div
                className="w-4 h-4 border-[3px] border-white rounded-full shadow-md z-10"
                style={{ backgroundColor: palette.customer }}
              />
            </div>
          </OverlayView>
        )}

        {/* Live bike: only while the rider is actually carrying this order. */}
        {isPickedUp && displayRiderPos && (
          <OverlayView position={displayRiderPos} mapPaneName={OverlayView.MARKER_LAYER}>
            <div
              className="relative flex flex-col items-center pointer-events-none -translate-x-1/2 -translate-y-1/2 z-40"
              style={{ opacity: lastFixAt && clock - lastFixAt > SIGNAL_WEAK_MS ? 0.55 : 1 }}
            >
              {isPickedUp && etaText && (
                <div
                  className="absolute -top-8 z-50 whitespace-nowrap text-[10px] font-bold px-2.5 py-1 rounded-md shadow-xl flex items-center gap-1.5"
                  style={badgeStyle}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ backgroundColor: palette.customer }}
                  />
                  <span>{etaText}</span>
                  <div
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45"
                    style={{ backgroundColor: palette.badge }}
                  />
                </div>
              )}

              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0">
                <motion.div
                  animate={{ scale: [1, 2.8], opacity: [0.7, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                  className="w-14 h-14 rounded-full border-4"
                  style={{
                    borderColor: `${palette.riderPulse}66`,
                    backgroundColor: `${palette.riderPulse}1a`,
                  }}
                />
              </div>

              <div
                className="relative w-16 h-16 flex items-center justify-center z-10"
                style={{
                  transform: `rotate(${displayRiderPos.heading || 0}deg)`,
                  transition: 'transform 0.2s ease-out',
                }}
              >
                <img
                  src={mapRiderIcon}
                  alt="Delivery rider"
                  className="w-[160%] h-[160%] max-w-none object-contain drop-shadow-2xl select-none"
                  onError={(e) => {
                    e.target.src = bikeLogo;
                  }}
                />
              </div>
            </div>
          </OverlayView>
        )}
      </GoogleMap>

      {!isTerminal && riderAssigned && (() => {
        const ageMs = lastFixAt ? clock - lastFixAt : null;
        let text = null;
        let tone = palette.routePending;
        if (!isPickedUp) {
          /*
           * Before pickup there is no live tracking to report, so none of the
           * connection/GPS states belong here - they only worried the customer
           * about a bike that is not carrying their food yet.
           */
          text = riderAtRestaurant
            ? 'Rider is at the restaurant, collecting your order'
            : 'Rider assigned — picking up your order';
          tone = palette.routePending;
        } else if (socketState === 'disconnected') {
          text = 'Reconnecting to live tracking…';
        } else if (!riderPosition) {
          text = "Waiting for rider's GPS location…";
        } else if (ageMs != null && ageMs > SIGNAL_WEAK_MS) {
          const mins = Math.max(1, Math.round(ageMs / 60000));
          text = `Rider's location last updated ${mins} min ago`;
        } else {
          text = 'Live tracking';
          tone = palette.route;
        }
        if (!text) return null;
        return (
          <div
            className="absolute top-12 left-3 z-10 flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold shadow-lg max-w-[calc(100%-24px)]"
            style={badgeStyle}
            role="status"
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tone }} />
            <span className="truncate">{text}</span>
          </div>
        );
      })()}

      {distanceText && (
        <div
          className="absolute top-3 left-3 z-10 flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold shadow-lg"
          style={badgeStyle}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: isPickedUp ? palette.route : palette.routePending }}
          />
          <span>{isPickedUp ? `${distanceText} away` : `${distanceText} to you`}</span>
          {etaText && (
            <>
              <span className="opacity-40">•</span>
              <span>{etaText}</span>
            </>
          )}
        </div>
      )}

      {/* Floating Recenter button when user manually panned/zoomed in pre-pickup view */}
      {!isPickedUp && userInteracted && (
        <button
          type="button"
          onClick={() => {
            userInteractedRef.current = false;
            setUserInteracted(false);
            userPannedRef.current = false;
            fitPrePickupBounds(map);
          }}
          className="absolute top-12 right-3 z-20 flex items-center gap-1.5 px-3 py-1.5 bg-white/95 dark:bg-zinc-900/95 text-gray-800 dark:text-gray-100 text-[11px] font-bold rounded-full shadow-lg border border-gray-200/80 dark:border-zinc-700/80 backdrop-blur-xs transition-transform active:scale-95 hover:bg-gray-50 dark:hover:bg-zinc-800 cursor-pointer"
          aria-label="Recenter map on restaurant and delivery location"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-3.5 h-3.5 text-[#EB590E]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="22" y1="12" x2="18" y2="12" />
            <line x1="6" y1="12" x2="2" y2="12" />
            <line x1="12" y1="6" x2="12" y2="2" />
            <line x1="12" y1="22" x2="12" y2="18" />
          </svg>
          <span>Recenter</span>
        </button>
      )}
    </div>
  );
};

export default React.memo(DeliveryTrackingMap);
