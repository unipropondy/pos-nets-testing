const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../frontend/app/payment_success.tsx');
let content = fs.readFileSync(filePath, 'utf8');

const target = 'router.replace("/(tabs)/category");';
const replacement = 'const targetSec = section || "SECTION_1";\n      router.replace(`/(tabs)/category?section=${targetSec}`);';

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✅ Successfully updated payment_success.tsx');
} else {
  console.log('Target not found');
}

