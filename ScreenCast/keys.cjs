/**
 * PC でキーを押す (スライド送り)。OS ごとに入っている道具を使う。シェルは通さない (execFile + 決まったキー名だけ)。
 *
 *   Linux  X11:     xdotool key Right
 *   Linux  Wayland: wtype -k Right  /  ydotool key 106:1 106:0   (どちらも無ければ XWayland の xdotool を試す)
 *   Windows:        PowerShell (WScript.Shell).SendKeys('{RIGHT}')
 *   macOS:          osascript -e 'tell application "System Events" to key code 124'
 */
'use strict';
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// 名前 → [xdotool/wtype の keysym, ydotool (Linux evdev) のコード, SendKeys, macOS key code]
const KEYS = {
  Right: ['Right', 106, '{RIGHT}', 124],
  Left: ['Left', 105, '{LEFT}', 123],
  Up: ['Up', 103, '{UP}', 126],
  Down: ['Down', 108, '{DOWN}', 125],
  Home: ['Home', 102, '{HOME}', 115],
  End: ['End', 107, '{END}', 119],
  Page_Up: ['Prior', 104, '{PGUP}', 116],
  Page_Down: ['Next', 109, '{PGDN}', 121],
  space: ['space', 57, ' ', 49],
  Return: ['Return', 28, '{ENTER}', 36],
  Escape: ['Escape', 1, '{ESC}', 53],
  F5: ['F5', 63, '{F5}', 96],
  b: ['b', 48, 'b', 11], // PowerPoint / Keynote: 黒画面
  w: ['w', 17, 'w', 13], // 白画面
  period: ['period', 52, '.', 47],
};
const ALIASES = {
  right: 'Right', left: 'Left', up: 'Up', down: 'Down', home: 'Home', end: 'End',
  pageup: 'Page_Up', prior: 'Page_Up', page_up: 'Page_Up', pagedown: 'Page_Down', next: 'Page_Down', page_down: 'Page_Down',
  space: 'space', ' ': 'space', enter: 'Return', return: 'Return', escape: 'Escape', esc: 'Escape', f5: 'F5',
  b: 'b', w: 'w', period: 'period', '.': 'period',
};
const ACTIONS = { next: 'Right', prev: 'Left', first: 'Home', last: 'End' };

function which(cmd) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
    }
  }
  return null;
}

let cached;
/** 使える方法 (無ければ null) */
function detectMethod() {
  if (cached !== undefined) return cached;
  cached = null;
  if (process.platform === 'win32') cached = { kind: 'sendkeys', bin: 'powershell.exe' };
  else if (process.platform === 'darwin') cached = which('osascript') ? { kind: 'osascript', bin: 'osascript' } : null;
  else {
    const wayland = !!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland';
    if (wayland && which('wtype')) cached = { kind: 'wtype', bin: which('wtype') };
    else if (wayland && which('ydotool')) cached = { kind: 'ydotool', bin: which('ydotool') };
    else if (process.env.DISPLAY && which('xdotool')) cached = { kind: 'xdotool', bin: which('xdotool') };
  }
  return cached;
}

function unavailableMessage() {
  if (process.platform === 'linux') {
    const wayland = !!process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland';
    return wayland
      ? 'No key tool found. Install wtype or ydotool (Wayland) / wtype か ydotool を入れてください'
      : 'No key tool found. Install xdotool / xdotool を入れてください';
  }
  return 'Key injection is not available on this system / この PC ではキーを押せません';
}

function resolveKey(action, key) {
  if (ACTIONS[action]) return ACTIONS[action];
  if (action === 'key') {
    if (!key) return null;
    if (KEYS[key]) return key;
    return ALIASES[String(key).toLowerCase()] || null;
  }
  return null;
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 5000, windowsHide: true }, (err, _out, stderr) => {
      if (err) reject(new Error(`${path.basename(bin)}: ${(stderr || err.message).toString().trim()}`));
      else resolve();
    });
  });
}

/** POST /control の中身。{ status, body } を返す */
async function control(action, key) {
  const name = resolveKey(action, key);
  if (!name) {
    return { status: 400, body: { error: `unknown action/key (${action}${key ? ' ' + key : ''})`, actions: Object.keys(ACTIONS).concat('key'), keys: Object.keys(KEYS) } };
  }
  const m = detectMethod();
  if (!m) return { status: 501, body: { error: unavailableMessage() } };
  const [sym, evdev, sendkeys, mac] = KEYS[name];
  switch (m.kind) {
    case 'xdotool': await run(m.bin, ['key', '--clearmodifiers', sym]); break;
    case 'wtype': await run(m.bin, ['-k', sym]); break;
    case 'ydotool': await run(m.bin, ['key', `${evdev}:1`, `${evdev}:0`]); break;
    case 'sendkeys':
      await run(m.bin, ['-NoProfile', '-NonInteractive', '-Command',
        `(New-Object -ComObject WScript.Shell).SendKeys('${sendkeys.replace(/'/g, "''")}')`]);
      break;
    case 'osascript': await run(m.bin, ['-e', `tell application "System Events" to key code ${mac}`]); break;
    default: return { status: 501, body: { error: unavailableMessage() } };
  }
  return { status: 200, body: { ok: true, action, key: name, via: m.kind } };
}

module.exports = { control, detectMethod, resolveKey, KEYS };
