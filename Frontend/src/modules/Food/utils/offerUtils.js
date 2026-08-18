const normalizeId = (value) => String(value || "").trim().toLowerCase()

export const offerMatchesRestaurant = (offer, { restaurantId, restaurantSlug, restaurant } = {}) => {
  if (String(offer?.restaurantScope) !== "selected") return true

  const slug = normalizeId(restaurantSlug || restaurant?.slug || restaurant?.restaurantNameNormalized)
  const offerSlug = normalizeId(offer?.restaurantSlug || offer?.slug)
  if (slug && offerSlug && slug === offerSlug) return true

  const restaurantIds = [
    restaurantId,
    restaurant?.id,
    restaurant?.restaurantId,
    restaurant?._id,
    restaurant?.mongoId,
  ]
    .map(normalizeId)
    .filter(Boolean)

  const offerRestaurantId = normalizeId(offer?.restaurantId)
  if (!offerRestaurantId) return false

  return restaurantIds.includes(offerRestaurantId)
}

export const offerMatchesOrderType = (offer, orderType = "delivery") => {
  const couponType = String(offer?.couponType || "all").trim().toLowerCase()
  if (couponType === "all") return true
  if (orderType === "takeaway") return couponType === "takeaway"
  return couponType === "delivery"
}

export const filterPublicOffers = (
  offers = [],
  { restaurantId, restaurantSlug, restaurant, orderType = "delivery", requireShowInCart = false } = {},
) => {
  return (Array.isArray(offers) ? offers : []).filter((offer) => {
    if (requireShowInCart && offer?.showInCart === false) return false
    if (offer?.status && offer.status !== "active") return false
    if (!offerMatchesRestaurant(offer, { restaurantId, restaurantSlug, restaurant })) return false
    if (!offerMatchesOrderType(offer, orderType)) return false
    return true
  })
}

export const mapPublicOfferToCartCoupon = (offer, rupeeSymbol = "₹") => {
  const isPercentage = offer?.discountType === "percentage"
  const discountValue = Number(offer?.discountValue ?? offer?.discountPercentage ?? 0) || 0
  const flatValue = Number(offer?.discountValue ?? offer?.originalPrice ?? 0) || 0
  const minOrder = Number(offer?.minOrderValue) > 0 ? Number(offer.minOrderValue) : 0

  return {
    code: offer.couponCode,
    couponCode: offer.couponCode,
    discountType: offer.discountType,
    discountPercentage: isPercentage ? discountValue : 0,
    discount: isPercentage ? 0 : flatValue,
    discountDisplay: isPercentage ? `${discountValue}% OFF` : `${rupeeSymbol}${flatValue} OFF`,
    minOrder,
    minOrderValue: Number(offer?.minOrderValue) > 0 ? Number(offer.minOrderValue) : null,
    maxDiscount: offer?.maxDiscount != null ? Number(offer.maxDiscount) : null,
    originalPrice: isPercentage ? 0 : flatValue,
    discountedPrice: 0,
    description: isPercentage
      ? `${discountValue}% OFF with '${offer.couponCode}'`
      : `Save ${rupeeSymbol}${flatValue} with '${offer.couponCode}'`,
    customerGroup: offer?.customerScope || offer?.customerGroup || "all",
    isGlobalCoupon: true,
    couponType: offer?.couponType || "all",
    showInCart: offer?.showInCart !== false,
  }
}
