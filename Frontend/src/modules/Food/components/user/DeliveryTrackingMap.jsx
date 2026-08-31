import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { GoogleMap, useJsApiLoader, OverlayView, Polyline } from '@react-google-maps/api';
import { createAppSocket } from '@food/api/socketClient';
import bikeLogo from '@food/assets/deliveryboy-3d.jpeg';
import mapRiderIcon from '@food/assets/MapRider.png';
import { subscribeOrderTracking, subscribeDeliveryLocation } from '@food/realtimeTracking';
import { useMapTheme } from '@food/utils/mapTheme';
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

/** Re-route only after the rider has moved this far — roads don't change faster. */
const ROUTE_REFRESH_DISTANCE_M = 120;
/** …or after this long, so a stationary rider still gets a fresh ETA. */
const ROUTE_REFRESH_INTERVAL_MS = 20000;
/** How often the route conditions are evaluated. */
const ROUTE_TICK_MS = 5000;
/** Rider marker interpolation bounds, matched to the server's ~1 s packet rate. */
const MIN_INTERP_MS = 800;
const MAX_INTERP_MS = 2500;

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

  return { lat, lng, heading: Number(loc.bearing ?? loc.heading) || 0 };
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
  order = null,
  onEtaUpdate = null,
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

  const isPickedUp = PICKED_UP_STATUSES.has(
    String(order?.status || order?.orderStatus || '').toLowerCase(),
  );

  /* ─────────────────── Realtime rider position ─────────────────── */

  useEffect(() => {
    if (currentSmoothPosRef.current) return;
    const initial = readOrderRiderPosition(order);
    if (!initial) return;
    currentSmoothPosRef.current = initial;
    setRiderLocation(initial);
    setSmoothLocation(initial);
  }, [order]);

  const handleNewRiderPosition = useCallback((data) => {
    const lat = Number(data?.lat ?? data?.boy_lat ?? data?.latitude);
    const lng = Number(data?.lng ?? data?.boy_lng ?? data?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const now = Date.now();
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
  }, []);

  useEffect(() => {
    const trackingIds = trackingIdsKey ? trackingIdsKey.split(',') : [];
    if (!trackingIds.length) return undefined;

    const unsubs = trackingIds.map((id) => subscribeOrderTracking(id, handleNewRiderPosition));
    if (deliveryPartnerId) {
      unsubs.push(subscribeDeliveryLocation(deliveryPartnerId, handleNewRiderPosition));
    }

    // The global user socket also republishes rider positions as a window event.
    const handleGlobalLocation = (event) => {
      const data = event?.detail;
      if (!data) return;
      const matches = trackingIds.some(
        (id) => String(id) === String(data.orderId) || String(id) === String(data.orderMongoId),
      );
      if (matches || !data.orderId) handleNewRiderPosition(data);
    };
    window.addEventListener('riderLocationUpdate', handleGlobalLocation);

    const teardown = (socket) => () => {
      unsubs.forEach((unsub) => unsub?.());
      window.removeEventListener('riderLocationUpdate', handleGlobalLocation);
      if (socket) {
        socket.disconnect();
        socketRef.current = null;
      }
    };

    const socket = createAppSocket({ role: 'user', label: 'DeliveryTrackingMap' });
    if (!socket) return teardown(null);
    socketRef.current = socket;

    socket.on('connect', () => trackingIds.forEach((id) => socket.emit('join-tracking', id)));
    socket.on('location-update', (data) => data && handleNewRiderPosition(data));

    return teardown(socket);
  }, [trackingIdsKey, deliveryPartnerId, handleNewRiderPosition]);

  /* ─────────────────── 60 fps marker interpolation ─────────────────── */

  useEffect(() => {
    let frameId;
    const step = () => {
      const { startPos, targetPos, startTime, duration } = interpStateRef.current;
      if (startPos && targetPos) {
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
      }
      frameId = requestAnimationFrame(step);
    };

    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const riderPosition = smoothLocation || riderLocation;

  /* ─────────────────── Route: rider → customer, once picked up ─────────────────── */

  const requestRoute = useCallback(
    (origin) => {
      if (!isLoaded || !origin || !customerCoords || routeStateRef.current.inFlight) return;
      routeStateRef.current.inFlight = true;

      new window.google.maps.DirectionsService().route(
        {
          origin,
          destination: customerCoords,
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          routeStateRef.current.inFlight = false;
          if (status !== window.google.maps.DirectionsStatus.OK || !result?.routes?.[0]) return;

          routeStateRef.current.lastAt = Date.now();
          routeStateRef.current.lastOrigin = origin;

          const leg = result.routes[0].legs?.[0];
          setRoutePath(result.routes[0].overview_path);
          setRouteMeta({
            distanceMeters: leg?.distance?.value ?? null,
            durationSeconds: leg?.duration?.value ?? null,
          });
          if (onEtaUpdate && leg?.duration?.text) onEtaUpdate(leg.duration.text);
        },
      );
    },
    [isLoaded, customerCoords, onEtaUpdate],
  );

  // Poll rather than react to every position packet: the rider emits ~1/s, and one
  // Directions request per packet would be both slow and needlessly expensive.
  useEffect(() => {
    if (!isPickedUp || !isLoaded) {
      setRoutePath(null);
      routeStateRef.current = { lastAt: 0, lastOrigin: null, inFlight: false };
      return undefined;
    }

    const tick = () => {
      const origin = currentSmoothPosRef.current || restaurantCoords;
      if (!origin) return;

      const { lastAt, lastOrigin } = routeStateRef.current;
      const movedFar =
        !lastOrigin ||
        computeDistanceMeters(lastOrigin.lat, lastOrigin.lng, origin.lat, origin.lng) >
          ROUTE_REFRESH_DISTANCE_M;

      if (movedFar || Date.now() - lastAt > ROUTE_REFRESH_INTERVAL_MS) {
        requestRoute({ lat: origin.lat, lng: origin.lng });
      }
    };

    tick();
    const intervalId = setInterval(tick, ROUTE_TICK_MS);
    return () => clearInterval(intervalId);
  }, [isPickedUp, isLoaded, requestRoute, restaurantCoords]);

  /* ─────────────────── Distance and ETA shown to the customer ─────────────────── */

  const tripDistanceMeters = useMemo(() => {
    // While the rider is en route, the live route is authoritative.
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
    routeMeta.distanceMeters,
    order?.tripDistanceKm,
    order?.pricing?.roadDistanceKm,
    restaurantCoords,
    customerCoords,
  ]);

  const etaText = useMemo(() => {
    if (isPickedUp && Number.isFinite(routeMeta.durationSeconds)) {
      return formatDuration(routeMeta.durationSeconds);
    }
    const storedMins = Number(order?.tripDurationMins ?? order?.pricing?.roadDurationMins);
    return Number.isFinite(storedMins) && storedMins > 0 ? `${Math.round(storedMins)} min` : '';
  }, [
    isPickedUp,
    routeMeta.durationSeconds,
    order?.tripDurationMins,
    order?.pricing?.roadDurationMins,
  ]);

  /* ─────────────────── Camera ─────────────────── */

  const phaseKey = `${isPickedUp}|${restaurantCoords?.lat},${restaurantCoords?.lng}|${customerCoords?.lat},${customerCoords?.lng}`;

  useEffect(() => {
    if (!map || !customerCoords) return;

    // A new phase re-frames the trip and clears any earlier manual pan.
    userPannedRef.current = false;

    const bounds = new window.google.maps.LatLngBounds();
    bounds.extend(customerCoords);
    const origin = isPickedUp ? currentSmoothPosRef.current || restaurantCoords : restaurantCoords;
    if (origin) bounds.extend(origin);

    map.fitBounds(bounds, {
      top: 90,
      bottom: Math.min(window.innerHeight * 0.48, 380),
      left: 45,
      right: 45,
    });
  }, [map, phaseKey, isPickedUp, customerCoords, restaurantCoords]);

  useEffect(() => {
    if (!map) return undefined;
    const listener = map.addListener('dragstart', () => {
      userPannedRef.current = true;
    });
    return () => listener?.remove();
  }, [map]);

  // Keep the rider in frame while it moves, unless the customer panned away to
  // look at something themselves.
  useEffect(() => {
    if (!map || !isPickedUp || !riderPosition || userPannedRef.current) return;
    const viewport = map.getBounds();
    if (viewport && !viewport.contains(riderPosition)) map.panTo(riderPosition);
  }, [map, isPickedUp, riderPosition]);

  const center = useMemo(() => {
    if (restaurantCoords && customerCoords) {
      return {
        lat: (restaurantCoords.lat + customerCoords.lat) / 2,
        lng: (restaurantCoords.lng + customerCoords.lng) / 2,
      };
    }
    return restaurantCoords || customerCoords || { lat: 0, lng: 0 };
  }, [restaurantCoords, customerCoords]);

  /* ─────────────────── Render ─────────────────── */

  // Before pickup this links restaurant → customer. After pickup it is the safety
  // net for the live route: if Directions is unavailable (quota, network) the
  // customer still sees the rider connected to their address rather than a bare map.
  const pendingLinePath = useMemo(() => {
    if (!customerCoords) return null;
    const origin = isPickedUp ? riderPosition || restaurantCoords : restaurantCoords;
    return origin ? [origin, customerCoords] : null;
  }, [isPickedUp, riderPosition, restaurantCoords, customerCoords]);

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
    <div className="relative w-full h-full overflow-hidden">
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={center}
        zoom={14}
        onLoad={setMap}
        options={mapOptions}
      >
        {/* Dashed link: the whole leg before pickup, the fallback after it. */}
        {(!isPickedUp || !routePath) && pendingLinePath && (
          <Polyline path={pendingLinePath} options={dashedLineOptions} />
        )}

        {/* After pickup: live road route, drawn with a casing so it reads on any surface. */}
        {isPickedUp && routePath && (
          <>
            <Polyline
              path={routePath}
              options={{
                strokeColor: palette.routeCasing,
                strokeOpacity: 0.9,
                strokeWeight: 9,
                zIndex: 8,
              }}
            />
            <Polyline
              path={routePath}
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

        {customerCoords && (
          <OverlayView position={customerCoords} mapPaneName={OverlayView.MARKER_LAYER}>
            <div className="relative flex flex-col items-center pointer-events-none -translate-x-1/2 -translate-y-1/2">
              <div
                className="absolute -top-12 z-50 rounded-full flex items-center px-2.5 py-1 shadow-lg gap-1.5"
                style={badgeStyle}
              >
                <span className="text-[11px] font-bold">You</span>
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

        {/* The bike appears only once the food is actually on it. */}
        {isPickedUp && riderPosition && (
          <OverlayView position={riderPosition} mapPaneName={OverlayView.MARKER_LAYER}>
            <div className="relative flex flex-col items-center pointer-events-none -translate-x-1/2 -translate-y-1/2 z-40">
              {etaText && (
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
                  transform: `rotate(${riderPosition.heading || 0}deg)`,
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
    </div>
  );
};

export default React.memo(DeliveryTrackingMap);
