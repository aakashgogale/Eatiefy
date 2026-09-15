/**
 * JWT Token Utilities
 * Decode and extract information from JWT tokens
 */

import { clearCategoryBrowseStorage } from "./categoryCache.js";

/**
 * Fired whenever a rider session is torn down (logout, account switch, expired
 * token). Live delivery hooks listen for it to drop in-memory offers, stop the
 * ringtone and reset socket subscriptions.
 */
export const DELIVERY_SESSION_RESET_EVENT = "deliverySessionReset";

/**
 * Decode JWT token without verification (client-side only)
 * @param {string} token - JWT token
 * @returns {Object|null} - Decoded token payload or null if invalid
 */
export function decodeToken(token) {
  if (!token) return null;

  try {
    // JWT format: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decode base64url encoded payload
    const payload = parts[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    
    return decoded;
  } catch (error) {
    console.error('Error decoding token:', error);
    return null;
  }
}

/**
 * Get user role from token
 * @param {string} token - JWT token
 * @returns {string|null} - User role or null if not found
 */
export function getRoleFromToken(token) {
  const decoded = decodeToken(token);
  return decoded?.role || null;
}

/**
 * Check if token is expired
 * @param {string} token - JWT token
 * @returns {boolean} - True if expired or invalid
 */
export function isTokenExpired(token) {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) return true;
  
  // exp is in seconds, Date.now() is in milliseconds
  return decoded.exp * 1000 < Date.now();
}

/**
 * Get user ID from token
 * @param {string} token - JWT token
 * @returns {string|null} - User ID or null if not found
 */
export function getUserIdFromToken(token) {
  const decoded = decodeToken(token);
  return decoded?.userId || decoded?.id || null;
}

/**
 * Check if user has access to a module based on role
 * @param {string} role - User role
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {boolean} - True if user has access
 */
export function hasModuleAccess(role, module) {
  const roleModuleMap = {
    'admin': 'admin',
    'restaurant': 'restaurant',
    'delivery': 'delivery',
    'user': 'user'
  };

  return roleModuleMap[role] === module;
}

/**
 * Get module-specific access token
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {string|null} - Access token or null
 */
export function getModuleToken(module) {
  return localStorage.getItem(`${module}_accessToken`);
}

/**
 * Get module-specific refresh token (fallback for WebView environments where cookies may be unreliable)
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {string|null} - Refresh token or null
 */
export function getModuleRefreshToken(module) {
  return localStorage.getItem(`${module}_refreshToken`);
}

/**
 * Get current user's role from a specific module's storage/token
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {string|null} - Current user role or null
 */
export function getCurrentUserRole(module = null) {
  if (module) {
    const userStr = localStorage.getItem(`${module}_user`);
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        return user.role || module;
      } catch (e) {
        return module;
      }
    }
  }
  return module || 'user';
}

/**
 * Get current user object from specific module's storage
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {Object|null} - User object or null
 */
export function getCurrentUser(module) {
  if (!module) return null;
  const userStr = localStorage.getItem(`${module}_user`);
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch (e) {
    return null;
  }
}

/**
 * Check if user is authenticated for a specific module
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @returns {boolean} - True if authenticated
 */
export function isModuleAuthenticated(module) {
  const token = getModuleToken(module);
  return !!token && !isTokenExpired(token);
}

/**
 * Clear authentication data for a specific module
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 */
/**
 * Drops the delivery app's persisted runtime state on logout.
 *
 * Cleared by prefix rather than by exact key, so it also removes the legacy
 * unscoped `delivery-v2-online-pref` still sitting on devices from before the
 * key was namespaced per rider. Leaving it behind meant the next rider to sign
 * in on this device rehydrated the previous rider's active order and online
 * status - and since online status is pushed to the server on mount, they were
 * silently put online and started receiving delivery offers.
 */
