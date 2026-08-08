const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { promisify } = require('util');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

const frontendDir = path.resolve(__dirname, '../../frontend/src');

async function getFiles(dir) {
  const subdirs = await readdir(dir);
  const files = await Promise.all(subdirs.map(async (subdir) => {
    const res = path.resolve(dir, subdir);
    return (await stat(res)).isDirectory() ? getFiles(res) : res;
  }));
  return files.reduce((a, f) => a.concat(f), []);
}

async function processImages() {
  console.log(`Scanning for images in ${frontendDir}...`);
  try {
    const allFiles = await getFiles(frontendDir);
    const imageFiles = allFiles.filter(file => {
      const ext = path.extname(file).toLowerCase();
      // Skip node_modules or dist just in case, though it's inside src
      if (file.includes('node_modules')) return false;
      return ['.png', '.jpg', '.jpeg'].includes(ext);
    });

    console.log(`Found ${imageFiles.length} images to convert.`);
    let successCount = 0;
    let errorCount = 0;

    for (const file of imageFiles) {
      try {
        const ext = path.extname(file);
        const webpPath = file.substring(0, file.lastIndexOf(ext)) + '.webp';
        
        // Skip if webp already exists (maybe we ran it before)
        if (fs.existsSync(webpPath)) {
            console.log(`WebP already exists for: ${path.basename(file)}`);
            await unlink(file); // delete original if leftover
            continue;
        }

        await sharp(file)
          .webp({ quality: 80, effort: 4 }) // Effort 4 provides good compression vs speed
          .toFile(webpPath);
        
        console.log(`Converted: ${path.basename(file)} -> ${path.basename(webpPath)}`);
        
        // Delete original file
        await unlink(file);
        console.log(`Deleted original: ${path.basename(file)}`);
        
        successCount++;
      } catch (err) {
        console.error(`Error processing ${file}:`, err.message);
        errorCount++;
      }
    }

    console.log(`Optimization complete! Converted ${successCount} images. Errors: ${errorCount}`);
  } catch (error) {
    console.error('Error scanning directories:', error);
  }
}

processImages();
