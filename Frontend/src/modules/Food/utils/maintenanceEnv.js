/**
 * Maintenance lock is for LIVE users only.
 * Local `npm run dev` / localhost UI never shows the page — even when the
 * shared live backend has maintenance_mode_enabled=true in DB.
 *
 * Backend also bypasses API lock for localhost Origin / X-Ometto-Client: local-dev
 * so local frontend + same live API keep working.
 *
 * Optional local preview: VITE_FORCE_MAINTENANCE=true or ?forceMaintenance=1
 */
export function shouldEnforceMaintenanceOnClient() {
  try {
    if (typeof window === "undefined") return false;

    const params = new URLSearchParams(window.location.search || "");
    if (params.get("forceMaintenance") === "1") return true;
    if (String(import.meta.env.VITE_FORCE_MAINTENANCE || "").toLowerCase() === "true") {
      return true;
    }

    // Vite dev server — never lock local work
    if (import.meta.env.DEV) return false;

    const host = String(window.location.hostname || "").toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local")
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
