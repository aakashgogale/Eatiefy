import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { FoodPricingRule, FoodPricingRuleAudit } from '../models/foodPricingRule.model.js';
import { FoodItem } from '../models/food.model.js';
import { FoodZone } from '../models/zone.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import {
  getFoodDisplayPrice,
  serializeFoodVariants,
} from './foodVariant.service.js';
import { invalidateCache } from '../../../../middleware/cache.js';

async function invalidateMenuCachesAfterPricingChange() {
  try {
    await Promise.all([
      invalidateCache('restaurant_menu:*'),
      invalidateCache('restaurant_detail:*'),
      invalidateCache('search_unified:*'),
    ]);
  } catch {
    // Cache invalidation must never block pricing writes
  }
}

const SCOPE_PRIORITY = {
  MENU_ITEM: 3,
  RESTAURANT: 2,
  GLOBAL: 1,
};

const MAX_PERCENTAGE = 500;

const toObjectId = (value) => {
  if (!value) return null;
  const str = String(value);
  if (!mongoose.Types.ObjectId.isValid(str)) return null;
  return new mongoose.Types.ObjectId(str);
};

const requireValidZoneId = (zoneId) => {
  const oid = toObjectId(zoneId);
  if (!oid) throw new ValidationError('zoneId is required');
  return oid;
};

async function assertZoneExists(zoneOid) {
  const exists = await FoodZone.exists({ _id: zoneOid });
  if (!exists) throw new ValidationError('Invalid zoneId');
}

async function getRestaurantIdsInZone(zoneOid) {
  return FoodRestaurant.find({ zoneId: zoneOid }).distinct('_id');
}

async function resolveZoneIdsForPricing({ restaurantIds = [], zoneIds = [] } = {}) {
  const resolved = new Map(
    (zoneIds || [])
      .map(toObjectId)
      .filter(Boolean)
      .map((oid) => [String(oid), oid]),
  );

  const restaurantOids = [
    ...new Map(
      (restaurantIds || [])
        .map(toObjectId)
        .filter(Boolean)
        .map((oid) => [String(oid), oid]),
    ).values(),
  ];

  if (!resolved.size && restaurantOids.length) {
    const rests = await FoodRestaurant.find({ _id: { $in: restaurantOids } })
      .select('zoneId')
      .lean();
    for (const rest of rests) {
      if (rest?.zoneId) {
        const oid = toObjectId(rest.zoneId);
        if (oid) resolved.set(String(oid), oid);
      }
    }
  }

  return [...resolved.values()];
}

async function assertRestaurantsInZone(restaurantOids, zoneOid) {
  if (!restaurantOids.length) return;
  const restaurants = await FoodRestaurant.find({ _id: { $in: restaurantOids } })
    .select('zoneId')
    .lean();
  if (restaurants.length !== restaurantOids.length) {
    throw new ValidationError('One or more restaurants were not found');
  }
  const invalid = restaurants.find((r) => String(r.zoneId) !== String(zoneOid));
  if (invalid) {
    throw new ValidationError('All restaurants must belong to the selected zone');
  }
}

const buildPerformer = (actor = {}) => {
  if (!actor || typeof actor !== 'object') return null;
  return {
    userId: actor._id || actor.id || actor.userId || null,
    name: actor.name || actor.fullName || '',
    email: actor.email || '',
    phone: actor.phone || '',
    role: actor.role || '',
    roleName: actor.roleName || '',
    actionAt: new Date(),
  };
};

const snapshotRule = (rule) => {
  if (!rule) return null;
  return {
    id: String(rule._id || rule.id || ''),
    scope: rule.scope,
    zoneId: rule.zoneId ? String(rule.zoneId) : null,
    restaurantId: rule.restaurantId ? String(rule.restaurantId) : null,
    menuItemId: rule.menuItemId ? String(rule.menuItemId) : null,
    type: rule.type,
    value: Number(rule.value) || 0,
    status: rule.status,
    priority: Number(rule.priority) || 0,
  };
};

