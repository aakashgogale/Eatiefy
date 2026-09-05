import { useEffect } from "react";
import { FOOD_PAGE_INVALIDATE_EVENT } from "@food/utils/foodPageCache";

/**
 * Subscribe to global food page invalidation (location/zone/auth changes).
 */
export function useFoodPageInvalidation(onInvalidate) {
  useEffect(() => {
    if (typeof onInvalidate !== "function") return undefined;

    const handler = (event) => {
      onInvalidate(event?.detail || {});
    };

    window.addEventListener(FOOD_PAGE_INVALIDATE_EVENT, handler);
    return () => window.removeEventListener(FOOD_PAGE_INVALIDATE_EVENT, handler);
  }, [onInvalidate]);
}
