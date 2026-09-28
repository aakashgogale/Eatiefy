import {
    listRestaurantOffers,
    getRestaurantOfferOptions,
    createRestaurantOffer,
    updateRestaurantOffer,
    toggleRestaurantOffer,
    deleteRestaurantOffer,
    listLiveRestaurantOffers
} from '../services/restaurantOffer.service.js';
import {
    validateRestaurantOfferDto,
    validateRestaurantOfferToggleDto,
    validateRestaurantOfferListQuery,
    assertOfferId
} from '../validators/restaurantOffer.validator.js';
import { sendResponse } from '../../../../utils/response.js';

/** GET /food/restaurant/item-offers */
export const listRestaurantOffersController = async (req, res, next) => {
    try {
        const query = validateRestaurantOfferListQuery(req.query);
        const data = await listRestaurantOffers(req.user.userId, query);
        return sendResponse(res, 200, 'Offers fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

/** GET /food/restaurant/item-offers/options */
export const getRestaurantOfferOptionsController = async (req, res, next) => {
    try {
        const data = await getRestaurantOfferOptions(req.user.userId);
        return sendResponse(res, 200, 'Offer options fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

/** POST /food/restaurant/item-offers */
export const createRestaurantOfferController = async (req, res, next) => {
    try {
        const payload = validateRestaurantOfferDto(req.body, { requireFutureEnd: true });
        const offer = await createRestaurantOffer(req.user.userId, payload);
        return sendResponse(res, 201, 'Offer created successfully', { offer });
    } catch (error) {
        next(error);
    }
};

/** PUT /food/restaurant/item-offers/:id — replaces the offer's settings. */
export const updateRestaurantOfferController = async (req, res, next) => {
    try {
        const offerId = assertOfferId(req.params.id);
        const payload = validateRestaurantOfferDto(req.body);
        const offer = await updateRestaurantOffer(req.user.userId, offerId, payload);
        return sendResponse(res, 200, 'Offer updated successfully', { offer });
    } catch (error) {
        next(error);
    }
};

/** PATCH /food/restaurant/item-offers/:id/toggle — body { isActive } optional. */
export const toggleRestaurantOfferController = async (req, res, next) => {
    try {
        const offerId = assertOfferId(req.params.id);
        const { isActive } = validateRestaurantOfferToggleDto(req.body);
        const offer = await toggleRestaurantOffer(req.user.userId, offerId, isActive);
        return sendResponse(res, 200, offer.isActive ? 'Offer turned on' : 'Offer turned off', { offer });
    } catch (error) {
        next(error);
    }
};

/** DELETE /food/restaurant/item-offers/:id */
export const deleteRestaurantOfferController = async (req, res, next) => {
    try {
        const offerId = assertOfferId(req.params.id);
        const data = await deleteRestaurantOffer(req.user.userId, offerId);
        return sendResponse(res, 200, 'Offer deleted successfully', data);
    } catch (error) {
        next(error);
    }
};

/** GET /food/restaurant/item-offers/public/:restaurantId — no auth. */
export const listLiveRestaurantOffersController = async (req, res, next) => {
    try {
        const data = await listLiveRestaurantOffers(req.params.restaurantId);
        return sendResponse(res, 200, 'Offers fetched successfully', data);
    } catch (error) {
        next(error);
    }
};
