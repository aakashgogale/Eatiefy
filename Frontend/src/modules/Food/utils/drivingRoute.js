/**
 * Real road route for live order tracking.
 *
 * Tries the Google Routes API first and falls back to the legacy Directions
 * service, because a project may have only one of them enabled (the legacy
 * service is blocked on new Google Cloud projects). It never fabricates a
 * straight line: callers get a rejection and should retry later.
 *
 * @returns {Promise<{ path: {lat:number,lng:number}[], distanceMeters: number|null, durationSeconds: number|null }>}
 */

const toLiteral = (point) => {
  if (!point) return null;
  const lat = typeof point.lat === 'function' ? point.lat() : Number(point.lat ?? point.latitude);
  const lng = typeof point.lng === 'function' ? point.lng() : Number(point.lng ?? point.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

async function viaRoutesApi(origin, destination) {
  const { Route } = await window.google.maps.importLibrary('routes');
  const { routes } = await Route.computeRoutes({
    origin,
    destination,
    travelMode: 'DRIVING',
    fields: ['path', 'distanceMeters', 'durationMillis'],
  });
  const route = routes?.[0];
  const path = (route?.path || []).map(toLiteral).filter(Boolean);
  if (path.length < 2) throw new Error('Routes API returned no path');
  const durationMs = Number(route.durationMillis);
  return {
    path,
    distanceMeters: Number.isFinite(Number(route.distanceMeters)) ? Number(route.distanceMeters) : null,
    durationSeconds: Number.isFinite(durationMs) ? durationMs / 1000 : null,
  };
}

function viaDirectionsService(origin, destination) {
  return new Promise((resolve, reject) => {
    try {
      new window.google.maps.DirectionsService().route(
        { origin, destination, travelMode: window.google.maps.TravelMode.DRIVING },
        (result, status) => {
          const route = result?.routes?.[0];
          const path = (route?.overview_path || []).map(toLiteral).filter(Boolean);
          if (status !== 'OK' || path.length < 2) {
            reject(new Error(`Directions failed: ${status}`));
            return;
          }
          const leg = route.legs?.[0];
          resolve({
            path,
            distanceMeters: leg?.distance?.value ?? null,
            durationSeconds: leg?.duration?.value ?? null,
          });
        },
      );
    } catch (error) {
      reject(error);
    }
  });
}

export async function computeDrivingRoute(originPoint, destinationPoint) {
  const origin = toLiteral(originPoint);
  const destination = toLiteral(destinationPoint);
  if (!origin || !destination || !window.google?.maps) throw new Error('Route inputs unavailable');

  try {
    return await viaRoutesApi(origin, destination);
  } catch (error) {
    console.warn('[drivingRoute] Routes API unavailable, trying Directions service:', error?.message || error);
  }
  return viaDirectionsService(origin, destination);
}
