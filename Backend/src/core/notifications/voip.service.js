import crypto from 'crypto';
import http2 from 'http2';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Apple VoIP (PushKit) pushes that ring an iPhone like a phone call, so a
 * restaurant or rider hears a new order even with the app closed or the phone
 * locked. Sent straight to APNs with token (.p8) auth; FCM cannot send VoIP.
 *
 * This file is only the transport. Who gets a call, and the fallback to the
 * regular push when a call cannot be placed, live in firebase.service.js.
 *
 * Until APNS_TEAM_ID, APNS_KEY_ID, the .p8 file and a topic are all present,
 * isVoipConfigured() is false and every phone keeps getting the regular push.
 */

const APNS_HOST = {
    production: 'https://api.push.apple.com',
    sandbox: 'https://api.sandbox.push.apple.com',
};

// Apple accepts a provider token for up to an hour and rejects refreshes more
// often than every 20 minutes; 50 minutes sits inside both limits.
const JWT_REUSE_SECONDS = 50 * 60;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TOKENS_PER_SEND = 20;

const sanitize = (value) => String(value ?? '').trim().replace(/^["']|["']$/g, '');

const normalizeTopic = (topic) => {
    const value = sanitize(topic);
    if (!value) return '';
    return value.endsWith('.voip') ? value : `${value}.voip`;
};

export const getVoipTopic = (ownerType) => {
    const type = String(ownerType || '').trim().toUpperCase();
    const ownTopic =
        type === 'RESTAURANT' ? config.apnsVoipTopicRestaurant
            : type === 'DELIVERY_PARTNER' ? config.apnsVoipTopicDelivery
                : '';
    return normalizeTopic(ownTopic || config.apnsVoipTopic);
};

const getApnsHost = () => (config.apnsProduction ? APNS_HOST.production : APNS_HOST.sandbox);

let cachedKey = { path: null, pem: null };

/** The .p8 key, read once. Relative paths resolve from the backend folder. */
const readAuthKey = () => {
    const raw = sanitize(config.apnsAuthKeyPath);
    if (!raw) return null;
    const candidates = [
        raw,
        resolve(process.cwd(), raw),
        // Env files written for the repo root say "Backend/AuthKey_x.p8".
        resolve(process.cwd(), raw.replace(/^backend[\\/]/i, '')),
    ];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) return null;
    if (cachedKey.path !== found) {
        cachedKey = { path: found, pem: readFileSync(found, 'utf8') };
    }
    return cachedKey.pem;
};

/** True when a VoIP call can be placed to this owner type's app. */
export const isVoipConfigured = (ownerType) =>
    Boolean(sanitize(config.apnsTeamId) && sanitize(config.apnsKeyId) && getVoipTopic(ownerType) && readAuthKey());

let providerToken = { value: null, issuedAt: 0 };

const getProviderToken = () => {
    const now = Math.floor(Date.now() / 1000);
    if (providerToken.value && now - providerToken.issuedAt < JWT_REUSE_SECONDS) {
        return providerToken.value;
    }
    const pem = readAuthKey();
    if (!pem) throw new Error('APNs auth key (.p8) not found');
    const value = jwt.sign({ iss: sanitize(config.apnsTeamId), iat: now }, pem, {
        algorithm: 'ES256',
        header: { alg: 'ES256', kid: sanitize(config.apnsKeyId) },
    });
    providerToken = { value, issuedAt: now };
    return value;
};

let session = null;

/** One long-lived HTTP/2 connection to APNs, reopened when it closes or the host changes. */
const getSession = () => {
    const host = getApnsHost();
    if (session && !session.closed && !session.destroyed && session.apnsHost === host) {
        return session;
    }
    const next = http2.connect(host);
    next.apnsHost = host;
    const drop = () => {
        if (session === next) session = null;
    };
    next.on('error', (error) => {
        logger.warn(`[VoIP] APNs connection error: ${error?.message || error}`);
        drop();
    });
    next.on('goaway', drop);
    next.on('close', drop);
    // Don't hold the process open just for an idle push connection.
    next.unref?.();
    session = next;
    return next;
};

/**
 * Stable CallKit id for one order call on one account. CallKit needs a UUID,
 * and the same id lets the "end call" push stop exactly this call.
 */
export const buildVoipCallId = (ownerType, ownerId, orderKey) => {
    const hex = crypto
        .createHash('sha1')
        .update(`eatiefy-voip:${String(ownerType).toUpperCase()}:${ownerId}:${orderKey}`)
        .digest('hex');
    // RFC 4122 name-based layout (version 5, variant 10xx).
    const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const stringifyValues = (data = {}) => {
    const out = {};
    for (const [key, value] of Object.entries(data || {})) {
        if (value === undefined || value === null) continue;
        out[key] = typeof value === 'object' ? value : String(value);
    }
    return out;
};

/**
 * The payload the iOS app hands to CallKit. Field names follow
 * flutter_callkit_incoming (id, nameCaller, handle, type, duration, extra);
 * `extra` carries the order data and the link to open on Accept.
 */
const buildCallPayload = (call) => {
    const data = stringifyValues(call.data);
    return {
        // Order data first: the CallKit fields below must win (data.type is "new_order",
        // CallKit's `type` is the call kind; the order's own fields stay in `extra`).
        ...data,
        // VoIP pushes are delivered to the app, never rendered by iOS; aps stays minimal.
        aps: { 'content-available': 1 },
        id: call.callId,
        callId: call.callId,
        type: 0,
        nameCaller: call.title,
        handle: call.body,
        appName: 'Eatiefy',
        duration: call.ringSeconds * 1000,
        textAccept: 'Accept',
        textDecline: 'Decline',
        title: call.title,
        body: call.body,
        extra: {
            ...data,
            callId: call.callId,
            link: call.link,
            ringSeconds: String(call.ringSeconds),
        },
    };
};

const sendOne = (token, topic, body, expiresAtSec) =>
    new Promise((resolveResult) => {
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            resolveResult({ token, ...result });
        };

        let request;
        try {
            request = getSession().request({
                ':method': 'POST',
                ':path': `/3/device/${token}`,
                authorization: `bearer ${getProviderToken()}`,
                'apns-topic': topic,
                'apns-push-type': 'voip',
                'apns-priority': '10',
                // A call that could not be delivered while it was ringing is stale.
                'apns-expiration': String(expiresAtSec),
                'content-type': 'application/json',
            });
        } catch (error) {
            finish({ ok: false, remove: false, error: error?.message || String(error) });
            return;
        }

        let status = 0;
        let responseBody = '';
        request.setEncoding('utf8');
        request.setTimeout(REQUEST_TIMEOUT_MS, () => {
            request.close(http2.constants.NGHTTP2_CANCEL);
            finish({ ok: false, remove: false, error: 'APNs request timed out' });
        });
        request.on('response', (headers) => {
            status = Number(headers[':status'] || 0);
        });
        request.on('data', (chunk) => {
            responseBody += chunk;
        });
        request.on('end', () => {
            if (status >= 200 && status < 300) {
                finish({ ok: true });
                return;
            }
            let reason = '';
            try {
                reason = JSON.parse(responseBody)?.reason || '';
            } catch {
                reason = responseBody;
            }
            // 410: the app was uninstalled. BadDeviceToken: a token from the other
            // APNs environment or another app — it can never receive this call.
            const remove = status === 410 || reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic';
            finish({ ok: false, remove, error: `APNs ${status}${reason ? ` ${reason}` : ''}` });
        });
        request.on('error', (error) => {
            finish({ ok: false, remove: false, error: error?.message || String(error) });
        });
        request.end(JSON.stringify(body));
    });

/**
 * Rings `tokens` with one call. `call` = { callId, title, body, link, ringSeconds, data }.
 * Returns per-token results; `remove` marks tokens that will never work again.
 */
export const sendVoipCall = async (tokens, call, { ownerType } = {}) => {
    const uniqueTokens = [...new Set((tokens || []).map(sanitize).filter(Boolean))].slice(-MAX_TOKENS_PER_SEND);
    if (!uniqueTokens.length) return { successCount: 0, failureCount: 0, results: [] };

    const topic = getVoipTopic(ownerType);
    const ringSeconds = Math.max(15, Math.round(Number(call.ringSeconds) || config.voipRestaurantRingSeconds));
    const body = buildCallPayload({ ...call, ringSeconds });
    const expiresAtSec = Math.floor(Date.now() / 1000) + ringSeconds;

    const results = await Promise.all(uniqueTokens.map((token) => sendOne(token, topic, body, expiresAtSec)));
    const successCount = results.filter((result) => result.ok).length;
    const failureCount = results.length - successCount;

    logger.info(
        `[VoIP] ${ownerType} call ${call.callId} via ${topic} (${config.apnsProduction ? 'production' : 'sandbox'}): ` +
        `success=${successCount} failure=${failureCount}` +
        (failureCount ? ` firstError="${results.find((result) => !result.ok)?.error}"` : '')
    );
    return { successCount, failureCount, results };
};

/** Startup log so a missing key or topic is visible before the first order. */
export const logVoipConfigurationStatus = () => {
    const missing = [
        !sanitize(config.apnsTeamId) && 'APNS_TEAM_ID',
        !sanitize(config.apnsKeyId) && 'APNS_KEY_ID',
        !sanitize(config.apnsAuthKeyPath) && 'APNS_VOIP_P8_PATH',
    ].filter(Boolean);
    if (missing.length) {
        logger.info(`[VoIP] iOS order calls off (missing ${missing.join(', ')}); iPhones get the regular push.`);
        return;
    }
    if (!readAuthKey()) {
        logger.warn(`[VoIP] iOS order calls off: APNs key file not found at "${config.apnsAuthKeyPath}"; iPhones get the regular push.`);
        return;
    }
    logger.info(
        `[VoIP] iOS order calls on (${config.apnsProduction ? 'production' : 'sandbox'}): ` +
        `restaurant=${getVoipTopic('RESTAURANT') || 'missing topic'} delivery=${getVoipTopic('DELIVERY_PARTNER') || 'missing topic'}`
    );
};
