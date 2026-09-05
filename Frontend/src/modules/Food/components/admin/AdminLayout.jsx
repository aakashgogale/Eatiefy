import { useState, useEffect, useLayoutEffect, useRef } from "react"
import { Outlet, useLocation, useNavigate, Navigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import AdminSidebar from "./AdminSidebar"
import AdminNavbar from "./AdminNavbar"
import { API_BASE_URL } from "@food/api/config"
import { adminAPI } from "@food/api"
import { getCurrentUser, getModuleToken, setAuthData, getModuleRefreshToken } from "@food/utils/auth"
import {
  canAccessPath,
  getFirstAllowedPath,
  isSubAdmin,
} from "@food/utils/subAdminPermissions"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [userVersion, setUserVersion] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef(null);
  const user = getCurrentUser("admin");

  // Keep SUB_ADMIN permissions in sync (so permission changes apply without re-login)
  useEffect(() => {
    if (!isSubAdmin(user)) return
    let cancelled = false
    adminAPI
      .getAdminProfile()
      .then((res) => {
        if (cancelled) return
        const fresh =
          res?.data?.data?.admin ||
          res?.data?.admin ||
          res?.data?.data?.user ||
          null
        if (!fresh) return
        const prevPerms = JSON.stringify(user?.permissions || {})
        const nextPerms = JSON.stringify(fresh.permissions || {})
        // Avoid rewriting localStorage (and remounting sidebar) when nothing changed
        if (prevPerms === nextPerms && String(user?.role) === String(fresh.role) && user?.isActive === fresh.isActive) {
          return
        }
        const token = getModuleToken("admin")
        const refresh = getModuleRefreshToken("admin")
        if (token) {
          setAuthData("admin", token, { ...user, ...fresh }, refresh)
          setUserVersion((v) => v + 1)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Scroll the main content container back to the top whenever pathname changes
  // to prevent new pages from loading scrolled down/partially hidden.
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
  }, [location.pathname]);

  // Block SUB_ADMIN from routes they don't have permission for
  const latestUser = getCurrentUser("admin") || user
  if (isSubAdmin(latestUser) && !canAccessPath(latestUser, location.pathname)) {
    const fallback = getFirstAllowedPath(latestUser);
    if (fallback !== location.pathname) {
      return <Navigate to={fallback} replace />;
    }
  }

  const normalizedPath = location.pathname.replace(/\/+$/, "") || "/"
  const showBackButton =
    normalizedPath !== "/admin/food" &&
    normalizedPath !== "/admin/food/coupons" &&
    normalizedPath !== "/admin/food/cash-confirmations" &&
    normalizedPath !== "/admin/food/sub-admins" &&
    normalizedPath !== "/admin/food/broadcast-notification" &&
    normalizedPath !== "/admin/food/pricing";

  const handleBackClick = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate("/admin/food");
    }
  };

  // Get initial collapsed state from localStorage to set initial margin
  useEffect(() => {
    try {
      const saved = localStorage.getItem('admin_sidebar_state')
      if (saved !== null) {
        const state = JSON.parse(saved)
        if (state && typeof state.isCollapsed !== 'undefined') {
          setIsSidebarCollapsed(state.isCollapsed)
        }
      }
    } catch (e) {
      debugError('Error loading sidebar collapsed state:', e)
    }
  }, [])

  const handleCollapseChange = (collapsed) => {
    setIsSidebarCollapsed(collapsed)
  }

  // Offset dialogs toward the main content area (sidebar is fixed; viewport center sits too far left).
  useEffect(() => {
    const offset = isSidebarCollapsed ? "2.5rem" : "10rem"
    document.documentElement.style.setProperty("--admin-sidebar-offset", offset)
    return () => {
      document.documentElement.style.removeProperty("--admin-sidebar-offset")
    }
  }, [isSidebarCollapsed])

  // Dynamic back button target detection (runs safe check via React Portal)
  // Dynamic back button target detection (runs safe check via direct DOM insertion)
  useLayoutEffect(() => {
    // 1. Clean up any existing global back button in the DOM first
    const existing = document.querySelectorAll(".global-back-btn");
    existing.forEach(el => el.remove());

    if (!showBackButton) {
      return;
    }

    const findHeaderContainer = (h1Element) => {
      if (!h1Element) return null;
      const parent = h1Element.parentNode;
      if (!parent) return h1Element;

      // Check if the grandparent is a flex row containing an icon/svg sibling before the parent (e.g. Zone Setup)
      const grandparent = parent.parentNode;
      if (grandparent && grandparent.tagName !== "MAIN") {
        const grandparentStyle = window.getComputedStyle(grandparent);
        const isGrandparentFlex = grandparentStyle.display === "flex" || grandparent.className.includes("flex");
        if (isGrandparentFlex) {
          const children = Array.from(grandparent.children);
          const parentIdx = children.indexOf(parent);
          if (parentIdx > 0) {
            const hasIconBefore = children.slice(0, parentIdx).some(child => {
              return child.tagName === "SVG" || child.tagName === "svg" || child.querySelector("svg") || child.querySelector("img") || child.className.includes("bg-") || child.className.includes("rounded");
            });
            if (hasIconBefore) {
              return grandparent;
            }
          }
        }
      }
      return parent;
    };

    const updateTarget = () => {
      if (typeof document === "undefined") return false;

      // Find the h1 inside main
      const h1 = document.querySelector("main h1");
      if (!h1) return false;

      const container = findHeaderContainer(h1);
      if (container) {
        // Prevent duplicate rendering if a back button already exists in the header container
        const hasBackButton = container.querySelector(".global-back-btn") || 
                            container.querySelector("button[title='Back']") || 
                            container.querySelector("button[title='Go Back']") || 
                            container.querySelector(".lucide-arrow-left") ||
                            container.querySelector("svg[class*='arrow-left']");
        if (hasBackButton) {
          return true; // Already has back button, stop
        }

        // Enforce flex layout and alignment on container
        container.style.display = "flex";
        container.style.alignItems = "center";
        
        // Ensure flex layout handles children spacing
        Array.from(container.children).forEach(child => {
          if (child.tagName === 'SVG' || child.tagName === 'svg' || child.classList.contains('lucide')) {
            child.style.marginRight = "0px";
          }
        });

        // Create the vanilla button element
        const btn = document.createElement("button");
        btn.className = "global-back-btn group order-first flex items-center justify-center p-2 rounded-lg bg-white/60 backdrop-blur-md border border-slate-200 hover:bg-white text-slate-700 hover:text-slate-900 transition-all duration-200 shadow-sm active:scale-95 cursor-pointer mr-3 shrink-0";
        btn.title = "Go Back";
        btn.onclick = handleBackClick;
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-left w-4 h-4 transition-transform duration-200 group-hover:-translate-x-0.5"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`;

        // Insert at the beginning of the container
        container.insertBefore(btn, container.firstChild);
        return true;
      }
      return false;
    };

    // Attempt instant target detection
    if (updateTarget()) return;

    // Set up MutationObserver to detect when the heading mounts in the DOM subtree
    const mainElement = document.querySelector("main");
    const observer = new MutationObserver(() => {
      if (updateTarget()) {
        observer.disconnect();
      }
    });

    if (mainElement) {
      observer.observe(mainElement, {
        childList: true,
        subtree: true
      });
    }

    // Fast polling fallback for instant check (50ms intervals)
    const interval = setInterval(() => {
      if (updateTarget()) {
        clearInterval(interval);
        observer.disconnect();
      }
    }, 50);

    // Timeout fallback to prevent memory leaks if no h1 exists on page
    const timeout = setTimeout(() => {
      clearInterval(interval);
      observer.disconnect();
    }, 3000);

    return () => {
      clearInterval(interval);
      observer.disconnect();
      clearTimeout(timeout);
    };
  }, [location.pathname, showBackButton]);

  return (
    <div className="h-screen bg-neutral-200 flex overflow-hidden admin-module-container">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-gray-900/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <AdminSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onCollapseChange={handleCollapseChange}
      />

      <div className={`
        flex-1 flex min-h-0 flex-col transition-[margin-left] duration-300 ease-in-out min-w-0
        ${isSidebarCollapsed ? 'lg:ml-20' : 'lg:ml-80'}
      `}>
        {/* Top Navbar */}
        <AdminNavbar onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        {/* Backend disconnected banner */}
        {!API_BASE_URL && (
          <div className="w-full bg-amber-100 border-b border-amber-300 px-4 py-2 text-center text-sm text-amber-900">
            Backend disconnected. Data is not live.
          </div>
        )}

        {/* Page Content */}
        <main ref={mainRef} className="flex-1 min-h-0 w-full max-w-full overflow-x-hidden overflow-y-auto bg-neutral-100">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

