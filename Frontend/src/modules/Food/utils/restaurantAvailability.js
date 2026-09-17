import { formatTime12Hour } from "@food/utils/outletHours"
import { getOperatingStatus } from "@food/utils/operatingHours"

const formatClosingCountdown = (minutesUntilClose, closingTime) => {
  if (minutesUntilClose === null || minutesUntilClose === undefined) return null

  if (minutesUntilClose <= 0) {
    return closingTime ? `Closes at ${formatTime12Hour(closingTime)}` : null
  }

  if (minutesUntilClose < 60) {
    return `Closes in ${minutesUntilClose} min`
  }

  const hours = Math.floor(minutesUntilClose / 60)
  const minutes = minutesUntilClose % 60

  if (minutes === 0) {
    return `Closes in ${hours}h`
  }

  return `Closes in ${hours}h ${minutes}m`
}

export const getRestaurantAvailabilityStatus = (restaurant, now = new Date(), options = {}) => {
  if (!restaurant) {
    return {
      isOpen: false,
      isActive: false,
      isAcceptingOrders: false,
      isWithinTimings: false,
      reason: "missing-restaurant",
    }
  }

  const ignoreOperationalStatus = options?.ignoreOperationalStatus === true
  const isActive = restaurant.isActive !== false
  const isAcceptingOrders = restaurant.isAcceptingOrders !== false

  if (!ignoreOperationalStatus && !isActive) {
    return {
      isOpen: false,
      isActive,
      isAcceptingOrders,
      isWithinTimings: false,
      reason: "inactive",
    }
  }

  if (!ignoreOperationalStatus && !isAcceptingOrders) {
    return {
      isOpen: false,
      isActive,
      isAcceptingOrders,
      isWithinTimings: false,
      reason: "not-accepting-orders",
    }
  }

  // Weekly outlet timings win per day; restaurant-level hours / openDays are the fallback.
  // Overnight shifts from the previous day are honoured and evaluated in IST, like the backend.
  const status = getOperatingStatus(
    {
      timings: restaurant.outletTimings,
      restaurant: {
        openingTime: restaurant?.deliveryTimings?.openingTime || restaurant?.openingTime,
        closingTime: restaurant?.deliveryTimings?.closingTime || restaurant?.closingTime,
        openDays: restaurant.openDays,
      },
    },
    now
  )

  if (status.reason === "day-closed") {
    return {
      isOpen: false,
      isActive,
      isAcceptingOrders,
      isWithinTimings: false,
      opensAt: status.opensAt,
      reason: "day-closed",
    }
  }

  const isWithinTimings = status.isOpen

  return {
    isOpen: isWithinTimings,
    isActive,
    isAcceptingOrders,
    isWithinTimings,
    openingTime: status.openingTime,
    closingTime: status.closingTime,
    overnight: status.overnight,
    opensAt: status.opensAt,
    closesAt: status.closesAt,
    minutesUntilClose: status.minutesUntilClose,
    closingCountdownLabel: isWithinTimings
      ? formatClosingCountdown(status.minutesUntilClose, status.closingTime)
      : null,
    reason: isWithinTimings
      ? (status.reason === "no-timings" ? "no-timings" : "open")
      : "outside-hours",
  }
}
