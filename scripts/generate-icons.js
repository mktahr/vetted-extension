// Simple icon generator - creates placeholder icons
// Requires: npm install canvas (optional - run manually if needed)

const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '..', 'dist', 'icons');

// Create icons directory
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Try to use canvas if available, otherwise create SVG placeholders
try {
  const { createCanvas } = require('canvas');
  
  const sizes = [16, 48, 128];
  
  sizes.forEach(size => {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    
    // Draw LinkedIn blue background
    ctx.fillStyle = '#0077b5';
    ctx.fillRect(0, 0, size, size);
    
    // Draw simple "V" for Vetted
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${size * 0.6}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('V', size / 2, size / 2);
    
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), buffer);
    console.log(`Created icon${size}.png`);
  });
  
  console.log('\n✅ Icons generated successfully!');
} catch (error) {
  console.log('\n⚠️  Canvas library not found. Creating SVG placeholders instead.');
  console.log('To generate PNG icons, run: npm install canvas');
  console.log('Or create your own icons and place them in dist/icons/\n');
  
  // Create SVG placeholders
  const sizes = [16, 48, 128];
  sizes.forEach(size => {
    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#0077b5"/>
  <text x="50%" y="50%" font-family="Arial" font-size="${size * 0.6}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">V</text>
</svg>`;
    fs.writeFileSync(path.join(iconsDir, `icon${size}.svg`), svg);
    console.log(`Created icon${size}.svg (convert to PNG manually)`);
  });
}

