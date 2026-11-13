const fs = require('fs');
const filePath = 'electron/package.json';
let content = fs.readFileSync(filePath, 'utf8');

// Replace "!*.enc" with nothing or remove that line
const needle = '"!*.enc"';
if (content.includes(needle)) {
  // Check if previous line has comma
  content = content.replace(/,\s*"!\*\.enc"/g, '');
  content = content.replace(/"!\*\.enc",?\s*/g, '');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Successfully updated electron/package.json to include .env.enc');
} else {
  console.log('Needle !*.enc not found in electron/package.json');
}

