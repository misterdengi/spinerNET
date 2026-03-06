const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');

// ── GPU / POWER OPTIMIZATIONS ──────────────────────────
// Disable GPU rasterization — Electron uses GPU for compositing by default
// which causes 20-30% GPU usage even for a static window.
// Software rasterization uses CPU instead (much cheaper for this type of UI).
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('enable-zero-copy');
// Limit to 30fps max when window is not focused
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('renderer-process-limit', '1');

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
    icon: path.join(__dirname, 'renderer/assets/icon.png'),
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
    // Hysteria2 is not supported by xray-core natively.
    // Requires a separate hysteria2 binary (https://github.com/apernet/hysteria/releases)
    throw new Error(
      'Hysteria2 is not supported by xray-core.\n' +
      'Please use a server with VMess, VLESS, Trojan, or Shadowsocks protocol instead.'
    );
  }

  else if (server.type === 'tuic') {
    // TUIC v5 is not supported by xray-core natively.
    // Requires sing-box or a dedicated TUIC client.
    throw new Error(
      'TUIC is not supported by xray-core.\n' +
      'Please use a server with VMess, VLESS, Trojan, or Shadowsocks protocol instead.'
    );
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
      domainStrategy: 'AsIs',
      rules: [
        {
          type: 'field',
          ip: [
            '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10',
            '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
            '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24',
            '203.0.113.0/24', '::1/128', 'fc00::/7', 'fe80::/10'
          ],
          outboundTag: 'direct'
        }
      ]
    },
    dns: {
      servers: ['1.1.1.1', '8.8.8.8']
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

// --- System Proxy ---
// Sets proxy via 3 mechanisms: WinInet registry, WinHTTP netsh, and PAC file
// so Chrome, Edge, PowerShell, .NET, system services all pick it up

function writePacFile(port) {
  const pac = `function FindProxyForURL(url, host) {
  if (isPlainHostName(host) || shExpMatch(host, "localhost") ||
      isInNet(host, "127.0.0.0", "255.0.0.0") ||
      isInNet(host, "10.0.0.0", "255.0.0.0") ||
      isInNet(host, "172.16.0.0", "255.240.0.0") ||
      isInNet(host, "192.168.0.0", "255.255.0.0")) {
    return "DIRECT";
  }
  return "PROXY 127.0.0.1:${port}; DIRECT";
}`;
  const pacPath = path.join(DATA_DIR, 'proxy.pac');
  fs.writeFileSync(pacPath, pac, 'utf8');
  return pacPath;
}

function setSystemProxy(port) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(); return; }

    const proxyStr = `127.0.0.1:${port}`;
    const bypass   = 'localhost;127.*;10.*;172.16.*;192.168.*;<local>';
    const regKey   = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

    // Write PAC file for browsers that prefer it
    let pacUrl = '';
    try {
      const pacPath = writePacFile(port);
      pacUrl = `file:///${pacPath.replace(/\\/g, '/')}`;
    } catch(e) { console.error('PAC write error:', e.message); }

    // 1) WinInet registry (IE/Chrome/Edge legacy)
    const regCmds = [
      `reg add "${regKey}" /v ProxyEnable /t REG_DWORD /d 1 /f`,
      `reg add "${regKey}" /v ProxyServer /t REG_SZ /d "${proxyStr}" /f`,
      `reg add "${regKey}" /v ProxyOverride /t REG_SZ /d "${bypass}" /f`,
    ];
    if (pacUrl) {
      regCmds.push(`reg add "${regKey}" /v AutoConfigURL /t REG_SZ /d "${pacUrl}" /f`);
    }

    exec(regCmds.join(' && '), (regErr) => {
      if (regErr) console.error('[proxy] registry error:', regErr.message);

      // 2) WinHTTP (PowerShell, .NET, Windows services)
      exec(`netsh winhttp set proxy proxy-server="${proxyStr}" bypass-list="${bypass}"`, (httErr) => {
        if (httErr) console.error('[proxy] netsh winhttp error:', httErr.message);

        // 3) Notify WinInet apps (Chrome, Edge) via InternetSetOption
        const ps = [
          `$t = Add-Type -PassThru -Namespace W -Name I -MemberDefinition '[DllImport("wininet.dll")]public static extern bool InternetSetOption(IntPtr a,int b,IntPtr c,int d);' -ErrorAction SilentlyContinue`,
          `if($t){$t::InternetSetOption(0,39,0,0)|Out-Null;$t::InternetSetOption(0,37,0,0)|Out-Null}`
        ].join(';');
        exec(`powershell -NoProfile -NonInteractive -Command "${ps}"`, (psErr) => {
          if (psErr) console.error('[proxy] ps refresh error:', psErr.message);
          console.log(`[proxy] set → ${proxyStr}`);
          resolve();
        });
      });
    });
  });
}

