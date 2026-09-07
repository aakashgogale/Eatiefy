/**
 * Single source of truth for Socket.IO connections.
 *
 * Every realtime feature (restaurant order alerts, delivery offers, user order
 * status, live tracking, admin orders) must go through `createAppSocket` so the
 * URL resolution, auth token and reconnection policy stay identical everywhere.
 *
 * URL resolution order:
 *   1. VITE_SOCKET_URL — explicit override (use when sockets live on their own host)
 *   2. origin of VITE_API_BASE_URL — the normal case (API and sockets share a host)
 *   3. window.location.origin — same-origin deploys behind nginx
 *
 * Production safety net: if the build was made with a localhost API base URL but is
 * being served from a real domain, we fall back to the page origin instead of
 * silently refusing to connect, and log a loud, actionable error. A misconfigured
 * build then still works behind a same-origin reverse proxy, and the mistake is
 * visible in the console instead of being invisible.
 */
import io from 'socket.io-client';
import { API_BASE_URL } from './config.js';

export const SOCKET_PATH = '/socket.io/';

const isLocalHostname = (hostname) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

const pageOrigin = () =>
  typeof window !== 'undefined' && window.location ? window.location.origin : '';

const toOrigin = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, pageOrigin() || undefined).origin;
  } catch {
    return '';
  }
};

/**
 * Resolves the Socket.IO origin for the current environment.
 * @returns {{ url: string, source: string, warning: string|null }}
 */
export const resolveSocketOrigin = () => {
  const explicit = toOrigin(import.meta.env?.VITE_SOCKET_URL);
  if (explicit) return { url: explicit, source: 'VITE_SOCKET_URL', warning: null };

  const fromApi = toOrigin(API_BASE_URL);
  const origin = pageOrigin();

  if (fromApi) {
    let apiIsLocal = false;
    try {
      apiIsLocal = isLocalHostname(new URL(fromApi).hostname);
    } catch {
      apiIsLocal = false;
    }

    const pageIsLocal = (() => {
      if (!origin) return true;
      try {
        return isLocalHostname(new URL(origin).hostname);
      } catch {
        return false;
      }
    })();

    // Build shipped with localhost baked in, but served from a real domain.
    if (apiIsLocal && !pageIsLocal) {
      return {
        url: origin,
        source: 'window.location.origin (localhost fallback)',
        warning:
          `Socket.IO: this build points at "${fromApi}", which does not exist on ` +
          `"${origin}". Falling back to the page origin. Rebuild with a correct ` +
          `VITE_API_BASE_URL (or set VITE_SOCKET_URL) in .env.production.`,
      };
    }

    return { url: fromApi, source: 'VITE_API_BASE_URL', warning: null };
  }

  if (origin) {
    return {
      url: origin,
      source: 'window.location.origin',
      warning:
        'Socket.IO: neither VITE_SOCKET_URL nor VITE_API_BASE_URL is set. ' +
        'Falling back to the page origin.',
    };
  }

  return { url: '', source: 'none', warning: 'Socket.IO: no origin could be resolved.' };
};

/**
 * Reads the access token for a role, falling back to the shared token.
 * @param {'user'|'restaurant'|'delivery'|'admin'} [role]
 * @returns {string}
 */
export const getSocketAuthToken = (role) => {
  if (typeof localStorage === 'undefined') return '';
  const scoped = role ? localStorage.getItem(`${role}_accessToken`) : null;
  return scoped || localStorage.getItem('accessToken') || '';
};

/**
 * Creates a configured Socket.IO client.
 *
 * The backend rejects unauthenticated handshakes (`AUTH_MISSING`), so a token is
 * always sent. Returns null when no origin or token is available — the caller's
 * existing null check keeps the UI working without realtime.
 *
 * @param {object} [options]
 * @param {'user'|'restaurant'|'delivery'|'admin'} [options.role] which stored token to use
 * @param {string} [options.token] explicit token, overrides `role`
 * @param {string} [options.label] name used in console diagnostics
 * @param {boolean} [options.requireAuth=true] set false only for genuinely public sockets
 * @param {object} [options.socketOptions] extra socket.io-client options
 * @returns {import('socket.io-client').Socket | null}
 */
export const createAppSocket = ({
  role,
  token,
  label = 'socket',
  requireAuth = true,
  socketOptions = {},
} = {}) => {
  const { url, source, warning } = resolveSocketOrigin();

  if (warning) {
    console.error(`[${label}] ${warning}`);
  }

  if (!url) {
    console.error(`[${label}] Socket.IO not started: no origin resolved (source: ${source}).`);
    return null;
  }

  const authToken = token ?? getSocketAuthToken(role);
  if (requireAuth && !authToken) {
    console.warn(`[${label}] Socket.IO not started: no access token for role "${role || 'shared'}".`);
    return null;
  }

  const socket = io(url, {
    path: SOCKET_PATH,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    timeout: 20000,
    withCredentials: true,
    auth: { token: authToken },
    ...socketOptions,
  });

  // Connection failures must never be silent — this is the class of bug that makes
  // "no order, no sound" impossible to diagnose in production.
  socket.on('connect_error', (err) => {
    console.error(
      `[${label}] Socket.IO connect_error: ${err?.message || err} ` +
      `(url: ${url}, source: ${source}, path: ${SOCKET_PATH})`,
    );
  });

  return socket;
};

export default createAppSocket;
