import mongoose from 'mongoose';
import { FoodItem } from '../../admin/models/food.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Inventory reservation for FoodItem.
 *
 * stockQuantity === null/undefined → unlimited (availability-only atomic guard)
 * stockQuantity === number → tracked via atomic $inc (never CHECK→UPDATE for quantity)
 */

function aggregateQuantities(items = []) {
    const map = new Map();
    for (const item of items) {
        const id = String(item?.itemId || '').trim();
        if (!id || !mongoose.Types.ObjectId.isValid(id)) continue;
        const qty = Math.max(1, Number(item.quantity) || 1);
        map.set(id, (map.get(id) || 0) + qty);
    }
    return [...map.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
}

/**
 * Atomically reserve tracked stock. Rolls back prior reservations on failure.
 */
export async function reserveInventoryForItems(items = []) {
    const aggregated = aggregateQuantities(items);
    if (!aggregated.length) return { reserved: [], skippedUnlimited: [] };

    const reserved = [];
    const skippedUnlimited = [];

    try {
        for (const { itemId, quantity } of aggregated) {
            const oid = new mongoose.Types.ObjectId(itemId);

            // Try tracked reservation first (atomic: stockQuantity >= qty)
            const tracked = await FoodItem.findOneAndUpdate(
                {
                    _id: oid,
                    isAvailable: true,
                    stockQuantity: { $type: 'number', $gte: quantity },
                },
                { $inc: { stockQuantity: -quantity } },
                { new: true },
            ).select('_id name stockQuantity isAvailable');

            if (tracked) {
                if (Number(tracked.stockQuantity) <= 0) {
                    await FoodItem.updateOne(
                        { _id: oid, stockQuantity: { $lte: 0 } },
                        { $set: { isAvailable: false } },
                    );
                }
                reserved.push({ itemId, quantity });
                continue;
            }

            // Unlimited path: stockQuantity null + isAvailable true
            const unlimited = await FoodItem.findOneAndUpdate(
                {
                    _id: oid,
                    isAvailable: true,
                    $or: [{ stockQuantity: null }, { stockQuantity: { $exists: false } }],
                },
                { $set: { updatedAt: new Date() } },
                { new: true },
            ).select('_id name');

            if (unlimited) {
                skippedUnlimited.push(itemId);
                continue;
            }

            const meta = await FoodItem.findById(oid).select('name isAvailable stockQuantity').lean();
            const name = meta?.name || 'Item';
            if (!meta) throw new ValidationError('One or more items are unavailable');
            if (meta.isAvailable === false) {
                throw new ValidationError(`${name} is currently unavailable`);
            }
            throw new ValidationError(`${name} is out of stock`);
        }

        return { reserved, skippedUnlimited };
    } catch (err) {
        if (reserved.length) {
            await releaseInventoryForItems(reserved).catch((releaseErr) => {
                logger.error(`Inventory rollback failed: ${releaseErr.message}`);
            });
        }
        throw err;
    }
}

/**
 * Release previously reserved tracked stock.
 */
export async function releaseInventoryForItems(reserved = []) {
    const aggregated = aggregateQuantities(reserved);
    for (const { itemId, quantity } of aggregated) {
        if (!mongoose.Types.ObjectId.isValid(itemId)) continue;
        const oid = new mongoose.Types.ObjectId(itemId);
        const updated = await FoodItem.findOneAndUpdate(
            { _id: oid, stockQuantity: { $type: 'number' } },
            { $inc: { stockQuantity: quantity } },
            { new: true },
        ).select('stockQuantity');
        if (updated && Number(updated.stockQuantity) > 0) {
            await FoodItem.updateOne(
                { _id: oid, stockQuantity: { $gt: 0 } },
                { $set: { isAvailable: true } },
            );
        }
    }
}
