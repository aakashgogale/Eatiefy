/** Per-category restaurant list cache (zone-scoped). In-memory only — dies with tab/app. */
export const CATEGORY_SESSION_CACHE = new Map();

/** Admin/public category chip list cache (zone-scoped). In-memory only. */
export const CATEGORY_LIST_CACHE = new Map();

export const clearCategoryCache = () => {
  CATEGORY_SESSION_CACHE.clear();
  CATEGORY_LIST_CACHE.clear();
};

/** Clear category + browse scroll session keys (logout / account switch). */
export const clearCategoryBrowseStorage = () => {
  clearCategoryCache();
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem("food_browse_scroll_v1");
    sessionStorage.removeItem("food_category_browse_backup_v1");
    sessionStorage.removeItem("food_category_keepalive_slug");
    sessionStorage.removeItem("main_tab_scroll_delivery");
    sessionStorage.removeItem("main_tab_scroll_takeaway");
  } catch {
    // ignore
  }
};

export const getCategoryListCacheKey = (zoneId) =>
  `ometto_cat_list_zone_${zoneId || "all"}`;

export const peekCategoryListCache = (zoneId) => {
  const key = getCategoryListCacheKey(zoneId);
  if (!CATEGORY_LIST_CACHE.has(key)) return null;
  return CATEGORY_LIST_CACHE.get(key);
};

export const setCategoryListCache = (zoneId, payload) => {
  CATEGORY_LIST_CACHE.set(getCategoryListCacheKey(zoneId), payload);
};

const normalizeCatKeyPart = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

/** Build slug + id keys so revisit never misses cache after URL sync. */
export const getCategoryRestaurantCacheKeys = (
  selectedCategory,
  zoneId,
  categories = [],
) => {
  const zone = zoneId || "";
  const raw = normalizeCatKeyPart(selectedCategory);
  const keys = new Set();
  if (raw) keys.add(`ometto_cat_${raw}_zone_${zone}`);

  const matched = (Array.isArray(categories) ? categories : []).find(
    (cat) =>
      normalizeCatKeyPart(cat?.slug) === raw ||
      normalizeCatKeyPart(cat?.id) === raw ||
      normalizeCatKeyPart(cat?.name).replace(/\s+/g, "-") === raw,
  );
  if (matched) {
    const slug = normalizeCatKeyPart(matched.slug);
    const id = normalizeCatKeyPart(matched.id);
    if (slug) keys.add(`ometto_cat_${slug}_zone_${zone}`);
    if (id && id !== "all") keys.add(`ometto_cat_${id}_zone_${zone}`);
  }

  return [...keys];
};

export const peekCategoryRestaurantsCache = (
  selectedCategory,
  zoneId,
  categories = [],
) => {
  for (const key of getCategoryRestaurantCacheKeys(
    selectedCategory,
    zoneId,
    categories,
  )) {
    if (CATEGORY_SESSION_CACHE.has(key)) {
      return CATEGORY_SESSION_CACHE.get(key);
    }
  }
  return null;
};

export const setCategoryRestaurantsCache = (
  selectedCategory,
  zoneId,
  restaurants,
  categories = [],
) => {
  const payload = { restaurants: Array.isArray(restaurants) ? restaurants : [] };
  for (const key of getCategoryRestaurantCacheKeys(
    selectedCategory,
    zoneId,
    categories,
  )) {
    CATEGORY_SESSION_CACHE.set(key, payload);
  }
};
