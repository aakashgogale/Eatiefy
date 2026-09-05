import mongoose from 'mongoose';
import { FoodCart } from '../models/foodCart.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import {
  applyOtherPriceToFood,
  loadActivePricingRules,
} from '../../admin/services/otherPrice.service.js';

const MAX_QTY = 99;

const toObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const str = String(value);
  return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : null;
};

const normalizeVariantId = (value) => String(value || '').trim();

const lineKey = (itemId, variantId = '') =>
  `${String(itemId)}::${normalizeVariantId(variantId)}`;

async function getOrCreateCart(userId) {
  const uid = toObjectId(userId);
  if (!uid) throw new ValidationError('Invalid user');

  const cart = await FoodCart.findOneAndUpdate(
    { userId: uid },
    { $setOnInsert: { userId: uid, items: [], restaurantId: null, couponCode: '' } },
    { upsert: true, new: true }
  );
  return cart;
}

async function loadItemDoc(itemId) {
  const oid = toObjectId(itemId);
  if (!oid) throw new ValidationError('Invalid item id');
  const item = await FoodItem.findById(oid)
    .select('restaurantId name price otherPrice priceOnOtherPlatforms image images foodType isAvailable approvalStatus variants categoryId categoryName')
    .lean();
  if (!item) throw new NotFoundError('Item not found');
  return item;
}

async function assertRestaurantAccepting(restaurantId) {
  const oid = toObjectId(restaurantId);
  if (!oid) throw new ValidationError('Invalid restaurant');
  const restaurant = await FoodRestaurant.findById(oid)
    .select('restaurantName status isAcceptingOrders isVisibleToUsers')
    .lean();
  if (!restaurant) throw new NotFoundError('Restaurant not found');
  if (String(restaurant.status || '') !== 'approved') {
    throw new ValidationError('Restaurant is not available');
  }
  if (restaurant.isAcceptingOrders === false) {
    throw new ValidationError('Restaurant is not accepting orders right now');
  }
  return restaurant;
}

function resolveVariant(itemDoc, variantId) {
  const vid = normalizeVariantId(variantId);
  if (!vid) {
    return {
      variantId: '',
      variantName: '',
      price: Number(itemDoc.price) || 0,
    };
  }
  const variant = (itemDoc.variants || []).find((v) => String(v._id) === vid);
  if (!variant) {
    throw new ValidationError('Selected option is no longer available');
  }
  return {
    variantId: vid,
    variantName: String(variant.name || ''),
    price: Number(variant.price) || 0,
  };
}

function buildPricingSnapshot(priced, variantId = '') {
  const pricedVariant =
    (priced.variants || []).find(
      (v) => String(v.id || v._id || '') === String(variantId || ''),
    ) || null;
  const basePrice =
    Number(pricedVariant?.basePrice ?? priced.basePrice ?? priced.price) || 0;
  const pricingScope = pricedVariant?.pricingScope || priced.pricingScope || null;
  const markupAmount = Math.max(
    0,
    Number(pricedVariant?.markupAmount ?? priced.markupAmount) || 0,
  );
  const sellingFromPrice = Number(pricedVariant?.price ?? priced.price ?? basePrice) || basePrice;
  // Transition: older carts stored selling in otherPrice — only trust when admin scope + markup.
  const legacyOther = Number(pricedVariant?.otherPrice ?? priced.otherPrice) || 0;
  const isAdminMarkup =
    pricingScope &&
    String(pricingScope).toUpperCase() !== 'LEGACY' &&
    (markupAmount > 0 ||
      sellingFromPrice > basePrice + 0.01 ||
      legacyOther > basePrice + 0.01);
  const sellingPrice = isAdminMarkup
    ? markupAmount > 0
      ? Math.round((basePrice + markupAmount) * 100) / 100
      : sellingFromPrice > basePrice + 0.01
        ? sellingFromPrice
        : legacyOther > basePrice
          ? legacyOther
          : basePrice
    : basePrice;
  const resolvedMarkup = isAdminMarkup
    ? Math.max(0, Math.round((sellingPrice - basePrice) * 100) / 100)
    : 0;
  return {
    basePrice,
    otherPrice: 0,
    sellingPrice,
    markupAmount: resolvedMarkup,
    appliedPricingType: pricedVariant?.appliedPricingType || priced.appliedPricingType || null,
    appliedPricingValue:
      pricedVariant?.appliedPricingValue ?? priced.appliedPricingValue ?? null,
    pricingScope: isAdminMarkup ? pricingScope : null,
    pricingRule: priced.pricingRule || null,
    pricingCapturedAt: new Date(),
  };
}

