import mongoose from 'mongoose';
import { FoodDeliveryCashLimit } from '../models/deliveryCashLimit.model.js';
import { FoodDeliveryEmergencyHelp } from '../models/deliveryEmergencyHelp.model.js';
import { FoodZoneDeliverySettings } from '../models/zoneDeliverySettings.model.js';
import { FoodZone } from '../models/zone.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { validateDeliveryEmergencyHelpUpsertDto } from '../validators/deliveryEmergencyHelp.validator.js';

/*
 * Deliveryman Management settings, per zone.
 *
 * The platform default lives where it always has (FoodDeliveryCashLimit,
 * FoodDeliveryEmergencyHelp). A zone may override any single value in
 * FoodZoneDeliverySettings; a null field follows the default. Every rider is
 * governed by the settings of their own zone (FoodDeliveryPartner.zoneId), and
 * a rider without a zone by the default.
 */

/** Values the Delivery Cash Limit and Multiorder Setting pages edit. */
export const CASH_LIMIT_FIELDS = ['deliveryCashLimit', 'deliveryWithdrawalLimit', 'maxConcurrentOrders'];
/** Numbers the Delivery Emergency Help page edits. */
export const EMERGENCY_FIELDS = ['medicalEmergency', 'accidentHelpline', 'contactPolice', 'insurance'];
const ALL_FIELDS = [...CASH_LIMIT_FIELDS, ...EMERGENCY_FIELDS];
const STRING_FIELDS = new Set(EMERGENCY_FIELDS);

const clampMaxConcurrent = (value) => Math.min(5, Math.max(1, Math.round(Number(value) || 1)));

/** Same normalisation the cash-limit settings have always been read with. */
const normalizeCashLimit = (src = {}) => ({
    deliveryCashLimit: Number(src.deliveryCashLimit) || 0,
    deliveryWithdrawalLimit: Number(src.deliveryWithdrawalLimit) || 100,
    maxConcurrentOrders: clampMaxConcurrent(src.maxConcurrentOrders ?? 1),
});

const normalizeEmergency = (src = {}) =>
    Object.fromEntries(EMERGENCY_FIELDS.map((field) => [field, String(src[field] || '')]));

/** A zone id from anything a caller holds (id, string, populated zone), or null. */
const toZoneKey = (value) => {
    const raw = value && typeof value === 'object' && value._id ? value._id : value;
    if (raw == null) return null;
    const str = String(raw).trim();
    return mongoose.Types.ObjectId.isValid(str) ? str : null;
};

/** Admin input: empty / "all" / "global" selects the default; anything else must be a zone id. */
const parseZoneIdParam = (value) => {
    const raw = value == null ? '' : String(value).trim();
    if (!raw || raw === 'all' || raw === 'global') return null;
    if (!mongoose.Types.ObjectId.isValid(raw)) throw new ValidationError('Invalid zoneId');
    return new mongoose.Types.ObjectId(raw);
};

