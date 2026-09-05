/**
 * Centralized public app configuration — banners, business settings, fees, features.
 * Loaded once per session (15 min TTL) and shared across all routes/components.
 *
 * All of it arrives in a single `/food/public/app-config` request. It used to be nine
 * separate GETs fired before the home screen could paint; each one also cost a CORS
 * preflight, so the shell opened with eighteen round trips before any content request.
 * The per-endpoint URLs below are kept as a fallback for a backend that predates the
 * aggregate route.
 */

import {
  publicConfigGetOnce,
  invalidatePublicConfigCache,
} from "@food/api";
import { API_ENDPOINTS } from "@food/api/config";

export const PUBLIC_APP_CONFIG_URL = "/food/public/app-config";

export const PUBLIC_CONFIG_URLS = {
  BUSINESS: API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS_PUBLIC,
  POWER_SCANNING: "/food/admin/power-scanning/public",
  FEATURE: "/food/admin/feature-settings/public",
  FEE: "/food/admin/fee-settings/public",
  TOP_BANNERS: "/food/top-banners/public",
  HERO_BANNERS: "/food/hero-banners/public",
  PROMO_BANNERS: "/food/hero-banners/home-promotion/public",
  EXPLORE_ICONS: "/food/explore-icons/public",
  LANDING: "/food/landing/settings/public",
};

const CONFIG_TTL_MS = 15 * 60 * 1000;

const emptyStore = () => ({
  businessSettings: null,
  powerScanning: null,
  featureSettings: null,
  feeSettings: null,
  topBanners: null,
  heroBanners: null,
  promoBanners: null,
  exploreIcons: null,
  customization: null,
  landingByZone: new Map(),
  loadedAt: 0,
});

let store = emptyStore();
let aggregateLoadPromise = null;
let aggregateFailed = false;

const isFresh = () =>
  store.loadedAt > 0 && Date.now() - store.loadedAt < CONFIG_TTL_MS;

/** The shell sends the stored zone so landing settings can ride along in the same call. */
const readStoredZoneId = () => {
  try {
    return localStorage.getItem("userZoneId") || "";
  } catch {
    return "";
  }
};

const parseBusinessSettings = (response) =>
  response?.data?.data || response?.data || null;

const parsePowerScanning = (response) =>
  response?.data?.data || response?.data || null;

const parseFeatureSettings = (response) => {
  const rows = response?.data?.data;
  return Array.isArray(rows) ? rows : [];
};

const parseFeeSettings = (response) =>
  response?.data?.data?.feeSettings || null;

const parseTopBanners = (response) => {
  const banners = response?.data?.data?.banners;
  return Array.isArray(banners) ? banners : [];
};

const parseHeroBanners = (response) => {
  const data = response?.data?.data;
  const list = Array.isArray(response?.data?.banners)
    ? response.data.banners
    : Array.isArray(data?.banners)
      ? data.banners
      : Array.isArray(data)
        ? data
        : Array.isArray(response?.data)
          ? response.data
          : [];
  return list;
};

const parseExploreIcons = (response) => {
  const exploreData = response?.data?.data;
  const items = Array.isArray(exploreData?.items)
    ? exploreData.items
    : Array.isArray(exploreData)
      ? exploreData
      : [];
  return items.map((it) => ({
    ...it,
    imageUrl: it.imageUrl || it.iconUrl,
    label: it.label || it.name,
  }));
};

const parseLandingSettings = (response) => {
  const settings = response?.data?.data || {};
  return {
    exploreMoreHeading: settings.exploreMoreHeading || "Explore More",
    recommendedRestaurantIds: settings.recommendedRestaurantIds || [],
    recommendedRestaurants: settings.recommendedRestaurants || [],
  };
};

export const getPublicAppConfigSnapshot = () => ({
  ...store,
  landingByZone: new Map(store.landingByZone),
});

export const invalidatePublicAppConfig = () => {
  invalidatePublicConfigCache();
  store = emptyStore();
  aggregateLoadPromise = null;
  aggregateFailed = false;
};

const applyAggregate = (payload = {}) => {
  const businessSettings = payload.businessSettings || null;
  const powerScanning = payload.powerScanning || null;

  if (businessSettings) {
    store.businessSettings = powerScanning
      ? { ...businessSettings, powerScanning }
      : businessSettings;
  } else if (powerScanning) {
    store.businessSettings = { ...(store.businessSettings || {}), powerScanning };
  }

  store.powerScanning = powerScanning;
  store.featureSettings = Array.isArray(payload.featureSettings) ? payload.featureSettings : [];
  store.feeSettings = payload.feeSettings || null;
  store.topBanners = Array.isArray(payload.topBanners) ? payload.topBanners : [];
  store.heroBanners = Array.isArray(payload.heroBanners) ? payload.heroBanners : [];
  store.promoBanners = Array.isArray(payload.promoBanners) ? payload.promoBanners : [];
  store.exploreIcons = Array.isArray(payload.exploreIcons)
    ? payload.exploreIcons.map((it) => ({
        ...it,
        imageUrl: it.imageUrl || it.iconUrl,
        label: it.label || it.name,
      }))
    : [];
  store.customization = payload.customization || null;

  if (payload.landing) {
    const zoneKey = String(payload.zoneId || "global");
    store.landingByZone.set(zoneKey, {
      exploreMoreHeading: payload.landing.exploreMoreHeading || "Explore More",
      recommendedRestaurantIds: payload.landing.recommendedRestaurantIds || [],
      recommendedRestaurants: payload.landing.recommendedRestaurants || [],
    });
  }

  store.loadedAt = Date.now();
};