function lineHasPricingSnapshot(line) {
  return line && line.basePrice != null && Number.isFinite(Number(line.basePrice));
}

function assertItemSellable(itemDoc) {
  if (itemDoc.approvalStatus !== 'approved') {
    throw new ValidationError('Item is not available');
  }
  if (itemDoc.isAvailable === false) {
    throw new ValidationError('Item is currently unavailable');
  }
}

/**
 * Hydrate cart lines from live menu data. Drops unavailable lines and persists cleanup.
 */
export async function hydrateFoodCart(cartDoc) {
  if (!cartDoc) {
    return {
      items: [],
      restaurantId: null,
      restaurantName: '',
      subtotal: 0,
      itemCount: 0,
      couponCode: '',
      removedUnavailable: [],
    };
  }

  const rawItems = Array.isArray(cartDoc.items) ? cartDoc.items : [];
  if (!rawItems.length) {
    if (cartDoc.restaurantId) {
      await FoodCart.updateOne(
        { _id: cartDoc._id },
        { $set: { restaurantId: null, items: [], couponCode: '' } }
      );
    }
    return {
      items: [],
      restaurantId: null,
      restaurantName: '',
      subtotal: 0,
      itemCount: 0,
      couponCode: '',
      removedUnavailable: [],
    };
  }

  const itemIds = [...new Set(rawItems.map((i) => String(i.itemId)).filter(Boolean))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const docs = itemIds.length
    ? await FoodItem.find({ _id: { $in: itemIds } })
      .select('restaurantId name price otherPrice priceOnOtherPlatforms image images foodType isAvailable approvalStatus variants categoryId categoryName')
      .lean()
    : [];
  const docMap = new Map(docs.map((d) => [String(d._id), d]));

  let restaurant = null;
  if (cartDoc.restaurantId) {
    restaurant = await FoodRestaurant.findById(cartDoc.restaurantId)
      .select('restaurantName status isAcceptingOrders')
      .lean();
  }

  const keep = [];
  const removedUnavailable = [];
  const hydrated = [];
  let pricingDirty = false;

  const pricingRules = await loadActivePricingRules({
    restaurantId: cartDoc.restaurantId || docs[0]?.restaurantId,
    menuItemIds: docs.map((f) => f._id),
  });

  for (const line of rawItems) {
    const doc = docMap.get(String(line.itemId));
    const lineId = String(line._id);
    if (!doc || doc.approvalStatus !== 'approved' || doc.isAvailable === false) {
      removedUnavailable.push({
        id: lineId,
        itemId: String(line.itemId),
        reason: 'unavailable',
      });
      continue;
    }
    if (
      cartDoc.restaurantId &&
      String(doc.restaurantId) !== String(cartDoc.restaurantId)
    ) {
      removedUnavailable.push({
        id: lineId,
        itemId: String(line.itemId),
        reason: 'restaurant_mismatch',
      });
      continue;
    }

    let variant;
    try {
      variant = resolveVariant(doc, line.variantId);
    } catch {
      removedUnavailable.push({
        id: lineId,
        itemId: String(line.itemId),
        reason: 'variant_unavailable',
      });
      continue;
    }

    const quantity = Math.min(MAX_QTY, Math.max(1, Number(line.quantity) || 1));
    const priced = applyOtherPriceToFood(doc, pricingRules);
    const liveSnapshot = buildPricingSnapshot(priced, variant.variantId);
    const liveBase = liveSnapshot.basePrice;

    // Prefer cart snapshot when base price unchanged so admin markup edits
    // don't silently rewrite an open cart until the line is refreshed.
    let snapshot = liveSnapshot;
    if (lineHasPricingSnapshot(line)) {
      const snappedBase = Number(line.basePrice) || 0;
      if (Math.abs(snappedBase - liveBase) < 0.01) {
        const snappedMarkup = Math.max(0, Number(line.markupAmount) || 0);
        const snappedOther = Number(line.otherPrice) || 0;
        const snappedScope = line.pricingScope || null;
        const sellingFromLine = Number(line.sellingPrice ?? line.price) || 0;
        const isAdmin =
          snappedScope &&
          String(snappedScope).toUpperCase() !== 'LEGACY' &&
          (snappedMarkup > 0 ||
            sellingFromLine > snappedBase + 0.01 ||
            snappedOther > snappedBase + 0.01);
        const sellingPrice = isAdmin
          ? snappedMarkup > 0
            ? Math.round((snappedBase + snappedMarkup) * 100) / 100
            : sellingFromLine > snappedBase + 0.01
              ? sellingFromLine
              : snappedOther > snappedBase
                ? snappedOther
                : snappedBase
          : snappedBase;
        snapshot = {
          basePrice: snappedBase,
          otherPrice: 0,
          sellingPrice,
          markupAmount: isAdmin
            ? Math.max(0, Math.round((sellingPrice - snappedBase) * 100) / 100)
            : 0,
          appliedPricingType: line.appliedPricingType || null,
          appliedPricingValue:
            line.appliedPricingValue != null ? Number(line.appliedPricingValue) : null,
          pricingScope: isAdmin ? snappedScope : null,
          pricingRule: line.pricingRule || null,
          pricingCapturedAt: line.pricingCapturedAt || null,
        };
      } else {
        pricingDirty = true;
      }
    } else {
      pricingDirty = true;
    }

    keep.push({
      _id: line._id,
      itemId: line.itemId,
      variantId: variant.variantId,
      quantity,
      ...snapshot,
    });

    const image =
      (typeof doc.image === 'string' && doc.image) ||
      (Array.isArray(doc.images) && doc.images[0]) ||
      '';

    const unitBase = Number(snapshot.basePrice) || 0;
    const unitPrice = Number(snapshot.sellingPrice ?? unitBase) || unitBase;
    const markupAmount = Math.max(0, Number(snapshot.markupAmount) || 0);

    hydrated.push({
      id: lineId,
      lineItemId: lineId,
      itemId: String(doc._id),
      productId: String(doc._id),
      variantId: variant.variantId,
      variantName: variant.variantName,
      variantPrice: unitPrice,
      name: doc.name,
      quantity,
      price: unitPrice,
      basePrice: unitBase,
      otherPrice: 0,
      markupAmount,
      appliedPricingType: snapshot.appliedPricingType,
      appliedPricingValue: snapshot.appliedPricingValue,
      pricingScope: snapshot.pricingScope,
      pricingRule: snapshot.pricingRule,
      image,
      imageUrl: image,
      isVeg: ['Veg', 'Vegan'].includes(String(doc.foodType || '')),
      foodType: doc.foodType || 'Non-Veg',
      orderType: 'food',
      type: 'food',
      restaurantId: String(doc.restaurantId),
      restaurant: restaurant?.restaurantName || '',
      sourceId: String(doc.restaurantId),
      sourceName: restaurant?.restaurantName || '',
      categoryId: doc.categoryId ? String(doc.categoryId) : '',
      categoryName: doc.categoryName || '',
      addons: Array.isArray(line.addons) ? line.addons : [],
      notes: typeof line.notes === 'string' ? line.notes : '',
      lineTotal: unitPrice * quantity,
      available: true,
    });
  }

  const restaurantOk =
    restaurant &&
    String(restaurant.status || '') === 'approved' &&
    restaurant.isAcceptingOrders !== false;

  if (!restaurantOk && hydrated.length) {
    // Keep items but frontend/checkout will block; mark flag.
  }

  if (removedUnavailable.length || keep.length !== rawItems.length || pricingDirty) {
    await FoodCart.updateOne(
      { _id: cartDoc._id },
      {
        $set: {
          items: keep,
          restaurantId: keep.length ? cartDoc.restaurantId : null,
          couponCode: keep.length ? cartDoc.couponCode || '' : '',
        },
      }
    );
  }

  const subtotal = hydrated.reduce((sum, i) => sum + Number(i.lineTotal || 0), 0);
  const itemCount = hydrated.reduce((sum, i) => sum + Number(i.quantity || 0), 0);

  return {
    items: hydrated,
    restaurantId: keep.length && cartDoc.restaurantId ? String(cartDoc.restaurantId) : null,
    restaurantName: restaurant?.restaurantName || '',
    restaurantAccepting: Boolean(restaurantOk),
    subtotal,
    itemCount,
    couponCode: cartDoc.couponCode || '',
    removedUnavailable,
  };
}

export async function getFoodCart(userId) {
  const cart = await getOrCreateCart(userId);
  return hydrateFoodCart(cart);
}

export async function addFoodCartItem(userId, body = {}) {
  const itemId = body.itemId || body.productId || body.foodId;
  const variantId = normalizeVariantId(body.variantId);
  const addQty = Math.min(MAX_QTY, Math.max(1, Number(body.quantity) || 1));

  const itemDoc = await loadItemDoc(itemId);
  assertItemSellable(itemDoc);
  const restaurant = await assertRestaurantAccepting(itemDoc.restaurantId);
  const variant = resolveVariant(itemDoc, variantId);

  const pricingRules = await loadActivePricingRules({
    restaurantId: itemDoc.restaurantId,
    menuItemIds: [itemDoc._id],
  });
  const priced = applyOtherPriceToFood(itemDoc, pricingRules);
  const pricingSnapshot = buildPricingSnapshot(priced, variant.variantId);

  const cart = await getOrCreateCart(userId);

  if (cart.restaurantId && String(cart.restaurantId) !== String(itemDoc.restaurantId)) {
    const existingName = cart.restaurantId
      ? (await FoodRestaurant.findById(cart.restaurantId).select('restaurantName').lean())
          ?.restaurantName
      : '';
    throw new ValidationError(
      `Cart already contains items from "${existingName || 'another restaurant'}". Please clear cart or complete order first.`,
      'RESTAURANT_MISMATCH'
    );
  }

  const existingIdx = (cart.items || []).findIndex(
    (line) =>
      String(line.itemId) === String(itemDoc._id) &&
      normalizeVariantId(line.variantId) === variant.variantId
  );

  let saved;
  if (existingIdx >= 0) {
    const nextQty = Math.min(MAX_QTY, Number(cart.items[existingIdx].quantity || 0) + addQty);
    // Keep existing pricing snapshot when topping up quantity of the same line.
    const existingLine = cart.items[existingIdx];
    const keepSnapshot = lineHasPricingSnapshot(existingLine)
      ? {
          basePrice: existingLine.basePrice,
          otherPrice: 0,
          sellingPrice:
            Number(existingLine.sellingPrice) ||
            Number(existingLine.price) ||
            Number(existingLine.basePrice) ||
            0,
          markupAmount: Math.max(0, Number(existingLine.markupAmount) || 0),
          appliedPricingType: existingLine.appliedPricingType,
          appliedPricingValue: existingLine.appliedPricingValue,
          pricingScope: existingLine.pricingScope,
          pricingRule: existingLine.pricingRule,
          pricingCapturedAt: existingLine.pricingCapturedAt,
        }
      : pricingSnapshot;

    saved = await FoodCart.findOneAndUpdate(
      {
        _id: cart._id,
        items: {
          $elemMatch: {
            itemId: itemDoc._id,
            variantId: variant.variantId,
          },
        },
      },
      {
        $set: {
          'items.$.quantity': nextQty,
          'items.$.basePrice': keepSnapshot.basePrice,
          'items.$.otherPrice': 0,
          'items.$.sellingPrice': keepSnapshot.sellingPrice,
          'items.$.markupAmount': keepSnapshot.markupAmount,
          'items.$.appliedPricingType': keepSnapshot.appliedPricingType,
          'items.$.appliedPricingValue': keepSnapshot.appliedPricingValue,
          'items.$.pricingScope': keepSnapshot.pricingScope,
          'items.$.pricingRule': keepSnapshot.pricingRule,
          'items.$.pricingCapturedAt': keepSnapshot.pricingCapturedAt,
          restaurantId: itemDoc.restaurantId,
        },
      },
      { new: true }
    );
  }

  if (!saved) {
    saved = await FoodCart.findOneAndUpdate(
      { _id: cart._id },
      {
        $set: { restaurantId: itemDoc.restaurantId },
        $push: {
          items: {
            itemId: itemDoc._id,
            variantId: variant.variantId,
            quantity: addQty,
            ...pricingSnapshot,
          },
        },
      },
      { new: true }
    );
  }

  const result = await hydrateFoodCart(saved || cart);
  return {
    ...result,
    restaurantName: restaurant.restaurantName || result.restaurantName,
  };
}

export async function updateFoodCartItem(userId, lineId, body = {}) {
  const uid = toObjectId(userId);
  const cart = await FoodCart.findOne({ userId: uid });
  if (!cart) throw new NotFoundError('Cart not found');

  const idx = (cart.items || []).findIndex((line) => String(line._id) === String(lineId));
  if (idx < 0) throw new NotFoundError('Cart item not found');

  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity)) throw new ValidationError('Quantity is required');

  if (quantity <= 0) {
    cart.items.splice(idx, 1);
    if (!cart.items.length) {
      cart.restaurantId = null;
      cart.couponCode = '';
    }
    await cart.save();
    return hydrateFoodCart(cart);
  }

  const line = cart.items[idx];
  const itemDoc = await loadItemDoc(line.itemId);
  assertItemSellable(itemDoc);
  await assertRestaurantAccepting(itemDoc.restaurantId);
  resolveVariant(itemDoc, line.variantId);

  cart.items[idx].quantity = Math.min(MAX_QTY, Math.floor(quantity));
  await cart.save();
  return hydrateFoodCart(cart);
}

