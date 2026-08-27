// src/context/cart-context.jsx
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { buildCartLineId } from "@food/utils/foodVariants"
import { userAPI } from "@/services/api"
import CartReplaceDialog from "@food/components/user/CartReplaceDialog"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


// Default cart context value to prevent errors during initial render
const defaultCartContext = {
  _isProvider: false, // Flag to identify if this is from the actual provider
  cart: [],
  items: [],
  itemCount: 0,
  total: 0,
  lastAddEvent: null,
  lastRemoveEvent: null,
  addToCart: () => {
    debugWarn('CartProvider not available - addToCart called');
  },
  removeFromCart: () => {
    debugWarn('CartProvider not available - removeFromCart called');
  },
  updateQuantity: () => {
    debugWarn('CartProvider not available - updateQuantity called');
  },
  getCartCount: () => 0,
  isInCart: () => false,
  getCartItem: () => null,
  clearCart: () => {
    debugWarn('CartProvider not available - clearCart called');
  },
  cleanCartForRestaurant: () => {
    debugWarn('CartProvider not available - cleanCartForRestaurant called');
  },
  replaceCart: () => {
    debugWarn('CartProvider not available - replaceCart called');
  },
  confirmReplaceCart: () => {
    debugWarn('CartProvider not available - confirmReplaceCart called');
  },
  cancelReplaceCart: () => {
    debugWarn('CartProvider not available - cancelReplaceCart called');
  },
  cartReplacePrompt: null,
}

const CartContext = createContext(defaultCartContext)

const normalizeCartData = (rawCart) => {
  if (!Array.isArray(rawCart)) return []

  const mapped = rawCart
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const parsedQuantity = Number(item.quantity)
      const parsedPrice = Number(item.price)
      const normalizedRestaurantName =
        typeof item.restaurant === "string"
          ? item.restaurant
          : typeof item.restaurant?.name === "string"
            ? item.restaurant.name
            : ""

      const normalizedRestaurantId =
        item.restaurantId ||
        item.restaurant_id ||
        item.restaurant?._id ||
        item.restaurant?.restaurantId ||
        null

      const normalizedImage =
        item.image ||
        item.imageUrl ||
        item.product?.imageUrl ||
        item.product?.image ||
        ""

      const baseItemId =
        item.itemId ||
        item.productId ||
        item.foodId ||
        item.baseItemId ||
        item.menuItemId ||
        item.id ||
        item._id ||
        (item.name ? item.name.toLowerCase().trim().replace(/[^a-z0-9]/g, "-") : `cart-item-${index}`)

      const variantId = item.variantId || item.variant?._id || item.variant?.id || ""
      const variantName =
        typeof item.variantName === "string"
          ? item.variantName
          : typeof item.variant?.name === "string"
            ? item.variant.name
            : ""
      const parsedVariantPrice = Number(
        item.variantPrice ?? item.variant?.price ?? item.price,
      )
      const lineItemId =
        item.lineItemId ||
        item.cartLineId ||
        buildCartLineId(baseItemId, variantId)

      const name = item.name || item.product?.name || "Item"
      const nameLower = name.toLowerCase()

      // Strict cache sanitation: If it was wrongly cached as Veg previously, override it
      let currentFoodType = item.foodType
      if (nameLower.includes("chicken") || nameLower.includes("salmon") || nameLower.includes("tart")) {
        currentFoodType = "Non-Veg"
      }

      const finalFoodType = currentFoodType || (item.isVeg === true ? "Veg" : "Non-Veg")

      return {
        ...item,
        id: lineItemId,
        lineItemId,
        itemId: String(baseItemId),
        productId: String(baseItemId),
        variantId: variantId ? String(variantId) : "",
        variantName,
        variantPrice: Number.isFinite(parsedVariantPrice) ? parsedVariantPrice : 0,
        name: name,
        quantity:
          Number.isFinite(parsedQuantity) && parsedQuantity > 0
            ? Math.floor(parsedQuantity)
            : 1,
        price: Number.isFinite(parsedPrice) ? parsedPrice : 0,
        otherPrice: Number(item.otherPrice) > 0 ? Number(item.otherPrice) : 0,
        foodType: finalFoodType,
        isVeg: finalFoodType === "Veg",
        restaurant: normalizedRestaurantName,
        restaurantId: normalizedRestaurantId,
        image: normalizedImage,
        imageUrl: normalizedImage,
      }
    })

  // GROUP / DEDUPLICATE items by their lineItemId / item identity
  const grouped = []
  const map = new Map()

  for (const item of mapped) {
    const key = `${item.id}_${item.name?.toLowerCase()?.trim()}`
    if (map.has(key)) {
      const existing = map.get(key)
      existing.quantity += item.quantity
    } else {
      const clone = { ...item }
      map.set(key, clone)
      grouped.push(clone)
    }
  }

  return grouped
}

