import crypto from 'crypto';
import { getCachedNotificationIcon } from './notificationBranding.service.js';
import { FoodNotificationDispatch } from './models/notificationDispatch.model.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import mongoose from 'mongoose';
import { FoodUser } from '../users/user.model.js';
import { FoodRestaurant } from '../../modules/food/restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../modules/food/delivery/models/deliveryPartner.model.js';
import { FoodAdmin } from '../admin/admin.model.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const FIREBASE_MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SEND_URL = (projectId) =>
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
const OWNER_MODELS = {
    USER: FoodUser,
    RESTAURANT: FoodRestaurant,
    DELIVERY_PARTNER: FoodDeliveryPartner,
    ADMIN: FoodAdmin
};
const OWNER_TOKEN_FIELDS = {
    web: 'fcmTokens',
    mobile: 'fcmTokenMobile'
};

let cachedAccessToken = null;
let cachedAccessTokenExpiryMs = 0;
let cachedServiceAccount = null;

const sanitizeString = (value) => String(value ?? '').trim();

// In-memory sliding TTL idempotency cache for push notifications (per deviceToken + eventKey)
const PUSH_IDEMPOTENCY_TTL_MS = 120_000;
const pushIdempotencyCache = new Map();

export const clearPushIdempotencyCache = () => {
    pushIdempotencyCache.clear();
};

export const isPushRecentlyDispatched = (token, eventKey) => {
    if (!token || !eventKey) return false;
    const key = `${token}::${eventKey}`;
    const timestamp = pushIdempotencyCache.get(key);
    if (!timestamp) return false;
    if (Date.now() - timestamp > PUSH_IDEMPOTENCY_TTL_MS) {
        pushIdempotencyCache.delete(key);
        return false;
    }
    return true;
};

/**
 * Atomically claims (token, eventKey) so exactly one push per device per event
 * goes out. The in-memory map is the fast path; the unique index on
 * food_notification_dispatches is the authority, so a retry, a duplicated
 * caller, or a second API instance cannot re-send the same event.
 * Returns true when the caller owns the dispatch.
 */
const claimPushDispatch = async (token, eventKey) => {
    if (!token || !eventKey) return true;
    if (isPushRecentlyDispatched(token, eventKey)) return false;
    markPushDispatched(token, eventKey);

    try {
        await FoodNotificationDispatch.create({ eventKey, token });
        return true;
    } catch (error) {
        if (error?.code === 11000) return false;
        // Storage unavailable — the in-memory guard above still holds for this instance.
        logger.warn(`[FCM] Dispatch claim persistence failed (${error?.message || error})`);
        return true;
    }
};

/**
 * Releases a claim when the send never reached the device, so a later retry of
 * the same event is still allowed to deliver it once.
 */
const releasePushDispatch = async (token, eventKey) => {
    if (!token || !eventKey) return;
    pushIdempotencyCache.delete(`${token}::${eventKey}`);
    try {
        await FoodNotificationDispatch.deleteOne({ eventKey, token });
    } catch {
        // Best effort only.
    }
};

const markPushDispatched = (token, eventKey) => {
    if (!token || !eventKey) return;
    const key = `${token}::${eventKey}`;
    pushIdempotencyCache.set(key, Date.now());

    // Prune stale cache entries if cache size grows large
    if (pushIdempotencyCache.size > 2000) {
        const now = Date.now();
        for (const [k, ts] of pushIdempotencyCache.entries()) {
            if (now - ts > PUSH_IDEMPOTENCY_TTL_MS) {
                pushIdempotencyCache.delete(k);
            }
        }
    }
};

