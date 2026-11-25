const fs = require('fs');
const path = require('path');

function cleanHtmlCss(filePath) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Remove empty rulesets like [stylesheet-group="..."]{}
  content = content.replace(/\[stylesheet-group="[^"]*"\]\{\}\r?\n?/g, '');

  // 2. Define standard property 'appearance' for compatibility where vendor prefixes exist
  // e.g., -moz-appearance:textfield;-webkit-appearance:none; -> add appearance:none;
  content = content.replace(
    /(-moz-appearance:textfield;-webkit-appearance:none;)(?!appearance:)/g,
    '$1appearance:none;'
  );

  // 3. Remove unknown property 'border-curve'
  content = content.replace(/\.r-1onu96p\{border-curve:continuous;\}\r?\n?/g, '');
  content = content.replace(/border-curve:continuous;?/g, '');

  fs.writeFileSync(filePath, content, 'utf8');
}

function processDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      processDirectory(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      cleanHtmlCss(fullPath);
    }
  }
}

module.exports = { cleanHtmlCss, processDirectory };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  processDirectory(path.join(root, 'frontend', 'dist-qr'));
  processDirectory(path.join(root, 'backend', 'dist-qr'));
  processDirectory(path.join(root, 'backend', 'dist'));
  console.log('✅ HTML CSS sanitization completed across all dist directories.');
}
