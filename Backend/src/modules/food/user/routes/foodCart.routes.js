import express from 'express';
import {
  getFoodCartController,
  addFoodCartItemController,
  updateFoodCartItemController,
  removeFoodCartItemController,
  clearFoodCartController,
  setFoodCartCouponController,
} from '../controllers/foodCart.controller.js';
import { privateRateLimiter } from '../../../../middleware/rateLimit.js';

const router = express.Router();

router.get('/', getFoodCartController);
router.post('/items', privateRateLimiter, addFoodCartItemController);
router.patch('/items/:id', privateRateLimiter, updateFoodCartItemController);
router.delete('/items/:id', privateRateLimiter, removeFoodCartItemController);
router.delete('/clear', privateRateLimiter, clearFoodCartController);
router.put('/coupon', privateRateLimiter, setFoodCartCouponController);

export default router;
