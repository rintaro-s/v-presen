/**
 * Arsist ScreenCast — PC の画面 / ウィンドウを MJPEG で LAN に配信する (doc/23 §5)。
 *
 * 枠は 2 つ: スライド (/stream/slides) とカンペ (/stream/notes)。枠ごとに「画面」か「ウィンドウ」を選ぶ。
 * サーバーは起動した時点で立つ。まだ選んでいない枠は「選ばれていません」の画を流す (Quest が待たされない)。
 *
 *   electron products/ScreenCast                                   窓あり
 *   electron products/ScreenCast --headless --source screen:0 --name slides [--source window:Notes --name notes]
 *        [--port 8090] [--host 0.0.0.0] [--fps 15] [--max-width 1920] [--quality 0.8] [--token X] [--threshold 0.0001]
 *   electron products/ScreenCast --list-sources                    選べる画面とウィンドウを出して終わる
 *
 * 取り込み: 見えない窓 (capture.html)。配信: server.cjs。キー: keys.cjs。ファイアウォール: firewall.cjs。
 */
'use strict';
const { app, BrowserWindow, desktopCapturer, ipcMain, shell, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { StreamHub, createServer, lanAddresses } = require('./server.cjs');
const keys = require('./keys.cjs');
const firewall = require('./firewall.cjs');

// ---------- 引数 ----------
const argv = process.argv.slice(1);
function argAll(name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && i + 1 < argv.length) out.push(argv[++i]);
    else if (argv[i].startsWith(name + '=')) out.push(argv[i].slice(name.length + 1));
  }
  return out;
}
const arg = (name) => argAll(name).pop();
const HEADLESS = argv.includes('--headless');
const LIST_ONLY = argv.includes('--list-sources');

/** 枠。名前は URL (/stream/<name>) と Quest のサンプルが使う */
const SLOTS = [
  { name: 'slides', title: { en: 'Slides', ja: 'スライド' } },
  { name: 'notes', title: { en: 'Speaker notes', ja: 'カンペ' } },
];
const STREAM_DEFAULTS = { sourceId: '', sourceName: '', sourceKind: '', maxWidth: 1920, fps: 15, quality: 0.8 };
const DEFAULTS = {
  port: 8090,
  host: '0.0.0.0',
  token: '',
  language: '',
  slots: { slides: { ...STREAM_DEFAULTS }, notes: { ...STREAM_DEFAULTS } },
  threshold: 0.0001, // 320×180 に縮めた画で「変わった」とみなす画素の割合 (0.0001 ≒ 6 画素: 数字 1 つ変わっても送る)
  keyframeMs: 5000,
  firewallOpened: '', // 開けたポート (同じポートなら次からボタンを出さない)
};

const WAYLAND = process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);

// 設定はこのアプリだけの場所に (エディタの electron-store とは別)
app.setName('Arsist ScreenCast');
app.setPath('userData', path.join(app.getPath('appData'), 'arsist-screencast'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
// Wayland では画面の取り込みは xdg-desktop-portal (PipeWire) を通る。選ぶ窓は OS が出す
if (WAYLAND) app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { /* 初回 */ }
  const slots = {};
  for (const { name } of SLOTS) slots[name] = { ...STREAM_DEFAULTS, ...((s.slots || {})[name] || {}) };
  return { ...DEFAULTS, ...s, slots };
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (e) { log('settings not saved:', e.message); }
}

function log(...a) { console.log('[screencast]', ...a); }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- 状態 ----------
let settings = null;
const hubs = new Map();
let server = null;
let serverPort = 0;
let serverError = '';
let captureWin = null;
let uiWin = null;
const captureState = {}; // name → 'starting' | 'live' | 'waiting' | 'error: …'
let lastRemote = null; // { address, at, path } この PC 以外から最後に届いた要求
let firewallInfo = { kind: null, active: false };

for (const { name, title } of SLOTS) {
  const hub = new StreamHub(name);
  hub.title = title;
  hubs.set(name, hub);
}

async function listSources(thumbWidth = 320, types = ['screen', 'window']) {
  const sources = await desktopCapturer.getSources({
    types,
    thumbnailSize: { width: thumbWidth, height: Math.round(thumbWidth * 9 / 16) },
    fetchWindowIcons: false,
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: thumbWidth > 0 && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
  }));
}

