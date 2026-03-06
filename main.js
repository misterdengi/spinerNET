const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');

let mainWindow;
let tray;
let vpnProcess = null;
let isConnected = false;
let currentConfig = null;

const DATA_DIR = path.join(app.getPath('userData'), 'SpinerNET');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(filePath, defaultVal) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load JSON:', filePath, e);
  }
  return defaultVal;
}

function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to save JSON:', filePath, e);
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: '#09090f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    },
    icon: process.platform === 'win32'
      ? path.join(__dirname, 'renderer/assets/icon.ico')
      : path.join(__dirname, 'renderer/assets/icon.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function buildTrayIcon() {
  // Try loading the PNG file first
  const iconPath = path.join(__dirname, 'renderer/assets/tray.png');
  try {
    if (fs.existsSync(iconPath)) {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) return img;
    }
  } catch {}

  // Fallback: generate icon programmatically as a data URL (16x16 white circle)
  try {
    const S = 32;
    function dist(x1,y1,x2,y2){ return Math.sqrt((x1-x2)**2+(y1-y2)**2); }
    const zlib = require('zlib');
    const px = new Uint8Array(S * S * 4);
    const cx = S/2 - 0.5, cy = S/2 - 0.5;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const d = dist(x, y, cx, cy);
        const outerR = S * 0.46, dotR = S * 0.12;
        const dx = x-cx, dy = y-cy;
        const armW = 1.0, armS = dotR*1.5, armE = outerR*0.82;
        let a = 0;
        if (d >= outerR - 1.5 && d <= outerR) a = 230;
        if (d <= dotR) a = 240;
        if (Math.abs(dx) <= armW && Math.abs(dy) >= armS && Math.abs(dy) <= armE) a = Math.max(a, 200);
        if (Math.abs(dy) <= armW && Math.abs(dx) >= armS && Math.abs(dx) <= armE) a = Math.max(a, 200);
        px[i]=255; px[i+1]=255; px[i+2]=255; px[i+3]=a;
      }
    }
    function w4(v){ const b=Buffer.alloc(4); b.writeUInt32BE(v>>>0,0); return b; }
    function crc32(buf){
      const t=[];
      for(let i=0;i<256;i++){ let c=i; for(let j=0;j<8;j++) c=(c&1)?0xEDB88320^(c>>>1):c>>>1; t[i]=c; }
      let c=0xFFFFFFFF;
      for(const b of buf) c=t[(c^b)&0xFF]^(c>>>8);
      return (c^0xFFFFFFFF)>>>0;
    }
    function chunk(type,data){
      const t=Buffer.from(type), cc=Buffer.concat([t,data]);
      return Buffer.concat([w4(data.length),t,data,w4(crc32(cc))]);
    }
    const sig=Buffer.from([137,80,78,71,13,10,26,10]);
    const ihdr=chunk('IHDR',Buffer.concat([w4(S),w4(S),Buffer.from([8,6,0,0,0])]));
    const raw=[];
    for(let y=0;y<S;y++){ raw.push(0); for(let x=0;x<S;x++){ const i=(y*S+x)*4; raw.push(px[i],px[i+1],px[i+2],px[i+3]); } }
    const idat=chunk('IDAT',zlib.deflateSync(Buffer.from(raw)));
    const iend=chunk('IEND',Buffer.alloc(0));
    const pngBuf=Buffer.concat([sig,ihdr,idat,iend]);
    const img = nativeImage.createFromBuffer(pngBuf);
    if (!img.isEmpty()) return img;
  } catch (e) {
    console.error('Fallback icon gen failed:', e);
  }

  return nativeImage.createEmpty();
}

let connectedServerName = null;
let connectedServerProto = null;

function createTray() {
  const icon = buildTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('SpinerNET');

  // Single-click: show context menu on all platforms
  tray.on('click', () => {
    updateTrayMenu();
    tray.popUpContextMenu();
  });

  // Double-click: open window
  tray.on('double-click', () => {
    showMainWindow();
  });

  updateTrayMenu();
}

function showMainWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  if (mainWindow.isMinimized()) mainWindow.restore();
}

