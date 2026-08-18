import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { useCart } from "@food/context/CartContext"
import { useProfile } from "@food/context/ProfileContext"
import { restaurantAPI } from "@food/api"

const normalizeZoneId = (value) => String(value || "").trim()

const resolveRestaurantZoneId = async (cartItem) => {
  const cachedZoneId = cartItem?.restaurantZoneId
  if (cachedZoneId) return normalizeZoneId(cachedZoneId)

  const restaurantId = cartItem?.restaurantId
  if (!restaurantId) return ""

  try {
    const response = await restaurantAPI.getRestaurantById(restaurantId)
    const restaurant = response?.data?.data?.restaurant || response?.data?.restaurant
    return normalizeZoneId(restaurant?.zoneId)
  } catch {
    return ""
  }
}

/**
 * Clears cart when the active delivery zone no longer matches the restaurant's zone.
 */
export function useCartZoneGuard(zoneId, zoneStatus) {
  const { cart, clearCart } = useCart()
  const { orderType } = useProfile()
  const validatingRef = useRef(false)
  const lastCheckedKeyRef = useRef("")

  useEffect(() => {
    if (orderType === "takeaway" || orderType === "dining") return
    if (!cart.length) {
      lastCheckedKeyRef.current = ""
      return
    }
    if (zoneStatus === "loading" || !zoneId) return

    const checkKey = `${normalizeZoneId(zoneId)}:${cart[0]?.restaurantId || cart[0]?.restaurant || ""}:${cart.length}`
    if (lastCheckedKeyRef.current === checkKey || validatingRef.current) return

    let cancelled = false

    const validateCartZone = async () => {
      validatingRef.current = true
      try {
        const restaurantZoneId = await resolveRestaurantZoneId(cart[0])
        if (cancelled || !restaurantZoneId) return

        if (restaurantZoneId !== normalizeZoneId(zoneId)) {
          clearCart()
          toast.error("Cart cleared — this restaurant does not deliver to your selected location.")
          lastCheckedKeyRef.current = ""
          return
        }

        lastCheckedKeyRef.current = checkKey
      } finally {
        validatingRef.current = false
      }
    }

    validateCartZone()

    return () => {
      cancelled = true
    }
  }, [zoneId, zoneStatus, cart, clearCart, orderType])
}
