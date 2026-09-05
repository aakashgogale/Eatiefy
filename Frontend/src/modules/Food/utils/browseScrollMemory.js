const STORAGE_KEY = "food_browse_scroll_v1";
const CATEGORY_BACKUP_KEY = "food_category_browse_backup_v1";

/** In-memory last category→restaurant click — only overwritten on click, never cleared on restore. */
let categoryLastClickMemory = null;

/** Set true on every category restaurant click; cleared after scroll lock finishes. */
let categoryNeedsRestore = false;

/** Last known window scroll while category browse was visible. */
let lastCategoryWindowScrollY = 0;

let activeCategoryScrollLockCancel = null;

/** Normalize paths so /food/user and /user match. */
export const normalizeBrowsePath = (path = "") => {
  let p = String(path).split("?")[0].trim();
  if (!p) return "/user";
  if (p.startsWith("/food")) p = p.slice(5) || "/";
  if (!p.startsWith("/")) p = `/${p}`;
  if (p === "/" || p === "/user" || p === "/user/home" || p === "/home") {
    return "/user";
  }
  if (p.endsWith("/") && p.length > 1) p = p.slice(0, -1);
  return p;
};

const toScrollY = (scrollY) => {
  const n = Number(scrollY);
  if (Number.isFinite(n) && n >= 0) return n;
  if (typeof window !== "undefined") return Math.max(0, window.scrollY || 0);
  return 0;
};

export const trackCategoryWindowScrollY = (scrollY) => {
  const y = Number(scrollY);
  if (Number.isFinite(y) && y >= 0) {
    lastCategoryWindowScrollY = y;
  }
};

export const saveBrowseScroll = ({ path, scrollY, focusId, visibleCount } = {}) => {
  if (typeof window === "undefined") return;
  try {
    const normalizedPath = normalizeBrowsePath(path || window.location.pathname);
    const isCategory = normalizedPath.includes("/category/");
    const payload = {
      path: normalizedPath,
      scrollY: isCategory
        ? Math.max(toScrollY(scrollY), lastCategoryWindowScrollY)
        : toScrollY(scrollY),
      focusId: focusId != null && focusId !== "" ? String(focusId) : null,
      ts: Date.now(),
    };
    const count = Number(visibleCount);
    if (Number.isFinite(count) && count > 0) {
      payload.visibleCount = Math.floor(count);
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

    if (isCategory) {
      // Track last window Y for restaurant-back restore, but do NOT arm
      // categoryNeedsRestore here — only explicit restaurant clicks should.
      lastCategoryWindowScrollY = payload.scrollY;
      sessionStorage.setItem(CATEGORY_BACKUP_KEY, JSON.stringify(payload));
    }
  } catch {
    // ignore
  }
};

/** Explicit category click save — always updates durable memory + restore flag. */
export const saveCategoryBrowseClick = ({ path, scrollY, focusId, visibleCount } = {}) => {
  const y = Math.max(toScrollY(scrollY), lastCategoryWindowScrollY);
  const payload = {
    path: normalizeBrowsePath(path || "/user/category/all"),
    scrollY: y,
    focusId: focusId != null && focusId !== "" ? String(focusId) : null,
    visibleCount:
      Number.isFinite(Number(visibleCount)) && Number(visibleCount) > 0
        ? Math.floor(Number(visibleCount))
        : undefined,
    ts: Date.now(),
  };
  categoryLastClickMemory = payload;
  categoryNeedsRestore = true;
  lastCategoryWindowScrollY = y;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      sessionStorage.setItem(CATEGORY_BACKUP_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }
  return payload;
};

export const getCategoryLastClick = () => {
  if (categoryLastClickMemory) return categoryLastClickMemory;
  return peekCategoryBrowseBackup();
};

export const categoryBrowseNeedsRestore = () => categoryNeedsRestore;

export const markCategoryBrowseRestored = () => {
  categoryNeedsRestore = false;
};

/**
 * One-shot scroll restore after category becomes visible.
 * Stops as soon as position settles OR the user touches — never fights taps.
 */
export const runCategoryScrollLock = ({ durationMs = 100 } = {}) => {
  if (typeof window === "undefined") return () => {};

  activeCategoryScrollLockCancel?.();

  const seed = getCategoryLastClick();
  if (!seed) return () => {};

  const start = Date.now();
  let cancelled = false;
  let rafId = 0;
  let userInterrupted = false;
  let frames = 0;

  const finish = () => {
    if (cancelled) return;
    cancelled = true;
    markCategoryBrowseRestored();
    if (rafId) cancelAnimationFrame(rafId);
    detachUserListeners();
    if (activeCategoryScrollLockCancel === cancel) {
      activeCategoryScrollLockCancel = null;
    }
  };

  const apply = () => {
    if (cancelled || userInterrupted) return;
    const pending = getCategoryLastClick() || seed;
    const targetY = Math.max(0, Number(pending.scrollY) || lastCategoryWindowScrollY || 0);
    const focusId = pending.focusId ? String(pending.focusId) : null;

    const maxScroll = Math.max(
      0,
      (document.documentElement?.scrollHeight || 0) - window.innerHeight,
    );

    if (focusId && targetY > maxScroll + 40) {
      const safeId = focusId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const el = document.querySelector(`[data-browse-focus="${safeId}"]`);
      if (el) {
        const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - 72);
        window.scrollTo({ top, left: 0, behavior: "instant" });
      } else {
        window.scrollTo({ top: Math.min(targetY, maxScroll), left: 0, behavior: "instant" });
      }
    } else {
      window.scrollTo({ top: targetY, left: 0, behavior: "instant" });
    }
  };

  // Any real user gesture wins immediately — continuous scrollTo steals taps.
  const onUserIntent = () => {
    if (cancelled) return;
    userInterrupted = true;
    finish();
  };

  const detachUserListeners = () => {
    window.removeEventListener("wheel", onUserIntent);
    window.removeEventListener("touchstart", onUserIntent);
    window.removeEventListener("touchmove", onUserIntent);
    window.removeEventListener("pointerdown", onUserIntent);
    window.removeEventListener("click", onUserIntent, true);
  };

  window.addEventListener("wheel", onUserIntent, { passive: true });
  window.addEventListener("touchstart", onUserIntent, { passive: true });
  window.addEventListener("touchmove", onUserIntent, { passive: true });
  window.addEventListener("pointerdown", onUserIntent, { passive: true });
  // Capture-phase click so back/home taps cancel lock before scroll fights them
  window.addEventListener("click", onUserIntent, true);

  const tick = () => {
    if (cancelled || userInterrupted) return;
    frames += 1;
    // Only re-apply a few times while layout expands — not every frame forever.
    if (frames <= 6 || frames % 3 === 0) apply();
    const pending = getCategoryLastClick() || seed;
    const targetY = Math.max(0, Number(pending.scrollY) || lastCategoryWindowScrollY || 0);
    const settled =
      Math.abs((window.scrollY || 0) - targetY) <= 12 && Date.now() - start > 24;
    if (settled || Date.now() - start >= durationMs) {
      finish();
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  apply();
  rafId = requestAnimationFrame(tick);

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    detachUserListeners();
    if (activeCategoryScrollLockCancel === cancel) {
      activeCategoryScrollLockCancel = null;
    }
  };

  activeCategoryScrollLockCancel = cancel;
  return cancel;
};

export const peekBrowseScroll = (path) => {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    if (data.ts && Date.now() - Number(data.ts) > 30 * 60 * 1000) return null;

    const want = normalizeBrowsePath(path);
    const got = normalizeBrowsePath(data.path);
    if (want === got) return data;

    const catRe = /^\/user\/category\//;
    if (catRe.test(want) && catRe.test(got)) return data;

    return null;
  } catch {
    return null;
  }
};

