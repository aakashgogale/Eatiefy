/**
 * Widest position fix the rider apps will act on, in metres.
 *
 * `enableHighAccuracy: true` is a request, not a guarantee — indoors or with GPS
 * still warming up the browser happily returns a Wi-Fi/cell estimate a kilometre
 * or more wide. Treating that as the rider's position produced trips reporting
 * hundreds of kilometres of travel and geofences firing from the wrong locality.
 *
 * 200 m is loose enough to keep tracking alive in dense city cover and tight
 * enough that a tower-level estimate never wins.
 */
export const MAX_USABLE_ACCURACY_M = 200;

export default MAX_USABLE_ACCURACY_M;
