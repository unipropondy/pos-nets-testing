const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

let browserExe = null;
if (fs.existsSync(edgePath)) browserExe = edgePath;
else if (fs.existsSync(chromePath)) browserExe = chromePath;

const appUrl = 'http://localhost:3000/customer-display-standalone';

console.log('🖥️ Opening Customer Display Window...');
if (browserExe) {
  spawn(browserExe, [`--app=${appUrl}`, '--start-fullscreen'], {
    detached: true,
    stdio: 'ignore'
  }).unref();
} else {
  spawn('cmd.exe', ['/c', 'start', appUrl], {
    detached: true,
    stdio: 'ignore'
  }).unref();
}