const resolveCartEntryId = (items, itemId, variantId = "") => {
  const normalizedItemId = String(itemId || "")
  const safeItems = Array.isArray(items) ? items : []

  const directMatch = safeItems.find((item) => item.id === normalizedItemId || item.lineItemId === normalizedItemId)
  if (directMatch) return directMatch.id

  const preferredId = buildCartLineId(normalizedItemId, variantId)

  const exactMatch = safeItems.find((item) => item.id === preferredId || item.lineItemId === preferredId)
  if (exactMatch) return exactMatch.id

  const baseMatch = safeItems.find(
    (item) =>
      String(item.itemId || item.productId || item.id || "") === normalizedItemId &&
      String(item.variantId || "").trim() === String(variantId || "").trim(),
  )
  if (baseMatch) return baseMatch.id

  return preferredId
}

export function CartProvider({ children }) {
  // Safe init (works with SSR and bad JSON)
  const [cart, setCart] = useState(() => {
    if (typeof window === "undefined") return []
    try {
      const saved = localStorage.getItem("cart")
      const parsed = saved ? JSON.parse(saved) : []
      return normalizeCartData(parsed)
    } catch {
      return []
    }
  })
  // Track last add event for animation
  const [lastAddEvent, setLastAddEvent] = useState(null)
  // Track last remove event for animation
  const [lastRemoveEvent, setLastRemoveEvent] = useState(null)
  const [cartReplacePrompt, setCartReplacePrompt] = useState(null)

  // Persist to localStorage whenever cart changes
  useEffect(() => {
    try {
      const isAuthenticated = localStorage.getItem("user_authenticated") === "true" || !!localStorage.getItem("user_accessToken")
      if (cart.length > 0 || isAuthenticated) {
        localStorage.setItem("cart", JSON.stringify(normalizeCartData(cart)))
      }
    } catch {
      // ignore storage errors
    }
  }, [cart])

  const cartSyncTimerRef = useRef(null)

  const scheduleCartSync = useCallback(() => {
    if (typeof window === "undefined") return

    const isAuthenticated =
      localStorage.getItem("user_authenticated") === "true" ||
      !!localStorage.getItem("user_accessToken")

    if (!isAuthenticated) return

    if (cartSyncTimerRef.current) {
      clearTimeout(cartSyncTimerRef.current)
    }

    cartSyncTimerRef.current = setTimeout(() => {
      const items = normalizeCartData(cart)
      let pricing = null
      try {
        const rawPricing = sessionStorage.getItem("food_cart_pricing_snapshot")
        if (rawPricing) pricing = JSON.parse(rawPricing)
      } catch {
        pricing = null
      }
      userAPI.syncCart({ items, pricing }).catch(() => {})
    }, 1200)
  }, [cart])

  // Sync cart to server for admin visibility (authenticated users only)
  useEffect(() => {
    scheduleCartSync()

    const handlePricingUpdated = () => {
      scheduleCartSync()
    }

    window.addEventListener("food_cart_pricing_updated", handlePricingUpdated)

    return () => {
      window.removeEventListener("food_cart_pricing_updated", handlePricingUpdated)
      if (cartSyncTimerRef.current) {
        clearTimeout(cartSyncTimerRef.current)
      }
    }
  }, [scheduleCartSync])

  const addToCart = (item, sourcePosition = null, options = {}) => {
    if (!item) return { ok: false }
    const { forceReplace = false, quantity: requestedQuantity = 1 } = options
    const parsedQuantity = Number(requestedQuantity)
    const addQuantity =
      Number.isFinite(parsedQuantity) && parsedQuantity > 0
        ? Math.floor(parsedQuantity)
        : 1

    const safeCart = normalizeCartData(cart)
    if (!forceReplace && safeCart.length > 0) {
      const firstItemRestaurantId = safeCart[0]?.restaurantId
      const firstItemRestaurantName = safeCart[0]?.restaurant
      const newItemRestaurantId = item?.restaurantId || item?.restaurant_id || item?.restaurant?._id
      const newItemRestaurantName = item?.restaurant || item?.restaurantName || item?.restaurant?.name
      const normalizeName = (name) => (name ? String(name).trim().toLowerCase() : '')

      const firstRestaurantNameNormalized = normalizeName(firstItemRestaurantName)
      const newRestaurantNameNormalized = normalizeName(newItemRestaurantName)
      const hasNameMismatch =
        firstRestaurantNameNormalized &&
        newRestaurantNameNormalized &&
        firstRestaurantNameNormalized !== newRestaurantNameNormalized

      const hasIdMismatch =
        !firstRestaurantNameNormalized &&
        !newRestaurantNameNormalized &&
        firstItemRestaurantId &&
        newItemRestaurantId &&
        String(firstItemRestaurantId) !== String(newItemRestaurantId)

      if (hasNameMismatch || hasIdMismatch) {
        setCartReplacePrompt({
          item,
          sourcePosition,
          quantity: addQuantity,
          existingRestaurantName: firstItemRestaurantName || 'another restaurant',
          newRestaurantName: newItemRestaurantName || 'this restaurant',
        })
        return { ok: false, code: 'RESTAURANT_MISMATCH', needsConfirmation: true }
      }
    }

    const normalizedNewItems = normalizeCartData([{ ...item, quantity: addQuantity }])
    const normalizedNew = normalizedNewItems[0]
    if (!normalizedNew) return { ok: false }

    setCart((prev) => {
      const safePrev = forceReplace ? [] : normalizeCartData(prev)

      const existingIndex = safePrev.findIndex((i) => {
        if (i.id === normalizedNew.id || i.lineItemId === normalizedNew.id) return true
        if (String(i.itemId) === String(normalizedNew.itemId) && String(i.variantId || "") === String(normalizedNew.variantId || "")) return true
        if (i.name && normalizedNew.name && i.name.toLowerCase().trim() === normalizedNew.name.toLowerCase().trim() && String(i.variantId || "") === String(normalizedNew.variantId || "")) return true
        return false
      })

      if (existingIndex !== -1) {
        if (sourcePosition) {
          setLastAddEvent({
            product: {
              id: normalizedNew.id,
              name: normalizedNew.name,
              imageUrl: normalizedNew.image || normalizedNew.imageUrl,
            },
            sourcePosition,
          })
          setTimeout(() => setLastAddEvent(null), 1500)
        }
        return safePrev.map((i, idx) =>
          idx === existingIndex ? { ...i, quantity: i.quantity + addQuantity } : i
        )
      }

      if (sourcePosition) {
        setLastAddEvent({
          product: {
            id: normalizedNew.id,
            name: normalizedNew.name,
            imageUrl: normalizedNew.image || normalizedNew.imageUrl,
          },
          sourcePosition,
        })
        setTimeout(() => setLastAddEvent(null), 1500)
      }

      return [...safePrev, normalizedNew]
    })

    return { ok: true }
  }

  const cancelReplaceCart = () => {
    setCartReplacePrompt(null)
  }

  const confirmReplaceCart = () => {
    if (!cartReplacePrompt) return

    const { item, sourcePosition, quantity } = cartReplacePrompt
    setCartReplacePrompt(null)

    if (!item) return

    const parsedQuantity = Number(quantity)
    const addQuantity =
      Number.isFinite(parsedQuantity) && parsedQuantity > 0
        ? Math.floor(parsedQuantity)
        : 1

    const normalizedNew = normalizeCartData([{ ...item, quantity: addQuantity }])[0]
    if (!normalizedNew) return

    setCart([normalizedNew])

    if (sourcePosition) {
      setLastAddEvent({
        product: {
          id: normalizedNew.id,
          name: normalizedNew.name,
          imageUrl: normalizedNew.image || normalizedNew.imageUrl,
        },
        sourcePosition,
      })
      setTimeout(() => setLastAddEvent(null), 1500)
    }
  }

  const removeFromCart = (itemId, sourcePosition = null, productInfo = null) => {
    setCart((prev) => {
      const safePrev = normalizeCartData(prev)
      const resolvedItemId = resolveCartEntryId(safePrev, itemId)
      const itemToRemove = safePrev.find((i) => i.id === resolvedItemId || i.id === itemId || String(i.itemId) === String(itemId))
      if (itemToRemove && sourcePosition && productInfo) {
        setLastRemoveEvent({
          product: {
            id: productInfo.id || itemToRemove.id,
            name: productInfo.name || itemToRemove.name,
            imageUrl: productInfo.imageUrl || productInfo.image || itemToRemove.image || itemToRemove.imageUrl,
          },
          sourcePosition,
        })
        setTimeout(() => setLastRemoveEvent(null), 1500)
      }
      return safePrev.filter((i) => i.id !== resolvedItemId && i.id !== itemId && String(i.itemId) !== String(itemId))
    })
  }

  const updateQuantity = (itemId, quantity, sourcePosition = null, productInfo = null) => {
    const targetQty = Number(quantity)
    const normalizedTargetQty = Number.isFinite(targetQty) ? Math.floor(targetQty) : 0

    if (normalizedTargetQty <= 0) {
      removeFromCart(itemId, sourcePosition, productInfo)
      return
    }

    setCart((prev) => {
      const safePrev = normalizeCartData(prev)
      const resolved = resolveCartEntryId(safePrev, itemId)

      const targetIndex = safePrev.findIndex((i) =>
        i.id === resolved || i.id === itemId || String(i.itemId) === String(itemId) ||
        (productInfo?.name && i.name.toLowerCase().trim() === productInfo.name.toLowerCase().trim())
      )

      if (targetIndex === -1) return safePrev

      return safePrev.map((i, idx) =>
        idx === targetIndex ? { ...i, quantity: normalizedTargetQty } : i
      )
    })
  }

  const getCartCount = () =>
    normalizeCartData(cart).reduce((total, item) => total + (item.quantity || 0), 0)

  const isInCart = (itemId, variantId = "") => {
    const safeCart = normalizeCartData(cart)
    const resolvedItemId = resolveCartEntryId(safeCart, itemId, variantId)
    return safeCart.some((i) => i.id === resolvedItemId)
  }

  const getCartItem = (itemId, variantId = "") => {
    const safeCart = normalizeCartData(cart)
    const resolvedItemId = resolveCartEntryId(safeCart, itemId, variantId)
    return safeCart.find((i) => i.id === resolvedItemId) || null
  }

  const clearCart = () => setCart([])

  const replaceCart = (items) => {
    const normalizedItems = normalizeCartData(items).filter((item) => {
      const quantity = Number(item?.quantity)
      return item?.id && (item?.restaurantId || item?.restaurant) && Number.isFinite(quantity) && quantity > 0
    })

    setCart(normalizedItems)
    return { ok: true, count: normalizedItems.length }
  }

  // Clean cart to remove items from different restaurants
  // Keeps only items from the specified restaurant
  const cleanCartForRestaurant = (restaurantId, restaurantName) => {
    setCart((prev) => {
      const safePrev = normalizeCartData(prev)
      if (safePrev.length === 0) return safePrev;
      
      // Normalize restaurant name for comparison
      const normalizeName = (name) => name ? name.trim().toLowerCase() : '';
      const targetRestaurantNameNormalized = normalizeName(restaurantName);
      
      // Filter cart to keep only items from the target restaurant
      const cleanedCart = safePrev.filter((item) => {
        const itemRestaurantId = item?.restaurantId;
        const itemRestaurantName = item?.restaurant;
        const itemRestaurantNameNormalized = normalizeName(itemRestaurantName);
        
        // Check by restaurant name first (more reliable)
        if (targetRestaurantNameNormalized && itemRestaurantNameNormalized) {
          return itemRestaurantNameNormalized === targetRestaurantNameNormalized;
        }
        // Fallback to ID comparison
        if (restaurantId && itemRestaurantId) {
          return itemRestaurantId === restaurantId || 
                 itemRestaurantId === restaurantId.toString() ||
                 itemRestaurantId.toString() === restaurantId;
        }
        // If no match, remove item
        return false;
      });
      
      if (cleanedCart.length !== safePrev.length) {
        debugWarn('🧹 Cleaned cart: Removed items from different restaurants', {
          before: safePrev.length,
          after: cleanedCart.length,
          removed: safePrev.length - cleanedCart.length
        });
      }
      
      return cleanedCart;
    });
  }

  // Validate and clean cart on mount/load to prevent multiple restaurant items
  // This runs only once on initial load to clean up any corrupted cart data from localStorage
  useEffect(() => {
    const safeCart = normalizeCartData(cart)
    if (safeCart.length !== cart.length) {
      setCart(safeCart)
      return
    }
    if (safeCart.length === 0) return;
    
    // Get unique restaurant IDs and names
    const restaurantIds = safeCart.map(item => item.restaurantId).filter(Boolean);
    const restaurantNames = safeCart.map(item => item.restaurant).filter(Boolean);
    const uniqueRestaurantIds = [...new Set(restaurantIds)];
    const uniqueRestaurantNames = [...new Set(restaurantNames)];
    
    // Normalize restaurant names for comparison
    const normalizeName = (name) => name ? name.trim().toLowerCase() : '';
    const uniqueRestaurantNamesNormalized = uniqueRestaurantNames.map(normalizeName);
    const uniqueRestaurantNamesSet = new Set(uniqueRestaurantNamesNormalized);
    
    // Check if cart has items from multiple restaurants
    if (uniqueRestaurantIds.length > 1 || uniqueRestaurantNamesSet.size > 1) {
      debugWarn('⚠️ Cart contains items from multiple restaurants. Cleaning cart...', {
        restaurantIds: uniqueRestaurantIds,
        restaurantNames: uniqueRestaurantNames
      });
      
      // Keep items from the first restaurant (most recent or first in cart)
      const firstRestaurantId = uniqueRestaurantIds[0];
      const firstRestaurantName = uniqueRestaurantNames[0];
      
      setCart((prev) => {
        const safePrev = normalizeCartData(prev)
        const normalizeName = (name) => name ? name.trim().toLowerCase() : '';
        const firstRestaurantNameNormalized = normalizeName(firstRestaurantName);
        
        return safePrev.filter((item) => {
          const itemRestaurantId = item?.restaurantId;
          const itemRestaurantName = item?.restaurant;
          const itemRestaurantNameNormalized = normalizeName(itemRestaurantName);
          
          // Check by restaurant name first
          if (firstRestaurantNameNormalized && itemRestaurantNameNormalized) {
            return itemRestaurantNameNormalized === firstRestaurantNameNormalized;
          }
          // Fallback to ID comparison
          if (firstRestaurantId && itemRestaurantId) {
            return itemRestaurantId === firstRestaurantId || 
                   itemRestaurantId === firstRestaurantId.toString() ||
                   itemRestaurantId.toString() === firstRestaurantId;
          }
          return false;
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount to clean up localStorage data

  // Transform cart to match AddToCartAnimation expected structure
  const cartForAnimation = useMemo(() => {
    const safeCart = normalizeCartData(cart)
    const items = safeCart.map(item => ({
      product: {
        id: item.id,
        name: item.name,
        imageUrl: item.image || item.imageUrl,
      },
      quantity: item.quantity || 1,
    }))
    
    const itemCount = safeCart.reduce((total, item) => total + (item.quantity || 0), 0)
    const total = safeCart.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0)
    
    return {
      items,
      itemCount,
      total,
    }
  }, [cart])

  const value = useMemo(
    () => ({
      _isProvider: true, // Flag to identify this is from the actual provider
      // Keep original cart array for backward compatibility
      cart,
      // Add animation-compatible structure
      items: cartForAnimation.items,
      itemCount: cartForAnimation.itemCount,
      total: cartForAnimation.total,
      lastAddEvent,
      lastRemoveEvent,
      addToCart,
      removeFromCart,
      updateQuantity,
      getCartCount,
      isInCart,
      getCartItem,
      clearCart,
      cleanCartForRestaurant,
      replaceCart,
      cartReplacePrompt,
      confirmReplaceCart,
      cancelReplaceCart,
    }),
    [cart, cartForAnimation, lastAddEvent, lastRemoveEvent, cartReplacePrompt]
  )

  return (
    <CartContext.Provider value={value}>
      {children}
      <CartReplaceDialog
        open={!!cartReplacePrompt}
        existingRestaurantName={cartReplacePrompt?.existingRestaurantName || "another restaurant"}
        newRestaurantName={cartReplacePrompt?.newRestaurantName || "this restaurant"}
        onConfirm={confirmReplaceCart}
        onCancel={cancelReplaceCart}
      />
    </CartContext.Provider>
  )
}

export function useCart() {
  const context = useContext(CartContext)
  // Check if context is from the actual provider by checking the _isProvider flag
  if (!context || context._isProvider !== true) {
    // In development, log a warning but don't throw to prevent crashes
    if (process.env.NODE_ENV === 'development') {
      debugWarn('⚠️ useCart called outside CartProvider. Using default values.');
      debugWarn('💡 Make sure the component is rendered inside UserLayout which provides CartProvider.');
    }
    // Return default context instead of throwing
    return defaultCartContext
  }
  return context
}

