import { FoodRestaurant } from '../models/restaurant.model.js';
import { uploadImageBuffer, deleteReplacedAssets } from '../../../../services/storage.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import mongoose from 'mongoose';
import { FoodZone } from '../../admin/models/zone.model.js';
import { FoodTopRestaurant } from '../../admin/models/topRestaurant.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodDiningRestaurant } from '../../dining/models/diningRestaurant.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { getFoodDisplayPrice } from '../../admin/services/foodVariant.service.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { FoodRestaurantOutletTimings } from '../models/outletTimings.model.js';
import { seedOutletTimingsForRestaurant } from './outletTimings.service.js';
import { logger } from '../../../../utils/logger.js';
import { fetchDrivingDistancesKmBatch, fetchDrivingDistanceKm } from '../../orders/utils/googleMaps.js';

const normalizeName = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ');

/** Letters/digits only — for matching navis-cafe ↔ navi's cafe */
const toCompactName = (value) => normalizeName(value).replace(/[^a-z0-9]/g, '');

const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '').slice(-15);
    return {
        digits: digits || '',
        last10: digits ? digits.slice(-10) : ''
    };
};

export const findRestaurantByPhone = async (phone) => {
    const { last10 } = normalizePhone(phone);
    if (!last10) return null;

    const suffixPattern = new RegExp(`${last10.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    const matching = await FoodRestaurant.find({
        $or: [
            { ownerPhoneLast10: last10 },
            { ownerPhone: { $regex: suffixPattern } },
            { ownerPhoneDigits: { $regex: suffixPattern } },
            { primaryContactNumber: { $regex: suffixPattern } },
        ],
    });

    const statusPriority = { approved: 1, pending: 2, rejected: 3, banned: 4, deleted: 5 };
    return (
        matching.sort((a, b) => {
            const pA = statusPriority[a.status] || 99;
            const pB = statusPriority[b.status] || 99;
            return pA - pB;
        })[0] || null
    );
};

async function upsertRestaurantFcmToken(restaurantId, fcmToken, platform = 'web') {
    const token = String(fcmToken || '').trim();
    if (!token || !restaurantId) return;

    const doc = await FoodRestaurant.findById(restaurantId);
    if (!doc) return;

    const isMobile = platform === 'mobile';
    if (isMobile) {
        if (!doc.fcmTokenMobile) doc.fcmTokenMobile = [];
        if (!doc.fcmTokenMobile.includes(token)) {
            doc.fcmTokenMobile.push(token);
            await doc.save();
        }
    } else {
        if (!doc.fcmTokens) doc.fcmTokens = [];
        if (!doc.fcmTokens.includes(token)) {
            doc.fcmTokens.push(token);
            await doc.save();
        }
    }
}

const normalizeRatingValue = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(5, Number(numeric.toFixed(1))));
};

const normalizeTotalRatingsValue = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.floor(numeric));
};

const toUrl = (v) => (v && (typeof v === 'string' ? v : v.url)) ? (typeof v === 'string' ? v : v.url) : '';

const normalizeRestaurantTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const toHHMM = (hour, minute) => {
        const h = Number(hour);
        const m = Number(minute);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
        if (h < 0 || h > 23 || m < 0 || m > 59) return '';
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    // HH:mm / H:mm
    const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (hhmm) return toHHMM(hhmm[1], hhmm[2]);

    // hh:mm AM/PM
    const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (ampm) {
        let hour = Number(ampm[1]);
        const minute = Number(ampm[2]);
        const period = ampm[3].toUpperCase();
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
        if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return '';
        if (period === 'AM') hour = hour === 12 ? 0 : hour;
        if (period === 'PM') hour = hour === 12 ? 12 : hour + 12;
        return toHHMM(hour, minute);
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return toHHMM(parsed.getHours(), parsed.getMinutes());
    }

    return '';
};

const timeToMinutes = (value) => {
    const normalized = normalizeRestaurantTime(value);
    if (!normalized) return null;
    const [h, m] = normalized.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
};

const parseEstimatedDeliveryMinutes = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const matches = raw.match(/\d+/g);
    if (!matches || !matches.length) return null;
    const numbers = matches.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0);
    if (!numbers.length) return null;
    return Math.round(numbers[numbers.length - 1]);
};

const toRestaurantProfile = (doc) => {
    if (!doc) return null;
    const loc = doc.location && typeof doc.location === 'object' ? doc.location : null;
    const location =
        (loc?.formattedAddress ||
            loc?.address ||
            loc?.addressLine1 ||
            loc?.addressLine2 ||
            loc?.area ||
            loc?.city ||
            loc?.state ||
            loc?.pincode ||
            loc?.landmark ||
            doc.addressLine1 ||
            doc.addressLine2 ||
            doc.area ||
            doc.city ||
            doc.state ||
            doc.pincode ||
            doc.landmark)
            ? {
                type: loc?.type || 'Point',
                coordinates: Array.isArray(loc?.coordinates) ? loc.coordinates : undefined,
                latitude: typeof loc?.latitude === 'number' ? loc.latitude : (Array.isArray(loc?.coordinates) ? loc.coordinates[1] : undefined),
                longitude: typeof loc?.longitude === 'number' ? loc.longitude : (Array.isArray(loc?.coordinates) ? loc.coordinates[0] : undefined),
                formattedAddress: loc?.formattedAddress || loc?.address || '',
                address: loc?.address || loc?.formattedAddress || '',
                addressLine1: loc?.addressLine1 || doc.addressLine1 || '',
                addressLine2: loc?.addressLine2 || doc.addressLine2 || '',
                area: loc?.area || doc.area || '',
                city: loc?.city || doc.city || '',
                state: loc?.state || doc.state || '',
                pincode: loc?.pincode || doc.pincode || '',
                landmark: loc?.landmark || doc.landmark || ''
            }
            : null;

    const menuImages = Array.isArray(doc.menuImages)
        ? doc.menuImages.map((m) => toUrl(m)).filter(Boolean).map((url) => ({ url, publicId: null }))
        : [];
    const coverImages = Array.isArray(doc.coverImages)
        ? doc.coverImages.map((m) => toUrl(m)).filter(Boolean).map((url) => ({ url, publicId: null }))
        : [];

    return {
        id: doc._id,
        _id: doc._id,
        restaurantId: doc.restaurantId || undefined,
        name: doc.restaurantName || '',
        restaurantName: doc.restaurantName || '',
        zoneId: doc.zoneId ? String(doc.zoneId) : '',
        cuisines: Array.isArray(doc.cuisines) ? doc.cuisines : [],
        location,
        ownerName: doc.ownerName || '',
        ownerEmail: doc.ownerEmail || '',
        ownerPhone: doc.ownerPhone || '',
        primaryContactNumber: doc.primaryContactNumber || '',
        panNumber: doc.panNumber || '',
        nameOnPan: doc.nameOnPan || '',
        panImage: doc.panImage ? { url: doc.panImage } : null,
        gstRegistered: Boolean(doc.gstRegistered),
        gstNumber: doc.gstNumber || '',
        gstLegalName: doc.gstLegalName || '',
        gstAddress: doc.gstAddress || '',
        gstImage: doc.gstImage ? { url: doc.gstImage } : null,
        fssaiNumber: doc.fssaiNumber || '',
        fssaiExpiry: doc.fssaiExpiry || null,
        fssaiImage: doc.fssaiImage ? { url: doc.fssaiImage } : null,
        accountNumber: doc.accountNumber || '',
        ifscCode: doc.ifscCode || '',
        accountHolderName: doc.accountHolderName || '',
        accountType: doc.accountType || '',
        upiId: doc.upiId || '',
        upiQrImage: doc.upiQrImage ? { url: doc.upiQrImage } : null,
        pureVegRestaurant: Boolean(doc.pureVegRestaurant),
        pureVeganRestaurant: Boolean(doc.pureVeganRestaurant),
        profileImage: doc.profileImage ? { url: doc.profileImage } : null,
        menuImages,
        coverImages,
        openingTime: normalizeRestaurantTime(doc.openingTime) || null,
        closingTime: normalizeRestaurantTime(doc.closingTime) || null,
        openDays: Array.isArray(doc.openDays) ? doc.openDays : [],
        estimatedDeliveryTime: doc.estimatedDeliveryTime || '',
        estimatedDeliveryTimeMinutes:
            Number.isFinite(Number(doc.estimatedDeliveryTimeMinutes))
                ? Number(doc.estimatedDeliveryTimeMinutes)
                : null,
        diningSettings: {
            isEnabled: doc.diningSettings?.isEnabled !== false,
            maxGuests: Math.max(1, parseInt(doc.diningSettings?.maxGuests, 10) || 6),
            diningType: String(doc.diningSettings?.diningType || 'family-dining').trim() || 'family-dining'
        },
        takeawaySettings: {
            isEnabled: doc.takeawaySettings?.isEnabled === true
        },
        isAcceptingOrders: doc.isAcceptingOrders !== false,
        status: doc.status || null,
        rejectionReason: doc.rejectionReason || null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        rating: normalizeRatingValue(doc.rating),
        totalRatings: normalizeTotalRatingsValue(doc.totalRatings)
    };
};

const toFiniteNumber = (value) => {
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(n) ? n : null;
};

function formatRestaurantDistanceLabel(distanceInKm) {
    const km = Number(distanceInKm);
    if (!Number.isFinite(km) || km < 0) return null;
    if (km >= 1) return `${km.toFixed(1)} km`;
    return `${Math.round(km * 1000)} m`;
}

function extractRestaurantLatLng(restaurant) {
    const loc = restaurant?.location;
    if (!loc) return null;
    if (Array.isArray(loc.coordinates) && loc.coordinates.length >= 2) {
        const lng = Number(loc.coordinates[0]);
        const lat = Number(loc.coordinates[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    const lat = Number(loc.latitude);
    const lng = Number(loc.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
}

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeCuisine = (value) => String(value || '').trim().slice(0, 80);

const parseSortBy = (value) => {
    const v = String(value || '').trim();
    const allowed = new Set(['nearest', 'rating', 'newest', 'deliveryTime', 'price-low', 'price-high', 'rating-high', 'rating-low']);
    return allowed.has(v) ? v : null;
};

const zoneToPolygon = (zoneDoc) => {
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

const notifyAdminsAboutRestaurantProfileReview = async (restaurantId, restaurantName) => {
    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        void notifyAdminsSafely({
            title: 'Restaurant Profile Updated',
            body: `Restaurant "${restaurantName || 'Unknown Restaurant'}" updated its profile and is pending approval again.`,
            data: {
                type: 'restaurant_profile_updated',
                subType: 'restaurant',
                id: String(restaurantId)
            }
        });
    } catch (e) {
        console.error('Failed to notify admins of restaurant profile resubmission:', e);
    }
};

export const registerRestaurant = async (payload, files) => {
    const {
        restaurantName,
        ownerName,
        ownerEmail,
        ownerPhone,
        primaryContactNumber,
        pureVegRestaurant,
        pureVeganRestaurant,
        addressLine1,
        addressLine2,
        area,
        city,
        state,
        pincode,
        landmark,
        formattedAddress,
        latitude,
        longitude,
        zoneId,
        cuisines,
        openingTime,
        closingTime,
        openDays,
        estimatedDeliveryTime,
        panNumber,
        nameOnPan,
        gstRegistered,
        gstNumber,
        gstLegalName,
        gstAddress,
        fssaiNumber,
        fssaiExpiry,
        accountNumber,
        ifscCode,
        accountHolderName,
        accountType,
        isTakeawayEnabled,
        fcmToken,
        platform
    } = payload;

    if (!ownerPhone) {
        throw new ValidationError('Owner phone is required to register a restaurant');
    }

    const { digits: ownerPhoneDigits, last10: ownerPhoneLast10 } = normalizePhone(ownerPhone);
    if (!ownerPhoneLast10) {
        throw new ValidationError('Owner phone is invalid');
    }

    const restaurantNameNormalized = normalizeName(restaurantName);
    if (!restaurantNameNormalized) {
        throw new ValidationError('Restaurant name is required to register a restaurant');
    }

    const images = {};

    if (files?.profileImage?.[0]) {
        images.profileImage = await uploadImageBuffer(files.profileImage[0].buffer, 'food/restaurants/profile');
    }
    if (files?.panImage?.[0]) {
        images.panImage = await uploadImageBuffer(files.panImage[0].buffer, 'food/restaurants/pan');
    }
    if (files?.gstImage?.[0]) {
        images.gstImage = await uploadImageBuffer(files.gstImage[0].buffer, 'food/restaurants/gst');
    }
    if (files?.fssaiImage?.[0]) {
        images.fssaiImage = await uploadImageBuffer(files.fssaiImage[0].buffer, 'food/restaurants/fssai');
    }

    let menuImages = [];
    if (files?.menuImages?.length) {
        menuImages = await Promise.all(
            files.menuImages.map((file) => uploadImageBuffer(file.buffer, 'food/restaurants/menu'))
        );
    }


    const normalizedOpeningTime = normalizeRestaurantTime(openingTime);
    const normalizedClosingTime = normalizeRestaurantTime(closingTime);
    const openingMinutes = timeToMinutes(normalizedOpeningTime);
    const closingMinutes = timeToMinutes(normalizedClosingTime);
    if (openingMinutes !== null && closingMinutes !== null) {
        if (openingMinutes === closingMinutes) {
            throw new ValidationError('Opening time and closing time cannot be same');
        }
        if (closingMinutes < openingMinutes) {
            throw new ValidationError('Closing time cannot be less than opening time');
        }
    }
    const estimatedDeliveryTimeText = String(estimatedDeliveryTime || '').trim();
    const estimatedDeliveryTimeMinutes = parseEstimatedDeliveryMinutes(estimatedDeliveryTimeText);

    try {
        const latNum = toFiniteNumber(latitude);
        const lngNum = toFiniteNumber(longitude);
        const restaurant = await FoodRestaurant.create({
            restaurantName,
            restaurantNameNormalized,
            ownerName,
            ownerEmail,
            // Store phone in a consistent digits-only format to match OTP login flow.
            ownerPhone: ownerPhoneDigits,
            ownerPhoneDigits,
            ownerPhoneLast10,
            primaryContactNumber,
            pureVegRestaurant: pureVeganRestaurant === true ? true : pureVegRestaurant === true,
            pureVeganRestaurant: pureVeganRestaurant === true,
            zoneId: zoneId && mongoose.Types.ObjectId.isValid(String(zoneId).trim())
                ? new mongoose.Types.ObjectId(String(zoneId).trim())
                : undefined,
            // Store unified location object (geo + address).
            location: latNum !== null && lngNum !== null ? {
                type: 'Point',
                coordinates: [lngNum, latNum],
                latitude: latNum,
                longitude: lngNum,
                formattedAddress: typeof formattedAddress === 'string' ? formattedAddress.trim() : '',
                address: typeof formattedAddress === 'string' ? formattedAddress.trim() : '',
                addressLine1: addressLine1 || '',
                addressLine2: addressLine2 || '',
                area: area || '',
                city: city || '',
                state: state || '',
                pincode: pincode || '',
                landmark: landmark || ''
            } : null,
            cuisines: cuisines || [],
            openingTime: normalizedOpeningTime || undefined,
            closingTime: normalizedClosingTime || undefined,
            openDays: openDays || [],
            estimatedDeliveryTime: estimatedDeliveryTimeText || undefined,
            estimatedDeliveryTimeMinutes: estimatedDeliveryTimeMinutes ?? undefined,
            panNumber,
            nameOnPan,
            gstRegistered,
            gstNumber,
            gstLegalName,
            gstAddress,
            fssaiNumber,
            fssaiExpiry,
            accountNumber,
            ifscCode,
            accountHolderName,
            accountType,
            menuImages,
            takeawaySettings: {
                isEnabled: isTakeawayEnabled === 'true' || isTakeawayEnabled === true
            },
            ...(fcmToken
                ? (platform === 'mobile'
                    ? { fcmTokenMobile: [String(fcmToken).trim()] }
                    : { fcmTokens: [String(fcmToken).trim()] })
                : {}),
            ...images
        });

        if (fcmToken) {
            try {
                const { upsertFirebaseDeviceToken } = await import('../../../../core/notifications/firebase.service.js');
                await upsertFirebaseDeviceToken({
                    ownerType: 'RESTAURANT',
                    ownerId: String(restaurant._id),
                    token: String(fcmToken).trim(),
                    platform: platform === 'mobile' ? 'mobile' : 'web',
                });
            } catch (err) {
                logger.warn(`[FCM-Register] Restaurant ${restaurant._id} upsert backup failed: ${err?.message || err}`);
            }
        }

        const tokenSnapshot = await FoodRestaurant.findById(restaurant._id)
            .select('fcmTokens fcmTokenMobile')
            .lean();
        logger.info(
            `[FCM-Register] Restaurant ${restaurant._id} saved tokens web=${tokenSnapshot?.fcmTokens?.length || 0} mobile=${tokenSnapshot?.fcmTokenMobile?.length || 0}`
        );

        try {
            await seedOutletTimingsForRestaurant(restaurant._id, {
                openingTime: normalizedOpeningTime,
                closingTime: normalizedClosingTime,
                openDays: openDays || []
            });
        } catch (e) {
            logger.warn(
                `[OutletTimings] Failed to seed timings for restaurant ${restaurant._id}: ${e?.message || e}`
            );
        }

        try {
            const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
            void notifyAdminsSafely({
                title: 'New Restaurant Registration 🏪',
                body: `A new restaurant "${restaurant.restaurantName}" has registered and is pending approval.`,
                data: {
                    type: 'new_registration',
                    subType: 'restaurant',
                    id: String(restaurant._id)
                }
            });
        } catch (e) {
            console.error('Failed to notify admins of new restaurant registration:', e);
        }

        return restaurant.toObject();
    } catch (err) {
        // Handle uniqueness conflicts deterministically (race-safe).
        if (err && (err.code === 11000 || err?.name === 'MongoServerError')) {
            throw new ValidationError('Restaurant with this name and owner phone already exists');
        }
        throw err;
    }
};

export const getCurrentRestaurantProfile = async (restaurantId) => {
    if (!restaurantId) return null;
    const doc = await FoodRestaurant.findById(restaurantId)
        .select(
            [
                'restaurantName',
                'restaurantId',
                'zoneId',
                'cuisines',
                'location',
                'addressLine1',
                'addressLine2',
                'area',
                'city',
                'state',
                'pincode',
                'landmark',
                'ownerName',
                'ownerEmail',
                'ownerPhone',
                'primaryContactNumber',
                'accountNumber',
                'ifscCode',
                'accountHolderName',
                'accountType',
                'upiId',
                'upiQrImage',
                'pureVegRestaurant',
                'profileImage',
                'coverImages',
                'menuImages',
                'openingTime',
                'closingTime',
                'openDays',
                'estimatedDeliveryTime',
                'estimatedDeliveryTimeMinutes',
                'diningSettings',
                'takeawaySettings',
                'isAcceptingOrders',
                'panNumber',
                'nameOnPan',
                'panImage',
                'gstRegistered',
                'gstNumber',
                'gstLegalName',
                'gstAddress',
                'gstImage',
                'fssaiNumber',
                'fssaiExpiry',
                'fssaiImage',
                'rating',
                'totalRatings',
                'status',
                'rejectionReason',
                'createdAt',
                'updatedAt'
            ].join(' ')
        )
        .lean();
    return toRestaurantProfile(doc);
};

export const updateRestaurantAcceptingOrders = async (restaurantId, isAcceptingOrders) => {
    if (!restaurantId) {
        throw new ValidationError('Invalid restaurant id');
    }
    const value = Boolean(isAcceptingOrders);
    const doc = await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        { $set: { isAcceptingOrders: value } },
        {
            new: true,
            runValidators: true,
            projection: [
                'restaurantName',
                'cuisines',
                'location',
                'addressLine1',
                'addressLine2',
                'area',
                'city',
                'state',
                'pincode',
                'landmark',
                'ownerName',
                'ownerEmail',
                'ownerPhone',
                'primaryContactNumber',
                'accountNumber',
                'ifscCode',
                'accountHolderName',
                'accountType',
                'upiId',
                'upiQrImage',
                'pureVegRestaurant',
                'profileImage',
                'coverImages',
                'menuImages',
                'openingTime',
                'closingTime',
                'openDays',
                'diningSettings',
                'isAcceptingOrders',
                'status',
                'createdAt',
                'updatedAt'
            ].join(' ')
        }
    ).lean();
    return toRestaurantProfile(doc);
};

export const updateCurrentRestaurantDiningSettings = async (restaurantId, body = {}) => {
    if (!restaurantId) {
        throw new ValidationError('Invalid restaurant id');
    }

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select('diningSettings status')
        .lean();

    if (!currentRestaurant) {
        throw new ValidationError('Restaurant not found');
    }

    const currentDiningSettings =
        currentRestaurant.diningSettings && typeof currentRestaurant.diningSettings === 'object'
            ? currentRestaurant.diningSettings
            : {};

    const parseBoolean = (value, fallback = false) => {
        if (value === undefined || value === null) return Boolean(fallback);
        if (typeof value === 'boolean') return value;
        const normalized = String(value).trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
        if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
        return Boolean(fallback);
    };

    const maxGuests = Math.max(
        1,
        parseInt(body.maxGuests ?? currentDiningSettings.maxGuests ?? 6, 10) || 6
    );
    const diningType =
        String(body.diningType ?? currentDiningSettings.diningType ?? 'family-dining').trim() ||
        'family-dining';

    const isEnabled = parseBoolean(body.isEnabled, currentDiningSettings.isEnabled);
    
    // First, update the FoodDiningRestaurant collection to keep it synced
    await FoodDiningRestaurant.findOneAndUpdate(
        { restaurantId },
        {
            $set: {
                isEnabled,
                maxGuests,
            }
        },
        { upsert: true }
    );

    const doc = await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: {
                diningSettings: {
                    isEnabled,
                    maxGuests,
                    diningType
                }
            }
        },
        {
            new: true,
            runValidators: true,
            projection: [
                'restaurantName',
                'cuisines',
                'location',
                'addressLine1',
                'addressLine2',
                'area',
                'city',
                'state',
                'pincode',
                'landmark',
                'ownerName',
                'ownerEmail',
                'ownerPhone',
                'primaryContactNumber',
                'accountNumber',
                'ifscCode',
                'accountHolderName',
                'accountType',
                'upiId',
                'upiQrImage',
                'pureVegRestaurant',
                'profileImage',
                'coverImages',
                'menuImages',
                'openingTime',
                'closingTime',
                'openDays',
                'estimatedDeliveryTime',
                'estimatedDeliveryTimeMinutes',
                'diningSettings',
                'isAcceptingOrders',
                'status',
                'createdAt',
                'updatedAt'
            ].join(' ')
        }
    ).lean();

    return toRestaurantProfile(doc);
};

export const updateCurrentRestaurantTakeawaySettings = async (restaurantId, body = {}) => {
    if (!restaurantId) {
        throw new ValidationError('Invalid restaurant id');
    }

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select('takeawaySettings status')
        .lean();

    if (!currentRestaurant) {
        throw new ValidationError('Restaurant not found');
    }

    const currentTakeawaySettings =
        currentRestaurant.takeawaySettings && typeof currentRestaurant.takeawaySettings === 'object'
            ? currentRestaurant.takeawaySettings
            : {};

    const parseBoolean = (value, fallback = false) => {
        if (value === undefined || value === null) return Boolean(fallback);
        if (typeof value === 'boolean') return value;
        const normalized = String(value).trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
        if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
        return Boolean(fallback);
    };

    const doc = await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: {
                takeawaySettings: {
                    isEnabled: parseBoolean(body.isEnabled, currentTakeawaySettings.isEnabled)
                }
            }
        },
        {
            new: true,
            runValidators: true,
            projection: [
                'restaurantName',
                'cuisines',
                'location',
                'addressLine1',
                'addressLine2',
                'area',
                'city',
                'state',
                'pincode',
                'landmark',
                'ownerName',
                'ownerEmail',
                'ownerPhone',
                'primaryContactNumber',
                'accountNumber',
                'ifscCode',
                'accountHolderName',
                'accountType',
                'upiId',
                'upiQrImage',
                'pureVegRestaurant',
                'profileImage',
                'coverImages',
                'menuImages',
                'openingTime',
                'closingTime',
                'openDays',
                'estimatedDeliveryTime',
                'estimatedDeliveryTimeMinutes',
                'diningSettings',
                'takeawaySettings',
                'isAcceptingOrders',
                'status',
                'createdAt',
                'updatedAt'
            ].join(' ')
        }
    ).lean();

    return toRestaurantProfile(doc);
};

export const updateRestaurantProfile = async (restaurantId, body = {}) => {
    if (!restaurantId) {
        throw new ValidationError('Invalid restaurant id');
    }

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select('restaurantName restaurantNameNormalized ownerPhone ownerPhoneDigits ownerPhoneLast10 primaryContactNumber status profileImage coverImages menuImages panImage gstImage fssaiImage upiQrImage')
        .lean();

    if (!currentRestaurant) {
        throw new ValidationError('Restaurant not found');
    }

    if (body.fcmToken) {
        await upsertRestaurantFcmToken(restaurantId, body.fcmToken, body.platform);
    }

    const update = {};

    // Owner/contact fields (used by restaurant Contact Details screens)
    if (body.ownerName !== undefined) {
        const ownerName = String(body.ownerName || '').trim();
        if (!ownerName) {
            throw new ValidationError('Owner name cannot be empty');
        }
        if (ownerName.length > 120) {
            throw new ValidationError('Owner name is too long');
        }
        update.ownerName = ownerName;
    }

    if (body.ownerEmail !== undefined) {
        const ownerEmail = String(body.ownerEmail || '').trim().toLowerCase();
        if (ownerEmail) {
            const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!EMAIL_REGEX.test(ownerEmail)) {
                throw new ValidationError('Owner email is invalid');
            }
            if (ownerEmail.length > 254) {
                throw new ValidationError('Owner email is too long');
            }
            update.ownerEmail = ownerEmail;
        } else {
            update.ownerEmail = '';
        }
    }

    // Note: UI keeps phone read-only, but we accept it safely and normalize if sent.
    if (body.ownerPhone !== undefined) {
        const { digits, last10 } = normalizePhone(body.ownerPhone);
        if (!digits || digits.length < 8) {
            throw new ValidationError('Owner phone is invalid');
        }

        const currentOwnerPhoneDigits =
            currentRestaurant.ownerPhoneDigits ||
            normalizePhone(currentRestaurant.ownerPhone).digits ||
            '';

        if (digits !== currentOwnerPhoneDigits) {
            update.ownerPhone = digits;
            update.ownerPhoneDigits = digits;
            update.ownerPhoneLast10 = last10 || undefined;
        }
    }

    if (body.primaryContactNumber !== undefined) {
        const { digits } = normalizePhone(body.primaryContactNumber);
        const normalizedPrimaryContact =
            digits || String(body.primaryContactNumber || '').trim();
        const currentPrimaryContact =
            currentRestaurant.primaryContactNumber != null
                ? String(currentRestaurant.primaryContactNumber).trim()
                : '';

        if (normalizedPrimaryContact !== currentPrimaryContact) {
            update.primaryContactNumber = normalizedPrimaryContact;
        }
    }

    if (body.pureVegRestaurant !== undefined) {
        if (typeof body.pureVegRestaurant === 'boolean') {
            update.pureVegRestaurant = body.pureVegRestaurant;
        } else if (typeof body.pureVegRestaurant === 'string') {
            const normalized = body.pureVegRestaurant.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
                update.pureVegRestaurant = true;
            } else if (normalized === 'false' || normalized === '0' || normalized === 'no') {
                update.pureVegRestaurant = false;
            } else {
                throw new ValidationError('pureVegRestaurant must be a boolean');
            }
        } else {
            throw new ValidationError('pureVegRestaurant must be a boolean');
        }
    }

    if (body.pureVeganRestaurant !== undefined) {
        if (typeof body.pureVeganRestaurant === 'boolean') {
            update.pureVeganRestaurant = body.pureVeganRestaurant;
        } else if (typeof body.pureVeganRestaurant === 'string') {
            const normalized = body.pureVeganRestaurant.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
                update.pureVeganRestaurant = true;
            } else if (normalized === 'false' || normalized === '0' || normalized === 'no') {
                update.pureVeganRestaurant = false;
            } else {
                throw new ValidationError('pureVeganRestaurant must be a boolean');
            }
        } else {
            throw new ValidationError('pureVeganRestaurant must be a boolean');
        }
    }

    if (update.pureVeganRestaurant === true) {
        update.pureVegRestaurant = true;
    } else if (update.pureVeganRestaurant === false && update.pureVegRestaurant === undefined) {
        // clearing vegan does not force mixed; keep existing pureVeg unless also sent
    }

    if (body.zoneId !== undefined) {
        const zoneId = String(body.zoneId || '').trim();
        update.zoneId = zoneId && mongoose.Types.ObjectId.isValid(zoneId)
            ? new mongoose.Types.ObjectId(zoneId)
            : undefined;
    }

    // Bank + UPI fields (Explore -> Update Bank Details page)
    if (body.accountHolderName !== undefined) {
        update.accountHolderName = String(body.accountHolderName || '').trim();
    }
    if (body.accountNumber !== undefined) {
        update.accountNumber = String(body.accountNumber || '').replace(/\s|-/g, '').trim();
    }
    if (body.ifscCode !== undefined) {
        update.ifscCode = String(body.ifscCode || '').trim().toUpperCase();
    }
    if (body.accountType !== undefined) {
        update.accountType = String(body.accountType || '').trim();
    }
    if (body.upiId !== undefined) {
        update.upiId = String(body.upiId || '').trim();
    }
    if (body.upiQrImage !== undefined || body.upiQrCode !== undefined) {
        const qrImage = body.upiQrImage !== undefined ? body.upiQrImage : body.upiQrCode;
        update.upiQrImage = String(qrImage || '').trim();
    }

    if (body.name !== undefined || body.restaurantName !== undefined) {
        const raw = body.name !== undefined ? body.name : body.restaurantName;
        const name = String(raw || '').trim();
        if (!name) {
            throw new ValidationError('Restaurant name cannot be empty');
        }
        const normalizedName = normalizeName(name) || undefined;
        const currentName = String(currentRestaurant.restaurantName || '').trim();
        const currentNormalizedName =
            currentRestaurant.restaurantNameNormalized || normalizeName(currentName) || undefined;

        if (name !== currentName || normalizedName !== currentNormalizedName) {
            update.restaurantName = name;
            update.restaurantNameNormalized = normalizedName;
        }
    }

    if (body.cuisines !== undefined) {
        if (!Array.isArray(body.cuisines)) {
            throw new ValidationError('Cuisines must be an array of strings');
        }
        const cuisines = body.cuisines
            .map((c) => String(c || '').trim())
            .filter(Boolean)
            .slice(0, 50);
        update.cuisines = cuisines;
    }

    if (body.location !== undefined) {
        const loc = body.location && typeof body.location === 'object' ? body.location : null;
        if (!loc) {
            throw new ValidationError('Location must be an object');
        }
        const toStr = (v) => (v != null ? String(v).trim() : '');
        const formattedAddress = toStr(loc.formattedAddress || loc.address);
        update.addressLine1 = toStr(loc.addressLine1);
        update.addressLine2 = toStr(loc.addressLine2);
        update.area = toStr(loc.area);
        update.city = toStr(loc.city);
        update.state = toStr(loc.state);
        update.pincode = toStr(loc.pincode);
        update.landmark = toStr(loc.landmark);

        // Optional geo coords for server-side distance filtering.
        const lat = toFiniteNumber(loc.latitude);
        const lng = toFiniteNumber(loc.longitude);
        if (lat !== null && lng !== null) {
            update.location = {
                type: 'Point',
                coordinates: [lng, lat],
                latitude: lat,
                longitude: lng,
                formattedAddress,
                address: formattedAddress,
                addressLine1: toStr(loc.addressLine1),
                addressLine2: toStr(loc.addressLine2),
                area: toStr(loc.area),
                city: toStr(loc.city),
                state: toStr(loc.state),
                pincode: toStr(loc.pincode),
                landmark: toStr(loc.landmark)
            };
        } else {
            // Drop location Point representation if coordinates are missing to prevent MongoDB 2dsphere indexing errors
            update.location = null;
        }
    }

    if (body.openingTime !== undefined) {
        update.openingTime = normalizeRestaurantTime(body.openingTime) || '';
    }
    if (body.closingTime !== undefined) {
        update.closingTime = normalizeRestaurantTime(body.closingTime) || '';
    }
    if (body.openDays !== undefined) {
        if (!Array.isArray(body.openDays)) {
            throw new ValidationError('openDays must be an array');
        }
        update.openDays = body.openDays
            .map((day) => String(day || '').trim())
            .filter(Boolean)
            .slice(0, 7);
    }
    if (body.estimatedDeliveryTime !== undefined) {
        const estimatedDeliveryTimeText = String(body.estimatedDeliveryTime || '').trim();
        update.estimatedDeliveryTime = estimatedDeliveryTimeText;
        update.estimatedDeliveryTimeMinutes = parseEstimatedDeliveryMinutes(estimatedDeliveryTimeText) ?? undefined;
    }

    const openingMinutes = body.openingTime !== undefined ? timeToMinutes(update.openingTime) : null;
    const closingMinutes = body.closingTime !== undefined ? timeToMinutes(update.closingTime) : null;
    if (openingMinutes !== null && closingMinutes !== null) {
        if (openingMinutes === closingMinutes) {
            throw new ValidationError('Opening time and closing time cannot be same');
        }
        if (closingMinutes < openingMinutes) {
            throw new ValidationError('Closing time cannot be less than opening time');
        }
    }

    if (body.menuImages !== undefined) {
        if (!Array.isArray(body.menuImages)) {
            throw new ValidationError('menuImages must be an array');
        }
        const urls = body.menuImages
            .map((m) => toUrl(m))
            .filter(Boolean)
            .slice(0, 20);
        update.menuImages = urls;
    }


    if (body.coverImages !== undefined) {
        if (!Array.isArray(body.coverImages)) {
            throw new ValidationError('coverImages must be an array');
        }
        const urls = body.coverImages
            .map((m) => toUrl(m))
            .filter(Boolean)
            .slice(0, 20);
        update.coverImages = urls;
    }

    if (body.profileImage !== undefined) {
        update.profileImage = toUrl(body.profileImage) || '';
    }

    if (body.panNumber !== undefined) {
        update.panNumber = String(body.panNumber || '').trim().toUpperCase();
    }
    if (body.nameOnPan !== undefined) {
        update.nameOnPan = String(body.nameOnPan || '').trim();
    }
    if (body.panImage !== undefined) {
        update.panImage = toUrl(body.panImage) || '';
    }
    if (body.gstRegistered !== undefined) {
        if (typeof body.gstRegistered === 'boolean') {
            update.gstRegistered = body.gstRegistered;
        } else if (typeof body.gstRegistered === 'string') {
            const normalized = body.gstRegistered.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
                update.gstRegistered = true;
            } else if (normalized === 'false' || normalized === '0' || normalized === 'no') {
                update.gstRegistered = false;
            } else {
                throw new ValidationError('gstRegistered must be a boolean');
            }
        } else {
            throw new ValidationError('gstRegistered must be a boolean');
        }
    }
    if (body.gstNumber !== undefined) {
        update.gstNumber = String(body.gstNumber || '').trim().toUpperCase();
    }
    if (body.gstLegalName !== undefined) {
        update.gstLegalName = String(body.gstLegalName || '').trim();
    }
    if (body.gstAddress !== undefined) {
        update.gstAddress = String(body.gstAddress || '').trim();
    }
    if (body.gstImage !== undefined) {
        update.gstImage = toUrl(body.gstImage) || '';
    }
    if (body.fssaiNumber !== undefined) {
        update.fssaiNumber = String(body.fssaiNumber || '').trim();
    }
    if (body.fssaiExpiry !== undefined) {
        const rawExpiry = String(body.fssaiExpiry || '').trim();
        if (!rawExpiry) {
            update.fssaiExpiry = null;
        } else {
            const parsedExpiry = new Date(rawExpiry);
            if (Number.isNaN(parsedExpiry.getTime())) {
                throw new ValidationError('FSSAI expiry date is invalid');
            }
            update.fssaiExpiry = parsedExpiry;
        }
    }
    if (body.fssaiImage !== undefined) {
        update.fssaiImage = toUrl(body.fssaiImage) || '';
    }

    if (!Object.keys(update).length) {
        return getCurrentRestaurantProfile(restaurantId);
    }

    update.status = 'pending';
    if (currentRestaurant.status !== 'pending') {
        update.pendingApprovalType = 'changes';
    }

    try {
        const doc = await FoodRestaurant.findByIdAndUpdate(
            restaurantId,
            {
                $set: update,
                $unset: {
                    approvedAt: 1,
                    rejectedAt: 1,
                    rejectionReason: 1
                }
            },
            {
                new: true,
                runValidators: true,
                projection: [
                    'restaurantName',
                    'cuisines',
                    'location',
                    'addressLine1',
                    'addressLine2',
                    'area',
                    'city',
                    'state',
                    'pincode',
                    'landmark',
                    'ownerName',
                    'ownerEmail',
                    'ownerPhone',
                    'primaryContactNumber',
                'pureVegRestaurant',
                'profileImage',
                'coverImages',
                'menuImages',
                    'openingTime',
                    'closingTime',
                    'openDays',
                    'status',
                    'createdAt',
                    'updatedAt',
                    'panNumber',
                    'nameOnPan',
                    'panImage',
                    'gstRegistered',
                    'gstNumber',
                    'gstLegalName',
                    'gstAddress',
                    'gstImage',
                    'fssaiNumber',
                    'fssaiExpiry',
                    'fssaiImage',
                    'accountNumber',
                    'ifscCode',
                    'accountHolderName',
                    'accountType',
                    'upiId',
                    'upiQrImage',
                    'estimatedDeliveryTime',
                    'estimatedDeliveryTimeMinutes',
                    'zoneId'
                ].join(' ')
            }
        ).lean();

        if (!doc) throw new ValidationError('Restaurant not found');

        await Promise.all([
            update.profileImage !== undefined ? deleteReplacedAssets(currentRestaurant.profileImage, update.profileImage) : null,
            update.coverImages !== undefined ? deleteReplacedAssets(currentRestaurant.coverImages, update.coverImages) : null,
            update.menuImages !== undefined ? deleteReplacedAssets(currentRestaurant.menuImages, update.menuImages) : null,
            update.panImage !== undefined ? deleteReplacedAssets(currentRestaurant.panImage, update.panImage) : null,
            update.gstImage !== undefined ? deleteReplacedAssets(currentRestaurant.gstImage, update.gstImage) : null,
            update.fssaiImage !== undefined ? deleteReplacedAssets(currentRestaurant.fssaiImage, update.fssaiImage) : null,
            update.upiQrImage !== undefined ? deleteReplacedAssets(currentRestaurant.upiQrImage, update.upiQrImage) : null
        ]);

        if (currentRestaurant.status !== 'pending') {
            const restaurantNameForNotification =
                update.restaurantName || currentRestaurant.restaurantName || doc?.restaurantName;
            void notifyAdminsAboutRestaurantProfileReview(restaurantId, restaurantNameForNotification);
        }

        return toRestaurantProfile(doc);
    } catch (err) {
        if (err && err.code === 11000) {
            throw new ValidationError('A restaurant with this name and phone already exists');
        }
        throw err;
    }
};

export const uploadRestaurantProfileImage = async (restaurantId, file) => {
    if (!restaurantId) throw new ValidationError('Invalid restaurant id');
    if (!file?.buffer) throw new ValidationError('Image file is required');

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select('restaurantName status profileImage')
        .lean();
    if (!currentRestaurant) throw new ValidationError('Restaurant not found');

    const url = await uploadImageBuffer(file.buffer, 'food/restaurants/profile', {
        replaceUrl: currentRestaurant.profileImage
    });
    const profileUpdate = {
        profileImage: url,
        status: 'pending'
    };
    if (currentRestaurant.status !== 'pending') {
        profileUpdate.pendingApprovalType = 'changes';
    }
    const doc = await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: profileUpdate,
            $unset: {
                approvedAt: 1,
                rejectedAt: 1,
                rejectionReason: 1
            }
        },
        { new: true, projection: 'profileImage coverImages restaurantName cuisines location menuImages addressLine1 addressLine2 area city state pincode landmark ownerName ownerEmail ownerPhone primaryContactNumber pureVegRestaurant openingTime closingTime openDays status createdAt updatedAt' }
    ).lean();

    if (!doc) throw new ValidationError('Restaurant not found');

    if (currentRestaurant.status !== 'pending') {
        void notifyAdminsAboutRestaurantProfileReview(restaurantId, currentRestaurant.restaurantName || doc.restaurantName);
    }

    return { profileImage: { url } };
};

export const uploadRestaurantMenuImage = async (file) => {
    if (!file?.buffer) throw new ValidationError('Image file is required');
    const url = await uploadImageBuffer(file.buffer, 'food/restaurants/menu');
    return { menuImage: { url, publicId: null } };
};

export const uploadRestaurantCoverImages = async (restaurantId, files = []) => {
    if (!restaurantId) throw new ValidationError('Invalid restaurant id');
    if (!Array.isArray(files) || files.length === 0) {
        throw new ValidationError('At least one image file is required');
    }

    const validFiles = files.filter((file) => file?.buffer);
    if (validFiles.length === 0) {
        throw new ValidationError('At least one valid image file is required');
    }

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select('restaurantName status profileImage coverImages')
        .lean();
    if (!currentRestaurant) throw new ValidationError('Restaurant not found');

    const uploadedUrls = await Promise.all(
        validFiles.slice(0, 20).map((file) => uploadImageBuffer(file.buffer, 'food/restaurants/cover'))
    );
    const existingCoverImages = Array.isArray(currentRestaurant.coverImages)
        ? currentRestaurant.coverImages.map((image) => toUrl(image)).filter(Boolean)
        : [];
    const nextCoverImages = [...existingCoverImages];

    uploadedUrls.forEach((url) => {
        if (!nextCoverImages.includes(url)) nextCoverImages.push(url);
    });

    const update = {
        coverImages: nextCoverImages.slice(0, 20),
        status: 'pending'
    };
    if (currentRestaurant.status !== 'pending') {
        update.pendingApprovalType = 'changes';
    }

    if (!toUrl(currentRestaurant.profileImage) && uploadedUrls[0]) {
        update.profileImage = uploadedUrls[0];
    }

    await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: update,
            $unset: {
                approvedAt: 1,
                rejectedAt: 1,
                rejectionReason: 1
            }
        },
        { new: true }
    ).lean();

    if (currentRestaurant.status !== 'pending') {
        void notifyAdminsAboutRestaurantProfileReview(restaurantId, currentRestaurant.restaurantName || '');
    }

    return {
        coverImages: uploadedUrls.map((url) => ({ url, publicId: null })),
        profileImage: update.profileImage ? { url: update.profileImage } : undefined
    };
};

export const uploadRestaurantMenuImages = async (restaurantId, files = []) => {
    if (!restaurantId) throw new ValidationError('Invalid restaurant id');
    if (!Array.isArray(files) || files.length === 0) {
        throw new ValidationError('At least one image file is required');
    }

    const validFiles = files.filter((file) => file?.buffer);
    if (validFiles.length === 0) {
        throw new ValidationError('At least one valid image file is required');
    }

    const currentRestaurant = await FoodRestaurant.findById(restaurantId)
        .select('restaurantName status menuImages')
        .lean();
    if (!currentRestaurant) throw new ValidationError('Restaurant not found');

    const uploadedUrls = await Promise.all(
        validFiles.slice(0, 20).map((file) => uploadImageBuffer(file.buffer, 'food/restaurants/menu'))
    );
    const existingMenuImages = Array.isArray(currentRestaurant.menuImages)
        ? currentRestaurant.menuImages.map((image) => toUrl(image)).filter(Boolean)
        : [];
    const nextMenuImages = [...existingMenuImages];

    uploadedUrls.forEach((url) => {
        if (!nextMenuImages.includes(url)) nextMenuImages.push(url);
    });

    const menuUpdate = {
        menuImages: nextMenuImages.slice(0, 20),
        status: 'pending'
    };
    if (currentRestaurant.status !== 'pending') {
        menuUpdate.pendingApprovalType = 'changes';
    }

    await FoodRestaurant.findByIdAndUpdate(
        restaurantId,
        {
            $set: menuUpdate,
            $unset: {
                approvedAt: 1,
                rejectedAt: 1,
                rejectionReason: 1
            }
        },
        { new: true }
    ).lean();

    if (currentRestaurant.status !== 'pending') {
        void notifyAdminsAboutRestaurantProfileReview(restaurantId, currentRestaurant.restaurantName || '');
    }

    return {
        menuImages: uploadedUrls.map((url) => ({ url, publicId: null }))
    };
};

export const listApprovedRestaurants = async (query = {}) => {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 40, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { status: 'approved' };


    if (query.city && String(query.city).trim()) {
        const city = String(query.city).trim().slice(0, 80);
        const rx = { $regex: escapeRegex(city), $options: 'i' };
        filter.$and = [...(filter.$and || []), { $or: [{ 'location.city': rx }, { city: rx }] }];
    }
    if (query.area && String(query.area).trim()) {
        const area = String(query.area).trim().slice(0, 80);
        const rx = { $regex: escapeRegex(area), $options: 'i' };
        filter.$and = [...(filter.$and || []), { $or: [{ 'location.area': rx }, { area: rx }] }];
    }
    if (query.cuisine && String(query.cuisine).trim()) {
        const cuisine = normalizeCuisine(query.cuisine);
        filter.cuisines = { $in: [new RegExp(escapeRegex(cuisine), 'i')] };
    }
    if (query.hasOffers === 'true') {
        filter.offer = { $exists: true, $ne: null, $ne: '' };
    }
    const minRating = toFiniteNumber(query.minRating);
    if (minRating !== null) {
        filter.rating = { $gte: Math.max(0, Math.min(5, minRating)) };
    }
    const maxDeliveryTime = toFiniteNumber(query.maxDeliveryTime);
    if (maxDeliveryTime !== null) {
        filter.estimatedDeliveryTimeMinutes = { $lte: Math.max(0, Math.round(maxDeliveryTime)) };
    }
    const maxPrice = toFiniteNumber(query.maxPrice);
    if (maxPrice !== null) {
        filter.featuredPrice = { $lte: Math.max(0, maxPrice) };
    }
    if (query.topRated === 'true') {
        filter.rating = { ...(filter.rating || {}), $gte: 4.5 };
    }
    if (query.trusted === 'true') {
        filter.totalRatings = { ...(filter.totalRatings || {}), $gte: 100 };
    }
    if (query.search && String(query.search).trim()) {
        const raw = String(query.search).trim().slice(0, 80);
        const term = escapeRegex(raw);
        if (term.length >= 2) {
            filter.$or = [
                { restaurantName: { $regex: term, $options: 'i' } },
                { area: { $regex: term, $options: 'i' } },
                { city: { $regex: term, $options: 'i' } },
                { 'location.area': { $regex: term, $options: 'i' } },
                { 'location.city': { $regex: term, $options: 'i' } },
                { cuisines: { $in: [new RegExp(term, 'i')] } }
            ];
        }
    }

    if (query.orderType === 'takeaway') {
        filter['takeawaySettings.isEnabled'] = true;
    } else if (query.orderType === 'dining') {
        filter['diningSettings.isEnabled'] = true;
    }

    const zoneIdRaw = String(query.zoneId || '').trim();
    if (zoneIdRaw && mongoose.Types.ObjectId.isValid(zoneIdRaw)) {
        filter.$or = [{ zoneId: new mongoose.Types.ObjectId(zoneIdRaw) }];
        const zoneDoc = await FoodZone.findById(zoneIdRaw).select('isActive coordinates location').lean();
        if (zoneDoc && zoneDoc.isActive) {
            const polygon = zoneToPolygon(zoneDoc);
            if (polygon) {
                filter.$or.push({ location: { $geoWithin: { $geometry: polygon } } });
            }
        }
    }

    const lat = toFiniteNumber(query.lat);
    const lng = toFiniteNumber(query.lng);
    const radiusKm = toFiniteNumber(query.radiusKm) ?? toFiniteNumber(query.maxDistance);
    const sortBy = parseSortBy(query.sortBy);

    // Admin-curated "Top Restaurants" promotion. Only applied for the DEFAULT sort
    // (no explicit sortBy), a known zone, and delivery/takeaway lists (not dining).
    // The curated restaurants are surfaced first in their saved order; users never
    // see any ranking label. When nothing is curated, behaviour is unchanged.
    let topObjectIds = [];
    if (
        sortBy === null &&
        zoneIdRaw &&
        mongoose.Types.ObjectId.isValid(zoneIdRaw) &&
        query.orderType !== 'dining'
    ) {
        const topType = query.orderType === 'takeaway' ? 'takeaway' : 'delivery';
        const topDoc = await FoodTopRestaurant.findOne({
            zoneId: new mongoose.Types.ObjectId(zoneIdRaw),
            type: topType,
        }).select('restaurants').lean();
        const ids = Array.isArray(topDoc?.restaurants) ? topDoc.restaurants : [];
        topObjectIds = ids.map((id) => new mongoose.Types.ObjectId(String(id)));
    }

    const projection = {
        restaurantName: 1,
        area: 1,
        city: 1,
        cuisines: 1,
        profileImage: 1,
        coverImages: 1,
        menuImages: 1,
        estimatedDeliveryTime: 1,
        estimatedDeliveryTimeMinutes: 1,
        offer: 1,
        featuredDish: 1,
        featuredPrice: 1,
        rating: 1,
        totalRatings: 1,
        isAcceptingOrders: 1,
        status: 1,
        pureVegRestaurant: 1,
        createdAt: 1,
        location: 1,
        distance: 1,
        distanceInKm: 1,
        __topOrder: 1,
        openingTime: 1,
        closingTime: 1,
        openDays: 1,
        takeawaySettings: 1,
        // Full week array (not a single day). `$outletTimingsData.timings` is [[...days]]; take first doc's week.
        outletTimings: {
            $ifNull: [{ $arrayElemAt: ['$outletTimingsData.timings', 0] }, []]
        }
    };

    const pipeline = [];

    // Use $geoNear if coordinates are provided
    if (lat !== null && lng !== null) {
        pipeline.push({
            $geoNear: {
                near: { type: 'Point', coordinates: [lng, lat] },
                distanceField: 'distanceMeters',
                spherical: true,
                key: 'location',
                query: filter,
                maxDistance: radiusKm !== null ? Math.max(0.1, radiusKm) * 1000 : 10000000 // Default 10000km if no radius
            }
        });
        pipeline.push({
            $addFields: {
                distanceInKm: { $round: [{ $divide: ['$distanceMeters', 1000] }, 2] },
                distance: {
                    $cond: [
                        { $gte: ['$distanceMeters', 1000] },
                        { $concat: [{ $toString: { $round: [{ $divide: ['$distanceMeters', 1000] }, 1] } }, ' km'] },
                        { $concat: [{ $toString: { $round: ['$distanceMeters', 0] } }, ' m'] }
                    ]
                }
            }
        });
    } else {
        pipeline.push({ $match: filter });
    }

    // Lookup outlet timings
    pipeline.push({
        $lookup: {
            from: 'food_restaurant_outlet_timings',
            localField: '_id',
            foreignField: 'restaurantId',
            as: 'outletTimingsData'
        }
    });

    // Sorting Stage
    const sortStage = (() => {
        if (sortBy === 'rating' || sortBy === 'rating-high') return { $sort: { rating: -1, distanceMeters: 1, createdAt: -1 } };
        if (sortBy === 'rating-low') return { $sort: { rating: 1, distanceMeters: 1, createdAt: -1 } };
        if (sortBy === 'price-low') return { $sort: { featuredPrice: 1, distanceMeters: 1, createdAt: -1 } };
        if (sortBy === 'price-high') return { $sort: { featuredPrice: -1, distanceMeters: 1, createdAt: -1 } };
        if (sortBy === 'deliveryTime') return { $sort: { estimatedDeliveryTimeMinutes: 1, distanceMeters: 1, createdAt: -1 } };
        if (sortBy === 'newest') return { $sort: { createdAt: -1 } };
        return { $sort: { distanceMeters: 1, createdAt: -1 } };
    })();

    if (topObjectIds.length > 0) {
        // Compute a promotion order: curated restaurants get their saved index
        // (0-based), everything else gets a large number so it sorts after them.
        // Curated ids that are not in the result set (banned/deleted) simply never
        // match and are auto-skipped for users.
        pipeline.push({
            $addFields: {
                __topOrder: {
                    $let: {
                        vars: { idx: { $indexOfArray: [topObjectIds, '$_id'] } },
                        in: { $cond: [{ $gte: ['$$idx', 0] }, '$$idx', 1000000] },
                    },
                },
            },
        });
        pipeline.push({ $sort: { __topOrder: 1, ...sortStage.$sort } });
    } else {
        pipeline.push(sortStage);
    }

    // Final Facet for Pagination
    pipeline.push({
        $facet: {
            metadata: [{ $count: 'total' }],
            data: [
                { $project: projection },
                { $skip: skip },
                { $limit: limit }
            ]
        }
    });

    const aggregationResult = await FoodRestaurant.aggregate(pipeline);
    const pageDocs = aggregationResult[0]?.data || [];
    const total = aggregationResult[0]?.metadata[0]?.total || 0;

    // Attach recommended dishes
    const restaurantIds = pageDocs.map(r => r._id);
    const allRecommended = await FoodItem.find({
        restaurantId: { $in: restaurantIds },
        isRecommended: true,
        isAvailable: true,
        approvalStatus: 'approved'
    }).select('restaurantId name price image foodType variants variations').lean();

    // Count total approved menu items per restaurant (to detect empty-menu restaurants)
    const menuCounts = await FoodItem.aggregate([
        { $match: { restaurantId: { $in: restaurantIds }, isAvailable: true, approvalStatus: 'approved' } },
        { $group: { _id: '$restaurantId', count: { $sum: 1 } } }
    ]);
    const menuCountMap = menuCounts.reduce((acc, entry) => {
        acc[String(entry._id)] = entry.count;
        return acc;
    }, {});

    const recommendedMap = allRecommended.reduce((acc, item) => {
        const rid = String(item.restaurantId);
        if (!acc[rid]) acc[rid] = [];
        acc[rid].push({
            id: String(item._id),
            name: item.name,
            price: getFoodDisplayPrice(item),
            image: item.image,
            foodType: item.foodType
        });
        return acc;
    }, {});

    const restaurants = pageDocs.map(r => ({
        ...r,
        restaurantId: r._id,
        id: r._id,
        name: r.restaurantName || '',
        rating: normalizeRatingValue(r.rating),
        totalRatings: normalizeTotalRatingsValue(r.totalRatings),
        profileImage: r.profileImage ? { url: r.profileImage } : null,
        coverImages: Array.isArray(r.coverImages) ? r.coverImages : [],
        openingTime: r.openingTime || null,
        closingTime: r.closingTime || null,
        openDays: Array.isArray(r.openDays) ? r.openDays : [],
        menuImages: Array.isArray(r.menuImages) ? r.menuImages : [],
        recommendedDishes: recommendedMap[String(r._id)] || [],
        totalMenuItems: menuCountMap[String(r._id)] || 0,
        hasDishes: (menuCountMap[String(r._id)] || 0) > 0,
        image: r.coverImages?.[0] || r.profileImage || (r.menuImages?.length > 0 ? r.menuImages[0] : null) || null,
        images: Array.isArray(r.coverImages) && r.coverImages.length > 0
            ? r.coverImages
            : (r.profileImage ? [r.profileImage] : [])
    }));

    // Replace geoNear air distance with Google driving/road distance (same as cart bill).
    // Keep air distance as fallback if Matrix API fails for a restaurant.
    if (lat !== null && lng !== null && restaurants.length > 0) {
        try {
            const destinations = restaurants.map((r) => extractRestaurantLatLng(r));
            const drivingKms = await fetchDrivingDistancesKmBatch(
                { lat, lng },
                destinations,
            );
            restaurants.forEach((r, i) => {
                const km = drivingKms[i];
                if (!Number.isFinite(km) || km <= 0) return;
                r.distanceInKm = km;
                r.distance = formatRestaurantDistanceLabel(km);
                r.distanceMode = 'driving';
            });
        } catch (err) {
            logger.warn(
                `Driving distance enrich skipped for restaurant list: ${err?.message || err}`,
            );
        }
    }

    return { restaurants, total, page, limit };
};

export const getApprovedRestaurantByIdOrSlug = async (idOrSlug, userId = null, coords = {}) => {
    const value = String(idOrSlug || '').trim();
    if (!value) return null;

    let doc = null;
    // ObjectId path
    if (/^[0-9a-fA-F]{24}$/.test(value)) {
        doc = await FoodRestaurant.findOne({ _id: value, status: 'approved' }).lean();
    } else {
        // Slug / name path — URL may be "navis-cafe" while DB has "navi's cafe"
        const variantWithSpaces = normalizeName(value);
        const compact = toCompactName(value);
        // Allow any non-alphanumeric between letters (apostrophe, space, hyphen)
        const flexibleCompact =
            compact.length >= 3
                ? new RegExp(
                      '^' +
                          compact
                              .split('')
                              .map((ch) => escapeRegex(ch))
                              .join('[^a-z0-9]*') +
                          '$',
                      'i',
                  )
                : null;

        const orClauses = [
            { slug: value },
            { restaurantSlug: value },
            { restaurantNameNormalized: variantWithSpaces },
            { restaurantNameNormalized: value.trim().toLowerCase() },
        ];
        if (flexibleCompact) {
            orClauses.push(
                { restaurantNameNormalized: flexibleCompact },
                { restaurantName: flexibleCompact },
            );
        }

        doc = await FoodRestaurant.findOne({
            status: 'approved',
            $or: orClauses,
        }).lean();
    }

    if (!doc) return null;

    // Enhance with personalization if userId exists
    let hasOrderedBefore = false;
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        const previousOrder = await FoodOrder.findOne({
            userId,
            restaurantId: doc._id,
            orderStatus: 'delivered'
        }).select('_id').lean();
        hasOrderedBefore = !!previousOrder;
    }

    const timingsDoc = await FoodRestaurantOutletTimings.findOne({ restaurantId: doc._id }).lean();

    const result = {
        ...doc,
        rating: normalizeRatingValue(doc.rating),
        totalRatings: normalizeTotalRatingsValue(doc.totalRatings),
        hasOrderedBefore,
        outletTimings: timingsDoc || undefined,
        image: doc.coverImages?.[0] || doc.profileImage || (doc.menuImages?.length > 0 ? doc.menuImages[0] : null) || null,
        images: Array.isArray(doc.coverImages) && doc.coverImages.length > 0
            ? doc.coverImages
            : (doc.profileImage ? [doc.profileImage] : [])
    };

    // Same driving-distance helper AND direction as cart bill:
    // restaurant (origin) → delivery address (destination).
    const userLat = toFiniteNumber(coords?.lat);
    const userLng = toFiniteNumber(coords?.lng);
    const restaurantPoint = extractRestaurantLatLng(doc);
    if (userLat !== null && userLng !== null && restaurantPoint) {
        try {
            const drivingKm = await fetchDrivingDistanceKm(
                restaurantPoint,
                { lat: userLat, lng: userLng },
            );
            if (Number.isFinite(drivingKm) && drivingKm > 0) {
                result.distanceInKm = drivingKm;
                result.distance = formatRestaurantDistanceLabel(drivingKm);
                result.distanceMode = 'driving';
            }
        } catch (err) {
            logger.warn(
                `Driving distance for restaurant ${doc._id} failed: ${err?.message || err}`,
            );
        }
    }

    return result;
};

export const listPublicOffers = async () => {
    const now = new Date();
    const filter = {
        status: 'active',
        $and: [
            { $or: [{ startDate: { $exists: false } }, { startDate: null }, { startDate: { $lte: now } }] },
            { $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gt: now } }] }
        ]
    };

    const list = await FoodOffer.find(filter)
        .sort({ createdAt: -1 })
        .populate({ path: 'restaurantId', select: 'restaurantName restaurantNameNormalized profileImage estimatedDeliveryTime rating' })
        .lean();

    const allOffers = list.map((o) => {
        const restaurant = o.restaurantId && typeof o.restaurantId === 'object' ? o.restaurantId : null;
        const restaurantSlug = restaurant?.restaurantNameNormalized || undefined;
        const restaurantName =
            o.restaurantScope === 'selected'
                ? (restaurant?.restaurantName || 'Selected Restaurant')
                : 'All Restaurants';

        const title =
            o.discountType === 'percentage'
                ? `${Number(o.discountValue) || 0}% OFF`
                : `Flat ₹${Number(o.discountValue) || 0} OFF`;

        return {
            id: String(o._id),
            offerId: String(o._id),
            couponCode: o.couponCode,
            title,
            discountType: o.discountType,
            discountValue: o.discountValue,
            maxDiscount: o.maxDiscount ?? null,
            customerScope: o.customerScope,
            restaurantScope: o.restaurantScope,
            restaurantId: restaurant?._id ? String(restaurant._id) : (o.restaurantScope === 'selected' ? String(o.restaurantId) : null),
            restaurantName,
            restaurantSlug,
            restaurantImage: restaurant?.profileImage || null,
            deliveryTime: restaurant?.estimatedDeliveryTime || null,
            restaurantRating: typeof restaurant?.rating === 'number' ? restaurant.rating : 0,
            endDate: o.endDate || null,
            showInCart: o.showInCart !== false,
            minOrderValue: Number(o.minOrderValue) > 0 ? Number(o.minOrderValue) : null,
            couponType: o.couponType || 'all'
        };
    });

    return { allOffers, groupedByOffer: {} };
};

/**
 * List complaints for a restaurant.
 * Calls adminService.getRestaurantComplaints with fixed restaurantId.
 */
export const getRestaurantComplaints = async (restaurantId, query = {}) => {
    const { getRestaurantComplaints: getComplaintsInternal } = await import('../../admin/services/admin.service.js');
    return getComplaintsInternal({ ...query, restaurantId });
};

/**
 * List restaurants that have at least one approved, available dish under a price limit.
 * Supports progressive pages via ?limit=&offset= so the first screen can paint fast.
 */
export const listRestaurantsUnderPriceLimit = async (query = {}, priceLimit = 250) => {
    const zoneIdRaw = String(query.zoneId || '').trim();
    if (!zoneIdRaw || !mongoose.Types.ObjectId.isValid(zoneIdRaw)) {
        throw new ValidationError('Valid zoneId is required for Under 250 fetching');
    }

    const effectivePrice =
        Number(query.priceLimit) > 0 ? Number(query.priceLimit) : Number(priceLimit) || 250;
    const hasLimit = query.limit != null && String(query.limit).trim() !== '';
    const pageLimit = hasLimit
        ? Math.min(Math.max(parseInt(String(query.limit), 10) || 6, 1), 40)
        : null;
    const pageOffset = Math.max(parseInt(String(query.offset ?? query.skip ?? 0), 10) || 0, 0);

    const restaurantSelect =
        'restaurantName slug area city rating totalRatings estimatedDeliveryTime estimatedDeliveryTimeMinutes profileImage coverImages menuImages location pureVegRestaurant pureVeganRestaurant isActive isAcceptingOrders openingTime closingTime openDays';

    const mapItem = (item) => {
        const ft = String(item.foodType || '').trim().toLowerCase();
        let isVeg = false;
        if (ft === 'veg' || ft === 'vegan') isVeg = true;
        else if (ft === 'non-veg' || ft === 'non veg' || ft === 'nonveg' || ft.includes('non')) {
            isVeg = false;
        } else if (item.isVeg === true) isVeg = true;
        else if (item.isVeg === false) isVeg = false;

        return {
            ...item,
            id: String(item._id),
            isVeg,
            isVegan: ft === 'vegan',
        };
    };

    const MAX_ITEMS_PER_RESTAURANT = 12;

    const attachItemsForRestaurants = async (restaurantsBatch) => {
        if (!restaurantsBatch.length) return [];
        const ids = restaurantsBatch.map((r) => r._id);
        const eligibleItems = await FoodItem.find({
            restaurantId: { $in: ids },
            $or: [
                { price: { $lte: effectivePrice } },
                { 'variants.price': { $lte: effectivePrice } },
            ],
            isAvailable: true,
            approvalStatus: 'approved',
        })
            .select(
                'restaurantId name price image foodType description isVeg isRecommended categoryName categoryId category variants',
            )
            .lean();

        const restaurantItemsMap = {};
        eligibleItems.forEach((item) => {
            const rid = String(item.restaurantId);
            if (!restaurantItemsMap[rid]) restaurantItemsMap[rid] = [];
            restaurantItemsMap[rid].push(mapItem(item));
        });

        Object.keys(restaurantItemsMap).forEach((rid) => {
            const items = restaurantItemsMap[rid];
            items.sort((a, b) => {
                const aRec = a.isRecommended ? 1 : 0;
                const bRec = b.isRecommended ? 1 : 0;
                if (bRec !== aRec) return bRec - aRec;
                return Number(a.price || 0) - Number(b.price || 0);
            });
            restaurantItemsMap[rid] = items.slice(0, MAX_ITEMS_PER_RESTAURANT);
        });

        return restaurantsBatch
            .filter((r) => (restaurantItemsMap[String(r._id)] || []).length > 0)
            .map((r) => {
                const rid = String(r._id);
                const items = restaurantItemsMap[rid] || [];
                const hasNonVegInItems = items.some((item) => !item.isVeg);
                const hasNonVeganInItems = items.some((item) => item.isVegan !== true);
                const hasNonVegMenu =
                    hasNonVegInItems || r.pureVegRestaurant === false
                        ? true
                        : r.pureVegRestaurant === true
                          ? false
                          : hasNonVegInItems;
                const isPureVegan =
                    r.pureVeganRestaurant === true && !hasNonVeganInItems && !hasNonVegInItems;
                return {
                    ...r,
                    id: rid,
                    restaurantId: rid,
                    name: r.restaurantName,
                    menuItems: items,
                    hasNonVegMenu,
                    isPureVeg: !hasNonVegMenu,
                    pureVeganRestaurant: r.pureVeganRestaurant === true,
                    isPureVegan,
                    outletTimings: { timings: [] },
                    image:
                        r.coverImages?.[0] ||
                        r.profileImage ||
                        (r.menuImages?.length > 0 ? r.menuImages[0] : null) ||
                        null,
                    images:
                        Array.isArray(r.coverImages) && r.coverImages.length > 0
                            ? r.coverImages
                            : r.profileImage
                              ? [r.profileImage]
                              : [],
                };
            });
    };

    const enrichOutletTimings = async (restaurants) => {
        if (!restaurants.length) return restaurants;
        const ids = restaurants.map((r) => r._id || r.restaurantId).filter(Boolean);
        const outletTimingsRaw = await FoodRestaurantOutletTimings.find({
            restaurantId: { $in: ids },
        }).lean();
        const timingsMap = {};
        outletTimingsRaw.forEach((t) => {
            timingsMap[String(t.restaurantId)] = t.timings || [];
        });
        return restaurants.map((r) => {
            const rid = String(r._id || r.restaurantId);
            return {
                ...r,
                outletTimings: { timings: timingsMap[rid] || [] },
            };
        });
    };

    // Progressive page: scan top-rated restaurants in small batches until page filled.
    if (pageLimit != null) {
        const scanStart = Math.max(parseInt(String(query.scanSkip ?? 0), 10) || 0, 0);
        // When scanSkip is set, caller already skipped earlier eligible restaurants — only fill this page.
        const resumeMode = scanStart > 0 && pageOffset > 0;
        const need = resumeMode ? pageLimit : pageOffset + pageLimit;
        const collected = [];
        let scanned = resumeMode ? scanStart : 0;
        const SCAN_BATCH = 20;
        let exhausted = false;

        while (collected.length < need) {
            const batch = await FoodRestaurant.find({
                zoneId: new mongoose.Types.ObjectId(zoneIdRaw),
                status: 'approved',
            })
                .select(restaurantSelect)
                .sort({ rating: -1, totalRatings: -1, _id: 1 })
                .skip(scanned)
                .limit(SCAN_BATCH)
                .lean();

            if (batch.length === 0) {
                exhausted = true;
                break;
            }

            scanned += batch.length;
            const eligible = await attachItemsForRestaurants(batch);
            collected.push(...eligible);

            if (batch.length < SCAN_BATCH) {
                exhausted = true;
                break;
            }
            if (scanned >= 400) break;
        }

        const page = resumeMode
            ? collected.slice(0, pageLimit)
            : collected.slice(pageOffset, pageOffset + pageLimit);
        const withTimings = await enrichOutletTimings(page);
        const hasMore =
            resumeMode
                ? collected.length > page.length || (!exhausted && page.length >= pageLimit)
                : collected.length > pageOffset + page.length || (!exhausted && page.length >= pageLimit);

        return {
            restaurants: withTimings,
            total: hasMore ? pageOffset + withTimings.length + 1 : pageOffset + withTimings.length,
            offset: pageOffset,
            limit: pageLimit,
            hasMore,
            nextOffset: pageOffset + withTimings.length,
            scanSkip: scanned,
        };
    }

    // Full list (legacy / rare): one pass for entire zone
    const restaurantsInZone = await FoodRestaurant.find({
        zoneId: new mongoose.Types.ObjectId(zoneIdRaw),
        status: 'approved',
    })
        .select(restaurantSelect)
        .sort({ rating: -1, totalRatings: -1 })
        .lean();

    if (restaurantsInZone.length === 0) {
        return { restaurants: [], total: 0, offset: 0, hasMore: false };
    }

    let restaurants = await attachItemsForRestaurants(restaurantsInZone);
    restaurants = await enrichOutletTimings(restaurants);

    return {
        restaurants,
        total: restaurants.length,
        offset: 0,
        hasMore: false,
    };
};

