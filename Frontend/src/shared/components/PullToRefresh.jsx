import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateFoodPages } from '@food/utils/foodPageCache';
import { EATIEFY_REFRESH_EVENT } from '../hooks/usePullToRefresh';

const PULL_THRESHOLD = 65; // pixels to trigger refresh
const MAX_PULL_DISTANCE = 85; // maximum indicator travel

export default function PullToRefresh({ children, onRefresh }) {
  const queryClient = useQueryClient();
  const [pullDistance, setPullDistance] = useState(0);
  const [status, setStatus] = useState('idle'); // 'idle' | 'pulling' | 'ready' | 'refreshing' | 'success'
  
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });
  const isPullingRef = useRef(false);
  const isRefreshingRef = useRef(false);
  const hapticTriggeredRef = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  // Find if touch target is inside a scrollable container that isn't at the top
  const isScrollAtTop = useCallback((target) => {
    if (typeof window === 'undefined') return true;
    if (window.scrollY > 2) return false;

    let el = target;
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) {
        const overflowY = window.getComputedStyle(el).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') {
          if (el.scrollTop > 2) {
            return false;
          }
        }
      }
      el = el.parentElement;
    }
    return true;
  }, []);

  const triggerHaptic = useCallback(() => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(12);
      }
    } catch (_) {}
  }, []);

  const performRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    setStatus('refreshing');
    setPullDistance(PULL_THRESHOLD);

    const refreshPromises = [];

    // 1. Invalidate active React Queries
    if (queryClient) {
      refreshPromises.push(
        queryClient.refetchQueries({
          type: 'active',
          stale: true,
        }).catch((e) => console.warn('[PullToRefresh] React Query refetch warning:', e))
      );
    }

    // 2. Invalidate Food Page caches & notify page subscribers
    try {
      invalidateFoodPages({ clearCache: true });
    } catch (e) {
      console.warn('[PullToRefresh] Cache invalidation warning:', e);
    }

    // 3. Dispatch global eatiefy:refresh event with promise collector
    try {
      const customPromises = [];
      window.dispatchEvent(
        new CustomEvent(EATIEFY_REFRESH_EVENT, {
          detail: {
            timestamp: Date.now(),
            promises: customPromises,
          },
        })
      );
      if (customPromises.length > 0) {
        refreshPromises.push(...customPromises);
      }
    } catch (e) {
      console.warn('[PullToRefresh] Event dispatch warning:', e);
    }

    // 4. Custom prop handler if passed
    if (typeof onRefresh === 'function') {
      try {
        const res = onRefresh();
        if (res && typeof res.then === 'function') {
          refreshPromises.push(res);
        }
      } catch (e) {
        console.warn('[PullToRefresh] Custom onRefresh error:', e);
      }
    }

    // Minimum display duration for a clean, premium visual experience (650ms)
    const minDelay = new Promise((resolve) => setTimeout(resolve, 650));
    refreshPromises.push(minDelay);

    try {
      await Promise.allSettled(refreshPromises);
      setStatus('success');
      triggerHaptic();
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch (err) {
      console.error('[PullToRefresh] Refresh failed:', err);
    } finally {
      setPullDistance(0);
      setStatus('idle');
      isRefreshingRef.current = false;
      hapticTriggeredRef.current = false;
    }
  }, [queryClient, onRefresh, triggerHaptic]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let startX = 0;
    let startY = 0;
    let validPullStart = false;

    const handleTouchStart = (e) => {
      if (isRefreshingRef.current) return;
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      touchStartRef.current = { x: startX, y: startY, time: Date.now() };
      hapticTriggeredRef.current = false;

      // Only allow pull-to-refresh if we are at the top
      validPullStart = isScrollAtTop(e.target);
      isPullingRef.current = false;
    };

    const handleTouchMove = (e) => {
      if (!validPullStart || isRefreshingRef.current || e.touches.length !== 1) return;

      const touch = e.touches[0];
      const deltaY = touch.clientY - startY;
      const deltaX = touch.clientX - startX;

      // If scrolling up or user is swiping horizontally (carousels, tabs), ignore
      if (deltaY <= 0 || Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
        return;
      }

      // If we are at the top and pulling downwards
      if (isScrollAtTop(e.target)) {
        // Prevent default native browser overscroll/rubber-band pull
        if (e.cancelable) {
          e.preventDefault();
        }

        isPullingRef.current = true;

        // Smooth logarithmic dampening formula
        const dampenedY = Math.min(
          MAX_PULL_DISTANCE,
          Math.pow(deltaY, 0.82) * 1.85
        );

        setPullDistance(dampenedY);

        if (dampenedY >= PULL_THRESHOLD) {
          if (!hapticTriggeredRef.current) {
            triggerHaptic();
            hapticTriggeredRef.current = true;
          }
          setStatus('ready');
        } else {
          hapticTriggeredRef.current = false;
          setStatus('pulling');
        }
      }
    };

    const handleTouchEnd = () => {
      if (!validPullStart || isRefreshingRef.current) {
        validPullStart = false;
        return;
      }

      if (isPullingRef.current) {
        if (statusRef.current === 'ready') {
          performRefresh();
        } else {
          setPullDistance(0);
          setStatus('idle');
        }
      }

      validPullStart = false;
      isPullingRef.current = false;
    };

    const options = { passive: false };
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, options);
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove, options);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isScrollAtTop, triggerHaptic, performRefresh]);

  const progress = Math.min(1, pullDistance / PULL_THRESHOLD);
  const isVisible = pullDistance > 4 || status === 'refreshing' || status === 'success';

  // SVG circular arc progress calculation
  const circleRadius = 10;
  const circumference = 2 * Math.PI * circleRadius;
  const strokeDashoffset = circumference - progress * (circumference * 0.8);

  return (
    <>
      {/* Floating In-App Pull-To-Refresh Indicator (Zomato / Native App style) */}
      <div
        className={`fixed left-1/2 -translate-x-1/2 z-[99999] pointer-events-none transition-transform ${
          status === 'pulling' ? 'duration-75 ease-out' : 'duration-300 cubic-bezier(0.16, 1, 0.3, 1)'
        } ${isVisible ? 'opacity-100' : 'opacity-0 scale-75'}`}
        style={{
          top: 'max(env(safe-area-inset-top, 12px), 12px)',
          transform: `translate3d(-50%, ${pullDistance > 0 ? pullDistance : (status === 'refreshing' || status === 'success') ? PULL_THRESHOLD : -50}px, 0) scale(${isVisible ? 1 : 0.75})`,
          transitionProperty: status === 'pulling' ? 'opacity, scale' : 'transform, opacity, scale',
        }}
      >
        <div className="w-10 h-10 rounded-full bg-white/95 dark:bg-[#1c1c1c]/95 backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)] border border-slate-200/90 dark:border-white/10 flex items-center justify-center">
          {status === 'success' ? (
            <svg
              className="w-5 h-5 text-emerald-500 animate-in zoom-in-50 duration-200"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : status === 'refreshing' ? (
            <div className="relative w-5 h-5 flex items-center justify-center animate-spin">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-20"
                  cx="12"
                  cy="12"
                  r="9"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <path
                  d="M12 3a9 9 0 0 1 9 9"
                  stroke="#00A859"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          ) : (
            <div
              className="relative w-6 h-6 flex items-center justify-center transition-transform duration-100"
              style={{ transform: `rotate(${progress * 280}deg)` }}
            >
              <svg className="w-6 h-6 -rotate-90" viewBox="0 0 24 24">
                {/* Background Track */}
                <circle
                  cx="12"
                  cy="12"
                  r={circleRadius}
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="text-slate-200 dark:text-neutral-700"
                  fill="none"
                />
                {/* Progress Arc */}
                <circle
                  cx="12"
                  cy="12"
                  r={circleRadius}
                  stroke="#00A859"
                  strokeWidth="2.5"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
              {/* Arrow Head */}
              <div
                className="absolute inset-0 flex items-center justify-center transition-transform duration-150"
                style={{
                  transform: `rotate(${status === 'ready' ? 180 : 0}deg)`,
                }}
              >
                <svg
                  className="w-3.5 h-3.5 text-slate-700 dark:text-slate-200"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>

      {children}
    </>
  );
}
