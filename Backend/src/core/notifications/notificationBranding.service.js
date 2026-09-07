import { FoodBusinessSettings } from '../../modules/food/admin/models/businessSettings.model.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedIcon = '';
let cachedAt = 0;
let inflight = null;

/**
 * Web-push icon configured by the admin (Business Settings → favicon).
 *
 * Read synchronously so building a message stays cheap; the value is refreshed
 * in the background. Returns '' until the first refresh lands, in which case the
 * service worker falls back to the bundled Eatiefy icon.
 */
export const getCachedNotificationIcon = () => {
    if (Date.now() - cachedAt > CACHE_TTL_MS) {
        // Fire and forget: never delay a push on a settings lookup.
        void refreshNotificationIcon();
    }
    return cachedIcon;
};

export const refreshNotificationIcon = async () => {
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            const settings = await FoodBusinessSettings.findOne().select('favicon logo').lean();
            const url = settings?.favicon?.url || settings?.logo?.url || '';
            // Only absolute URLs are usable by a service worker on another origin.
            cachedIcon = /^https?:\/\//i.test(url) ? url : '';
        } catch {
            cachedIcon = '';
        } finally {
            cachedAt = Date.now();
            inflight = null;
        }
        return cachedIcon;
    })();

    return inflight;
};

/** Called after an admin saves business settings. */
export const invalidateNotificationIconCache = () => {
    cachedAt = 0;
    cachedIcon = '';
};