/** --source の書き方: 元の id ("screen:0:0") / "screen:N" (N 番目の画面) / "window:<名前の一部>" / 名前の一部 */
function matchSource(sources, spec) {
  if (!spec) return null;
  const exact = sources.find((s) => s.id === spec || s.id.startsWith(spec + ':'));
  if (exact) return exact;
  const m = /^(screen|window):(.+)$/.exec(spec);
  if (m) {
    const ofKind = sources.filter((s) => s.kind === m[1]);
    if (/^\d+$/.test(m[2]) && ofKind[Number(m[2])]) return ofKind[Number(m[2])];
    const needle = m[2].toLowerCase();
    return ofKind.find((s) => s.name.toLowerCase().includes(needle)) || null;
  }
  return sources.find((s) => s.name.toLowerCase().includes(spec.toLowerCase())) || null;
}

// ---------- サーバー (起動したら立てる) ----------
async function startServer() {
  await stopServer();
  serverError = '';
  const s = createServer({
    hubs,
    getToken: () => settings.token || '',
    control: keys.control,
    controlAvailable: () => !!keys.detectMethod(),
    log: process.env.SCREENCAST_DEBUG ? log : (line) => { if (/^[+-] client|^control/.test(line)) log(line); },
    onRequest: (remote, p) => {
      const a = String(remote).replace(/^::ffff:/, '');
      if (a && a !== '127.0.0.1' && a !== '::1' && !lanAddresses().some((x) => x.address === a)) {
        lastRemote = { address: a, at: Date.now(), path: p };
      }
    },
  });
  const port = clamp(Number(settings.port) || 8090, 1, 65535);
  try {
    await new Promise((resolve, reject) => {
      s.once('error', reject);
      s.listen(port, settings.host || '0.0.0.0', () => { s.off('error', reject); resolve(); });
    });
  } catch (e) {
    serverError = e && e.code === 'EADDRINUSE'
      ? `port ${port} is already in use / ポート ${port} は他のアプリが使っています`
      : String(e && e.message || e);
    log(serverError);
    return false;
  }
  server = s;
  serverPort = port;
  log(`serving on ${settings.host || '0.0.0.0'}:${port}`);
  for (const a of lanAddresses()) log(`   PC address for the headset: ${a.address}:${port}`);
  return true;
}

async function stopServer() {
  for (const h of hubs.values()) h.closeAll();
  if (server) {
    const s = server;
    server = null;
    await new Promise((r) => s.close(() => r()));
  }
}

// ---------- 取り込み ----------
function ensureCaptureWindow() {
  if (captureWin && !captureWin.isDestroyed()) return Promise.resolve(captureWin);
  captureWin = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 見えない窓でもタイマーを間引かない
    },
  });
  captureWin.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 || process.env.SCREENCAST_DEBUG) log('[capture]', message);
  });
  captureWin.webContents.on('render-process-gone', (_e, d) => {
    log(`capture renderer gone: ${d.reason}`);
    captureWin = null;
  });
  return captureWin.loadFile(path.join(__dirname, 'capture.html')).then(() => captureWin);
}

const lang = () => settings.language || (String(app.getLocale()).startsWith('ja') ? 'ja' : 'en');

/** 今の設定どおりに取り込み直す (枠ごとに: 選んだもの → 取り込み、無ければ「選ばれていません」) */
async function applyCapture() {
  const streams = [];
  const placeholders = [];
  for (const { name, title } of SLOTS) {
    const s = settings.slots[name];
    const hub = hubs.get(name);
    hub.source = s.sourceId ? s.sourceName || s.sourceId : '';
    if (s.sourceId) {
      captureState[name] = 'starting';
      streams.push({
        name,
        sourceId: s.sourceId,
        maxWidth: clamp(Number(s.maxWidth) || 1920, 160, 7680),
        fps: clamp(Number(s.fps) || 15, 1, 60),
        quality: clamp(Number(s.quality) || 0.8, 0.1, 1),
      });
    } else {
      captureState[name] = 'waiting';
      placeholders.push({
        name,
        title: title[lang()] || title.en,
        text: lang() === 'ja' ? 'PC の ScreenCast で、映す画面を選んでください' : 'Choose what to show in ScreenCast on the PC',
      });
    }
  }
  const win = await ensureCaptureWindow();
  win.webContents.send('capture:start', {
    streams,
    placeholders,
    threshold: Number(settings.threshold) || DEFAULTS.threshold,
    keyframeMs: Number(settings.keyframeMs) || DEFAULTS.keyframeMs,
  });
}