export const calculateOtherPriceFromRule = (basePrice, rule) => {
  const base = Number(basePrice) || 0;
  if (!rule || base <= 0) {
    return {
      basePrice: base,
      otherPrice: 0,
      markupAmount: 0,
    };
  }

  const value = Number(rule.value) || 0;
  let otherPrice = base;
  if (rule.type === 'PERCENTAGE') {
    otherPrice = base + (base * value) / 100;
  } else if (rule.type === 'FIXED') {
    otherPrice = base + value;
  }

  otherPrice = Math.round(otherPrice * 100) / 100;
  if (otherPrice < base) otherPrice = base;

  return {
    basePrice: base,
    otherPrice,
    markupAmount: Math.round((otherPrice - base) * 100) / 100,
  };
};

export const previewOtherPrice = (basePrice, type, value) => {
  const normalizedType = String(type || '').toUpperCase();
  if (!['PERCENTAGE', 'FIXED'].includes(normalizedType)) {
    throw new ValidationError('type must be PERCENTAGE or FIXED');
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new ValidationError('value must be a number >= 0');
  }
  if (normalizedType === 'PERCENTAGE' && num > MAX_PERCENTAGE) {
    throw new ValidationError(`Percentage cannot exceed ${MAX_PERCENTAGE}%`);
  }
  const base = Number(basePrice);
  if (!Number.isFinite(base) || base < 0) {
    throw new ValidationError('basePrice must be a number >= 0');
  }
  return calculateOtherPriceFromRule(base, { type: normalizedType, value: num });
};

/**
 * Load active rules needed for a restaurant (+ optional menu items) in one query.
 */
export async function loadActivePricingRules({ restaurantId = null, menuItemIds = [], zoneId = null } = {}) {
  const restaurantOid = toObjectId(restaurantId);
  return loadActivePricingRulesForRestaurants({
    restaurantIds: restaurantOid ? [restaurantOid] : [],
    menuItemIds,
    zoneIds: zoneId ? [zoneId] : [],
  });
}

/**
 * Load GLOBAL + RESTAURANT(in ids) + MENU_ITEM(in ids) in a single query.
 * Prefer this over per-restaurant loops for cart/order/batch menus.
 */
export async function loadActivePricingRulesForRestaurants({
  restaurantIds = [],
  menuItemIds = [],
  zoneIds = [],
} = {}) {
  const restaurantOids = [
    ...new Map(
      (restaurantIds || [])
        .map(toObjectId)
        .filter(Boolean)
        .map((oid) => [String(oid), oid]),
    ).values(),
  ];
  const menuOids = [
    ...new Map(
      (menuItemIds || [])
        .map(toObjectId)
        .filter(Boolean)
        .map((oid) => [String(oid), oid]),
    ).values(),
  ];

  const zoneOids = await resolveZoneIdsForPricing({ restaurantIds: restaurantOids, zoneIds });

  const or = [];
  if (zoneOids.length) {
    or.push({ scope: 'GLOBAL', zoneId: { $in: zoneOids } });
  }
  if (restaurantOids.length) {
    or.push({ scope: 'RESTAURANT', restaurantId: { $in: restaurantOids } });
  }
  if (menuOids.length) {
    or.push({ scope: 'MENU_ITEM', menuItemId: { $in: menuOids } });
  }

  if (!or.length) return [];

  return FoodPricingRule.find({
    isDeleted: false,
    status: 'active',
    $or: or,
  })
    .sort({ priority: -1, updatedAt: -1 })
    .lean();
}

/**
 * Pick the winning rule for one food item from a preloaded rules list.
 */
export function resolvePricingRuleForItem(food, rules = []) {
  const foodId = String(food?._id || food?.id || '');
  const restaurantId = String(food?.restaurantId || '');

  let best = null;
  let bestRank = -1;

  for (const rule of rules) {
    if (!rule || rule.isDeleted || rule.status !== 'active') continue;

    let matches = false;
    if (rule.scope === 'GLOBAL') {
      matches = true;
    } else if (rule.scope === 'RESTAURANT') {
      matches = restaurantId && String(rule.restaurantId) === restaurantId;
    } else if (rule.scope === 'MENU_ITEM') {
      matches = foodId && String(rule.menuItemId) === foodId;
    }

    if (!matches) continue;

    const rank =
      (SCOPE_PRIORITY[rule.scope] || 0) * 1000 + (Number(rule.priority) || 0);
    if (rank > bestRank) {
      bestRank = rank;
      best = rule;
    } else if (rank === bestRank && best) {
      // Deterministic tie-break if duplicate active rules exist
      const bestTime = new Date(best.updatedAt || 0).getTime();
      const ruleTime = new Date(rule.updatedAt || 0).getTime();
      if (ruleTime > bestTime) best = rule;
      else if (ruleTime === bestTime && String(rule._id) > String(best._id)) best = rule;
    }
  }

  return best;
}

