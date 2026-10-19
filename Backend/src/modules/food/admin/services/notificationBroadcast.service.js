import mongoose from 'mongoose';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodZone } from '../models/zone.model.js';
import { FoodOrder } from '../../orders/models/order.model.js';
import { BroadcastNotification } from '../../../../core/notifications/models/notificationBroadcast.model.js';
import { FoodNotification } from '../../../../core/notifications/models/notification.model.js';
import { createInboxNotifications } from '../../../../core/notifications/notification.service.js';
import { notifyOwnersSafely, broadcastPushToTargetsSafely } from '../../../../core/notifications/firebase.service.js';
import { zoneToGeoPolygon } from '../../shared/zoneLocation.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { logger } from '../../../../utils/logger.js';

const TARGET_TYPE_MAP = {
    ALL: 'ALL',
    USER: 'USER',
    RESTAURANT: 'RESTAURANT',
    DELIVERY: 'DELIVERY',
    CUSTOM: 'CUSTOM'
};

const OWNER_LABEL_MAP = {
    USER: 'Users',
    RESTAURANT: 'Restaurants',
    DELIVERY_PARTNER: 'Delivery Partners'
};

const toObjectId = (value, fieldName) => {
    if (!value || !mongoose.Types.ObjectId.isValid(String(value))) {
        throw new ValidationError(`${fieldName} is invalid`);
    }
    return new mongoose.Types.ObjectId(String(value));
};

const normalizeText = (value, fieldName, required = true) => {
    const text = String(value || '').trim();
    if (required && !text) {
        throw new ValidationError(`${fieldName} is required`);
    }
    return text;
};

const normalizeTargetType = (value) => {
    const nextValue = String(value || '').trim().toUpperCase();
    const normalized = TARGET_TYPE_MAP[nextValue];
    if (!normalized) {
        throw new ValidationError('targetType is invalid');
    }
    return normalized;
};

const ownerModelMap = {
    USER: FoodUser,
    RESTAURANT: FoodRestaurant,
    DELIVERY_PARTNER: FoodDeliveryPartner
};

const buildUserLabel = (doc) => ({
    label: String(doc?.name || doc?.phone || 'User').trim(),
    subLabel: [doc?.phone, doc?.email].filter(Boolean).join(' • ')
});

const buildRestaurantLabel = (doc) => ({
    label: String(doc?.restaurantName || doc?.ownerName || 'Restaurant').trim(),
    subLabel: [doc?.ownerPhone, doc?.ownerEmail].filter(Boolean).join(' • ')
});

const buildDeliveryLabel = (doc) => ({
    label: String(doc?.name || doc?.phone || 'Delivery Partner').trim(),
    subLabel: [doc?.phone, doc?.email].filter(Boolean).join(' • ')
});

const modelConfigMap = {
    USER: {
        model: FoodUser,
        query: { isActive: true },
        select: '_id name phone email',
        buildLabel: buildUserLabel
    },
    RESTAURANT: {
        model: FoodRestaurant,
        query: { status: 'approved' },
        select: '_id restaurantName ownerName ownerPhone ownerEmail',
        buildLabel: buildRestaurantLabel
    },
    DELIVERY_PARTNER: {
        model: FoodDeliveryPartner,
        query: { status: 'approved' },
        select: '_id name phone email',
        buildLabel: buildDeliveryLabel
    }
};

const dedupeTargets = (targets = []) => {
    const map = new Map();
    for (const target of Array.isArray(targets) ? targets : []) {
        const ownerType = String(target?.ownerType || '').trim().toUpperCase();
        const ownerId = String(target?.ownerId || '').trim();
        if (!ownerType || !ownerId || !mongoose.Types.ObjectId.isValid(ownerId)) continue;
        map.set(`${ownerType}:${ownerId}`, {
            ownerType,
            ownerId,
            label: String(target?.label || '').trim(),
            subLabel: String(target?.subLabel || '').trim()
        });
    }
    return [...map.values()];
};

/**
 * Loads the active zone a broadcast is scoped to. Returns null for Global
 * (no zoneId given) — callers then skip all zone filtering, which keeps the
 * existing "send to everyone" behaviour byte-for-byte unchanged.
 */
