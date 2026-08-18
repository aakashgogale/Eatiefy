import { FoodLandingSettings } from '../models/landingSettings.model.js';
import { deleteStoredAsset } from '../../../../services/storage.service.js';

export const getLandingSettings = async (zoneId = null) => {
    let query = zoneId ? { zoneId } : { zoneId: null };
    let doc = await FoodLandingSettings.findOne(query).lean();
    if (!doc) {
        doc = (await FoodLandingSettings.create(query)).toObject();
    }
    return doc;
};

export const updateLandingSettings = async (payload, zoneId = null) => {
    let query = zoneId ? { zoneId } : { zoneId: null };
    const oldDoc = await FoodLandingSettings.findOne(query).lean();

    const doc = await FoodLandingSettings.findOneAndUpdate(query, payload, {
        new: true,
        upsert: true
    }).lean();

    // Drop the previous banner file when the URL was cleared or replaced.
    if (oldDoc && oldDoc.festBannerImageUrl && oldDoc.festBannerImageUrl !== doc.festBannerImageUrl) {
        await deleteStoredAsset(oldDoc.festBannerImageUrl);
    }

    return doc;
};

