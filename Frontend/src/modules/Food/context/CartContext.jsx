// src/modules/Food/context/CartContext.jsx
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { foodCartAPI } from "@food/api"
import { buildCartLineId } from "@food/utils/foodVariants"

const debugWarn = (...args) => {}
const debugError = (...args) => {}

const GUEST_CART_KEY = "cart"

const defaultCartContext = {
  _isProvider: false,
  cart: [],
  items: [],
  itemCount: 0,
  total: 0,
  cartReady: false,
  couponCode: "",
  restaurantId: null,
  restaurantName: "",
  lastAddEvent: null,
  lastRemoveEvent: null,
  addToCart: () => {
    debugWarn("CartProvider not available - addToCart called")
    return { ok: false, error: "Cart unavailable" }
  },
  removeFromCart: () => {
    debugWarn("CartProvider not available - removeFromCart called")
  },
  updateQuantity: () => {
    debugWarn("CartProvider not available - updateQuantity called")
  },
  getCartCount: () => 0,
  isInCart: () => false,
  getCartItem: () => null,
  clearCart: () => {
    debugWarn("CartProvider not available - clearCart called")
  },
  cleanCartForRestaurant: () => {
    debugWarn("CartProvider not available - cleanCartForRestaurant called")
  },
  replaceCart: () => {
    debugWarn("CartProvider not available - replaceCart called")
    return { ok: false }
  },
  setCartCoupon: () => Promise.resolve({ ok: false }),
  refreshCart: () => Promise.resolve([]),
}

const CartContext = createContext(defaultCartContext)

const getUserToken = () => {
  if (typeof window === "undefined") return null
  try {
    const authCustomer = localStorage.getItem("auth_customer")
    if (authCustomer) {
      if (authCustomer.startsWith("{")) {
        try {
          return JSON.parse(authCustomer)?.token || null
        } catch {
          return authCustomer
        }
      }
      return authCustomer
    }
    return (
      localStorage.getItem("user_accessToken") ||
      localStorage.getItem("accessToken") ||
      null
    )
  } catch {
    return null
  }
}

const isUserAuthenticated = () => Boolean(getUserToken())

const getItemOrderType = (item) => (item?.orderType === "quick" ? "quick" : "food")
const getItemSourceId = (item, orderType) =>
  String(
    item?.sourceId ||
      (orderType === "quick"
        ? item?.quickStoreId || item?.storeId || item?.sellerId || item?.restaurantId || ""
        : item?.restaurantId || item?.sourceRestaurantId || ""),
  )

const normalizeCartData = (rawCart) => {
  if (!Array.isArray(rawCart)) return []

  return rawCart
    .filter((item) => item && typeof item === "object")
    .map((item, index) => {
      const parsedQuantity = Number(item.quantity)
      const parsedPrice = Number(item.price)
      const normalizedRestaurantName =
        typeof item.restaurant === "string"
          ? item.restaurant
          : typeof item.restaurant?.name === "string"
            ? item.restaurant.name
            : typeof item.sourceName === "string"
              ? item.sourceName
              : ""

      const normalizedRestaurantId =
        item.restaurantId ||
        item.restaurant_id ||
        item.restaurant?._id ||
        item.restaurant?.restaurantId ||
        item.sourceId ||
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
        `cart-item-${index}`

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
      const orderType = item.orderType === "quick" ? "quick" : "food"
      const sourceId = getItemSourceId({ ...item, restaurantId: normalizedRestaurantId }, orderType)
      const lineItemId =
        item.lineItemId ||
        item.cartLineId ||
        item.id ||
        buildCartLineId(baseItemId, variantId)

      return {
        ...item,
        id: String(lineItemId),
        lineItemId: String(lineItemId),
        itemId: String(baseItemId),
        productId: String(baseItemId),
        variantId: variantId ? String(variantId) : "",
        variantName,
        variantPrice: Number.isFinite(parsedVariantPrice) ? parsedVariantPrice : 0,
        name: item.name || item.product?.name || "Item",
        orderType,
        type: orderType,
        sourceId,
        sourceName:
          item.sourceName ||
          (orderType === "quick"
            ? item.quickStoreName || item.storeName || item.sellerName || "Quick Commerce"
            : normalizedRestaurantName),
        quantity:
          Number.isFinite(parsedQuantity) && parsedQuantity > 0
            ? Math.floor(parsedQuantity)
            : 1,
        price: Number.isFinite(parsedPrice) ? parsedPrice : 0,
        otherPrice: Number(item.otherPrice) || 0,
        restaurant: normalizedRestaurantName,
        restaurantId: normalizedRestaurantId,
        image: normalizedImage,
        imageUrl: normalizedImage,
      }
    })
}

