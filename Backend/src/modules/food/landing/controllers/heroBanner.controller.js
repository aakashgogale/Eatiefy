import {
    listHeroBanners,
    createHeroBannersFromFiles,
    linkRestaurantsToHeroBanner,
    deleteHeroBanner,
    updateHeroBannerOrder,
    toggleHeroBannerStatus
} from '../services/heroBanner.service.js';
import { sendResponse } from '../../../../utils/response.js';
import { ValidationError } from '../../../../core/auth/errors.js';

export const listHeroBannersController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        const data = await listHeroBanners(zoneId);
        // Wrap in { banners } to match LandingPageManagement.jsx expectations
        return sendResponse(res, 200, 'Hero banners fetched successfully', { banners: data });
    } catch (error) {
        next(error);
    }
};

export const uploadHeroBannersController = async (req, res, next) => {
    try {
        if (!req.files || !req.files.length) {
            throw new ValidationError('No files uploaded');
        }

        const meta = {
            title: req.body.title,
            ctaText: req.body.ctaText,
            ctaLink: req.body.ctaLink,
            zoneId: req.body.zoneId
        };

        const results = await createHeroBannersFromFiles(req.files, meta);
        const banners = results.filter((r) => r.success).map((r) => r.banner);
        const errors = results.filter((r) => !r.success).map((r) => r.error);

        return sendResponse(res, 201, 'Hero banners uploaded', { banners, errors, results });
    } catch (error) {
        next(error);
    }
};

export const linkRestaurantsToHeroBannerController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { restaurantIds } = req.body;
        if (!id || !Array.isArray(restaurantIds)) {
            throw new ValidationError('id and restaurantIds array are required');
        }

        const updated = await linkRestaurantsToHeroBanner(id, restaurantIds);
        if (!updated) {
            return sendResponse(res, 404, 'Hero banner not found');
        }
        return sendResponse(res, 200, 'Restaurants linked to banner successfully', { banner: updated });
    } catch (error) {
        next(error);
    }
};

export const deleteHeroBannerController = async (req, res, next) => {
    try {
        const { id } = req.params;
        if (!id) {
            throw new ValidationError('Banner id is required');
        }
        const result = await deleteHeroBanner(id);
        return sendResponse(res, 200, result.deleted ? 'Hero banner deleted' : 'Hero banner not found', result);
    } catch (error) {
        next(error);
    }
};

export const updateHeroBannerOrderController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { sortOrder } = req.body;
        if (!id || typeof sortOrder !== 'number') {
            throw new ValidationError('id and numeric sortOrder are required');
        }
        const updated = await updateHeroBannerOrder(id, sortOrder);
        return sendResponse(res, 200, 'Hero banner order updated', updated);
    } catch (error) {
        next(error);
    }
};

export const toggleHeroBannerStatusController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body || {};
        if (!id) {
            throw new ValidationError('Banner id is required');
        }
        const updated = await toggleHeroBannerStatus(id, isActive);
        if (!updated) {
            return sendResponse(res, 404, 'Hero banner not found');
        }
        return sendResponse(res, 200, 'Hero banner status updated', updated);
    } catch (error) {
        next(error);
    }
};

