import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const CUSTOMIZATION_TOGGLES = [
    {
        key: 'cod_enabled',
        defaultValue: true,
        description: 'Global toggle for COD visibility (Excludes Takeaway)'
    },
    {
        key: 'takeaway_cod_enabled',
        defaultValue: true,
        description: 'Global toggle for takeaway COD visibility'
    },
    {
        key: 'delivery_cod_enabled',
        defaultValue: true,
        description: 'Global toggle for delivery COD visibility'
    },
    {
        key: 'dining_cod_enabled',
        defaultValue: true,
        description: 'Global toggle for dining COD visibility'
    },
    {
        key: 'wallet_payment_enabled',
        defaultValue: true,
        description: 'Global toggle for wallet payment availability'
    },
    {
        key: 'online_payment_enabled',
        defaultValue: true,
        description: 'Global toggle for online payment availability'
    },
    {
        key: 'default_location_enabled',
        defaultValue: false,
        description: 'Enforce default Indore location and disable auto-prompt for new users/guests (App Store mode)'
    },
    {
        key: 'cod_blocking_feature_enabled',
        defaultValue: true,
        description: 'Global toggle to enable/disable the automatic COD blocking feature (blocks COD for users with 4 consecutive COD cancellations)'
    },
    {
        key: 'maintenance_mode_enabled',
        defaultValue: false,
        description: 'When enabled, user / restaurant / delivery apps show Under Maintenance (admin stays available)'
    }
];

async function run() {
    try {
        console.log('Connecting to database...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected.');
        const col = mongoose.connection.db.collection('foodsystemconfigs');

        for (const toggle of CUSTOMIZATION_TOGGLES) {
            const existing = await col.findOne({ key: toggle.key });
            if (!existing) {
                await col.insertOne({
                    key: toggle.key,
                    value: toggle.defaultValue,
                    description: toggle.description,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
                console.log(`Inserted default: ${toggle.key} = ${toggle.defaultValue}`);
            } else if (toggle.key === 'maintenance_mode_enabled' && existing.value === true) {
                // Ensure maintenance mode is disabled
                await col.updateOne(
                    { key: toggle.key },
                    { $set: { value: false, updatedAt: new Date() } }
                );
                console.log(`Reset ${toggle.key} from true -> false`);
            } else {
                console.log(`Existing: ${toggle.key} = ${existing.value}`);
            }
        }

        console.log('Done.');
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

run();
