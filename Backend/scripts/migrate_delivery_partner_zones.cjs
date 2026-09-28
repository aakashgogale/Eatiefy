const mongoose = require('mongoose');

async function migrate() {
  // Never hardcode the connection string: it lands in git history.
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Set MONGODB_URI (or MONGO_URI) in Backend/.env');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const zones = await db.collection('food_zones').find({}).toArray();
  const indoreZone = zones.find(z => z.name.toLowerCase() === 'indore');
  const ratlamZone = zones.find(z => z.name.toLowerCase() === 'ratlam');
  const ujjainZone = zones.find(z => z.name.toLowerCase() === 'ujjain');

  console.log('Indore Zone ID:', indoreZone?._id?.toString());
  console.log('Ratlam Zone ID:', ratlamZone?._id?.toString());
  console.log('Ujjain Zone ID:', ujjainZone?._id?.toString());

  if (!indoreZone || !ratlamZone) {
    console.error('Missing required zones in DB');
    process.exit(1);
  }

  const partners = await db.collection('food_delivery_partners').find({}).toArray();
  console.log(`Total partners in DB: ${partners.length}`);

  let updatedIndore = 0;
  let updatedRatlam = 0;
  let updatedUjjain = 0;
  let skipped = 0;

  for (const p of partners) {
    // City field first: an Indore address can contain "Ratlam Kothi" (a locality),
    // which used to send Indore riders to the Ratlam zone.
    const cityText = String(p.city || '').toLowerCase();
    const text = cityText && /ratlam|ujjain|indore/.test(cityText)
      ? cityText
      : [p.address, p.state].filter(Boolean).join(' ').toLowerCase().replace(/ratlam\s*kothi/g, '');

    let targetZoneId = null;
    let zoneName = '';

    if (text.includes('ratlam')) {
      targetZoneId = ratlamZone._id;
      zoneName = 'Ratlam';
      updatedRatlam++;
    } else if (text.includes('ujjain')) {
      targetZoneId = ujjainZone ? ujjainZone._id : null;
      zoneName = 'Ujjain';
      if (targetZoneId) updatedUjjain++;
    } else if (text.includes('indore') || text.includes('vijay nagar') || text.includes('panchsheel') || text.includes('mahunaka')) {
      targetZoneId = indoreZone._id;
      zoneName = 'Indore';
      updatedIndore++;
    } else {
      skipped++;
    }

    if (targetZoneId) {
      await db.collection('food_delivery_partners').updateOne(
        { _id: p._id },
        { $set: { zoneId: targetZoneId } }
      );
      console.log(`Mapped partner "${p.name}" (${p.phone}, city: "${p.city}") -> Zone: ${zoneName} (${targetZoneId})`);
    } else {
      console.log(`Skipped non-target partner "${p.name}" (${p.phone}, city: "${p.city}")`);
    }
  }

  console.log(`\nMigration completed:`);
  console.log(`Indore partners mapped: ${updatedIndore}`);
  console.log(`Ratlam partners mapped: ${updatedRatlam}`);
  console.log(`Ujjain partners mapped: ${updatedUjjain}`);
  console.log(`Skipped/unmapped (other cities/test): ${skipped}`);

  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
