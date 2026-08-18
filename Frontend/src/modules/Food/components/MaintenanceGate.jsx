import { useLocation } from "react-router-dom";
import useMaintenanceMode from "@food/hooks/useMaintenanceMode";
import MaintenancePage from "@food/pages/shared/MaintenancePage";

function isAdminPath(pathname = "") {
  const p = String(pathname || "");
  return (
    p === "/admin" ||
    p.startsWith("/admin/") ||
    p === "/food/admin" ||
    p.startsWith("/food/admin/")
  );
}

/**
 * Shows Under Maintenance for user / restaurant / delivery (web + Flutter WebView).
 * Admin module (all /admin routes) is never blocked.
 */
export default function MaintenanceGate({ children }) {
  const location = useLocation();
  const adminRoute = isAdminPath(location.pathname);
  // Never poll / apply maintenance while on admin — keep admin fully usable.
  const { enabled } = useMaintenanceMode({ active: !adminRoute });

  if (adminRoute) {
    return children;
  }

  if (enabled === true) {
    return <MaintenancePage />;
  }

  return children;
}
