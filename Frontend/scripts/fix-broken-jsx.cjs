const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const srcDir = path.resolve(__dirname, '../src');

async function getFiles(dir) {
  const subdirs = await readdir(dir);
  const files = await Promise.all(subdirs.map(async (subdir) => {
    const res = path.resolve(dir, subdir);
    return (await stat(res)).isDirectory() ? getFiles(res) : res;
  }));
  return files.reduce((a, f) => a.concat(f), []);
}

async function fixBrokenJSX() {
  console.log(`Scanning for broken JSX in ${srcDir}...`);
  try {
    const allFiles = await getFiles(srcDir);
    const srcFiles = allFiles.filter(file => {
      const ext = path.extname(file).toLowerCase();
      if (file.includes('node_modules')) return false;
      return ['.jsx', '.tsx'].includes(ext);
    });

    let modifiedCount = 0;

    for (const file of srcFiles) {
      const content = await readFile(file, 'utf8');
      
      // Fix the incorrectly injected lazy loading attribute inside arrow functions
      const brokenPattern = /= loading="lazy" decoding="async">/g;
      
      if (brokenPattern.test(content)) {
        const newContent = content.replace(brokenPattern, '=>');
        await writeFile(file, newContent, 'utf8');
        console.log(`Fixed JSX syntax in: ${path.relative(srcDir, file)}`);
        modifiedCount++;
      }
    }

    console.log(`Fix complete! Modified ${modifiedCount} files.`);
  } catch (error) {
    console.error('Error scanning directories:', error);
  }
}

fixBrokenJSX();