function clearDeliveryRuntimeState() {
  const PREFIX = "delivery-v2-online-pref";
  try {
    Object.keys(localStorage)
      .filter((key) => key === PREFIX || key.startsWith(`${PREFIX}:`))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    /* ignore */
  }

  /*
   * Delivery state that was never namespaced per rider.
   *
   * Unlike the prefixed bucket above, each of these is a single device-wide key
   * written by whoever was signed in at the time and read straight back by
   * whoever signs in next: the muted-request list silences the new rider's
   * ringtone for order ids they have never seen, and the cached GPS puts them
   * on duty at the previous rider's last known position.
   */
  const UNSCOPED_KEYS = [
    "delivery_muted_order_ids",
    "delivery_notifications_muted",
    "deliveryBoyLastLocation",
    "deliveryUser",
  ];
  UNSCOPED_KEYS.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  });

  /*
   * localStorage is only half the state. The delivery store is a module
   * singleton, so on a logout/login inside one app session its in-memory offer
   * and trip queues are simply carried over - the next rider opens the app
   * already looking at the previous rider's orders, ringtone included. This
   * event is what tells the live socket hook and the store to stand down.
   */
  try {
    window.dispatchEvent(new CustomEvent(DELIVERY_SESSION_RESET_EVENT));
  } catch {
    /* no window (SSR) or CustomEvent unsupported */
  }
}

export function clearModuleAuth(module) {
  localStorage.removeItem(`${module}_accessToken`);
  localStorage.removeItem(`${module}_refreshToken`);
  localStorage.removeItem(`${module}_authenticated`);
  localStorage.removeItem(`${module}_user`);
  // Clear cached FCM web token for this module
  localStorage.removeItem(`fcm_web_registered_token_${module}`);
  try {
    sessionStorage.removeItem(`fcm_backend_synced_${module}`);
  } catch {
    /* ignore */
  }
  localStorage.removeItem("app:isOnline");
  
  if (module === "user") {
    clearUserSession();
    sessionStorage.removeItem("userAuthData");
  }
  
  if (module === "restaurant") {
    clearRestaurantSessionCache();
    sessionStorage.removeItem("restaurantAuthData");
    sessionStorage.removeItem("restaurantLoginPhone");
  }

  if (module === "delivery") {
    sessionStorage.removeItem("deliveryAuthData");
    clearDeliveryRuntimeState();
  }

  if (module === "admin") {
    // Reset admin-only UI state so a fresh login starts clean (e.g. the Top
    // Restaurants selected-zone preference and any unsaved drafts).
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("top_restaurants_"))
        .forEach((k) => localStorage.removeItem(k));
    } catch (e) {
      /* ignore */
    }
  }

  // Also clear any standard naming conventions
  sessionStorage.removeItem(`${module}AuthData`);
}

/**
 * Clear user-specific profile data to prevent data leakage across accounts.
 */
export function clearUserSession() {
  if (typeof localStorage === "undefined") return;
  const keys = [
    "userProfile", 
    "user_user", 
    "user_edit_profile_draft",
    "user",
    "cart",
    "userVegMode",
    "userVegModeOption",
    "food-under-250-filters",
    "food-category-page-filters-v1",
    "app:isOnline"
  ];
  keys.forEach((k) => localStorage.removeItem(k));
  // Next login should fetch current GPS like a fresh app open.
  try {
    sessionStorage.removeItem("ometto_location_session");
    sessionStorage.removeItem("lastLoginLocationFetch");
    localStorage.setItem("deliveryAddressMode", "current");
  } catch {
    /* ignore */
  }
  // Drop in-memory + session browse caches so next account starts clean
  try {
    clearCategoryBrowseStorage();
  } catch {
    /* ignore */
  }
}

/**
 * Clear restaurant-local cached UI data to prevent cross-account stale state.
 */
export function clearRestaurantSessionCache() {
  const keys = [
    "restaurant_owner_contact",
    "restaurant_onboarding",
    "restaurant_onboarding_data",
    "restaurant_invited_users",
    "restaurant_schedule_off",
    "restaurant_online_status",
    "restaurant_outlet_timings",
    "restaurant_hub_menu_active_tab",
    "restaurant_name",
    "restaurantName",
    "restaurant_pendingPhone",
    "restaurant_pendingStatus",
    "restaurant_pendingMessage",
  ];

  keys.forEach((key) => localStorage.removeItem(key));
}

export function setRestaurantPendingPhone(phone) {
  if (typeof localStorage === "undefined") return;
  if (!phone) {
    localStorage.removeItem("restaurant_pendingPhone");
    return;
  }
  localStorage.setItem("restaurant_pendingPhone", phone);
}

export function getRestaurantPendingPhone() {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem("restaurant_pendingPhone");
}

export function clearRestaurantPendingPhone() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem("restaurant_pendingPhone");
}

/**
 * Clear all authentication data for all modules
 */
