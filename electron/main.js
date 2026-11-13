const { app, BrowserWindow, Menu, dialog, screen, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');

let mainWindow = null;
let customerDisplayWindow = null;
let splashWindow = null;
let stationSetupWindow = null;
let backendProcess = null;
let isQuitting = false;
let activeStationConfig = null;

// 🔒 1. Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Paths configuration
const isDev = !app.isPackaged;
const backendDir = isDev
  ? path.join(__dirname, '..', 'backend')
  : path.join(process.resourcesPath, 'backend');

const serverJs = path.join(backendDir, 'server.js');

function getNodeExecutable() {
  if (isDev) {
    return 'node';
  }
  const bundledNode = path.join(process.resourcesPath, 'bin', 'node.exe');
  if (fs.existsSync(bundledNode)) {
    return bundledNode;
  }
  return 'node';
}

let isShowingCloseConfirm = false;

// 🛑 Graceful shutdown helper for backend and Electron
async function performControlledShutdown() {
  if (isQuitting) return;
  isQuitting = true;

  console.log('🛑 [ControlledShutdown] Initiating graceful shutdown...');

  // 1. Notify backend to rollback transactions and close database pools
  try {
    const postData = JSON.stringify({});
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/admin/shutdown',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 1500
    });
    req.on('error', () => {});
    req.write(postData);
    req.end();
  } catch {}

  // Allow short grace period (600ms) for clean connection pool drain
  await new Promise((resolve) => setTimeout(resolve, 600));

  closeCustomerDisplayWindow();
  killBackend();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
  app.quit();
}

// 🛑 Kill backend process cleanly
function killBackend() {
  if (backendProcess && backendProcess.pid) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${backendProcess.pid} /T /F`, { stdio: 'ignore' });
      } else {
        backendProcess.kill('SIGTERM');
      }
    } catch {}
    backendProcess = null;
  }
}

// ============================================
// 📡 STATION CONFIGURATION (SERVER VS CLIENT)
// ============================================
function getStationConfigPath() {
  return path.join(app.getPath('userData'), 'station-config.json');
}

function loadStationConfig() {
  const cfgPath = getStationConfigPath();
  if (fs.existsSync(cfgPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (data && data.mode) {
        activeStationConfig = data;
        return data;
      }
    } catch (e) {
      console.warn('⚠️ Could not parse station-config.json:', e.message);
    }
  }

  // Check adjacent to app for portable / pre-configured setups
  const appRootDir = isDev ? path.join(__dirname, '..') : path.dirname(process.execPath);
  const portableCfg = path.join(appRootDir, 'station-config.json');
  if (fs.existsSync(portableCfg)) {
    try {
      const data = JSON.parse(fs.readFileSync(portableCfg, 'utf8'));
      if (data && data.mode) {
        activeStationConfig = data;
        return data;
      }
    } catch (_) {}
  }

  const defaultCfg = {
    mode: 'server', // 'server' | 'client'
    serverHost: 'localhost',
    serverPort: 3000
  };
  activeStationConfig = defaultCfg;
  return defaultCfg;
}

function saveStationConfigSync(cfg) {
  const cfgPath = getStationConfigPath();
  try {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    activeStationConfig = cfg;
    console.log('✅ [StationConfig] Saved configuration:', cfg);
    return true;
  } catch (e) {
    console.error('❌ Failed to save station-config.json:', e.message);
    return false;
  }
}

function getLocalIPAddresses() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

function getTargetServerUrl() {
  const cfg = activeStationConfig || loadStationConfig();
  if (cfg.mode === 'client' && cfg.serverHost && cfg.serverHost !== 'localhost') {
    return `http://${cfg.serverHost}:${cfg.serverPort || 3000}`;
  }
  return 'http://localhost:3000';
}

