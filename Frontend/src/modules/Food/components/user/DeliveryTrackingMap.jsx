import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { 
  GoogleMap, 
  useJsApiLoader, 
  OverlayView, 
  DirectionsService, 
  Polyline
} from '@react-google-maps/api';
import { createAppSocket } from '@food/api/socketClient';
import bikeLogo from '@food/assets/deliveryboy-3d.jpeg';
import mapRiderIcon from '@food/assets/MapRider.png';
import { subscribeOrderTracking, subscribeDeliveryLocation } from '@food/realtimeTracking';
import { motion } from 'framer-motion';

const LIBRARIES = ['geometry', 'places'];

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
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

function computeDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const RIDER_BIKE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
  <circle cx="30" cy="30" r="28" fill="white" stroke="#ff8100" stroke-width="4" />
  <g transform="translate(15, 15) scale(1.2)">
    <path d="M19 7c0-1.1-.9-2-2-2h-3v2h3v2.65l-2.13 1.52c-.31.22-.5.57-.5.95V13h-4.4a2 2 0 00-1.92 1.45L6 20H2v2h4.5c1.07 0 1.97-.85 1.97-1.97V20l.4-1.2h3.13l.4 1.2c.4 1.2 1.5 2 2.77 2h.3c1.07 0 1.97-.85 1.97-1.97V20l-.4-1.2H14.1l-.33-1H18v-2h-2.17l-.67-2H18c1.1 0 2-.9 2-2V7h-1zM7 18h-.5C5.67 18 5 17.33 5 16.5S5.67 15 6.5 15H7v3zm8.5 0h-.5V15h.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z" fill="#ff8100" />
  </g>
</svg>`;

const RESTAURANT_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#FF6B35">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/>
  <circle cx="12" cy="9" r="3" fill="#FFFFFF"/>
</svg>`;

const zomatoMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.neighborhood", stylers: [{ visibility: "off" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.arterial", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.local", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#e9e9e9" }] },
];

const CUSTOMER_PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#10B981">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/>
  <circle cx="12" cy="9" r="3" fill="#FFFFFF"/>
