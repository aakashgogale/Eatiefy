import { Navigate, useLocation } from "react-router-dom"
import { getCurrentUser } from "@food/utils/auth"
import {
  canAccessPath,
  getFirstAllowedPath,
  isFullAdmin,
  isSubAdmin,
} from "@food/utils/subAdminPermissions"

/**
 * Gates admin routes for SUB_ADMIN based on saved permissions.
 * Full ADMIN always passes. Unmatched paths for sub-admins redirect to first allowed page.
 */
export default function PermissionRoute({ children, requireFullAdmin = false }) {
  const location = useLocation()
  const user = getCurrentUser("admin")

  if (!user) {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />
  }

  if (requireFullAdmin && !isFullAdmin(user)) {
    return <Navigate to={getFirstAllowedPath(user)} replace />
  }

  if (isSubAdmin(user) && !canAccessPath(user, location.pathname)) {
    const fallback = getFirstAllowedPath(user)
    if (fallback === location.pathname) {
      return children
    }
    return <Navigate to={fallback} replace />
  }

  return children
}
