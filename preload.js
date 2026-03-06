const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spinerAPI', {
  // App info
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  checkXray: () => ipcRenderer.invoke('check-xray'),

  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),

  // VPN Connection
  connect: (server) => ipcRenderer.invoke('connect', server),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  pingServer: (host) => ipcRenderer.invoke('ping-server', host),

  // Servers
  getServers: () => ipcRenderer.invoke('get-servers'),
  saveServers: (servers) => ipcRenderer.invoke('save-servers', servers),

  // Subscriptions
  getSubscriptions: () => ipcRenderer.invoke('get-subscriptions'),
  saveSubscriptions: (subs) => ipcRenderer.invoke('save-subscriptions', subs),
  fetchSubscription: (url) => ipcRenderer.invoke('fetch-subscription', url),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Config parsing
  parseConfig: (text) => ipcRenderer.invoke('parse-config', text),

  // Stats
  getNetworkStats: () => ipcRenderer.invoke('get-network-stats'),

  // Utilities
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),

  // Events from main process
  onConnectionStatus: (cb) => ipcRenderer.on('connection-status', (_, data) => cb(data)),
  onTrayToggle: (cb) => ipcRenderer.on('tray-toggle-connection', () => cb()),
  onTrayNavigate: (cb) => ipcRenderer.on('tray-navigate', (_, page) => cb(page)),
  onXrayLog: (cb) => ipcRenderer.on('xray-log', (_, data) => cb(data)),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
