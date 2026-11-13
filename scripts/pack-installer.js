const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const installerBuildDir = path.join(rootDir, 'installer-build');
const payloadStageDir = path.join(installerBuildDir, 'payload');
const payloadZip = path.join(installerBuildDir, 'payload.zip');
const backendSrcDir = path.join(rootDir, 'backend');
const nodeExeSource = process.execPath; // C:\Program Files\nodejs\node.exe

console.log('=== Packing UniPro POS Offline Payload ===');

// 0. Automatically compile SmartPOS.exe, UniProPOS.exe and Setup installers if csc.exe is available
const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
if (fs.existsSync(cscPath)) {
  console.log('✓ Compiling latest SmartPOS.exe launcher...');
  try {
    const iconPath = path.join(rootDir, 'installer-output', '.icon-ico', 'icon.ico');
    execSync(
      `"${cscPath}" /target:winexe /out:"${path.join(installerBuildDir, 'SmartPOS.exe')}" /r:System.Windows.Forms.dll /r:System.Drawing.dll /win32icon:"${iconPath}" "${path.join(installerBuildDir, 'UniProPOS.cs')}" "${path.join(installerBuildDir, 'AssemblyInfo.cs')}"`,
      { stdio: 'inherit' }
    );
    execSync(
      `"${cscPath}" /target:winexe /out:"${path.join(installerBuildDir, 'UniProPOS.exe')}" /r:System.Windows.Forms.dll /r:System.Drawing.dll /win32icon:"${iconPath}" "${path.join(installerBuildDir, 'UniProPOS.cs')}" "${path.join(installerBuildDir, 'AssemblyInfo.cs')}"`,
      { stdio: 'inherit' }
    );
    console.log('✓ Compiling latest SmartPOS-Setup.exe installer...');
    execSync(
      `"${cscPath}" /target:winexe /out:"${path.join(installerBuildDir, 'SmartPOS-Setup.exe')}" /reference:System.Windows.Forms.dll,System.dll,System.IO.Compression.dll,System.IO.Compression.FileSystem.dll,Microsoft.CSharp.dll "${path.join(installerBuildDir, 'Setup.cs')}" "${path.join(installerBuildDir, 'AssemblyInfo.cs')}"`,
      { stdio: 'inherit' }
    );
    execSync(
      `"${cscPath}" /target:winexe /out:"${path.join(installerBuildDir, 'UniProPOS-Setup.exe')}" /reference:System.Windows.Forms.dll,System.dll,System.IO.Compression.dll,System.IO.Compression.FileSystem.dll,Microsoft.CSharp.dll "${path.join(installerBuildDir, 'Setup.cs')}" "${path.join(installerBuildDir, 'AssemblyInfo.cs')}"`,
      { stdio: 'inherit' }
    );
  } catch (err) {
    console.warn('⚠️ CSC compilation warning:', err.message);
  }
}

// 1. Clean staging directory
if (fs.existsSync(payloadStageDir)) {
  fs.rmSync(payloadStageDir, { recursive: true, force: true });
}
if (fs.existsSync(payloadZip)) {
  fs.unlinkSync(payloadZip);
}
fs.mkdirSync(payloadStageDir, { recursive: true });

// 2. Copy launcher into staging root
if (fs.existsSync(path.join(installerBuildDir, 'SmartPOS.exe'))) {
  fs.copyFileSync(
    path.join(installerBuildDir, 'SmartPOS.exe'),
    path.join(payloadStageDir, 'SmartPOS.exe')
  );
}
fs.copyFileSync(
  path.join(installerBuildDir, 'UniProPOS.exe'),
  path.join(payloadStageDir, 'UniProPOS.exe')
);
console.log('✓ Copied SmartPOS.exe and UniProPOS.exe to payload root');

// 3. Copy node.exe into staging root for guaranteed runtime portability
if (fs.existsSync(nodeExeSource)) {
  fs.copyFileSync(nodeExeSource, path.join(payloadStageDir, 'node.exe'));
  console.log('✓ Bundled standalone node.exe to payload root');
}

// 4. Copy backend (including node_modules and built frontend in dist)
const targetBackendDir = path.join(payloadStageDir, 'backend');
console.log('✓ Copying backend runtime and assets (this may take a minute)...');

// Helper to copy directory while excluding git and temporary caches
function copyDirRecursive(src, dest, ignoreList = ['.git', '.cache', 'logs', '.env.enc', '.env.bak', '.env.key.dpapi']) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (ignoreList.includes(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, ignoreList);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDirRecursive(backendSrcDir, targetBackendDir);
console.log('✓ Backend copied successfully with dist and node_modules');

// 5. Create payload.zip using tar.exe or PowerShell Compress-Archive
console.log('✓ Compressing payload into payload.zip...');
try {
  const hasTar = fs.existsSync('C:\\WINDOWS\\system32\\tar.exe');
  if (hasTar) {
    execSync(`tar.exe -a -c -f "${payloadZip}" *`, { cwd: payloadStageDir, stdio: 'inherit' });
  } else {
    execSync(
      `powershell.exe -NoProfile -Command "Compress-Archive -Path '${payloadStageDir}\\*' -DestinationPath '${payloadZip}' -Force -CompressionLevel Optimal"`,
      { stdio: 'inherit' }
    );
  }
  console.log('✓ Successfully created payload.zip!');
} catch (err) {
  console.error('Error creating zip:', err.message);
  process.exit(1);
}

// 6. Clean up temporary uncompressed staging folder to save disk space
fs.rmSync(payloadStageDir, { recursive: true, force: true });
console.log('✓ Staging folder cleaned up.');
console.log('\n=== Installer Package Ready in installer-build ===');
console.log(`Setup Installer: ${path.join(installerBuildDir, 'SmartPOS-Setup.exe')}`);
console.log(`Setup Installer: ${path.join(installerBuildDir, 'UniProPOS-Setup.exe')}`);
console.log(`Package Payload: ${payloadZip}\n`);
