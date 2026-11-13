const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
  const dir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'UniPro POS');
  const files = fs.readdirSync(dir);
  console.log('Files in Start Menu folder:', files);
  for (const f of files) {
    const full = path.join(dir, f);
    const cmd = `powershell -NoProfile -Command "$w = New-Object -ComObject WScript.Shell; $s = $w.CreateShortcut('${full.replace(/'/g, "''")}'); Write-Host $s.TargetPath"`;
    const target = execSync(cmd).toString().trim();
    console.log(f, '->', target);
  }
} catch (e) {
  console.error(e.message);
}
