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

async function processRefs() {
  console.log(`Scanning for source files in ${srcDir}...`);
  try {
    const allFiles = await getFiles(srcDir);
    const srcFiles = allFiles.filter(file => {
      const ext = path.extname(file).toLowerCase();
      if (file.includes('node_modules')) return false;
      return ['.jsx', '.js', '.tsx', '.ts', '.css'].includes(ext);
    });

    console.log(`Found ${srcFiles.length} source files to check.`);
    let modifiedCount = 0;

    for (const file of srcFiles) {
      const content = await readFile(file, 'utf8');
      
      // Regex to find .png, .jpg, .jpeg within strings or imports
      const regex = /(\.png|\.jpg|\.jpeg)(['"`\)])/gi;
      
      if (regex.test(content)) {
        // Need to reset regex state if doing a global test then replace
        const newContent = content.replace(/(\.png|\.jpg|\.jpeg)(['"`\)])/gi, '.webp$2');
        if (content !== newContent) {
          await writeFile(file, newContent, 'utf8');
          console.log(`Updated references in: ${path.relative(srcDir, file)}`);
          modifiedCount++;
        }
      }
    }

    console.log(`Reference update complete! Modified ${modifiedCount} files.`);
  } catch (error) {
    console.error('Error scanning directories:', error);
  }
}

processRefs();
