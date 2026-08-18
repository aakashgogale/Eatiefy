import { FoodAdmin } from '../../../../core/admin/admin.model.js';
import { FoodRefreshToken } from '../../../../core/refreshTokens/refreshToken.model.js';
import { ValidationError, ForbiddenError } from '../../../../core/auth/errors.js';
import {
  SUB_ADMIN_PERMISSION_MODULES,
  normalizePermissions,
} from '../constants/subAdminPermissions.js';

const SUB_ADMIN_ROLE = 'SUB_ADMIN';

function sanitizeAdmin(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  delete obj.password;
  return {
    id: obj._id?.toString?.() || obj.id,
    _id: obj._id?.toString?.() || obj.id,
    name: obj.name || '',
    email: obj.email || '',
    phone: obj.phone || '',
    role: obj.role,
    isActive: obj.isActive !== false,
    permissions: normalizePermissions(obj.permissions || {}),
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

export function getPermissionModules() {
  return SUB_ADMIN_PERMISSION_MODULES.map(({ key, label }) => ({ key, label }));
}

export async function listSubAdmins(query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 500);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const skip = (page - 1) * limit;

  const filter = { role: SUB_ADMIN_ROLE };

  if (query.search && String(query.search).trim()) {
    const raw = String(query.search).trim().slice(0, 80);
    const term = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
      { phone: { $regex: term, $options: 'i' } },
    ];
  }

  const [docs, total] = await Promise.all([
    FoodAdmin.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodAdmin.countDocuments(filter),
  ]);

  return {
    subAdmins: docs.map(sanitizeAdmin),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function getSubAdminById(id) {
  const doc = await FoodAdmin.findOne({ _id: id, role: SUB_ADMIN_ROLE }).select('-password');
  if (!doc) return null;
  return sanitizeAdmin(doc);
}

export async function createSubAdmin({ name, email, phone, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new ValidationError('Email is required');
  if (!password || String(password).length < 6) {
    throw new ValidationError('Password must be at least 6 characters');
  }
  if (!String(name || '').trim()) throw new ValidationError('Name is required');

  const existing = await FoodAdmin.findOne({ email: normalizedEmail });
  if (existing) throw new ValidationError('An admin with this email already exists');

  const doc = await FoodAdmin.create({
    name: String(name).trim(),
    email: normalizedEmail,
    phone: String(phone || '').trim(),
    password: String(password),
    role: SUB_ADMIN_ROLE,
    isActive: true,
    permissions: normalizePermissions({}),
    servicesAccess: ['food'],
  });

  return sanitizeAdmin(doc);
}

export async function updateSubAdmin(id, { name, email, phone, password }) {
  const doc = await FoodAdmin.findOne({ _id: id, role: SUB_ADMIN_ROLE });
  if (!doc) return null;

  if (name !== undefined) doc.name = String(name).trim();
  if (phone !== undefined) doc.phone = String(phone).trim();

  if (email !== undefined) {
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail) throw new ValidationError('Email is required');
    const duplicate = await FoodAdmin.findOne({
      email: normalizedEmail,
      _id: { $ne: doc._id },
    });
    if (duplicate) throw new ValidationError('An admin with this email already exists');
    doc.email = normalizedEmail;
  }

  if (password !== undefined && String(password).trim()) {
    if (String(password).length < 6) {
      throw new ValidationError('Password must be at least 6 characters');
    }
    doc.password = String(password);
  }

  await doc.save();
  return sanitizeAdmin(doc);
}

export async function updateSubAdminStatus(id, isActive) {
  const doc = await FoodAdmin.findOne({ _id: id, role: SUB_ADMIN_ROLE });
  if (!doc) return null;

  doc.isActive = isActive !== false;
  await doc.save();

  if (!doc.isActive) {
    await FoodRefreshToken.deleteMany({ userId: doc._id });
  }

  return sanitizeAdmin(doc);
}

/** Full admin sets a new password for a sub-admin (no old password required). */
export async function resetSubAdminPassword(id, newPassword) {
  const password = String(newPassword || '');
  if (password.length < 6) {
    throw new ValidationError('Password must be at least 6 characters');
  }

  const doc = await FoodAdmin.findOne({ _id: id, role: SUB_ADMIN_ROLE });
  if (!doc) return null;

  doc.password = password;
  await doc.save();
  // Force re-login with the new password
  await FoodRefreshToken.deleteMany({ userId: doc._id });

  return sanitizeAdmin(doc);
}

export async function updateSubAdminPermissions(id, permissions) {
  const doc = await FoodAdmin.findOne({ _id: id, role: SUB_ADMIN_ROLE });
  if (!doc) return null;

  doc.permissions = normalizePermissions(permissions || {});
  doc.markModified('permissions');
  await doc.save();
  return sanitizeAdmin(doc);
}

export async function deleteSubAdmin(id) {
  const doc = await FoodAdmin.findOne({ _id: id, role: SUB_ADMIN_ROLE });
  if (!doc) return null;

  await FoodRefreshToken.deleteMany({ userId: doc._id });
  await FoodAdmin.deleteOne({ _id: doc._id });
  return sanitizeAdmin(doc);
}

/** Only full ADMIN (not SUB_ADMIN) may manage sub-admins. */
export function assertFullAdmin(reqUser) {
  if (!reqUser || String(reqUser.role).toUpperCase() !== 'ADMIN') {
    throw new ForbiddenError('Only full admin can manage sub admins');
  }
}
