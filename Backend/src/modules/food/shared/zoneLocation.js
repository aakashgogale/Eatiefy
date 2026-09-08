import mongoose from 'mongoose';
import { FoodZone } from '../admin/models/zone.model.js';
import { ValidationError } from '../../../core/auth/errors.js';

const toFinite = (value) => {
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(n) ? n : null;
};

/** Ray-casting point-in-polygon over a zone's [{latitude, longitude}] ring. */
export const isPointInZone = (lat, lng, zone) => {
    const polygon = Array.isArray(zone?.coordinates) ? zone.coordinates : [];
    if (polygon.length < 3) return false;

    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = Number(polygon[i]?.longitude);
        const yi = Number(polygon[i]?.latitude);
        const xj = Number(polygon[j]?.longitude);
        const yj = Number(polygon[j]?.latitude);
        if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
        if (yj === yi) continue;
        const intersect =
            yi > lat !== yj > lat &&
            lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
};

/** GeoJSON polygon for a zone's coordinate ring, or null when it is not a ring. */
export const zoneToGeoPolygon = (zoneDoc) => {
    const coords = Array.isArray(zoneDoc?.coordinates) ? zoneDoc.coordinates : [];
    if (coords.length < 3) return null;
    const ring = coords
        .map((c) => [Number(c.longitude), Number(c.latitude)])
        .filter((pair) => pair.every((n) => Number.isFinite(n)));
    if (ring.length < 3) return null;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    return { type: 'Polygon', coordinates: [ring] };
};

/**
 * Resolves the active service zone a discovery request belongs to: the one it
 * names, or failing that the one covering its coordinates. Returns null when
 * the request has no serviceable area — callers must then list nothing rather
 * than falling back to every restaurant.
 */
export const resolveServiceZone = async ({ zoneId, lat, lng } = {}) => {
    const rawZoneId = String(zoneId || '').trim();
    const selection = 'name zoneName isActive coordinates serviceLocation location';

    if (rawZoneId && mongoose.Types.ObjectId.isValid(rawZoneId)) {
        const zone = await FoodZone.findById(rawZoneId).select(selection).lean();
        if (zone && zone.isActive !== false) return zone;
        return null;
    }

    const latitude = toFinite(lat);
    const longitude = toFinite(lng);
    if (latitude === null || longitude === null) return null;

    const activeZones = await FoodZone.find({ isActive: true }).select(selection).lean();
    return activeZones.find((zone) => isPointInZone(latitude, longitude, zone)) || null;
};

/**
 * Mongo clause matching restaurants serviceable from `zone`: those explicitly
 * assigned to it, plus those whose stored point falls inside its polygon (older
 * records were never assigned a zoneId).
 */
export const buildZoneServiceabilityClause = (zone) => {
    if (!zone?._id) return null;
    const clauses = [{ zoneId: new mongoose.Types.ObjectId(String(zone._id)) }];
    const polygon = zoneToGeoPolygon(zone);
    if (polygon) clauses.push({ location: { $geoWithin: { $geometry: polygon } } });
    return { $or: clauses };
};

/**
 * Guarantees the selected service zone exists, is active, and actually covers the
 * selected restaurant location. Throws ValidationError otherwise.
 *
 * Coordinates are optional (some legacy flows save an address without a geocode);
 * when they are missing only the zone itself is validated.
 */
export const assertZoneCoversLocation = async (zoneId, latitude, longitude) => {
    const rawZoneId = String(zoneId || '').trim();
    if (!rawZoneId) return null;

    if (!mongoose.Types.ObjectId.isValid(rawZoneId)) {
        throw new ValidationError('Selected service zone is invalid');
    }

    const zone = await FoodZone.findById(rawZoneId).select('name zoneName serviceLocation isActive coordinates').lean();
    if (!zone) {
        throw new ValidationError('Selected service zone no longer exists');
    }
    if (zone.isActive === false) {
        throw new ValidationError('Selected service zone is not active');
    }

    const lat = toFinite(latitude);
    const lng = toFinite(longitude);
    if (lat === null || lng === null) return zone;

    if (!isPointInZone(lat, lng, zone)) {
        const zoneName = zone.name || zone.zoneName || zone.serviceLocation || 'the selected zone';
        throw new ValidationError(
            `The selected restaurant location is outside "${zoneName}". Please pick the service zone that covers this location.`
        );
    }

    return zone;
};