/**
 * Apply hierarchy to a food document / plain object.
 * Returns display fields without mutating DB price.
 *
 * Admin pricing: `price` = selling (base + markup), `basePrice` = restaurant,
 * `markupAmount` = platform share. Do NOT store selling price in `otherPrice`.
 */
export function applyOtherPriceToFood(food, rules = []) {
  const rule = resolvePricingRuleForItem(food, rules);
  const basePrice = getFoodDisplayPrice(food);

  const variants = serializeFoodVariants(food?.variants || food?.variations || []).map((variant) => {
    const variantBase = Number(variant.price) || 0;
    if (rule) {
      const calc = calculateOtherPriceFromRule(variantBase, rule);
      return {
        ...variant,
        basePrice: variantBase,
        price: calc.otherPrice,
        otherPrice: 0,
        markupAmount: calc.markupAmount,
        appliedPricingType: rule.type,
        appliedPricingValue: Number(rule.value) || 0,
        pricingScope: rule.scope,
      };
    }
    return {
      ...variant,
      basePrice: variantBase,
      price: variantBase,
      otherPrice: 0,
      markupAmount: 0,
      appliedPricingType: null,
      appliedPricingValue: null,
      pricingScope: null,
    };
  });

  let appliedPricingType = null;
  let appliedPricingValue = null;
  let pricingScope = null;
  let markupAmount = 0;
  let sellingPrice = basePrice;

  if (rule) {
    const calc = calculateOtherPriceFromRule(basePrice, rule);
    sellingPrice = calc.otherPrice;
    markupAmount = calc.markupAmount;
    appliedPricingType = rule.type;
    appliedPricingValue = Number(rule.value) || 0;
    pricingScope = rule.scope;
  } else if (variants.length > 0) {
    const adminVariants = variants.filter(
      (v) =>
        v.pricingScope &&
        Number(v.markupAmount) > 0 &&
        Number(v.price) > Number(v.basePrice),
    );
    if (adminVariants.length) {
      sellingPrice = Math.min(...adminVariants.map((v) => Number(v.price) || 0));
      markupAmount = Math.max(0, Math.round((sellingPrice - basePrice) * 100) / 100);
      appliedPricingType = adminVariants[0].appliedPricingType || null;
      appliedPricingValue = adminVariants[0].appliedPricingValue ?? null;
      pricingScope = adminVariants[0].pricingScope || null;
    }
  }

  return {
    ...food,
    basePrice,
    price: sellingPrice,
    // otherPrice is deprecated for selling; keep 0 so legacy compare-at paths stay off.
    otherPrice: 0,
    markupAmount,
    appliedPricingType,
    appliedPricingValue,
    pricingScope,
    pricingRule: rule
      ? {
          id: String(rule._id),
          scope: rule.scope,
          type: rule.type,
          value: Number(rule.value) || 0,
        }
      : null,
    discountPercentage: 0,
    variants,
    variations: variants,
  };
}

/**
 * Batch-apply rules for foods belonging to one or many restaurants.
 */
export async function applyOtherPriceToFoods(foods = []) {
  if (!Array.isArray(foods) || foods.length === 0) return [];

  const restaurantIds = [
    ...new Set(foods.map((f) => String(f?.restaurantId || '')).filter(Boolean)),
  ];
  const menuItemIds = foods.map((f) => f?._id || f?.id).filter(Boolean);

  const allRules = await loadActivePricingRulesForRestaurants({
    restaurantIds,
    menuItemIds,
  });

  return foods.map((food) => applyOtherPriceToFood(food, allRules));
}

export async function applyOtherPriceToSingleFood(food) {
  if (!food) return food;
  const [priced] = await applyOtherPriceToFoods([food]);
  return priced;
}