function updateTrayMenu() {
  if (!tray) return;

  const statusLabel = isConnected
    ? `● Connected${connectedServerName ? ' — ' + connectedServerName : ''}`
    : '○ Disconnected';

  const menu = Menu.buildFromTemplate([
    // Header — app name
    {
      label: 'SpinerNET',
      enabled: false,
      icon: (() => {
        try {
          const p = path.join(__dirname, 'renderer/assets/tray.png');
          if (fs.existsSync(p)) {
            const img = nativeImage.createFromPath(p).resize({ width: 16, height: 16 });
            return img.isEmpty() ? undefined : img;
          }
        } catch {}
        return undefined;
      })()
    },
    { type: 'separator' },

    // Status
    {
      label: statusLabel,
      enabled: false,
    },

    // Protocol + server info if connected
    ...(isConnected && connectedServerProto ? [{
      label: `Protocol: ${connectedServerProto.toUpperCase()}`,
      enabled: false,
    }] : []),

    { type: 'separator' },

    // Main action
    {
      label: isConnected ? '⏹  Disconnect' : '▶  Connect',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('tray-toggle-connection');
        }
      }
    },

    { type: 'separator' },

    // Open window
    {
      label: '🗖  Open SpinerNET',
      click: showMainWindow,
    },

    // Navigate sections
    {
      label: 'Servers',
      click: () => {
        showMainWindow();
        setTimeout(() => {
          if (mainWindow) mainWindow.webContents.send('tray-navigate', 'servers');
        }, 200);
      }
    },
    {
      label: 'Settings',
      click: () => {
        showMainWindow();
        setTimeout(() => {
          if (mainWindow) mainWindow.webContents.send('tray-navigate', 'settings');
        }, 200);
      }
    },

    { type: 'separator' },

    // Quit
    {
      label: '✕  Quit',
      accelerator: 'CmdOrCtrl+Q',
      click: () => {
        disconnectVPN().finally(() => {
          tray = null;
          app.exit(0);
        });
      }
    }
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(isConnected ? `SpinerNET — Connected` : 'SpinerNET — Offline');
}

// --- Xray config generator ---
function buildXrayConfig(server, httpPort, socksPort) {
  const inbounds = [
    {
      tag: 'http-in',
      port: httpPort || 10808,
      listen: '127.0.0.1',
      protocol: 'http',
      settings: { allowTransparent: false }
    },
    {
      tag: 'socks-in',
      port: socksPort || 10809,
      listen: '127.0.0.1',
      protocol: 'socks',
      settings: { udp: true }
    }
  ];

  let outbound = null;

  if (server.type === 'vmess') {
    outbound = {
      tag: 'proxy',
      protocol: 'vmess',
      settings: {
        vnext: [{
          address: server.address,
          port: server.port,
          users: [{
            id: server.uuid,
            alterId: server.alterId || 0,
            security: 'auto'
          }]
        }]
      },
      streamSettings: buildStreamSettings(server)
    };
  }

  else if (server.type === 'vless') {
    outbound = {
      tag: 'proxy',
      protocol: 'vless',
      settings: {
        vnext: [{
          address: server.address,
          port: server.port,
          users: [{
            id: server.uuid,
            flow: server.flow || '',
            encryption: 'none'
          }]
        }]
      },
      streamSettings: buildStreamSettings(server)
    };
  }

  else if (server.type === 'trojan') {
    outbound = {
      tag: 'proxy',
      protocol: 'trojan',
      settings: {
        servers: [{
          address: server.address,
          port: server.port,
          password: server.password,
          flow: server.flow || ''
        }]
      },
      streamSettings: buildStreamSettings(server)
    };
  }

  else if (server.type === 'ss') {
    outbound = {
      tag: 'proxy',
      protocol: 'shadowsocks',
      settings: {
        servers: [{
          address: server.address,
          port: server.port,
          method: server.method || 'aes-256-gcm',
          password: server.password,
          uot: true
        }]
      }
    };
  }

  else if (server.type === 'hysteria2' || server.type === 'hy2') {
    // hysteria2 не поддерживается нативно xray — используем trojan как fallback структуру
    // В реальности нужен sing-box или hysteria2 бинарник
    outbound = {
      tag: 'proxy',
      protocol: 'trojan',
      settings: {
        servers: [{
          address: server.address,
          port: server.port,
          password: server.auth || server.password || ''
        }]
      },
      streamSettings: {
        network: 'tcp',
        security: 'tls',
        tlsSettings: {
          serverName: server.sni || server.address,
          allowInsecure: server.insecure || false
        }
      }
    };
  }

  else if (server.type === 'tuic') {
    outbound = {
      tag: 'proxy',
      protocol: 'vless',
      settings: {
        vnext: [{
          address: server.address,
          port: server.port,
          users: [{ id: server.uuid, encryption: 'none' }]
        }]
      },
      streamSettings: {
        network: 'quic',
        security: 'tls',
        tlsSettings: {
          serverName: server.sni || server.address,
          allowInsecure: false
        }
      }
    };
  }

  else {
    throw new Error(`Unsupported protocol: ${server.type}`);
  }

  return {
    log: { loglevel: 'warning' },
    inbounds,
    outbounds: [
      outbound,
      { tag: 'direct', protocol: 'freedom', settings: {} },
      { tag: 'block', protocol: 'blackhole', settings: {} }
    ],
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' }
      ]
    },
    dns: {
      servers: ['1.1.1.1', '8.8.8.8', 'localhost']
    }
  };
}

