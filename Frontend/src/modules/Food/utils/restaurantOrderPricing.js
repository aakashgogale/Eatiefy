function deriveBaseFromAppliedPricingRule(price, item = {}) {
  const type = String(item?.appliedPricingType || '').toUpperCase();
  const value = Number(item?.appliedPricingValue);
  const selling = Number(price) || 0;
  if (!Number.isFinite(value) || value <= 0 || selling <= 0) return null;
  if (type === 'PERCENTAGE') {
    return Math.max(0, Math.round((selling / (1 + value / 100)) * 100) / 100);
  }
  if (type === 'FIXED') {
    return Math.max(0, Math.round((selling - value) * 100) / 100);
  }
  return null;
}

function resolvePricingScope(item = {}) {
  return String(item?.pricingScope || item?.pricingRule?.scope || '').toUpperCase();
}

export function resolveRestaurantItemUnitPrice(item = {}) {
  const price = Number(item?.customerPrice ?? item?.price) || 0;
  const markup = Number(item?.markupAmount) || 0;
  const other = Number(item?.otherPrice) || 0;
  const base = Number(item?.basePrice);
  const scope = resolvePricingScope(item);
  const hasAdminScope = scope && scope !== 'LEGACY';

  if (Number.isFinite(base) && base >= 0) {
    if (markup > 0 || (hasAdminScope && other > base + 0.01) || base < price - 0.01) {
      return base;
    }
    if (Math.abs(base - price) < 0.01) {
      const derived = deriveBaseFromAppliedPricingRule(price, item);
      if (derived != null && derived < price - 0.01) return derived;
    }
    return base;
  }

  if (markup > 0) return Math.max(0, Math.round((price - markup) * 100) / 100);

  const derived = deriveBaseFromAppliedPricingRule(price, item);
  if (derived != null) return derived;

  return price;
}

export function resolveItemMarkupUnit(item = {}) {
  const markup = Number(item?.markupAmount);
  if (Number.isFinite(markup) && markup > 0) return markup;

  const base = resolveRestaurantItemUnitPrice(item);
  const customer =
    Number(item?.customerPrice) ||
    (Number(item?.price) > base + 0.01 ? Number(item.price) : 0) ||
    // Transition only: older payloads stored selling in otherPrice
    Number(item?.otherPrice) ||
    0;
  if (customer > base + 0.01) {
    return Math.round((customer - base) * 100) / 100;
  }
  return 0;
}

/** Per-item admin markup shown only when rule is MENU_ITEM scoped. */
export function getMenuItemLevelMarkupTotal(item = {}) {
  const scope = resolvePricingScope(item);
  if (scope !== 'MENU_ITEM') return 0;
  const qty = Number(item?.quantity || 1) || 1;
  return Math.round(resolveItemMarkupUnit(item) * qty * 100) / 100;
}

export function getRestaurantItemLineTotal(item) {
  const qty = Number(item?.quantity || 1) || 1;
  return resolveRestaurantItemUnitPrice(item) * qty;
}

export function getOrderMarkupTotal(orderLike) {
  if (!orderLike) return 0;
  const stored = Number(orderLike.pricing?.markupTotal);
  if (Number.isFinite(stored) && stored > 0) return stored;

  const items = Array.isArray(orderLike.items) ? orderLike.items : [];
  return items.reduce((sum, item) => {
    const qty = Number(item?.quantity || 1) || 1;
    return sum + resolveItemMarkupUnit(item) * qty;
  }, 0);
}

export function getRestaurantOrderTotal(orderLike) {
  if (!orderLike) return 0;

  const baseSubtotal = Number(orderLike.pricing?.baseSubtotal);
  if (Number.isFinite(baseSubtotal) && baseSubtotal >= 0) {
    const packaging = Number(orderLike.pricing?.packagingFee) || 0;
    return baseSubtotal + packaging;
  }

  const items = Array.isArray(orderLike.items) ? orderLike.items : [];
  const itemsBaseTotal = items.reduce(
    (sum, item) => sum + getRestaurantItemLineTotal(item),
    0,
  );
  if (itemsBaseTotal > 0) return itemsBaseTotal;

  const directTotal = Number(orderLike.total);
  if (Number.isFinite(directTotal) && directTotal > 0) return directTotal;

  const pricingTotal = Number(orderLike.pricing?.total);
  if (Number.isFinite(pricingTotal) && pricingTotal > 0) return pricingTotal;

  return 0;
}

export function getCustomerFacingOrderTotal(orderLike) {
  const restaurantTotal = getRestaurantOrderTotal(orderLike);
  const markup = getOrderMarkupTotal(orderLike);
  const customerTotal = Number(orderLike?.pricing?.customerTotal);
  if (Number.isFinite(customerTotal) && customerTotal > 0) return customerTotal;
  return Math.round((restaurantTotal + markup) * 100) / 100;
}

/** Keep base as price for restaurant UI, but preserve markup metadata for breakdown. */
export function normalizeRestaurantOrderView(orderLike) {
  if (!orderLike || typeof orderLike !== 'object') return orderLike;

  const pricing = orderLike.pricing || {};
  const rawItems = Array.isArray(orderLike.items) ? orderLike.items : [];
  const items = rawItems.map((item) => {
    const restaurantUnit = resolveRestaurantItemUnitPrice(item);
    const customerUnit =
      Number(item?.customerPrice) ||
      Number(item?.otherPrice) ||
      Number(item?.price) ||
      restaurantUnit;
    const markupUnit = resolveItemMarkupUnit({
      ...item,
      customerPrice: customerUnit,
      basePrice: Number.isFinite(Number(item?.basePrice))
        ? Number(item.basePrice)
        : restaurantUnit,
    });
    const qty = Number(item?.quantity || 1) || 1;
    return {
      ...item,
      customerPrice: customerUnit,
      price: restaurantUnit,
      variantPrice: restaurantUnit,
      basePrice: restaurantUnit,
      markupAmount: markupUnit,
      pricingScope: item?.pricingScope || item?.pricingRule?.scope || null,
      lineMarkupTotal: Math.round(markupUnit * qty * 100) / 100,
    };
  });

  const restaurantSubtotal = items.reduce(
    (sum, item) => sum + getRestaurantItemLineTotal(item),
    0,
  );
  const markupTotal = items.reduce(
    (sum, item) => sum + (Number(item.lineMarkupTotal) || 0),
    0,
  );
  const packagingFee = Number(pricing.packagingFee) || 0;
  const restaurantTotal = Math.max(
    0,
    Math.round((restaurantSubtotal + packagingFee) * 100) / 100,
  );
  const storedMarkup = Number(pricing.markupTotal);

  return {
    ...orderLike,
    items,
    pricing: {
      ...pricing,
      customerSubtotal:
        Number(pricing.customerSubtotal) ||
        Number(pricing.subtotal) ||
        Math.round((restaurantSubtotal + markupTotal) * 100) / 100,
      customerTotal:
        Number(pricing.customerTotal) ||
        Number(pricing.total) ||
        Math.round((restaurantTotal + markupTotal) * 100) / 100,
      subtotal: Math.round(restaurantSubtotal * 100) / 100,
      baseSubtotal: Math.round(restaurantSubtotal * 100) / 100,
      markupTotal:
        Number.isFinite(storedMarkup) && storedMarkup >= 0
          ? storedMarkup
          : Math.round(markupTotal * 100) / 100,
      total: restaurantTotal,
    },
    total: restaurantTotal,
    amount: restaurantTotal,
  };
}
