import { FoodSystemConfig } from '../models/systemConfig.model.js';

const MAINTENANCE_KEY = 'maintenance_mode_enabled';
const CACHE_TTL_MS = 3000;

let cachedValue = false;
let cachedAt = 0;
let inflight = null;

/**
 * Returns true only when maintenance mode is explicitly enabled.
 * Defaults to false (apps stay open) on missing config / DB errors.
 */
export async function isMaintenanceModeEnabled() {
  const now = Date.now();
  if (now - cachedAt < CACHE_TTL_MS) {
    return cachedValue === true;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const doc = await FoodSystemConfig.findOne({ key: MAINTENANCE_KEY }).lean();
      cachedValue = doc?.value === true;
      cachedAt = Date.now();
      return cachedValue;
    } catch {
      // Fail open: never lock apps if config lookup fails.
      cachedValue = false;
      cachedAt = Date.now();
      return false;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Call after admin updates customization settings so clients/APIs flip instantly. */
export function invalidateMaintenanceModeCache(nextValue) {
  cachedAt = 0;
  if (typeof nextValue === 'boolean') {
    cachedValue = nextValue === true;
    cachedAt = Date.now();
  }
}
