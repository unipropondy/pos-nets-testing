const path = require('path');
const { execSync } = require('child_process');

// 1. Create a simple desktop batch file and folder link that user can double click anytime
const desktop = path.join(process.env.USERPROFILE || 'C:\\Users\\admin', 'Desktop');
const batPath = path.join(desktop, 'Open SmartPOS Logs.bat');

const fs = require('fs');
fs.writeFileSync(batPath, '@echo off\r\nstart "" explorer.exe "C:\\ProgramData\\SmartPOS\\logs"\r\n');
console.log('Created batch file on Desktop:', batPath);

