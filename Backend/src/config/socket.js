import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { config } from './env.js';
import { isOriginAllowed } from './cors.js';
import { logger } from '../utils/logger.js';
import { verifyAccessToken } from '../core/auth/token.util.js';
import { getFirebaseDB } from './firebase.js';

import { canDeliveryPartnerUpdateOrderLocation } from './socketAuthz.js';

let io = null;

function logDeliverySocket(message, extra = {}) {
    const suffix = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
    logger.info(`[DeliverySocket] ${message}${suffix}`);
}

function getTokenFromHandshake(socket) {
    const authToken = socket?.handshake?.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
    const header = socket?.handshake?.headers?.authorization || socket?.handshake?.headers?.Authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.substring(7).trim();
    const queryToken = socket?.handshake?.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();
    return null;
}

function maskToken(token) {
    if (!token || typeof token !== 'string') return null;
    const trimmed = token.trim();
    if (!trimmed) return null;
    return `${trimmed.slice(0, 12)}...${trimmed.slice(-6)}`;
}

const roomNames = {
    restaurant: (id) => `restaurant:${String(id)}`,
    user: (id) => `user:${String(id)}`,
    delivery: (id) => `delivery:${String(id)}`,
    tracking: (orderId) => `tracking:${String(orderId)}`
};

/**
 * Initializes Socket.IO with the provided HTTP server.
 * When REDIS_ENABLED=true and REDIS_URL is set, attaches Redis adapter for horizontal scaling.
 * @param {import('http').Server} server
 * @returns {Promise<Server>}
 */
