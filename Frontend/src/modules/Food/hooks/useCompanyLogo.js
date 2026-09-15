import { useState, useEffect } from 'react';
import {
  loadBusinessSettings,
  getCachedSettings,
  getModuleLogoUrl,
} from '@food/utils/businessSettings';

/**
 * Resolves the brand logo for a module from admin business settings.
 *
 * Mirrors useCompanyName: paints instantly from cache, fetches when the cache
 * is cold, and re-reads on `businessSettingsUpdated` so a logo changed in admin
 * appears without a reload. Falls back to the bundled module logo, so callers
 * always get a usable URL.
 *
 * @param {'user'|'restaurant'|'delivery'} [moduleName]
 * @returns {string} logo URL
 */
export const useCompanyLogo = (moduleName = 'user') => {
  const [logoUrl, setLogoUrl] = useState(() => getModuleLogoUrl(moduleName));

  useEffect(() => {
    let cancelled = false;

    const syncFromCache = () => {
      if (cancelled) return;
      setLogoUrl(getModuleLogoUrl(moduleName));
    };

    if (!getCachedSettings()) {
      loadBusinessSettings()
        .then(syncFromCache)
        .catch(() => {
          /* keep the bundled fallback already in state */
        });
    } else {
      syncFromCache();
    }

    window.addEventListener('businessSettingsUpdated', syncFromCache);
    return () => {
      cancelled = true;
      window.removeEventListener('businessSettingsUpdated', syncFromCache);
    };
  }, [moduleName]);

  return logoUrl;
};

export default useCompanyLogo;