/** 前回選んだものが今もあるか (X11 / Windows / macOS だけ。Wayland は毎回 OS の窓で選び直す) */
async function restoreSources() {
  if (WAYLAND) {
    for (const { name } of SLOTS) settings.slots[name].sourceId = '';
    return;
  }
  let sources = [];
  try { sources = await listSources(0); } catch { return; }
  for (const { name } of SLOTS) {
    const s = settings.slots[name];
    if (!s.sourceId) continue;
    const same = sources.find((x) => x.id === s.sourceId)
      // ウィンドウの id は起動し直すと変わるので、名前でも探す
      || (s.sourceKind === 'window' && s.sourceName && sources.find((x) => x.kind === 'window' && x.name === s.sourceName));
    if (same) { s.sourceId = same.id; s.sourceName = same.name; } else s.sourceId = '';
  }
}

function status() {
  return {
    port: serverPort || Number(settings.port) || 8090,
    serving: !!server,
    serverError,
    token: settings.token || '',
    wayland: WAYLAND,
    addresses: lanAddresses(),
    control: keys.detectMethod()?.kind || null,
    firewall: { ...firewallInfo, opened: settings.firewallOpened === String(serverPort) },
    lastRemote,
    slots: SLOTS.map(({ name, title }) => {
      const h = hubs.get(name);
      const s = settings.slots[name];
      return {
        name, title, sourceId: s.sourceId, sourceName: s.sourceName, sourceKind: s.sourceKind,
        maxWidth: s.maxWidth, fps: s.fps, quality: s.quality,
        width: h.width, height: h.height, rate: h.fps(), clients: h.clients.size, frames: h.frames,
        state: captureState[name] || '',
      };
    }),
  };
}

// ---------- IPC ----------
ipcMain.on('capture:frame', (_e, name, data, width, height) => {
  const hub = hubs.get(name);
  if (!hub) return;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer ? data.buffer : data, data.byteOffset || 0, data.byteLength);
  hub.push(buf, width, height);
});
ipcMain.on('capture:state', (_e, name, state) => {
  captureState[name] = state;
  if (String(state).startsWith('error')) log(`${name}: ${state}`);
});

ipcMain.handle('ui:status', () => status());
ipcMain.handle('ui:settings', () => ({ settings, slots: SLOTS, locale: app.getLocale(), wayland: WAYLAND }));

/**
 * 枠に映すものを選ぶ。kind = 'screen' | 'window'。
 * Wayland: OS の窓 (ポータル) がそのまま選ぶ画面になる → 選ばれた 1 つを返す ({ chosen })。
 * それ以外: 候補の一覧 (サムネイル付き) を返し、画面の側で選んでもらう ({ list })。
 */
