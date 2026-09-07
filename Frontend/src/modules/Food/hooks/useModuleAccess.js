import { useSyncExternalStore } from "react";
import {
  getModuleAccess,
  subscribeModuleAccess,
  isDiningEnabled,
  isTakeawayEnabled,
} from "@food/config/featureFlags";

/**
 * Reactive access to the Takeaway / Dining admin toggles.
 * Re-renders the caller when an admin flips a toggle.
 */
export function useModuleAccess() {
  const flags = useSyncExternalStore(subscribeModuleAccess, getModuleAccess, getModuleAccess);
  return {
    takeawayEnabled: flags.takeaway_enabled === true,
    diningEnabled: flags.dining_enabled === true,
  };
}

export const useTakeawayEnabled = () => useModuleAccess().takeawayEnabled;
export const useDiningEnabled = () => useModuleAccess().diningEnabled;

export { isDiningEnabled, isTakeawayEnabled };

export default useModuleAccess;