const validateRuleInput = ({ scope, type, value, restaurantId, menuItemId }) => {
  if (!['GLOBAL', 'RESTAURANT', 'MENU_ITEM'].includes(scope)) {
    throw new ValidationError('Invalid pricing scope');
  }
  if (!['PERCENTAGE', 'FIXED'].includes(type)) {
    throw new ValidationError('type must be PERCENTAGE or FIXED');
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new ValidationError('value must be a number >= 0');
  }
  if (type === 'PERCENTAGE' && num > MAX_PERCENTAGE) {
    throw new ValidationError(`Percentage cannot exceed ${MAX_PERCENTAGE}%`);
  }

  if (scope === 'GLOBAL') {
    return { restaurantId: null, menuItemId: null, value: num };
  }
  if (scope === 'RESTAURANT') {
    const rid = toObjectId(restaurantId);
    if (!rid) throw new ValidationError('restaurantId is required for restaurant pricing');
    return { restaurantId: rid, menuItemId: null, value: num };
  }
  const mid = toObjectId(menuItemId);
  if (!mid) throw new ValidationError('menuItemId is required for menu item pricing');
  const rid = toObjectId(restaurantId);
  return { restaurantId: rid, menuItemId: mid, value: num };
};

const writeAudit = async ({ rule, action, oldValue, newValue, actor }) => {
  await FoodPricingRuleAudit.create({
    ruleId: rule._id,
    action,
    scope: rule.scope,
    restaurantId: rule.restaurantId || null,
    menuItemId: rule.menuItemId || null,
    oldValue,
    newValue,
    performedBy: buildPerformer(actor),
  });
};

/**
 * Upsert the single active rule for a scope key (deactivates siblings).
 */
export async function upsertPricingRule(payload = {}, actor = null) {
  const scope = String(payload.scope || '').toUpperCase();
  const type = String(payload.type || '').toUpperCase();
  const status = payload.status === 'inactive' ? 'inactive' : 'active';
  const zoneOid = requireValidZoneId(payload.zoneId);
  await assertZoneExists(zoneOid);

  const ids = validateRuleInput({
    scope,
    type,
    value: payload.value,
    restaurantId: payload.restaurantId,
    menuItemId: payload.menuItemId,
  });

  // Resolve restaurantId for menu items; verify ownership when provided
  if (scope === 'MENU_ITEM') {
    const food = await FoodItem.findById(ids.menuItemId).select('restaurantId').lean();
    if (!food) throw new ValidationError('Menu item not found');
    if (ids.restaurantId && String(food.restaurantId) !== String(ids.restaurantId)) {
      throw new ValidationError('menuItemId does not belong to restaurantId');
    }
    ids.restaurantId = food.restaurantId;
  }

  if (scope === 'RESTAURANT' || scope === 'MENU_ITEM') {
    await assertRestaurantsInZone([ids.restaurantId], zoneOid);
  }

  const filter = {
    scope,
    isDeleted: false,
    restaurantId: scope === 'GLOBAL' ? null : ids.restaurantId,
    menuItemId: scope === 'MENU_ITEM' ? ids.menuItemId : null,
  };

  if (scope === 'GLOBAL') {
    filter.zoneId = zoneOid;
    filter.restaurantId = null;
    filter.menuItemId = null;
  } else if (scope === 'RESTAURANT') {
    filter.menuItemId = null;
  }

  const existing = await FoodPricingRule.findOne(filter).sort({ updatedAt: -1 });
  const performer = buildPerformer(actor);

  if (existing) {
    const oldValue = snapshotRule(existing);
    existing.type = type;
    existing.value = ids.value;
    existing.status = status;
    existing.priority = Number(payload.priority) || existing.priority || 0;
    existing.updatedBy = performer;
    existing.zoneId = zoneOid;
    if (scope === 'MENU_ITEM') existing.restaurantId = ids.restaurantId;
    await existing.save();

    // Soft-deactivate any accidental duplicates (all non-deleted siblings)
    await FoodPricingRule.updateMany(
      { ...filter, _id: { $ne: existing._id }, isDeleted: false },
      { $set: { status: 'inactive', isDeleted: true, updatedBy: performer } },
    );

    await writeAudit({
      rule: existing,
      action: 'UPDATE',
      oldValue,
      newValue: snapshotRule(existing),
      actor,
    });

    await invalidateMenuCachesAfterPricingChange();
    return existing.toObject();
  }

  let created;
  try {
    created = await FoodPricingRule.create({
      scope,
      zoneId: zoneOid,
      restaurantId: ids.restaurantId,
      menuItemId: ids.menuItemId,
      type,
      value: ids.value,
      status,
      priority: Number(payload.priority) || 0,
      createdBy: performer,
      updatedBy: performer,
    });
  } catch (error) {
    // Concurrent create racing unique partial index — fall through to update winner
    if (error?.code === 11000) {
      const raced = await FoodPricingRule.findOne(filter).sort({ updatedAt: -1 });
      if (raced) {
        const oldValue = snapshotRule(raced);
        raced.type = type;
        raced.value = ids.value;
        raced.status = status;
        raced.priority = Number(payload.priority) || raced.priority || 0;
        raced.updatedBy = performer;
        raced.isDeleted = false;
        raced.zoneId = zoneOid;
        if (scope === 'MENU_ITEM') raced.restaurantId = ids.restaurantId;
        await raced.save();
        await FoodPricingRule.updateMany(
          { ...filter, _id: { $ne: raced._id }, isDeleted: false },
          { $set: { status: 'inactive', isDeleted: true, updatedBy: performer } },
        );
        await writeAudit({
          rule: raced,
          action: 'UPDATE',
          oldValue,
          newValue: snapshotRule(raced),
          actor,
        });
        await invalidateMenuCachesAfterPricingChange();
        return raced.toObject();
      }
    }
    throw error;
  }

  // Soft-delete any raced duplicates created concurrently
  await FoodPricingRule.updateMany(
    { ...filter, _id: { $ne: created._id }, isDeleted: false },
    { $set: { status: 'inactive', isDeleted: true, updatedBy: performer } },
  );

  await writeAudit({
    rule: created,
    action: 'CREATE',
    oldValue: null,
    newValue: snapshotRule(created),
    actor,
  });

  await invalidateMenuCachesAfterPricingChange();
  return created.toObject();
}

