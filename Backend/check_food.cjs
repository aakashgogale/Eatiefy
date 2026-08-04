const mongoose = require('mongoose');

async function checkFood() {
  await mongoose.connect('mongodb+srv://Eatiefy:Eatiefy%40123@eatiefycluster.gcdsjg0.mongodb.net/eatiefydb?retryWrites=true&w=majority', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const db = mongoose.connection.db;
  const foods = await db.collection('foods').find({ name: /Biryani|Tart|Salmon/i }).toArray();
  console.log(JSON.stringify(foods, null, 2));

  process.exit(0);
}

checkFood().catch(console.error);