export const deriveEventKey = (payload = {}) => {
    if (payload?.idempotencyKey) return String(payload.idempotencyKey).trim();
    if (payload?.eventId) return String(payload.eventId).trim();

    const data = payload?.data || {};
    if (data.idempotencyKey) return String(data.idempotencyKey).trim();
    if (data.eventId) return String(data.eventId).trim();
    if (data.notificationId) return String(data.notificationId).trim();
    if (data.broadcastId) return `broadcast:${data.broadcastId}`;

    const orderMongoId = String(data.orderMongoId || data.order_mongo_id || '').trim();
    const orderId = String(data.orderId || data.order_id || '').trim();
    const type = String(data.type || data.notificationType || '').trim();
    const orderStatus = String(data.orderStatus || data.status || '').trim();

    if (orderMongoId || orderId) {
        const primaryId = orderMongoId || orderId;
        if (type) {
            return `order:${type}:${primaryId}${orderStatus ? `:${orderStatus}` : ''}`;
        }
        return `order:${primaryId}${orderStatus ? `:${orderStatus}` : ''}`;
    }

    const title = stripOwnerTitlePrefix(payload?.title || payload?.notification?.title || '');
    const body = sanitizeString(payload?.body || payload?.notification?.body || '');
    const link = resolveClickLink(payload, data);

    if (type || title || body) {
        return `msg:${type}:${title}:${body}:${link}`;
    }

    return null;
};

const toBase64Url = (input) =>
    Buffer.from(JSON.stringify(input))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

const normalizePrivateKey = (key) => String(key || '').replace(/\\n/g, '\n').trim();

const getServiceAccountFromEnv = () => {
    if (cachedServiceAccount) return cachedServiceAccount;

    const rawJson = sanitizeString(config.firebaseServiceAccount || process.env.FIREBASE_SERVICE_ACCOUNT);
    if (rawJson) {
        cachedServiceAccount = JSON.parse(rawJson);
        return cachedServiceAccount;
    }

    const pathValue = sanitizeString(config.firebaseServiceAccountPath || process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    if (pathValue) {
        const filePath = resolve(process.cwd(), pathValue);
        if (existsSync(filePath)) {
            cachedServiceAccount = JSON.parse(readFileSync(filePath, 'utf8'));
            return cachedServiceAccount;
        }
    }

    throw new Error('Firebase service account is not configured. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH.');
};

const getFirebaseProjectId = () => {
    const account = getServiceAccountFromEnv();
    const projectId =
        sanitizeString(config.firebaseProjectId) ||
        sanitizeString(account.project_id) ||
        sanitizeString(process.env.FIREBASE_PROJECT_ID);
    if (!projectId) {
        throw new Error('Firebase project ID is not configured.');
    }
    return projectId;
};

const getFirebaseAccessToken = async () => {
    const now = Date.now();
    if (cachedAccessToken && cachedAccessTokenExpiryMs - now > 60_000) {
        return cachedAccessToken;
    }

    const account = getServiceAccountFromEnv();
    const privateKey = normalizePrivateKey(account.private_key);
    if (!account.client_email || !privateKey) {
        throw new Error('Firebase service account is missing client_email or private_key.');
    }

    const iat = Math.floor(now / 1000);
    const exp = iat + 3600;
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: account.client_email,
        scope: FIREBASE_MESSAGING_SCOPE,
        aud: OAUTH_TOKEN_URL,
        iat,
        exp
    };

    const jwtUnsigned = `${toBase64Url(header)}.${toBase64Url(payload)}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(jwtUnsigned);
    signer.end();
    const signature = signer.sign(privateKey, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const assertion = `${jwtUnsigned}.${signature}`;

    const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
    });

    const response = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Firebase OAuth token exchange failed (${response.status}): ${text}`);
    }

    const json = await response.json();
    cachedAccessToken = json.access_token;
    cachedAccessTokenExpiryMs = now + ((Number(json.expires_in) || 3600) * 1000);
    return cachedAccessToken;
};

const normalizeDataMap = (data = {}) => {
    const result = {};
    for (const [key, value] of Object.entries(data || {})) {
        if (value === undefined || value === null) continue;
        result[String(key)] = String(value);
    }
    return result;
};

const stripOwnerTitlePrefix = (title = '') =>
    sanitizeString(title)
        .replace(/^[👤🏪🛵🛡️]\s*/, '')
        .replace(/^\[(User|Shop|Rider|Admin)\]\s*/i, '')
        .trim();

const resolveClickLink = (payload = {}, data = {}) => {
    const raw =
        sanitizeString(payload.link) ||
        sanitizeString(data.link) ||
        sanitizeString(data.targetUrl) ||
        sanitizeString(data.click_action) ||
        '/';
    return raw || '/';
};