export async function deletePricingRule(ruleId, actor = null) {
  const oid = toObjectId(ruleId);
  if (!oid) throw new ValidationError('Invalid rule id');

  const rule = await FoodPricingRule.findOne({ _id: oid, isDeleted: false });
  if (!rule) throw new ValidationError('Pricing rule not found');

  const oldValue = snapshotRule(rule);
  rule.isDeleted = true;
  rule.status = 'inactive';
  rule.updatedBy = buildPerformer(actor);
  await rule.save();

  await writeAudit({
    rule,
    action: 'DELETE',
    oldValue,
    newValue: snapshotRule(rule),
    actor,
  });

  await invalidateMenuCachesAfterPricingChange();
  return { ok: true };
}

const MAX_BULK_RESTAURANTS = 500;

/**
 * Apply the same RESTAURANT-scope rule to many restaurants in one operation.
 * Uses bulkWrite / insertMany; wraps in a transaction when the cluster supports it.
 */
export async function bulkUpsertRestaurantPricingRules(payload = {}, actor = null) {
  const type = String(payload.type || '').toUpperCase();
  if (!['PERCENTAGE', 'FIXED'].includes(type)) {
    throw new ValidationError('type must be PERCENTAGE or FIXED');
  }

  const num = Number(payload.value);
  if (!Number.isFinite(num) || num < 0) {
    throw new ValidationError('value must be a number >= 0');
  }
  if (type === 'PERCENTAGE' && num > MAX_PERCENTAGE) {
    throw new ValidationError(`Percentage cannot exceed ${MAX_PERCENTAGE}%`);
  }

  const zoneOid = requireValidZoneId(payload.zoneId);
  await assertZoneExists(zoneOid);

  const rawIds = Array.isArray(payload.restaurantIds) ? payload.restaurantIds : [];
  const restaurantOids = [
    ...new Map(
      rawIds
        .map(toObjectId)
        .filter(Boolean)
        .map((oid) => [String(oid), oid]),
    ).values(),
  ];

  if (!restaurantOids.length) {
    throw new ValidationError('Select at least one restaurant');
  }
  if (restaurantOids.length > MAX_BULK_RESTAURANTS) {
    throw new ValidationError(`Maximum ${MAX_BULK_RESTAURANTS} restaurants per bulk update`);
  }

  await assertRestaurantsInZone(restaurantOids, zoneOid);

  const performer = buildPerformer(actor);
  const status = payload.status === 'inactive' ? 'inactive' : 'active';

  const run = async (session = null) => {
    const findOpts = session ? { session } : {};
    const existing = await FoodPricingRule.find(
      {
        scope: 'RESTAURANT',
        isDeleted: false,
        restaurantId: { $in: restaurantOids },
        $or: [{ menuItemId: null }, { menuItemId: { $exists: false } }],
      },
      null,
      findOpts,
    ).lean();

    // Keep the newest active-looking doc per restaurant; extras get soft-deactivated.
    const primaryByRestaurant = new Map();
    const duplicateIds = [];
    for (const rule of existing) {
      const key = String(rule.restaurantId);
      const prev = primaryByRestaurant.get(key);
      if (!prev) {
        primaryByRestaurant.set(key, rule);
        continue;
      }
      const prevTime = new Date(prev.updatedAt || 0).getTime();
      const nextTime = new Date(rule.updatedAt || 0).getTime();
      if (nextTime >= prevTime) {
        duplicateIds.push(prev._id);
        primaryByRestaurant.set(key, rule);
      } else {
        duplicateIds.push(rule._id);
      }
    }

    const updateOps = [];
    const audits = [];
    const toCreate = [];

    for (const rid of restaurantOids) {
      const key = String(rid);
      const existingRule = primaryByRestaurant.get(key);
      if (existingRule) {
        updateOps.push({
          updateOne: {
            filter: { _id: existingRule._id },
            update: {
              $set: {
                type,
                value: num,
                status,
                priority: Number(payload.priority) || 0,
                zoneId: zoneOid,
                updatedBy: performer,
                menuItemId: null,
              },
            },
          },
        });
        audits.push({
          ruleId: existingRule._id,
          action: 'UPDATE',
          scope: 'RESTAURANT',
          restaurantId: rid,
          menuItemId: null,
          oldValue: snapshotRule(existingRule),
          newValue: {
            ...snapshotRule(existingRule),
            type,
            value: num,
            status,
          },
          performedBy: performer,
        });
      } else {
        toCreate.push({
          scope: 'RESTAURANT',
          zoneId: zoneOid,
          restaurantId: rid,
          menuItemId: null,
          type,
          value: num,
          status,
          priority: Number(payload.priority) || 0,
          isDeleted: false,
          createdBy: performer,
          updatedBy: performer,
        });
      }
    }

    if (duplicateIds.length) {
      updateOps.push({
        updateMany: {
          filter: { _id: { $in: duplicateIds }, isDeleted: false },
          update: {
            $set: { status: 'inactive', updatedBy: performer },
          },
        },
      });
    }

    const writeOpts = session ? { session, ordered: false } : { ordered: false };
    if (updateOps.length) {
      await FoodPricingRule.bulkWrite(updateOps, writeOpts);
    }

    let createdCount = 0;
    if (toCreate.length) {
      const created = await FoodPricingRule.insertMany(toCreate, {
        ...(session ? { session } : {}),
        ordered: false,
      });
      createdCount = created.length;
      for (const doc of created) {
        audits.push({
          ruleId: doc._id,
          action: 'CREATE',
          scope: 'RESTAURANT',
          restaurantId: doc.restaurantId,
          menuItemId: null,
          oldValue: null,
          newValue: snapshotRule(doc),
          performedBy: performer,
        });
      }
    }

    if (audits.length) {
      await FoodPricingRuleAudit.insertMany(audits, {
        ...(session ? { session } : {}),
        ordered: false,
      });
    }

    return {
      updated: restaurantOids.length,
      created: createdCount,
      modified: updateOps.filter((op) => op.updateOne).length,
    };
  };

  const isTxnUnsupportedError = (error) => {
    const msg = String(error?.message || '');
    return (
      error?.code === 20 ||
      /Transaction numbers are only allowed on a replica set member/i.test(msg)
    );
  };

  let result;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    result = await run(session);
    await session.commitTransaction();
  } catch (error) {
    try {
      await session.abortTransaction();
    } catch {
      // ignore
    }
    if (!isTxnUnsupportedError(error)) throw error;
    // Standalone / non-replica Mongo: unique partial indexes still prevent
    // duplicate active rules if this non-txn path races.
    result = await run(null);
  } finally {
    session.endSession();
  }

  await invalidateMenuCachesAfterPricingChange();
  return result;
}

