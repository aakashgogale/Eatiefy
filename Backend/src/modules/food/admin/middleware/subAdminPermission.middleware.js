import { AuthError, ForbiddenError } from '../../../../core/auth/errors.js';
import {
  findModuleKeyForPath,
  hasModuleAction,
} from '../constants/subAdminPermissions.js';

function methodToAction(method = '') {
  const m = String(method).toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'view';
  if (m === 'POST') return 'create';
  if (m === 'PUT' || m === 'PATCH') return 'edit';
  if (m === 'DELETE') return 'delete';
  return 'view';
}

const ALWAYS_ALLOW_GET = [
  '/sidebar-badges',
  '/notifications/fssai-expired',
  '/business-settings',
  '/global-search',
  '/customization-settings/takeaway-cod',
];

function isAlwaysAllowedGet(path) {
  const p = String(path || '');
  return ALWAYS_ALLOW_GET.some(
    (prefix) => p === prefix || p.startsWith(`${prefix}/`) || p.startsWith(prefix)
  );
}

function toFrontendPath(reqPath = '') {
  let p = String(reqPath || '').split('?')[0].replace(/\/+$/, '') || '/';
  p = p.replace(/^\/api/, '').replace(/^\/v1\/food\/admin/, '').replace(/^\/food\/admin/, '');
  if (!p.startsWith('/')) p = `/${p}`;
  if (p === '/') return '/admin/food';
  return `/admin/food${p}`;
}

/**
 * Enforce module-level view/create/edit/delete for SUB_ADMIN.
 * View alone never allows create/edit/delete.
 */
export function enforceSubAdminPermissions(req, _res, next) {
  const role = String(req.user?.role || '').toUpperCase();
  if (role === 'ADMIN') return next();
  if (role !== 'SUB_ADMIN') {
    return next(new AuthError('Admin access required'));
  }

  const reqPath = req.path || '';
  if (reqPath.startsWith('/sub-admins')) {
    return next(new ForbiddenError('Only full admin can manage sub admins'));
  }

  const action = methodToAction(req.method);
  if (action === 'view' && isAlwaysAllowedGet(reqPath)) {
    return next();
  }

  const frontendPath = toFrontendPath(reqPath);
  const moduleKey = findModuleKeyForPath(frontendPath);
  const permissions = req.user?.permissions || {};

  if (!moduleKey) {
    if (action === 'view') return next();
    return next(new ForbiddenError('You do not have permission to perform this action'));
  }

  if (action === 'view') {
    const canSee =
      hasModuleAction(permissions, moduleKey, 'view') ||
      hasModuleAction(permissions, moduleKey, 'create') ||
      hasModuleAction(permissions, moduleKey, 'edit') ||
      hasModuleAction(permissions, moduleKey, 'delete');
    if (!canSee) {
      return next(new ForbiddenError('You do not have permission to view this section'));
    }
    return next();
  }

  if (!hasModuleAction(permissions, moduleKey, action)) {
    return next(
      new ForbiddenError(`You do not have permission to ${action} in this section`)
    );
  }
  return next();
}
