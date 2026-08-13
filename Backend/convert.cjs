const sharp = require('sharp');
const path = require('path');

const baseInput = '../Frontend/public';
const baseOutput = '../Frontend/src/modules/Food/assets';

const files = [
    { in: 'UsserApp.png', out: 'user-app-logo.webp' },
    { in: 'RestaurenttPartner.png', out: 'restaurant-partner-logo.webp' },
    { in: 'DeliveryPartner.png', out: 'delivery-partner-logo.webp' }
];

async function convert() {
    for (const f of files) {
        const inPath = path.join(__dirname, baseInput, f.in);
        const outPath = path.join(__dirname, baseOutput, f.out);
        await sharp(inPath)
            .resize({ width: 400, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(outPath);
        console.log(`Converted ${f.in} to ${f.out}`);
    }
}

convert().catch(console.error);