function createStationSetupWindow() {
  if (stationSetupWindow && !stationSetupWindow.isDestroyed()) {
    stationSetupWindow.focus();
    return;
  }
  stationSetupWindow = new BrowserWindow({
    width: 600,
    height: 720,
    minWidth: 500,
    minHeight: 600,
    title: 'UniPro POS - Station Setup',
    frame: true,
    autoHideMenuBar: true,
    center: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  stationSetupWindow.loadFile(path.join(__dirname, 'station-setup.html'));
  stationSetupWindow.on('closed', () => {
    stationSetupWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('get-station-config', () => {
  return loadStationConfig();
});

ipcMain.handle('save-station-config', async (event, newConfig) => {
  saveStationConfigSync(newConfig);
  if (stationSetupWindow && !stationSetupWindow.isDestroyed()) {
    stationSetupWindow.close();
    stationSetupWindow = null;
  }

  if (newConfig.mode === 'server') {
    await startBackend();
  }

  const targetUrl = getTargetServerUrl();
  console.log(`🌐 [StationConfig] Connecting POS UI to: ${targetUrl}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(targetUrl);
    if (!mainWindow.isVisible()) mainWindow.show();
  } else {
    createMainWindow();
  }

  if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
    customerDisplayWindow.loadURL(`${targetUrl}/customer-display-standalone`);
  }
  return { success: true };
});

ipcMain.handle('test-server-connection', async (event, host, port) => {
  return new Promise((resolve) => {
    const p = port || 3000;
    const req = http.get(`http://${host}:${p}/health`, (res) => {
      resolve({ success: res.statusCode === 200, status: res.statusCode });
    });
    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    req.setTimeout(3500, () => {
      req.destroy();
      resolve({ success: false, error: 'Connection timed out (3.5s)' });
    });
  });
});

ipcMain.handle('get-local-ips', () => {
  return getLocalIPAddresses();
});

ipcMain.handle('close-setup-window', () => {
  if (stationSetupWindow && !stationSetupWindow.isDestroyed()) {
    stationSetupWindow.close();
    stationSetupWindow = null;
  }
});

// 🚀 Start backend server
function startBackend() {
  return new Promise((resolve) => {
    // First, check if backend is already running (e.g. on port 3000)
    checkBackendHealth('localhost', 3000, (isAlreadyRunning) => {
      if (isAlreadyRunning) {
        console.log('✅ Backend is already running on http://localhost:3000');
        return resolve();
      }

      if (!fs.existsSync(serverJs)) {
        dialog.showErrorBox(
          'Backend Missing',
          `Could not locate backend server at:\n${serverJs}`
        );
        app.quit();
        return;
      }

      const nodeBin = getNodeExecutable();
      console.log(`🚀 Starting backend with: ${nodeBin} at ${backendDir}`);

      // Standardized persistent log directory for Smart POS: %ProgramData%\SmartPOS\logs
      const programData = process.env.ProgramData || "C:\\ProgramData";
      let logDir = path.join(programData, "SmartPOS", "logs");
      try {
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      } catch {
        logDir = path.join(app.getPath("userData"), "logs");
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      }
      const backendStartupLog = path.join(logDir, "backend-startup.log");
      let startupErrors = '';

      backendProcess = spawn(nodeBin, ['server.js'], {
        cwd: backendDir,
        env: { ...process.env, PORT: '3000', LOGS_DIR: logDir },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      backendProcess.stdout.on('data', (data) => {
        const text = data.toString();
        try { fs.appendFileSync(backendStartupLog, text); } catch {}
      });

      backendProcess.stderr.on('data', (data) => {
        const text = data.toString();
        startupErrors += text;
        try { fs.appendFileSync(backendStartupLog, text); } catch {}
      });

      backendProcess.on('exit', (code) => {
        if (code !== 0 && code !== null && !isQuitting) {
          console.error(`Backend process exited with code ${code}`);
          const lastErr = startupErrors.trim() || `Process exited with code ${code}`;
          dialog.showErrorBox(
            'Backend Startup Error',
            `The UniPro POS backend server failed to start:\n\n${lastErr}`
          );
          app.quit();
        }
      });

      // Poll until backend is online (up to 80 attempts = 40 seconds)
      waitForBackend(80, startupErrors, resolve);
    });
  });
}

let isBackendReady = false;

function checkBackendHealth(targetHost, targetPort, callback) {
  let finished = false;
  const finish = (result) => {
    if (!finished) {
      finished = true;
      callback(result);
    }
  };

  const host = targetHost || 'localhost';
  const port = targetPort || 3000;

  const req = http.get(`http://${host}:${port}/health`, (res) => {
    finish(res.statusCode === 200);
  });

  req.on('error', () => {
    finish(false);
  });

  req.setTimeout(1500, () => {
    req.destroy();
    finish(false);
  });
}

function waitForBackend(retries, startupErrors, callback) {
  if (isBackendReady) return;

  if (retries <= 0) {
    if (isBackendReady) return;
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy();
      splashWindow = null;
    }
    dialog.showMessageBox({
      type: 'question',
      title: 'Local Database Server Not Found',
      message: 'Could not connect to a local database server on this PC.\n\nIs this computer a Client Terminal (Cashier 2 / Waiter) connecting to another PC over Wi-Fi / LAN?',
      buttons: ['Configure Station (Client Mode)', 'Exit Application']
    }).then(({ response }) => {
      if (response === 0) {
        createStationSetupWindow();
      } else {
        app.quit();
      }
    });
    return;
  }

  checkBackendHealth('localhost', 3000, (isHealthy) => {
    if (isBackendReady) return;

    if (isHealthy) {
      isBackendReady = true;
      callback();
    } else {
      setTimeout(() => {
        if (!isBackendReady) {
          waitForBackend(retries - 1, startupErrors, callback);
        }
      }, 500);
    }
  });
}

// 🪟 Create Splash Window
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 320,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

// 🖥️ Create Main Window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 600,
    title: 'Smart POS',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  Menu.setApplicationMenu(null);

  const targetUrl = getTargetServerUrl();
  console.log(`🌐 [MainWindow] Connecting POS UI to: ${targetUrl}`);
  mainWindow.loadURL(targetUrl);

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy();
      splashWindow = null;
    }
    mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
  });

  // Handle reload shortcuts (F5, Ctrl+R), Fullscreen (F11), Customer Display Toggle (Ctrl+Shift+D), and Station Setup (Ctrl+Shift+S)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
    if ((input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) && input.type === 'keyDown') {
      mainWindow.reload();
      event.preventDefault();
    }
    // ⚙️ Quick Shortcut to Open Station Setup (Ctrl+Shift+S)
    if (input.control && input.shift && input.key.toLowerCase() === 's' && input.type === 'keyDown') {
      createStationSetupWindow();
      event.preventDefault();
    }
    // 📁 Quick Shortcut to Open Local Logs Folder (Ctrl+Shift+L)
    if (input.control && input.shift && input.key.toLowerCase() === 'l' && input.type === 'keyDown') {
      const { shell } = require('electron');
      const programData = process.env.ProgramData || "C:\\ProgramData";
      const targetLogDir = path.join(programData, "SmartPOS", "logs");
      if (fs.existsSync(targetLogDir)) {
        shell.openPath(targetLogDir);
      } else {
        const fallback = path.join(app.getPath('userData'), 'logs');
        if (fs.existsSync(fallback)) shell.openPath(fallback);
      }
      event.preventDefault();
    }
    // 🖥️ Manual toggle/preview for Customer Display (Ctrl+Shift+D)
    if (input.control && input.shift && input.key.toLowerCase() === 'd' && input.type === 'keyDown') {
      if (!customerDisplayWindow || customerDisplayWindow.isDestroyed()) {
        const secondary = getSecondaryDisplay();
        if (secondary) {
          createCustomerDisplayWindow();
        } else {
          // Single-screen preview mode
          const primary = screen.getPrimaryDisplay();
          const w = Math.min(1024, Math.round(primary.bounds.width * 0.75));
          const h = Math.min(600, Math.round(primary.bounds.height * 0.75));
          customerDisplayWindow = new BrowserWindow({
            width: w,
            height: h,
            title: 'UniPro POS - Customer Display (Preview)',
            autoHideMenuBar: true,
            icon: path.join(__dirname, 'icon.png'),
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              webSecurity: true,
            },
          });
          customerDisplayWindow.loadURL(`${getTargetServerUrl()}/customer-display-standalone`);
          customerDisplayWindow.on('closed', () => {
            customerDisplayWindow = null;
          });
        }
      } else {
        closeCustomerDisplayWindow();
      }
      event.preventDefault();
    }
  });

  // 🛑 Window close confirmation with Yes / No dialog
  mainWindow.on('close', async (event) => {
    if (isQuitting) return; // Allow close if intentional shutdown in progress

    event.preventDefault(); // Prevent immediate closing

    if (isShowingCloseConfirm) return; // Prevent duplicate confirmation dialogs
    isShowingCloseConfirm = true;

    try {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Yes', 'No'],
        defaultId: 1, // Default to No (safe default)
        cancelId: 1,  // Esc key selects No
        title: 'Close Smart POS?',
        message: 'Are you sure you want to close the application?'
      });

      isShowingCloseConfirm = false;

      if (response === 0) {
        // User clicked Yes: perform controlled graceful shutdown
        await performControlledShutdown();
      } else {
        // User clicked No: cancel closing and keep running
        console.log('ℹ️ [Window] Close canceled by user.');
      }
    } catch (err) {
      isShowingCloseConfirm = false;
      console.error('⚠️ [Window] Error in close confirmation:', err.message);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    closeCustomerDisplayWindow();
    if (!isQuitting) {
      isQuitting = true;
      killBackend();
      app.quit();
    }
  });
}

