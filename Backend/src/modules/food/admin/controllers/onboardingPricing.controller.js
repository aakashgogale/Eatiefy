import * as service from '../services/onboardingPricingAdmin.service.js';

const ok = (res, message, data, status = 200) =>
    res.status(status).json({ success: true, message, data });

export async function getBootstrap(req, res, next) {
    try {
        ok(res, 'Onboarding pricing options fetched', await service.getOnboardingPricingBootstrap());
    } catch (error) {
        next(error);
    }
}

export async function getPricingRules(req, res, next) {
    try {
        ok(res, 'Onboarding pricing rules fetched', await service.listOnboardingPricingRules(req.query || {}));
    } catch (error) {
        next(error);
    }
}

export async function savePricingRule(req, res, next) {
    try {
        const rule = await service.upsertOnboardingPricingRule(req.body || {}, req.user?.userId);
        ok(res, 'Onboarding pricing rule saved', { rule }, req.body?.id ? 200 : 201);
    } catch (error) {
        next(error);
    }
}

export async function updatePricingRule(req, res, next) {
    try {
        const rule = await service.upsertOnboardingPricingRule(
            { ...(req.body || {}), id: req.params.id },
            req.user?.userId
        );
        ok(res, 'Onboarding pricing rule updated', { rule });
    } catch (error) {
        next(error);
    }
}

export async function togglePricingRule(req, res, next) {
    try {
        const rule = await service.setOnboardingPricingRuleStatus(
            req.params.id,
            req.body?.isActive,
            req.user?.userId
        );
        ok(res, 'Onboarding pricing rule status updated', { rule });
    } catch (error) {
        next(error);
    }
}

export async function removePricingRule(req, res, next) {
    try {
        ok(res, 'Onboarding pricing rule deleted', await service.deleteOnboardingPricingRule(req.params.id));
    } catch (error) {
        next(error);
    }
}

export async function getOffers(req, res, next) {
    try {
        ok(res, 'Onboarding offers fetched', await service.listOnboardingOffers(req.query || {}));
    } catch (error) {
        next(error);
    }
}

export async function saveOffer(req, res, next) {
    try {
        const offer = await service.upsertOnboardingOffer(req.body || {}, req.user?.userId);
        ok(res, 'Onboarding offer saved', { offer }, req.body?.id ? 200 : 201);
    } catch (error) {
        next(error);
    }
}

export async function updateOffer(req, res, next) {
    try {
        const offer = await service.upsertOnboardingOffer(
            { ...(req.body || {}), id: req.params.id },
            req.user?.userId
        );
        ok(res, 'Onboarding offer updated', { offer });
    } catch (error) {
        next(error);
    }
}

export async function toggleOffer(req, res, next) {
    try {
        const offer = await service.setOnboardingOfferStatus(req.params.id, req.body?.isActive, req.user?.userId);
        ok(res, 'Onboarding offer status updated', { offer });
    } catch (error) {
        next(error);
    }
}

export async function removeOffer(req, res, next) {
    try {
        ok(res, 'Onboarding offer deleted', await service.deleteOnboardingOffer(req.params.id));
    } catch (error) {
        next(error);
    }
}

export async function getPayments(req, res, next) {
    try {
        ok(res, 'Onboarding payments fetched', await service.listOnboardingPayments(req.query || {}));
    } catch (error) {
        next(error);
    }
}
