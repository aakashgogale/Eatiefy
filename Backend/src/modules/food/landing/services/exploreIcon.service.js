import { FoodExploreIcon } from '../models/exploreIcon.model.js';
import { storeImageBuffer, deleteStoredAsset } from '../../../../services/storage.service.js';

const ICON_FOLDER = 'food/explore-icons';
const ICON_MAX_WIDTH = 400;

/**
 * List all explore icons (admin). Sorted by sortOrder.
 */
export const listExploreIcons = async (zoneId = null) => {
    let query = zoneId ? { zoneId } : { zoneId: null };
    return FoodExploreIcon.find(query)
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();
};

/**
 * Get next sortOrder for new item.
 */
const getNextSortOrder = async () => {
    const last = await FoodExploreIcon.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
    return (last?.sortOrder ?? -1) + 1;
};

/**
 * Store an icon on disk and return { secure_url, public_id }.
 */
const uploadIcon = async (buffer) => {
    const { secure_url, public_id } = await storeImageBuffer(buffer, ICON_FOLDER, {
        maxWidth: ICON_MAX_WIDTH
    });
    return { secure_url, public_id };
};

/**
 * Create one explore icon from uploaded file + label + link.
 * @param {{ buffer: Buffer }} file - multer file (req.file)
 * @param {{ label: string, link?: string }} meta
 */
export const createExploreIcon = async (file, meta) => {
    if (!file?.buffer) {
        throw new Error('Image file is required');
    }
    const label = (meta?.label || '').trim();
    if (!label) {
        throw new Error('Label is required');
    }

    const { secure_url, public_id } = await uploadIcon(file.buffer);
    const sortOrder = await getNextSortOrder();

    // Infer linkType from label for known types
    let linkType = 'custom';
    const lowerLabel = label.toLowerCase();
    if (lowerLabel === 'offers') linkType = 'offers';
    else if (lowerLabel === 'gourmet') linkType = 'gourmet';
    else if (lowerLabel === 'collections') linkType = 'collections';
    else if (lowerLabel === 'under 250' || lowerLabel === 'under-250') linkType = 'under-250';

    const doc = await FoodExploreIcon.create({
        label,
        iconUrl: secure_url,
        publicId: public_id,
        linkType,
        targetPath: (meta?.link || '').trim() || undefined,
        sortOrder,
        zoneId: meta?.zoneId || null,
        isActive: true
    });

    return doc.toObject();
};

/**
 * Update explore icon: optional new image, optional label/link.
 * @param {string} id
 * @param {{ file?: { buffer: Buffer }, label?: string, link?: string }} payload
 */
export const updateExploreIcon = async (id, payload) => {
    const doc = await FoodExploreIcon.findById(id);
    if (!doc) {
        return null;
    }

    const updates = {};

    if (payload?.file?.buffer) {
        const { secure_url, public_id } = await uploadIcon(payload.file.buffer);
        await deleteStoredAsset(doc.iconUrl || doc.publicId);
        updates.iconUrl = secure_url;
        updates.publicId = public_id;
    }

    if (payload?.label !== undefined) {
        const label = String(payload.label).trim();
        updates.label = label;
        
        // Infer linkType from label for known types
        const lowerLabel = label.toLowerCase();
        if (lowerLabel === 'offers') updates.linkType = 'offers';
        else if (lowerLabel === 'gourmet') updates.linkType = 'gourmet';
        else if (lowerLabel === 'collections') updates.linkType = 'collections';
        else if (lowerLabel === 'under 250' || lowerLabel === 'under-250') updates.linkType = 'under-250';
        else updates.linkType = 'custom';
    }
    if (payload?.link !== undefined) {
        updates.targetPath = String(payload.link).trim() || undefined;
    }

    if (Object.keys(updates).length === 0) {
        return doc.toObject();
    }

    const updated = await FoodExploreIcon.findByIdAndUpdate(id, updates, { new: true }).lean();
    return updated;
};

/**
 * Delete explore icon and its stored file.
 */
export const deleteExploreIcon = async (id) => {
    const doc = await FoodExploreIcon.findById(id);
    if (!doc) {
        return { deleted: false };
    }
    await deleteStoredAsset(doc.iconUrl || doc.publicId);
    await doc.deleteOne();
    return { deleted: true };
};

/**
 * Toggle isActive. Returns updated doc or null.
 */
export const toggleExploreIconStatus = async (id) => {
    const doc = await FoodExploreIcon.findById(id);
    if (!doc) return null;
    const isActive = !doc.isActive;
    const updated = await FoodExploreIcon.findByIdAndUpdate(id, { isActive }, { new: true }).lean();
    return updated;
};

/**
 * Update sortOrder. Body uses "order" for frontend compatibility.
 */
export const updateExploreIconOrder = async (id, order) => {
    const num = Number(order);
    if (Number.isNaN(num)) return null;
    const updated = await FoodExploreIcon.findByIdAndUpdate(id, { sortOrder: num }, { new: true }).lean();
    return updated;
};
