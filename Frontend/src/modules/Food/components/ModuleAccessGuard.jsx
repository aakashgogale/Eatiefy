import { Navigate } from "react-router-dom";
import useModuleAccess from "@food/hooks/useModuleAccess";

/**
 * Route guard for the Takeaway / Dining admin toggles.
 * Renders the route only while its module is enabled; otherwise redirects, so a
 * direct URL cannot reach a disabled module.
 *
 * @param {"takeaway"|"dining"} module
 * @param {string} redirectTo
 */
export default function ModuleAccessGuard({ module, redirectTo, children }) {
  const { takeawayEnabled, diningEnabled } = useModuleAccess();
  const enabled = module === "dining" ? diningEnabled : takeawayEnabled;

  if (!enabled) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
}
