import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import Home from "@food/pages/user/Home";
import ProtectedRoute from "@food/components/ProtectedRoute";
import { AppShellSkeleton } from "@food/components/ui/loading-skeletons";
import { registerFoodPageCacheLifecycle } from "@food/utils/foodPageCache";
import { normalizeBrowsePath } from "@food/utils/browseScrollMemory";
import { requestBottomNavShow } from "@food/utils/bottomNavEvents";
import { DINING_ENABLED } from "@food/config/featureFlags";

const Dining = lazy(() => import("@food/pages/user/Dining"));
const Under250 = lazy(() => import("@food/pages/user/Under250"));
const Profile = lazy(() => import("@food/pages/user/profile/Profile"));

const TAB_SHELL_CLASS = "main-tab-keep-alive-pane";

function isHomeBrowsePath(path) {
  const p = normalizeBrowsePath(path);
  return (
    p === "/user" ||
    p === "/user/takeaway" ||
    p === "/takeaway" ||
    (DINING_ENABLED && (p === "/user/dining" || p === "/dining")) ||
    p === "/user/under-250" ||
    p === "/under-250"
  );
}

function TabSuspense({ children }) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      {children}
    </Suspense>
  );
}

/**
 * Keeps main nav tabs mounted after first visit so tab switches are instant
 * (no remount, no duplicate API calls, scroll preserved per tab).
 */
export default function MainTabKeepAlive({ activeTab, isVisible = true }) {
  const [visited, setVisited] = useState(() => new Set(activeTab ? [activeTab] : []));
  const scrollPositionsRef = useRef({});
  const prevTabRef = useRef(activeTab);
  const wasVisibleRef = useRef(isVisible);

  useEffect(() => {
    registerFoodPageCacheLifecycle();
  }, []);

  useEffect(() => {
    if (!activeTab) return;
    setVisited((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  // Apply scroll before paint so restaurant→home never flashes the top.
  // Restore only when tab changes or shell becomes visible again — never while idle.
  useLayoutEffect(() => {
    const becameVisible = isVisible && !wasVisibleRef.current;
    wasVisibleRef.current = isVisible;

    if (!isVisible) {
      // Always snapshot — including 0 — so category-from-top returns to top,
      // not a stale mid-page scroll from an earlier restaurant visit.
      if (activeTab && typeof window !== "undefined") {
        const y = Math.max(0, window.scrollY || 0);
        scrollPositionsRef.current[activeTab] = y;
        try {
          sessionStorage.setItem(`main_tab_scroll_${activeTab}`, String(y));
        } catch {}
      }
      prevTabRef.current = activeTab;
      return;
    }

    const prevTab = prevTabRef.current;
    const tabChanged = Boolean(prevTab && prevTab !== activeTab);
    if (tabChanged) {
      const y = Math.max(0, window.scrollY || 0);
      scrollPositionsRef.current[prevTab] = y;
      try {
        sessionStorage.setItem(`main_tab_scroll_${prevTab}`, String(y));
      } catch {}
    }

    if (!activeTab) {
      prevTabRef.current = activeTab;
      return;
    }

    // Idle on same visible tab — do not yank scroll (steals taps / kills smoothness).
    if (!tabChanged && !becameVisible) {
      prevTabRef.current = activeTab;
      return;
    }

    // Only restore browse scroll when it was saved for Home (restaurant→home).
    // Category browse scroll must NOT be applied on Home — that jumps mid-page.
    try {
      const rawBrowse = sessionStorage.getItem("food_browse_scroll_v1");
      if (rawBrowse) {
        const data = JSON.parse(rawBrowse);
        const y = Number(data?.scrollY);
        if (isHomeBrowsePath(data?.path) && Number.isFinite(y) && y >= 0) {
          window.scrollTo({ top: y, left: 0, behavior: "instant" });
          try {
            sessionStorage.removeItem("food_browse_scroll_v1");
          } catch {}
          requestBottomNavShow(900);
          prevTabRef.current = activeTab;
          return;
        }
      }
    } catch {}

    let savedY = scrollPositionsRef.current[activeTab];
    if (typeof savedY !== "number") {
      try {
        const raw = sessionStorage.getItem(`main_tab_scroll_${activeTab}`);
        if (raw != null) savedY = Number(raw);
      } catch {}
    }

    window.scrollTo({
      top: typeof savedY === "number" && Number.isFinite(savedY) ? savedY : 0,
      left: 0,
      behavior: "instant",
    });

    // Scroll restore can hide bottom nav mid-tap — keep it visible briefly.
    requestBottomNavShow(900);

    prevTabRef.current = activeTab;
  }, [activeTab, isVisible]);

  useEffect(() => {
    return () => {
      const tab = prevTabRef.current;
      if (!tab) return;
      try {
        const rawBrowse = sessionStorage.getItem("food_browse_scroll_v1");
        if (rawBrowse) {
          const data = JSON.parse(rawBrowse);
          if (
            isHomeBrowsePath(data?.path) &&
            Number.isFinite(Number(data?.scrollY))
          ) {
            sessionStorage.setItem(
              `main_tab_scroll_${tab}`,
              String(Math.max(0, Number(data.scrollY))),
            );
            return;
          }
        }
        if (typeof window !== "undefined") {
          sessionStorage.setItem(
            `main_tab_scroll_${tab}`,
            String(Math.max(0, window.scrollY || 0)),
          );
        }
      } catch {}
    };
  }, []);

  const paneProps = (tabId) => ({
    className: TAB_SHELL_CLASS,
    style: { display: activeTab === tabId ? "block" : "none" },
    "aria-hidden": activeTab !== tabId,
    "data-main-tab": tabId,
  });

  return (
    <>
      {visited.has("delivery") && (
        <div {...paneProps("delivery")}>
          <Home
            homeMode="delivery"
            isTabActive={isVisible && activeTab === "delivery"}
          />
        </div>
      )}

      {visited.has("takeaway") && (
        <div {...paneProps("takeaway")}>
          <Home
            homeMode="takeaway"
            isTabActive={isVisible && activeTab === "takeaway"}
          />
        </div>
      )}

      {DINING_ENABLED && visited.has("dining") && (
        <div {...paneProps("dining")}>
          <TabSuspense>
            <Dining isTabActive={isVisible && activeTab === "dining"} />
          </TabSuspense>
        </div>
      )}

      {visited.has("under250") && (
        <div {...paneProps("under250")}>
          <TabSuspense>
            <Under250 isTabActive={isVisible && activeTab === "under250"} />
          </TabSuspense>
        </div>
      )}

      {visited.has("profile") && (
        <div {...paneProps("profile")}>
          <ProtectedRoute requiredRole="user" loginPath="/user/auth/login">
            <TabSuspense>
              <Profile isTabActive={isVisible && activeTab === "profile"} />
            </TabSuspense>
          </ProtectedRoute>
        </div>
      )}
    </>
  );
}