const resolveBroadcastZone = async (zoneId) => {
    const rawZoneId = String(zoneId || '').trim();
    if (!rawZoneId) return null;
    if (!mongoose.Types.ObjectId.isValid(rawZoneId)) {
        throw new ValidationError('Selected zone is invalid');
    }
    const zone = await FoodZone.findById(rawZoneId)
        .select('name zoneName serviceLocation isActive coordinates')
        .lean();
    if (!zone) throw new ValidationError('Selected zone no longer exists');
    if (zone.isActive === false) throw new ValidationError('Selected zone is not active');
    return zone;
};

const zoneDisplayName = (zone) =>
    String(zone?.name || zone?.zoneName || zone?.serviceLocation || '').trim();

/**
 * User ids that belong to a zone, by EITHER signal:
 *  - a saved address whose point falls inside the zone polygon (2dsphere), or
 *  - any order they placed in that zone (order.zoneId).
 * The two id sets are unioned and de-duplicated.
 */
const findUserIdsInZone = async (zone) => {
    const ids = new Set();

    const polygon = zoneToGeoPolygon(zone);
    if (polygon) {
        const byAddress = await FoodUser.find({
            isActive: true,
            'addresses.location': { $geoWithin: { $geometry: polygon } }
        }).select('_id').lean();
        byAddress.forEach((row) => ids.add(String(row._id)));
    }

    const byOrder = await FoodOrder.find({ zoneId: zone._id })
        .distinct('userId');
    byOrder.forEach((id) => { if (id) ids.add(String(id)); });

    return [...ids];
};

/**
 * Mongo filter that scopes a model's zone query:
 *  - DELIVERY_PARTNER / RESTAURANT carry a zoneId directly.
 *  - RESTAURANT also matches by polygon for legacy rows that never got a zoneId.
 */
const buildOwnerZoneFilter = (ownerType, zone) => {
    const zoneObjectId = new mongoose.Types.ObjectId(String(zone._id));
    if (ownerType === 'DELIVERY_PARTNER') {
        return { zoneId: zoneObjectId };
    }
    if (ownerType === 'RESTAURANT') {
        const clauses = [{ zoneId: zoneObjectId }];
        const polygon = zoneToGeoPolygon(zone);
        if (polygon) clauses.push({ location: { $geoWithin: { $geometry: polygon } } });
        return { $or: clauses };
    }
    return {};
};

const loadTargetsByOwnerType = async (ownerType, zone = null) => {
    const config = modelConfigMap[ownerType];
    if (!config) return [];

    // Global broadcast (no zone): unchanged behaviour — every active owner.
    if (!zone) {
        const rows = await config.model.find(config.query).select(config.select).lean();
        return rows.map((row) => ({
            ownerType,
            ownerId: String(row._id),
            ...config.buildLabel(row)
        }));
    }

    // Zone-scoped: USER is resolved by address-geo OR order history; the
    // others by their own zoneId (+ polygon for legacy restaurants).
    let query;
    if (ownerType === 'USER') {
        const userIds = await findUserIdsInZone(zone);
        if (!userIds.length) return [];
        query = { ...config.query, _id: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) } };
    } else {
        query = { ...config.query, ...buildOwnerZoneFilter(ownerType, zone) };
    }

    const rows = await config.model.find(query).select(config.select).lean();
    return rows.map((row) => ({
        ownerType,
        ownerId: String(row._id),
        ...config.buildLabel(row)
    }));
};

