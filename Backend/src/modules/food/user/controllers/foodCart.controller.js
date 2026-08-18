import { sendResponse } from '../../../../utils/response.js';
import * as foodCartService from '../services/foodCart.service.js';

export async function getFoodCartController(req, res, next) {
  try {
    const userId = req.user?.userId;
    const cart = await foodCartService.getFoodCart(userId);
    return sendResponse(res, 200, 'Cart fetched', { cart });
  } catch (err) {
    next(err);
  }
}

export async function addFoodCartItemController(req, res, next) {
  try {
    const userId = req.user?.userId;
    const cart = await foodCartService.addFoodCartItem(userId, req.body || {});
    return sendResponse(res, 200, 'Item added to cart', { cart });
  } catch (err) {
    next(err);
  }
}

export async function updateFoodCartItemController(req, res, next) {
  try {
    const userId = req.user?.userId;
    const cart = await foodCartService.updateFoodCartItem(
      userId,
      req.params.id,
      req.body || {}
    );
    return sendResponse(res, 200, 'Cart item updated', { cart });
  } catch (err) {
    next(err);
  }
}

export async function removeFoodCartItemController(req, res, next) {
  try {
    const userId = req.user?.userId;
    const cart = await foodCartService.removeFoodCartItem(userId, req.params.id);
    return sendResponse(res, 200, 'Cart item removed', { cart });
  } catch (err) {
    next(err);
  }
}

export async function clearFoodCartController(req, res, next) {
  try {
    const userId = req.user?.userId;
    const cart = await foodCartService.clearFoodCart(userId);
    return sendResponse(res, 200, 'Cart cleared', { cart });
  } catch (err) {
    next(err);
  }
}

export async function setFoodCartCouponController(req, res, next) {
  try {
    const userId = req.user?.userId;
    const cart = await foodCartService.setFoodCartCoupon(
      userId,
      req.body?.couponCode || ''
    );
    return sendResponse(res, 200, 'Cart coupon updated', { cart });
  } catch (err) {
    next(err);
  }
}
