import { Navigate } from "react-router-dom"
import { isModuleAuthenticated, clearModuleAuth } from "@food/utils/auth"

function checkRestaurantApproval() {
  const userStr = localStorage.getItem("restaurant_user")
  if (!userStr) return false

  try {
    const user = JSON.parse(userStr)
    const status = String(user?.status || "").toLowerCase()
    if (status !== "approved" || user?.isActive === false) {
      clearModuleAuth("restaurant")
      return false
    }
    return true
  } catch (e) {
    clearModuleAuth("restaurant")
    return false
  }
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
      const isApproved = checkRestaurantApproval();
      if (!isApproved) {
        return <>{children}</>;
      }
    }

    const homePath = redirectTo || moduleHomePages[module] || "/food";
    return <Navigate to={homePath} replace />;
  }

  return <>{children}</>
}
