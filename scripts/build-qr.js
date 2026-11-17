const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');
const backendDir = path.join(rootDir, 'backend');
const tempDistDir = path.join(frontendDir, 'temp-qr-export');
const frontendQrDist = path.join(frontendDir, 'dist-qr');
const backendQrDist = path.join(backendDir, 'dist-qr');

console.log('=== Starting Dedicated QR-Only Frontend Build Process ===');

// 1. Run Expo export targeting dedicated temporary directory
console.log('\nStep 1: Exporting web bundle from frontend (without touching existing dist)...');
try {
  if (fs.existsSync(tempDistDir)) {
    fs.rmSync(tempDistDir, { recursive: true, force: true });
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execSync(`${npmCmd} exec expo export -- --platform web --output-dir temp-qr-export`, {
    cwd: frontendDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: '--max-old-space-size=4096',
      EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK: '1'
    }
  });
} catch (error) {
  console.error('Error during expo export for QR build:', error.message);
  process.exit(1);
}

// 2. Prepare QR-only distribution in frontend/dist-qr
console.log('\nStep 2: Assembling QR-only frontend distribution in frontend/dist-qr...');
try {
  if (fs.existsSync(frontendQrDist)) {
    fs.rmSync(frontendQrDist, { recursive: true, force: true });
  }
  fs.mkdirSync(frontendQrDist, { recursive: true });

  // Copy shared bundles, assets and static resources
  if (fs.existsSync(path.join(tempDistDir, '_expo'))) {
    fs.cpSync(path.join(tempDistDir, '_expo'), path.join(frontendQrDist, '_expo'), { recursive: true });
  }
  if (fs.existsSync(path.join(tempDistDir, 'assets'))) {
    fs.cpSync(path.join(tempDistDir, 'assets'), path.join(frontendQrDist, 'assets'), { recursive: true });
  }
  if (fs.existsSync(path.join(tempDistDir, 'favicon.ico'))) {
    fs.copyFileSync(path.join(tempDistDir, 'favicon.ico'), path.join(frontendQrDist, 'favicon.ico'));
  }
  if (fs.existsSync(path.join(tempDistDir, 'manifest.json'))) {
    fs.copyFileSync(path.join(tempDistDir, 'manifest.json'), path.join(frontendQrDist, 'manifest.json'));
  }

  // Copy only customer pages
  const tempCustomerDir = path.join(tempDistDir, 'customer');
  const targetCustomerDir = path.join(frontendQrDist, 'customer');
  if (fs.existsSync(tempCustomerDir)) {
    fs.cpSync(tempCustomerDir, targetCustomerDir, { recursive: true });
  }

  // Create dedicated QR root entry point (index.html)
  // When a visitor hits https://qr.smartcafesg.com/, serve customer index or redirect to /customer
  const customerIndexHtml = path.join(tempCustomerDir, 'index.html');
  if (fs.existsSync(customerIndexHtml)) {
    fs.copyFileSync(customerIndexHtml, path.join(frontendQrDist, 'index.html'));
  }

  // Create a clean 404 handler for any unmapped public path
  const notFoundHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Smart POS - QR Ordering</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #FFF7ED; color: #9A3412; text-align: center; }
    .box { background: white; padding: 32px 24px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); max-width: 400px; margin: 16px; }
    h1 { margin-top: 0; font-size: 20px; color: #EA580C; }
    p { font-size: 14px; color: #4B5563; line-height: 1.5; }
    a { display: inline-block; margin-top: 16px; background: #EA580C; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; }
  </style>
</head>
<body>
  <div class="box">
    <h1>QR Ordering Portal</h1>
    <p>Please scan the QR code located on your table to view the menu and place your order.</p>
  </div>
</body>
</html>`;
  fs.writeFileSync(path.join(frontendQrDist, '404.html'), notFoundHtml, 'utf8');

  // Clean temporary directory
  fs.rmSync(tempDistDir, { recursive: true, force: true });
  console.log('✅ frontend/dist-qr prepared successfully with customer-only files.');
} catch (error) {
  console.error('Error assembling frontend/dist-qr:', error.message);
  process.exit(1);
}

// 3. Deploy to backend/dist-qr
console.log('\nStep 3: Synchronizing build into backend/dist-qr...');
try {
  if (fs.existsSync(backendQrDist)) {
    fs.rmSync(backendQrDist, { recursive: true, force: true });
  }
  fs.mkdirSync(backendQrDist, { recursive: true });
  fs.cpSync(frontendQrDist, backendQrDist, { recursive: true, force: true });
  console.log('✅ Copied QR build to backend/dist-qr successfully!');
} catch (error) {
  console.error('Error copying to backend/dist-qr:', error.message);
  process.exit(1);
}

console.log('\n=== QR Build Process Complete! Output: backend/dist-qr ===\n');
