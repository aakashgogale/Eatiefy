
const Jimp = require('jimp');

Jimp.read('../public/deliveryboy-3d.jpeg')
  .then(image => {
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
      var r = this.bitmap.data[idx + 0];
      var g = this.bitmap.data[idx + 1];
      var b = this.bitmap.data[idx + 2];
      
      // Calculate luminance or simply check if it's bright enough to be background
      // If it's a white background, RGB values will be very high (e.g. > 235)
      // To avoid harsh jagged edges, we can create a simple anti-aliasing alpha curve
      const maxVal = Math.max(r, g, b);
      if (r > 240 && g > 240 && b > 240) {
        this.bitmap.data[idx + 3] = 0; // fully transparent
      } else if (r > 210 && g > 210 && b > 210) {
        // Simple feathering
        const alpha = Math.floor(255 * (240 - maxVal) / 30);
        this.bitmap.data[idx + 3] = alpha;
      }
    });
    return image.write('../public/deliveryboy-3d-transparent.png');
  })
  .then(() => {
    console.log('Image processed successfully!');
  })
  .catch(err => {
    console.error(err);
  });
