/**
 * One request for everything the app shell needs before it can render.
 *
 * The user app otherwise opens with nine separate public GETs — business settings,
 * feature flags, fee settings, banner lists, explore icons, customization toggles and
 * landing settings. None depend on each other, all are needed before the home screen
 * can paint, and each costs a CORS preflight plus a round trip on a mobile connection.
 *
 * The individual routes stay exactly as they were — the admin app still uses them, and
 * both paths call the same loaders, so the payloads cannot drift.
 */
import { loadBusinessSettingsPayload } from '../../admin/controllers/businessSettings.controller.js';
import { loadCustomizationSettings } from '../../admin/controllers/systemConfig.controller.js';
import { getFeeSettings } from '../../admin/services/admin.service.js';
import { getPublicHomePromotionBanners } from '../services/homePromotionBanner.service.js';
import {
    loadPublicExploreIcons,
    loadPublicHeroBanners,
    loadPublicLandingSettings,
} from './publicLanding.controller.js';
import { sendResponse } from '../../../../utils/response.js';
import { logger } from '../../../../utils/logger.js';

/**
 * One slow or broken section must not blank the whole app shell, so each loader is
 * settled independently and a failure becomes `null` for that key only.
 */
const settle = async (label, loader) => {
    try {
        return await loader();
    } catch (error) {
        logger.warn(`app-config: ${label} failed — ${error.message}`);
        return null;
    }
};

/** GET /food/public/app-config?zoneId=... */
export const getPublicAppConfigController = async (req, res, next) => {
    try {
        const zoneId = req.query?.zoneId;

        const [
            businessSettings,
            feeSettings,
            heroBanners,
            promoBanners,
            exploreIcons,
            customization,
            landing,
        ] = await Promise.all([
            settle('businessSettings', loadBusinessSettingsPayload),
            // Fee settings are zone-scoped and the loader rejects a missing zone, so
            // only bundle them once the client knows where it is.
            zoneId ? settle('feeSettings', () => getFeeSettings(zoneId)) : null,
            settle('heroBanners', () => loadPublicHeroBanners(zoneId)),
            // Deliberately unfiltered: the home carousel has always shown every active
            // promotion, and zone-filtering it here would silently drop banners.
            settle('promoBanners', () => getPublicHomePromotionBanners()),
            settle('exploreIcons', () => loadPublicExploreIcons(zoneId)),
            settle('customization', loadCustomizationSettings),
            // Zone-specific, so it is only worth bundling when the client already knows
            // its zone; otherwise the client asks for it separately once detection ends.
            zoneId ? settle('landing', () => loadPublicLandingSettings(zoneId)) : null,
        ]);

        return sendResponse(res, 200, 'App config fetched', {
            businessSettings,
            // This backend has no power-scanning or feature-settings module; the client
            // treats these as optional and falls back to its own defaults.
            powerScanning: null,
            featureSettings: [],
            feeSettings: feeSettings?.feeSettings ?? null,
            topBanners: [],
            heroBanners: Array.isArray(heroBanners) ? heroBanners : [],
            promoBanners: Array.isArray(promoBanners) ? promoBanners : [],
            exploreIcons: Array.isArray(exploreIcons) ? exploreIcons : [],
            customization,
            landing,
            zoneId: zoneId ? String(zoneId) : null,
        });
    } catch (error) {
        next(error);
    }
};