const MAX_BULK_MENU_ITEMS = 500;

/**
 * Apply the same MENU_ITEM-scope rule to many items in one restaurant.
 * Validates ownership, uses bulkWrite / insertMany, prevents duplicate actives.
 */
export async function bulkUpsertMenuItemPricingRules(payload = {}, actor = null) {
  const type = String(payload.type || '').toUpperCase();
  if (!['PERCENTAGE', 'FIXED'].includes(type)) {
    throw new ValidationError('type must be PERCENTAGE or FIXED');
  }

  const num = Number(payload.value);
  if (!Number.isFinite(num) || num < 0) {
    throw new ValidationError('value must be a number >= 0');
  }
  if (type === 'PERCENTAGE' && num > MAX_PERCENTAGE) {
    throw new ValidationError(`Percentage cannot exceed ${MAX_PERCENTAGE}%`);
  }

  const zoneOid = requireValidZoneId(payload.zoneId);
  await assertZoneExists(zoneOid);

  const restaurantOid = toObjectId(payload.restaurantId);
  if (!restaurantOid) {
    throw new ValidationError('restaurantId is required');
  }
  await assertRestaurantsInZone([restaurantOid], zoneOid);

  const rawIds = Array.isArray(payload.menuItemIds) ? payload.menuItemIds : [];
  const menuItemOids = [
    ...new Map(
      rawIds
        .map(toObjectId)
        .filter(Boolean)
        .map((oid) => [String(oid), oid]),
    ).values(),
  ];

  if (!menuItemOids.length) {
    throw new ValidationError('Select at least one menu item');
  }
  if (menuItemOids.length > MAX_BULK_MENU_ITEMS) {
    throw new ValidationError(`Maximum ${MAX_BULK_MENU_ITEMS} menu items per bulk update`);
  }

  const foods = await FoodItem.find({ _id: { $in: menuItemOids } })
    .select('_id restaurantId')
    .lean();
  if (foods.length !== menuItemOids.length) {
    throw new ValidationError('One or more menu items were not found');
  }
  const invalid = foods.find((f) => String(f.restaurantId) !== String(restaurantOid));
  if (invalid) {
    throw new ValidationError('All menu items must belong to the selected restaurant');
  }

  const performer = buildPerformer(actor);
  const status = payload.status === 'inactive' ? 'inactive' : 'active';

  const run = async (session = null) => {
    const findOpts = session ? { session } : {};
    const existing = await FoodPricingRule.find(
      {
        scope: 'MENU_ITEM',
        isDeleted: false,
        menuItemId: { $in: menuItemOids },
      },
      null,
      findOpts,
    ).lean();

    const primaryByItem = new Map();
    const duplicateIds = [];
    for (const rule of existing) {
      const key = String(rule.menuItemId);
      const prev = primaryByItem.get(key);
      if (!prev) {
        primaryByItem.set(key, rule);
        continue;
      }
      const prevTime = new Date(prev.updatedAt || 0).getTime();
      const nextTime = new Date(rule.updatedAt || 0).getTime();
      if (nextTime >= prevTime) {
        duplicateIds.push(prev._id);
        primaryByItem.set(key, rule);
      } else {
        duplicateIds.push(rule._id);
      }
    }

    const updateOps = [];
    const audits = [];
    const toCreate = [];

    for (const mid of menuItemOids) {
      const key = String(mid);
      const existingRule = primaryByItem.get(key);
      if (existingRule) {
        updateOps.push({
          updateOne: {
            filter: { _id: existingRule._id },
            update: {
              $set: {
                type,
                value: num,
                status,
                priority: Number(payload.priority) || 0,
                zoneId: zoneOid,
                restaurantId: restaurantOid,
                updatedBy: performer,
              },
            },
          },
        });
        audits.push({
          ruleId: existingRule._id,
          action: 'UPDATE',
          scope: 'MENU_ITEM',
          restaurantId: restaurantOid,
          menuItemId: mid,
          oldValue: snapshotRule(existingRule),
          newValue: {
            ...snapshotRule(existingRule),
            type,
            value: num,
            status,
            restaurantId: String(restaurantOid),
          },
          performedBy: performer,
        });
      } else {
        toCreate.push({
          scope: 'MENU_ITEM',
          zoneId: zoneOid,
          restaurantId: restaurantOid,
          menuItemId: mid,
          type,
          value: num,
          status,
          priority: Number(payload.priority) || 0,
          isDeleted: false,
          createdBy: performer,
          updatedBy: performer,
        });
      }
    }

    if (duplicateIds.length) {
      updateOps.push({
        updateMany: {
          filter: { _id: { $in: duplicateIds }, isDeleted: false },
          update: {
            $set: {
              status: 'inactive',
              isDeleted: true,
              updatedBy: performer,
            },
          },
        },
      });
    }

    const writeOpts = session ? { session, ordered: false } : { ordered: false };
    if (updateOps.length) {
      await FoodPricingRule.bulkWrite(updateOps, writeOpts);
    }

    let createdCount = 0;
    if (toCreate.length) {
      const created = await FoodPricingRule.insertMany(toCreate, {
        ...(session ? { session } : {}),
        ordered: false,
      });
      createdCount = created.length;
      for (const doc of created) {
        audits.push({
          ruleId: doc._id,
          action: 'CREATE',
          scope: 'MENU_ITEM',
          restaurantId: doc.restaurantId,
          menuItemId: doc.menuItemId,
          oldValue: null,
          newValue: snapshotRule(doc),
          performedBy: performer,
        });
      }
    }

    if (audits.length) {
      await FoodPricingRuleAudit.insertMany(audits, {
        ...(session ? { session } : {}),
        ordered: false,
      });
    }

    return {
      updated: menuItemOids.length,
      created: createdCount,
      modified: updateOps.filter((op) => op.updateOne).length,
    };
  };

  const isTxnUnsupportedError = (error) => {
    const msg = String(error?.message || '');
    return (
      error?.code === 20 ||
      /Transaction numbers are only allowed on a replica set member/i.test(msg)
    );
  };

  let result;
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    result = await run(session);
    await session.commitTransaction();
  } catch (error) {
    try {
      await session.abortTransaction();
    } catch {
      // ignore
    }
    if (!isTxnUnsupportedError(error)) throw error;
    result = await run(null);
  } finally {
    session.endSession();
  }

  await invalidateMenuCachesAfterPricingChange();
  return result;
}

