import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { logger } from '../../../../utils/logger.js';
import {
  resolveOrderDistanceKm,
  toGeoJsonPoint,
} from '../utils/googleMaps.js';
import { resolveCommissionRulesForZone } from '../../admin/services/zoneScopedSettings.service.js';

const COMMISSION_CACHE_MS = 10 * 1000;
/** @type {Map<string, { rules: any[], loadedAt: number }>} */
const commissionRulesCacheByZone = new Map();

function cacheKeyForZone(zoneId) {
  return zoneId ? String(zoneId) : '__fallback__';
}

async function getActiveCommissionRules(zoneId) {
  const key = cacheKeyForZone(zoneId);
  const now = Date.now();
  const cached = commissionRulesCacheByZone.get(key);
  if (cached && now - cached.loadedAt < COMMISSION_CACHE_MS) {
    return cached.rules;
  }
  const list = await resolveCommissionRulesForZone(zoneId);
  commissionRulesCacheByZone.set(key, { rules: list || [], loadedAt: now });
  return list || [];
}

export function invalidateCommissionRulesCache(zoneId) {
  if (zoneId) {
    commissionRulesCacheByZone.delete(cacheKeyForZone(zoneId));
  } else {
    commissionRulesCacheByZone.clear();
  }
}

/** Base payout when distance cannot be resolved (minDistance === 0 slab). */
export async function getBaseRiderPayoutFallback(zoneId) {
  const rules = await getActiveCommissionRules(zoneId);
  if (!rules.length) return 0;
  const baseRule =
    [...rules]
      .sort((a, b) => (a.minDistance || 0) - (b.minDistance || 0))
      .find((r) => Number(r.minDistance || 0) === 0) || null;
  const payout = Number(baseRule?.basePayout || 0);
  return Number.isFinite(payout) && payout > 0 ? Math.round(payout) : 0;
}

export async function getRiderEarning(distanceKm, zoneId) {
  const d = Number(distanceKm);
  if (!Number.isFinite(d) || d <= 0) return 0;
  const rules = await getActiveCommissionRules(zoneId);
  if (!rules.length) return 0;

  const sorted = [...rules].sort(
    (a, b) => (a.minDistance || 0) - (b.minDistance || 0),
  );
  const baseRule = sorted.find((r) => Number(r.minDistance || 0) === 0) || null;
  if (!baseRule) return 0;

  let earning = Number(baseRule.basePayout || 0);

  for (const r of sorted) {
    const perKm = Number(r.commissionPerKm || 0);
    if (!Number.isFinite(perKm) || perKm <= 0) continue;
    const min = Number(r.minDistance || 0);
    const max = r.maxDistance == null ? null : Number(r.maxDistance);
    if (d <= min) continue;
    const upper = max == null ? d : Math.min(d, max);
    const kmInSlab = Math.max(0, upper - min);
    if (kmInSlab > 0) {
      earning += kmInSlab * perKm;
    }
  }

  if (!Number.isFinite(earning) || earning <= 0) return 0;
  return Math.round(earning);
}

/**
 * Resolve coords (geocode if missing) + compute rider earning.
 * Falls back to base commission payout if distance still cannot be computed.
 */
export async function resolveRiderEarningForDelivery({
  restaurant,
  deliveryAddress,
  orderType = 'delivery',
  zoneId = null,
}) {
  if (orderType === 'takeaway') {
    return {
      riderEarning: 0,
      distanceKm: null,
      deliveryPoint: null,
      restaurantPoint: null,
      restaurantGeocoded: false,
      deliveryGeocoded: false,
    };
  }

  const resolvedZoneId =
    zoneId ||
    restaurant?.zoneId?._id ||
    restaurant?.zoneId ||
    null;

  const resolved = await resolveOrderDistanceKm(restaurant, deliveryAddress);
  let riderEarning = await getRiderEarning(resolved.distanceKm, resolvedZoneId);

  if (!riderEarning) {
    riderEarning = await getBaseRiderPayoutFallback(resolvedZoneId);
    if (riderEarning > 0) {
      logger.warn(
        `Rider earning fell back to base payout ₹${riderEarning} (zone=${resolvedZoneId || 'n/a'}, distanceKm=${resolved.distanceKm ?? 'n/a'}, geocoded restaurant=${resolved.restaurantGeocoded}, delivery=${resolved.deliveryGeocoded})`,
      );
    } else {
      logger.error(
        `CRITICAL: riderEarning still 0 — check Delivery Boy Commission for zone ${resolvedZoneId || 'n/a'} (need active minDistance=0 base slab) and Geocoding API. distanceKm=${resolved.distanceKm ?? 'n/a'}`,
      );
    }
  }

  return {
    riderEarning,
    distanceKm: resolved.distanceKm,
    distanceMode: resolved.distanceMode || null,
    deliveryPoint: resolved.deliveryPoint,
    restaurantPoint: resolved.restaurantPoint,
    restaurantGeocoded: resolved.restaurantGeocoded,
    deliveryGeocoded: resolved.deliveryGeocoded,
  };
}

/**
 * If delivered order still has riderEarning <= 0, geocode + recalculate and patch order fields.
 * Call before finalizing delivery complete.
 */
export async function ensureRiderEarningOnOrder(order) {
  if (!order || String(order.orderType || 'delivery') === 'takeaway') {
    return order;
  }

  const current = Number(order.riderEarning || 0);
  if (Number.isFinite(current) && current > 0) return order;

  let restaurant = order.restaurantId;
  if (!restaurant || !restaurant.location) {
    const restaurantId = restaurant?._id || restaurant;
    if (restaurantId) {
      restaurant = await FoodRestaurant.findById(restaurantId)
        .select(
          'restaurantName location zoneId addressLine1 addressLine2 area city state pincode',
        )
        .lean();
    }
  }

  const deliveryAddress = order.deliveryAddress || {};
  const earningResolved = await resolveRiderEarningForDelivery({
    restaurant,
    deliveryAddress,
    orderType: order.orderType || 'delivery',
    zoneId: order.zoneId || restaurant?.zoneId || null,
  });

  if (!earningResolved.riderEarning) return order;

  order.riderEarning = earningResolved.riderEarning;
  order.markModified?.('riderEarning');

  if (earningResolved.deliveryGeocoded && earningResolved.deliveryPoint) {
    const geo = toGeoJsonPoint(earningResolved.deliveryPoint);
    if (geo) {
      order.deliveryAddress = {
        ...(order.deliveryAddress?.toObject?.() || order.deliveryAddress || {}),
        location: geo,
      };
      order.markModified?.('deliveryAddress');
    }
  }

  // Keep platformProfit roughly consistent if pricing exists
  const deliveryFee = Number(order.pricing?.deliveryFee || 0);
  const platformFee = Number(order.pricing?.platformFee || 0);
  const restaurantCommission = Number(order.pricing?.restaurantCommission || 0);
  if (Number.isFinite(deliveryFee) || Number.isFinite(platformFee)) {
    order.platformProfit = Math.max(
      0,
      deliveryFee + platformFee + restaurantCommission - earningResolved.riderEarning,
    );
    order.markModified?.('platformProfit');
  }

  logger.info(
    `Backfilled riderEarning=₹${earningResolved.riderEarning} for order ${order._id} (distanceKm=${earningResolved.distanceKm ?? 'n/a'}, mode=${earningResolved.distanceMode || 'n/a'})`,
  );

  return order;
}