</svg>`;

const debugLog = (...args) => console.log('[DeliveryTrackingMap]', ...args);

const DeliveryTrackingMap = ({
  orderId,
  orderTrackingIds = [],
  restaurantCoords,
  customerCoords,
  order = null,
  onEtaUpdate = null,
  deliveryBoyData = null
}) => {
  const [map, setMap] = useState(null);
  const [riderLocation, setRiderLocation] = useState(null);
  const [baselineDirections, setBaselineDirections] = useState(null);
  const [currentEta, setCurrentEta] = useState(null);
  const [cloudPolyline, setCloudPolyline] = useState(null);
  const [smoothLocation, setSmoothLocation] = useState(null);
  const socketRef = useRef(null);

  // High-frequency animation and packet tracking refs (no effect re-triggers)
  const currentSmoothPosRef = useRef(null);
  const interpStateRef = useRef({ startPos: null, targetPos: null, startTime: 0, duration: 1500 });
  const lastPacketTimeRef = useRef(0);

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  const trackingIds = useMemo(() => {
    const ids = [
      orderId,
      order?._id,
      order?.orderId,
      order?.orderMongoId,
      ...(Array.isArray(orderTrackingIds) ? orderTrackingIds : [])
    ]
      .map(id => String(id || '').trim())
      .filter(Boolean);
    return [...new Set(ids)];
  }, [orderId, order?._id, order?.orderId, order?.orderMongoId, JSON.stringify(orderTrackingIds)]);

  const trackingIdsKey = trackingIds.join(',');

  const deliveryPartnerId = useMemo(() => {
    return String(
      order?.deliveryPartnerId ||
      order?.dispatch?.deliveryPartnerId ||
      order?.deliveryPartner?._id ||
      order?.deliveryPartner?.id ||
      ''
    ).trim();
  }, [order?.deliveryPartnerId, order?.dispatch?.deliveryPartnerId, order?.deliveryPartner?._id, order?.deliveryPartner?.id]);

  // 1. Initial State from Order Payload
  useEffect(() => {
    const loc = order?.deliveryState?.currentLocation || 
                order?.tracking?.location || 
                order?.deliveryPartner?.location ||
                order?.dispatch?.currentLocation ||
                order?.dispatch?.location;

    if (loc && !currentSmoothPosRef.current) {
      const lat = typeof loc.lat === 'number' ? loc.lat : 
                  (Array.isArray(loc.coordinates) ? Number(loc.coordinates[1]) : 
                  (typeof loc.latitude === 'number' ? loc.latitude : null));
      
      const lng = typeof loc.lng === 'number' ? loc.lng : 
                  (Array.isArray(loc.coordinates) ? Number(loc.coordinates[0]) : 
                  (typeof loc.longitude === 'number' ? loc.longitude : null));

      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const initial = { lat, lng, heading: loc.bearing || loc.heading || 0 };
        currentSmoothPosRef.current = initial;
        setRiderLocation(initial);
        setSmoothLocation(initial);
      }
    }
  }, [order]);

  // Handler for all incoming rider position packets (Socket / Firebase / CustomEvent)
  const handleNewRiderPosition = useCallback((data) => {
    const lat = Number(data?.lat ?? data?.boy_lat ?? data?.latitude);
    const lng = Number(data?.lng ?? data?.boy_lng ?? data?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const rawHeading = Number(data?.heading ?? data?.bearing);
    const now = Date.now();
    const currentRendered = currentSmoothPosRef.current;

    let computedHeading = Number.isFinite(rawHeading) && rawHeading !== 0 ? rawHeading : null;
    if (computedHeading == null && currentRendered) {
      const dist = computeDistanceMeters(currentRendered.lat, currentRendered.lng, lat, lng);
      if (dist > 1.5) {
        computedHeading = computeBearing(currentRendered.lat, currentRendered.lng, lat, lng);
      } else {
        computedHeading = currentRendered.heading || 0;
      }
    }

    const newTarget = {
      lat,
      lng,
      heading: computedHeading ?? 0,
    };

    const startPos = currentRendered || newTarget;
    const timeSinceLastUpdate = lastPacketTimeRef.current ? (now - lastPacketTimeRef.current) : 1500;
    lastPacketTimeRef.current = now;

    // Dynamic duration: smoothly match packet frequency (capped between 800ms and 2500ms)
    const duration = Math.min(Math.max(timeSinceLastUpdate, 800), 2500);

    interpStateRef.current = {
      startPos,
      targetPos: newTarget,
      startTime: now,
      duration,
    };

    setRiderLocation(newTarget);

    if (data?.polyline) {
      setCloudPolyline(data.polyline);
    }
    if (data?.eta) {
      setCurrentEta(data.eta);
      if (onEtaUpdate) onEtaUpdate(data.eta);
    }
  }, [onEtaUpdate]);

  // 2. Core Realtime Sync (Stable Socket.IO + Firebase Realtime DB)
  useEffect(() => {
    if (!trackingIds.length) return;

    // A. Firebase Realtime Listeners
    const unsubs = [];
    trackingIds.forEach((id) => {
      unsubs.push(subscribeOrderTracking(id, (data) => {
        handleNewRiderPosition(data);
      }));
    });

    if (deliveryPartnerId) {
      unsubs.push(subscribeDeliveryLocation(deliveryPartnerId, (data) => {
        handleNewRiderPosition(data);
      }));
    }

    // B. Custom window event from global user notifications socket
    const handleGlobalLocation = (e) => {
      const data = e?.detail;
      if (!data) return;
      const isMatching = trackingIds.some(
        (id) => String(id) === String(data.orderId) || String(id) === String(data.orderMongoId)
      );
      if (isMatching || !data.orderId) {
        handleNewRiderPosition(data);
      }
    };
    window.addEventListener('riderLocationUpdate', handleGlobalLocation);

    // C. Dedicated Socket.IO Connection with Auto-reconnect & join
    const socket = createAppSocket({ role: 'user', label: 'DeliveryTrackingMap' });
    if (!socket) {
      return () => {
        unsubs.forEach((u) => u?.());
        window.removeEventListener('riderLocationUpdate', handleGlobalLocation);
      };
    }
    socketRef.current = socket;

    socket.on('connect', () => {
      debugLog('🟢 Tracking Socket connected, joining rooms for:', trackingIds);
      trackingIds.forEach((id) => socket.emit('join-tracking', id));
    });

    socket.on('location-update', (data) => {
      if (!data) return;
      handleNewRiderPosition(data);
    });

    return () => {
      unsubs.forEach((u) => u?.());
      window.removeEventListener('riderLocationUpdate', handleGlobalLocation);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [trackingIdsKey, deliveryPartnerId, handleNewRiderPosition]);

  // 3. Smooth 60 FPS Gliding Animation Loop (Continuous LERP + EaseOut)
  useEffect(() => {
    let frameId;
    const update = () => {
      const { startPos, targetPos, startTime, duration } = interpStateRef.current;
      if (startPos && targetPos) {
        const now = Date.now();
        const elapsed = now - startTime;
        const rawProgress = Math.min(elapsed / (duration || 1500), 1);
        
        // Quadratic easeOut curve for silky deceleration
        const easeProgress = 1 - Math.pow(1 - rawProgress, 2);

        // Position interpolation
        const lat = startPos.lat + (targetPos.lat - startPos.lat) * easeProgress;
        const lng = startPos.lng + (targetPos.lng - startPos.lng) * easeProgress;

        // Heading interpolation (shortest circular distance)
        let startHead = startPos.heading || 0;
        let targetHead = targetPos.heading || 0;
        let diff = (targetHead - startHead) % 360;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        const heading = (startHead + diff * easeProgress + 360) % 360;

        const currentPos = { lat, lng, heading };
        currentSmoothPosRef.current = currentPos;
        setSmoothLocation(currentPos);
      }
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // Use smooth location for sync if available, fallback to restaurant
  const displayRiderLocation = smoothLocation || riderLocation || restaurantCoords;

  const tripStatus = String(order?.status || order?.orderStatus || '').toLowerCase();
  const isOrderPickedUp = ['picked_up', 'out_for_delivery', 'on_way', 'en_route_to_delivery', 'reached_drop', 'at_drop', 'delivered'].includes(tripStatus);
  const isRiderAssigned = Boolean(order?.deliveryPartnerId || order?.dispatch?.deliveryPartnerId || order?.deliveryPartner || riderLocation);

  // 2. Intelligent Camera & Bounds: Frame Restaurant & Customer Journey ONCE or when coords change
  const boundsKey = `${restaurantCoords?.lat}_${restaurantCoords?.lng}_${customerCoords?.lat}_${customerCoords?.lng}`;
  const lastBoundsKeyRef = useRef('');

  useEffect(() => {
    if (!map || !isLoaded || !restaurantCoords || !customerCoords) return;
    if (lastBoundsKeyRef.current === boundsKey) return;
    lastBoundsKeyRef.current = boundsKey;

    try {
      const bounds = new window.google.maps.LatLngBounds();
      if (restaurantCoords) bounds.extend(restaurantCoords);
      if (customerCoords) bounds.extend(customerCoords);

      map.fitBounds(bounds, {
        top: 90, 
        bottom: Math.min(window.innerHeight * 0.48, 380), 
        left: 45, 
        right: 45 
      });
      debugLog(`[Camera] Framed Restaurant <-> Customer delivery journey`);
    } catch (e) {
      debugLog('Error fitting bounds:', e);
    }
  }, [map, isLoaded, restaurantCoords, customerCoords, boundsKey]);

  const center = useMemo(() => {
    if (customerCoords && restaurantCoords) {
      return {
        lat: (restaurantCoords.lat + customerCoords.lat) / 2,
        lng: (restaurantCoords.lng + customerCoords.lng) / 2
      };
    }
    return restaurantCoords || customerCoords || { lat: 0, lng: 0 };
  }, [restaurantCoords, customerCoords]);

  const zoom = useMemo(() => 14, []);

  // Main Persistent Delivery Route: Restaurant -> Customer
  const baselineDirectionsServiceOptions = useMemo(() => {
    if (!restaurantCoords || !customerCoords) return null;
    return {
      origin: restaurantCoords,
      destination: customerCoords,
      travelMode: 'DRIVING'
    };
  }, [restaurantCoords?.lat, restaurantCoords?.lng, customerCoords?.lat, customerCoords?.lng]);

  if (!isLoaded) return <div className="w-full h-full bg-gray-100 animate-pulse" />;

  // Rider position: When waiting at restaurant, anchor at restaurant; when picked up, follow live rider
  const effectiveRiderPos = isOrderPickedUp ? displayRiderLocation : (restaurantCoords || displayRiderLocation);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={center}
        zoom={zoom}
        onLoad={setMap}
        options={{
          styles: zomatoMapStyle,
          disableDefaultUI: false,
          zoomControl: true,
          mapTypeControl: false,
          scaleControl: true,
          streetViewControl: false,
          rotateControl: false,
          fullscreenControl: false,
          gestureHandling: 'greedy'
        }}
      >
        {/* 1. PERSISTENT RESTAURANT -> CUSTOMER DELIVERY ROUTE */}
        {!baselineDirections && baselineDirectionsServiceOptions && (
           <DirectionsService
             options={baselineDirectionsServiceOptions}
             callback={(r, s) => { 
                debugLog('Baseline Directions Status:', s);
                if (s === 'OK' && r) {
                    setBaselineDirections(r); 
                    if (!isOrderPickedUp) {
                      const durationText = r?.routes?.[0]?.legs?.[0]?.duration?.text;
                      if (durationText) {
                        setCurrentEta(durationText);
                        if (onEtaUpdate) onEtaUpdate(durationText);
                      }
                    }
                }
             }}
           />
        )}

        {/* 1. RESTAURANT -> CUSTOMER DELIVERY POLYLINE */}
        {baselineDirections && (
          <Polyline
            path={baselineDirections.routes[0].overview_path}
            options={{
              strokeColor: '#3b82f6', 
              strokeOpacity: isOrderPickedUp ? 0.45 : 1,
              strokeWeight: isOrderPickedUp ? 3.5 : 4.5,
              zIndex: 5
            }}
          />
        )}

        {/* 2. LIVE RIDER LEG (When order is out for delivery: Rider -> Customer) */}
        {isOrderPickedUp && cloudPolyline && window.google?.maps?.geometry?.encoding && (
          <Polyline
            path={(() => {
              const decoded = window.google.maps.geometry.encoding.decodePath(
                typeof cloudPolyline === 'string' ? cloudPolyline : (cloudPolyline.points || '')
              );
              return decoded;
            })()}
            options={{
              strokeColor: '#2563eb',
              strokeWeight: 5,
              strokeOpacity: 1,
              zIndex: 10
            }}
          />
        )}

        {/* RESTAURANT PIN */}
        {restaurantCoords && (
          <OverlayView
            position={restaurantCoords}
            mapPaneName={OverlayView.MARKER_LAYER}
          >
            <div className="relative flex flex-col items-center justify-center pointer-events-none -translate-x-1/2 -translate-y-1/2">
               <div className="absolute -top-12 z-50 bg-[#1e1e1e] text-white rounded-full flex items-center px-2 py-1 shadow-lg border border-black/10 gap-1.5">
                 <img 
                   src={order?.restaurantLogo || order?.restaurantId?.logo || order?.restaurantId?.profileImage || `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(RESTAURANT_PIN_SVG)}`} 
                   className="w-5 h-5 rounded-full object-cover bg-white" 
                   onError={(e) => { e.target.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(RESTAURANT_PIN_SVG)}`; }}
                 />
                 <span className="text-[11px] font-bold pr-1">{order?.restaurantName || order?.restaurantId?.name || "Restaurant"}</span>
                 <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-[#1e1e1e] rotate-45" />
               </div>
               <div className="w-4 h-4 bg-orange-500 border-[3px] border-white rounded-full shadow-md z-10" />
            </div>
          </OverlayView>
        )}

        {/* CUSTOMER PIN (You / Home) */}
        {customerCoords && (
          <OverlayView
            position={customerCoords}
            mapPaneName={OverlayView.MARKER_LAYER}
          >
            <div className="relative flex flex-col items-center justify-center pointer-events-none -translate-x-1/2 -translate-y-1/2">
               <div className="absolute -top-12 z-50 bg-[#1e1e1e] text-white rounded-full flex items-center px-2 py-1 shadow-lg border border-black/10 gap-1.5">
                 <img 
                   src={order?.customerImage || order?.userId?.profileImage || order?.userId?.avatar || `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(CUSTOMER_PIN_SVG)}`} 
                   className="w-5 h-5 rounded-full object-cover bg-white" 
                   onError={(e) => { e.target.src = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(CUSTOMER_PIN_SVG)}`; }}
                 />
                 <span className="text-[11px] font-bold pr-1">You</span>
                 <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-[#1e1e1e] rotate-45" />
               </div>
               <div className="w-4 h-4 bg-emerald-500 border-[3px] border-white rounded-full shadow-md z-10" />
            </div>
          </OverlayView>
        )}

        {/* RIDER ON MAP (Live 60 FPS Moving Bike) */}
        {effectiveRiderPos && (isOrderPickedUp || isRiderAssigned) && (
          <OverlayView
            position={effectiveRiderPos}
            mapPaneName={OverlayView.MARKER_LAYER}
          >
            <div 
              style={{ transition: 'transform 0.1s linear' }}
              className="relative flex flex-col items-center justify-center pointer-events-none -translate-x-1/2 -translate-y-1/2 z-40"
            >
              {/* Floating Status / ETA Badge */}
              <div className="absolute -top-8 z-50 whitespace-nowrap bg-[#1e1e1e] text-white text-[10px] font-bold px-2.5 py-1 rounded-md shadow-xl flex items-center gap-1.5 border border-white/10">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>
                  {isOrderPickedUp 
                    ? (currentEta ? currentEta.replace('mins', 'min') : 'On the way')
                    : 'Rider assigned'}
                </span>
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-[#1e1e1e] rotate-45 border-r border-b border-white/10"></div>
              </div>

              {/* Glowing Pulsing Radar Ring */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0">
                <motion.div 
                  animate={{ scale: [1, 2.8], opacity: [0.7, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                  className="w-14 h-14 rounded-full border-4 border-blue-500/40 bg-blue-500/10"
                />
              </div>

              {/* Live Rotating Bike Marker */}
              <div 
                style={{
                  transform: `rotate(${effectiveRiderPos.heading || 0}deg)`,
                  transition: 'transform 0.2s ease-out',
                }}
                className="relative w-16 h-16 flex items-center justify-center z-10"
              >
                <img 
                  src={mapRiderIcon} 
                  alt="Rider" 
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
    </div>
  );
};

export default DeliveryTrackingMap;