/** Pre-aggregate backends still answer the individual routes; keep working against them. */
const loadFromLegacyEndpoints = async (force) => {
  const options = force ? { noCache: true } : {};
  const [businessRes, powerRes, featureRes, feeRes, topRes, heroRes, promoRes, exploreRes] =
    await Promise.all([
      publicConfigGetOnce(PUBLIC_CONFIG_URLS.BUSINESS, options).catch(() => null),
      publicConfigGetOnce(PUBLIC_CONFIG_URLS.POWER_SCANNING, options).catch(() => null),
      publicConfigGetOnce(PUBLIC_CONFIG_URLS.FEATURE, options).catch(() => null),
      publicConfigGetOnce(PUBLIC_CONFIG_URLS.FEE, options).catch(() => null),
      publicConfigGetOnce(PUBLIC_CONFIG_URLS.TOP_BANNERS, options).catch(() => null),
      publicConfigGetOnce(PUBLIC_CONFIG_URLS.HERO_BANNERS, options).catch(() => null),
      publicConfigGetOnce(PUBLIC_CONFIG_URLS.PROMO_BANNERS, options).catch(() => null),
      publicConfigGetOnce(PUBLIC_CONFIG_URLS.EXPLORE_ICONS, options).catch(() => null),
    ]);

  applyAggregate({
    businessSettings: parseBusinessSettings(businessRes),
    powerScanning: parsePowerScanning(powerRes),
    featureSettings: parseFeatureSettings(featureRes),
    feeSettings: parseFeeSettings(feeRes),
    topBanners: parseTopBanners(topRes),
    heroBanners: parseHeroBanners(heroRes),
    promoBanners: parseHeroBanners(promoRes),
    exploreIcons: parseExploreIcons(exploreRes),
  });
};

/**
 * Everything the shell needs, in one request. Both entry points below funnel through
 * here, so a page that wants core settings and a page that wants banners still share
 * a single in-flight fetch instead of opening two waves of requests.
 */
const loadPublicAppConfig = async ({ force = false } = {}) => {
  if (!force && isFresh() && store.businessSettings) {
    return getPublicAppConfigSnapshot();
  }

  if (aggregateLoadPromise && !force) {
    return aggregateLoadPromise;
  }

  aggregateLoadPromise = (async () => {
    if (!aggregateFailed) {
      try {
        const zoneId = readStoredZoneId();
        const response = await publicConfigGetOnce(PUBLIC_APP_CONFIG_URL, {
          ...(zoneId ? { params: { zoneId } } : {}),
          ...(force ? { noCache: true } : {}),
        });
        const payload = response?.data?.data || response?.data || null;
        if (payload) {
          applyAggregate(payload);
          return getPublicAppConfigSnapshot();
        }
      } catch {
        // Older backend, or the route is down — fall back and stop retrying it.
        aggregateFailed = true;
      }
    }

    // Isolate failures so one downed public endpoint cannot crash the cart/home shell.
    await loadFromLegacyEndpoints(force);
    return getPublicAppConfigSnapshot();
  })();

  try {
    return await aggregateLoadPromise;
  } finally {
    aggregateLoadPromise = null;
  }
};

/**
 * Core config used app-wide: business, theme, fees, feature flags.
 */
export const loadCorePublicAppConfig = (options) => loadPublicAppConfig(options);

/**
 * User-home content: banners + explore icons (not zone-specific).
 */
export const loadUserHomePublicConfig = (options) => loadPublicAppConfig(options);

export const loadLandingSettingsForZone = async (zoneId, { force = false } = {}) => {
  const zoneKey = String(zoneId || "global");

  if (!force && store.landingByZone.has(zoneKey)) {
    return store.landingByZone.get(zoneKey);
  }

  // The shell request already carries landing settings for the stored zone; wait on it
  // rather than opening a second request for data that is already on its way.
  if (!force && aggregateLoadPromise && zoneKey === String(readStoredZoneId() || "global")) {
    await aggregateLoadPromise;
    if (store.landingByZone.has(zoneKey)) {
      return store.landingByZone.get(zoneKey);
    }
  }

  const params = zoneId ? { zoneId: String(zoneId) } : {};
  const response = await publicConfigGetOnce(PUBLIC_CONFIG_URLS.LANDING, {
    params,
    ...(force ? { noCache: true } : {}),
  });

  const landing = parseLandingSettings(response);
  store.landingByZone.set(zoneKey, landing);
  return landing;
};

export const getCachedBusinessSettings = () => store.businessSettings;

export const getCachedFeatureSettings = () => store.featureSettings;

export const getCachedFeeSettings = () => store.feeSettings;

export const getCachedTopBanners = () => store.topBanners;

export const getCachedHeroBanners = () => store.heroBanners;

export const getCachedPromoBanners = () => store.promoBanners;

export const getCachedExploreIcons = () => store.exploreIcons;

export const getCachedCustomizationSettings = () => store.customization;

export const getCachedLandingSettings = (zoneId) => {
  const zoneKey = String(zoneId || "global");
  return store.landingByZone.get(zoneKey) || null;
};

export const getFeatureSettingByKey = (key, fallback = null) => {
  const rows = store.featureSettings || [];
  const feature = rows.find((row) => row.key === key);
  if (!feature) return fallback;
  return feature;
};

export const isFeatureEnabled = (key, fallback = true) => {
  try {
    const local = typeof window !== "undefined" ? localStorage.getItem(`food_feature_${key}`) : null;
    if (local != null) return local === "true";
  } catch {}
  const feature = getFeatureSettingByKey(key, null);
  if (!feature) return fallback;
  const value = feature.isEnabled;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return fallback;
};