function buildStreamSettings(server) {
  const net = server.network || 'tcp';
  const settings = { network: net };

  // TLS / Reality / XTLS
  const sec = server.security || (server.tls ? 'tls' : 'none');

  if (sec === 'reality') {
    settings.security = 'reality';
    settings.realitySettings = {
      serverName: server.sni || server.address,
      fingerprint: server.fp || 'chrome',
      publicKey: server.pbk || '',
      shortId: server.sid || '',
      spiderX: server.spx || '/'
    };
  } else if (sec === 'tls') {
    settings.security = 'tls';
    settings.tlsSettings = {
      serverName: server.sni || server.host || server.address,
      allowInsecure: false,
      fingerprint: server.fp || ''
    };
  } else {
    settings.security = 'none';
  }

  // Transport specific
  if (net === 'ws') {
    settings.wsSettings = {
      path: server.path || '/',
      headers: server.host ? { Host: server.host } : {}
    };
  } else if (net === 'grpc') {
    settings.grpcSettings = {
      serviceName: server.path || server.serviceName || ''
    };
  } else if (net === 'h2') {
    settings.httpSettings = {
      path: server.path || '/',
      host: server.host ? [server.host] : []
    };
  } else if (net === 'quic') {
    settings.quicSettings = {
      security: 'none',
      key: '',
      header: { type: 'none' }
    };
  } else if (net === 'tcp' && server.headerType === 'http') {
    settings.tcpSettings = {
      header: { type: 'http', request: { path: [server.path || '/'] } }
    };
  }

  return settings;
}

// --- System Proxy (Windows registry) ---
function setSystemProxy(port) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(); return; }
    const proxyServer = `127.0.0.1:${port}`;
    const cmds = [
      `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`,
      `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyServer}" /f`,
      `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "localhost;127.*;10.*;172.16.*;192.168.*;<local>" /f`
    ];
    exec(cmds.join(' && '), (err) => {
      if (err) console.error('Proxy set error:', err);
      resolve();
    });
  });
}

function clearSystemProxy() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(); return; }
    exec(
      `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`,
      (err) => {
        if (err) console.error('Proxy clear error:', err);
        resolve();
      }
    );
  });
}