const extractCartPayload = (response) => {
  const data = response?.data?.data?.cart ?? response?.data?.cart ?? response?.data?.data ?? null
  if (!data || typeof data !== "object") {
    return { items: [], couponCode: "", restaurantId: null, restaurantName: "" }
  }
  if (Array.isArray(data)) {
    return { items: data, couponCode: "", restaurantId: null, restaurantName: "" }
  }
  return {
    items: Array.isArray(data.items) ? data.items : [],
    couponCode: data.couponCode || "",
    restaurantId: data.restaurantId || null,
    restaurantName: data.restaurantName || "",
  }
}

const readGuestCart = () => {
  if (typeof window === "undefined") return []
  try {
    const saved = localStorage.getItem(GUEST_CART_KEY)
    return normalizeCartData(saved ? JSON.parse(saved) : [])
  } catch {
    return []
  }
}

const writeGuestCart = (items) => {
  try {
    const normalized = normalizeCartData(items)
    if (normalized.length > 0) {
      localStorage.setItem(GUEST_CART_KEY, JSON.stringify(normalized))
    } else {
      localStorage.removeItem(GUEST_CART_KEY)
    }
  } catch {
    // ignore
  }
}

const clearGuestCartStorage = () => {
  try {
    localStorage.removeItem(GUEST_CART_KEY)
  } catch {
    // ignore
  }
}

const normalizeVariantKey = (value) => {
  const raw = String(value || "").trim()
  if (!raw || raw === "base") return ""
  return raw
}

const parseCompositeLineId = (value) => {
  const str = String(value || "")
  const sep = str.indexOf("::")
  if (sep <= 0) return null
  return {
    itemId: str.slice(0, sep),
    variantId: normalizeVariantKey(str.slice(sep + 2)),
  }
}

const resolveCartEntryId = (items, itemId, variantId = "") => {
  const normalizedItemId = String(itemId || "")
  const safeItems = Array.isArray(items) ? items : []
  const requestedVariant = normalizeVariantKey(variantId)

  const directMatch = safeItems.find((item) => item.id === normalizedItemId)
  if (directMatch) return directMatch.id

  const composite = parseCompositeLineId(normalizedItemId)
  if (composite) {
    const compositeMatch = safeItems.find(
      (item) =>
        String(item.itemId || item.productId || "") === composite.itemId &&
        normalizeVariantKey(item.variantId) === composite.variantId,
    )
    if (compositeMatch) return compositeMatch.id
  }

  const preferredId = buildCartLineId(normalizedItemId, requestedVariant || "base")
  const exactMatch = safeItems.find((item) => item.id === preferredId)
  if (exactMatch) return exactMatch.id

  const byItemVariant = safeItems.find(
    (item) =>
      String(item.itemId || item.productId || "") === normalizedItemId &&
      normalizeVariantKey(item.variantId) === requestedVariant,
  )
  if (byItemVariant) return byItemVariant.id

  if (!requestedVariant) {
    const legacyBaseMatch = safeItems.find(
      (item) =>
        String(item.itemId || item.productId || item.id || "") === normalizedItemId &&
        !normalizeVariantKey(item.variantId),
    )
    if (legacyBaseMatch) return legacyBaseMatch.id
  }

  return preferredId
}

const apiErrorMessage = (err, fallback = "Cart update failed") =>
  err?.response?.data?.message || err?.message || fallback

