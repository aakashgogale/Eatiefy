import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../../core/roles/role.middleware.js';
import {
    listHeroBannersController,
    uploadHeroBannersController,
    deleteHeroBannerController,
    updateHeroBannerOrderController,
    toggleHeroBannerStatusController
} from '../controllers/heroBanner.controller.js';
import {
    listTopBannersController,
    uploadTopBannersController,
    deleteTopBannerController,
    updateTopBannerOrderController,
    toggleTopBannerStatusController
} from '../controllers/topBanner.controller.js';
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
    listHomePromotionBannersController,
    createHomePromotionBannerController,
    updateHomePromotionBannerController,
    deleteHomePromotionBannerController,
    toggleHomePromotionBannerStatusController,
    updateHomePromotionBannerOrderController
} from '../controllers/homePromotionBanner.controller.js';
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
    getPublicHomePromotionBannersController,
    getPublicGourmetController,
    getPublicLandingSettingsController,
    getPublicTopBannersController
} from '../controllers/publicLanding.controller.js';
import { detectZonePublicController, listZonesPublicController, listZonesNearbyPublicController } from '../controllers/zonePublic.controller.js';
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
const requireAdmin = [authMiddleware, requireRoles('ADMIN')];

// Public CMS pages (About + legal). No auth required.
router.get('/pages/:key', getPublicPageController);
router.get('/referral-settings', getPublicReferralSettingsController);

// Public landing endpoints — before admin CMS routes
router.get('/hero-banners/public', getPublicHeroBannersController);
router.get('/top-banners/public', getPublicTopBannersController);
router.get('/hero-banners/under-250/public', getPublicUnder250BannersController);
router.get('/hero-banners/dining/public', getPublicDiningBannersController);
router.get('/explore-icons/public', getPublicExploreIconsController);
router.get('/hero-banners/home-promotion/public', getPublicHomePromotionBannersController);
router.get('/home-promotion-banners/public', getPublicHomePromotionBannersController);
router.get('/hero-banners/gourmet/public', getPublicGourmetController);
router.get('/landing/settings/public', getPublicLandingSettingsController);
router.get('/zones/detect', detectZonePublicController);
router.get('/zones/nearby', listZonesNearbyPublicController);
router.get('/zones/public', listZonesPublicController);

// Admin CMS (authenticated ADMIN only)
router.get('/hero-banners', ...requireAdmin, listHeroBannersController);
router.post('/hero-banners/multiple', ...requireAdmin, upload.array('files'), uploadHeroBannersController);
router.delete('/hero-banners/:id', ...requireAdmin, deleteHeroBannerController);
router.patch('/hero-banners/:id/order', ...requireAdmin, updateHeroBannerOrderController);
router.patch('/hero-banners/:id/status', ...requireAdmin, toggleHeroBannerStatusController);

router.get('/top-banners', ...requireAdmin, listTopBannersController);
router.post('/top-banners/multiple', ...requireAdmin, upload.array('files'), uploadTopBannersController);
router.delete('/top-banners/:id', ...requireAdmin, deleteTopBannerController);
router.patch('/top-banners/:id/order', ...requireAdmin, updateTopBannerOrderController);
router.patch('/top-banners/:id/status', ...requireAdmin, toggleTopBannerStatusController);

router.get('/hero-banners/under-250', ...requireAdmin, listUnder250BannersController);
router.post('/hero-banners/under-250/multiple', ...requireAdmin, upload.array('files'), uploadUnder250BannersController);
router.delete('/hero-banners/under-250/:id', ...requireAdmin, deleteUnder250BannerController);
router.patch('/hero-banners/under-250/:id/order', ...requireAdmin, updateUnder250BannerOrderController);
router.patch('/hero-banners/under-250/:id/status', ...requireAdmin, toggleUnder250BannerStatusController);

router.get('/hero-banners/dining', ...requireAdmin, listDiningBannersController);
router.post('/hero-banners/dining/multiple', ...requireAdmin, upload.array('files'), uploadDiningBannersController);
router.delete('/hero-banners/dining/:id', ...requireAdmin, deleteDiningBannerController);
router.patch('/hero-banners/dining/:id/order', ...requireAdmin, updateDiningBannerOrderController);
router.patch('/hero-banners/dining/:id/status', ...requireAdmin, toggleDiningBannerStatusController);

router.get('/hero-banners/home-promotion', ...requireAdmin, listHomePromotionBannersController);
router.post('/hero-banners/home-promotion', ...requireAdmin, upload.single('file'), createHomePromotionBannerController);
router.patch('/hero-banners/home-promotion/:id', ...requireAdmin, updateHomePromotionBannerController);
router.delete('/hero-banners/home-promotion/:id', ...requireAdmin, deleteHomePromotionBannerController);
router.patch('/hero-banners/home-promotion/:id/status', ...requireAdmin, toggleHomePromotionBannerStatusController);
router.patch('/hero-banners/home-promotion/:id/order', ...requireAdmin, updateHomePromotionBannerOrderController);

router.get('/hero-banners/landing/explore-more', ...requireAdmin, listExploreMoreController);
router.post('/hero-banners/landing/explore-more', ...requireAdmin, upload.single('image'), createExploreMoreController);
router.delete('/hero-banners/landing/explore-more/:id', ...requireAdmin, deleteExploreMoreController);
router.patch('/hero-banners/landing/explore-more/:id/status', ...requireAdmin, toggleExploreMoreStatusController);
router.patch('/hero-banners/landing/explore-more/:id/order', ...requireAdmin, updateExploreMoreOrderController);
router.patch('/hero-banners/landing/explore-more/:id', ...requireAdmin, upload.single('image'), updateExploreMoreController);

router.get('/hero-banners/gourmet', ...requireAdmin, listGourmetAdmin);
router.post('/hero-banners/gourmet', ...requireAdmin, createGourmetAdmin);
router.delete('/hero-banners/gourmet/:id', ...requireAdmin, deleteGourmetAdmin);
router.patch('/hero-banners/gourmet/:id/order', ...requireAdmin, updateGourmetOrderAdmin);
router.patch('/hero-banners/gourmet/:id/status', ...requireAdmin, toggleGourmetStatusAdmin);

router.get('/hero-banners/landing/settings', ...requireAdmin, getAdminLandingSettingsController);
router.patch('/hero-banners/landing/settings', ...requireAdmin, updateAdminLandingSettingsController);

export default router;