function clearSystemProxy() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(); return; }

    const regKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const regCmds = [
      `reg add "${regKey}" /v ProxyEnable /t REG_DWORD /d 0 /f`,
      `reg delete "${regKey}" /v AutoConfigURL /f`,
    ];

    exec(regCmds.join(' & '), (regErr) => {
      if (regErr) console.error('[proxy] clear registry error:', regErr.message);

      exec('netsh winhttp reset proxy', (httErr) => {
        if (httErr) console.error('[proxy] netsh reset error:', httErr.message);

        const ps = [
          `$t = Add-Type -PassThru -Namespace W -Name I -MemberDefinition '[DllImport("wininet.dll")]public static extern bool InternetSetOption(IntPtr a,int b,IntPtr c,int d);' -ErrorAction SilentlyContinue`,
          `if($t){$t::InternetSetOption(0,39,0,0)|Out-Null;$t::InternetSetOption(0,37,0,0)|Out-Null}`
        ].join(';');
        exec(`powershell -NoProfile -NonInteractive -Command "${ps}"`, (psErr) => {
          if (psErr) console.error('[proxy] ps refresh error:', psErr.message);
          console.log('[proxy] cleared');
          resolve();
        });
      });
    });
  });
}

// Check if xray is actually listening on a port
function waitForPort(port, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      const sock = new net.Socket();
      sock.setTimeout(500);
      sock.connect(port, '127.0.0.1', () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() < deadline) setTimeout(attempt, 300);
        else reject(new Error(`xray did not open port ${port} within ${timeoutMs}ms`));
      });
      sock.on('timeout', () => {
        sock.destroy();
        if (Date.now() < deadline) setTimeout(attempt, 300);
        else reject(new Error(`xray port ${port} timeout after ${timeoutMs}ms`));
      });
    }
    attempt();
  });
}