const buildMessagePayload = (payload = {}, token, { platform } = {}) => {
    const notification = {
        title:
            stripOwnerTitlePrefix(payload.title || payload.notification?.title) ||
            'New notification',
        body: sanitizeString(payload.body || payload.notification?.body || '')
    };
    const clickLink = resolveClickLink(payload, payload.data || {});
    const data = normalizeDataMap({
        ...(payload.data || {}),
        // Always mirror title/body in data so native/web handlers can show tray UI if needed
        title: notification.title,
        body: notification.body,
        link: clickLink,
        click_action: clickLink,
        targetUrl: sanitizeString(payload.data?.targetUrl) || clickLink,
    });
    const image =
        sanitizeString(payload.icon || payload.notification?.image || payload.notification?.icon || data.image || data.imageUrl);

    // The web service worker cannot read admin settings, so the branded icon
    // travels in the data map. Left empty when nothing is configured, and the
    // client then falls back to its bundled icon.
    if (!data.icon) {
        const brandIcon = getCachedNotificationIcon();
        if (brandIcon) data.icon = brandIcon;
    }

    const eventKey = deriveEventKey(payload);
    const collapseRaw = sanitizeString(
        payload.collapseKey ||
        payload.tag ||
        payload.data?.tag ||
        payload.idempotencyKey ||
        payload.eventId ||
        payload.data?.eventId ||
        eventKey ||
        ''
    );
    const collapseKey = collapseRaw ? collapseRaw.replace(/[^a-zA-Z0-9-_.~%]/g, '_').slice(0, 64) : undefined;
    const tag = sanitizeString(payload.tag || payload.data?.tag || collapseKey || '');

    // dataOnly: omit system notification blocks ONLY if caller explicitly requested silent background sync.
    // For killed/closed app delivery (Android/iOS), top-level `notification` block MUST be included.
    const message = { token };
    const isWeb = platform === 'web';
    const isDataOnly = payload.dataOnly === true;
    const androidChannel = sanitizeString(payload.channelId) || 'high_importance_channel';

    // Web is deliberately data-only. When a web push carries a `notification`
    // block the FCM JS SDK renders an OS banner itself *and* still invokes the
    // app's onBackgroundMessage handler, which renders a second banner — one
    // event, two notifications on the device. Keeping web data-only leaves
    // rendering solely to firebase-messaging-sw.js, which reads the title/body
    // mirrored into `data` below.
    const includeNotificationBlock = !isDataOnly && !isWeb;

    if (includeNotificationBlock) {
        message.notification = { ...notification };
        if (image) {
            message.notification.image = image;
        }
    }

    if (Object.keys(data).length > 0) {
        message.data = data;
    }

    const soundFile = payload.sound || 'default';

    message.android = {
        priority: 'high',
        ttl: '86400s',
        ...(collapseKey ? { collapse_key: collapseKey } : {}),
        ...(isDataOnly
            ? {}
            : {
                notification: {
                    channel_id: androidChannel,
                    sound: soundFile,
                    default_vibrate_timings: true,
                    default_light_settings: true,
                    notification_priority: 'PRIORITY_HIGH',
                    ...(tag ? { tag } : {}),
                    ...(image ? { image } : {}),
                },
            }),
    };

    message.apns = {
        headers: {
            'apns-priority': '10',
            'apns-push-type': isDataOnly ? 'background' : 'alert',
            'apns-expiration': String(Math.floor(Date.now() / 1000) + 86400),
            ...(collapseKey ? { 'apns-collapse-id': collapseKey } : {}),
        },
        payload: {
            aps: isDataOnly
                ? {
                    'content-available': 1,
                }
                : {
                    alert: {
                        title: notification.title,
                        body: notification.body,
                    },
                    sound: soundFile,
                    badge: 1,
                    'content-available': 1,
                    'mutable-content': 1,
                },
        },
    };

    let webLink = clickLink;
    try {
        if (webLink.startsWith('/')) {
            const origin = sanitizeString(
                payload.webOrigin ||
                    process.env.FRONTEND_URL ||
                    process.env.CLIENT_URL ||
                    process.env.APP_URL ||
                    ''
            ).replace(/\/$/, '');
            if (origin) webLink = `${origin}${webLink}`;
        }
    } catch {
        // keep relative
    }

    message.webpush = {
        headers: {
            Urgency: 'high',
            TTL: '86400',
            ...(collapseKey ? { Topic: collapseKey.replace(/[^a-zA-Z0-9-_.~%]/g, '_').slice(0, 32) } : {}),
        },
        // No `notification` here on purpose — see includeNotificationBlock above.
        fcm_options: {
            link: webLink || '/',
        },
    };

    return message;
};

