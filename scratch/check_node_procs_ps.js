const { execSync } = require('child_process');
const cmd = "powershell -NoProfile -Command \"Get-Process -Name 'node' -ErrorAction SilentlyContinue | ForEach-Object { [PSCustomObject]@{ Id = $_.Id; Path = $_.Path; CommandLine = (Get-CimInstance Win32_Process -Filter \\\"ProcessId = $($_.Id)\\\").CommandLine } } | Format-List\"";
try {
  const out = execSync(cmd).toString();
  console.log(out);
} catch (e) {
  console.error(e.message);
}