// --- Find xray binary ---
function getXrayPath() {
  // When packaged with asarUnpack, binaries live in app.asar.unpacked/
  const asarUnpacked = __dirname.replace('app.asar', 'app.asar.unpacked');
  const candidates = [
    path.join(asarUnpacked, 'bin', 'xray.exe'),       // packaged (Windows)
    path.join(asarUnpacked, 'bin', 'xray'),            // packaged (Linux/Mac)
    path.join(__dirname, 'bin', 'xray.exe'),           // dev mode (Windows)
    path.join(__dirname, 'bin', 'xray'),               // dev mode (Linux/Mac)
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
      const settings   = loadJSON(CONFIG_FILE, {});
      const httpPort   = settings.proxyPort  || 10808;
      const socksPort  = settings.socksPort  || 10809;

      // Kill previous process if any
      if (vpnProcess) {
        try { vpnProcess.kill('SIGTERM'); } catch {}
        vpnProcess = null;
        await new Promise(r => setTimeout(r, 600));
      }

      const xrayPath = getXrayPath();
      if (!xrayPath) {
        return reject(new Error('xray.exe не найден. Переустановите приложение.'));
      }

      // Build and write config
      let xrayCfg;
      try {
        xrayCfg = buildXrayConfig(server, httpPort, socksPort);
      } catch (cfgErr) {
        return reject(cfgErr);
      }

      const cfgPath = path.join(DATA_DIR, 'xray-runtime.json');
      fs.writeFileSync(cfgPath, JSON.stringify(xrayCfg, null, 2));
      console.log('[SpinerNET] config →', cfgPath);
      console.log('[SpinerNET] xray  →', xrayPath);

      if (mainWindow) mainWindow.webContents.send('xray-log', {
        level: 'info', msg: `Starting xray: ${server.type}://${server.address}:${server.port}`
      });

      const xrayDir    = path.dirname(xrayPath);
      let   startupLog = '';
      let   crashed    = false;

      vpnProcess = spawn(xrayPath, ['run', '-config', cfgPath], {
        stdio:    ['ignore', 'pipe', 'pipe'],
        detached: false,
        cwd:      xrayDir,
        env:      { ...process.env, PATH: xrayDir + ';' + process.env.PATH }
      });

      vpnProcess.stdout.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) {
          console.log('[xray out]', msg);
          startupLog += msg + '\n';
          if (mainWindow) mainWindow.webContents.send('xray-log', { level: 'info', msg });
        }
      });

      vpnProcess.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) {
          console.log('[xray err]', msg);
          startupLog += msg + '\n';
          if (mainWindow) mainWindow.webContents.send('xray-log', {
            level: msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed') ? 'error' : 'info',
            msg
          });
        }
      });

      vpnProcess.on('error', (err) => {
        crashed = true;
        console.error('[xray spawn error]', err.message);
      });

      vpnProcess.on('exit', (code, signal) => {
        crashed = true;
        vpnProcess = null;
        console.log(`[xray] exit code=${code} signal=${signal}`);
        if (isConnected) {
          isConnected = false;
          clearSystemProxy();
          updateTrayMenu();
          if (mainWindow) mainWindow.webContents.send('connection-status', {
            connected: false,
            reason: `xray exited (code ${code})`
          });
        }
      });

      // Give xray 300ms to fail fast (bad config, missing DLL, etc)
      await new Promise(r => setTimeout(r, 300));
      if (crashed || !vpnProcess) {
        const errLog = startupLog.slice(-800) || 'xray crashed immediately';
        return reject(new Error('xray завершился сразу после запуска:\n' + errLog));
      }

      // Now verify xray actually opened the port (real readiness check)
      try {
        await waitForPort(httpPort, 8000);
      } catch (portErr) {
        // xray is running but port isn't open - kill it and report logs
        try { vpnProcess && vpnProcess.kill(); } catch {}
        vpnProcess = null;
        const detail = startupLog.slice(-800) || portErr.message;
        return reject(new Error(`xray запустился, но порт ${httpPort} не открылся.\n\nЛоги xray:\n${detail}`));
      }

      if (crashed || !vpnProcess) {
        return reject(new Error('xray завершился во время ожидания порта:\n' + startupLog.slice(-800)));
      }

      // xray is listening — set proxy and report success
      isConnected         = true;
      currentConfig       = server;
      connectedServerName = server ? server.name : null;
      connectedServerProto = server ? server.type : null;
      updateTrayMenu();

      await setSystemProxy(httpPort);
      console.log('[SpinerNET] connected via', server.type, server.address);
      resolve({ success: true, httpPort, socksPort });

    } catch (err) {
      reject(err);
    }
  });
}

function disconnectVPN() {
  return new Promise(async (resolve) => {
    if (vpnProcess) {
      const proc = vpnProcess;
      vpnProcess = null;
      try { proc.kill('SIGTERM'); } catch {}
      // Wait up to 2s for graceful exit, then force kill
      await new Promise(r => {
        const tid = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch {}
          r();
        }, 2000);
        proc.once('exit', () => { clearTimeout(tid); r(); });
      });
    }
    await clearSystemProxy();
    isConnected          = false;
    currentConfig        = null;
    connectedServerName  = null;
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
        security: json.tls === 'tls' ? 'tls' : 'none',
        tls: json.tls === 'tls',
        path: json.path || '/',
        host: json.host || '',
        sni: json.sni || json.host || '',
        fp: json.fp || '',
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

// Fetch real external IP through the running proxy
ipcMain.handle('get-external-ip', async () => {
  const settings  = loadJSON(CONFIG_FILE, {});
  const httpPort  = settings.proxyPort || 10808;
  return new Promise((resolve) => {
    const http = require('http');
    // Use ip-api.com via our local HTTP proxy
    const req = http.request({
      host: '127.0.0.1',
      port: httpPort,
      method: 'GET',
      path: 'http://ip-api.com/json/',
      headers: { Host: 'ip-api.com' },
      timeout: 8000
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          resolve({ ok: true, ip: j.query, country: j.country, isp: j.isp });
        } catch { resolve({ ok: false, error: 'bad response' }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.end();
  });
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