const parseFirebaseError = async (response) => {
    try {
        return await response.json();
    } catch {
        try {
            const text = await response.text();
            return { error: { message: text } };
        } catch {
            return { error: { message: 'Unknown Firebase error' } };
        }
    }
};

const shouldRemoveTokenFromError = (errorJson, response) => {
    const status = response?.status;
    const message = String(errorJson?.error?.message || '').toUpperCase();
    return status === 404 || message.includes('UNREGISTERED') || message.includes('INVALID_ARGUMENT');
};

const getOwnerModel = (ownerType) => OWNER_MODELS[String(ownerType || '').toUpperCase()] || null;

const getTokenFieldForPlatform = (platform) => OWNER_TOKEN_FIELDS[platform === 'mobile' ? 'mobile' : 'web'];

const normalizeTokenList = (tokens = []) => {
    const normalized = [...new Set((Array.isArray(tokens) ? tokens : [tokens]).map(sanitizeString).filter(Boolean))];
    return normalized.slice(-10);
};

// pickLatestTokenOnly removed as we want to push to all active devices of a user

const readTokensFromDoc = (doc, platform) => {
    if (!doc) return [];
    if (platform) {
        return normalizeTokenList(doc[getTokenFieldForPlatform(platform)] || []);
    }
    return normalizeTokenList([
        ...(Array.isArray(doc.fcmTokens) ? doc.fcmTokens : []),
        ...(Array.isArray(doc.fcmTokenMobile) ? doc.fcmTokenMobile : [])
    ]);
};

export const listOwnerTokens = async ({ ownerType, ownerId, platform }) => {
    if (!ownerType || !ownerId) return [];
    const model = getOwnerModel(ownerType);
    if (!model) return [];
    const doc = await model.findById(ownerId).select('fcmTokens fcmTokenMobile').lean();
    return readTokensFromDoc(doc, platform);
};

export const upsertFirebaseDeviceToken = async ({ ownerType, ownerId, token, platform = 'web' }) => {
    try {
        const normalizedToken = sanitizeString(token);
        if (!ownerType || !ownerId || !normalizedToken) {
            throw new Error('ownerType, ownerId, and token are required.');
        }

        const normalizedPlatform = platform === 'mobile' ? 'mobile' : 'web';
        const model = getOwnerModel(ownerType);
        if (!model) {
            throw new Error(`Unsupported owner type: ${ownerType}`);
        }

        if (!mongoose.Types.ObjectId.isValid(ownerId)) {
            throw new Error(`Invalid owner ID: ${ownerId}`);
        }

        const doc = await model.findById(ownerId);
        if (!doc) {
            throw new Error('Owner profile not found.');
        }

        const targetField = getTokenFieldForPlatform(normalizedPlatform);
        const otherField = getTokenFieldForPlatform(normalizedPlatform === 'mobile' ? 'web' : 'mobile');

        let isModified = false;

        // 1. Remove this token from the other platform array to prevent cross-contamination / duplicate notifications
        const otherTokens = Array.isArray(doc[otherField]) ? doc[otherField] : [];
        if (otherTokens.includes(normalizedToken)) {
            doc[otherField] = normalizeTokenList(otherTokens.filter((t) => t !== normalizedToken));
            isModified = true;
        }

        // 2. Add to target field if not already present
        const existingTokens = Array.isArray(doc[targetField]) ? doc[targetField] : [];
        if (!existingTokens.includes(normalizedToken)) {
            doc[targetField] = normalizeTokenList([...existingTokens, normalizedToken]);
            isModified = true;
        }

        if (isModified) {
            await doc.save();
        }

        return { success: true };
    } catch (error) {
        throw error;
    }
};

