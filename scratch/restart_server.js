const { execSync } = require('child_process');
try {
  const output = execSync('netstat -ano | findstr :3000 | findstr LISTENING').toString();
  const match = output.trim().split(/\s+/).pop();
  if (match && !isNaN(match)) {
    console.log('Killing PID on 3000:', match);
    try { execSync(`taskkill /F /PID ${match}`); } catch (e) {}
  }
} catch (e) {}

const { spawn } = require('child_process');
const path = require('path');
const out = require('fs').openSync(path.resolve(__dirname, '../backend_out.log'), 'a');
const err = require('fs').openSync(path.resolve(__dirname, '../backend_err.log'), 'a');
const child = spawn(process.execPath, ['server.js'], {
  cwd: path.resolve(__dirname, '../backend'),
  detached: true,
  stdio: ['ignore', out, err]
});
child.unref();
console.log('Backend restarted with PID:', child.pid);
