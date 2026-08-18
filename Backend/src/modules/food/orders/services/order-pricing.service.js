import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { haversineKm, assertRestaurantDeliversToZone } from './order.helpers.js';
import { fetchDrivingDistanceKm } from '../utils/googleMaps.js';
import { resolveFeeSettingsForZone } from '../../admin/services/zoneScopedSettings.service.js';
import {
  enforceMinimumFoodItemPrices,
  resolveCheckoutItems,
} from './order-item-pricing.service.js';

export async function calculateOrderPricing(userId, dto) {
  const resolved = await resolveCheckoutItems(userId, dto);
  const items = await enforceMinimumFoodItemPrices(
    resolved.items,
    resolved.restaurantId || dto.restaurantId,
  );

  const restaurantId = resolved.restaurantId || dto.restaurantId;
  if (!restaurantId) throw new ValidationError('Restaurant id required');

  const restaurant = await FoodRestaurant.findById(restaurantId)
    .select("status location zoneId restaurantName")
    .lean();
  if (!restaurant) throw new ValidationError("Restaurant not found");
  if (restaurant.status !== "approved")
    throw new ValidationError("Restaurant not available");

  assertRestaurantDeliversToZone(restaurant, {
    zoneId: dto.zoneId,
    orderType: dto.orderType,
    deliveryAddress: dto.deliveryAddress,
  });

  const couponCode = String(
    dto.couponCode || resolved.couponCode || dto.pricing?.couponCode || "",
  )
    .trim()
    .toUpperCase();

  const subtotal = items.reduce(
    (sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1),
    0,
  );
  const baseSubtotal = items.reduce((sum, it) => {
    const base = Number(it.basePrice);
    const unit = Number.isFinite(base) && base >= 0 ? base : Number(it.price) || 0;
    return sum + unit * (Number(it.quantity) || 1);
  }, 0);
  const markupTotal = items.reduce(
    (sum, it) =>
      sum + Math.max(0, Number(it.markupAmount) || 0) * (Number(it.quantity) || 1),
    0,
  );

  const pricingZoneId = dto.zoneId || restaurant.zoneId || null;
  const feeDoc = await resolveFeeSettingsForZone(pricingZoneId);
  const feeSettings = feeDoc || {
    deliveryFee: 25,
    deliveryFeeRanges: [],
    freeDeliveryUpTo: 0,
    platformFee: 0,
    packagingFee: 0,
    gstRate: 0,
  };

  const basePackagingFee = feeSettings.packagingFee != null ? Number(feeSettings.packagingFee) : 0;
  const packagingFee = dto.orderType === "takeaway" ? 0 : basePackagingFee;
  const platformFee = feeSettings.platformFee != null ? Number(feeSettings.platformFee) : 0;

  const freeUpTo = Number(feeSettings.freeDeliveryUpTo || 0);
  let distanceKm = null;
  if (
    restaurant?.location?.coordinates?.length === 2 &&
    dto?.deliveryAddress?.location?.coordinates?.length === 2
  ) {
    const [rLng, rLat] = restaurant.location.coordinates;
    const [dLng, dLat] = dto.deliveryAddress.location.coordinates;
    const drivingKm = await fetchDrivingDistanceKm(
      { lat: rLat, lng: rLng },
      { lat: dLat, lng: dLng },
    );
    if (Number.isFinite(drivingKm) && drivingKm > 0) {
      distanceKm = drivingKm;
    } else {
      const d = haversineKm(rLat, rLng, dLat, dLng);
      distanceKm = Number.isFinite(d) ? d : null;
    }
  }
  let deliveryFee = 0;
  let deliveryFeeBreakdown = null;
  if (dto.orderType === "takeaway") {
    deliveryFee = 0;
  } else if (
    Number.isFinite(freeUpTo) &&
    freeUpTo > 0 &&
    subtotal >= freeUpTo
  ) {
    deliveryFee = 0;
  } else {
    const ranges = Array.isArray(feeSettings.deliveryFeeRanges)
      ? [...feeSettings.deliveryFeeRanges]
      : [];
    if (ranges.length > 0) {
      ranges.sort((a, b) => Number(a.min) - Number(b.min));
      let matched = null;
      for (let i = 0; i < ranges.length; i += 1) {
        const r = ranges[i] || {};
        const min = Number(r.min);
        const max = Number(r.max);
        const fee = Number(r.fee);
        if (
          !Number.isFinite(min) ||
          !Number.isFinite(max) ||
          !Number.isFinite(fee)
        ) {
          continue;
        }
        const isLast = i === ranges.length - 1;
        if (!Number.isFinite(distanceKm)) {
          continue;
        }
        const inRange = isLast
          ? distanceKm >= min && distanceKm <= max
          : distanceKm >= min && distanceKm < max;
        if (inRange) {
          matched = fee;
          if (Number.isFinite(distanceKm)) {
            deliveryFeeBreakdown = {
              source: "distance",
              distanceKm,
              minKm: min,
              maxKm: max,
              fee,
            };
          }
          break;
        }
      }
      deliveryFee = Number.isFinite(matched)
        ? matched
        : Number(feeSettings.deliveryFee || 0);
    } else {
      deliveryFee = Number(feeSettings.deliveryFee || 0);
    }
  }

  const gstRate = feeSettings.gstRate != null ? Number(feeSettings.gstRate) : 0;
  const tax =
    Number.isFinite(gstRate) && gstRate > 0
      ? Math.round(subtotal * (gstRate / 100))
      : 0;

  let discount = 0;
  let appliedCoupon = null;
  const codeRaw = couponCode;

  if (codeRaw) {
    const now = new Date();
    const offer = await FoodOffer.findOne({ couponCode: codeRaw }).lean();
    if (offer) {
      const statusOk = offer.status === "active";
      const startOk = !offer.startDate || now >= new Date(offer.startDate);
      const endOk = !offer.endDate || now < new Date(offer.endDate);
      const scopeOk =
        offer.restaurantScope !== "selected" ||
        String(offer.restaurantId || "") === String(restaurantId || "");
      const minOrderValue = Number(offer.minOrderValue);
      const minOk = !Number.isFinite(minOrderValue) || minOrderValue <= 0 || subtotal >= minOrderValue;
      let usageOk = true;
      if (
        Number(offer.usageLimit) > 0 &&
        Number(offer.usedCount || 0) >= Number(offer.usageLimit)
      ) {
        usageOk = false;
      }

      let perUserOk = true;
      if (userId && Number(offer.perUserLimit) > 0) {
        const usage = await FoodOfferUsage.findOne({
          offerId: offer._id,
          userId,
        }).lean();
        if (usage && Number(usage.count) >= Number(offer.perUserLimit)) {
          perUserOk = false;
        }
      }

      let firstOrderOk = true;
      if (userId && offer.customerScope === "first-time") {
        const c = await FoodOrder.countDocuments({
          userId: new mongoose.Types.ObjectId(userId),
        });
        firstOrderOk = c === 0;
      }
      if (userId && offer.isFirstOrderOnly === true) {
        const c2 = await FoodOrder.countDocuments({
          userId: new mongoose.Types.ObjectId(userId),
        });
        if (c2 > 0) firstOrderOk = false;
      }

      const couponTypeOk =
        !offer.couponType ||
        offer.couponType === "all" ||
        String(offer.couponType).toLowerCase() === String(dto.orderType || "delivery").toLowerCase();

      const allowed =
        statusOk &&
        startOk &&
        endOk &&
        scopeOk &&
        minOk &&
        usageOk &&
        perUserOk &&
        firstOrderOk &&
        couponTypeOk;

      if (allowed) {
        if (offer.discountType === "percentage") {
          const raw = subtotal * (Number(offer.discountValue) / 100);
          const capped = Number(offer.maxDiscount)
            ? Math.min(raw, Number(offer.maxDiscount))
            : raw;
          discount = Math.max(0, Math.min(subtotal, Math.floor(capped)));
        } else {
          discount = Math.max(
            0,
            Math.min(subtotal, Math.floor(Number(offer.discountValue) || 0)),
          );
        }
        appliedCoupon = { code: codeRaw, discount };
      }
    }
  }

  const total = Math.max(
    0,
    subtotal + packagingFee + deliveryFee + platformFee + tax - discount,
  );

  return {
    pricing: {
      subtotal,
      baseSubtotal: Math.round(baseSubtotal * 100) / 100,
      markupTotal: Math.round(markupTotal * 100) / 100,
      tax,
      packagingFee,
      deliveryFee,
      deliveryFeeBreakdown: deliveryFeeBreakdown || undefined,
      freeDeliveryUpTo: Number.isFinite(freeUpTo) ? freeUpTo : undefined,
      platformFee,
      discount,
      total,
      currency: "INR",
      couponCode: appliedCoupon?.code || codeRaw || null,
      appliedCoupon,
    },
    items,
    restaurantId: String(restaurantId),
    restaurantName: restaurant.restaurantName || "",
  };
}