// --- Find xray binary ---
function getXrayPath() {
  const candidates = [
    // Packaged app: extraResources lands in resources/bin/
    path.join(process.resourcesPath, 'bin', 'xray.exe'),
    path.join(process.resourcesPath, 'bin', 'xray'),
    // Dev mode: bin/ next to main.js
    path.join(__dirname, 'bin', 'xray.exe'),
    path.join(__dirname, 'bin', 'xray'),
    // Fallback: userData
    path.join(app.getPath('userData'), 'bin', 'xray.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// --- VPN Logic ---
function connectVPN(server) {
  return new Promise(async (resolve, reject) => {
    try {
      // Load settings for ports
      const settings = loadJSON(CONFIG_FILE, {});
      const httpPort  = settings.proxyPort  || 10808;
      const socksPort = settings.socksPort  || 10809;

      // Kill any previous process
      if (vpnProcess) {
        vpnProcess.kill('SIGTERM');
        vpnProcess = null;
        await new Promise(r => setTimeout(r, 400));
      }

      const xrayPath = getXrayPath();
      if (!xrayPath) {
        return reject(new Error('xray.exe not found in bin/ folder. Please add it.'));
      }

      // Generate and write config
      const xrayCfg = buildXrayConfig(server, httpPort, socksPort);
      const cfgPath = path.join(DATA_DIR, 'xray-runtime.json');
      fs.writeFileSync(cfgPath, JSON.stringify(xrayCfg, null, 2));

      // Log it
      console.log('[SpinerNET] Xray config written to', cfgPath);
      console.log('[SpinerNET] Launching xray:', xrayPath);

      let resolved = false;
      let startupErrors = '';

      vpnProcess = spawn(xrayPath, ['run', '-config', cfgPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      });

      vpnProcess.stdout.on('data', (data) => {
        const msg = data.toString().trim();
        console.log('[xray]', msg);
        if (mainWindow) mainWindow.webContents.send('xray-log', { level: 'info', msg });

        // Xray prints this when ready
        if (!resolved && (msg.includes('started') || msg.includes('Xray') || msg.includes('inbound'))) {
          resolved = true;
          clearTimeout(timeoutId);
          isConnected = true;
          currentConfig = server;
          connectedServerName = server ? server.name : null;
          connectedServerProto = server ? server.type : null;
          updateTrayMenu();
          setSystemProxy(httpPort).then(() => {
            resolve({ success: true, ip: `127.0.0.1:${httpPort}` });
          });
        }
      });

      vpnProcess.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        console.error('[xray err]', msg);
        startupErrors += msg + '\n';
        if (mainWindow) mainWindow.webContents.send('xray-log', { level: 'error', msg });

        // xray writes normal logs to stderr too
        if (!resolved && (msg.includes('started') || msg.includes('Xray') || msg.includes('inbound'))) {
          resolved = true;
          clearTimeout(timeoutId);
          isConnected = true;
          currentConfig = server;
          connectedServerName = server ? server.name : null;
          connectedServerProto = server ? server.type : null;
          updateTrayMenu();
          setSystemProxy(httpPort).then(() => {
            resolve({ success: true, ip: `127.0.0.1:${httpPort}` });
          });
        }
      });

      vpnProcess.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          reject(new Error('Failed to start xray: ' + err.message));
        }
      });

      vpnProcess.on('exit', (code, signal) => {
        console.log(`[xray] exited code=${code} signal=${signal}`);
        vpnProcess = null;
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          reject(new Error(`xray exited early (code ${code}). Errors:\n${startupErrors.slice(0, 500)}`));
        } else if (isConnected) {
          // Unexpected exit while connected
          isConnected = false;
          clearSystemProxy();
          updateTrayMenu();
          if (mainWindow) mainWindow.webContents.send('connection-status', { connected: false, reason: 'xray process exited' });
        }
      });

      // If xray doesn't print "started" in 6s — still consider it running
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (vpnProcess && !vpnProcess.killed) {
            isConnected = true;
            currentConfig = server;
            connectedServerName = server ? server.name : null;
            connectedServerProto = server ? server.type : null;
            updateTrayMenu();
            setSystemProxy(httpPort).then(() => {
              resolve({ success: true, ip: `127.0.0.1:${httpPort}` });
            });
          } else {
            reject(new Error('xray failed to start. Check logs.\n' + startupErrors.slice(0, 500)));
          }
        }
      }, 6000);

    } catch (err) {
      reject(err);
    }
  });
}

function disconnectVPN() {
  return new Promise(async (resolve) => {
    if (vpnProcess) {
      vpnProcess.kill('SIGTERM');
      // Give it time to exit gracefully
      await new Promise(r => setTimeout(r, 600));
      if (vpnProcess && !vpnProcess.killed) {
        try { vpnProcess.kill('SIGKILL'); } catch {}
      }
      vpnProcess = null;
    }
    await clearSystemProxy();
    isConnected = false;
    currentConfig = null;
    connectedServerName = null;
    connectedServerProto = null;
    updateTrayMenu();
    resolve({ success: true });
  });
}

