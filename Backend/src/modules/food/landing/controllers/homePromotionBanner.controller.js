import * as bannerService from '../services/homePromotionBanner.service.js';

export const listHomePromotionBannersController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        const banners = await bannerService.listHomePromotionBanners(zoneId);
        res.status(200).json({ success: true, banners });
    } catch (error) {
        next(error);
    }
};

export const createHomePromotionBannerController = async (req, res, next) => {
    try {
        const banner = await bannerService.createHomePromotionBanner(req.file, req.body);
        res.status(201).json({ success: true, banner });
    } catch (error) {
        next(error);
    }
};

export const uploadHomePromotionBannersController = async (req, res, next) => {
    try {
        const results = await bannerService.createHomePromotionBannersFromFiles(req.files, req.body);
        const banners = results.filter((r) => r.success).map((r) => r.banner);
        const failed = results.filter((r) => !r.success);
        res.status(201).json({
            success: true,
            banners,
            uploaded: banners.length,
            failed: failed.length,
            errors: failed.map((f) => f.error)
        });
    } catch (error) {
        next(error);
    }
};

export const updateHomePromotionBannerController = async (req, res, next) => {
    try {
        const banner = await bannerService.updateHomePromotionBanner(req.params.id, req.body);
        res.status(200).json({ success: true, banner });
    } catch (error) {
        next(error);
    }
};

export const deleteHomePromotionBannerController = async (req, res, next) => {
    try {
        const result = await bannerService.deleteHomePromotionBanner(req.params.id);
        res.status(200).json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
};

export const toggleHomePromotionBannerStatusController = async (req, res, next) => {
    try {
        const banner = await bannerService.toggleHomePromotionBannerStatus(req.params.id, req.body.isActive);
        res.status(200).json({ success: true, banner });
    } catch (error) {
        next(error);
    }
};

export const updateHomePromotionBannerOrderController = async (req, res, next) => {
    try {
        const banner = await bannerService.updateHomePromotionBannerOrder(req.params.id, req.body.sortOrder);
        res.status(200).json({ success: true, banner });
    } catch (error) {
        next(error);
    }
};

export const getPublicHomePromotionBannersController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        const banners = await bannerService.getPublicHomePromotionBanners(zoneId);
        res.status(200).json({ success: true, banners });
    } catch (error) {
        next(error);
    }
};
