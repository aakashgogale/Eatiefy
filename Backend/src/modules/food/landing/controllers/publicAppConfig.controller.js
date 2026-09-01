/**
 * One request for everything the app shell needs before it can render.
 *
 * The user app used to open with nine separate public GETs — business settings,
 * power scanning, feature flags, fee settings, three banner lists, explore icons and
 * landing settings. None of them depend on each other, all of them are needed before
 * the home screen can paint, and each one costs a CORS preflight plus a round trip on
 * a mobile connection. They are read from the same process and cached the same way,
 * so serving them together is strictly cheaper.
 *
 * The individual routes stay exactly as they were: other clients (and the admin app)
 * still use them, and both paths call the same loaders, so the payloads cannot drift.
 */
import {
    loadBusinessSettingsPayload,
    loadPowerScanningPayload,
} from '../../admin/controllers/businessSettings.controller.js';
import { loadCustomizationSettings } from '../../admin/controllers/systemConfig.controller.js';
import * as featureSettingsService from '../../admin/services/featureSettings.service.js';
import { getFeeSettings } from '../../admin/services/admin.service.js';
import { getPublicHomePromotionBanners } from '../services/homePromotionBanner.service.js';
import {
    loadPublicExploreIcons,
    loadPublicHeroBanners,
    loadPublicLandingSettings,
    loadPublicTopBanners,
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
            powerScanning,
            featureSettings,
            feeSettings,
            topBanners,
            heroBanners,
            promoBanners,
            exploreIcons,
            customization,
            landing,
        ] = await Promise.all([
            settle('businessSettings', loadBusinessSettingsPayload),
            settle('powerScanning', loadPowerScanningPayload),
            settle('featureSettings', () => featureSettingsService.listFeatureSettings()),
            settle('feeSettings', getFeeSettings),
            settle('topBanners', loadPublicTopBanners),
            settle('heroBanners', loadPublicHeroBanners),
            // Deliberately unfiltered: the home carousel has always shown every active
            // promotion, and zone-filtering it here would silently drop banners.
            settle('promoBanners', () => getPublicHomePromotionBanners()),
            settle('exploreIcons', loadPublicExploreIcons),
            settle('customization', loadCustomizationSettings),
            // Zone-specific, so it is only worth bundling when the client already knows
            // its zone; otherwise the client asks for it separately once detection ends.
            zoneId ? settle('landing', () => loadPublicLandingSettings(zoneId)) : null,
        ]);

        return sendResponse(res, 200, 'App config fetched', {
            businessSettings,
            powerScanning,
            featureSettings: Array.isArray(featureSettings) ? featureSettings : [],
            feeSettings: feeSettings?.feeSettings ?? null,
            topBanners: Array.isArray(topBanners) ? topBanners : [],
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
