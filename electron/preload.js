const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  version: '3.0.0',
  getStationConfig: () => ipcRenderer.invoke('get-station-config'),
  saveStationConfig: (config) => ipcRenderer.invoke('save-station-config', config),
  testServerConnection: (host, port) => ipcRenderer.invoke('test-server-connection', host, port),
  getLocalNetworkIPs: () => ipcRenderer.invoke('get-local-ips'),
  closeSetupWindow: () => ipcRenderer.invoke('close-setup-window')
});