export const peekBrowseScrollAny = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    if (data.ts && Date.now() - Number(data.ts) > 30 * 60 * 1000) return null;
    return data;
  } catch {
    return null;
  }
};

export const peekCategoryBrowseBackup = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CATEGORY_BACKUP_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    if (data.ts && Date.now() - Number(data.ts) > 30 * 60 * 1000) return null;
    return data;
  } catch {
    return null;
  }
};

export const consumeBrowseScroll = (path) => {
  const data = peekBrowseScroll(path) || peekBrowseScrollAny();
  if (!data) return null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return data;
};

export const clearBrowseScroll = () => {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
};

/**
 * Restore exact window scrollY (no scrollIntoView — that recenters the card).
 * Retries briefly while lazy lists expand; any user touch cancels immediately.
 */
export const restoreBrowseScroll = (saved, { retries = 12, onDone } = {}) => {
  if (!saved || typeof window === "undefined") {
    onDone?.(false);
    return () => {};
  }

  const targetY = Math.max(0, Number(saved.scrollY) || 0);
  const focusId = saved.focusId ? String(saved.focusId) : null;
  let attempt = 0;
  let cancelled = false;
  let rafId = 0;

  const detachUserListeners = () => {
    window.removeEventListener("wheel", onUserIntent);
    window.removeEventListener("touchstart", onUserIntent);
    window.removeEventListener("touchmove", onUserIntent);
    window.removeEventListener("pointerdown", onUserIntent);
    window.removeEventListener("click", onUserIntent, true);
  };

  const stop = (ok) => {
    if (cancelled) return;
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    detachUserListeners();
    onDone?.(ok);
  };

  const onUserIntent = () => stop(false);

  const apply = () => {
    if (cancelled) return;

    const maxScroll = Math.max(
      0,
      (document.documentElement?.scrollHeight || 0) - window.innerHeight,
    );

    if (focusId && targetY > maxScroll + 40) {
      const safeId = focusId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const el = document.querySelector(`[data-browse-focus="${safeId}"]`);
      if (el) {
        const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - 72);
        window.scrollTo({ top, left: 0, behavior: "instant" });
        return;
      }
    }

    window.scrollTo({ top: targetY, left: 0, behavior: "instant" });
  };

  const run = () => {
    if (cancelled) return;
    attempt += 1;
    if (attempt <= 4 || attempt % 3 === 0) apply();

    const maxScroll = Math.max(
      0,
      (document.documentElement?.scrollHeight || 0) - window.innerHeight,
    );
    const closeEnough = Math.abs(window.scrollY - targetY) <= 12;
    const canReach = targetY <= maxScroll + 24;
    const focusEl = focusId
      ? document.querySelector(
          `[data-browse-focus="${focusId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`,
        )
      : null;

    if (closeEnough || (canReach && attempt >= 3) || (focusEl && attempt >= 4) || attempt >= retries) {
      if (!cancelled) apply();
      stop(closeEnough || canReach || !!focusEl);
      return;
    }

    rafId = requestAnimationFrame(run);
  };

  window.addEventListener("wheel", onUserIntent, { passive: true });
  window.addEventListener("touchstart", onUserIntent, { passive: true });
  window.addEventListener("touchmove", onUserIntent, { passive: true });
  window.addEventListener("pointerdown", onUserIntent, { passive: true });
  window.addEventListener("click", onUserIntent, true);

  apply();
  rafId = requestAnimationFrame(run);

  return () => stop(false);
};