// 🖥️ 1. Detect Secondary Display (Customer-Facing Monitor)
function getSecondaryDisplay() {
  try {
    const primary = screen.getPrimaryDisplay();
    const all = screen.getAllDisplays();
    return all.find((d) => d.id !== primary.id) || null;
  } catch {
    return null;
  }
}

// 🖥️ 2. Create Customer Display Window on Secondary Screen
function createCustomerDisplayWindow() {
  const secondary = getSecondaryDisplay();
  if (!secondary) {
    console.log('🖥️ [CustomerDisplay] Only 1 monitor detected. Skipping customer display.');
    return;
  }

  if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
    console.log('🖥️ [CustomerDisplay] Window already active.');
    return;
  }

  const { x, y, width, height } = secondary.bounds;
  console.log(`🖥️ [CustomerDisplay] Launching on secondary monitor (${width}x${height} at x:${x}, y:${y})...`);

  customerDisplayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    fullscreen: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    skipTaskbar: false,
    title: 'UniPro POS - Customer Display',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  customerDisplayWindow.loadURL(`${getTargetServerUrl()}/customer-display-standalone`);

  customerDisplayWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      customerDisplayWindow.setFullScreen(!customerDisplayWindow.isFullScreen());
      event.preventDefault();
    }
    if ((input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) && input.type === 'keyDown') {
      customerDisplayWindow.reload();
      event.preventDefault();
    }
  });

  customerDisplayWindow.on('closed', () => {
    customerDisplayWindow = null;
  });
}

