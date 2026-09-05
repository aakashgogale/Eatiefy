import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useDeliveryStore } from '@/modules/DeliveryV2/store/useDeliveryStore';

const LAPTOP_TEST_FALLBACK = { lat: 22.7196, lng: 75.8577, heading: 0 };

const geoOptions = {
  enableHighAccuracy: true,
  maximumAge: 5000,
  timeout: 15000,
};

/** Orders tab only — Feed uses DeliveryHomeV2 map tracking; Pocket/Profile do not need GPS. */
export function isOrdersRoute(pathname = '') {
  return /\/orders\/?$/.test(pathname) || pathname.endsWith('/orders');
}

/**
 * Fills riderLocation for new-order distance/ETA on the Orders screen.
 * Feed handles its own GPS + backend sync on the map.
 */
export function useRiderLocationSync() {
  const { pathname } = useLocation();
  const isOnline = useDeliveryStore((state) => state.isOnline);
  const setRiderLocation = useDeliveryStore((state) => state.setRiderLocation);
  const shouldSync = isOnline && isOrdersRoute(pathname);

  useEffect(() => {
    if (!shouldSync || typeof navigator === 'undefined' || !navigator.geolocation) {
      return;
    }

    const applyPosition = (pos) => {
      const { latitude: lat, longitude: lng, heading } = pos.coords;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setRiderLocation({ lat, lng, heading: heading || 0 });
    };

    const applyFallback = () => {
      // Indore fallback is DEV-only — fake GPS caused 700–800 km distance on live trips.
      if (!import.meta.env.DEV) return;
      if (!useDeliveryStore.getState().riderLocation) {
        setRiderLocation(LAPTOP_TEST_FALLBACK);
      }
    };

    navigator.geolocation.getCurrentPosition(applyPosition, applyFallback, geoOptions);

    const watchId = navigator.geolocation.watchPosition(
      applyPosition,
      applyFallback,
      geoOptions,
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [shouldSync, setRiderLocation]);
}