export const initSocket = async (server) => {
    io = new Server(server, {
        cors: {
            origin: (origin, callback) => {
                if (isOriginAllowed(origin)) {
                    callback(null, true);
                } else {
                    callback(new Error('Not allowed by CORS'));
                }
            },
            credentials: true,
            methods: ['GET', 'POST']
        }
    });

    // Socket auth middleware (Bearer token).
    io.use((socket, next) => {
        try {
            const token = getTokenFromHandshake(socket);
            if (!token) {
                logger.warn(`Socket auth failed: token missing for socket ${socket.id}`);
                logger.warn(`[DeliverySocket] Handshake auth missing`, {
                    socketId: socket.id,
                    origin: socket?.handshake?.headers?.origin || null,
                    host: socket?.handshake?.headers?.host || null,
                    userAgent: socket?.handshake?.headers?.['user-agent'] || null,
                    hasAuthToken: Boolean(socket?.handshake?.auth?.token),
                    hasAuthorizationHeader: Boolean(
                        socket?.handshake?.headers?.authorization || socket?.handshake?.headers?.Authorization
                    ),
                    hasQueryToken: Boolean(socket?.handshake?.query?.token),
                });
                return next(new Error('AUTH_MISSING'));
            }
            logger.info(`[DeliverySocket] Handshake token received`, {
                socketId: socket.id,
                origin: socket?.handshake?.headers?.origin || null,
                host: socket?.handshake?.headers?.host || null,
                transport: socket?.handshake?.query?.transport || null,
                tokenPreview: maskToken(token),
            });
            const decoded = verifyAccessToken(token);
            socket.user = { userId: decoded.userId, role: decoded.role };
            logger.info(`Socket auth success: ${decoded.role}:${decoded.userId} for socket ${socket.id}`);
            return next();
        } catch (err) {
            logger.error(`Socket auth failed for socket ${socket.id}: ${err.message}`);
            logger.error(`[DeliverySocket] Handshake auth invalid`, {
                socketId: socket.id,
                origin: socket?.handshake?.headers?.origin || null,
                host: socket?.handshake?.headers?.host || null,
                transport: socket?.handshake?.query?.transport || null,
                tokenPreview: maskToken(getTokenFromHandshake(socket)),
                errorMessage: err.message,
                errorName: err.name || null,
            });
            return next(new Error('AUTH_INVALID'));
        }
    });

    if (config.redisEnabled && config.redisUrl) {
        let pubClient = null;
        let subClient = null;
        try {
            const { createAdapter } = await import('@socket.io/redis-adapter');
            const { createClient } = await import('redis');

            const clientOptions = {
                url: config.redisUrl,
                socket: {
                    connectTimeout: 5000,
                    reconnectStrategy: (retries) => {
                        if (retries > 3) {
                            return new Error('Redis max reconnection attempts reached');
                        }
                        return Math.min(retries * 200, 1000);
                    }
                }
            };

            pubClient = createClient(clientOptions);
            subClient = pubClient.duplicate();

            pubClient.on('error', (err) => logger.error(`Socket.IO Redis pub client: ${err.message}`));
            subClient.on('error', (err) => logger.error(`Socket.IO Redis sub client: ${err.message}`));

            await Promise.all([pubClient.connect(), subClient.connect()]);
            io.adapter(createAdapter(pubClient, subClient));
            logger.info('Socket.IO Redis adapter attached for horizontal scaling');
        } catch (err) {
            logger.warn(`Socket.IO Redis adapter skipped (using in-memory): ${err.message}`);
            try {
                if (pubClient) {
                    pubClient.removeAllListeners('error');
                    pubClient.disconnect().catch(() => {});
                }
                if (subClient) {
                    subClient.removeAllListeners('error');
                    subClient.disconnect().catch(() => {});
                }
            } catch (_) {}
        }
    } else {
        logger.info('Socket.IO running with default in-memory adapter (Redis disabled)');
    }

    io.on('connection', (socket) => {
        const userId = socket.user?.userId;
        const role = socket.user?.role;
        logger.info(`Socket client connected: ${socket.id} (${role || 'UNKNOWN'}:${userId || '-'})`);
        import('./metrics.js').then((m) => m.incrementSocketConnections(1)).catch(() => {});

        // Auto-join role rooms (lets us emit without a custom join).
        if (userId && role) {
            if (role === 'RESTAURANT') socket.join(roomNames.restaurant(userId));
            if (role === 'USER') socket.join(roomNames.user(userId));
            if (role === 'DELIVERY_PARTNER') {
                socket.join(roomNames.delivery(userId));
                logDeliverySocket('Auto-joined delivery room on connect', {
                    socketId: socket.id,
                    deliveryPartnerId: String(userId),
                    room: roomNames.delivery(userId),
                });
            }
        }

        // Explicit join (used by existing restaurant client hook).
        socket.on('join-restaurant', (restaurantId) => {
            if (socket.user?.role !== 'RESTAURANT') return;
            // Security: only join your own restaurant room.
            if (String(socket.user?.userId) !== String(restaurantId)) return;
            socket.join(roomNames.restaurant(restaurantId));
            socket.emit('restaurant-room-joined', { room: roomNames.restaurant(restaurantId), restaurantId: String(restaurantId) });
        });

        // Explicit join (used by existing delivery client hook).
        socket.on('join-delivery', (deliveryPartnerId) => {
            if (socket.user?.role !== 'DELIVERY_PARTNER') {
                logDeliverySocket('Rejected join-delivery for non-delivery role', {
                    socketId: socket.id,
                    role: socket.user?.role || 'UNKNOWN',
                    requestedDeliveryPartnerId: String(deliveryPartnerId || ''),
                });
                return;
            }
            // Security: only join your own delivery room.
            if (String(socket.user?.userId) !== String(deliveryPartnerId)) {
                logDeliverySocket('Rejected join-delivery due to user mismatch', {
                    socketId: socket.id,
                    authDeliveryPartnerId: String(socket.user?.userId || ''),
                    requestedDeliveryPartnerId: String(deliveryPartnerId || ''),
                });
                return;
            }
            const room = roomNames.delivery(deliveryPartnerId);
            socket.join(room);
            const roomSize = io?.sockets?.adapter?.rooms?.get(room)?.size || 0;
            logDeliverySocket('Delivery room joined', {
                socketId: socket.id,
                deliveryPartnerId: String(deliveryPartnerId),
                room,
                roomSize,
            });
            socket.emit('delivery-room-joined', { room, deliveryPartnerId: String(deliveryPartnerId) });
        });

        // ─── Live Tracking Events ───────────────────────────────────────

        // Users / restaurants / assigned delivery partner subscribe to an order's tracking room.
        socket.on('join-tracking', async (orderId) => {
            if (!orderId) return;
            const role = socket.user?.role;
            const authedUserId = String(socket.user?.userId || '');
            if (role !== 'USER' && role !== 'RESTAURANT' && role !== 'DELIVERY_PARTNER' && role !== 'ADMIN') {
                socket.emit('tracking-room-error', { orderId: String(orderId), error: 'FORBIDDEN' });
                return;
            }

            try {
                const { FoodOrder } = await import('../modules/food/orders/models/order.model.js');
                let order = null;
                if (mongoose.Types.ObjectId.isValid(orderId)) {
                    order = await FoodOrder.findById(orderId)
                        .select('userId restaurantId dispatch.deliveryPartnerId orderId')
                        .lean();
                }
                if (!order) {
                    order = await FoodOrder.findOne({ orderId: String(orderId) })
                        .select('userId restaurantId dispatch.deliveryPartnerId orderId')
                        .lean();
                }
                if (!order) {
                    socket.emit('tracking-room-error', { orderId: String(orderId), error: 'NOT_FOUND' });
                    return;
                }

                const allowed =
                    role === 'ADMIN' ||
                    (role === 'USER' && String(order.userId) === authedUserId) ||
                    (role === 'RESTAURANT' && String(order.restaurantId) === authedUserId) ||
                    (role === 'DELIVERY_PARTNER' &&
                        String(order.dispatch?.deliveryPartnerId || '') === authedUserId);

                if (!allowed) {
                    logger.warn(`Socket ${socket.id} denied join-tracking for order ${orderId}`);
                    socket.emit('tracking-room-error', { orderId: String(orderId), error: 'FORBIDDEN' });
                    return;
                }

                // Join tracking room for Mongo _id, string orderId, and the raw requested orderId
                if (order._id) socket.join(roomNames.tracking(order._id));
                if (order.orderId) socket.join(roomNames.tracking(order.orderId));
                socket.join(roomNames.tracking(orderId));

                logger.info(`Socket ${socket.id} (${role}:${userId}) joined tracking rooms for ${order._id}`);
                socket.emit('tracking-room-joined', { room: roomNames.tracking(order._id), orderId: String(orderId) });
            } catch (err) {
                logger.error(`join-tracking failed: ${err.message}`);
                socket.emit('tracking-room-error', { orderId: String(orderId), error: 'INTERNAL' });
            }
        });

        // Delivery partner emits live GPS location for an active order.
        // Broadcasts to the tracking room so users see the bike move in real time.
        const _lastLocationBroadcast = {};
        socket.on('update-location', async (data) => {
            if (socket.user?.role !== 'DELIVERY_PARTNER') return;
            if (!data || !data.orderId) return;

            const lat = Number(data.lat);
            const lng = Number(data.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

            const heading = Number.isFinite(Number(data.heading)) ? Number(data.heading) : 0;
            const speed = Number.isFinite(Number(data.speed)) ? Number(data.speed) : 0;
            const accuracy = Number.isFinite(Number(data.accuracy)) ? Number(data.accuracy) : null;

            // Authorization: partner may only update location for their assigned order
            let order = null;
            try {
                const { FoodOrder } = await import('../modules/food/orders/models/order.model.js');
                if (mongoose.Types.ObjectId.isValid(data.orderId)) {
                    order = await FoodOrder.findById(data.orderId)
                        .select('dispatch.deliveryPartnerId dispatch.status userId restaurantId orderId')
                        .lean();
                }
                if (!order) {
                    order = await FoodOrder.findOne({ orderId: String(data.orderId) })
                        .select('dispatch.deliveryPartnerId dispatch.status userId restaurantId orderId')
                        .lean();
                }

                const allowed = canDeliveryPartnerUpdateOrderLocation({
                    role: 'DELIVERY_PARTNER',
                    partnerId: userId,
                    orderDispatchPartnerId: order?.dispatch?.deliveryPartnerId,
                    dispatchStatus: order?.dispatch?.status,
                });
                if (!allowed) {
                    socket.emit('tracking-room-error', {
                        orderId: String(data.orderId),
                        error: 'FORBIDDEN',
                        message: 'Not assigned to this order',
                    });
                    return;
                }
            } catch (err) {
                logger.error(`update-location authz failed: ${err.message}`);
                return;
            }

            // Throttle: max one broadcast per 1s per orderId for smooth 60fps ride
            const now = Date.now();
            const lastTS = _lastLocationBroadcast[data.orderId] || 0;
            if (now - lastTS < 1000) return;
            _lastLocationBroadcast[data.orderId] = now;

            const payload = {
                orderId: String(data.orderId),
                orderMongoId: order?._id ? String(order._id) : undefined,
                deliveryPartnerId: String(userId),
                lat,
                lng,
                boy_lat: lat,
                boy_lng: lng,
                riderLocation: [lat, lng],
                heading,
                speed,
                accuracy,
                status: data.status || 'on_the_way',
                polyline: data.polyline || undefined,
                eta: data.eta || undefined,
                timestamp: now
            };

            logDeliverySocket('Location update received', {
                socketId: socket.id,
                deliveryPartnerId: String(userId),
                orderId: String(data.orderId),
                lat,
                lng,
                status: data.status || 'on_the_way',
            });

            // Broadcast to tracking rooms for mongo ID, string ID, and raw parameter
            if (order?._id) socket.to(roomNames.tracking(order._id)).emit('location-update', payload);
            if (order?.orderId) socket.to(roomNames.tracking(order.orderId)).emit('location-update', payload);
            socket.to(roomNames.tracking(data.orderId)).emit('location-update', payload);

            // Also emit to the specific user and restaurant room
            if (order?.userId || data.userId) {
                socket.to(roomNames.user(order?.userId || data.userId)).emit('location-update', payload);
            }

            if (order?.restaurantId || data.restaurantId) {
                socket.to(roomNames.restaurant(order?.restaurantId || data.restaurantId)).emit('location-update', payload);
            }

            // ─── Scalable Persistence (BullMQ + Redis "Hot" Buffering) ───
            try {
                const { getTrackingQueue } = await import('../queues/index.js');
                const { getRedisClient } = await import('../config/redis.js');
                const trackingQueue = getTrackingQueue();
                const redis = getRedisClient();

                if (trackingQueue && redis) {
                    const coordString = JSON.stringify({ lat, lng, timestamp: now });
                    
                    // 1. Immediately buffer the newest location in high-speed Redis Hash (HOT storage)
                    await Promise.all([
                        redis.hSet('rider:locations:hot', String(userId), coordString),
                        redis.hSet('order:locations:hot', String(data.orderId), coordString)
                    ]);

                    // 2. Schedule a deferred MongoDB write (COLD storage)
                    // jobId debulks updates: if a job is already waiting, BullMQ ignores the new add()
                    // Delay (30s) ensures we don't spam MongoDB while the rider is moving fast
                    const syncJobId = `sync:loc:${data.orderId}`;
                    trackingQueue.add('sync-hot-locations', 
                        { userId, orderId: data.orderId }, 
                        { jobId: syncJobId, delay: 30000, removeOnComplete: true }
                    ).catch(e => logger.error(`BullMQ sync schedule failed: ${e.message}`));
                }
            } catch (err) {
                logger.error(`Real-time persistence layer error: ${err.message}`);
            }

            // ─── Firebase Realtime Database Sync (Cost Optimization) ───
            try {
                const db = getFirebaseDB();
                if (db) {
                    // 1. Update order-specific tracking node
                    const orderRef = db.ref(`active_orders/${data.orderId}`);
                    orderRef.update({
                        lat,
                        lng,
                        boy_lat: lat,
                        boy_lng: lng,
                        heading,
                        speed,
                        accuracy,
                        last_updated: now,
                        status: data.status || 'on_the_way'
                    }).catch(e => logger.error(`Firebase orderRef update error: ${e.message}`));

                    // 2. Update global delivery boy status node
                    const boyRef = db.ref(`delivery_boys/${userId}`);
                    boyRef.update({
                        lat,
                        lng,
                        accuracy,
                        last_updated: now,
                        status: 'online'
                    }).catch(e => logger.error(`Firebase boyRef update error: ${e.message}`));
                }
            } catch (err) {
                // Silently skip if Firebase not initialized yet
                logger.debug(`Firebase RTDB sync skipped: ${err.message}`);
            }
        });

        // Leave tracking room on user navigation away.
        socket.on('leave-tracking', (orderId) => {
            if (!orderId) return;
            const room = roomNames.tracking(orderId);
            socket.leave(room);
        });

        socket.on('disconnect', () => {
            import('./metrics.js').then((m) => m.incrementSocketConnections(-1)).catch(() => {});
            logger.info(`Socket client disconnected: ${socket.id}`);
        });

        // 🆕 Resync State on Reconnect
        socket.on('resync', async () => {
          try {
            if (role === 'DELIVERY_PARTNER') {
              logDeliverySocket('Resync requested', {
                socketId: socket.id,
                deliveryPartnerId: String(userId || ''),
              });
            }
            const { resyncState } = await import('../modules/food/orders/services/order.service.js');
            const state = await resyncState(userId, role);
            if (state.activeOrder) {
              const eventName = role === 'USER' ? 'order_state' : 'active_order';
              socket.emit(eventName, state.activeOrder);
              if (role === 'DELIVERY_PARTNER') {
                logDeliverySocket('Resync emitted active order', {
                  socketId: socket.id,
                  deliveryPartnerId: String(userId || ''),
                  orderId: String(
                    state.activeOrder?.orderId ||
                    state.activeOrder?.orderMongoId ||
                    ''
                  ),
                  eventName,
                });
              }
              
              // Re-emit OTP if user is in drop phase
              if (role === 'USER' && state.activeOrder.handoverOtp) {
                socket.emit('delivery_drop_otp', {
                  orderId: state.activeOrder.orderId,
                  otp: state.activeOrder.handoverOtp,
                  message: 'Share this OTP with your delivery partner.'
                });
              }
            }
            socket.emit('resync_complete', { timestamp: Date.now() });
            if (role === 'DELIVERY_PARTNER') {
              logDeliverySocket('Resync complete', {
                socketId: socket.id,
                deliveryPartnerId: String(userId || ''),
                hasActiveOrder: Boolean(state.activeOrder),
              });
            }
          } catch (err) {
            logger.error(`Resync failed for ${role}:${userId} — ${err.message}`);
          }
        });
    });

    logger.info('Socket.IO infrastructure initialized');
    return io;
};

/**
 * Returns the initialized Socket.IO instance.
 * @returns {Server | null}
 */
export const getIO = () => {
    if (!io) {
        logger.warn('Socket.IO not initialized');
    }
    return io;
};

export const rooms = roomNames;