/** The value a zone overrides for `field`, or null when it follows the default. */
const readOverride = (zoneDoc, field) => {
    const value = zoneDoc?.[field];
    if (value == null) return null;
    if (STRING_FIELDS.has(field)) {
        const text = String(value).trim();
        return text || null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

const hasOverride = (zoneDoc, fields) => fields.some((field) => readOverride(zoneDoc, field) != null);

const applyOverrides = (defaults, zoneDoc, fields) => {
    const effective = { ...defaults };
    for (const field of fields) {
        const value = readOverride(zoneDoc, field);
        if (value != null) effective[field] = value;
    }
    return effective;
};

const applyCashLimit = (defaults, zoneDoc) =>
    normalizeCashLimit(applyOverrides(defaults, zoneDoc, CASH_LIMIT_FIELDS));
const applyEmergency = (defaults, zoneDoc) =>
    normalizeEmergency(applyOverrides(defaults, zoneDoc, EMERGENCY_FIELDS));

async function loadDefaultCashLimit() {
    const doc = await FoodDeliveryCashLimit.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
    return normalizeCashLimit(doc || {});
}

async function loadDefaultEmergency() {
    const doc = await FoodDeliveryEmergencyHelp.findOne({ isActive: true }).sort({ createdAt: -1 }).lean();
    return normalizeEmergency(doc || {});
}

const findZoneDoc = (zoneKey) =>
    zoneKey ? FoodZoneDeliverySettings.findOne({ zoneId: zoneKey }).lean() : Promise.resolve(null);

// ----- Effective settings (riders, dispatch, wallets) -----

/** Cash limit, minimum withdrawal and multi-order capacity for a zone (default when none). */
export async function resolveDeliveryCashLimitSettings({ zoneId } = {}) {
    const [defaults, zoneDoc] = await Promise.all([loadDefaultCashLimit(), findZoneDoc(toZoneKey(zoneId))]);
    return applyCashLimit(defaults, zoneDoc);
}

/** Emergency numbers for a zone (default when none). */
export async function resolveDeliveryEmergencyHelp({ zoneId } = {}) {
    const [defaults, zoneDoc] = await Promise.all([loadDefaultEmergency(), findZoneDoc(toZoneKey(zoneId))]);
    return applyEmergency(defaults, zoneDoc);
}

/** The zone of a rider, from their record (or id). */
export async function getPartnerZoneId(partnerOrId) {
    let ref = partnerOrId;
    if (ref && typeof ref === 'object' && !(ref instanceof mongoose.Types.ObjectId)) {
        if ('zoneId' in ref) return toZoneKey(ref.zoneId);
        ref = ref._id;
    }
    if (!ref || !mongoose.Types.ObjectId.isValid(String(ref))) return null;
    const partner = await FoodDeliveryPartner.findById(ref).select('zoneId').lean();
    return toZoneKey(partner?.zoneId);
}

export async function resolveDeliveryCashLimitForPartner(partnerOrId) {
    return resolveDeliveryCashLimitSettings({ zoneId: await getPartnerZoneId(partnerOrId) });
}

export async function resolveDeliveryEmergencyHelpForPartner(partnerOrId) {
    return resolveDeliveryEmergencyHelp({ zoneId: await getPartnerZoneId(partnerOrId) });
}

/**
 * Defaults plus every zone override in two queries, for code that handles
 * riders from many zones at once (dispatch, wallet lists): `forZone(zoneId)`
 * is that zone's effective cash-limit settings.
 */
export async function loadDeliveryCashLimitByZone() {
    const [defaults, zoneDocs] = await Promise.all([
        loadDefaultCashLimit(),
        FoodZoneDeliverySettings.find({}).lean(),
    ]);
    const byZone = new Map(
        zoneDocs
            .filter((doc) => hasOverride(doc, CASH_LIMIT_FIELDS))
            .map((doc) => [String(doc.zoneId), applyCashLimit(defaults, doc)])
    );
    return {
        defaults,
        forZone: (zoneId) => byZone.get(toZoneKey(zoneId) || '') || defaults,
    };
}

/** Zone of each rider id, for batch callers. Riders without a zone map to null. */
export async function loadPartnerZoneIds(partnerIds = []) {
    const ids = partnerIds
        .map((id) => String(id?._id || id || ''))
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!ids.length) return new Map();
    const partners = await FoodDeliveryPartner.find({ _id: { $in: ids } }).select('zoneId').lean();
    return new Map(partners.map((p) => [String(p._id), toZoneKey(p.zoneId)]));
}

// ----- Admin pages -----

/**
 * What an admin settings page needs for one scope: the effective values (top
 * level, same keys as before), the defaults, which values the zone overrides,
 * and every zone with an override so the zone picker can mark them.
 */
async function buildAdminSettings(zoneOid, fields, loadDefaults, applyFn) {
    const [defaults, zoneDocs] = await Promise.all([loadDefaults(), FoodZoneDeliverySettings.find({}).lean()]);
    const zoneDoc = zoneOid ? zoneDocs.find((doc) => String(doc.zoneId) === String(zoneOid)) || null : null;
    return {
        ...applyFn(defaults, zoneDoc),
        zoneId: zoneOid ? String(zoneOid) : null,
        defaults,
        overridden: Object.fromEntries(fields.map((field) => [field, readOverride(zoneDoc, field) != null])),
        zoneOverrides: zoneDocs
            .filter((doc) => hasOverride(doc, fields))
            .map((doc) => ({
                zoneId: String(doc.zoneId),
                ...Object.fromEntries(fields.map((field) => [field, readOverride(doc, field)])),
            })),
    };
}

export const getAdminDeliveryCashLimitSettings = (zoneId) =>
    buildAdminSettings(parseZoneIdParam(zoneId), CASH_LIMIT_FIELDS, loadDefaultCashLimit, applyCashLimit);

export const getAdminDeliveryEmergencyHelp = (zoneId) =>
    buildAdminSettings(parseZoneIdParam(zoneId), EMERGENCY_FIELDS, loadDefaultEmergency, applyEmergency);

const CASH_LIMIT_LABELS = {
    deliveryCashLimit: 'Cash limit',
    deliveryWithdrawalLimit: 'Minimum withdrawal',
    maxConcurrentOrders: 'Max concurrent orders',
};

/** A zone's value for a cash-limit field; null clears the override. */
const parseCashLimitOverride = (field, value) => {
    if (value === null || value === '') return null;
    const num = Number(value);
    if (field === 'maxConcurrentOrders') {
        if (!Number.isInteger(num) || num < 1 || num > 5) {
            throw new ValidationError('Max concurrent orders must be a whole number from 1 to 5');
        }
        return num;
    }
    if (!Number.isFinite(num) || num < 0) {
        throw new ValidationError(`${CASH_LIMIT_LABELS[field]} must be 0 or more`);
    }
    return num;
};

/** A zone's emergency number; blank or null clears the override. */
const parseEmergencyOverride = (value) => {
    if (value == null) return null;
    const digits = String(value).trim().replace(/[^\d]/g, '');
    if (!digits) return null;
    if (!/^\d{3,15}$/.test(digits)) throw new ValidationError('Phone number must be 3 to 15 digits');
    return digits;
};

async function saveZoneOverrides(zoneOid, values, adminUser) {
    if (!(await FoodZone.exists({ _id: zoneOid }))) {
        throw new ValidationError('Selected zone does not exist');
    }
    const adminId = adminUser?.userId && mongoose.Types.ObjectId.isValid(String(adminUser.userId))
        ? adminUser.userId
        : undefined;
    const zoneDoc = await FoodZoneDeliverySettings.findOneAndUpdate(
        { zoneId: zoneOid },
        { $set: { ...values, updatedBy: { role: adminUser?.role || 'ADMIN', adminId, at: new Date() } } },
        { upsert: true, new: true, runValidators: true }
    ).lean();

    // A zone overriding nothing is the default: drop the empty row, but only
    // while it is still empty so a concurrent save is never lost.
    if (!hasOverride(zoneDoc, ALL_FIELDS)) {
        await FoodZoneDeliverySettings.deleteOne({
            _id: zoneDoc._id,
            ...Object.fromEntries(ALL_FIELDS.map((field) => [field, null])),
        });
    }
}

/** The platform default, saved exactly as the page always saved it. */
async function upsertDefaultCashLimit(body) {
    const existing = await FoodDeliveryCashLimit.findOne({ isActive: true }).sort({ createdAt: -1 });
    const next = {
        deliveryCashLimit: body.deliveryCashLimit,
        deliveryWithdrawalLimit: body.deliveryWithdrawalLimit,
        maxConcurrentOrders: body.maxConcurrentOrders,
    };
    if (existing) {
        if (next.deliveryCashLimit !== undefined) existing.deliveryCashLimit = Math.max(0, Number(next.deliveryCashLimit) || 0);
        if (next.deliveryWithdrawalLimit !== undefined) existing.deliveryWithdrawalLimit = Math.max(0, Number(next.deliveryWithdrawalLimit) || 0);
        if (next.maxConcurrentOrders !== undefined) existing.maxConcurrentOrders = clampMaxConcurrent(next.maxConcurrentOrders);
        await existing.save();
        return;
    }
    await FoodDeliveryCashLimit.create({
        deliveryCashLimit: next.deliveryCashLimit !== undefined ? Math.max(0, Number(next.deliveryCashLimit) || 0) : 0,
        deliveryWithdrawalLimit: next.deliveryWithdrawalLimit !== undefined ? Math.max(0, Number(next.deliveryWithdrawalLimit) || 0) : 100,
        maxConcurrentOrders: next.maxConcurrentOrders !== undefined ? clampMaxConcurrent(next.maxConcurrentOrders) : 1,
        isActive: true,
    });
}

async function upsertDefaultEmergency(values) {
    const existing = await FoodDeliveryEmergencyHelp.findOne({ isActive: true }).sort({ createdAt: -1 });
    if (existing) {
        for (const field of EMERGENCY_FIELDS) {
            if (values[field] !== undefined) existing[field] = String(values[field] || '').trim();
        }
        await existing.save();
        return;
    }
    await FoodDeliveryEmergencyHelp.create({ ...normalizeEmergency(values), isActive: true });
}

/**
 * Without `zoneId` this updates the platform default, as before. With
 * `zoneId` it sets that zone's overrides; `null` for a value clears it so the
 * zone follows the default again.
 */
export async function updateDeliveryCashLimitSettings(body = {}, adminUser = null) {
    const zoneOid = parseZoneIdParam(body.zoneId);
    const provided = CASH_LIMIT_FIELDS.filter((field) => body[field] !== undefined);
    if (provided.length === 0) {
        throw new ValidationError('Provide deliveryCashLimit, deliveryWithdrawalLimit and/or maxConcurrentOrders');
    }
    if (zoneOid) {
        // Validate everything before writing so a bad value never saves half an update.
        const values = Object.fromEntries(provided.map((field) => [field, parseCashLimitOverride(field, body[field])]));
        await saveZoneOverrides(zoneOid, values, adminUser);
    } else {
        await upsertDefaultCashLimit(body);
    }
    return getAdminDeliveryCashLimitSettings(zoneOid ? String(zoneOid) : '');
}

export async function updateDeliveryEmergencyHelp(body = {}, adminUser = null) {
    const zoneOid = parseZoneIdParam(body.zoneId);
    if (zoneOid) {
        const provided = EMERGENCY_FIELDS.filter((field) => body[field] !== undefined);
        if (provided.length === 0) {
            throw new ValidationError('Provide at least one emergency number');
        }
        const values = Object.fromEntries(provided.map((field) => [field, parseEmergencyOverride(body[field])]));
        await saveZoneOverrides(zoneOid, values, adminUser);
    } else {
        await upsertDefaultEmergency(validateDeliveryEmergencyHelpUpsertDto(body));
    }
    return getAdminDeliveryEmergencyHelp(zoneOid ? String(zoneOid) : '');
}
