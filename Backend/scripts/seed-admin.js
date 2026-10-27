/**
 * Create (or update) a super admin in food_admins:
 *
 *   npm run seed:admin -- --email=admin@eatiefy.com --password=Secret@123 [--name="Super Admin"] [--phone=9999999999]
 *
 * ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME / ADMIN_PHONE env vars work too.
 * An existing admin with that email gets the new password, role ADMIN and is re-activated.
 */
import { connectDB, disconnectDB } from '../src/config/db.js';
import { FoodAdmin } from '../src/core/admin/admin.model.js';

const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
        const [key, ...rest] = arg.replace(/^--/, '').split('=');
        return [key, rest.join('=') || true];
    })
);

// PowerShell strips the bare `--`, so npm swallows the flags and exposes them as npm_config_<key>.
const arg = (key) => args[key] || process.env[`npm_config_${key}`] || process.env[`ADMIN_${key.toUpperCase()}`] || '';

const email = String(arg('email')).trim().toLowerCase();
const password = String(arg('password'));
const name = String(arg('name') || 'Super Admin').trim();
const phone = String(arg('phone')).trim();

if (!email || !password) {
    console.error('Usage: npm run seed:admin -- --email=<email> --password=<password> [--name=<name>] [--phone=<phone>]');
    process.exit(1);
}
if (password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
}

await connectDB();
try {
    let admin = await FoodAdmin.findOne({ email });
    const created = !admin;
    if (!admin) admin = new FoodAdmin({ email });

    // Plain password: the model's pre-save hook hashes it.
    admin.password = password;
    admin.name = name;
    if (phone) admin.phone = phone;
    admin.role = 'ADMIN';
    admin.isActive = true;
    admin.servicesAccess = ['food'];
    await admin.save();

    console.log(`${created ? 'Created' : 'Updated'} admin ${admin.email} (${admin._id})`);
} catch (error) {
    console.error(`Seeding admin failed: ${error.message}`);
    process.exitCode = 1;
} finally {
    await disconnectDB();
}