export async function removeFoodCartItem(userId, lineId) {
  const uid = toObjectId(userId);
  const updated = await FoodCart.findOneAndUpdate(
    { userId: uid },
    { $pull: { items: { _id: toObjectId(lineId) || lineId } } },
    { new: true }
  );
  if (!updated) throw new NotFoundError('Cart not found');

  if (!updated.items?.length) {
    updated.restaurantId = null;
    updated.couponCode = '';
    await updated.save();
  }
  return hydrateFoodCart(updated);
}

export async function clearFoodCart(userId) {
  const uid = toObjectId(userId);
  await FoodCart.findOneAndUpdate(
    { userId: uid },
    { $set: { items: [], restaurantId: null, couponCode: '' } },
    { upsert: true }
  );
  return {
    items: [],
    restaurantId: null,
    restaurantName: '',
    subtotal: 0,
    itemCount: 0,
    couponCode: '',
    removedUnavailable: [],
  };
}

export async function setFoodCartCoupon(userId, couponCode = '') {
  const uid = toObjectId(userId);
  const code = String(couponCode || '').trim().toUpperCase();
  await FoodCart.findOneAndUpdate(
    { userId: uid },
    { $set: { couponCode: code } },
    { upsert: true }
  );
  return getFoodCart(userId);
}

