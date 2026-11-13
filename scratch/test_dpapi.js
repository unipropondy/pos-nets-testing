const { execFileSync } = require('child_process');

function encryptSecret(plaintext) {
  const psScript = 'Add-Type -AssemblyName System.Security; $inputVal = [Console]::In.ReadToEnd(); [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect([System.Text.Encoding]::UTF8.GetBytes($inputVal), $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine))';
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], { input: plaintext, encoding: 'utf8' }).trim();
}

function decryptSecret(cipherB64) {
  const psScript = 'Add-Type -AssemblyName System.Security; $inputVal = [Console]::In.ReadToEnd().Trim(); [System.Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputVal), $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine))';
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], { input: cipherB64, encoding: 'utf8' }).trim();
}

const secret = 'Unipro@2026';
const enc = encryptSecret(secret);
console.log('Encrypted:', enc.substring(0, 30) + '...');
const dec = decryptSecret(enc);
console.log('Decrypted:', dec);
console.log('Match?', secret === dec);
