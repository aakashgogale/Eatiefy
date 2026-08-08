const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const srcDir = path.resolve(__dirname, '../src');

// Files to exclude from lazy loading (above the fold / critical)
const excludeList = [
  'OnboardingSplash.jsx',
  'HomeHeader.jsx',
  'DesktopNavbar.jsx',
  'PageNavbar.jsx',
  'AdminNavbar.jsx',
  'AdminSidebar.jsx',
  'Login.jsx',
  'SignIn.jsx',
  'Signup.jsx',
  'Welcome.jsx',
  'LandingPage.jsx'
];

async function getFiles(dir) {
  const subdirs = await readdir(dir);
  const files = await Promise.all(subdirs.map(async (subdir) => {
    const res = path.resolve(dir, subdir);
    return (await stat(res)).isDirectory() ? getFiles(res) : res;
  }));
  return files.reduce((a, f) => a.concat(f), []);
}

async function processLazyLoad() {
  console.log(`Scanning for source files to inject lazy loading...`);
  try {
    const allFiles = await getFiles(srcDir);
    const srcFiles = allFiles.filter(file => {
      const ext = path.extname(file).toLowerCase();
      if (file.includes('node_modules')) return false;
      if (excludeList.includes(path.basename(file))) return false;
      return ['.jsx', '.tsx'].includes(ext);
    });

    let modifiedCount = 0;

    for (const file of srcFiles) {
      const content = await readFile(file, 'utf8');
      
      // Match <img ...> and <motion.img ...> that DON'T already have loading="
      // This is a naive regex but works well for most React codebases.
      // We look for <img or <motion.img followed by anything until > or />
      
      let newContent = content.replace(/<(img|motion\.img)([^>]+)>/gi, (match, tag, attrs) => {
        // If it already has a loading attribute, skip
        if (/loading\s*=/i.test(attrs)) {
          return match;
        }
        
        // Ensure it doesn't break self-closing tags
        if (attrs.trim().endsWith('/')) {
            const cleanAttrs = attrs.substring(0, attrs.lastIndexOf('/'));
            return `<${tag}${cleanAttrs} loading="lazy" decoding="async" />`;
        }
        
        return `<${tag}${attrs} loading="lazy" decoding="async">`;
      });

      if (content !== newContent) {
        await writeFile(file, newContent, 'utf8');
        console.log(`Injected lazy loading in: ${path.relative(srcDir, file)}`);
        modifiedCount++;
      }
    }

    console.log(`Lazy loading injection complete! Modified ${modifiedCount} files.`);
  } catch (error) {
    console.error('Error scanning directories:', error);
  }
}

processLazyLoad();
