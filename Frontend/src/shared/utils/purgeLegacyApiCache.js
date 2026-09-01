/**
 * One-time removal of the legacy service-worker API cache.
 *
 * An earlier service worker matched `/api/v1/*` with StaleWhileRevalidate and a
 * 24-hour lifetime. That cache is user-specific data sitting in CacheStorage: it
 * made the app render responses up to a day old while the network returned fresh
 * ones, and it survived sign-out, so the next account on the same device could be
 * served the previous account's orders, addresses and wallet.
 *
 * The caching rule is gone from the Workbox config, but Workbox does not delete a
 * runtime cache just because its rule was removed — the store persists on every
 * device that ever loaded the old build. This clears it on startup so existing
 * installs heal themselves without the user having to clear site data.
 *
 * Safe to keep indefinitely: once the cache is gone the call is a no-op costing one
 * CacheStorage lookup.
 */
const LEGACY_API_CACHE = 'api-cache';

export async function purgeLegacyApiCache() {
  if (typeof caches === 'undefined') return false;

  try {
    const deleted = await caches.delete(LEGACY_API_CACHE);
    if (deleted) {
      console.info(
        '[cache] Removed the legacy service-worker API cache. ' +
        'API responses are no longer cached by the service worker.',
      );
    }
    return deleted;
  } catch {
    // A browser that blocks CacheStorage (private mode, storage disabled) simply
    // never had the cache to begin with.
    return false;
  }
}

export default purgeLegacyApiCache;
