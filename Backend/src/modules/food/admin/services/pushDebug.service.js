import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodAdmin } from '../../../../core/admin/admin.model.js';
import { FoodNotification } from '../../../../core/notifications/models/notification.model.js';
import { BroadcastNotification } from '../../../../core/notifications/models/notificationBroadcast.model.js';
import { PushClientDiagnostic } from '../../../../core/notifications/models/pushClientDiagnostic.model.js';
import { probeFcmToken } from '../../../../core/notifications/firebase.service.js';

const OWNER_CONFIG = {
    USER: {
        model: FoodUser,
        phoneField: 'phone',
        label: (doc) => doc.name || doc.phone || 'User',
        eligible: (doc) => doc.isActive !== false,
        ineligibleNote: 'This account is deactivated, so admin broadcasts skip it (only active users are targeted).'
    },
    RESTAURANT: {
        model: FoodRestaurant,
        phoneField: 'ownerPhone',
        label: (doc) => doc.restaurantName || doc.ownerName || 'Restaurant',
        eligible: (doc) => doc.status === 'approved',
        ineligibleNote: 'This restaurant is not approved, so admin broadcasts skip it.'
    },
    DELIVERY_PARTNER: {
        model: FoodDeliveryPartner,
        phoneField: 'phone',
        label: (doc) => doc.name || doc.phone || 'Delivery partner',
        eligible: (doc) => doc.status === 'approved',
        ineligibleNote: 'This delivery partner is not approved, so admin broadcasts skip it.'
    }
};

const SELECT =
    '_id name phone email isActive status restaurantName ownerName ownerPhone updatedAt fcmTokens fcmTokenMobile fcmTokenMobileAlarm voipDevices';

const MAX_PROBED_TOKENS_PER_PLATFORM = 6;

const ERROR_ADVICE = {
    UNREGISTERED:
        'Token is dead (app was uninstalled/reinstalled or the token rotated). The user has to open the app again so it registers a fresh one.',
    SENDER_ID_MISMATCH:
        "Token was issued by a DIFFERENT Firebase project than this server uses. Compare the app's GoogleService-Info.plist / google-services.json project with the server's FIREBASE_PROJECT_ID / service account.",
    THIRD_PARTY_AUTH_ERROR:
        'Firebase cannot authenticate to Apple for this iOS app. Upload a valid APNs auth key (.p8) with Key ID and Team ID under Firebase Console > Project settings > Cloud Messaging for THIS iOS app (bundle id).',
    INVALID_ARGUMENT:
        'Firebase rejected the token or payload as malformed. If the token is short or hex-only it is probably not an FCM token (see its type).',
    QUOTA_EXCEEDED: 'Firebase rate-limited this project. Retry later.',
    UNAVAILABLE: 'Firebase was temporarily unavailable. Retry.',
    INTERNAL: 'Firebase had an internal error. Retry.'
};

const classifyToken = (token) => {
    if (/^[0-9a-f]{64}$/i.test(token)) return 'apns-device-token (NOT an FCM token)';
    if (/^[0-9a-f]{64,200}$/i.test(token)) return 'hex-only (looks like a PushKit/VoIP token, not FCM)';
    if (token.includes(':') && token.length >= 100) return 'fcm';
    return 'unknown-format';
};

const mask = (token) => (token.length > 14 ? `${token.slice(0, 6)}…${token.slice(-6)}` : token);

const resolveOwner = async ({ ownerType, query }) => {
    const config = OWNER_CONFIG[ownerType];
    if (!config) throw new ValidationError('ownerType must be USER, RESTAURANT or DELIVERY_PARTNER');
    const text = String(query || '').trim();
    if (!text) throw new ValidationError('Enter a phone number or an account id');

    if (mongoose.Types.ObjectId.isValid(text) && text.length === 24) {
        return config.model.findById(text).select(SELECT).lean();
    }

    const digits = text.replace(/\D/g, '').slice(-10);
    if (digits.length < 8) throw new ValidationError('Enter at least 8 digits of the phone number, or a 24-character id');
    const matches = await config.model
        .find({ [config.phoneField]: new RegExp(`${digits}$`) })
        .select(SELECT)
        .limit(5)
        .lean();
    return matches.find((doc) => config.eligible(doc)) || matches[0] || null;
};

