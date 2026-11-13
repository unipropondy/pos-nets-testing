const fs = require('fs');
const filePath = 'backend/config.js';
let content = fs.readFileSync(filePath, 'utf8');
const search = 'require("dotenv").config({ path: path.resolve(__dirname, ".env") });';
const replace = 'const plainEnvPath = path.resolve(__dirname, ".env");\nif (fs.existsSync(plainEnvPath)) {\n  require("dotenv").config({ path: plainEnvPath });\n}';
if (content.includes(search)) {
  content = content.replace(search, replace);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Successfully updated backend/config.js');
} else {
  console.log('Search target not found in backend/config.js');
}

