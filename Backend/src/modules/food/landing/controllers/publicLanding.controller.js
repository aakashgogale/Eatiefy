import { getPublicGourmetRestaurants } from '../services/gourmet.service.js';
import { getLandingSettings } from '../services/landingSettings.service.js';
import { FoodHeroBanner } from '../models/heroBanner.model.js';
import { FoodUnder250Banner } from '../models/under250Banner.model.js';
import { FoodDiningBanner } from '../models/diningBanner.model.js';
import { FoodExploreIcon } from '../models/exploreIcon.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { sendResponse } from '../../../../utils/response.js';

/** Public hero banners for user home: active only, sorted, with linkedRestaurants populated for click-through */
export const getPublicHeroBannersController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        let query = { isActive: true };
        if (zoneId) query.zoneId = zoneId;
        else query.zoneId = null;

        let docs = await FoodHeroBanner.find(query)
            .sort({ sortOrder: 1, createdAt: -1 })
            .populate({
                path: 'linkedRestaurantIds',
                select: '_id restaurantName slug area city rating cuisines profileImage pureVegRestaurant zoneId',
                model: 'FoodRestaurant'
            })
            .lean();
        
        if (zoneId && docs.length === 0) {
            query.zoneId = null;
            docs = await FoodHeroBanner.find(query)
                .sort({ sortOrder: 1, createdAt: -1 })
                .populate({
                    path: 'linkedRestaurantIds',
                    select: '_id restaurantName slug area city rating cuisines profileImage pureVegRestaurant zoneId',
                    model: 'FoodRestaurant'
                })
                .lean();
        }
        const banners = (docs || []).map((b) => {
            const { linkedRestaurantIds, ...rest } = b;
            return {
                ...rest,
                linkedRestaurants: Array.isArray(linkedRestaurantIds) ? linkedRestaurantIds : [],
                imageUrl: b.imageUrl
            };
        });
        return sendResponse(res, 200, 'Hero banners fetched', { banners });
    } catch (error) {
        next(error);
    }
};

export const getPublicUnder250BannersController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        let query = { isActive: true };
        if (zoneId) query.zoneId = zoneId;
        else query.zoneId = null;

        let docs = await FoodUnder250Banner.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
        if (zoneId && docs.length === 0) {
            query.zoneId = null;
            docs = await FoodUnder250Banner.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
        }
        return sendResponse(res, 200, 'Under 250 banners fetched', { banners: docs });
    } catch (error) {
        next(error);
    }
};

export const getPublicDiningBannersController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        let query = { isActive: true };
        if (zoneId) query.zoneId = zoneId;
        else query.zoneId = null;

        let docs = await FoodDiningBanner.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
        if (zoneId && docs.length === 0) {
            query.zoneId = null;
            docs = await FoodDiningBanner.find(query).sort({ sortOrder: 1, createdAt: -1 }).lean();
        }
        return sendResponse(res, 200, 'Dining banners fetched', { banners: docs });
    } catch (error) {
        next(error);
    }
};

export const getPublicExploreIconsController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        let globalDocs = await FoodExploreIcon.find({ zoneId: null, isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
        let zoneDocs = zoneId ? await FoodExploreIcon.find({ zoneId, isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean() : [];
        
        let docs = [];
        if (!zoneId || zoneDocs.length === 0) {
            docs = globalDocs;
        } else {
            const zoneMap = new Map();
            zoneDocs.forEach(doc => {
                const key = doc.linkType && doc.linkType !== 'custom' ? doc.linkType : doc.label.toLowerCase();
                zoneMap.set(key, doc);
            });
            
            const usedZoneKeys = new Set();
            for (const gDoc of globalDocs) {
                const key = gDoc.linkType && gDoc.linkType !== 'custom' ? gDoc.linkType : gDoc.label.toLowerCase();
                if (zoneMap.has(key)) {
                    docs.push(zoneMap.get(key));
                    usedZoneKeys.add(key);
                } else {
                    docs.push(gDoc);
                }
            }
            
            for (const [key, doc] of zoneMap.entries()) {
                if (!usedZoneKeys.has(key)) {
                    docs.push(doc);
                }
            }
            
            docs.sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
        }
        const items = docs.map(({ targetPath, sortOrder, ...rest }) => ({ ...rest, link: targetPath, order: sortOrder }));
        return sendResponse(res, 200, 'Explore icons fetched', { items });
    } catch (error) {
        next(error);
    }
};


export const getPublicGourmetController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        const docs = await getPublicGourmetRestaurants(zoneId);
        const restaurants = (docs || []).map((d) => ({
            ...(d.restaurant || {}),
            _id: d.restaurant?._id || d.restaurantId,
            priority: d.priority
        })).filter((r) => r && r._id);
        return sendResponse(res, 200, 'Gourmet restaurants fetched', { restaurants });
    } catch (error) {
        next(error);
    }
};

export const getPublicLandingSettingsController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        let settings = await getLandingSettings(zoneId);
        let globalSettings = null;
        
        if (zoneId) {
            globalSettings = await getLandingSettings(null);
            // Merge global settings into zone settings for any missing fields
            settings = {
                ...globalSettings,
                ...settings,
                exploreMoreHeading: settings.exploreMoreHeading && settings.exploreMoreHeading !== 'Explore more' ? settings.exploreMoreHeading : globalSettings.exploreMoreHeading,
                recommendedRestaurantIds: settings.recommendedRestaurantIds && settings.recommendedRestaurantIds.length > 0 ? settings.recommendedRestaurantIds : globalSettings.recommendedRestaurantIds,
                festBannerImageUrl: settings.festBannerImageUrl ? settings.festBannerImageUrl : globalSettings.festBannerImageUrl,
                festBannerTopColor: settings.festBannerTopColor ? settings.festBannerTopColor : globalSettings.festBannerTopColor,
            };
        }

        const ids = settings?.recommendedRestaurantIds || [];
        let recommendedRestaurants = [];
        if (Array.isArray(ids) && ids.length > 0) {
            recommendedRestaurants = await FoodRestaurant.find({ _id: { $in: ids }, status: 'approved' })
                .select('restaurantName area city profileImage coverImages menuImages slug rating cuisines pureVegRestaurant isAcceptingOrders isActive openingTime closingTime openDays zoneId')
                .lean();
        }
        const payload = {
            ...settings,
            recommendedRestaurantIds: undefined,
            recommendedRestaurants
        };
        return sendResponse(res, 200, 'Landing settings fetched', payload);
    } catch (error) {
        next(error);
    }
};