/**
 * Build order-service item payload from DB cart (server prices only).
 */
export async function buildOrderItemsFromFoodCart(userId) {
  const cart = await getFoodCart(userId);
  if (!cart.items.length) {
    throw new ValidationError('Your cart is empty');
  }
  if (cart.restaurantAccepting === false) {
    throw new ValidationError('Restaurant is not accepting orders right now');
  }

  const items = cart.items.map((line) => {
    const base = Number(line.basePrice ?? line.price) || 0;
    const selling = Number(line.price ?? line.sellingPrice ?? base) || base;
    const markup = Math.max(
      0,
      Number(line.markupAmount) ||
        Math.round((selling - base) * 100) / 100,
    );
    return {
    itemId: line.itemId,
    name: line.name,
    type: 'food',
    sourceId: line.sourceId || line.restaurantId,
    sourceName: line.sourceName || line.restaurant || '',
    variantId: line.variantId || undefined,
    variantName: line.variantName || undefined,
    variantPrice: selling,
    price: selling,
    basePrice: base,
    otherPrice: 0,
    appliedPricingType: line.appliedPricingType || null,
    appliedPricingValue: line.appliedPricingValue ?? null,
    pricingScope: line.pricingScope || null,
    pricingRule: line.pricingRule || null,
    markupAmount: markup,
    quantity: line.quantity,
    isVeg: Boolean(line.isVeg),
    image: line.image || '',
    categoryId: line.categoryId || '',
    categoryName: line.categoryName || '',
    notes: line.notes || '',
    addons: Array.isArray(line.addons)
      ? line.addons.map((a) => ({
          name: String(a?.name || a?.title || a?.label || '').trim(),
          quantity: Math.max(1, Number(a?.quantity) || 1),
          price: Math.max(0, Number(a?.price) || 0),
        })).filter((a) => a.name)
      : [],
  };
  });

  return {
    items,
    restaurantId: cart.restaurantId,
    restaurantName: cart.restaurantName,
    couponCode: cart.couponCode || '',
    subtotal: cart.subtotal,
  };
}
