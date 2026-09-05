/** Main bottom-nav / desktop-nav tab routes — exact paths only (no sub-routes). */
import { DINING_ENABLED } from "@food/config/featureFlags";

export const MAIN_TAB_IDS = DINING_ENABLED
  ? ["delivery", "takeaway", "dining", "under250", "profile"]
  : ["delivery", "takeaway", "under250", "profile"];

export function normalizeFoodUserPath(pathname) {
  let path = pathname || "/";
  if (path.startsWith("/food")) {
    path = path.substring(5) || "/";
  }
  if (path.length > 1) {
    path = path.replace(/\/+$/, "");
  }
  return path || "/";
}

export function getMainTabFromPath(pathname) {
  const normalized = normalizeFoodUserPath(pathname);

  if (normalized === "/takeaway" || normalized === "/user/takeaway") {
    return "takeaway";
  }
  if (DINING_ENABLED && (normalized === "/dining" || normalized === "/user/dining")) {
    return "dining";
  }
  if (normalized === "/under-250" || normalized === "/user/under-250") {
    return "under250";
  }
  if (normalized === "/profile" || normalized === "/user/profile") {
    return "profile";
  }
  if (
    normalized === "/" ||
    normalized === "/user" ||
    normalized === "/home" ||
    normalized === "/user/home"
  ) {
    return "delivery";
  }

  return null;
}

export function isExactMainTabPath(pathname) {
  return getMainTabFromPath(pathname) !== null;
}

/**
 * Routes that should keep main tabs mounted underneath (display:none)
 * so back navigation is instant — no remount, no refetch, no white flash.
 */
export function shouldPreserveMainTabsUnderPath(pathname) {
  const n = normalizeFoodUserPath(pathname);
  if (isRestaurantDetailPath(pathname)) {
    return true;
  }
  if (getCategorySlugFromPath(pathname)) {
    return true;
  }
  if (/^\/user\/product\/[^/]+$/.test(n) || /^\/product\/[^/]+$/.test(n)) {
    return true;
  }
  if (n === "/user/categories" || n === "/categories") {
    return true;
  }
  if (n === "/user/notifications" || n === "/notifications") {
    return true;
  }
  if (n === "/user/wallet" || n === "/wallet") {
    return true;
  }
  return false;
}

export function getCategorySlugFromPath(pathname) {
  const n = normalizeFoodUserPath(pathname);
  const match =
    n.match(/^\/user\/category\/([^/]+)$/) || n.match(/^\/category\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function isRestaurantDetailPath(pathname) {
  const n = normalizeFoodUserPath(pathname);
  return /^\/user\/restaurants\/[^/]+$/.test(n) || /^\/restaurants\/[^/]+$/.test(n);
}

/**
 * Keep navigations under /food/user when the app is already there.
 * Absolute /user/... links remount the whole Food app ( /food/* → /* ) and kill keep-alive.
 */
/**
 * Human-readable restaurant URL segment with hyphens (e.g. "navis-cafe").
 * API lookups must still prefer Mongo ObjectId — slug is for pretty URLs only.
 */
const MONGO_OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

export function isMongoObjectId(value) {
  return MONGO_OBJECT_ID_RE.test(String(value || "").trim());
}

/** "Navi's Cafe" / "Nepali Dhaba" → "navis-cafe" / "nepali-dhaba" */
export function toRestaurantUrlSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "") // navi's → navis
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Compact form for matching: "navis-cafe" → "naviscafe" */
export function toRestaurantUrlCompact(value) {
  return toRestaurantUrlSlug(value).replace(/-/g, "");
}

export function getRestaurantRouteId(restaurant) {
  if (!restaurant || typeof restaurant !== "object") return "";

  const slugField = String(restaurant.slug || "").trim();
  if (slugField && !isMongoObjectId(slugField)) {
    const fromSlug = toRestaurantUrlSlug(slugField);
    if (fromSlug) return fromSlug;
  }

  const name = String(restaurant.restaurantName || restaurant.name || "").trim();
  if (name) {
    const fromName = toRestaurantUrlSlug(name);
    if (fromName) return fromName;
  }

  // Last resort: ObjectId (incomplete list rows / deep links)
  const candidates = [
    restaurant.mongoId,
    restaurant._id,
    restaurant.restaurantId,
    restaurant.sourceRestaurantId,
    restaurant.id,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (isMongoObjectId(value)) return value;
  }

  return "";
}

export function toFoodUserPath(path = "/user") {
  let p = String(path || "/user").trim();
  if (!p) p = "/user";
  const qIndex = p.indexOf("?");
  const query = qIndex >= 0 ? p.slice(qIndex) : "";
  p = qIndex >= 0 ? p.slice(0, qIndex) : p;
  if (!p.startsWith("/")) p = `/${p}`;

  let result = p;
  if (p.startsWith("/food/")) {
    result = p;
  } else if (p.startsWith("/user/") || p === "/user") {
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/food")) {
      result = `/food${p}`;
    } else {
      result = p;
    }
  } else if (typeof window !== "undefined" && window.location.pathname.startsWith("/food")) {
    result = `/food/user${p}`;
  } else {
    result = `/user${p}`;
  }
  return `${result}${query}`;
}

export const CATEGORY_KEEPALIVE_SLUG_KEY = "food_category_keepalive_slug";

export function rememberCategoryKeepAliveSlug(slug) {
  if (!slug) return;
  try {
    sessionStorage.setItem(CATEGORY_KEEPALIVE_SLUG_KEY, String(slug));
  } catch {
    // ignore
  }
}

export function peekCategoryKeepAliveSlug() {
  try {
    return sessionStorage.getItem(CATEGORY_KEEPALIVE_SLUG_KEY);
  } catch {
    return null;
  }
}

export function clearCategoryKeepAliveSlug() {
  try {
    sessionStorage.removeItem(CATEGORY_KEEPALIVE_SLUG_KEY);
  } catch {
    // ignore
  }
}

export const LAST_MAIN_TAB_BEFORE_PROFILE_KEY = "foodLastMainTabBeforeProfile";

export function rememberMainTabBeforeProfile(tabId) {
  if (!tabId || tabId === "profile") return;
  try {
    sessionStorage.setItem(LAST_MAIN_TAB_BEFORE_PROFILE_KEY, tabId);
  } catch {
    // ignore
  }
}

export function getRememberedMainTabBeforeProfile() {
  try {
    const tabId = sessionStorage.getItem(LAST_MAIN_TAB_BEFORE_PROFILE_KEY);
    if (tabId && tabId !== "profile" && MAIN_TAB_IDS.includes(tabId)) {
      return tabId;
    }
  } catch {
    // ignore
  }
  return null;
}

export function resolveProfileBackPath(fromPath) {
  const fromTab = fromPath ? getMainTabFromPath(fromPath) : null;
  if (fromTab && fromTab !== "profile") {
    return mainTabToPath(fromTab);
  }
  const remembered = getRememberedMainTabBeforeProfile();
  if (remembered) {
    return mainTabToPath(remembered);
  }
  return mainTabToPath("delivery");
}

export function mainTabToPath(tabId) {
  switch (tabId) {
    case "takeaway":
      return "/food/user/takeaway";
    case "dining":
      return DINING_ENABLED ? "/food/user/dining" : "/food/user";
    case "under250":
      return "/food/user/under-250";
    case "profile":
      return "/food/user/profile";
    case "delivery":
    default:
      return "/food/user";
  }
}
