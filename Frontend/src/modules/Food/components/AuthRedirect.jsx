import { Navigate } from "react-router-dom"
import { isModuleAuthenticated } from "@food/utils/auth"

function getRestaurantPendingRedirect() {
  const userStr = localStorage.getItem("restaurant_user")
  if (!userStr) return null

  try {
    const user = JSON.parse(userStr)
    const status = String(user?.status || "").toLowerCase()
    if (status === "pending" || status === "rejected") {
      return "/food/restaurant/pending-verification"
    }
    if (status === "banned" || status === "deleted") {
      return "/food/restaurant/pending-verification"
    }
  } catch (e) {
    // ignore
  }

  return null
}

/**
 * AuthRedirect Component
 * Redirects authenticated users away from auth pages to their module's home page
 */
export default function AuthRedirect({ children, module, redirectTo = null }) {
  const isAuthenticated = isModuleAuthenticated(module)

  const moduleHomePages = {
    user: "/food/user",
    restaurant: "/food/restaurant",
    delivery: "/food/delivery",
    admin: "/food/admin",
  }

  if (isAuthenticated) {
    if (module === "restaurant") {
      const pendingPath = getRestaurantPendingRedirect()
      if (pendingPath) {
        return <Navigate to={pendingPath} replace />
      }
    }

    const homePath = redirectTo || moduleHomePages[module] || "/food"
    return <Navigate to={homePath} replace />
  }

  return <>{children}</>
}