ipcMain.handle('ui:pick', async (_e, slot, kind) => {
  if (!settings.slots[slot]) return { ok: false, error: 'no such slot' };
  try {
    if (WAYLAND) {
      const list = await listSources(320, ['screen', 'window']);
      if (!list.length) return { ok: false, error: 'cancelled' };
      const c = list[0];
      setSource(slot, c);
      await applyCapture();
      return { ok: true, chosen: c };
    }
    const list = await listSources(320, kind === 'window' ? ['window'] : ['screen']);
    return { ok: true, list: list.filter((x) => kind !== 'window' || x.name !== 'Arsist ScreenCast') };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});
ipcMain.handle('ui:choose', async (_e, slot, source) => {
  if (!settings.slots[slot] || !source || !source.id) return { ok: false };
  setSource(slot, source);
  await applyCapture();
  return { ok: true };
});
ipcMain.handle('ui:clear', async (_e, slot) => {
  if (!settings.slots[slot]) return { ok: false };
  settings.slots[slot].sourceId = '';
  settings.slots[slot].sourceName = '';
  saveSettings();
  await applyCapture();
  return { ok: true };
});
ipcMain.handle('ui:quality', async (_e, slot, q) => {
  const s = settings.slots[slot];
  if (!s) return { ok: false };
  if (q.maxWidth) s.maxWidth = clamp(Number(q.maxWidth), 160, 7680);
  if (q.fps) s.fps = clamp(Number(q.fps), 1, 60);
  if (q.quality) s.quality = clamp(Number(q.quality), 0.1, 1);
  saveSettings();
  await applyCapture();
  return { ok: true };
});
ipcMain.handle('ui:server', async (_e, next) => {
  if (next.port != null) settings.port = clamp(Number(next.port) || 8090, 1, 65535);
  if (next.token != null) settings.token = String(next.token).trim();
  saveSettings();
  const ok = await startServer();
  return { ok, error: serverError };
});
ipcMain.handle('ui:firewall', async () => {
  const r = await firewall.allow(serverPort || settings.port, lanAddresses().map((a) => a.address));
  if (r.ok) { settings.firewallOpened = String(serverPort || settings.port); saveSettings(); }
  return r;
});
ipcMain.handle('ui:language', (_e, l) => { settings.language = l; saveSettings(); return applyCapture(); });
ipcMain.handle('ui:control', (_e, action) => keys.control(action));
ipcMain.handle('ui:open', (_e, url) => { if (/^http:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('ui:copy', (_e, text) => { clipboard.writeText(String(text)); return true; });

function setSource(slot, src) {
  const s = settings.slots[slot];
  s.sourceId = src.id;
  s.sourceName = src.name || '';
  s.sourceKind = src.kind || (String(src.id).startsWith('screen:') ? 'screen' : 'window');
  saveSettings();
}

// ---------- 起動 ----------
async function runHeadless() {
  const sources = await listSources(0);
  if (LIST_ONLY) {
    for (const s of sources) console.log(`${s.id}\t${s.kind}\t${s.name}`);
    app.quit();
    return;
  }
  const specs = argAll('--source');
  const names = argAll('--name');
  if (!specs.length) specs.push('screen:0');
  settings.port = Number(arg('--port')) || settings.port;
  settings.host = arg('--host') || '0.0.0.0';
  settings.token = arg('--token') ?? '';
  settings.threshold = Number(arg('--threshold')) || DEFAULTS.threshold;
  for (const { name } of SLOTS) settings.slots[name] = { ...STREAM_DEFAULTS };
  specs.forEach((spec, i) => {
    const src = matchSource(sources, spec);
    if (!src) throw new Error(`source not found: ${spec} (try --list-sources)`);
    const name = names[i] || SLOTS[i]?.name || `stream${i + 1}`;
    if (!hubs.has(name)) hubs.set(name, new StreamHub(name));
    if (!settings.slots[name]) { SLOTS.push({ name, title: { en: name, ja: name } }); }
    settings.slots[name] = {
      ...STREAM_DEFAULTS, sourceId: src.id, sourceName: src.name, sourceKind: src.kind,
      maxWidth: Number(arg('--max-width')) || 1920, fps: Number(arg('--fps')) || 15, quality: Number(arg('--quality')) || 0.8,
    };
  });
  if (!(await startServer())) throw new Error(serverError);
  await applyCapture();
  setInterval(() => {
    const s = status();
    log(s.slots.map((x) => `${x.name} ${x.width}x${x.height} ${x.rate}fps clients=${x.clients} frames=${x.frames} ${x.state}`).join(' | '));
  }, 10000).unref();
}

function createUi() {
  uiWin = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#15181d',
    title: 'Arsist ScreenCast',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  uiWin.loadFile(path.join(__dirname, 'ui.html'));
  uiWin.on('closed', () => { uiWin = null; app.quit(); });
}

app.on('window-all-closed', () => { if (!HEADLESS) app.quit(); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopServer().finally(() => app.exit(0)); });

app.whenReady().then(async () => {
  settings = loadSettings();
  if (HEADLESS || LIST_ONLY) {
    try { await runHeadless(); } catch (e) { console.error('[screencast]', e.message); app.exit(1); }
    return;
  }
  firewallInfo = await firewall.detect().catch(() => ({ kind: null, active: false }));
  await restoreSources();
  await startServer();
  await applyCapture();
  createUi();
});
