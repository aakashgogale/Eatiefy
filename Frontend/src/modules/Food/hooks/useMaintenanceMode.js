import { useCallback, useEffect, useRef, useState } from "react";
import apiClient from "@food/api/axios";
import { shouldEnforceMaintenanceOnClient } from "@food/utils/maintenanceEnv";

const POLL_WHEN_ON_MS = 2500;
const POLL_WHEN_OFF_MS = 8000;

/**
 * Strict maintenance flag: only true when API returns maintenance_mode_enabled === true
 * AND this client is allowed to enforce it (live only; local stays open).
 */
export function useMaintenanceMode({ active = true } = {}) {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const enabledRef = useRef(false);
  const enforce = shouldEnforceMaintenanceOnClient();

  const applyFlag = useCallback(
    (value) => {
      const next = enforce && value === true;
      enabledRef.current = next;
      setEnabled(next);

      try {
        const raw = localStorage.getItem("ometto_customization_settings");
        const parsed = raw ? JSON.parse(raw) : {};
        // Keep the real DB flag in cache; UI lock only follows `next`.
        localStorage.setItem(
          "ometto_customization_settings",
          JSON.stringify({
            ...parsed,
            maintenance_mode_enabled: value === true,
          })
        );
      } catch {
        /* ignore */
      }
    },
    [enforce]
  );

  const fetchFlag = useCallback(async () => {
    if (!enforce) {
      applyFlag(false);
      setReady(true);
      return;
    }

    try {
      const response = await apiClient.get("/food/public/customization-settings");
      const settings = response?.data?.data || response?.data || {};
      applyFlag(settings?.maintenance_mode_enabled === true);
    } catch {
      applyFlag(false);
    } finally {
      setReady(true);
    }
  }, [applyFlag, enforce]);

  useEffect(() => {
    if (!active || !enforce) {
      setEnabled(false);
      setReady(true);
      return undefined;
    }

    let cancelled = false;
    let timer = null;

    const tick = async () => {
      if (cancelled) return;
      await fetchFlag();
      if (cancelled) return;
      const delay = enabledRef.current ? POLL_WHEN_ON_MS : POLL_WHEN_OFF_MS;
      timer = setTimeout(tick, delay);
    };

    tick();

    const onFocus = () => {
      fetchFlag();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchFlag();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    const onMaintenanceEvent = (event) => {
      if (event?.detail && typeof event.detail.enabled === "boolean") {
        applyFlag(event.detail.enabled === true);
      } else {
        fetchFlag();
      }
    };
    window.addEventListener("maintenanceModeChanged", onMaintenanceEvent);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("maintenanceModeChanged", onMaintenanceEvent);
    };
  }, [active, fetchFlag, applyFlag, enforce]);

  return { enabled, ready };
}

export default useMaintenanceMode;