export const removeFirebaseDeviceToken = async ({ ownerType, ownerId, token, platform }) => {
    const normalizedToken = sanitizeString(token);
    if (!ownerType || !ownerId || !normalizedToken) {
        throw new Error('ownerType, ownerId, and token are required.');
    }
    const model = getOwnerModel(ownerType);
    if (!model) {
        throw new Error(`Unsupported owner type: ${ownerType}`);
    }
    const doc = await model.findById(ownerId);
    if (!doc) {
        return { success: false };
    }

    if (platform) {
        const field = getTokenFieldForPlatform(platform);
        doc[field] = normalizeTokenList((Array.isArray(doc[field]) ? doc[field] : []).filter((t) => t !== normalizedToken));
    } else {
        doc.fcmTokens = normalizeTokenList((Array.isArray(doc.fcmTokens) ? doc.fcmTokens : []).filter((t) => t !== normalizedToken));
        doc.fcmTokenMobile = normalizeTokenList(
            (Array.isArray(doc.fcmTokenMobile) ? doc.fcmTokenMobile : []).filter((t) => t !== normalizedToken)
        );
    }

    await doc.save();
    return { success: true };
};

export const sendPushNotification = async (tokens, payload = {}, { platform } = {}) => {
    const projectId = getFirebaseProjectId();
    const accessToken = await getFirebaseAccessToken();
    const uniqueTokens = normalizeTokenList(tokens);

    if (uniqueTokens.length === 0) {
        return { successCount: 0, failureCount: 0, results: [] };
    }

    const eventKey = deriveEventKey(payload);

    const results = await Promise.all(
        uniqueTokens.map(async (token) => {
            // Claim before sending so concurrent callers (or a second instance)
            // cannot both dispatch the same event to the same device.
            const claimed = await claimPushDispatch(token, eventKey);
            if (!claimed) {
                logger.info(`[FCM] Duplicate push skipped for token ${token.slice(0, 10)}... and eventKey: ${eventKey}`);
                return {
                    token,
                    ok: true,
                    skippedDuplicate: true
                };
            }

            const message = buildMessagePayload(payload, token, { platform });
            try {
                const response = await fetch(FCM_SEND_URL(projectId), {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ message })
                });

                if (!response.ok) {
                    const errorJson = await parseFirebaseError(response);
                    const remove = shouldRemoveTokenFromError(errorJson, response);
                    // Nothing was delivered — free the claim so a retry can still
                    // deliver this event once (unless the token itself is dead).
                    if (!remove) await releasePushDispatch(token, eventKey);
                    return {
                        token,
                        ok: false,
                        remove,
                        error: errorJson?.error?.message || `FCM send failed (${response.status})`
                    };
                }

                return {
                    token,
                    ok: true,
                    response: await response.json()
                };
            } catch (error) {
                await releasePushDispatch(token, eventKey);
                return {
                    token,
                    ok: false,
                    remove: false,
                    error: error?.message || String(error)
                };
            }
        })
    );

    const successCount = results.filter((result) => result.ok).length;
    const failureCount = results.length - successCount;
    return { successCount, failureCount, results };
};

