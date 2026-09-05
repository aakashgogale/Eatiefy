import { FoodSystemConfig } from '../models/systemConfig.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { invalidateMaintenanceModeCache } from '../services/maintenanceMode.service.js';

// Customization toggles live in FoodSystemConfig as individual keys.
const CUSTOMIZATION_TOGGLES = [
    {
        key: 'cod_enabled',
        defaultValue: true,
        description: 'Global toggle for COD visibility (Excludes Takeaway)'
    },
    {
        key: 'takeaway_cod_enabled',
        defaultValue: true,
        description: 'Global toggle for takeaway COD visibility'
    },
    {
        key: 'delivery_cod_enabled',
        defaultValue: true,
        description: 'Global toggle for delivery COD visibility'
    },
    {
        key: 'dining_cod_enabled',
        defaultValue: true,
        description: 'Global toggle for dining COD visibility'
    },
    {
        key: 'wallet_payment_enabled',
        defaultValue: true,
        description: 'Global toggle for wallet payment availability'
    },
    {
        key: 'online_payment_enabled',
        defaultValue: true,
        description: 'Global toggle for online payment availability'
    },
    {
        key: 'default_location_enabled',
        defaultValue: false,
        description: 'Enforce default Indore location and disable auto-prompt for new users/guests (App Store mode)'
    },
    {
        key: 'cod_blocking_feature_enabled',
        defaultValue: true,
        description: 'Global toggle to enable/disable the automatic COD blocking feature (blocks COD for users with 4 consecutive COD cancellations)'
    },
    {
        key: 'maintenance_mode_enabled',
        defaultValue: false,
        description: 'When enabled, user / restaurant / delivery apps show Under Maintenance (admin stays available)'
    }
];

function resolveToggleValue(configDoc, defaultValue) {
    if (!configDoc) return defaultValue;
    return configDoc.value === true;
}

function getCustomizationAllowlist() {
    return CUSTOMIZATION_TOGGLES.map(t => t.key);
}

export async function getCustomizationSettings(req, res) {
    const keys = getCustomizationAllowlist();
    const docs = await FoodSystemConfig.find({ key: { $in: keys } }).lean();
    const map = new Map(docs.map(d => [d.key, d]));

    const data = {};
    for (const t of CUSTOMIZATION_TOGGLES) {
        data[t.key] = resolveToggleValue(map.get(t.key) || null, t.defaultValue);
    }

    res.json({ success: true, data });
}

export async function updateCustomizationSettings(req, res) {
    const body = req.body ?? {};
    const allowlist = new Set(getCustomizationAllowlist());

    const updates = [];
    for (const [key, value] of Object.entries(body)) {
        if (!allowlist.has(key)) continue;
        if (typeof value !== 'boolean') {
            throw new ValidationError(`${key} must be a boolean`);
        }
        const meta = CUSTOMIZATION_TOGGLES.find(t => t.key === key);
        updates.push({ key, value, description: meta?.description });
    }

    if (updates.length === 0) {
        throw new ValidationError(`No valid customization keys provided. Allowed: ${getCustomizationAllowlist().join(', ')}`);
    }

    await Promise.all(
        updates.map(u =>
            FoodSystemConfig.findOneAndUpdate(
                { key: u.key },
                {
                    $set: {
                        key: u.key,
                        value: u.value,
                        description: u.description,
                        updatedBy: {
                            role: req.user?.role || 'ADMIN',
                            adminId: req.user?._id,
                            at: new Date()
                        }
                    }
                },
                { upsert: true, new: true }
            )
        )
    );

    const maintenanceUpdate = updates.find((u) => u.key === 'maintenance_mode_enabled');
    if (maintenanceUpdate) {
        invalidateMaintenanceModeCache(maintenanceUpdate.value === true);
    }

    const keys = getCustomizationAllowlist();
    const docs = await FoodSystemConfig.find({ key: { $in: keys } }).lean();
    const map = new Map(docs.map(d => [d.key, d]));

    const data = {};
    for (const t of CUSTOMIZATION_TOGGLES) {
        data[t.key] = resolveToggleValue(map.get(t.key) || null, t.defaultValue);
    }

    res.json({ success: true, data });
}

export async function getTakeawayCodStatus(req, res) {
    const toggleMeta = CUSTOMIZATION_TOGGLES.find(t => t.key === 'takeaway_cod_enabled');
    const config = await FoodSystemConfig.findOne({ key: 'takeaway_cod_enabled' }).lean();
    const takeawayCodEnabled = resolveToggleValue(config, toggleMeta?.defaultValue ?? true);
    
    res.json({
        success: true,
        enabled: takeawayCodEnabled,
        data: { takeaway_cod_enabled: takeawayCodEnabled }
    });
}

