import { Navigate, useLocation } from "react-router-dom";
import { isModuleAuthenticated, clearModuleAuth } from "@food/utils/auth";

/**
 * Role-based Protected Route Component
 * Only allows access if user is authenticated for the specific module
 */
export default function ProtectedRoute({ children, requiredRole, loginPath = "/user/auth/login" }) {
  const location = useLocation();

  // If no role required, allow access
  if (!requiredRole) {
    return children;
  }

  const isAuthenticated = isModuleAuthenticated(requiredRole);

  // If not authenticated for this module, redirect to login
  if (!isAuthenticated) {
    return <Navigate to={loginPath} state={{ from: location.pathname }} replace />;
  }

  // Intercept restaurant status - strictly block any non-approved restaurant from entering dashboard
  if (requiredRole === "restaurant") {
    const userStr = localStorage.getItem("restaurant_user");
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        const status = String(user?.status || "").toLowerCase();
        if (status !== "approved" || user?.isActive === false) {
          clearModuleAuth("restaurant");
          return <Navigate to={loginPath} replace />;
        }
      } catch (e) {
        clearModuleAuth("restaurant");
        return <Navigate to={loginPath} replace />;
      }
    }
  }

  return children;
}
