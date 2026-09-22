import { FoodItem } from '../modules/food/admin/models/food.model.js';
import { FoodAddon } from '../modules/food/restaurant/models/foodAddon.model.js';
import { deleteStoredAsset, extractAssetUrls, resolveStoredFilename } from './storage.service.js';

/*
 * Food images are deleted only when nothing shows them any more.
 *
 * The same file can be referenced from more than one place: a duplicated dish,
 * an add-on reusing a dish photo, or the same URL stored under a different host
 * (relative "/uploads/x", localhost, http - see toPublicAssetUrl). Deleting
 * "the previous image" of one item used to take the file away from every other
 * item that showed it, and the delete endpoint would remove any file for any
 * signed-in caller. Matching is by stored filename, so every URL variant of a
 * file counts as the same reference.
 */

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when a food item or add-on still references the file behind `url`. */
export async function isFoodImageInUse(url) {
    const filename = await resolveStoredFilename(url);
    // Not one of our stored files (external URL) - nothing of ours to protect.
    if (!filename) return false;

    const pattern = new RegExp(`(^|/)${escapeRegex(filename)}([?#].*)?$`);
    const [food, addon] = await Promise.all([
        FoodItem.exists({ image: pattern }),
        FoodAddon.exists({ $or: [{ image: pattern }, { images: pattern }] }),
    ]);
    return Boolean(food || addon);
}

/**
 * Deletes each stored file that no food item or add-on references. Call it
 * AFTER the change that stops referencing the file has been saved, so a failed
 * save never leaves an item pointing at a deleted image.
 */
export async function deleteFoodImagesIfUnused(urls) {
    const list = extractAssetUrls(urls);
    await Promise.all(
        list.map(async (url) => {
            try {
                if (await isFoodImageInUse(url)) return;
                await deleteStoredAsset(url);
            } catch (err) {
                console.error(`Failed to clean up food image ${url}:`, err?.message || err);
            }
        }),
    );
}

/** Previous URLs that the new value no longer contains. */
export const removedAssetUrls = (previous, next) => {
    const curr = new Set(extractAssetUrls(next));
    return extractAssetUrls(previous).filter((url) => !curr.has(url));
};
