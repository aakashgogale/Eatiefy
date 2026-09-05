/**
 * Session-scoped page cache for Food user main tabs.
 * In-memory first (instant tab switches); sessionStorage mirrors for resilience.
 * Cleared on tab/window close via pagehide.
 */

const MEMORY = new Map();
const CACHE_PREFIX = "food_page_cache_";
const LEGACY_PREFIXES = ["food_home_restaurants", "food_home_categories"];

export const FOOD_PAGE_INVALIDATE_EVENT = "food-pages-invalidate";

export function buildFoodCacheKey(page, parts = {}) {
  const suffix = Object.entries(parts)
    .filter(([, v]) => v != null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join("|");
  return suffix ? `${page}|${suffix}` : page;
}

export function getFoodPageCache(key) {
  if (MEMORY.has(key)) {
    return MEMORY.get(key);
  }
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    MEMORY.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function setFoodPageCache(key, data) {
  MEMORY.set(key, data);
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(data));
  } catch {
    /* quota exceeded — in-memory still works */
  }
}

/** Shared landing settings (under-250 price limit) — avoids extra files + duplicate fetches. */
let landingSettingsMemory = null;
let landingSettingsInflight = null;
const LANDING_SETTINGS_AT_KEY = `${CACHE_PREFIX}landing_settings_public_at`;
const LANDING_SETTINGS_TTL_MS = 30 * 60 * 1000;

const EXPLORE_ICONS_KEY = "explore_icons_public";
const EXPLORE_ICONS_AT_KEY = `${CACHE_PREFIX}explore_icons_public_at`;
const EXPLORE_ICONS_TTL_MS = 30 * 60 * 1000;

/** Sync read for instant Explore More paint on return visits. */
export function getCachedExploreIcons() {
  return getFoodPageCache(EXPLORE_ICONS_KEY);
}

export function setCachedExploreIcons(payload) {
  setFoodPageCache(EXPLORE_ICONS_KEY, payload);
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(EXPLORE_ICONS_AT_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function isExploreIconsCacheFresh() {
  if (typeof sessionStorage === "undefined") return false;
  try {
    const at = Number(sessionStorage.getItem(EXPLORE_ICONS_AT_KEY) || 0);
    return at > 0 && Date.now() - at < EXPLORE_ICONS_TTL_MS;
  } catch {
    return false;
  }
}

/** Preload image URLs into browser cache (icons, category thumbs, etc.). */
export function preloadImageUrls(urls = []) {
  if (typeof window === "undefined" || !urls?.length) return;
  urls.forEach((src) => {
    if (!src || typeof src !== "string") return;
    const img = new window.Image();
    img.decoding = "async";
    img.src = src;
  });
}

export function getCachedUnder250PriceLimit(fallback = 250) {
  const settings = landingSettingsMemory || getFoodPageCache("landing_settings_public");
  const value = Number(settings?.under250PriceLimit);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function getLandingSettingsPublic(fetcher) {
  const cached = landingSettingsMemory || getFoodPageCache("landing_settings_public");
  let isFresh = false;
  try {
    const at = Number(sessionStorage.getItem(LANDING_SETTINGS_AT_KEY) || 0);
    isFresh = at > 0 && Date.now() - at < LANDING_SETTINGS_TTL_MS;
  } catch {
    isFresh = false;
  }

  if (cached && isFresh) {
    landingSettingsMemory = cached;
    return cached;
  }
  if (cached) landingSettingsMemory = cached;
  if (landingSettingsInflight) return landingSettingsInflight;

  landingSettingsInflight = (async () => {
    try {
      const res = await fetcher();
      const settings = res?.data?.data || res?.data || {};
      landingSettingsMemory = settings;
      setFoodPageCache("landing_settings_public", settings);
      try {
        sessionStorage.setItem(LANDING_SETTINGS_AT_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
      return settings;
    } catch (error) {
      if (landingSettingsMemory) return landingSettingsMemory;
      throw error;
    } finally {
      landingSettingsInflight = null;
    }
  })();

  return landingSettingsMemory || landingSettingsInflight;
}

export function removeFoodPageCache(key) {
  MEMORY.delete(key);
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(`${CACHE_PREFIX}${key}`);
  } catch {
    /* ignore */
  }
}

export function clearFoodSessionCaches() {
  MEMORY.clear();
  if (typeof sessionStorage === "undefined") return;
  try {
    Object.keys(sessionStorage).forEach((key) => {
      if (
        key.startsWith(CACHE_PREFIX) ||
        key.startsWith("fcm_backend_synced_") ||
        LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))
      ) {
        sessionStorage.removeItem(key);
      }
    });
  } catch {
    /* ignore */
  }
}

export function invalidateFoodPages(detail = {}) {
  if (typeof window === "undefined") return;
  if (detail.clearCache !== false) {
    clearFoodSessionCaches();
  }
  window.dispatchEvent(
    new CustomEvent(FOOD_PAGE_INVALIDATE_EVENT, { detail }),
  );
}

let listenersRegistered = false;

export function registerFoodPageCacheLifecycle() {
  if (listenersRegistered || typeof window === "undefined") return;
  listenersRegistered = true;
  window.addEventListener("pagehide", clearFoodSessionCaches);
}
