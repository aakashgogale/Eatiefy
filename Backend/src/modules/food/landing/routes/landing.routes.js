import express from 'express';
import { requireDiningEnabled } from '../../dining/middleware/requireDiningEnabled.js';
import { upload } from '../../../../middleware/upload.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../../core/roles/role.middleware.js';
import {
    listHeroBannersController,
    uploadHeroBannersController,
    linkRestaurantsToHeroBannerController,
    deleteHeroBannerController,
    updateHeroBannerOrderController,
    toggleHeroBannerStatusController
} from '../controllers/heroBanner.controller.js';
import {
    listHomePromotionBannersController,
    createHomePromotionBannerController,
    uploadHomePromotionBannersController,
    updateHomePromotionBannerController,
    deleteHomePromotionBannerController,
    toggleHomePromotionBannerStatusController,
    updateHomePromotionBannerOrderController,
    getPublicHomePromotionBannersController
} from '../controllers/homePromotionBanner.controller.js';
import {
    listUnder250BannersController,
    uploadUnder250BannersController,
    deleteUnder250BannerController,
    updateUnder250BannerOrderController,
    toggleUnder250BannerStatusController
} from '../controllers/under250Banner.controller.js';
import {
    listDiningBannersController,
    uploadDiningBannersController,
    deleteDiningBannerController,
    updateDiningBannerOrderController,
    toggleDiningBannerStatusController
} from '../controllers/diningBanner.controller.js';
import {
    getAdminLandingSettingsController,
    updateAdminLandingSettingsController
} from '../controllers/landingSettings.controller.js';
import {
    listExploreMoreController,
    createExploreMoreController,
    updateExploreMoreController,
    deleteExploreMoreController,
    toggleExploreMoreStatusController,
    updateExploreMoreOrderController
} from '../controllers/exploreIcon.controller.js';
import {
    getPublicHeroBannersController,
    getPublicUnder250BannersController,
    getPublicDiningBannersController,
    getPublicExploreIconsController,
    getPublicGourmetController,
    getPublicLandingSettingsController
} from '../controllers/publicLanding.controller.js';
import { detectZonePublicController, listZonesPublicController, listZonesNearbyPublicController } from '../controllers/zonePublic.controller.js';
import {
    reverseGeocodePublicController,
    geocodePlacePublicController,
    nearbyPlacesPublicController,
    textSearchPlacesPublicController,
} from '../controllers/geocodePublic.controller.js';
import { getPublicEnvController } from '../controllers/publicEnv.controller.js';
import {
    listGourmetAdmin,
    createGourmetAdmin,
    deleteGourmetAdmin,
    updateGourmetOrderAdmin,
    toggleGourmetStatusAdmin
} from '../controllers/top10GourmetAdmin.controller.js';
import { getPublicPageController } from '../../admin/controllers/pageContent.controller.js';
import { getPublicReferralSettingsController } from '../controllers/publicReferralSettings.controller.js';

const router = express.Router();

// Every banner / landing management route below changes what every customer sees
// on the home screen; they were left open ("auth temporarily disabled").
const adminOnly = [authMiddleware, requireRoles('ADMIN', 'SUB_ADMIN')];

// Public CMS pages (About + legal). No auth required.
router.get('/pages/:key', getPublicPageController);
// Public referral settings (no auth required).
router.get('/referral-settings', getPublicReferralSettingsController);

// Admin hero banner management
router.get('/hero-banners', ...adminOnly, listHeroBannersController);
router.post(
    '/hero-banners/multiple',
    ...adminOnly,
    upload.array('files'),
    uploadHeroBannersController
);
router.delete('/hero-banners/:id', ...adminOnly, deleteHeroBannerController);
router.patch('/hero-banners/:id/order', ...adminOnly, updateHeroBannerOrderController);
router.patch('/hero-banners/:id/status', ...adminOnly, toggleHeroBannerStatusController);
router.patch('/hero-banners/:id/link-restaurants', ...adminOnly, linkRestaurantsToHeroBannerController);

// Admin under 250 banners
router.get('/hero-banners/under-250', ...adminOnly, listUnder250BannersController);
router.post(
    '/hero-banners/under-250/multiple',
    ...adminOnly,
    upload.array('files'),
    uploadUnder250BannersController
);
router.delete('/hero-banners/under-250/:id', ...adminOnly, deleteUnder250BannerController);
router.patch('/hero-banners/under-250/:id/order', ...adminOnly, updateUnder250BannerOrderController);
router.patch('/hero-banners/under-250/:id/status', ...adminOnly, toggleUnder250BannerStatusController);

