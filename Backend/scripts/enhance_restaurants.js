import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

const diverseRestaurants = [
  {
    name: 'Shreemaya Celebrity',
    city: 'Indore',
    area: 'RNT Marg, Indore',
    lat: 22.7177,
    lng: 75.8682,
    cuisines: ['North Indian', 'Continental', 'Chinese', 'Desserts'],
    rating: 4.8,
    ratingCount: 1450,
    costForTwo: 600,
    estimatedDeliveryTimeMinutes: 25,
    pureVeg: false,
    offer: 'Flat 15% OFF on Gourmet Platters',
    coverImage: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&auto=format&fit=crop&q=80',
  },
  {
    name: 'ZeroBalence Cafe',
    city: 'Indore',
    area: 'Vijay Nagar, Indore',
    lat: 22.7533,
    lng: 75.8937,
    cuisines: ['Cafe', 'Fast Food', 'Beverages', 'Italian'],
    rating: 4.6,
    ratingCount: 340,
    costForTwo: 350,
    estimatedDeliveryTimeMinutes: 25,
    pureVeg: true,
    offer: 'Flat 20% OFF above ₹199',
    coverImage: 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=800&auto=format&fit=crop&q=80',
  },
  {
    name: 'Guru Kripa Restaurant',
    city: 'Indore',
    area: 'Sarwate Bus Stand, Indore',
    lat: 22.7153,
    lng: 75.8647,
    cuisines: ['Pure Veg Thali', 'North Indian', 'Paneer Specials'],
    rating: 4.7,
    ratingCount: 890,
    costForTwo: 300,
    estimatedDeliveryTimeMinutes: 20,
    pureVeg: true,
    offer: 'Special Executive Thali at ₹180',
    coverImage: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=800&auto=format&fit=crop&q=80',
  },
  {
    name: 'Nafees Restaurant',
    city: 'Indore',
    area: 'Old Palasia, Indore',
    lat: 22.7244,
    lng: 75.8839,
    cuisines: ['Mughlai', 'Biryani', 'Kebabs', 'North Indian'],
    rating: 4.6,
    ratingCount: 1100,
    costForTwo: 550,
    estimatedDeliveryTimeMinutes: 30,
    pureVeg: false,
    offer: 'Dum Biryani Special 10% OFF',
    coverImage: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=800&auto=format&fit=crop&q=80',
  },
  {
    name: '56 Dukan Chaat House',
    city: 'Indore',
    area: '56 Dukan, New Palasia, Indore',
    lat: 22.7265,
    lng: 75.8841,
    cuisines: ['Chaat', 'Street Food', 'Snacks', 'Sweets'],
    rating: 4.9,
    ratingCount: 2300,
    costForTwo: 220,
    estimatedDeliveryTimeMinutes: 15,
    pureVeg: true,
    offer: 'Special Johny Hot Dog & Chaat Combo',
    coverImage: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=800&auto=format&fit=crop&q=80',
  },
  {
    name: 'Radisson Blu The Creative Kitchen',
    city: 'Indore',
    area: 'Ring Road, Indore',
    lat: 22.7483,
    lng: 75.8978,
    cuisines: ['Multi-cuisine', 'Buffet', 'North Indian', 'Continental'],
    rating: 4.8,
    ratingCount: 950,
    costForTwo: 1200,
    estimatedDeliveryTimeMinutes: 35,
    pureVeg: false,
    offer: 'Flat 20% OFF on Weekend Buffets',
    coverImage: 'https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?w=800&auto=format&fit=crop&q=80',
  },
  {
    name: 'Chaha & Cafe',
    city: 'Ratlam',
    area: 'Station Road, Ratlam',
    lat: 23.3315,
    lng: 75.0367,
    cuisines: ['Tea & Coffee', 'Street Food', 'Snacks', 'Fast Food'],
    rating: 4.5,
    ratingCount: 420,
    costForTwo: 180,
    estimatedDeliveryTimeMinutes: 15,
    pureVeg: true,
    offer: 'Free Kulhad Chai above ₹149',
    coverImage: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&auto=format&fit=crop&q=80',
  },
  {
    name: 'Papu Ka Dhaba',
    city: 'Ratlam',
    area: 'Mhow Road, Ratlam',
    lat: 23.3248,
    lng: 75.0412,
    cuisines: ['North Indian', 'Dhaba Style', 'Dal Baati', 'Thali'],
    rating: 4.4,
    ratingCount: 610,
    costForTwo: 280,
    estimatedDeliveryTimeMinutes: 25,
    pureVeg: false,
    offer: 'Special Dal Baati Combo ₹160',
    coverImage: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=800&auto=format&fit=crop&q=80',
  },
  {
    name: 'Ratlami Sev & Namkeen Bhandar',
    city: 'Ratlam',
    area: 'Do Batti, Ratlam',
    lat: 23.3342,
    lng: 75.0398,
    cuisines: ['Ratlami Sev', 'Namkeen', 'Sweets', 'Snacks'],
    rating: 4.9,
    ratingCount: 1580,
    costForTwo: 200,
    estimatedDeliveryTimeMinutes: 20,
    pureVeg: true,
    offer: 'Buy 1kg Sev get 10% OFF',
    coverImage: 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=800&auto=format&fit=crop&q=80',
  },
  {
    name: 'Shree Ganga Bhojnalaya',
    city: 'Ratlam',
    area: 'College Road, Ratlam',
    lat: 23.3289,
    lng: 75.0456,
    cuisines: ['Rajasthani', 'Malwi', 'Thali', 'North Indian'],
    rating: 4.5,
    ratingCount: 530,
    costForTwo: 240,
    estimatedDeliveryTimeMinutes: 20,
    pureVeg: true,
    offer: 'Unlimited Thali at ₹140',
    coverImage: 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=800&auto=format&fit=crop&q=80',
  },
  {
    name: 'Padmavati Family Restaurant',
    city: 'Ratlam',
    area: 'Sailana Road, Ratlam',
    lat: 23.3378,
    lng: 75.0321,
    cuisines: ['Gujarati', 'North Indian', 'Punjabi Thali'],
    rating: 4.6,
    ratingCount: 720,
    costForTwo: 320,
    estimatedDeliveryTimeMinutes: 25,
    pureVeg: true,
    offer: 'Flat ₹50 OFF on family orders',
    coverImage: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&auto=format&fit=crop&q=80',
  },
];

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    const db = mongoose.connection.db;
    const col = db.collection('food_restaurants');

    const currentRestaurants = await col.find({}).toArray();
    console.log(`Found ${currentRestaurants.length} existing restaurants in DB.`);

    for (let i = 0; i < currentRestaurants.length; i++) {
      const rest = currentRestaurants[i];
      const match = diverseRestaurants[i % diverseRestaurants.length];

      const slug = (match.name + '-' + match.city)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      const updatedFields = {
        restaurantName: match.name,
        slug,
        coverImage: match.coverImage,
        profileImage: match.coverImage,
        coverImages: [match.coverImage],
        cuisines: match.cuisines,
        rating: match.rating,
        ratingCount: match.ratingCount,
        avgPrice: match.costForTwo,
        costForTwo: match.costForTwo,
        estimatedDeliveryTimeMinutes: match.estimatedDeliveryTimeMinutes,
        pureVegRestaurant: match.pureVeg,
        isAcceptingOrders: true,
        isActive: true,
        status: 'approved',
        offer: match.offer,
        city: match.city,
        area: match.area,
        location: {
          type: 'Point',
          coordinates: [match.lng, match.lat],
          latitude: match.lat,
          longitude: match.lng,
          city: match.city,
          area: match.area,
          formattedAddress: `${match.area}, ${match.city}, MP`,
        },
      };

      await col.updateOne({ _id: rest._id }, { $set: updatedFields });
      console.log(`[${i + 1}/${currentRestaurants.length}] Updated: ${match.name} (${match.city})`);
    }

    console.log('Unique restaurant data populated successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

run();
