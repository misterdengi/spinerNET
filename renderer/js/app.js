/* ═══════════════════════════════════════════════════════
   SpinerNET — Application Logic v2
   ═══════════════════════════════════════════════════════ */

'use strict';

// ── STATE ──────────────────────────────────────────────
const S = {
  servers: [],
  subscriptions: [],
  settings: {},
  connected: false,
  connecting: false,
  selectedServer: null,
  activeServer: null,
  connectedAt: null,
  statsTimer: null,
  durationTimer: null,
  currentPage: 'dashboard',
  filterProto: 'all',
  searchQ: '',
  detailIdx: null,
  currentTheme: 'void',
};

// ── COSMOS CANVAS ──────────────────────────────────────
function initCosmos() {
  const canvas = document.getElementById('cosmosCanvas');
  const ctx = canvas.getContext('2d');
  let W, H, stars = [], meteors = [], raf;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function mkStar() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.2 + 0.2,
      base: Math.random() * 0.5 + 0.1,
      amp: Math.random() * 0.4,
      speed: Math.random() * 0.008 + 0.002,
      phase: Math.random() * Math.PI * 2,
    };
  }

  function spawnStars(n = 180) {
    stars = Array.from({ length: n }, mkStar);
  }

  function spawnMeteor() {
    const angle = (Math.random() * 20 + 15) * Math.PI / 180;
    meteors.push({
      x: Math.random() * W * 1.5 - W * 0.25,
      y: Math.random() * H * 0.4 - H * 0.1,
      vx: Math.cos(angle) * (6 + Math.random() * 5),
      vy: Math.sin(angle) * (6 + Math.random() * 5),
      life: 1, decay: 0.012 + Math.random() * 0.012,
      len: 80 + Math.random() * 120,
    });
  }

  let t = 0;
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // subtle radial vignette
    const grad = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H) * 0.7);
    grad.addColorStop(0, 'rgba(10,4,20,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    t += 0.016;
    stars.forEach(s => {
      const a = s.base + s.amp * Math.sin(t * s.speed * 60 + s.phase);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fill();
    });

    meteors = meteors.filter(m => {
      m.x += m.vx; m.y += m.vy; m.life -= m.decay;
      if (m.life <= 0) return false;
      const grd = ctx.createLinearGradient(
        m.x, m.y,
        m.x - m.vx * (m.len / m.vx), m.y - m.vy * (m.len / m.vy)
      );
      grd.addColorStop(0, `rgba(255,255,255,${m.life * 0.8})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      const backLen = m.len;
      ctx.lineTo(m.x - m.vx/Math.hypot(m.vx,m.vy)*backLen, m.y - m.vy/Math.hypot(m.vx,m.vy)*backLen);
      ctx.strokeStyle = grd;
      ctx.lineWidth = m.life * 1.5;
      ctx.stroke();
      return true;
    });

    raf = requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); spawnStars(); });
  resize();
  spawnStars();
  draw();

  // Spawn meteors occasionally
  setInterval(() => { if (Math.random() < 0.4) spawnMeteor(); }, 2800);
}

// ── NAVIGATION ─────────────────────────────────────────
function initNav() {
  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', () => goto(el.dataset.page));
  });
}

function goto(page) {
  S.currentPage = page;
  document.querySelectorAll('.n').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
}

// ── WINDOW CONTROLS ────────────────────────────────────
function initWindowControls() {
  document.getElementById('btnMin').onclick = () => window.spinerAPI.minimize();
  document.getElementById('btnMax').onclick = () => window.spinerAPI.maximize();
  document.getElementById('btnClose').onclick = () => window.spinerAPI.close();
}

// ── BURST PARTICLES ────────────────────────────────────
function doBurst() {
  const zone = document.getElementById('burstZone');
  zone.innerHTML = '';
  const count = 18;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const dist = 80 + Math.random() * 60;
    const p = document.createElement('div');
    p.className = 'burst-p';
    p.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
    p.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
    p.style.animationDelay = (Math.random() * 0.1) + 's';
    p.style.width = p.style.height = (2 + Math.random() * 3) + 'px';
    zone.appendChild(p);
  }
  setTimeout(() => { if (zone) zone.innerHTML = ''; }, 1200);
}

// ── CONNECTION ─────────────────────────────────────────
async function toggleConnection() {
  if (S.connecting) return;
  if (S.connected) { await doDisconnect(); return; }
  if (!S.selectedServer) {
    toast('Select a server first', 'warn');
    goto('servers');
    return;
  }
  await doConnect();
}

async function doConnect() {
  S.connecting = true;
  setUI('connecting');
  log('info', `Connecting → ${S.selectedServer.name} (${S.selectedServer.type.toUpperCase()}) ${S.selectedServer.address}:${S.selectedServer.port}`);

  try {
    const res = await window.spinerAPI.connect(S.selectedServer);
    if (!res.success) throw new Error(res.error || 'Unknown error');
    S.connected = true;
    S.connecting = false;
    S.activeServer = S.selectedServer;
    S.connectedAt = Date.now();
    setUI('connected');
    doBurst();
    startStats();
    startDuration();
    toast(`Connected to ${S.selectedServer.name}`, 'success');
    log('info', `Connected. VPN IP: ${res.ip}`);
    renderSrvList(); renderQs();
  } catch (e) {
    S.connecting = false;
    setUI('disconnected');
    toast('Failed: ' + e.message, 'error');
    log('error', 'Connection failed: ' + e.message);
  }
}

async function doDisconnect() {
  log('info', 'Disconnecting…');
  const res = await window.spinerAPI.disconnect();
  if (res.success) {
    S.connected = false;
    S.connecting = false;
    S.activeServer = null;
    S.connectedAt = null;
    stopStats(); stopDuration();
    setUI('disconnected');
    toast('Disconnected', 'info');
    log('info', 'Disconnected.');
    renderSrvList(); renderQs();
  }
}

// ── UI STATE MACHINE ───────────────────────────────────
function setUI(state) {
  const btn = document.getElementById('orbBtn');
  const txt = document.getElementById('orbTxt');
  const stage = document.getElementById('orbStage');
  const chip = document.getElementById('stateChip');
  const chipTxt = document.getElementById('scText');
  const tbPill = document.getElementById('tbPill');
  const tbText = document.getElementById('tbText');
  const coreDot = document.querySelector('.core-dot');

  const cls = { connected: false, connecting: false };

  if (state === 'connecting') {
    btn.className = 'orb-btn connecting';
    txt.textContent = '…';
    stage.className = 'orb-stage connecting';
    chip.className = 'state-chip connecting';
    chipTxt.textContent = 'Connecting';
    tbPill.className = 'tb-pill connecting';
    tbText.textContent = 'Connecting…';
    coreDot.className = 'core-dot';
  } else if (state === 'connected') {
    btn.className = 'orb-btn connected';
    txt.textContent = 'STOP';
    stage.className = 'orb-stage connected';
    chip.className = 'state-chip connected';
    chipTxt.textContent = 'Connected';
    tbPill.className = 'tb-pill connected';
    tbText.textContent = 'Connected';
    coreDot.className = 'core-dot live';
    updateOrbServerInfo();
  } else {
    btn.className = 'orb-btn';
    txt.textContent = 'CONNECT';
    stage.className = 'orb-stage';
    chip.className = 'state-chip';
    chipTxt.textContent = 'Disconnected';
    tbPill.className = 'tb-pill';
    tbText.textContent = 'Offline';
    coreDot.className = 'core-dot';
    resetStats();
    updateOrbServerInfo();
  }
}

function updateOrbServerInfo() {
  const el = document.getElementById('selectedSrv');
  const srv = S.connected ? S.activeServer : S.selectedServer;
  if (!srv) {
    el.innerHTML = '<span class="no-sel">No server selected</span>';
    return;
  }
  el.innerHTML = `
    <div class="srv-quick-name">${esc(srv.name)}</div>
    <div class="srv-quick-meta">
      <span class="proto-tag ${srv.type}">${srv.type.toUpperCase()}</span>
      <span style="font-size:11px;color:var(--fg3);font-family:var(--ff-mono)">${srv.address}:${srv.port}</span>
    </div>`;
}

// ── STATS ──────────────────────────────────────────────
function startStats() {
  S.statsTimer = setInterval(async () => {
    if (!S.connected) return;
    const d = await window.spinerAPI.getNetworkStats();
    const down = formatBytes(d.downloadSpeed);
    const up = formatBytes(d.uploadSpeed);
    setText('stDown', down + '/s');
    setText('stUp', up + '/s');
    setText('stPing', d.ping + ' ms');
    setBar('sfDown', Math.min(d.downloadSpeed / (1024 * 1024) * 10, 100));
    setBar('sfUp', Math.min(d.uploadSpeed / (1024 * 500) * 10, 100));
    setBar('sfPing', Math.min(d.ping / 2, 100));
  }, 1500);
}

function stopStats() {
  clearInterval(S.statsTimer); S.statsTimer = null;
}

function startDuration() {
  S.durationTimer = setInterval(() => {
    if (!S.connectedAt) return;
    const s = Math.floor((Date.now() - S.connectedAt) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const str = h > 0
      ? `${pad(h)}:${pad(m)}:${pad(ss)}`
      : `${pad(m)}:${pad(ss)}`;
    setText('stTime', str);
    setBar('sfTime', Math.min(s / 3600 * 100, 100));
  }, 1000);
}

function stopDuration() {
  clearInterval(S.durationTimer); S.durationTimer = null;
}

function resetStats() {
  ['stDown','stUp','stPing','stTime'].forEach(id => setText(id, '—'));
  document.getElementById('stTime').textContent = '00:00';
  ['sfDown','sfUp','sfPing','sfTime'].forEach(id => setBar(id, 0));
}

// ── SERVERS ────────────────────────────────────────────
function filteredServers() {
  return S.servers.filter(s => {
    const matchProto = S.filterProto === 'all' || s.type === S.filterProto;
    const q = S.searchQ.toLowerCase();
    const matchQ = !q || s.name.toLowerCase().includes(q) || (s.address||'').toLowerCase().includes(q) || (s.type||'').toLowerCase().includes(q);
    return matchProto && matchQ;
  });
}

function renderSrvList() {
  const list = document.getElementById('srvList');
  const total = S.servers.length;
  setText('serverCount', total);
  setText('srvCountH', total);

  const filtered = filteredServers();
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-pg">
      <div class="empty-circles"><div class="ec ec1"></div><div class="ec ec2"></div><div class="ec ec3"></div></div>
      <p class="ep-t">${total > 0 ? 'No results' : 'No servers'}</p>
      <p class="ep-s">${total > 0 ? 'Try a different search or filter' : 'Import a subscription or paste config keys'}</p>
      ${total === 0 ? '<button class="ghost-btn mt-sm" onclick="goto(\'subscriptions\')">Add Subscription</button>' : ''}
    </div>`;
    return;
  }

  list.innerHTML = filtered.map((s, i) => {
    const realIdx = S.servers.indexOf(s);
    const isSel = S.selectedServer && S.selectedServer.raw === s.raw;
    const isAct = S.activeServer && S.activeServer.raw === s.raw;
    const p = s.ping;
    const pc = !p ? 'pg-na' : p < 80 ? 'pg-good' : p < 160 ? 'pg-ok' : 'pg-bad';
    return `<div class="srv-card${isAct ? ' active-srv' : ''}" data-ri="${realIdx}">
      <span class="srv-flag">${getFlag(s)}</span>
      <div class="srv-info">
        <div class="srv-name">${esc(s.name)}</div>
        <div class="srv-meta">
          <span class="proto-tag ${s.type}">${s.type.toUpperCase()}</span>
          <span class="srv-addr">${esc(s.address)}:${s.port}</span>
        </div>
      </div>
      <span class="srv-ping ${pc}">${p ? p + ' ms' : '—'}</span>
      <div class="srv-acts">
        <button class="icon-btn" style="width:30px;height:30px;font-size:11px" onclick="openDetail(${realIdx})" title="Details">⋯</button>
        <button class="ghost-btn" style="padding:5px 12px;font-size:11px" onclick="selectServer(${realIdx})">${isAct ? 'Active' : isSel ? 'Selected' : 'Select'}</button>
      </div>
    </div>`;
  }).join('');
}

function renderQs() {
  const list = document.getElementById('qsList');
  const top = S.servers.slice(0, 6);
  if (top.length === 0) { list.innerHTML = '<div class="qs-empty">No servers yet</div>'; return; }
  list.innerHTML = top.map((s, i) => {
    const isAct = S.activeServer && S.activeServer.raw === s.raw;
    const p = s.ping;
    const pc = !p ? 'pg-na' : p < 80 ? 'pg-good' : p < 160 ? 'pg-ok' : 'pg-bad';
    return `<div class="srv-card${isAct ? ' active-srv' : ''}" style="cursor:pointer" onclick="selectServer(${i})">
      <span class="srv-flag">${getFlag(s)}</span>
      <div class="srv-info">
        <div class="srv-name">${esc(s.name)}</div>
        <div class="srv-meta">
          <span class="proto-tag ${s.type}">${s.type.toUpperCase()}</span>
          <span class="srv-addr">${esc(s.address)}:${s.port}</span>
        </div>
      </div>
      <span class="srv-ping ${pc}">${p ? p + ' ms' : '—'}</span>
    </div>`;
  }).join('');
}

function selectServer(idx) {
  S.selectedServer = S.servers[idx];
  updateOrbServerInfo();
  renderSrvList();
  renderQs();
  if (S.currentPage !== 'dashboard') goto('dashboard');
  log('info', 'Server selected: ' + S.selectedServer.name);
}

// ── SERVER DETAIL ──────────────────────────────────────
function openDetail(idx) {
  S.detailIdx = idx;
  const s = S.servers[idx];
  if (!s) return;

  document.getElementById('detailTitle').textContent = s.name;
  const fields = [
    ['Protocol', s.type?.toUpperCase()],
    ['Address', s.address],
    ['Port', s.port],
    ['UUID', s.uuid],
    ['Password', s.password],
    ['Method', s.method],
    ['Network', s.network],
    ['Security', s.security || (s.tls ? 'tls' : null)],
    ['SNI', s.sni],
    ['Flow', s.flow],
    ['Fingerprint', s.fp],
    ['Path', s.path],
    ['Auth', s.auth],
  ].filter(([,v]) => v);

  document.getElementById('detailBody').innerHTML = `
    <div class="det-grid">
      ${fields.map(([l,v]) => `<div class="det-f"><div class="det-l">${esc(l)}</div><div class="det-v">${esc(String(v))}</div></div>`).join('')}
    </div>
    ${s.raw ? `<div class="det-raw">${esc(s.raw)}</div>` : ''}`;

  openModal('modalDetail');
}

// ── PING ───────────────────────────────────────────────
async function pingAll() {
  if (!S.servers.length) { toast('No servers', 'warn'); return; }
  toast('Pinging all servers…', 'info');
  log('info', 'Pinging all servers…');
  await Promise.all(S.servers.map(async s => {
    try { s.ping = await window.spinerAPI.pingServer(s.address); }
    catch { s.ping = null; }
  }));
  await saveServers();
  renderSrvList(); renderQs();
  toast('Ping complete', 'success');
  log('info', 'Ping done.');
}

// ── SUBSCRIPTIONS ──────────────────────────────────────
async function addSub() {
  const url = document.getElementById('subUrl').value.trim();
  const name = document.getElementById('subName').value.trim();
  if (!url) { toast('Enter URL', 'warn'); return; }

  toast('Fetching…', 'info');
  log('info', 'Fetching subscription: ' + url);

  try {
    const res = await window.spinerAPI.fetchSubscription(url);
    if (!res.success) throw new Error(res.error || 'Fetch failed');

    const sub = { id: Date.now().toString(), name: name || extractDomain(url), url, serverCount: res.servers.length, lastUpdate: new Date().toISOString() };
    S.subscriptions.push(sub);

    const existing = new Set(S.servers.map(x => x.raw));
    const news = res.servers.filter(x => x.raw && !existing.has(x.raw));
    S.servers.push(...news);

    await saveServers(); await saveSubs();
    renderSubList(); renderSrvList(); renderQs();
    document.getElementById('subUrl').value = '';
    document.getElementById('subName').value = '';
    toast(`Imported ${res.count} servers`, 'success');
    log('info', `Subscription added. ${news.length} new servers.`);
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
    log('error', 'Subscription failed: ' + e.message);
  }
}

async function updateAllSubs() {
  if (!S.subscriptions.length) { toast('No subscriptions', 'warn'); return; }
  toast('Updating all…', 'info');
  let newCount = 0;
  for (const sub of S.subscriptions) {
    try {
      const res = await window.spinerAPI.fetchSubscription(sub.url);
      if (res.success) {
        const existing = new Set(S.servers.map(x => x.raw));
        const news = res.servers.filter(x => x.raw && !existing.has(x.raw));
        S.servers.push(...news);
        sub.serverCount = res.servers.length;
        sub.lastUpdate = new Date().toISOString();
        newCount += news.length;
      }
    } catch (e) { log('warn', `Sub update failed (${sub.name}): ${e.message}`); }
  }
  await saveServers(); await saveSubs();
  renderSubList(); renderSrvList(); renderQs();
  toast(`Updated — ${newCount} new servers`, 'success');
  log('info', `All subs updated. ${newCount} new.`);
}

async function refreshSub(idx) {
  const sub = S.subscriptions[idx];
  if (!sub) return;
  try {
    const res = await window.spinerAPI.fetchSubscription(sub.url);
    if (res.success) {
      const existing = new Set(S.servers.map(x => x.raw));
      const news = res.servers.filter(x => x.raw && !existing.has(x.raw));
      S.servers.push(...news);
      sub.serverCount = res.servers.length;
      sub.lastUpdate = new Date().toISOString();
      await saveServers(); await saveSubs();
      renderSubList(); renderSrvList(); renderQs();
      toast(`Updated: ${news.length} new`, 'success');
    }
  } catch (e) { toast('Update failed', 'error'); }
}

async function deleteSub(idx) {
  S.subscriptions.splice(idx, 1);
  await saveSubs();
  renderSubList();
  toast('Subscription removed', 'info');
}

function renderSubList() {
  const list = document.getElementById('subList');
  if (!S.subscriptions.length) {
    list.innerHTML = '<div class="empty-inline">No subscriptions yet</div>';
    return;
  }
  list.innerHTML = S.subscriptions.map((sub, i) => `
    <div class="sub-card">
      <div class="sub-info">
        <div class="sub-name">${esc(sub.name)}</div>
        <div class="sub-url">${esc(sub.url)}</div>
        <div class="sub-cnt">▸ ${sub.serverCount || 0} servers · ${fmtDate(sub.lastUpdate)}</div>
      </div>
      <div class="sub-acts">
        <button class="ghost-btn" style="padding:5px 12px;font-size:11px" onclick="refreshSub(${i})">↻</button>
        <button class="ghost-btn" style="padding:5px 12px;font-size:11px;color:var(--fg3)" onclick="deleteSub(${i})">✕</button>
      </div>
    </div>`).join('');
}

// ── IMPORT CONFIG ──────────────────────────────────────
async function importConfig() {
  const txt = document.getElementById('configArea').value.trim();
  if (!txt) { toast('Paste config keys first', 'warn'); return; }
  const parsed = await window.spinerAPI.parseConfig(txt);
  if (!parsed.length) { toast('No valid configs found', 'error'); return; }
  const existing = new Set(S.servers.map(x => x.raw));
  const news = parsed.filter(x => x.raw && !existing.has(x.raw));
  S.servers.push(...news);
  await saveServers();
  renderSrvList(); renderQs();
  document.getElementById('configArea').value = '';
  toast(`Imported ${news.length} server${news.length !== 1 ? 's' : ''}`, 'success');
  log('info', `Import: ${news.length} added (${parsed.length - news.length} duplicates)`);
}

async function importClipboard() {
  try {
    const txt = await navigator.clipboard.readText();
    if (!txt) { toast('Clipboard empty', 'warn'); return; }
    const parsed = await window.spinerAPI.parseConfig(txt);
    if (!parsed.length) { toast('No valid configs in clipboard', 'warn'); return; }
    const existing = new Set(S.servers.map(x => x.raw));
    const news = parsed.filter(x => x.raw && !existing.has(x.raw));
    S.servers.push(...news);
    await saveServers();
    renderSrvList(); renderQs();
    toast(`Imported ${news.length} from clipboard`, 'success');
    log('info', `Clipboard import: ${news.length} servers`);
  } catch (e) { toast('Cannot read clipboard', 'error'); }
}

// ── PROTO FORMS ────────────────────────────────────────
const FORMS = {
  vmess: `<div class="pfg">
    <div><label class="pfl">Address</label><input class="fi" id="pf_address" placeholder="example.com"/></div>
    <div><label class="pfl">Port</label><input class="fi" id="pf_port" type="number" value="443"/></div>
    <div class="s2"><label class="pfl">UUID</label><input class="fi" id="pf_uuid" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/></div>
    <div><label class="pfl">Network</label><select class="fi fs" id="pf_network"><option>tcp</option><option>ws</option><option>grpc</option><option>h2</option><option>quic</option></select></div>
    <div><label class="pfl">TLS</label><select class="fi fs" id="pf_tls"><option value="">None</option><option value="tls">TLS</option></select></div>
    <div><label class="pfl">Path</label><input class="fi" id="pf_path" placeholder="/ws"/></div>
    <div><label class="pfl">Host / SNI</label><input class="fi" id="pf_host" placeholder="example.com"/></div>
    <div><label class="pfl">Alter ID</label><input class="fi" id="pf_aid" type="number" value="0"/></div>
    <div class="s2"><label class="pfl">Name</label><input class="fi" id="pf_name" placeholder="My Server"/></div>
  </div>`,
  vless: `<div class="pfg">
    <div><label class="pfl">Address</label><input class="fi" id="pf_address" placeholder="example.com"/></div>
    <div><label class="pfl">Port</label><input class="fi" id="pf_port" type="number" value="443"/></div>
    <div class="s2"><label class="pfl">UUID</label><input class="fi" id="pf_uuid" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/></div>
    <div><label class="pfl">Network</label><select class="fi fs" id="pf_network"><option>tcp</option><option>ws</option><option>grpc</option><option>reality</option></select></div>
    <div><label class="pfl">Security</label><select class="fi fs" id="pf_security"><option value="none">None</option><option value="tls">TLS</option><option value="reality">Reality</option></select></div>
    <div><label class="pfl">Flow</label><select class="fi fs" id="pf_flow"><option value="">None</option><option value="xtls-rprx-vision">xtls-rprx-vision</option></select></div>
    <div><label class="pfl">SNI</label><input class="fi" id="pf_sni" placeholder="example.com"/></div>
    <div><label class="pfl">Fingerprint</label><select class="fi fs" id="pf_fp"><option value="">None</option><option>chrome</option><option>firefox</option><option>safari</option><option>random</option></select></div>
    <div class="s2"><label class="pfl">Name</label><input class="fi" id="pf_name" placeholder="My Server"/></div>
  </div>`,
  trojan: `<div class="pfg">
    <div><label class="pfl">Address</label><input class="fi" id="pf_address" placeholder="example.com"/></div>
    <div><label class="pfl">Port</label><input class="fi" id="pf_port" type="number" value="443"/></div>
    <div class="s2"><label class="pfl">Password</label><input class="fi" id="pf_password" placeholder="trojan-password" type="password"/></div>
    <div><label class="pfl">Network</label><select class="fi fs" id="pf_network"><option>tcp</option><option>ws</option><option>grpc</option></select></div>
    <div><label class="pfl">SNI</label><input class="fi" id="pf_sni" placeholder="example.com"/></div>
    <div class="s2"><label class="pfl">Name</label><input class="fi" id="pf_name" placeholder="My Server"/></div>
  </div>`,
  ss: `<div class="pfg">
    <div><label class="pfl">Address</label><input class="fi" id="pf_address" placeholder="example.com"/></div>
    <div><label class="pfl">Port</label><input class="fi" id="pf_port" type="number" value="8388"/></div>
    <div><label class="pfl">Cipher</label><select class="fi fs" id="pf_method"><option>aes-256-gcm</option><option>aes-128-gcm</option><option>chacha20-ietf-poly1305</option><option>2022-blake3-aes-256-gcm</option></select></div>
    <div><label class="pfl">Password</label><input class="fi" id="pf_password" placeholder="password"/></div>
    <div class="s2"><label class="pfl">Name</label><input class="fi" id="pf_name" placeholder="My Server"/></div>
  </div>`,
  hysteria2: `<div class="pfg">
    <div><label class="pfl">Address</label><input class="fi" id="pf_address" placeholder="example.com"/></div>
    <div><label class="pfl">Port</label><input class="fi" id="pf_port" type="number" value="443"/></div>
    <div class="s2"><label class="pfl">Auth / Password</label><input class="fi" id="pf_auth" placeholder="auth-string"/></div>
    <div><label class="pfl">SNI</label><input class="fi" id="pf_sni" placeholder="example.com"/></div>
    <div><label class="pfl">Insecure</label><select class="fi fs" id="pf_insecure"><option value="0">No</option><option value="1">Yes (skip TLS verify)</option></select></div>
    <div class="s2"><label class="pfl">Name</label><input class="fi" id="pf_name" placeholder="My Server"/></div>
  </div>`,
  tuic: `<div class="pfg">
    <div><label class="pfl">Address</label><input class="fi" id="pf_address" placeholder="example.com"/></div>
    <div><label class="pfl">Port</label><input class="fi" id="pf_port" type="number" value="443"/></div>
    <div class="s2"><label class="pfl">UUID</label><input class="fi" id="pf_uuid" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/></div>
    <div><label class="pfl">Password</label><input class="fi" id="pf_password" placeholder="password"/></div>
    <div><label class="pfl">SNI</label><input class="fi" id="pf_sni" placeholder="example.com"/></div>
    <div class="s2"><label class="pfl">Name</label><input class="fi" id="pf_name" placeholder="My Server"/></div>
  </div>`,
  raw: `<div>
    <label class="pfl">Paste config link</label>
    <textarea class="fa" id="pf_raw" rows="5" placeholder="vmess://…&#10;vless://…&#10;trojan://…"></textarea>
  </div>`,
};

function showProtoForm(proto) {
  document.querySelectorAll('.ptab').forEach(t => t.classList.toggle('active', t.dataset.pt === proto));
  document.getElementById('protoForm').innerHTML = FORMS[proto] || FORMS.raw;
}

async function saveManualServer() {
  const activeProto = document.querySelector('.ptab.active')?.dataset.pt;
  if (!activeProto) return;

  if (activeProto === 'raw') {
    const raw = document.getElementById('pf_raw')?.value.trim();
    if (!raw) { toast('Enter config link', 'warn'); return; }
    const parsed = await window.spinerAPI.parseConfig(raw);
    if (!parsed.length) { toast('Invalid format', 'error'); return; }
    const existing = new Set(S.servers.map(x => x.raw));
    const news = parsed.filter(x => x.raw && !existing.has(x.raw));
    S.servers.push(...news);
    await saveServers();
    closeModal('modalAdd');
    renderSrvList(); renderQs();
    toast(`Added ${news.length} server(s)`, 'success');
    return;
  }

  const addr = document.getElementById('pf_address')?.value.trim();
  const port = parseInt(document.getElementById('pf_port')?.value) || 443;
  const name = document.getElementById('pf_name')?.value.trim() || `${activeProto.toUpperCase()} ${addr}`;
  if (!addr) { toast('Enter server address', 'warn'); return; }

  const s = {
    type: activeProto, name, address: addr, port,
    raw: `${activeProto}://${Date.now()}@${addr}:${port}#${encodeURIComponent(name)}`,
    uuid: v('pf_uuid'), password: v('pf_password'), auth: v('pf_auth'),
    method: v('pf_method'), network: v('pf_network'), security: v('pf_security'),
    tls: v('pf_tls') === 'tls', sni: v('pf_sni'), flow: v('pf_flow'), fp: v('pf_fp'),
    path: v('pf_path'), host: v('pf_host'), alterId: parseInt(v('pf_aid')) || 0,
    insecure: v('pf_insecure') === '1',
  };

  S.servers.push(s);
  await saveServers();
  closeModal('modalAdd');
  renderSrvList(); renderQs();
  toast(`"${name}" added`, 'success');
  log('info', 'Manual server added: ' + name);
}

// ── SETTINGS ───────────────────────────────────────────
async function loadSettings() {
  S.settings = await window.spinerAPI.getSettings();
  const st = S.settings;
  setChk('startWin', st.startWithWindows);
  setChk('minTray', st.minimizeToTray ?? true);
  setChk('autoConn', st.autoConnect);
  setChk('allowLAN', st.allowLAN);
  setChk('sysProxy', st.systemProxy ?? true);
  setChk('tunMode', st.tunMode);
  setVal('httpPort', st.proxyPort || 10808);
  setVal('socksPort', st.socksPort || 10809);
  setVal('mtu', st.mtu || 1500);
  setVal('logLvl', st.logLevel || 'warning');
  setVal('lang', st.language || 'en');
  setVal('coreEng', st.core || 'xray');
  setText('coreLabel', (st.core || 'Xray').charAt(0).toUpperCase() + (st.core || 'xray').slice(1));

  if (st.theme) applyTheme(st.theme);
}

async function saveSettings() {
  const settings = {
    startWithWindows: chk('startWin'),
    minimizeToTray: chk('minTray'),
    autoConnect: chk('autoConn'),
    allowLAN: chk('allowLAN'),
    systemProxy: chk('sysProxy'),
    tunMode: chk('tunMode'),
    proxyPort: parseInt(val('httpPort')),
    socksPort: parseInt(val('socksPort')),
    mtu: parseInt(val('mtu')),
    logLevel: val('logLvl'),
    language: val('lang'),
    core: val('coreEng'),
    theme: S.currentTheme,
  };
  S.settings = settings;
  await window.spinerAPI.saveSettings(settings);
  toast('Settings saved', 'success');
  log('info', 'Settings saved.');
}

function applyTheme(theme) {
  S.currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.th').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
}

// ── SAVE / LOAD DATA ───────────────────────────────────
async function saveServers() { await window.spinerAPI.saveServers(S.servers); }
async function saveSubs() { await window.spinerAPI.saveSubscriptions(S.subscriptions); }

// ── MODALS ──────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── LOGS ────────────────────────────────────────────────
function log(level, msg) {
  const box = document.getElementById('logBox');
  const now = new Date();
  const t = now.toTimeString().slice(0,8);
  const el = document.createElement('div');
  el.className = 'le';
  el.dataset.level = level;
  el.innerHTML = `<span class="le-t">${t}</span><span class="le-l ${level}">${level.toUpperCase()}</span><span class="le-m">${esc(msg)}</span>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

// ── TOASTS ──────────────────────────────────────────────
function toast(msg, type = 'info') {
  const stack = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div class="t-dot"></div><span>${esc(msg)}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('exit');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 3200);
}

// ── UTILS ───────────────────────────────────────────────
const esc = s => s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
const setBar = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%'; };
const pad = n => String(n).padStart(2,'0');
const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
const chk = id => { const el = document.getElementById(id); return el ? el.checked : false; };
const setChk = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.checked = !!val; };
const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(Math.max(bytes,1)) / Math.log(k));
  return (bytes / Math.pow(k,i)).toFixed(1) + ' ' + s[i];
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url.slice(0,30); }
}

function fmtDate(iso) {
  if (!iso) return 'never';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString().slice(0,5);
  } catch { return '—'; }
}

function getFlag(s) {
  const n = ((s.name || '') + ' ' + (s.address || '')).toLowerCase();
  const MAP = {
    'us ': '🇺🇸', 'usa': '🇺🇸', 'united states': '🇺🇸', 'america': '🇺🇸',
    'de ': '🇩🇪', 'germany': '🇩🇪', 'german': '🇩🇪',
    'nl ': '🇳🇱', 'netherlands': '🇳🇱', 'dutch': '🇳🇱',
    'uk ': '🇬🇧', ' gb ': '🇬🇧', 'england': '🇬🇧', 'united kingdom': '🇬🇧', 'britain': '🇬🇧',
    'fr ': '🇫🇷', 'france': '🇫🇷', 'french': '🇫🇷',
    'jp ': '🇯🇵', 'japan': '🇯🇵',
    'sg ': '🇸🇬', 'singapore': '🇸🇬',
    'hk ': '🇭🇰', 'hong kong': '🇭🇰',
    'tw ': '🇹🇼', 'taiwan': '🇹🇼',
    'kr ': '🇰🇷', 'korea': '🇰🇷',
    'ca ': '🇨🇦', 'canada': '🇨🇦',
    'au ': '🇦🇺', 'australia': '🇦🇺',
    'ch ': '🇨🇭', 'swiss': '🇨🇭',
    'ru ': '🇷🇺', 'russia': '🇷🇺',
    'tr ': '🇹🇷', 'turkey': '🇹🇷', 'turk': '🇹🇷',
    'ir ': '🇮🇷', 'iran': '🇮🇷',
    'ae ': '🇦🇪', 'uae': '🇦🇪', 'dubai': '🇦🇪',
    'fi ': '🇫🇮', 'finland': '🇫🇮',
    'se ': '🇸🇪', 'sweden': '🇸🇪',
    'no ': '🇳🇴', 'norway': '🇳🇴',
    'pl ': '🇵🇱', 'poland': '🇵🇱',
    'ua ': '🇺🇦', 'ukraine': '🇺🇦',
  };
  for (const [k, f] of Object.entries(MAP)) if (n.includes(k.trim())) return f;
  return '🌐';
}

// ── INIT ────────────────────────────────────────────────
async function init() {
  initCosmos();
  initNav();
  initWindowControls();

  // Version
  const ver = await window.spinerAPI.getVersion();
  setText('appVersion', ver);

  // Load data
  S.servers = await window.spinerAPI.getServers();
  S.subscriptions = await window.spinerAPI.getSubscriptions();
  await loadSettings();

  // Render initial
  renderSrvList(); renderQs(); renderSubList();
  setText('serverCount', S.servers.length);
  setText('srvCountH', S.servers.length);

  // Orb button
  document.getElementById('orbBtn').addEventListener('click', toggleConnection);

  // Servers page
  document.getElementById('btnPingAll').addEventListener('click', pingAll);
  document.getElementById('btnClipboard').addEventListener('click', importClipboard);
  document.getElementById('btnAddServer').addEventListener('click', () => {
    showProtoForm('vmess');
    openModal('modalAdd');
  });
  document.getElementById('srvSearch').addEventListener('input', e => {
    S.searchQ = e.target.value;
    renderSrvList();
  });
  document.querySelectorAll('.fp').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.fp').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    S.filterProto = b.dataset.f;
    renderSrvList();
  }));

  // Subscriptions page
  document.getElementById('btnAddSub').addEventListener('click', addSub);
  document.getElementById('btnUpdateAll').addEventListener('click', updateAllSubs);
  document.getElementById('btnImport').addEventListener('click', importConfig);
  document.getElementById('btnClearArea').addEventListener('click', () => document.getElementById('configArea').value = '');

  // Routing
  document.querySelectorAll('.mode-card').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.mode-card').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  }));
  document.getElementById('btnSaveRouting').addEventListener('click', () => toast('Routing saved', 'success'));

  // Settings
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
  document.querySelectorAll('.th').forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.theme)));

  // Logs
  document.getElementById('btnClearLog').addEventListener('click', () => document.getElementById('logBox').innerHTML = '');
  document.getElementById('btnCopyLog').addEventListener('click', () => {
    const txt = [...document.querySelectorAll('.le')].map(l => l.textContent.trim()).join('\n');
    navigator.clipboard.writeText(txt).then(() => toast('Logs copied', 'success'));
  });

  // Proto tabs (modal)
  document.getElementById('protoTabBar').addEventListener('click', e => {
    const tab = e.target.closest('.ptab');
    if (tab) showProtoForm(tab.dataset.pt);
  });
  document.getElementById('btnSaveServer').addEventListener('click', saveManualServer);

  // Server detail modal
  document.getElementById('btnConnModal').addEventListener('click', () => {
    if (S.detailIdx !== null) {
      S.selectedServer = S.servers[S.detailIdx];
      updateOrbServerInfo();
      closeModal('modalDetail');
      doConnect();
    }
  });
  document.getElementById('btnDelServer').addEventListener('click', async () => {
    if (S.detailIdx !== null) {
      const name = S.servers[S.detailIdx].name;
      S.servers.splice(S.detailIdx, 1);
      await saveServers();
      renderSrvList(); renderQs();
      closeModal('modalDetail');
      toast(`"${name}" deleted`, 'info');
    }
  });

  // Close modals
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
  document.querySelectorAll('.mbg').forEach(bg => bg.addEventListener('click', e => {
    if (e.target === bg) bg.classList.remove('open');
  }));

  // Tray events
  window.spinerAPI.onTrayToggle(() => toggleConnection());
  window.spinerAPI.onTrayNavigate((page) => goto(page));
  window.spinerAPI.onConnectionStatus(data => {
    if (data.connected) setUI('connected');
    else setUI('disconnected');
  });

  log('info', `SpinerNET v${ver} ready`);
  log('info', `${S.servers.length} servers · ${S.subscriptions.length} subscriptions`);
}

document.addEventListener('DOMContentLoaded', init);
