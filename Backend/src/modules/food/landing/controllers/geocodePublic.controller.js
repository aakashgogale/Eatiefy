const sanitize = (value) => (value ? String(value).trim().replace(/^['"]|['"]$/g, '') : '');

const getGoogleMapsServerKey = () =>
    sanitize(process.env.GOOGLE_MAPS_API_KEY) ||
    sanitize(process.env.VITE_GOOGLE_MAPS_API_KEY);

const toFinite = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
};

/**
 * Helper to fetch reverse geocode from OpenStreetMap / BigDataCloud fallback
 */
const fetchFallbackReverseGeocode = async (lat, lng) => {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'EatiefyFoodApp/1.0 (contact@eatiefy.com)',
                'Accept-Language': 'en-IN,en;q=0.9',
            },
        });
        if (!res.ok) return null;
        const json = await res.json();
        if (!json || !json.display_name) return null;

        const addr = json.address || {};
        const area = addr.suburb || addr.neighbourhood || addr.residential || addr.road || addr.village || '';
        // Report what the provider actually returned. A default city here silently
        // relocates every user whose address lacks that component.
        const city = addr.city || addr.town || addr.municipality || addr.county || addr.district || '';
        const state = addr.state || '';
        const country = addr.country || '';
        const postalCode = addr.postcode || '';

        const addressComponents = [
            { value: area, types: ['sublocality', 'sublocality_level_1'] },
            { value: city, types: ['locality'] },
            { value: state, types: ['administrative_area_level_1'] },
            { value: country, types: ['country'] },
        ]
            .filter((c) => c.value)
            .map((c) => ({ long_name: c.value, short_name: c.value, types: c.types }));
        if (postalCode) {
            addressComponents.push({ long_name: postalCode, short_name: postalCode, types: ['postal_code'] });
        }

        return {
            status: 'OK',
            results: [
                {
                    formatted_address: json.display_name,
                    address_components: addressComponents,
                    place_id: String(json.place_id || 'osm-reverse'),
                    geometry: {
                        location: { lat, lng }
                    }
                }
            ]
        };
    } catch {
        return null;
    }
};

/**
 * Proxy Google Geocoding so the API key never appears in the browser Network tab.
 * GET /food/geocode/reverse?lat=&lng=&result_type=
 */
export const reverseGeocodePublicController = async (req, res, next) => {
    try {
        const lat = toFinite(req.query.lat);
        const lng = toFinite(req.query.lng);
        if (lat === null || lng === null) {
            return res.status(400).json({ success: false, message: 'lat and lng are required' });
        }

        const apiKey = getGoogleMapsServerKey();
        let data = null;

        if (apiKey) {
            try {
                const params = new URLSearchParams({
                    latlng: `${lat},${lng}`,
                    key: apiKey,
                    language: 'en',
                    region: 'in',
                });

                const resultType = sanitize(req.query.result_type);
                if (resultType) params.set('result_type', resultType);

                const response = await fetch(
                    `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`
                );
                const googleData = await response.json();
                if (googleData?.status === 'OK' && googleData?.results?.length > 0) {
                    data = googleData;
                }
            } catch (googleErr) {
                console.warn('Google reverse geocode error, falling back:', googleErr?.message);
            }
        }

        // Fallback to OSM / Nominatim if Google did not return OK
        if (!data || data.status !== 'OK') {
            const fallbackData = await fetchFallbackReverseGeocode(lat, lng);
            if (fallbackData) {
                data = fallbackData;
            }
        }

        if (!data || !data.results || data.results.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'Reverse geocode completed with coordinates',
                data: {
                    status: 'OK',
                    results: [
                        {
                            formatted_address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
                            address_components: [],
                        }
                    ]
                }
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Reverse geocode completed',
            data,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /food/geocode/place?place_id=
 */
export const geocodePlacePublicController = async (req, res, next) => {
    try {
        const apiKey = getGoogleMapsServerKey();
        if (!apiKey) {
            return res.status(503).json({
                success: false,
                message: 'Google Maps API key is not configured on the server',
            });
        }

        const placeId = sanitize(req.query.place_id);
        if (!placeId) {
            return res.status(400).json({ success: false, message: 'place_id is required' });
        }

        const params = new URLSearchParams({
            place_id: placeId,
            key: apiKey,
            language: 'en',
            region: 'in',
        });

        const response = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`
        );
        const data = await response.json();

        return res.status(200).json({
            success: true,
            message: 'Place geocode completed',
            data,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /food/geocode/nearby
 * Body: { latitude, longitude, radius?, maxResultCount? }
 */
export const nearbyPlacesPublicController = async (req, res, next) => {
    try {
        const apiKey = getGoogleMapsServerKey();
        if (!apiKey) {
            return res.status(503).json({
                success: false,
                message: 'Google Maps API key is not configured on the server',
            });
        }

        const lat = toFinite(req.body?.latitude ?? req.body?.lat);
        const lng = toFinite(req.body?.longitude ?? req.body?.lng);
        if (lat === null || lng === null) {
            return res.status(400).json({ success: false, message: 'latitude and longitude are required' });
        }

        const radius = Math.min(Math.max(toFinite(req.body?.radius) ?? 60, 1), 500);
        const maxResultCount = Math.min(Math.max(Number(req.body?.maxResultCount) || 5, 1), 10);

        const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask':
                    'places.displayName,places.formattedAddress,places.addressComponents,places.location,places.types',
            },
            body: JSON.stringify({
                locationRestriction: {
                    circle: {
                        center: { latitude: lat, longitude: lng },
                        radius,
                    },
                },
                maxResultCount,
                rankPreference: 'DISTANCE',
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status >= 400 ? response.status : 502).json({
                success: false,
                message: data?.error?.message || 'Nearby places lookup failed',
                data,
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Nearby places fetched',
            data,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /food/geocode/text-search
 * Body: { textQuery, latitude?, longitude?, maxResultCount? }
 */
export const textSearchPlacesPublicController = async (req, res, next) => {
    try {
        const apiKey = getGoogleMapsServerKey();
        if (!apiKey) {
            return res.status(503).json({
                success: false,
                message: 'Google Maps API key is not configured on the server',
            });
        }

        const textQuery = sanitize(req.body?.textQuery || req.body?.query);
        if (!textQuery) {
            return res.status(400).json({ success: false, message: 'textQuery is required' });
        }

        const lat = toFinite(req.body?.latitude ?? req.body?.lat);
        const lng = toFinite(req.body?.longitude ?? req.body?.lng);
        const maxResultCount = Math.min(Math.max(Number(req.body?.maxResultCount) || 6, 1), 10);

        const body = {
            textQuery,
            languageCode: 'en',
            regionCode: 'IN',
            maxResultCount,
        };

        if (lat !== null && lng !== null) {
            body.locationBias = {
                circle: {
                    center: { latitude: lat, longitude: lng },
                    radius: 50000,
                },
            };
        }

        const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask':
                    'places.id,places.displayName,places.formattedAddress,places.location',
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status >= 400 ? response.status : 502).json({
                success: false,
                message: data?.error?.message || 'Text search failed',
                data,
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Text search completed',
            data,
        });
    } catch (error) {
        next(error);
    }
};