const RESTAURANT_SETTINGS = {
    deliveryAcceptOrderTimeMinutes: {
        key: 'restaurant_delivery_accept_order_time_minutes',
        min: 1,
        max: 60,
        description: 'Minutes a restaurant has to accept a new delivery order before auto-rejection'
    },
    takeawayAcceptOrderTimeMinutes: {
        key: 'restaurant_takeaway_accept_order_time_minutes',
        min: 1,
        max: 60,
        description: 'Minutes a restaurant has to accept a new takeaway order before auto-rejection'
    }
};

const LEGACY_ACCEPT_ORDER_TIME_KEY = 'restaurant_accept_order_time_minutes';

function parseAcceptOrderTimeMinutes(value, fieldName = 'acceptOrderTimeMinutes') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new ValidationError(`${fieldName} must be a number between 1 and 60`);
    }
    const rounded = Math.round(parsed);
    if (rounded < 1 || rounded > 60) {
        throw new ValidationError(`${fieldName} must be between 1 and 60`);
    }
    return rounded;
}

function readStoredAcceptOrderMinutes(configValue) {
    if (configValue == null) return null;
    try {
        return parseAcceptOrderTimeMinutes(configValue);
    } catch {
        return null;
    }
}

async function resolveRestaurantSettings() {
    const keys = [
        RESTAURANT_SETTINGS.deliveryAcceptOrderTimeMinutes.key,
        RESTAURANT_SETTINGS.takeawayAcceptOrderTimeMinutes.key,
        LEGACY_ACCEPT_ORDER_TIME_KEY
    ];
    const docs = await FoodSystemConfig.find({ key: { $in: keys } }).lean();
    const map = new Map(docs.map((d) => [d.key, d]));

    const legacyMinutes = map.get(LEGACY_ACCEPT_ORDER_TIME_KEY)?.value ?? null;

    let deliveryAcceptOrderTimeMinutes = readStoredAcceptOrderMinutes(
        map.get(RESTAURANT_SETTINGS.deliveryAcceptOrderTimeMinutes.key)?.value ?? null
    );
    let takeawayAcceptOrderTimeMinutes = readStoredAcceptOrderMinutes(
        map.get(RESTAURANT_SETTINGS.takeawayAcceptOrderTimeMinutes.key)?.value ?? null
    );

    if (deliveryAcceptOrderTimeMinutes == null && legacyMinutes != null) {
        deliveryAcceptOrderTimeMinutes = readStoredAcceptOrderMinutes(legacyMinutes);
    }
    if (takeawayAcceptOrderTimeMinutes == null && legacyMinutes != null) {
        takeawayAcceptOrderTimeMinutes = readStoredAcceptOrderMinutes(legacyMinutes);
    }

    return { deliveryAcceptOrderTimeMinutes, takeawayAcceptOrderTimeMinutes };
}

export async function getRestaurantSettings(req, res) {
    const data = await resolveRestaurantSettings();
    res.json({ success: true, data });
}

export async function updateRestaurantSettings(req, res) {
    const body = req.body ?? {};
    const updates = [];

    if (body.deliveryAcceptOrderTimeMinutes !== undefined) {
        const value = parseAcceptOrderTimeMinutes(
            body.deliveryAcceptOrderTimeMinutes,
            'deliveryAcceptOrderTimeMinutes'
        );
        updates.push({
            key: RESTAURANT_SETTINGS.deliveryAcceptOrderTimeMinutes.key,
            value,
            description: RESTAURANT_SETTINGS.deliveryAcceptOrderTimeMinutes.description
        });
    }

    if (body.takeawayAcceptOrderTimeMinutes !== undefined) {
        const value = parseAcceptOrderTimeMinutes(
            body.takeawayAcceptOrderTimeMinutes,
            'takeawayAcceptOrderTimeMinutes'
        );
        updates.push({
            key: RESTAURANT_SETTINGS.takeawayAcceptOrderTimeMinutes.key,
            value,
            description: RESTAURANT_SETTINGS.takeawayAcceptOrderTimeMinutes.description
        });
    }

    if (updates.length === 0) {
        throw new ValidationError(
            'Provide deliveryAcceptOrderTimeMinutes and/or takeawayAcceptOrderTimeMinutes (1-60)'
        );
    }

    await Promise.all(
        updates.map((u) =>
            FoodSystemConfig.findOneAndUpdate(
                { key: u.key },
                {
                    $set: {
                        key: u.key,
                        value: u.value,
                        description: u.description,
                        updatedBy: {
                            role: req.user?.role || 'ADMIN',
                            adminId: req.user?._id,
                            at: new Date()
                        }
                    }
                },
                { upsert: true, new: true }
            )
        )
    );

    const data = await resolveRestaurantSettings();
    res.json({ success: true, data });
}
