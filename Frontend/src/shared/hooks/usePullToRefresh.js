import { useEffect } from 'react';

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

export default usePullToRefresh;