const resolveCustomTargets = async ({ targets = [], targetIds = [] } = {}) => {
    const explicitTargets = dedupeTargets(targets);
    if (explicitTargets.length > 0) return explicitTargets;

    const ids = [...new Set((Array.isArray(targetIds) ? targetIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
    if (!ids.length) {
        throw new ValidationError('Please select at least one recipient for custom broadcast');
    }

    const [users, restaurants, deliveryPartners] = await Promise.all([
        FoodUser.find({ _id: { $in: ids }, isActive: true }).select('_id name phone email').lean(),
        FoodRestaurant.find({ _id: { $in: ids } }).select('_id restaurantName ownerName ownerPhone ownerEmail').lean(),
        FoodDeliveryPartner.find({ _id: { $in: ids } }).select('_id name phone email').lean()
    ]);

    const resolved = [
        ...users.map((row) => ({ ownerType: 'USER', ownerId: String(row._id), ...buildUserLabel(row) })),
        ...restaurants.map((row) => ({ ownerType: 'RESTAURANT', ownerId: String(row._id), ...buildRestaurantLabel(row) })),
        ...deliveryPartners.map((row) => ({ ownerType: 'DELIVERY_PARTNER', ownerId: String(row._id), ...buildDeliveryLabel(row) }))
    ];

    if (!resolved.length) {
        throw new ValidationError('Selected recipients not found');
    }

    return resolved;
};

const resolveTargets = async ({ targetType, targetIds = [], targets = [], zone = null } = {}) => {
    if (targetType === 'ALL') {
        const [users, restaurants, deliveryPartners] = await Promise.all([
            loadTargetsByOwnerType('USER', zone),
            loadTargetsByOwnerType('RESTAURANT', zone),
            loadTargetsByOwnerType('DELIVERY_PARTNER', zone)
        ]);
        return [...users, ...restaurants, ...deliveryPartners];
    }

    if (targetType === 'USER') return loadTargetsByOwnerType('USER', zone);
    if (targetType === 'RESTAURANT') return loadTargetsByOwnerType('RESTAURANT', zone);
    if (targetType === 'DELIVERY') return loadTargetsByOwnerType('DELIVERY_PARTNER', zone);
    // Particular-person targeting is an explicit hand-picked list — zone does not apply.
    if (targetType === 'CUSTOM') return resolveCustomTargets({ targets, targetIds });

    throw new ValidationError('Unsupported targetType');
};

const buildNotificationPayload = ({ title, message, link, broadcastId, target }) => ({
    ownerType: target.ownerType,
    ownerId: target.ownerId,
    title,
    message,
    link,
    category: 'broadcast',
    broadcastId,
    metadata: {
        broadcastId: String(broadcastId),
        ownerLabel: target.label || '',
        ownerSubLabel: target.subLabel || ''
    }
});

const emitRealtimeNotifications = (targets = [], broadcast) => {
    const io = getIO();
    if (!io) return;

    for (const target of targets) {
        const ownerId = String(target.ownerId || '');
        if (!ownerId) continue;

        const payload = {
            id: String(broadcast._id),
            title: broadcast.title,
            message: broadcast.message,
            link: broadcast.link || '',
            targetType: broadcast.targetType,
            createdAt: broadcast.createdAt
        };

        if (target.ownerType === 'USER') {
            io.to(rooms.user(ownerId)).emit('admin_notification', payload);
        }
        if (target.ownerType === 'RESTAURANT') {
            io.to(rooms.restaurant(ownerId)).emit('admin_notification', payload);
        }
        if (target.ownerType === 'DELIVERY_PARTNER') {
            io.to(rooms.delivery(ownerId)).emit('admin_notification', payload);
        }
    }
};

const paginationMeta = ({ page = 1, limit = 10 } = {}) => {
    const nextPage = Math.max(1, Number(page) || 1);
    const nextLimit = Math.max(1, Math.min(100, Number(limit) || 10));
    return {
        page: nextPage,
        limit: nextLimit,
        skip: (nextPage - 1) * nextLimit
    };
};

export const createBroadcastNotification = async ({ body = {}, adminId } = {}) => {
    const title = normalizeText(body?.title, 'title');
    const message = normalizeText(body?.message, 'message');
    const link = normalizeText(body?.link, 'link', false);
    const targetType = normalizeTargetType(body?.targetType);
    // Zone applies only to the role-based targets; ALL/CUSTOM ignore it.
    const zone = ['USER', 'RESTAURANT', 'DELIVERY', 'ALL'].includes(targetType)
        ? await resolveBroadcastZone(body?.zoneId)
        : null;
    const resolvedTargets = await resolveTargets({
        targetType,
        targetIds: body?.targetIds,
        targets: body?.targets,
        zone
    });

    // One-line audit of exactly what a broadcast resolved to — invaluable for
    // confirming zone scoping in production (grep the server log for [Broadcast]).
    logger.info(
        `[Broadcast] targetType=${targetType} ` +
        `zoneIdIn=${String(body?.zoneId || '') || '(none/global)'} ` +
        `zoneResolved=${zone ? `${zoneDisplayName(zone)}:${zone._id}` : 'GLOBAL'} ` +
        `recipients=${resolvedTargets.length}`
    );

    // Global/unscoped with no recipients is a misconfiguration — surface it.
    // A zone-scoped broadcast that matches nobody still records silently (the
    // zone may simply have no users/partners yet), per product choice.
    if (!resolvedTargets.length && !zone) {
        throw new ValidationError(`No recipients found for ${targetType.toLowerCase()} broadcast`);
    }

    const targetIds = resolvedTargets.map((target) => toObjectId(target.ownerId, 'targetId'));

    const broadcast = await BroadcastNotification.create({
        title,
        message,
        targetType,
        targetIds: targetType === 'CUSTOM' ? targetIds : [],
        targets: resolvedTargets.map((target) => ({
            ownerType: target.ownerType,
            ownerId: toObjectId(target.ownerId, 'ownerId'),
            label: target.label || '',
            subLabel: target.subLabel || ''
        })),
        link,
        zoneId: zone?._id || null,
        zoneName: zone ? zoneDisplayName(zone) : '',
        createdBy: toObjectId(adminId, 'createdBy'),
        targetCount: resolvedTargets.length
    });

    // Nobody to notify (empty zone): record is saved above; skip all fan-out.
    if (!resolvedTargets.length) {
        return { broadcast, targetPreview: [] };
    }

    const pushTargets = resolvedTargets.map((target) => ({
        ownerType: target.ownerType,
        ownerId: target.ownerId
    }));
    
    const pushPayload = {
        title,
        body: message,
        link: link || '/',
        sendToAllDevices: true,
        data: {
            type: 'admin_broadcast',
            broadcastId: String(broadcast._id),
            link: link || '/',
            click_action: link || '/',
            targetUrl: link || '/'
        }
    };

    // Run heavy operations in the background so the frontend doesn't hang
    setTimeout(async () => {
        try {
            await createInboxNotifications({
                notifications: resolvedTargets.map((target) =>
                    buildNotificationPayload({
                        title,
                        message,
                        link,
                        broadcastId: broadcast._id,
                        target
                    })
                )
            });
        } catch (error) {
            console.error('[broadcast] background inbox create failed:', error?.message || error);
        }

        try {
            emitRealtimeNotifications(resolvedTargets, broadcast);
        } catch (error) {
            console.error('[broadcast] background realtime emit failed:', error?.message || error);
        }

        try {
            await broadcastPushToTargetsSafely(pushTargets, pushPayload);
        } catch (error) {
            console.error('[broadcast] background FCM failed:', error?.message || error);
        }
    }, 0);

    return {
        broadcast,
        targetPreview: resolvedTargets.slice(0, 10)
    };
};

export const getBroadcastNotifications = async ({ page = 1, limit = 10 } = {}) => {
    const { skip, ...meta } = paginationMeta({ page, limit });

    const [items, total] = await Promise.all([
        BroadcastNotification.find({})
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(meta.limit)
            .select('-targets -targetIds')
            .populate('createdBy', 'name email')
            .lean(),
        BroadcastNotification.countDocuments({})
    ]);

    const baseTargetLabel = (item) => {
        if (item.targetType === 'CUSTOM') {
            return `${Number(item.targetCount || item.targets?.length || 0)} selected recipients`;
        }
        const map = {
            ALL: 'All Recipients',
            USER: 'Users',
            RESTAURANT: 'Restaurants',
            DELIVERY: 'Delivery Partners'
        };
        return map[item.targetType] || OWNER_LABEL_MAP[item.targetType] || item.targetType;
    };

    return {
        items: items.map((item) => {
            const base = baseTargetLabel(item);
            // Zone-scoped broadcasts show "<target> • <zone>"; Global shows just the target.
            const zoneSuffix = item.zoneName ? ` • ${item.zoneName}` : (item.zoneId ? '' : '');
            const targetLabel =
                item.targetType === 'CUSTOM' ? base : `${base}${zoneSuffix}`;
            return { ...item, targetLabel };
        }),
        pagination: {
            page: meta.page,
            limit: meta.limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / meta.limit))
        }
    };
};

export const deleteBroadcastNotification = async (broadcastId) => {
    const normalizedId = toObjectId(broadcastId, 'broadcastId');
    const broadcast = await BroadcastNotification.findByIdAndDelete(normalizedId).lean();

    if (!broadcast) {
        throw new NotFoundError('Broadcast notification not found');
    }

    const result = await FoodNotification.deleteMany({ broadcastId: normalizedId });

    return {
        broadcast,
        deletedInboxCount: Number(result?.deletedCount || 0)
    };
};

export const searchBroadcastRecipients = async ({ search = '', targetType = 'ALL', page = 1, limit = 20 } = {}) => {
    const rawSearch = String(search || '').trim().slice(0, 80);
    const sanitizedPage = Math.max(1, Number(page) || 1);
    const sanitizedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (sanitizedPage - 1) * sanitizedLimit;

    const buildRegexFilter = (fields = []) => {
        if (!rawSearch) return {};
        const term = rawSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return {
            $or: fields.map((field) => ({ [field]: { $regex: term, $options: 'i' } }))
        };
    };

    const target = String(targetType || 'ALL').toUpperCase();
    const fetchUsers = target === 'ALL' || target === 'USER';
    const fetchRestaurants = target === 'ALL' || target === 'RESTAURANT';
    const fetchDelivery = target === 'ALL' || target === 'DELIVERY' || target === 'DELIVERY_PARTNER';

    const userFilter = { isActive: true, ...buildRegexFilter(['name', 'phone', 'email']) };
    const restaurantFilter = { status: 'approved', ...buildRegexFilter(['restaurantName', 'ownerName', 'ownerPhone', 'ownerEmail']) };
    const deliveryFilter = { status: 'approved', ...buildRegexFilter(['name', 'phone', 'email']) };

    const [users, restaurants, deliveryPartners, userCount, restaurantCount, deliveryCount, matchedUserCount, matchedRestaurantCount, matchedDeliveryCount] = await Promise.all([
        fetchUsers
            ? FoodUser.find(userFilter)
                  .select('_id name phone email')
                  .sort({ _id: -1 })
                  .skip(target === 'USER' || target === 'ALL' ? skip : 0)
                  .limit(sanitizedLimit)
                  .lean()
            : [],
        fetchRestaurants
            ? FoodRestaurant.find(restaurantFilter)
                  .select('_id restaurantName ownerName ownerPhone ownerEmail')
                  .sort({ _id: -1 })
                  .skip(target === 'RESTAURANT' ? skip : 0)
                  .limit(sanitizedLimit)
                  .lean()
            : [],
        fetchDelivery
            ? FoodDeliveryPartner.find(deliveryFilter)
                  .select('_id name phone email')
                  .sort({ _id: -1 })
                  .skip(target === 'DELIVERY_PARTNER' || target === 'DELIVERY' ? skip : 0)
                  .limit(sanitizedLimit)
                  .lean()
            : [],
        FoodUser.countDocuments({ isActive: true }),
        FoodRestaurant.countDocuments({ status: 'approved' }),
        FoodDeliveryPartner.countDocuments({ status: 'approved' }),
        fetchUsers ? FoodUser.countDocuments(userFilter) : 0,
        fetchRestaurants ? FoodRestaurant.countDocuments(restaurantFilter) : 0,
        fetchDelivery ? FoodDeliveryPartner.countDocuments(deliveryFilter) : 0
    ]);

    const recipients = [
        ...users.map((row) => ({ ownerType: 'USER', ownerId: String(row._id), ...buildUserLabel(row) })),
        ...restaurants.map((row) => ({ ownerType: 'RESTAURANT', ownerId: String(row._id), ...buildRestaurantLabel(row) })),
        ...deliveryPartners.map((row) => ({ ownerType: 'DELIVERY_PARTNER', ownerId: String(row._id), ...buildDeliveryLabel(row) }))
    ].slice(0, sanitizedLimit);

    const matchedTotal = (fetchUsers ? matchedUserCount : 0) + (fetchRestaurants ? matchedRestaurantCount : 0) + (fetchDelivery ? matchedDeliveryCount : 0);

    return {
        recipients,
        pagination: {
            page: sanitizedPage,
            limit: sanitizedLimit,
            matchedTotal,
            totalPages: Math.max(1, Math.ceil(matchedTotal / sanitizedLimit))
        },
        counts: {
            user: userCount,
            restaurant: restaurantCount,
            delivery: deliveryCount,
            total: userCount + restaurantCount + deliveryCount
        }
    };
};
