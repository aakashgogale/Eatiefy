import express from 'express';
import { searchController, listAdminCategoriesController } from '../controllers/search.controller.js';
import { cacheResponse } from '../../../../middleware/cache.js';

const router = express.Router();

/**
 * Unified Search Endpoint
 * GET /api/v1/food/search/unified
 * Cached per query string (zone/category/lat/lng/q). Invalidated on menu/food/category changes.
 */
router.get('/unified', cacheResponse(120, 'search'), searchController);

/**
 * Admin Categories Only Endpoint (to avoid restaurant-created ones as requested)
 * GET /api/v1/food/search/categories/admin
 */
router.get('/categories/admin', cacheResponse(300, 'categories'), listAdminCategoriesController);

export default router;