// Parse subscription/config links
function parseConfigLink(link) {
  link = link.trim();
  
  const protocols = ['vmess://', 'vless://', 'trojan://', 'ss://', 'ssr://', 
                     'tuic://', 'hysteria2://', 'hy2://', 'wg://', 'wireguard://'];
  
  for (const proto of protocols) {
    if (link.startsWith(proto)) {
      return parseSingleLink(link, proto);
    }
  }
  
  // Try as subscription URL
  if (link.startsWith('http://') || link.startsWith('https://')) {
    return { type: 'subscription', url: link };
  }
  
  // Try base64
  try {
    const decoded = Buffer.from(link, 'base64').toString('utf8');
    if (decoded.includes('://')) {
      return parseConfigLink(decoded);
    }
  } catch {}
  
  return null;
}

function parseSingleLink(link, proto) {
  const type = proto.replace('://', '');
  
  try {
    if (type === 'vmess') {
      const b64 = link.substring(8);
      const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      return {
        type: 'vmess',
        name: json.ps || json.add || 'VMess Server',
        address: json.add,
        port: parseInt(json.port) || 443,
        uuid: json.id,
        alterId: json.aid || 0,
        network: json.net || 'tcp',
        tls: json.tls === 'tls',
        path: json.path || '/',
        host: json.host || '',
        raw: link
      };
    }
    
    if (type === 'vless') {
      const url = new URL(link);
      const params = Object.fromEntries(url.searchParams);
      return {
        type: 'vless',
        name: decodeURIComponent(url.hash.slice(1)) || 'VLESS Server',
        address: url.hostname,
        port: parseInt(url.port) || 443,
        uuid: url.username,
        network: params.type || 'tcp',
        security: params.security || 'none',
        flow: params.flow || '',
        sni: params.sni || '',
        fp: params.fp || '',
        pbk: params.pbk || '',
        sid: params.sid || '',
        path: params.path || '/',
        host: params.host || '',
        raw: link
      };
    }
    
    if (type === 'trojan') {
      const url = new URL(link);
      const params = Object.fromEntries(url.searchParams);
      return {
        type: 'trojan',
        name: decodeURIComponent(url.hash.slice(1)) || 'Trojan Server',
        address: url.hostname,
        port: parseInt(url.port) || 443,
        password: url.username,
        network: params.type || 'tcp',
        security: params.security || 'tls',
        sni: params.sni || '',
        raw: link
      };
    }
    
    if (type === 'ss') {
      const url = new URL(link);
      let method, password;
      try {
        const decoded = Buffer.from(url.username, 'base64').toString();
        [method, password] = decoded.split(':');
      } catch {
        method = url.username;
        password = url.password;
      }
      return {
        type: 'ss',
        name: decodeURIComponent(url.hash.slice(1)) || 'Shadowsocks Server',
        address: url.hostname,
        port: parseInt(url.port) || 8388,
        method: method || 'aes-256-gcm',
        password: password || '',
        raw: link
      };
    }
    
    if (type === 'hysteria2' || type === 'hy2') {
      const url = new URL(link);
      const params = Object.fromEntries(url.searchParams);
      return {
        type: 'hysteria2',
        name: decodeURIComponent(url.hash.slice(1)) || 'Hysteria2 Server',
        address: url.hostname,
        port: parseInt(url.port) || 443,
        auth: url.username || url.password || '',
        sni: params.sni || '',
        insecure: params.insecure === '1',
        raw: link
      };
    }
    
    if (type === 'tuic') {
      const url = new URL(link);
      const params = Object.fromEntries(url.searchParams);
      return {
        type: 'tuic',
        name: decodeURIComponent(url.hash.slice(1)) || 'TUIC Server',
        address: url.hostname,
        port: parseInt(url.port) || 443,
        uuid: url.username,
        password: url.password,
        sni: params.sni || '',
        raw: link
      };
    }
  } catch (e) {
    console.error('Parse error:', e);
  }
  
  return {
    type: type,
    name: 'Server',
    address: 'unknown',
    port: 443,
    raw: link
  };
}

