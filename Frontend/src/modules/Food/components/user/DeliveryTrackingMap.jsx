import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { 
  GoogleMap, 
  useJsApiLoader, 
  Marker, 
  OverlayView, 
  DirectionsService, 
  DirectionsRenderer,
  Polyline
} from '@react-google-maps/api';
import io from 'socket.io-client';
import { API_BASE_URL } from '@food/api/config';
import bikeLogo from '@food/assets/deliveryboy-3d.jpeg';
import mapRiderIcon from '@food/assets/MapRider.png';
import { subscribeOrderTracking } from '@food/realtimeTracking';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Navigation, Info, Circle } from 'lucide-react';

const LIBRARIES = ['geometry', 'places'];

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
  const [directions, setDirections] = useState(null);
  const [baselineDirections, setBaselineDirections] = useState(null);
  const [lastDirectionsAt, setLastDirectionsAt] = useState(0);
  const [currentEta, setCurrentEta] = useState(null);
  const [cloudPolyline, setCloudPolyline] = useState(null);
  const [smoothLocation, setSmoothLocation] = useState(null);
  const socketRef = useRef(null);
  const interpStateRef = useRef({ lastPos: null, nextPos: null, startTime: 0 });

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES,
  });

  const trackingIds = useMemo(() => {
    const ids = [orderId, ...(Array.isArray(orderTrackingIds) ? orderTrackingIds : [])]
      .map(id => String(id || '').trim())
      .filter(Boolean);
    return [...new Set(ids)];
  }, [orderId, orderTrackingIds]);

  const backendUrl = useMemo(() => {
    return (API_BASE_URL || '').replace(/\/api\/v1\/?$/i, '').replace(/\/api\/?$/i, '');
  }, []);

  // 1. Initial State from Order Payload
  useEffect(() => {
    let loc = order?.deliveryState?.currentLocation || 
              order?.tracking?.location || 
              order?.deliveryPartner?.location ||
              order?.dispatch?.currentLocation ||
              order?.dispatch?.location;

    if (loc && !riderLocation) {
      const lat = typeof loc.lat === 'number' ? loc.lat : 
                  (Array.isArray(loc.coordinates) ? Number(loc.coordinates[1]) : 
                  (typeof loc.latitude === 'number' ? loc.latitude : null));
      
      const lng = typeof loc.lng === 'number' ? loc.lng : 
                  (Array.isArray(loc.coordinates) ? Number(loc.coordinates[0]) : 
                  (typeof loc.longitude === 'number' ? loc.longitude : null));

      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setRiderLocation({ lat, lng, heading: loc.bearing || loc.heading || 0 });
      }
    }
  }, [order, riderLocation]);

  // 2. Core Data Sync (Socket + Firebase)
  useEffect(() => {
    if (!trackingIds.length) return;

    // A. FIREBASE FALLBACK
    const unsubs = trackingIds.map(id => subscribeOrderTracking(id, (data) => {
      const lat = Number(data?.lat ?? data?.boy_lat);
      const lng = Number(data?.lng ?? data?.boy_lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        setRiderLocation(prev => ({
          lat,
          lng,
          heading: Number(data?.heading ?? data?.bearing ?? prev?.heading ?? 0)
        }));
      }

      // Sync Cloud Polyline and ETA to eliminate Directions API usage on user side
      if (data?.polyline) {
        debugLog('?? Received Cloud Polyline for live path');
        setCloudPolyline(data.polyline);
      }
      if (data?.eta) {
        debugLog('?? Received real-time ETA:', data.eta);
        setCurrentEta(data.eta);
        if (onEtaUpdate) onEtaUpdate(data.eta);
      }
    }));

    // B. SOCKET.IO REALTIME
    const token = localStorage.getItem('user_accessToken') || localStorage.getItem('accessToken') || '';
    socketRef.current = io(backendUrl, {
      transports: ['websocket'],
      auth: { token }
    });

    socketRef.current.on('connect', () => {
      trackingIds.forEach(id => socketRef.current.emit('join-tracking', id));
    });

    socketRef.current.on('location-update', (data) => {
      // Ensure data belongs to one of our tracked orders
      const matchedId = trackingIds.find(id => String(id) === String(data.orderId));
      if (data && matchedId && typeof data.lat === 'number') {
        const nextPos = {
          lat: data.lat,
          lng: data.lng,
          heading: data.heading || data.bearing || 0
        };
        
        // Trigger Smooth Interpolation
        interpStateRef.current = {
           lastPos: smoothLocation || riderLocation || nextPos,
           nextPos: nextPos,
           startTime: Date.now()
        };
        
        setRiderLocation(nextPos);
      }
    });

    return () => {
      unsubs.forEach(u => u?.());
      socketRef.current?.disconnect();
    };
  }, [trackingIds, backendUrl, smoothLocation, riderLocation]);

  // 3. Smooth Animation Loop (60 FPS Glide)
  useEffect(() => {
    let frame;
    const update = () => {
      const { lastPos, nextPos, startTime } = interpStateRef.current;
      if (lastPos && nextPos) {
        const duration = 5000; // Expected update interval (match rider app throttle)
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Linear Interpolation (LERP)
        const lat = lastPos.lat + (nextPos.lat - lastPos.lat) * progress;
        const lng = lastPos.lng + (nextPos.lng - lastPos.lng) * progress;
        
        // Heading interpolation (shortest path)
        let lastHead = lastPos.heading || 0;
        let nextHead = nextPos.heading || 0;
        if (Math.abs(nextHead - lastHead) > 180) {
          if (nextHead > lastHead) lastHead += 360;
          else nextHead += 360;
        }
        const heading = lastHead + (nextHead - lastHead) * progress;

        setSmoothLocation({ lat, lng, heading: heading % 360 });
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Use smooth location for sync if available
  // Use smooth location for sync if available, fallback to restaurant if rider hasn't started sending coords yet
  const displayRiderLocation = smoothLocation || riderLocation || restaurantCoords;

  const tripStatus = order?.status || order?.orderStatus || 'pending';
  const isOrderPickedUp = ['picked_up', 'out_for_delivery', 'delivered'].includes(tripStatus.toLowerCase());

  // 2. Intelligent Camera & Bounds: Frame Restaurant & Customer Journey
  useEffect(() => {
    if (!map || !isLoaded) return;
    const bounds = new window.google.maps.LatLngBounds();
    if (restaurantCoords) bounds.extend(restaurantCoords);
    if (customerCoords) bounds.extend(customerCoords);

    // If order is out for delivery, also ensure moving rider is in view
    if (isOrderPickedUp && displayRiderLocation) {
      bounds.extend(displayRiderLocation);
    }

    map.fitBounds(bounds, {
      top: 90, 
      bottom: Math.min(window.innerHeight * 0.48, 380), 
      left: 45, 
      right: 45 
    });
    
    debugLog(`[Camera] Framing Restaurant <-> Customer delivery journey`);
  }, [map, restaurantCoords, customerCoords, isOrderPickedUp, displayRiderLocation, isLoaded]);

  // 3. Directions Management (Always Customer-Centric: Restaurant -> Customer or Rider -> Customer)
  const directionsCallback = useCallback((result, status) => {
    if (status === 'OK' && result) {
      setDirections(result);
      setLastDirectionsAt(Date.now());
      
      // Extract ETA from directions
      const durationText = result?.routes?.[0]?.legs?.[0]?.duration?.text;
      if (durationText) {
        setCurrentEta(durationText);
        if (onEtaUpdate) {
          onEtaUpdate(durationText);
        }
      }
    }
  }, [onEtaUpdate]);

  const shouldUpdateRoute = useMemo(() => {
    if (!directions) return true;
    return Date.now() - lastDirectionsAt > 15000;
  }, [directions, lastDirectionsAt]);

  // For User App: Route is ALWAYS to Customer (either from Restaurant before pickup, or from Rider after pickup)
  const directionsServiceOptions = useMemo(() => {
    if (!customerCoords) return null;
    
    if (isOrderPickedUp && riderLocation) {
      return {
        origin: riderLocation,
        destination: customerCoords,
        travelMode: 'DRIVING'
      };
    }

    return null;
  }, [riderLocation?.lat, riderLocation?.lng, isOrderPickedUp, customerCoords?.lat, customerCoords?.lng]);

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

        {/* 2. LIVE RIDER LEG VIA DIRECTIONS SERVICE (When picked up) */}
        {isOrderPickedUp && !cloudPolyline && directionsServiceOptions && (
          <DirectionsService
            options={directionsServiceOptions}
            callback={shouldUpdateRoute ? directionsCallback : undefined}
          />
        )}

        {isOrderPickedUp && directions && !cloudPolyline && (
          <DirectionsRenderer
            directions={directions}
            options={{
              suppressMarkers: true,
              preserveViewport: true,
              polylineOptions: {
                strokeColor: '#2563eb',
                strokeWeight: 5,
                strokeOpacity: 1,
                zIndex: 10
              }
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

        {/* RIDER ON MAP (At Restaurant when preparing / moving towards user when picked up) */}
        {effectiveRiderPos && isOrderPickedUp && (
          <OverlayView
            position={effectiveRiderPos}
            mapPaneName={OverlayView.MARKER_LAYER}
          >
            <div 
              style={{ transition: 'transform 0.1s linear' }}
              className="relative flex flex-col items-center justify-center pointer-events-none -translate-x-1/2 -translate-y-1/2"
            >
              {/* Floating ETA Badge */}
              {currentEta && (
                <div className="absolute -top-8 z-50 whitespace-nowrap bg-[#1e1e1e] text-white text-[10px] font-bold px-2 py-1 rounded-md shadow-lg flex items-center gap-1">
                  <span>{currentEta.replace('mins', 'min')}</span>
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-[#1e1e1e] rotate-45"></div>
                </div>
              )}

              {/* Pulsing Ring */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0">
                <motion.div 
                  animate={{ scale: [1, 2.5], opacity: [0.6, 0] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-16 h-16 rounded-full border-4 border-blue-500/30"
                />
              </div>

              {/* Rotating Bike */}
              <div 
                style={{
                  transform: `rotate(${effectiveRiderPos.heading || 0}deg)`,
                  transition: 'transform 0.1s linear',
                }}
                className="relative w-16 h-16 flex items-center justify-center z-10"
              >
                <img 
                  src={mapRiderIcon} 
                  alt="Rider" 
                  className="w-[150%] h-[150%] max-w-none object-contain drop-shadow-xl"
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