export function clearAuthData() {
  const modules = ['admin', 'restaurant', 'delivery', 'user'];
  modules.forEach(module => {
    clearModuleAuth(module);
  });
  // Also clear legacy token if it exists
  localStorage.removeItem('accessToken');
  localStorage.removeItem('user');
}

/**
 * Set authentication data for a specific module
 * @param {string} module - Module name (admin, restaurant, delivery, user)
 * @param {string} token - Access token
 * @param {Object} user - User data
 * @param {string|null} refreshToken - Optional refresh token
 * @throws {Error} If localStorage is not available or quota exceeded
 */
export function setAuthData(module, token, user, refreshToken = null) {
  try {
    // Check if localStorage is available
    if (typeof Storage === 'undefined' || !localStorage) {
      throw new Error('localStorage is not available');
    }

    // Validate inputs
    if (!module || !token) {
      throw new Error(`Invalid parameters: module=${module}, token=${!!token}`);
    }

    console.log(`[setAuthData] Storing auth for module: ${module}`, {
      hasToken: !!token,
      tokenLength: token?.length,
      hasUser: !!user
    });

    // Store module-specific token (don't clear other modules)
    const tokenKey = `${module}_accessToken`;
    const refreshTokenKey = `${module}_refreshToken`;
    const authKey = `${module}_authenticated`;
    const userKey = `${module}_user`;

    // Prevent stale profile data from previous accounts after re-login.
    if (module === "user") {
      clearUserSession();
    } else if (module === "restaurant") {
      clearRestaurantSessionCache();
    } else if (module === "delivery") {
      /*
       * Sign-in is the second choke point, and the one that catches what logout
       * cannot: an account switch where the previous session was never cleanly
       * ended (app killed, token expired, a different rider simply signs in).
       * Clearing here, before the new token is written, guarantees the incoming
       * rider cannot inherit the previous rider's offers, ringtone mutes or
       * online flag no matter how the previous session ended.
       */
      clearDeliveryRuntimeState();
    }

    localStorage.setItem(tokenKey, token);
    if (refreshToken && typeof refreshToken === "string") {
      localStorage.setItem(refreshTokenKey, refreshToken);
    }
    localStorage.setItem(authKey, 'true');
    
    if (user) {
      try {
        localStorage.setItem(userKey, JSON.stringify(user));
      } catch (userError) {
        console.warn('Failed to store user data, but token was stored:', userError);
        // Don't throw - token storage is more important
      }
    }

    // Verify the token was stored correctly
    const storedToken = localStorage.getItem(tokenKey);
    const storedAuth = localStorage.getItem(authKey);
    
    if (storedToken !== token) {
      console.error(`[setAuthData] Token mismatch:`, {
        expected: token?.substring(0, 20) + '...',
        stored: storedToken?.substring(0, 20) + '...'
      });
      throw new Error(`Token storage verification failed for module: ${module}`);
    }

    if (storedAuth !== 'true') {
      console.error(`[setAuthData] Auth flag mismatch:`, {
        expected: 'true',
        stored: storedAuth
      });
      throw new Error(`Authentication flag storage failed for module: ${module}`);
    }

    console.log(`[setAuthData] Successfully stored auth data for ${module}`);
  } catch (error) {
    // If quota exceeded, try to clear some space
    if (error.name === 'QuotaExceededError' || error.code === 22) {
      console.warn('localStorage quota exceeded. Attempting to clear old data...');
      // Clear legacy tokens
      try {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
        // Retry storing
        localStorage.setItem(`${module}_accessToken`, token);
        if (refreshToken && typeof refreshToken === "string") {
          localStorage.setItem(`${module}_refreshToken`, refreshToken);
        }
        localStorage.setItem(`${module}_authenticated`, 'true');
        if (user) {
          localStorage.setItem(`${module}_user`, JSON.stringify(user));
        }
        
        // Verify again after retry
        const storedToken = localStorage.getItem(`${module}_accessToken`);
        if (storedToken !== token) {
          throw new Error('Token storage failed even after clearing space');
        }
      } catch (retryError) {
        console.error('Failed to store auth data after clearing space:', retryError);
        throw new Error('Unable to store authentication data. Please clear browser storage and try again.');
      }
    } else {
      console.error('[setAuthData] Error storing auth data:', error);
      throw error;
    }
  }
}