// IPC Handlers
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-platform', () => process.platform);

ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window-close', () => {
  if (tray) mainWindow?.hide();
  else app.quit();
});

ipcMain.handle('connect', async (event, server) => {
  try {
    const result = await connectVPN(server);
    mainWindow?.webContents.send('connection-status', { connected: true, server });
    return result;
  } catch (e) {
    console.error('[connect error]', e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('disconnect', async () => {
  try {
    const result = await disconnectVPN();
    mainWindow?.webContents.send('connection-status', { connected: false });
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('check-xray', () => {
  const xrayPath = getXrayPath();
  if (!xrayPath) return { ok: false, error: 'xray.exe not found in bin/ folder' };
  try {
    const stat = fs.statSync(xrayPath);
    return { ok: true, path: xrayPath, size: stat.size };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('ping-server', async (event, host) => {
  return new Promise((resolve) => {
    if (!host) { resolve(null); return; }
    const isWin = process.platform === 'win32';
    const cmd = isWin ? `ping -n 1 -w 2000 ${host}` : `ping -c 1 -W 2 ${host}`;
    const start = Date.now();
    exec(cmd, { timeout: 5000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      // Try to parse time from ping output
      const match = stdout.match(/[Tt]ime[=<](\d+)/);
      if (match) {
        resolve(parseInt(match[1]));
      } else {
        resolve(Date.now() - start);
      }
    });
  });
});

ipcMain.handle('get-servers', () => {
  return loadJSON(SERVERS_FILE, []);
});

ipcMain.handle('save-servers', (event, servers) => {
  return saveJSON(SERVERS_FILE, servers);
});

ipcMain.handle('get-subscriptions', () => {
  return loadJSON(SUBSCRIPTIONS_FILE, []);
});

ipcMain.handle('save-subscriptions', (event, subs) => {
  return saveJSON(SUBSCRIPTIONS_FILE, subs);
});

ipcMain.handle('get-settings', () => {
  return loadJSON(CONFIG_FILE, {
    startWithWindows: false,
    minimizeToTray: true,
    autoConnect: false,
    proxyPort: 10808,
    socksPort: 10809,
    allowLAN: false,
    dnsMode: 'secure',
    customDNS: '1.1.1.1',
    routingMode: 'proxy',
    logLevel: 'warning',
    mtu: 1500,
    theme: 'cosmic',
    language: 'en'
  });
});

ipcMain.handle('save-settings', (event, settings) => {
  return saveJSON(CONFIG_FILE, settings);
});

ipcMain.handle('parse-config', (event, text) => {
  const lines = text.split('\n').filter(l => l.trim());
  const results = [];
  for (const line of lines) {
    const parsed = parseConfigLink(line.trim());
    if (parsed) results.push(parsed);
  }
  return results;
});

ipcMain.handle('fetch-subscription', async (event, url) => {
  try {
    const https = require('https');
    const http = require('http');
    
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            // Try base64 decode
            let content = data;
            try {
              const decoded = Buffer.from(data.trim(), 'base64').toString('utf8');
              if (decoded.includes('://')) content = decoded;
            } catch {}
            
            const lines = content.split('\n').filter(l => l.trim());
            const servers = [];
            for (const line of lines) {
              const parsed = parseConfigLink(line.trim());
              if (parsed && parsed.type !== 'subscription') {
                servers.push(parsed);
              }
            }
            resolve({ success: true, servers, count: servers.length });
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('show-notification', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

// Expose tray navigate as IPC so renderer can receive it
// (sent via webContents.send from tray menu clicks)

ipcMain.handle('get-network-stats', () => {
  // Simulated stats
  return {
    upload: Math.floor(Math.random() * 1024 * 100),
    download: Math.floor(Math.random() * 1024 * 500),
    uploadSpeed: Math.floor(Math.random() * 1024 * 10),
    downloadSpeed: Math.floor(Math.random() * 1024 * 50),
    ping: Math.floor(Math.random() * 100 + 10)
  };
});

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  disconnectVPN();
});