// 🖥️ 3. Close Customer Display Window
function closeCustomerDisplayWindow() {
  if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
    try {
      customerDisplayWindow.close();
    } catch {}
    customerDisplayWindow = null;
  }
}

// 🖥️ 4. Watch for Secondary Display Plug/Unplug Events
function initDisplayWatcher() {
  try {
    screen.on('display-added', () => {
      console.log('🖥️ [Display Event] Display connected.');
      if (getSecondaryDisplay() && (!customerDisplayWindow || customerDisplayWindow.isDestroyed())) {
        createCustomerDisplayWindow();
      }
    });

    screen.on('display-removed', () => {
      console.log('🖥️ [Display Event] Display removed.');
      if (!getSecondaryDisplay()) {
        closeCustomerDisplayWindow();
      }
    });

    screen.on('display-metrics-changed', () => {
      const secondary = getSecondaryDisplay();
      if (secondary && customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
        const { x, y, width, height } = secondary.bounds;
        customerDisplayWindow.setBounds({ x, y, width, height });
      }
    });
  } catch (err) {
    console.error('🖥️ [Display Event] Failed to initialize display watcher:', err.message);
  }
}

app.whenReady().then(async () => {
  createSplashWindow();
  const cfg = loadStationConfig();

  if (cfg.mode === 'client') {
    console.log(`🔌 [Station] Starting in CLIENT TERMINAL mode connecting to ${cfg.serverHost}:${cfg.serverPort}...`);
    checkBackendHealth(cfg.serverHost, cfg.serverPort, (isHealthy) => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      if (isHealthy) {
        console.log(`✅ [Station] Connected to Main Server at ${cfg.serverHost}:${cfg.serverPort}`);
        createMainWindow();
        initDisplayWatcher();
        createCustomerDisplayWindow();
      } else {
        console.warn(`⚠️ [Station] Could not reach Main Server at ${cfg.serverHost}:${cfg.serverPort}`);
        createStationSetupWindow();
      }
    });
  } else {
    await startBackend();
    createMainWindow();
    initDisplayWatcher();
    createCustomerDisplayWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createCustomerDisplayWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  closeCustomerDisplayWindow();
  killBackend();
});

app.on('window-all-closed', () => {
  closeCustomerDisplayWindow();
  killBackend();
  app.quit();
});
