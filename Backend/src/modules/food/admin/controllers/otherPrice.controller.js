import * as otherPriceService from '../services/otherPrice.service.js';

export async function getPricingSummary(req, res, next) {
  try {
    const data = await otherPriceService.getPricingManagementSummary(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function listPricingRules(req, res, next) {
  try {
    const data = await otherPriceService.listPricingRules(req.query || {});
    res.json({ success: true, data: { rules: data } });
  } catch (error) {
    next(error);
  }
}

export async function upsertPricingRule(req, res, next) {
  try {
    const rule = await otherPriceService.upsertPricingRule(req.body || {}, req.user);
    res.json({ success: true, data: { rule }, message: 'Pricing rule saved' });
  } catch (error) {
    next(error);
  }
}

export async function bulkUpsertRestaurantPricingRules(req, res, next) {
  try {
    const result = await otherPriceService.bulkUpsertRestaurantPricingRules(
      req.body || {},
      req.user,
    );
    res.json({
      success: true,
      data: result,
      message: `Pricing updated successfully. ${result.updated} restaurants updated.`,
    });
  } catch (error) {
    next(error);
  }
}

export async function bulkUpsertMenuItemPricingRules(req, res, next) {
  try {
    const result = await otherPriceService.bulkUpsertMenuItemPricingRules(
      req.body || {},
      req.user,
    );
    res.json({
      success: true,
      data: result,
      message: `Pricing updated successfully. ${result.updated} menu items updated.`,
    });
  } catch (error) {
    next(error);
  }
}

export async function deletePricingRule(req, res, next) {
  try {
    await otherPriceService.deletePricingRule(req.params.id, req.user);
    res.json({ success: true, message: 'Pricing rule deleted' });
  } catch (error) {
    next(error);
  }
}

export async function previewPricing(req, res, next) {
  try {
    const basePrice = Number(req.body?.basePrice);
    const type = String(req.body?.type || '').toUpperCase();
    const value = Number(req.body?.value);
    const result = otherPriceService.previewOtherPrice(basePrice, type, value);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function listPricingAudits(req, res, next) {
  try {
    const data = await otherPriceService.listPricingAudits(req.query || {});
    res.json({ success: true, data: { audits: data } });
  } catch (error) {
    next(error);
  }
}
