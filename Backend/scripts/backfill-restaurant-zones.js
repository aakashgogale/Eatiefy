/**
 * Re-attach restaurants to the zone that actually contains their map pin.
 *
 * Every public listing (restaurants, public foods, search) filters on `zoneId`, so a
 * restaurant pointing at a zone that was renamed, deactivated or deleted disappears
 * from the user app entirely — its menu is fine, it is simply never queried. This
 * happens whenever zones are rebuilt, because the old zone ids stay on the documents.
 *
 * The map pin is the source of truth here: for each restaurant whose zone is missing
 * or no longer active, the point is tested against every active zone polygon and the
 * match is written back. Restaurants that fall outside all zones are reported, not
 * guessed at — they need a zone to be drawn for their area first.
 *
 * Usage:
 *   node scripts/backfill-restaurant-zones.js --dry-run   # report only
 *   node scripts/backfill-restaurant-zones.js             # apply
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { FoodRestaurant } from '../src/modules/food/restaurant/models/restaurant.model.js';
import { FoodZone } from '../src/modules/food/admin/models/zone.model.js';
import { isPointInZonePolygon } from '../src/modules/food/utils/zoneGeo.js';

dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');

const toFinite = (value) => {
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(n) ? n : null;
};

const readCoordinates = (restaurant) => {
    const location = restaurant?.location || {};
    const lat = toFinite(location.latitude ?? location?.coordinates?.[1]);
    const lng = toFinite(location.longitude ?? location?.coordinates?.[0]);
    return lat === null || lng === null ? null : { lat, lng };
};

async function run() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI is not set.');
        process.exit(1);
    }

    await mongoose.connect(uri);

    try {
        const zones = await FoodZone.find({ isActive: true })
            .select('_id name zoneName coordinates')
            .lean();

        if (!zones.length) {
            console.error('No active zones exist — create a zone before running this.');
            return;
        }

        console.log(`Active zones: ${zones.map((z) => z.name || z.zoneName).join(', ')}`);

        const activeZoneIds = new Set(zones.map((zone) => String(zone._id)));
        const restaurants = await FoodRestaurant.find({})
            .select('_id restaurantName status zoneId location')
            .lean();

        const updated = [];
        const unresolved = [];
        let alreadyCorrect = 0;

        for (const restaurant of restaurants) {
            const currentZoneId = restaurant.zoneId ? String(restaurant.zoneId) : '';
            if (currentZoneId && activeZoneIds.has(currentZoneId)) {
                alreadyCorrect += 1;
                continue;
            }

            const point = readCoordinates(restaurant);
            const matchedZone = point
                ? zones.find((zone) => isPointInZonePolygon(point.lat, point.lng, zone.coordinates))
                : null;

            if (!matchedZone) {
                unresolved.push({
                    name: restaurant.restaurantName,
                    status: restaurant.status,
                    reason: point ? 'pin is outside every active zone' : 'no coordinates saved',
                });
                continue;
            }

            if (!DRY_RUN) {
                await FoodRestaurant.updateOne(
                    { _id: restaurant._id },
                    { $set: { zoneId: matchedZone._id } },
                );
            }

            updated.push({
                name: restaurant.restaurantName,
                status: restaurant.status,
                from: currentZoneId || '(none)',
                to: `${matchedZone.name || matchedZone.zoneName} (${matchedZone._id})`,
            });
        }

        console.log(`\nAlready on an active zone: ${alreadyCorrect}`);
        console.log(`${DRY_RUN ? 'Would reassign' : 'Reassigned'}: ${updated.length}`);
        updated.forEach((row) => {
            console.log(`  ${row.status.padEnd(9)} ${row.name} — ${row.from} -> ${row.to}`);
        });

        if (unresolved.length) {
            console.log(`\nLeft unassigned (need a zone covering their area): ${unresolved.length}`);
            unresolved.forEach((row) => {
                console.log(`  ${String(row.status).padEnd(9)} ${row.name} — ${row.reason}`);
            });
        }

        if (DRY_RUN) console.log('\nDry run — nothing was written.');
    } catch (err) {
        console.error('Backfill failed:', err);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}

run();