export function CartProvider({ children }) {
  const [cart, setCart] = useState([])
  const [couponCode, setCouponCode] = useState("")
  const [restaurantId, setRestaurantId] = useState(null)
  const [restaurantName, setRestaurantName] = useState("")
  const [cartReady, setCartReady] = useState(false)
  const [lastAddEvent, setLastAddEvent] = useState(null)
  const [lastRemoveEvent, setLastRemoveEvent] = useState(null)

  const authRef = useRef(isUserAuthenticated())
  const loadSeqRef = useRef(0)
  const mutationSeqRef = useRef(0)
  const inflightQtyRef = useRef(new Map())
  const loadedOnceRef = useRef(false)

  const applyServerCart = useCallback((payload) => {
    const next = normalizeCartData(payload?.items || [])
    setCart(next)
    setCouponCode(payload?.couponCode || "")
    setRestaurantId(payload?.restaurantId || null)
    setRestaurantName(payload?.restaurantName || "")
    clearGuestCartStorage()
    return next
  }, [])

  const loadDbCart = useCallback(async () => {
    const seq = ++loadSeqRef.current
    try {
      const response = await foodCartAPI.getCart()
      if (seq !== loadSeqRef.current) return []
      const payload = extractCartPayload(response)
      return applyServerCart(payload)
    } catch (err) {
      if (seq === loadSeqRef.current) {
        debugError("Failed to load food cart", err)
        setCartReady(true)
      }
      return []
    } finally {
      if (seq === loadSeqRef.current) {
        setCartReady(true)
        loadedOnceRef.current = true
      }
    }
  }, [applyServerCart])

  // Initialize once: DB cart for auth users, guest LS otherwise (never persist auth cart to LS).
  useEffect(() => {
    const authed = isUserAuthenticated()
    authRef.current = authed
    if (authed) {
      clearGuestCartStorage()
      loadDbCart()
    } else {
      setCart(readGuestCart())
      setCartReady(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reload cart once when user logs in (not on every token sync).
  useEffect(() => {
    const onAuthChanged = () => {
      const nextAuthed = isUserAuthenticated()
      const wasAuthed = authRef.current
      authRef.current = nextAuthed
      if (nextAuthed && !wasAuthed) {
        loadedOnceRef.current = false
        clearGuestCartStorage()
        loadDbCart()
      } else if (!nextAuthed && wasAuthed) {
        setCart([])
        setCouponCode("")
        setRestaurantId(null)
        setRestaurantName("")
        clearGuestCartStorage()
        setCartReady(true)
      }
    }
    window.addEventListener("userAuthChanged", onAuthChanged)
    window.addEventListener("storage", onAuthChanged)
    return () => {
      window.removeEventListener("userAuthChanged", onAuthChanged)
      window.removeEventListener("storage", onAuthChanged)
    }
  }, [loadDbCart])

  // Guest-only localStorage persistence
  useEffect(() => {
    if (!cartReady) return
    if (authRef.current || isUserAuthenticated()) {
      clearGuestCartStorage()
      return
    }
    writeGuestCart(cart)
  }, [cart, cartReady])

  const normalizedCart = useMemo(() => normalizeCartData(cart), [cart])

  const triggerAddAnimation = (item, sourcePosition) => {
    if (!sourcePosition) return
    setLastAddEvent({
      product: {
        id: item.id || item.itemId,
        name: item.name,
        imageUrl: item.image || item.imageUrl,
      },
      sourcePosition,
    })
    setTimeout(() => setLastAddEvent(null), 1500)
  }

  const triggerRemoveAnimation = (item, sourcePosition, productInfo) => {
    if (!sourcePosition || !productInfo) return
    setLastRemoveEvent({
      product: {
        id: productInfo.id || item?.id,
        name: productInfo.name || item?.name,
        imageUrl:
          productInfo.imageUrl ||
          productInfo.image ||
          item?.image ||
          item?.imageUrl,
      },
      sourcePosition,
    })
    setTimeout(() => setLastRemoveEvent(null), 1500)
  }

  const addToCart = useCallback(
    async (item, sourcePosition = null) => {
      if (!item) return { ok: false, error: "Invalid item" }

      const authed = isUserAuthenticated()
      if (!authed) {
        // Guest path (local only)
        if (normalizedCart.length > 0) {
          const currentOrderType = getItemOrderType(normalizedCart[0])
          const nextOrderType = getItemOrderType(item)
          if (currentOrderType === "food" && nextOrderType === "food") {
            const firstName = String(normalizedCart[0]?.restaurant || "")
              .trim()
              .toLowerCase()
            const nextName = String(item?.restaurant || "")
              .trim()
              .toLowerCase()
            const firstId = normalizedCart[0]?.restaurantId
            const nextId = item?.restaurantId
            if (
              (firstName && nextName && firstName !== nextName) ||
              (!firstName &&
                !nextName &&
                firstId &&
                nextId &&
                String(firstId) !== String(nextId))
            ) {
              return {
                ok: false,
                error: `Cart already contains items from "${normalizedCart[0]?.restaurant || "another restaurant"}". Please clear cart or complete order first.`,
                code: "RESTAURANT_MISMATCH",
              }
            }
          }
        }
        if (!item?.restaurantId && !item?.restaurant) {
          return {
            ok: false,
            error: "Item is missing restaurant information. Please refresh the page.",
            code: "MISSING_RESTAURANT",
          }
        }

        setCart((prev) => {
          const safePrev = normalizeCartData(prev)
          const lineId =
            item.id ||
            buildCartLineId(
              item.itemId || item.productId || item.id,
              item.variantId || "",
            )
          const existing = safePrev.find((i) => i.id === lineId)
          triggerAddAnimation({ ...item, id: lineId }, sourcePosition)
          if (existing) {
            return safePrev.map((i) =>
              i.id === lineId ? { ...i, quantity: i.quantity + (Number(item.quantity) || 1) } : i,
            )
          }
          return [
            ...safePrev,
            {
              ...item,
              id: lineId,
              lineItemId: lineId,
              quantity: Number(item.quantity) || 1,
            },
          ]
        })
        return { ok: true }
      }

      const seq = ++mutationSeqRef.current
      try {
        const response = await foodCartAPI.addItem({
          itemId: item.itemId || item.productId || item.foodId || item.id,
          variantId: item.variantId || "",
          quantity: Number(item.quantity) || 1,
        })
        if (seq !== mutationSeqRef.current) {
          return { ok: true }
        }
        const payload = extractCartPayload(response)
        applyServerCart(payload)
        triggerAddAnimation(item, sourcePosition)
        return { ok: true, cart: payload.items }
      } catch (err) {
        const code = err?.response?.data?.code || err?.code
        const message = apiErrorMessage(err)
        if (code === "RESTAURANT_MISMATCH" || /another restaurant|already contains/i.test(message)) {
          return { ok: false, error: message, code: "RESTAURANT_MISMATCH" }
        }
        return { ok: false, error: message }
      }
    },
    [applyServerCart, normalizedCart],
  )

  const removeFromCart = useCallback(
    async (itemId, sourcePosition = null, productInfo = null) => {
      const resolvedItemId = resolveCartEntryId(normalizedCart, itemId)
      const itemToRemove = normalizedCart.find((i) => i.id === resolvedItemId)

      if (!isUserAuthenticated()) {
        triggerRemoveAnimation(itemToRemove, sourcePosition, productInfo)
        setCart((prev) => normalizeCartData(prev).filter((i) => i.id !== resolvedItemId))
        return
      }

      const lineId = itemToRemove?.lineItemId || itemToRemove?.id || resolvedItemId
      const seq = ++mutationSeqRef.current
      try {
        const response = await foodCartAPI.removeItem(lineId)
        if (seq !== mutationSeqRef.current) return
        applyServerCart(extractCartPayload(response))
        triggerRemoveAnimation(itemToRemove, sourcePosition, productInfo)
      } catch (err) {
        debugError("removeFromCart failed", err)
      }
    },
    [applyServerCart, normalizedCart],
  )

  const updateQuantity = useCallback(
    async (itemId, quantity, sourcePosition = null, productInfo = null) => {
      const resolvedItemId = resolveCartEntryId(normalizedCart, itemId)
      const existingItem = normalizedCart.find((i) => i.id === resolvedItemId)

      if (!isUserAuthenticated()) {
        if (quantity <= 0) {
          triggerRemoveAnimation(existingItem, sourcePosition, productInfo)
          setCart((prev) => normalizeCartData(prev).filter((i) => i.id !== resolvedItemId))
          return
        }
        if (existingItem && quantity < existingItem.quantity) {
          triggerRemoveAnimation(existingItem, sourcePosition, productInfo)
        }
        setCart((prev) =>
          normalizeCartData(prev).map((i) =>
            i.id === resolvedItemId ? { ...i, quantity } : i,
          ),
        )
        return
      }

      const lineId = existingItem?.lineItemId || existingItem?.id || resolvedItemId
      if (!lineId) return

      // Collapse rapid clicks on the same line into the latest quantity.
      const prev = inflightQtyRef.current.get(lineId)
      if (prev?.controller) {
        try {
          prev.controller.abort()
        } catch {
          // ignore
        }
      }
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null
      const seq = ++mutationSeqRef.current
      inflightQtyRef.current.set(lineId, { seq, controller })

      try {
        if (quantity <= 0) {
          const response = await foodCartAPI.removeItem(lineId)
          if (seq !== mutationSeqRef.current) return
          applyServerCart(extractCartPayload(response))
          triggerRemoveAnimation(existingItem, sourcePosition, productInfo)
          return
        }

        if (existingItem && quantity < existingItem.quantity) {
          triggerRemoveAnimation(existingItem, sourcePosition, productInfo)
        }

        const response = await foodCartAPI.updateItem(lineId, { quantity })
        if (seq !== mutationSeqRef.current) return
        applyServerCart(extractCartPayload(response))
      } catch (err) {
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return
        debugError("updateQuantity failed", err)
      } finally {
        const current = inflightQtyRef.current.get(lineId)
        if (current?.seq === seq) inflightQtyRef.current.delete(lineId)
      }
    },
    [applyServerCart, normalizedCart],
  )

  const getCartCount = useCallback(
    () => normalizedCart.reduce((total, item) => total + (item.quantity || 0), 0),
    [normalizedCart],
  )

  const isInCart = useCallback(
    (itemId, variantId = "") => {
      const resolvedItemId = resolveCartEntryId(normalizedCart, itemId, variantId)
      return normalizedCart.some((i) => i.id === resolvedItemId)
    },
    [normalizedCart],
  )

  const getCartItem = useCallback(
    (itemId, variantId = "") => {
      const resolvedItemId = resolveCartEntryId(normalizedCart, itemId, variantId)
      return normalizedCart.find((i) => i.id === resolvedItemId) || null
    },
    [normalizedCart],
  )

  const clearCart = useCallback(async () => {
    if (!isUserAuthenticated()) {
      setCart([])
      clearGuestCartStorage()
      return { ok: true }
    }
    const seq = ++mutationSeqRef.current
    try {
      const response = await foodCartAPI.clearCart()
      if (seq !== mutationSeqRef.current) return { ok: true }
      applyServerCart(extractCartPayload(response))
      return { ok: true }
    } catch (err) {
      debugError("clearCart failed", err)
      return { ok: false, error: apiErrorMessage(err) }
    }
  }, [applyServerCart])

  const replaceCart = useCallback(
    async (items) => {
      const normalizedItems = normalizeCartData(items).filter((item) => {
        const quantity = Number(item?.quantity)
        return (
          item?.id &&
          (item?.restaurantId || item?.restaurant) &&
          Number.isFinite(quantity) &&
          quantity > 0
        )
      })

      if (!isUserAuthenticated()) {
        setCart(normalizedItems)
        return { ok: true, count: normalizedItems.length }
      }

      const seq = ++mutationSeqRef.current
      try {
        await foodCartAPI.clearCart()
        let lastPayload = { items: [], couponCode: "", restaurantId: null, restaurantName: "" }
        for (const item of normalizedItems) {
          const response = await foodCartAPI.addItem({
            itemId: item.itemId || item.productId || item.id,
            variantId: item.variantId || "",
            quantity: item.quantity || 1,
          })
          lastPayload = extractCartPayload(response)
        }
        if (seq !== mutationSeqRef.current) return { ok: true, count: 0 }
        applyServerCart(lastPayload)
        return { ok: true, count: lastPayload.items?.length || 0 }
      } catch (err) {
        debugError("replaceCart failed", err)
        return { ok: false, error: apiErrorMessage(err) }
      }
    },
    [applyServerCart],
  )

  const cleanCartForRestaurant = useCallback(
    async (targetRestaurantId, targetRestaurantName) => {
      if (!isUserAuthenticated()) {
        setCart((prev) => {
          const safePrev = normalizeCartData(prev)
          const normalizeName = (name) => (name ? String(name).trim().toLowerCase() : "")
          const targetName = normalizeName(targetRestaurantName)
          return safePrev.filter((item) => {
            const itemName = normalizeName(item?.restaurant)
            if (targetName && itemName) return itemName === targetName
            if (targetRestaurantId && item?.restaurantId) {
              return String(item.restaurantId) === String(targetRestaurantId)
            }
            return false
          })
        })
        return
      }

      const keep = normalizedCart.filter((item) => {
        const normalizeName = (name) => (name ? String(name).trim().toLowerCase() : "")
        const targetName = normalizeName(targetRestaurantName)
        const itemName = normalizeName(item?.restaurant)
        if (targetName && itemName) return itemName === targetName
        if (targetRestaurantId && item?.restaurantId) {
          return String(item.restaurantId) === String(targetRestaurantId)
        }
        return false
      })

      if (keep.length === normalizedCart.length) return
      if (keep.length === 0) {
        await clearCart()
        return
      }
      await replaceCart(keep)
    },
    [clearCart, normalizedCart, replaceCart],
  )

  const setCartCoupon = useCallback(
    async (code = "") => {
      if (!isUserAuthenticated()) {
        setCouponCode(String(code || "").trim().toUpperCase())
        return { ok: true }
      }
      try {
        const response = await foodCartAPI.setCoupon(code)
        applyServerCart(extractCartPayload(response))
        return { ok: true }
      } catch (err) {
        return { ok: false, error: apiErrorMessage(err) }
      }
    },
    [applyServerCart],
  )

  const refreshCart = useCallback(async () => {
    if (!isUserAuthenticated()) return normalizedCart
    return loadDbCart()
  }, [loadDbCart, normalizedCart])

  const cartForAnimation = useMemo(() => {
    const items = normalizedCart.map((item) => ({
      product: {
        id: item.id,
        name: item.name,
        imageUrl: item.image || item.imageUrl,
      },
      quantity: item.quantity || 1,
    }))
    const itemCount = normalizedCart.reduce((total, item) => total + (item.quantity || 0), 0)
    const total = normalizedCart.reduce(
      (sum, item) => sum + (item.price || 0) * (item.quantity || 0),
      0,
    )
    return { items, itemCount, total }
  }, [normalizedCart])

  const value = useMemo(
    () => ({
      _isProvider: true,
      cart: normalizedCart,
      // Ometto compatibility: delivery/takeaway share the same server cart when logged in.
      deliveryCart: normalizedCart,
      takeawayCart: normalizedCart,
      items: cartForAnimation.items,
      itemCount: cartForAnimation.itemCount,
      total: cartForAnimation.total,
      cartReady,
      couponCode,
      restaurantId,
      restaurantName,
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
      setCartCoupon,
      refreshCart,
    }),
    [
      normalizedCart,
      cartForAnimation,
      cartReady,
      couponCode,
      restaurantId,
      restaurantName,
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
      setCartCoupon,
      refreshCart,
    ],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const context = useContext(CartContext)
  if (!context || context._isProvider !== true) {
    if (process.env.NODE_ENV === "development") {
      debugWarn("⚠️ useCart called outside CartProvider. Using default values.")
    }
    return defaultCartContext
  }
  return context
}
