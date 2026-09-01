import { useEffect, useSyncExternalStore } from 'react';

export const EATIEFY_REFRESH_EVENT = 'eatiefy:refresh';

/**
 * Hook to listen to global in-app pull-to-refresh events.
 * @param {Function} onRefresh - Async or sync callback to execute on pull-to-refresh.
 */
export function usePullToRefresh(onRefresh) {
  useEffect(() => {
    if (typeof onRefresh !== 'function') return undefined;

    const handleRefresh = (event) => {
      try {
        const result = onRefresh(event?.detail);
        if (result && typeof result.then === 'function') {
          // If promise returned, register in event detail if provided
          if (event?.detail?.promises && Array.isArray(event.detail.promises)) {
            event.detail.promises.push(result);
          }
        }
      } catch (err) {
        console.error('[PullToRefresh] Error in refresh callback:', err);
      }
    };

    window.addEventListener(EATIEFY_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(EATIEFY_REFRESH_EVENT, handleRefresh);
  }, [onRefresh]);
}

/* ------------------------------------------------------------------------- */
/* Refresh key                                                                */
/* ------------------------------------------------------------------------- */

/**
 * A counter that changes on every in-app refresh.
 *
 * Screens fetch in their own mount effects rather than through a shared cache, so
 * there is no single store to invalidate. Using this value as the React `key` of a
 * layout's page content remounts the screen, which re-runs every one of those
 * effects — the same end result as reloading the tab in a browser, without the
 * white flash or the loss of the surrounding shell (cart, session, socket).
 *
 * Providers that own data above that boundary are not remounted; they subscribe to
 * EATIEFY_REFRESH_EVENT and refetch themselves.
 */
let refreshKey = 0;
const refreshKeyListeners = new Set();

const bumpRefreshKey = () => {
  refreshKey += 1;
  refreshKeyListeners.forEach((notify) => notify());
};

const subscribeToRefreshKey = (onStoreChange) => {
  refreshKeyListeners.add(onStoreChange);
  if (refreshKeyListeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener(EATIEFY_REFRESH_EVENT, bumpRefreshKey);
  }
  return () => {
    refreshKeyListeners.delete(onStoreChange);
    if (refreshKeyListeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener(EATIEFY_REFRESH_EVENT, bumpRefreshKey);
    }
  };
};

export function useRefreshKey() {
  return useSyncExternalStore(
    subscribeToRefreshKey,
    () => refreshKey,
    () => 0,
  );
}

export default usePullToRefresh;
