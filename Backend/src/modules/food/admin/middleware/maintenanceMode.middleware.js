import {
  isMaintenanceModeEnabled,
} from '../services/maintenanceMode.service.js';
import { verifyAccessToken } from '../../../../core/auth/token.util.js';

const ADMIN_ROLES = new Set(['ADMIN', 'SUB_ADMIN']);

const ALWAYS_ALLOW_PREFIXES = [
  '/v1/health',
  '/v1/food/public/customization-settings',
  '/v1/food/public/env',
  '/v1/food/public/restaurant-settings',
  '/v1/fcm-tokens',
  '/fcm-tokens',
  '/v1/food/admin',
  '/v1/admin',
  '/v1/payments/webhook',
  '/v1/food/auth',
  '/v1/auth',
];

const LOCAL_HOST_RE =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;

function hostFromUrlLike(value) {
  try {
    const raw = String(value || '').trim();
    if (!raw) return '';
    // Origin is usually already a full URL; Referer too.
    const url = new URL(raw, 'http://localhost');
    return String(url.hostname || '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Local frontend (localhost / 127.0.0.1) hitting the SAME live backend
 * must keep working while production users are locked.
 * Browser sends Origin/Referer automatically from Vite / local WebView.
 */
function isLocalDevClient(req) {
  const originHost = hostFromUrlLike(req.headers.origin);
  if (originHost && LOCAL_HOST_RE.test(originHost)) return true;

  const refererHost = hostFromUrlLike(req.headers.referer);
  if (refererHost && LOCAL_HOST_RE.test(refererHost)) return true;

  // Optional explicit marker from local axios (harmless if spoofed; Origin is primary)
  const marker = String(req.headers['x-ometto-client'] || '').toLowerCase();
  if (marker === 'local-dev') return true;

  return false;
}

function resolvePath(req) {
  const raw = String(req.originalUrl || req.url || req.path || '');
  const withoutQuery = raw.split('?')[0] || '';
  if (withoutQuery.startsWith('/api/')) return withoutQuery.slice(4) || '/';
  if (withoutQuery === '/api') return '/';
  return String(req.path || withoutQuery || '');
}

function isAlwaysAllowed(path) {
  const p = String(path || '');
  return ALWAYS_ALLOW_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(`${prefix}/`)
  );
}

function isAdminBearer(req) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return false;
    const decoded = verifyAccessToken(token);
    const role = String(decoded?.role || '').toUpperCase();
    return ADMIN_ROLES.has(role);
  } catch {
    return false;
  }
}

/**
 * Blocks user / restaurant / delivery APIs while maintenance is on (live clients).
 * - Admin always allowed
 * - Localhost / local-dev clients allowed (same live backend, local frontend)
 */
export async function maintenanceModeMiddleware(req, res, next) {
  try {
    const path = resolvePath(req);

    if (isAlwaysAllowed(path) || isAdminBearer(req) || isLocalDevClient(req)) {
      return next();
    }

    const enabled = await isMaintenanceModeEnabled();
    if (enabled !== true) {
      return next();
    }

    return res.status(503).json({
      success: false,
      code: 'MAINTENANCE_MODE',
      message: 'Service is under maintenance. Please try again later.',
    });
  } catch {
    return next();
  }
}