export const sendNotificationToOwner = async ({ ownerType, ownerId, payload, platform } = {}) => {
    // Clone payload so broadcast loops don't mutate a shared object
    const enrichedPayload = { ...payload };

    try {
        const model = getOwnerModel(ownerType);
        const doc = model ? await model.findById(ownerId).select('fcmTokens fcmTokenMobile').lean() : null;

        // Group tokens by their real platform. `platform` must be concrete when the
        // message is built: web pushes are data-only (the service worker renders
        // them), mobile pushes carry a notification block — sending one blended
        // batch would give web devices both renderers and duplicate the banner.
        const requestedPlatform = platform === 'mobile' || platform === 'web' ? platform : null;
        const groups = (requestedPlatform ? [requestedPlatform] : ['web', 'mobile']).map(
            (groupPlatform) => ({ platform: groupPlatform, tokens: readTokensFromDoc(doc, groupPlatform) })
        );

        // Deduplicate strictly across groups so no single device token is sent to twice.
        const seenTokens = new Set();
        const platformGroups = groups
            .map(({ platform: groupPlatform, tokens }) => ({
                platform: groupPlatform,
                tokens: tokens.filter((token) => {
                    if (seenTokens.has(token)) return false;
                    seenTokens.add(token);
                    return true;
                })
            }))
            .filter((group) => group.tokens.length > 0);

        if (!platformGroups.length) {
            logger.warn(`[FCM] No device tokens for ${ownerType}:${ownerId} — push skipped`);
            return { successCount: 0, failureCount: 0, results: [] };
        }

        // One dispatch call per platform, each with deduplicated tokens.
        const groupResponses = await Promise.all(
            platformGroups.map((group) =>
                sendPushNotification(group.tokens, enrichedPayload, { platform: group.platform })
            )
        );

        const response = groupResponses.reduce(
            (acc, item) => ({
                successCount: acc.successCount + (item.successCount || 0),
                failureCount: acc.failureCount + (item.failureCount || 0),
                results: acc.results.concat(item.results || [])
            }),
            { successCount: 0, failureCount: 0, results: [] }
        );

        // Clean up any stale or unregistered tokens across both web and mobile fields
        const invalidTokens = (response.results || [])
            .filter((item) => !item.ok && item.remove)
            .map((item) => item.token)
            .filter(Boolean);

        if (invalidTokens.length > 0) {
            const ownerDoc = model ? await model.findById(ownerId) : null;
            if (ownerDoc) {
                ownerDoc.fcmTokens = normalizeTokenList(
                    (Array.isArray(ownerDoc.fcmTokens) ? ownerDoc.fcmTokens : []).filter((t) => !invalidTokens.includes(t))
                );
                ownerDoc.fcmTokenMobile = normalizeTokenList(
                    (Array.isArray(ownerDoc.fcmTokenMobile) ? ownerDoc.fcmTokenMobile : []).filter((t) => !invalidTokens.includes(t))
                );
                await ownerDoc.save();
            }
        }

        console.log(
            `[FCM] Sending to ${ownerType}:${ownerId}. Title: "${enrichedPayload.title || 'Data Only'}" success=${response.successCount} failure=${response.failureCount}`
        );
        logger.info(
            `FCM push sent to ${ownerType}:${ownerId} (${platform || 'all'}). Success=${response.successCount}, Failure=${response.failureCount}`
        );

        return response;
    } catch (error) {
        logger.warn(`FCM push failed for ${ownerType}:${ownerId}: ${error.message}`);
        return { successCount: 0, failureCount: 1, error: error.message };
    }
};

export const sendNotificationToOwners = async (targets = [], payload = {}) => {
    // 🔍 Deduplicate targets by ownerType:ownerId before sending
    // This prevents duplicate notifications if the same person is listed twice (e.g. as USER and partner)
    const uniqueTargets = Array.isArray(targets)
        ? [...new Map(targets.filter(t => t?.ownerType && t?.ownerId).map(t => [`${t.ownerType}:${t.ownerId}`, t])).values()]
        : [];

    const results = [];
    // Chunking to avoid overwhelming the event loop during large broadcasts
    const CHUNK_SIZE = 50;
    for (let i = 0; i < uniqueTargets.length; i += CHUNK_SIZE) {
        const chunk = uniqueTargets.slice(i, i + CHUNK_SIZE);
        const chunkResults = await Promise.all(
            chunk.map((target) =>
                sendNotificationToOwner({
                    ownerType: target.ownerType,
                    ownerId: target.ownerId,
                    platform: target.platform,
                    payload
                })
            )
        );
        results.push(...chunkResults);
    }
    return results;
};

export const notifyAdminsSafely = async (payload = {}) => {
    try {
        const admins = await FoodAdmin.find({ isActive: true }).select('_id').lean();
        if (!admins.length) return [];

        const targets = admins.map(a => ({
            ownerType: 'ADMIN',
            ownerId: String(a._id)
        }));

        return await sendNotificationToOwners(targets, payload);
    } catch (e) {
        logger.error(`Error notifying admins: ${e.message}`);
        return [];
    }
};

