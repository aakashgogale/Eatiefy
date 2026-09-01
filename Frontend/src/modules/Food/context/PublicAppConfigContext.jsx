import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import {
  getPublicAppConfigSnapshot,
  invalidatePublicAppConfig,
  loadCorePublicAppConfig,
  loadLandingSettingsForZone,
  loadUserHomePublicConfig,
} from "@food/services/publicAppConfig";
import {
  applyModulePowerScanning,
  setCachedSettings,
} from "@food/utils/businessSettings";
import { EATIEFY_REFRESH_EVENT } from "@/shared/hooks/usePullToRefresh";

const PublicAppConfigContext = createContext(null);

const resolveModuleFromPath = (pathname = "") => {
  if (pathname.startsWith("/food/restaurant")) return "restaurant";
  if (pathname.startsWith("/food/delivery")) return "delivery";
  return "user";
};

export function PublicAppConfigProvider({ children }) {
  const location = useLocation();
  const [config, setConfig] = useState(() => getPublicAppConfigSnapshot());
  const [loading, setLoading] = useState(true);

  const refreshCore = useCallback(async (force = false) => {
    if (force) invalidatePublicAppConfig();
    const snapshot = await loadCorePublicAppConfig({ force });
    if (snapshot.businessSettings) {
      setCachedSettings(snapshot.businessSettings);
    }
    setConfig(snapshot);
    return snapshot;
  }, []);

  const refreshUserHome = useCallback(async (force = false) => {
    if (force) invalidatePublicAppConfig();
    const snapshot = await loadUserHomePublicConfig({ force });
    setConfig(snapshot);
    return snapshot;
  }, []);

  const refreshLanding = useCallback(async (zoneId, force = false) => {
    const landing = await loadLandingSettingsForZone(zoneId, { force });
    setConfig(getPublicAppConfigSnapshot());
    return landing;
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const snapshot = await loadCorePublicAppConfig();
        if (cancelled) return;
        if (snapshot.businessSettings) {
          setCachedSettings(snapshot.businessSettings);
          applyModulePowerScanning(
            resolveModuleFromPath(window.location?.pathname || ""),
            snapshot.businessSettings,
          );
        }
        setConfig(snapshot);
      } catch {
        // Public config failures must not crash the app shell.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const handleSettingsUpdate = () => {
      void refreshCore(true)
        .then((snapshot) => {
          if (snapshot?.businessSettings) {
            applyModulePowerScanning(
              resolveModuleFromPath(window.location?.pathname || ""),
              snapshot.businessSettings,
            );
          }
        })
        .catch(() => {});
    };

    window.addEventListener("businessSettingsUpdated", handleSettingsUpdate);
    window.addEventListener("adminFeatureSettingUpdated", handleSettingsUpdate);
    window.addEventListener("storage", handleSettingsUpdate);
    // Banners, explore icons and feature flags sit in a module-level store that
    // outlives a page remount, so a refresh has to force those through as well.
    window.addEventListener(EATIEFY_REFRESH_EVENT, handleSettingsUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener("businessSettingsUpdated", handleSettingsUpdate);
      window.removeEventListener("adminFeatureSettingUpdated", handleSettingsUpdate);
      window.removeEventListener("storage", handleSettingsUpdate);
      window.removeEventListener(EATIEFY_REFRESH_EVENT, handleSettingsUpdate);
    };
  }, [refreshCore]);

  useEffect(() => {
    const moduleName = resolveModuleFromPath(location.pathname);
    const cached = config.businessSettings;
    if (cached) {
      applyModulePowerScanning(moduleName, cached);
    }
  }, [location.pathname, config.businessSettings]);

  const value = useMemo(
    () => ({
      ...config,
      loading,
      refreshCore,
      refreshUserHome,
      refreshLanding,
    }),
    [config, loading, refreshCore, refreshUserHome, refreshLanding],
  );

  return (
    <PublicAppConfigContext.Provider value={value}>
      {children}
    </PublicAppConfigContext.Provider>
  );
}

export function usePublicAppConfig() {
  const context = useContext(PublicAppConfigContext);
  if (!context) {
    throw new Error("usePublicAppConfig must be used within PublicAppConfigProvider");
  }
  return context;
}

export function usePublicAppConfigOptional() {
  return useContext(PublicAppConfigContext);
}
