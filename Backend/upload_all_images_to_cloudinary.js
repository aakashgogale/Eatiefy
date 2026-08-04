import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';

dotenv.config();

cloudinary.config({
  cloud_name: 'wvpmmaib',
  api_key: '857785439779629',
  api_secret: 'Z3MO95c4xMPoJKerh70EAM5nEqE',
});

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://eatiefy1_db_user:6V4JiItQ5dbmQP6A@cluster0.ogyu96a.mongodb.net/Eatiefy";

async function main() {
  try {
    console.log("Connecting to MongoDB Atlas...");
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB!");

    // 1. Upload all category icons from Frontend/src/modules/Food/assets/category-icons to Cloudinary
    const categoryIconsDir = path.resolve('../Frontend/src/modules/Food/assets/category-icons');
    const categoryFiles = fs.readdirSync(categoryIconsDir);
    
    console.log(`\nFound ${categoryFiles.length} category files to upload to Cloudinary...`);
    const cloudinaryCategoryMap = {};

    for (const file of categoryFiles) {
      if (!file.endsWith('.png') && !file.endsWith('.jpg') && !file.endsWith('.webp')) continue;
      const filePath = path.join(categoryIconsDir, file);
      console.log(`Uploading ${file} to Cloudinary...`);

      const result = await cloudinary.uploader.upload(filePath, {
        folder: 'food/category-icons',
        resource_type: 'image',
        use_filename: true,
        unique_filename: false,
      });

      const key = file.replace(/\.[^/.]+$/, ""); // strip extension
      cloudinaryCategoryMap[key] = result.secure_url;
      console.log(`Uploaded ${file} -> ${result.secure_url}`);
    }

    console.log("\n--- CLOUDINARY CATEGORY MAP ---");
    console.log(JSON.stringify(cloudinaryCategoryMap, null, 2));

    // Save JSON mapping file to Frontend constants for direct CDN imports
    const mappingPath = path.resolve('../Frontend/src/modules/Food/constants/cloudinaryImages.json');
    fs.writeFileSync(mappingPath, JSON.stringify(cloudinaryCategoryMap, null, 2));
    console.log(`Saved Cloudinary image mapping to ${mappingPath}`);

    // 2. Scan food_items collection in MongoDB and replace any local /uploads/... or missing images with Cloudinary URLs
    const db = mongoose.connection.db;
    const foodItemsColl = db.collection('food_items');
    const foodItems = await foodItemsColl.find({}).toArray();
    console.log(`\nProcessing ${foodItems.length} food items in MongoDB...`);

    let updatedFoodCount = 0;
    for (const food of foodItems) {
      const img = food.image || "";
      const name = (food.name || "").toLowerCase();

      let targetUrl = null;
      if (name.includes("biryani")) targetUrl = cloudinaryCategoryMap["biryani_clean"];
      else if (name.includes("maggie") || name.includes("maggi") || name.includes("noodle")) targetUrl = cloudinaryCategoryMap["maggie_clean"];
      else if (name.includes("rasgulla") || name.includes("sweet")) targetUrl = cloudinaryCategoryMap["rasgulla_clean"];
      else if (name.includes("burger")) targetUrl = cloudinaryCategoryMap["burger"];
      else if (name.includes("pizza")) targetUrl = cloudinaryCategoryMap["pizza"];
      else if (name.includes("dosa")) targetUrl = cloudinaryCategoryMap["dosa"];
      else if (name.includes("paneer")) targetUrl = cloudinaryCategoryMap["paneer"];

      if (targetUrl && (img.startsWith('/uploads/') || !img.startsWith('http') || img.includes('transparent') || img.includes('placeholder'))) {
        await foodItemsColl.updateOne(
          { _id: food._id },
          { $set: { image: targetUrl } }
        );
        updatedFoodCount++;
        console.log(`Updated food item "${food.name}" -> ${targetUrl}`);
      }
    }
    console.log(`Updated ${updatedFoodCount} food items in database to Cloudinary CDN URLs!`);

    console.log("\nALL CATEGORY & FOOD IMAGES SUCCESSFULLY UPLOADED & SYNCED TO CLOUDINARY!");
    process.exit(0);
  } catch (err) {
    console.error("Error in upload_all_images_to_cloudinary:", err);
    process.exit(1);
  }
}

main();