export const sendTestNotification = async ({ ownerType, ownerId, platform }) => {
    return sendNotificationToOwner({
        ownerType,
        ownerId,
        platform,
        payload: {
            title: 'Test Notification',
            body: 'This is a test notification from Firebase push',
            data: {
                type: 'test',
                link: '/'
            }
        }
    });
};
export const notifyOwnerSafely = async (target = {}, payload = {}) => {
    try {
        return await sendNotificationToOwner({ ...target, payload });
    } catch (error) {
        logger.warn(`FCM individual push failed: ${error.message}`);
        return null;
    }
};

export const notifyOwnersSafely = async (targets = [], payload = {}) => {
    try {
        return await sendNotificationToOwners(targets, payload);
    } catch (error) {
        logger.warn(`FCM broadcast push failed: ${error.message}`);
        return [];
    }
};

export const broadcastPushToTargetsSafely = async (targets = [], payload = {}) => {
    try {
        logger.info(`[FCM Broadcast] Starting bulk push to ${targets.length} targets`);
        const uniqueTargets = Array.isArray(targets)
            ? [...new Map(targets.filter(t => t?.ownerType && t?.ownerId).map(t => [`${t.ownerType}:${t.ownerId}`, t])).values()]
            : [];

        const byType = { USER: [], RESTAURANT: [], DELIVERY_PARTNER: [], ADMIN: [] };
        uniqueTargets.forEach(t => {
            const type = t.ownerType?.toUpperCase();
            if (byType[type]) byType[type].push(t.ownerId);
        });

        // Tokens stay grouped by platform: web must be dispatched data-only so the
        // service worker is the single renderer (see buildMessagePayload).
        const tokensByPlatform = { web: [], mobile: [] };

        // 1. Bulk fetch all tokens to avoid N+1 DB queries
        for (const [type, ids] of Object.entries(byType)) {
            if (!ids.length) continue;
            const model = getOwnerModel(type);
            if (!model) continue;

            // Process DB fetches in chunks to avoid massive $in array limits
            const DB_CHUNK = 1000;
            for (let i = 0; i < ids.length; i += DB_CHUNK) {
                const chunkIds = ids.slice(i, i + DB_CHUNK);
                const docs = await model.find({ _id: { $in: chunkIds } }).select('fcmTokens fcmTokenMobile').lean();
                for (const doc of docs) {
                    tokensByPlatform.web.push(...readTokensFromDoc(doc, 'web'));
                    tokensByPlatform.mobile.push(...readTokensFromDoc(doc, 'mobile'));
                }
            }
        }

        // Deduplicate globally so one device token is never sent to twice.
        const seenTokens = new Set();
        const dispatchGroups = ['web', 'mobile'].map((groupPlatform) => ({
            platform: groupPlatform,
            tokens: tokensByPlatform[groupPlatform].filter((token) => {
                if (!token || seenTokens.has(token)) return false;
                seenTokens.add(token);
                return true;
            })
        }));

        logger.info(`[FCM Broadcast] Resolved ${seenTokens.size} unique tokens. Dispatching to Firebase...`);

        // 2. Dispatch to FCM in controlled chunks
        // Firebase HTTP v1 limits: we do 50 concurrent fetch requests to avoid socket hang ups.
        const CHUNK_SIZE = 50;
        let successCount = 0;
        let failureCount = 0;

        for (const group of dispatchGroups) {
            for (let i = 0; i < group.tokens.length; i += CHUNK_SIZE) {
                const chunk = group.tokens.slice(i, i + CHUNK_SIZE);
                const res = await sendPushNotification(chunk, payload, { platform: group.platform });
                successCount += res.successCount || 0;
                failureCount += res.failureCount || 0;

                // Artificial delay to prevent overwhelming network interfaces on huge broadcasts
                if (i + CHUNK_SIZE < group.tokens.length) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
        }

        logger.info(`[FCM Broadcast] Completed. Success=${successCount}, Failure=${failureCount}`);
        return { successCount, failureCount };
    } catch (error) {
        logger.error(`[FCM Broadcast] Critical failure during bulk push: ${error.message}`);
        return { successCount: 0, failureCount: 0, error: error.message };
    }
};
