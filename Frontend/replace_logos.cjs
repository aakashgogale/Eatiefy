const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

const replacements = [
  // User paths
  { file: 'modules/Food/utils/razorpay.js', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/pages/user/profile/About.jsx', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/pages/user/Home.jsx', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/pages/user/DiningRestaurants.jsx', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/pages/user/auth/SignIn.jsx', search: 'eatiefy-logo copy.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/pages/Home.jsx', search: '/eatiefy-logo.webp', replace: '/user-app-logo.webp' },
  { file: 'modules/Food/pages/admin/settings/AboutUs.jsx', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/pages/admin/auth/AdminLogin.jsx', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/pages/admin/auth/AdminSignup.jsx', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/pages/admin/auth/AdminForgotPassword.jsx', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/components/user/DesktopNavbar.jsx', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/components/user/Footer.jsx', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/components/user/PageNavbar.jsx', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/components/admin/AdminNavbar.jsx', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/components/admin/orders/useOrdersManagement.js', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/components/admin/auth/AdminAuthHero.jsx', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  { file: 'modules/Food/components/admin/AdminSidebar.jsx', search: 'eatiefy-logo.webp', replace: 'user-app-logo.webp' },
  
  // Restaurant paths
  { file: 'modules/Food/pages/restaurant/auth/Login.jsx', search: 'eatiefy-logo.webp', replace: 'restaurant-partner-logo.webp' },
  { file: 'modules/Food/pages/restaurant/auth/OTP.jsx', search: 'eatiefy-logo.webp', replace: 'restaurant-partner-logo.webp' },
  
  // Delivery path
  { file: 'modules/DeliveryV2/components/GoogleMapsTracking.jsx', search: 'bikelogo.webp', replace: 'delivery-partner-logo.webp' }
];

replacements.forEach(({ file, search, replace }) => {
  const filePath = path.join(srcDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    content = content.replace(search, replace);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Replaced in ${file}`);
  } else {
    console.warn(`File not found: ${filePath}`);
  }
});

// Copy to public folder
const pubSrc = path.join(srcDir, 'modules/Food/assets/user-app-logo.webp');
const pubDest = path.join(__dirname, 'public/user-app-logo.webp');
if (fs.existsSync(pubSrc)) {
  fs.copyFileSync(pubSrc, pubDest);
  console.log('Copied user-app-logo.webp to public/');
}