const findTokenSharing = async (token, ownerId) => {
    const filter = { $or: [{ fcmTokens: token }, { fcmTokenMobile: token }] };
    const owners = [];
    for (const [type, model] of [
        ['USER', FoodUser],
        ['RESTAURANT', FoodRestaurant],
        ['DELIVERY_PARTNER', FoodDeliveryPartner],
        ['ADMIN', FoodAdmin]
    ]) {
        const docs = await model.find(filter).select('_id').limit(5).lean();
        docs.filter((doc) => String(doc._id) !== String(ownerId)).forEach((doc) => owners.push(`${type}:${doc._id}`));
    }
    return owners;
};

export const runPushDebug = async ({ ownerType = 'USER', query, testSend = false } = {}) => {
    const type = String(ownerType || 'USER').toUpperCase();
    const config = OWNER_CONFIG[type];
    const doc = await resolveOwner({ ownerType: type, query });
    if (!doc) {
        return { found: false, findings: [{ level: 'error', text: `No ${type.toLowerCase()} found for "${query}".` }] };
    }

    const findings = [];
    const add = (level, text) => findings.push({ level, text });

    const webTokens = Array.isArray(doc.fcmTokens) ? doc.fcmTokens : [];
    const mobileTokens = Array.isArray(doc.fcmTokenMobile) ? doc.fcmTokenMobile : [];
    const voipDevices = Array.isArray(doc.voipDevices) ? doc.voipDevices : [];

    if (!config.eligible(doc)) add('error', config.ineligibleNote);

    const [clientReports, inbox, broadcasts] = await Promise.all([
        PushClientDiagnostic.find({ ownerType: type, ownerId: doc._id }).sort({ createdAt: -1 }).limit(3).lean(),
        FoodNotification.find({ ownerType: type, ownerId: doc._id })
            .sort({ createdAt: -1 })
            .limit(5)
            .select('title source createdAt')
            .lean(),
        BroadcastNotification.find({ 'targets.ownerId': doc._id })
            .sort({ createdAt: -1 })
            .limit(3)
            .select('title targetType createdAt')
            .lean()
    ]);

    const tokenRows = [];
    const groups = [
        { platform: 'web', tokens: webTokens },
        { platform: 'mobile', tokens: mobileTokens }
    ];
    for (const group of groups) {
        for (const token of group.tokens.slice(-MAX_PROBED_TOKENS_PER_PLATFORM)) {
            const kind = classifyToken(token);
            const sharedWith = await findTokenSharing(token, doc._id);
            const validation = await probeFcmToken({ token, platform: group.platform, validateOnly: true });
            const send = testSend ? await probeFcmToken({ token, platform: group.platform, validateOnly: false }) : null;
            tokenRows.push({ platform: group.platform, token: mask(token), length: token.length, kind, sharedWith, validation, send });
        }
    }

    if (!webTokens.length && !mobileTokens.length) {
        add('error', 'No FCM token is saved for this account (neither web nor mobile). Pushes have nowhere to go.');
        const failureReport = clientReports.find((report) => !report.tokenFound);
        if (failureReport?.env && failureReport.env.flutter === false) {
            add(
                'error',
                `The device reported that the Flutter bridge is NOT available to the web page (running as ${failureReport.env.standalone ? 'an installed web app' : 'a normal browser tab'}, Notification API ${failureReport.env.notificationApi ? 'present' : 'missing'}, permission "${failureReport.env.webPermission}"). The web layer therefore cannot read the native FCM token. Either this is not the Flutter app, or the app injects its bridge too late for the page to see it.`
            );
        } else if (failureReport) {
            add(
                'error',
                'The app reported it could not get a token from the native layer (see "App reports" below). That is a Flutter-side problem: the handler is missing or Firebase has no token yet.'
            );
        } else {
            add(
                'warn',
                'This account has never reported anything. That means the phone has not run the latest web build while logged in (a Flutter WebView can keep serving a cached build — fully close the app, reopen it and log in again), or this account is not logged in on a phone at all. Re-run after that.'
            );
        }
    } else if (!mobileTokens.length) {
        add('warn', 'Only a web token is saved. In the Flutter app a mobile token is expected, so this device is not registering natively.');
    }

    // The token being saved says nothing about whether iOS will display pushes:
    // without notification permission iOS drops them while Firebase still reports success.
    const latestReport = clientReports[0];
    if (latestReport?.permission) {
        const { handler, result, attempts } = latestReport.permission;
        const answer = String(result ?? '').toLowerCase();
        if (!handler) {
            add(
                'error',
                'The app has no notification-permission handler (tried requestNotificationPermission, requestPushPermission, enableNotifications' +
                    (attempts && Object.keys(attempts).length
                        ? `; results: ${Object.entries(attempts).map(([name, outcome]) => `${name} ${outcome}`).join(', ')}`
                        : '') +
                    '), so the web layer cannot ask iOS for permission. If iPhone Settings > Notifications has no entry for this app, or Allow Notifications is off, iOS silently drops every push even though Firebase accepts it. Fix in the Flutter app: call FirebaseMessaging.instance.requestPermission(alert: true, badge: true, sound: true) at startup (or register one of those handlers).'
            );
        } else if (/denied|false|not.?determined|restricted/.test(answer)) {
            add(
                'error',
                `The app reports notification permission is NOT granted (${handler} answered "${result}"). iOS drops every push until the user allows notifications for this app in iPhone Settings > Notifications.`
            );
        } else if (/authorized|granted|true|provisional/.test(answer)) {
            add('info', `The app reports notification permission is granted (${handler} answered "${result}").`);
        } else {
            add('warn', `The app answered "${result}" to the notification-permission request (${handler}); this is not a clear yes or no.`);
        }
    } else if (tokenRows.length) {
        add('warn', 'The app has not reported its notification permission yet. Log in or fully reopen the app on the latest build, then run this again.');
    }

    for (const row of tokenRows) {
        const label = `${row.platform} token ${row.token}`;
        if (row.kind !== 'fcm') add('warn', `${label} is ${row.kind}.`);
        if (row.sharedWith.length) add('warn', `${label} is also stored on: ${row.sharedWith.join(', ')} (it should belong to one account).`);
        const failed = !row.validation.ok ? row.validation : row.send && !row.send.ok ? row.send : null;
        if (failed) {
            const advice = ERROR_ADVICE[failed.errorCode] || '';
            add('error', `${label}: Firebase says ${failed.errorCode || failed.status || 'error'} — ${failed.error}. ${advice}`.trim());
        } else if (row.send?.ok) {
            add(
                'info',
                `${label}: Firebase accepted a real test push (${row.send.messageId || 'ok'}). If nothing appeared on the phone, the server side is fine: check iOS Settings > Notifications > the app, Focus/Do Not Disturb, and that the app has the Push Notifications capability with APNs set up in Firebase.`
            );
        } else if (row.validation.ok) {
            add('info', `${label}: Firebase accepts this token (validation only). Run with "real test push" to check delivery.`);
        }
    }

    if (!findings.some((f) => f.level === 'error') && tokenRows.length) {
        add('info', 'No server-side problem found for this account.');
    }

    return {
        found: true,
        owner: {
            type,
            id: String(doc._id),
            label: config.label(doc),
            phone: doc[config.phoneField] || doc.phone || '',
            eligibleForBroadcast: config.eligible(doc)
        },
        counts: { web: webTokens.length, mobile: mobileTokens.length, voipDevices: voipDevices.length },
        tokens: tokenRows,
        clientReports: clientReports.map((report) => ({
            at: report.createdAt,
            hasCallHandler: report.hasCallHandler,
            tokenFound: report.tokenFound === true,
            env: report.env || null,
            permission: report.permission || null,
            handlers: report.handlers,
            userAgent: report.userAgent
        })),
        recentBroadcasts: broadcasts.map((b) => ({ title: b.title, targetType: b.targetType, at: b.createdAt })),
        recentInbox: inbox.map((n) => ({ title: n.title, source: n.source, at: n.createdAt })),
        testSend: Boolean(testSend),
        findings
    };
};
