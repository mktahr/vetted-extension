const fs = require('fs');
const path = require('path');

// Copy non-TypeScript files to dist
const filesToCopy = [
  { src: 'src/popup.html', dest: 'dist/popup.html' },
  { src: 'src/content.css', dest: 'dist/content.css' },
  { src: 'manifest.json', dest: 'dist/manifest.json' }
];

// Create dist directory if it doesn't exist
const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy files
filesToCopy.forEach(({ src, dest }) => {
  const srcPath = path.join(__dirname, '..', src);
  const destPath = path.join(__dirname, '..', dest);
  
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied ${src} to ${dest}`);
  } else {
    console.warn(`Warning: ${src} not found`);
  }
});

// Create icons directory
const iconsDir = path.join(distDir, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Try to generate icons
try {
  require('../scripts/generate-icons.js');
} catch (error) {
  console.log('\nNote: Icons not generated. Run "node scripts/generate-icons.js" manually or create icon files manually.');
}

// Remove 'export {};' from JS files (Chrome extensions don't accept empty exports)
const jsFilesToClean = ['background.js', 'popup.js', 'content.js'];
jsFilesToClean.forEach(fileName => {
  const filePath = path.join(distDir, fileName);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    // Remove standalone 'export {};' line (with or without semicolon)
    content = content.replace(/^export \{\};?\s*$/gm, '');
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Cleaned export statement from ${fileName}`);
  }
});

