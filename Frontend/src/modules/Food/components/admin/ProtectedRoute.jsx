import { Navigate, useLocation } from "react-router-dom"
import { isModuleAuthenticated, getModuleToken, isTokenExpired, clearModuleAuth } from "@food/utils/auth"

export default function ProtectedRoute({ children }) {
  const location = useLocation()
  const token = getModuleToken("admin")
  const isAuthenticated = isModuleAuthenticated("admin")

  if (!isAuthenticated) {
    if (token && isTokenExpired(token)) {
      clearModuleAuth("admin")
    }
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />
  }

  return children
}
