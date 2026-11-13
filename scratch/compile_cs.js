const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const rootDir = process.cwd();
const installerBuildDir = path.join(rootDir, 'installer-build');
const iconPath = path.join(rootDir, 'installer-output', '.icon-ico', 'icon.ico');

console.log('Compiling SmartPOS.exe...');
execSync(
  `"${cscPath}" /target:winexe /out:"${path.join(installerBuildDir, 'SmartPOS.exe')}" /r:System.Windows.Forms.dll /r:System.Drawing.dll /win32icon:"${iconPath}" "${path.join(installerBuildDir, 'UniProPOS.cs')}" "${path.join(installerBuildDir, 'AssemblyInfo.cs')}"`,
  { stdio: 'inherit' }
);

console.log('Compiling UniProPOS.exe...');
execSync(
  `"${cscPath}" /target:winexe /out:"${path.join(installerBuildDir, 'UniProPOS.exe')}" /r:System.Windows.Forms.dll /r:System.Drawing.dll /win32icon:"${iconPath}" "${path.join(installerBuildDir, 'UniProPOS.cs')}" "${path.join(installerBuildDir, 'AssemblyInfo.cs')}"`,
  { stdio: 'inherit' }
);

console.log('Compiling SmartPOS-Setup.exe...');
execSync(
  `"${cscPath}" /target:winexe /out:"${path.join(installerBuildDir, 'SmartPOS-Setup.exe')}" /reference:System.Windows.Forms.dll,System.dll,System.IO.Compression.dll,System.IO.Compression.FileSystem.dll,Microsoft.CSharp.dll "${path.join(installerBuildDir, 'Setup.cs')}" "${path.join(installerBuildDir, 'AssemblyInfo.cs')}"`,
  { stdio: 'inherit' }
);

console.log('All C# executables recompiled successfully!');

