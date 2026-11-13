const fs = require('fs');
const filePath = 'frontend/app/_layout.tsx';
let content = fs.readFileSync(filePath, 'utf8');

const needle = 'console.warn("🛡️ [SafeRootErrorBoundary] Caught error:", error?.message || error, errorInfo);';
const addition = needle + '\n      logger.error(`[SafeRootErrorBoundary] ${error?.message || error}`, errorInfo);';

if (content.includes(needle)) {
  content = content.replace(needle, addition);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Successfully added logger.error to SafeRootErrorBoundary');
} else {
  console.log('Needle not found');
}