// Admin dining banners — gated on the same dining toggle as the rest of the module.
router.get('/hero-banners/dining', ...adminOnly, requireDiningEnabled, listDiningBannersController);
router.post(
    '/hero-banners/dining/multiple',
    ...adminOnly,
    requireDiningEnabled,
    upload.array('files'),
    uploadDiningBannersController
);
router.delete('/hero-banners/dining/:id', ...adminOnly, requireDiningEnabled, deleteDiningBannerController);
router.patch('/hero-banners/dining/:id/order', ...adminOnly, requireDiningEnabled, updateDiningBannerOrderController);
router.patch('/hero-banners/dining/:id/status', ...adminOnly, requireDiningEnabled, toggleDiningBannerStatusController);

// Admin home promotion banners (user home carousel)
router.get('/hero-banners/home-promotion', ...adminOnly, listHomePromotionBannersController);
router.post(
    '/hero-banners/home-promotion',
    ...adminOnly,
    upload.single('file'),
    createHomePromotionBannerController
);
router.post(
    '/hero-banners/home-promotion/multiple',
    ...adminOnly,
    upload.array('files'),
    uploadHomePromotionBannersController
);
router.patch('/hero-banners/home-promotion/:id', ...adminOnly, updateHomePromotionBannerController);
router.delete('/hero-banners/home-promotion/:id', ...adminOnly, deleteHomePromotionBannerController);
router.patch('/hero-banners/home-promotion/:id/status', ...adminOnly, toggleHomePromotionBannerStatusController);
router.patch('/hero-banners/home-promotion/:id/order', ...adminOnly, updateHomePromotionBannerOrderController);

// Admin Explore More (icons)
router.get('/hero-banners/landing/explore-more', ...adminOnly, listExploreMoreController);
router.post(
    '/hero-banners/landing/explore-more',
    ...adminOnly,
    upload.single('image'),
    createExploreMoreController
);
router.delete('/hero-banners/landing/explore-more/:id', ...adminOnly, deleteExploreMoreController);
router.patch('/hero-banners/landing/explore-more/:id/status', ...adminOnly, toggleExploreMoreStatusController);
router.patch('/hero-banners/landing/explore-more/:id/order', ...adminOnly, updateExploreMoreOrderController);
router.patch(
    '/hero-banners/landing/explore-more/:id',
    ...adminOnly,
    upload.single('image'),
    updateExploreMoreController
);

// Admin Gourmet (hero-banners)
router.get('/hero-banners/gourmet', ...adminOnly, listGourmetAdmin);
router.post('/hero-banners/gourmet', ...adminOnly, createGourmetAdmin);
router.delete('/hero-banners/gourmet/:id', ...adminOnly, deleteGourmetAdmin);
router.patch('/hero-banners/gourmet/:id/order', ...adminOnly, updateGourmetOrderAdmin);
router.patch('/hero-banners/gourmet/:id/status', ...adminOnly, toggleGourmetStatusAdmin);

// Public landing endpoints (Food user app)
router.get('/hero-banners/public', getPublicHeroBannersController);
router.get('/hero-banners/under-250/public', getPublicUnder250BannersController);
router.get('/hero-banners/home-promotion/public', getPublicHomePromotionBannersController);
router.get('/home-promotion-banners/public', getPublicHomePromotionBannersController);
router.get('/hero-banners/dining/public', requireDiningEnabled, getPublicDiningBannersController);
router.get('/explore-icons/public', getPublicExploreIconsController);
router.get('/hero-banners/gourmet/public', getPublicGourmetController);
router.get('/landing/settings/public', getPublicLandingSettingsController);
router.get('/zones/detect', detectZonePublicController);
router.get('/zones/nearby', listZonesNearbyPublicController);
router.get('/zones/public', listZonesPublicController);
// Geocode proxies — API key stays on the server
router.get('/geocode/reverse', reverseGeocodePublicController);
router.get('/geocode/place', geocodePlacePublicController);
router.post('/geocode/nearby', nearbyPlacesPublicController);
router.post('/geocode/text-search', textSearchPlacesPublicController);
router.get('/public/env', getPublicEnvController);
// Admin landing settings (old paths used by admin UI)
router.get('/hero-banners/landing/settings', ...adminOnly, getAdminLandingSettingsController);
router.patch('/hero-banners/landing/settings', ...adminOnly, updateAdminLandingSettingsController);

export default router;

