/* eslint-disable no-undef */
/**
 * Firebase Cloud Messaging service worker.
 * Background/closed-app delivery depends on Firebase initializing here.
 * Config sources (in order): Cache written by the page → public env API.
 */
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

const sanitize = (value) => String(value || "").trim().replace(/^['"]|['"]$/g, "");
const CONFIG_CACHE = "ometto-fcm-config-v1";
const CONFIG_URL = "/__ometto_fcm_web_config__";
const notificationDedupWindowMs = 30000;

let messagingReady = false;
let firebaseInitPromise = null;

const getNotificationKey = (payload) => {
  const data = payload?.data || {};
  if (data.notificationId || data.messageId || payload?.messageId) {
    return String(data.notificationId || data.messageId || payload.messageId);
  }

  const orderMongoId = String(data.orderMongoId || "").trim();
  const orderId = String(data.orderId || "").trim();
  const orderStatus = String(data.orderStatus || "").trim();
  if (orderMongoId || orderId) {
    return [orderMongoId || orderId, orderStatus || "update"].join("::");
  }

  return [
    data.type || "",
    data.title || payload?.notification?.title || "",
    data.body || payload?.notification?.body || "",
    data.targetUrl || data.link || "",
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("::");
};

async function readCachedFirebaseConfig() {
  try {
    const cache = await caches.open(CONFIG_CACHE);
    const response = await cache.match(CONFIG_URL);
    if (!response) return null;
    return normalizeFirebaseConfig(await response.json());
  } catch {
    return null;
  }
}

async function writeCachedFirebaseConfig(config) {
  const normalized = normalizeFirebaseConfig(config);
  if (!normalized) return false;
  try {
    const cache = await caches.open(CONFIG_CACHE);
    await cache.put(
      CONFIG_URL,
      new Response(JSON.stringify(normalized), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function normalizeFirebaseConfig(data = {}) {
  const config = {
    apiKey: sanitize(data.apiKey || data.VITE_FIREBASE_API_KEY || data.FIREBASE_API_KEY),
    authDomain: sanitize(data.authDomain || data.VITE_FIREBASE_AUTH_DOMAIN || data.FIREBASE_AUTH_DOMAIN),
    projectId: sanitize(data.projectId || data.VITE_FIREBASE_PROJECT_ID || data.FIREBASE_PROJECT_ID),
    appId: sanitize(data.appId || data.VITE_FIREBASE_APP_ID || data.FIREBASE_APP_ID),
    messagingSenderId: sanitize(
      data.messagingSenderId ||
        data.VITE_FIREBASE_MESSAGING_SENDER_ID ||
        data.FIREBASE_MESSAGING_SENDER_ID,
    ),
    storageBucket: sanitize(
      data.storageBucket || data.VITE_FIREBASE_STORAGE_BUCKET || data.FIREBASE_STORAGE_BUCKET,
    ),
    measurementId: sanitize(
      data.measurementId || data.VITE_FIREBASE_MEASUREMENT_ID || data.FIREBASE_MEASUREMENT_ID,
    ),
  };
  if (config.apiKey && config.projectId && config.appId && config.messagingSenderId) {
    return config;
  }
  return null;
}

async function loadFirebaseWebConfigFromApi() {
  const candidates = ["/api/v1/food/public/env", "/api/v1/env/public", "/api/env/public"];
  for (const url of candidates) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const json = await response.json();
      const config = normalizeFirebaseConfig((json && json.data) || {});
      if (config) {
        await writeCachedFirebaseConfig(config);
        return config;
      }
    } catch {
      // try next
    }
  }
  return null;
}

async function resolveFirebaseConfig() {
  return (await readCachedFirebaseConfig()) || (await loadFirebaseWebConfigFromApi());
}

function shouldSkipDuplicateOsNotification(notificationKey) {
  if (!notificationKey) return false;
  if (!self.__omettoOsDedup) self.__omettoOsDedup = {};
  const shared = self.__omettoOsDedup;
  const now = Date.now();
  for (const [key, timestamp] of Object.entries(shared)) {
    if (now - Number(timestamp) > notificationDedupWindowMs) delete shared[key];
  }
  if (shared[notificationKey] && now - Number(shared[notificationKey]) < notificationDedupWindowMs) {
    return true;
  }
  shared[notificationKey] = now;
  return false;
}

async function notifyOpenClients(payload) {
  const windowClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
  windowClients.forEach((client) => {
    client.postMessage({ type: "push-notification-received", payload });
  });
}

function getTargetPathFromPayload(payload = {}) {
  const rawTarget =
    payload?.data?.targetUrl ||
    payload?.data?.link ||
    payload?.data?.click_action ||
    payload?.fcmOptions?.link ||
    "/";
  try {
    return new URL(rawTarget, self.location.origin).pathname || "/";
  } catch {
    return "/";
  }
}

async function hasVisibleFocusedClient(payload = {}) {
  const windowClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
  if (!windowClients.length) return false;

  // Any focused/visible tab → page foreground handler owns UX (sound/toast).
  const anyVisible = windowClients.some(
    (client) => client.visibilityState === "visible" || client.focused,
  );
  if (!anyVisible) return false;

  const hasExplicitTarget = Boolean(
    payload?.data?.targetUrl ||
      payload?.data?.link ||
      payload?.data?.click_action ||
      payload?.fcmOptions?.link,
  );
  if (!hasExplicitTarget) {
    // Broadcast with no deep-link: still skip OS tray if app is open & focused.
    return true;
  }

  const targetPath = getTargetPathFromPayload(payload);
  const normalizedTarget =
    targetPath.length > 1 && targetPath.endsWith("/") ? targetPath.slice(0, -1) : targetPath;

  return windowClients.some((client) => {
    if (!(client.visibilityState === "visible" || client.focused)) return false;
    try {
      const clientPath = new URL(client.url).pathname.replace(/\/$/, "") || "/";
      if (!normalizedTarget || normalizedTarget === "/") return true;
      return clientPath === normalizedTarget || clientPath.startsWith(`${normalizedTarget}/`);
    } catch {
      return true;
    }
  });
}

function normalizePushPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw.message && typeof raw.message === "object" ? raw.message : raw;
  const data = { ...(payload.data || {}) };
  return {
    notification: payload.notification || null,
    data,
    fcmOptions: payload.fcmOptions || payload.fcm_options || null,
    messageId: payload.messageId || payload.fcmMessageId || data.messageId || null,
  };
}

async function showOsNotificationFromPayload(payload) {
  const normalized = normalizePushPayload(payload) || payload || {};
  const data = normalized.data || {};
  const title =
    String(normalized?.notification?.title || data.title || "New Notification")
      .replace(/^[👤🏪🛵🛡️]\s*/, "")
      .replace(/^\[(User|Shop|Rider|Admin)\]\s*/i, "")
      .trim() || "New Notification";
  const body = String(
    normalized?.notification?.body || data.body || data.message || "",
  ).trim();
  const image = normalized?.notification?.image || data.image || data.imageUrl || undefined;
  const notificationKey = getNotificationKey(normalized);

  if (shouldSkipDuplicateOsNotification(notificationKey)) {
    await notifyOpenClients(normalized);
    return;
  }

  const link = data.link || data.targetUrl || data.click_action || "/";

  await self.registration.showNotification(title, {
    body,
    icon: "/assets/images/favicon.png",
    badge: "/assets/images/favicon.png",
    image,
    tag: notificationKey || `ometto-${Date.now()}`,
    renotify: data.type === "admin_broadcast",
    silent: false,
    requireInteraction: data.type === "admin_broadcast",
    vibrate: [200, 100, 200, 100, 300],
    data: { ...data, link, title, body },
  });

  await notifyOpenClients(normalized);
}

async function ensureFirebaseMessaging() {
  if (messagingReady) return true;
  if (firebaseInitPromise) return firebaseInitPromise;

  firebaseInitPromise = (async () => {
    const config = await resolveFirebaseConfig();
    if (!config) return false;
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      const messaging = firebase.messaging();
      messaging.onBackgroundMessage(async (payload) => {
        await notifyOpenClients(payload);
        if (await hasVisibleFocusedClient(payload)) return;
        // Always show tray for background/closed — title/body come from
        // notification block and/or data mirrors from the server.
        await showOsNotificationFromPayload(payload);
      });
      messagingReady = true;
      return true;
    } catch {
      return false;
    }
  })();

  try {
    return await firebaseInitPromise;
  } finally {
    if (!messagingReady) firebaseInitPromise = null;
  }
}

void ensureFirebaseMessaging();

self.addEventListener("message", (event) => {
  const data = event?.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "OMETTO_FCM_CONFIG" && data.config) {
    event.waitUntil(
      (async () => {
        await writeCachedFirebaseConfig(data.config);
        await ensureFirebaseMessaging();
      })(),
    );
  }
});

/**
 * Fallback when Firebase messaging never initialized (missing config on cold start).
 * If messaging IS ready, onBackgroundMessage owns display — skip to avoid doubles.
 */
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const ready = await ensureFirebaseMessaging();
      if (ready) return;

      let raw = null;
      try {
        raw = event.data ? event.data.json() : null;
      } catch {
        try {
          const text = event.data ? event.data.text() : "";
          raw = text ? JSON.parse(text) : null;
        } catch {
          raw = null;
        }
      }
      if (!raw) return;

      const payload = normalizePushPayload(raw) || raw;
      if (await hasVisibleFocusedClient(payload)) {
        await notifyOpenClients(payload);
        return;
      }
      await showOsNotificationFromPayload(payload);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawLink =
    event?.notification?.data?.link ||
    event?.notification?.data?.click_action ||
    event?.notification?.data?.targetUrl ||
    "/";

  let targetUrl = "/";
  try {
    if (String(rawLink || "").startsWith("http")) {
      const parsed = new URL(String(rawLink));
      targetUrl = `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
    } else {
      targetUrl = String(rawLink || "/").startsWith("/") ? String(rawLink || "/") : "/";
    }
  } catch {
    targetUrl = "/";
  }

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      const client = windowClients.find((c) => c.url.includes(self.location.origin));
      if (client) {
        client.focus();
        if ("navigate" in client) return client.navigate(targetUrl);
        return undefined;
      }
      return clients.openWindow(targetUrl);
    }),
  );
});