export async function listPricingRules({ scope, restaurantId, menuItemId, status, zoneId } = {}) {
  const zoneOid = requireValidZoneId(zoneId);
  const restaurantIdsInZone = await getRestaurantIdsInZone(zoneOid);

  const query = {
    isDeleted: false,
    $and: [
      {
        $or: [
          { scope: 'GLOBAL', zoneId: zoneOid },
          { scope: 'RESTAURANT', restaurantId: { $in: restaurantIdsInZone } },
          { scope: 'MENU_ITEM', restaurantId: { $in: restaurantIdsInZone } },
        ],
      },
    ],
  };
  if (scope) query.scope = String(scope).toUpperCase();
  if (status) query.status = status;
  if (restaurantId) query.restaurantId = toObjectId(restaurantId);
  if (menuItemId) query.menuItemId = toObjectId(menuItemId);

  const rules = await FoodPricingRule.find(query).sort({ scope: 1, updatedAt: -1 }).lean();
  return rules.map((rule) => ({
    ...snapshotRule(rule),
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    createdBy: rule.createdBy,
    updatedBy: rule.updatedBy,
  }));
}

export async function listPricingAudits({ restaurantId, limit = 50 } = {}) {
  const query = {};
  if (restaurantId) query.restaurantId = toObjectId(restaurantId);
  const rows = await FoodPricingRuleAudit.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(200, Math.max(1, Number(limit) || 50)))
    .lean();
  return rows;
}

export async function getPricingManagementSummary({ zoneId } = {}) {
  const zoneOid = requireValidZoneId(zoneId);
  const restaurantIdsInZone = await getRestaurantIdsInZone(zoneOid);

  const [globalRule, restaurantCount, menuItemCount] = await Promise.all([
    FoodPricingRule.findOne({
      scope: 'GLOBAL',
      zoneId: zoneOid,
      isDeleted: false,
      status: 'active',
    })
      .sort({ updatedAt: -1 })
      .lean(),
    FoodPricingRule.countDocuments({
      scope: 'RESTAURANT',
      restaurantId: { $in: restaurantIdsInZone },
      isDeleted: false,
      status: 'active',
    }),
    FoodPricingRule.countDocuments({
      scope: 'MENU_ITEM',
      restaurantId: { $in: restaurantIdsInZone },
      isDeleted: false,
      status: 'active',
    }),
  ]);

  return {
    zoneId: String(zoneOid),
    global: globalRule ? snapshotRule(globalRule) : null,
    activeRestaurantOverrides: restaurantCount,
    activeMenuItemOverrides: menuItemCount,
  };
}
