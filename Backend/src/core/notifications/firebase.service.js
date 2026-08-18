import crypto from 'crypto';
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

    // dataOnly: omit system notification blocks ONLY if caller explicitly requested silent background sync.
    // For killed/closed app delivery (Android/iOS/Web), top-level `notification` block MUST be included.
    const message = { token };
    const isWeb = platform === 'web';
    const isDataOnly = payload.dataOnly === true;
    const androidChannel = sanitizeString(payload.channelId) || 'high_importance_channel';

    if (!isDataOnly) {
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
        ...(isDataOnly
            ? {}
            : {
                notification: {
                    channel_id: androidChannel,
                    sound: soundFile,
                    default_vibrate_timings: true,
                    default_light_settings: true,
                    notification_priority: 'PRIORITY_HIGH',
                    ...(image ? { image } : {}),
                },
            }),
    };

    message.apns = {
        headers: {
            'apns-priority': '10',
            'apns-push-type': isDataOnly ? 'background' : 'alert',
            'apns-expiration': String(Math.floor(Date.now() / 1000) + 86400),
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
        },
        ...(isDataOnly
            ? {}
            : {
                notification: {
                    title: notification.title,
                    body: notification.body,
                    ...(image ? { image, icon: image } : {}),
                },
            }),
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

    const results = await Promise.all(
        uniqueTokens.map(async (token) => {
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
                    return {
                        token,
                        ok: false,
                        remove: shouldRemoveTokenFromError(errorJson, response),
                        error: errorJson?.error?.message || `FCM send failed (${response.status})`
                    };
                }

                return {
                    token,
                    ok: true,
                    response: await response.json()
                };
            } catch (error) {
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
        // Retrieve tokens for requested platform or combine all tokens if platform is undefined
        const rawTokens = await listOwnerTokens({ ownerType, ownerId, platform });
        
        // Deduplicate token list strictly so no single FCM device token receives duplicate notifications
        const targetTokens = normalizeTokenList(rawTokens);

        if (!targetTokens.length) {
            logger.warn(`[FCM] No device tokens for ${ownerType}:${ownerId} — push skipped`);
            return { successCount: 0, failureCount: 0, results: [] };
        }

        // Single dispatch call to FCM with deduplicated tokens
        const response = await sendPushNotification(targetTokens, enrichedPayload, { platform });

        // Clean up any stale or unregistered tokens across both web and mobile fields
        const invalidTokens = (response.results || [])
            .filter((item) => !item.ok && item.remove)
            .map((item) => item.token)
            .filter(Boolean);

        if (invalidTokens.length > 0) {
            const model = getOwnerModel(ownerType);
            const doc = model ? await model.findById(ownerId) : null;
            if (doc) {
                doc.fcmTokens = normalizeTokenList(
                    (Array.isArray(doc.fcmTokens) ? doc.fcmTokens : []).filter((t) => !invalidTokens.includes(t))
                );
                doc.fcmTokenMobile = normalizeTokenList(
                    (Array.isArray(doc.fcmTokenMobile) ? doc.fcmTokenMobile : []).filter((t) => !invalidTokens.includes(t))
                );
                await doc.save();
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

        let allTokens = [];

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
                    const tokens = readTokensFromDoc(doc);
                    if (tokens.length > 0) allTokens.push(...tokens);
                }
            }
        }

        allTokens = [...new Set(allTokens.filter(Boolean))];
        logger.info(`[FCM Broadcast] Resolved ${allTokens.length} unique tokens. Dispatching to Firebase...`);

        // 2. Dispatch to FCM in controlled chunks
        // Firebase HTTP v1 limits: we do 50 concurrent fetch requests to avoid socket hang ups.
        const CHUNK_SIZE = 50;
        let successCount = 0;
        let failureCount = 0;

        for (let i = 0; i < allTokens.length; i += CHUNK_SIZE) {
            const chunk = allTokens.slice(i, i + CHUNK_SIZE);
            const res = await sendPushNotification(chunk, payload);
            successCount += res.successCount || 0;
            failureCount += res.failureCount || 0;
            
            // Artificial delay to prevent overwhelming network interfaces on huge broadcasts
            if (i + CHUNK_SIZE < allTokens.length) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        logger.info(`[FCM Broadcast] Completed. Success=${successCount}, Failure=${failureCount}`);
        return { successCount, failureCount };
    } catch (error) {
        logger.error(`[FCM Broadcast] Critical failure during bulk push: ${error.message}`);
        return { successCount: 0, failureCount: 0, error: error.message };
    }
};
