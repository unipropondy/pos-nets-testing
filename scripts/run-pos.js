const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');
const serverJs = path.join(backendDir, 'server.js');

console.log('🚀 Starting UniPro POS (Hybrid Mode)...');

// 1. Spawn backend server in child process
const backendProcess = spawn(process.execPath, ['server.js'], {
  cwd: backendDir,
  stdio: 'inherit',
  windowsHide: true,
});

backendProcess.on('error', (err) => {
  console.error('❌ Failed to start backend:', err.message);
  process.exit(1);
});

// Function to kill backend cleanly
function cleanupBackend() {
  console.log('\n🛑 Shutting down UniPro POS backend server...');
  try {
    backendProcess.kill('SIGTERM');
  } catch {}
  process.exit(0);
}

process.on('SIGINT', cleanupBackend);
process.on('SIGTERM', cleanupBackend);
process.on('exit', () => {
  try { backendProcess.kill(); } catch {}
});

// 2. Poll health check until port 3000 is ready
function checkHealth(retries = 40) {
  if (retries <= 0) {
    console.error('❌ Backend timed out.');
    cleanupBackend();
    return;
  }

  http.get('http://localhost:3000/health', (res) => {
    if (res.statusCode === 200) {
      console.log('✅ Backend is online on http://localhost:3000');
      launchWindow();
    } else {
      setTimeout(() => checkHealth(retries - 1), 500);
    }
  }).on('error', () => {
    setTimeout(() => checkHealth(retries - 1), 500);
  });
}

// 3. Launch dedicated app-mode browser window
function launchWindow() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  let browserExe = null;
  if (fs.existsSync(edgePath)) browserExe = edgePath;
  else if (fs.existsSync(chromePath)) browserExe = chromePath;

  const appUrl = 'http://localhost:3000';
  let appProcess;

  if (browserExe) {
    console.log(`🖥️ Opening POS Dedicated App Window via ${path.basename(browserExe)}...`);
    appProcess = spawn(browserExe, [`--app=${appUrl}`, '--start-maximized'], {
      detached: false,
      stdio: 'ignore'
    });
  } else {
    console.log('🖥️ Opening default browser to POS...');
    appProcess = spawn('cmd.exe', ['/c', 'start', appUrl], {
      detached: false,
      stdio: 'ignore'
    });
  }

  // When user closes the browser app window, terminate backend immediately
  if (appProcess) {
    appProcess.on('close', () => {
      console.log('👋 POS window closed by user.');
      cleanupBackend();
    });
    appProcess.on('exit', () => {
      cleanupBackend();
    });
  }
}

// Begin health check
setTimeout(checkHealth, 500);
