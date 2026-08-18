import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { 
  GoogleMap, 
  Marker, 
  Polygon,
  Polyline,
  useJsApiLoader,
  OverlayView
} from '@react-google-maps/api';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';
import { zoneAPI } from '@food/api';
import { CUSTOMER_PIN_SVG } from '@/modules/DeliveryV2/components/map/map.icons';

const mapContainerStyle = {
  width: '100%',
  height: '100%',
  position: 'absolute',
  inset: 0
};

const mapOptions = {
  disableDefaultUI: true,
  zoomControl: false,
  mapTypeControl: false,
  scaleControl: false,
  streetViewControl: false,
  rotateControl: true,
  fullscreenControl: false,
  styles: [
    { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
    { featureType: "administrative.land_parcel", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
    { featureType: "poi", elementType: "geometry", stylers: [{ color: "#eeeeee" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9c9c9" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] }
  ]
};
const LIBRARIES = ['places', 'geometry'];
const MARKER_OVERLAP_HIDE_METERS = 40;
const DESTINATION_MARKER_Z_INDEX = 20;

function distanceBetweenMeters(a, b) {
  if (!a || !b || !window.google?.maps?.geometry) return Infinity;
  try {
    const p1 = new window.google.maps.LatLng(a.lat, a.lng);
    const p2 = new window.google.maps.LatLng(b.lat, b.lng);
    return window.google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
  } catch {
    return Infinity;
  }
}

function toLatLngLiteral(point) {
  if (!point) return null;
  const lat = typeof point.lat === 'function' ? point.lat() : (point.lat ?? point.latitude);
  const lng = typeof point.lng === 'function' ? point.lng() : (point.lng ?? point.longitude);
  return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
}

/** Normalize Route.computeRoutes / fallback into the shape LiveMap already uses. */
function buildDirectionsResult(pathPoints) {
  const overview_path = (pathPoints || []).map(toLatLngLiteral).filter(Boolean);
  if (!overview_path.length) return null;

  let overview_polyline = null;
  try {
    if (window.google?.maps?.geometry?.encoding) {
      overview_polyline = window.google.maps.geometry.encoding.encodePath(
        overview_path.map((p) => new window.google.maps.LatLng(p.lat, p.lng)),
      );
    }
  } catch {
    overview_polyline = null;
  }

  return { routes: [{ overview_path, overview_polyline }] };
}

async function computeDrivingRoute(origin, destination) {
  const { Route } = await window.google.maps.importLibrary('routes');
  const { routes } = await Route.computeRoutes({
    origin: { lat: origin.lat, lng: origin.lng },
    destination: { lat: destination.lat, lng: destination.lng },
    travelMode: 'DRIVING',
    fields: ['path', 'distanceMeters', 'durationMillis'],
  });

  const path = routes?.[0]?.path;
  if (!path?.length) {
    throw new Error('No route path returned');
  }
  return buildDirectionsResult(path);
}

export const LiveMap = ({ onMapClick, onMapLoad, onPathReceived, onPolylineReceived, zoom = 12 }) => {
  const riderLocation = useDeliveryStore((state) => state.riderLocation);
  const activeOrder = useDeliveryStore((state) => state.getFocusedOrder());
  const tripStatus = useDeliveryStore((state) => state.getFocusedTripStatus());
  
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: LIBRARIES
  });

  const [directions, setDirections] = useState(null);
  const [map, setMapInternal] = useState(null);
  const [zones, setZones] = useState([]);
  const [lastDirectionsAt, setLastDirectionsAt] = useState(0);
  const routeFetchInFlightRef = useRef(false);

  const handleMapLoad = (mapInstance) => {
    mapInstance.setOptions({
      disableDefaultUI: true,
      zoomControl: false,
      mapTypeControl: false,
      scaleControl: false,
      streetViewControl: false,
      rotateControl: true, // Enabled for front-view navigation
      fullscreenControl: false,
      tilt: 45, // 3D Perspective
    });
    setMapInternal(mapInstance);
    if (onMapLoad) onMapLoad(mapInstance);
  };

  useEffect(() => {
    setLastDirectionsAt(0);
    setDirections(null);
  }, [tripStatus, activeOrder?._id]);

  const parsePoint = useCallback((raw) => {
    if (!raw) return null;
    const lat = parseFloat(raw.lat ?? raw.latitude);
    const lng = parseFloat(raw.lng ?? raw.longitude);
    return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
  }, []);

  const restaurantPoint = useMemo(() => parsePoint(activeOrder?.restaurantLocation), [activeOrder?.restaurantLocation, parsePoint]);
  const customerPoint = useMemo(() => parsePoint(activeOrder?.customerLocation), [activeOrder?.customerLocation, parsePoint]);

  const targetLocation = useMemo(() => {
    if (!activeOrder) return null;
    let rawLoc = null;
    if (tripStatus === 'PICKING_UP' || tripStatus === 'REACHED_PICKUP') {
      rawLoc = activeOrder.restaurantLocation;
    } else if (tripStatus === 'PICKED_UP' || tripStatus === 'REACHED_DROP') {
      rawLoc = activeOrder.customerLocation;
    }
    if (!rawLoc) return null;
    return parsePoint(rawLoc);
  }, [activeOrder, tripStatus, parsePoint]);

  const parsedRiderLocation = useMemo(() => {
    if (!riderLocation) return null;
    const lat = parseFloat(riderLocation.lat || riderLocation.latitude);
    const lng = parseFloat(riderLocation.lng || riderLocation.longitude);
    return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng, heading: parseFloat(riderLocation.heading || 0) } : null;
  }, [riderLocation]);

  useEffect(() => {
    if (!map || typeof zoom !== 'number') return;
    const currentZoom = map.getZoom();
    if (currentZoom !== zoom) map.setZoom(zoom);
  }, [zoom, map]);

  const routeThrottleMs = useMemo(() => {
    if (!parsedRiderLocation || !targetLocation || !window.google?.maps?.geometry) return 20000;
    try {
      const dist = distanceBetweenMeters(parsedRiderLocation, targetLocation);
      if (dist > 2000) return 60000;
      if (dist > 500) return 20000;
      return 5000;
    } catch {
      return 20000;
    }
  }, [parsedRiderLocation, targetLocation]);

  // Routes API (new) — replaces legacy DirectionsService which is blocked on new GCP projects
  useEffect(() => {
    if (!isLoaded || !window.google?.maps) return;
    if (!parsedRiderLocation || !targetLocation) return;

    const now = Date.now();
    if (directions && now - lastDirectionsAt < routeThrottleMs) return;
    if (routeFetchInFlightRef.current) return;

    let cancelled = false;
    routeFetchInFlightRef.current = true;

    (async () => {
      try {
        const result = await computeDrivingRoute(parsedRiderLocation, targetLocation);
        if (cancelled || !result) return;
        setDirections(result);
        setLastDirectionsAt(Date.now());
        const encoded = result.routes?.[0]?.overview_polyline;
        if (encoded && onPolylineReceived) onPolylineReceived(encoded);
      } catch (err) {
        console.warn('[LiveMap] Routes API failed, using straight-line fallback:', err?.message || err);
        if (cancelled) return;
        const fallback = buildDirectionsResult([
          { lat: parsedRiderLocation.lat, lng: parsedRiderLocation.lng },
          { lat: targetLocation.lat, lng: targetLocation.lng },
        ]);
        if (fallback) {
          setDirections(fallback);
          setLastDirectionsAt(Date.now());
        }
      } finally {
        routeFetchInFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isLoaded,
    parsedRiderLocation?.lat,
    parsedRiderLocation?.lng,
    targetLocation?.lat,
    targetLocation?.lng,
    routeThrottleMs,
    lastDirectionsAt,
    directions,
    onPolylineReceived,
  ]);

  useEffect(() => {
    if (directions && onPathReceived) {
      const path = directions.routes[0]?.overview_path;
      if (path) {
        const simplePath = path.map(p => ({
          lat: typeof p.lat === 'function' ? p.lat() : (p.lat || p.latitude),
          lng: typeof p.lng === 'function' ? p.lng() : (p.lng || p.longitude)
        }));
        onPathReceived(simplePath);
      }
    }
  }, [directions, onPathReceived]);

  useEffect(() => {
    (async () => {
      try {
        const response = await zoneAPI.getPublicZones();
        if (response?.data?.success && response.data.data?.zones) {
          const formattedZones = response.data.data.zones.map(zone => ({
            ...zone,
            paths: (zone.coordinates || []).map(coord => ({ lat: coord.latitude, lng: coord.longitude }))
          })).filter(z => z.paths.length >= 3);
          setZones(formattedZones);
        }
      } catch (err) {}
    })();
  }, []);

  const restaurantMarkerUrl = '/assets/images/cutlery_icon.webp';

  const customerMarkerUrl = useMemo(
    () => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(CUSTOMER_PIN_SVG)}`,
    [],
  );

  const lastCenteredPosRef = useRef(null);
  const framedTripKeyRef = useRef(null);

  // Re-frame map only when the focused order or trip phase changes — never on poll/GPS ticks
  useEffect(() => {
    framedTripKeyRef.current = null;
  }, [activeOrder?._id, tripStatus]);

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    const hasAnchors = restaurantPoint || customerPoint;
    if (!hasAnchors && !parsedRiderLocation) return;

    const frameKey = `${activeOrder?._id || 'none'}:${tripStatus || 'idle'}`;
    if (framedTripKeyRef.current === frameKey) return;

    const bounds = new window.google.maps.LatLngBounds();
    if (restaurantPoint) bounds.extend(restaurantPoint);
    if (customerPoint) bounds.extend(customerPoint);
    if (parsedRiderLocation) bounds.extend(parsedRiderLocation);

    map.fitBounds(bounds, { top: 70, right: 70, bottom: 120, left: 70 });
    framedTripKeyRef.current = frameKey;

    if (parsedRiderLocation) {
      lastCenteredPosRef.current = parsedRiderLocation;
    }
  }, [map, parsedRiderLocation, restaurantPoint, customerPoint, activeOrder?._id, tripStatus]);

  const remainingPath = useMemo(() => {
    if (!directions || !parsedRiderLocation || !window.google?.maps) return [];
    
    const fullPath = directions.routes[0].overview_path;
    if (!fullPath || fullPath.length === 0) return [];

    let closestIndex = 0;
    let minDistance = Infinity;
    const riderLatLng = new window.google.maps.LatLng(parsedRiderLocation.lat, parsedRiderLocation.lng);

    for (let i = 0; i < fullPath.length; i++) {
      const distance = window.google.maps.geometry.spherical.computeDistanceBetween(riderLatLng, fullPath[i]);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = i;
      }
    }

    let startIndex = closestIndex;
    if (closestIndex < fullPath.length - 1) {
      const distToCurrent = window.google.maps.geometry.spherical.computeDistanceBetween(riderLatLng, fullPath[closestIndex]);
      const distToNext = window.google.maps.geometry.spherical.computeDistanceBetween(riderLatLng, fullPath[closestIndex + 1]);
      const segmentLen = window.google.maps.geometry.spherical.computeDistanceBetween(fullPath[closestIndex], fullPath[closestIndex + 1]);
      
      if (distToNext < segmentLen && distToNext < distToCurrent) {
        startIndex = closestIndex + 1;
      }
    }

    const riderPoint = { lat: parsedRiderLocation.lat, lng: parsedRiderLocation.lng };
    const toObj = (p) => ({
      lat: typeof p.lat === 'function' ? p.lat() : p.lat,
      lng: typeof p.lng === 'function' ? p.lng() : p.lng
    });

    return [riderPoint, ...fullPath.slice(startIndex).map(toObj)];
  }, [directions, parsedRiderLocation]);

  const showRestaurantMarker = useMemo(() => {
    if (!restaurantPoint) return false;
    // Pickup phase only — don't clutter with restaurant pin after pickup
    if (tripStatus !== 'PICKING_UP' && tripStatus !== 'REACHED_PICKUP') return false;
    if (!parsedRiderLocation) return true;
    return distanceBetweenMeters(parsedRiderLocation, restaurantPoint) > MARKER_OVERLAP_HIDE_METERS;
  }, [restaurantPoint, parsedRiderLocation, tripStatus]);

  const showCustomerMarker = useMemo(() => {
    if (!customerPoint) return false;
    // Drop phase only — green pin is customer destination, not shown while going to restaurant
    if (tripStatus !== 'PICKED_UP' && tripStatus !== 'REACHED_DROP') return false;
    if (!parsedRiderLocation) return true;
    return distanceBetweenMeters(parsedRiderLocation, customerPoint) > MARKER_OVERLAP_HIDE_METERS;
  }, [customerPoint, parsedRiderLocation, tripStatus]);

  const defaultCenter = useMemo(() => ({ lat: 22.7196, lng: 75.8577 }), []);
  // Keep center prop stable so GPS / poll updates never call map.setCenter and fight manual pan/zoom
  const seedCenterRef = useRef(null);
  if (!seedCenterRef.current) {
    seedCenterRef.current = parsedRiderLocation || targetLocation || defaultCenter;
  }

  if (loadError) return <div className="absolute inset-0 flex items-center justify-center bg-gray-50 text-red-500 font-bold">Map Load Error</div>;
  if (!isLoaded) return <div className="absolute inset-0 flex items-center justify-center bg-gray-50"><div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="absolute inset-0 z-0 text-gray-900 overflow-hidden flex flex-col">
      <GoogleMap
        onLoad={handleMapLoad}
        mapContainerStyle={mapContainerStyle}
        center={seedCenterRef.current}
        zoom={zoom}
        heading={parsedRiderLocation?.heading || 0}
        tilt={45}
        onClick={(e) => onMapClick?.(e.latLng.lat(), e.latLng.lng())}
        options={mapOptions}
      >
        {/* Single active route line (no separate traveled + remaining double polyline) */}
        {remainingPath.length > 0 && (
          <Polyline 
            path={remainingPath} 
            options={{ 
              strokeColor: '#3b82f6', 
              strokeOpacity: 0.9, 
              strokeWeight: 8, 
              zIndex: 12 
            }} 
          />
        )}

        {showRestaurantMarker && (
          <Marker
            position={restaurantPoint}
            zIndex={DESTINATION_MARKER_Z_INDEX}
            icon={{
              url: restaurantMarkerUrl,
              scaledSize: new window.google.maps.Size(48, 48),
              anchor: new window.google.maps.Point(24, 48),
            }}
          />
        )}

        {showCustomerMarker && (
          <Marker
            position={customerPoint}
            zIndex={DESTINATION_MARKER_Z_INDEX}
            icon={{
              url: customerMarkerUrl,
              scaledSize: new window.google.maps.Size(44, 44),
              anchor: new window.google.maps.Point(22, 44),
            }}
          />
        )}

        {parsedRiderLocation && (
          <OverlayView
            position={parsedRiderLocation}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          >
            <div
              style={{
                // Bottom-center anchor: bike sits on the GPS point; destination pin can sit above it
                transform: `translate(-50%, -88%) rotate(${parsedRiderLocation.heading || 0}deg)`,
                transition: 'transform 0.5s linear',
                zIndex: 999,
                position: 'relative',
                pointerEvents: 'none',
              }}
              className="relative w-[72px] h-[72px]"
            >
              <img src="/assets/images/MapRider.png" alt="Rider" className="w-full h-full object-contain drop-shadow-md" />
            </div>
          </OverlayView>
        )}

        {zones.map((zone) => (
          <Polygon key={zone._id} paths={zone.paths} options={{ fillColor: "#22c55e", fillOpacity: 0.03, strokeColor: "#22c55e", strokeOpacity: 0.1, strokeWeight: 1, zIndex: 1 }} />
        ))}
      </GoogleMap>
    </div>
  );
};

export default LiveMap;
