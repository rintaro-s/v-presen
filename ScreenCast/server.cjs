/**
 * ScreenCast の HTTP 側 (Electron に依存しない。node だけでも動く)。
 *
 *   GET  /stream/<name>      multipart/x-mixed-replace; boundary=arsistframe (つないだら最新の 1 枚をすぐ送る)
 *   GET  /frame/<name>.jpg   最新の 1 枚
 *   GET  /status             { streams: [{ name, source, width, height, fps, clients }], control }
 *   POST /control            { action: "next"|"prev"|"first"|"last"|"key", key? } → keys.cjs
 *
 * token を設定したら全部に ?token= か X-Token ヘッダーが要る。
 */
'use strict';
const http = require('node:http');
const os = require('node:os');

const BOUNDARY = 'arsistframe';

class StreamHub {
  constructor(name) {
    this.name = name;
    this.source = '';
    this.frame = null; // Buffer (JPEG)
    this.width = 0;
    this.height = 0;
    this.clients = new Set(); // { res, busy }
    this.sentAt = []; // 直近の送信時刻 (fps の計算用)
    this.frames = 0;
  }

  /** 新しい 1 枚。つながっている全員に送る (詰まっている相手には飛ばす = 遅い相手が全体を遅らせない) */
  push(buf, width, height) {
    this.frame = buf;
    this.width = width;
    this.height = height;
    this.frames++;
    const now = Date.now();
    this.sentAt.push(now);
    while (this.sentAt.length && now - this.sentAt[0] > 2000) this.sentAt.shift();
    for (const c of this.clients) writePart(c, buf);
  }

  fps() {
    if (this.sentAt.length < 2) return 0;
    const span = (this.sentAt[this.sentAt.length - 1] - this.sentAt[0]) / 1000;
    return span > 0 ? Math.round(((this.sentAt.length - 1) / span) * 10) / 10 : 0;
  }

  closeAll() {
    for (const c of this.clients) {
      try { c.res.end(); } catch { /* ignore */ }
    }
    this.clients.clear();
  }
}

function writePart(client, buf) {
  if (client.busy) return; // 前の 1 枚がまだ出ていない
  const head = Buffer.from(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`, 'ascii');
  const ok = client.res.write(Buffer.concat([head, buf, Buffer.from('\r\n', 'ascii')]));
  if (!ok) {
    client.busy = true;
    client.res.once('drain', () => { client.busy = false; });
  }
}

/** この PC の LAN の IPv4 (内部向けを除く) */
function lanAddresses() {
  const out = [];
  for (const [ifname, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (v4 && !a.internal) out.push({ ifname, address: a.address });
    }
  }
  return out;
}

/**
 * @param {object} opts
 * @param {Map<string, StreamHub>} opts.hubs
 * @param {() => string} opts.getToken  空なら認証なし
 * @param {(action: string, key?: string) => Promise<{ status: number, body: object }>} opts.control
 * @param {() => boolean} opts.controlAvailable
 * @param {(line: string) => void} [opts.log]
 * @param {(remote: string, path: string) => void} [opts.onRequest]  つないできた相手 (この PC 以外から届いたかを画面に出す)
 */
function createServer(opts) {
  const log = opts.log || (() => {});
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (opts.onRequest) opts.onRequest(req.socket.remoteAddress || '', url.pathname);
    const token = opts.getToken();
    if (token) {
      const given = url.searchParams.get('token') || req.headers['x-token'];
      if (given !== token) return sendJson(res, 401, { error: 'token required (?token= or X-Token header)' });
    }
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (req.method === 'GET' && parts[0] === 'stream' && parts.length === 2) {
      const hub = opts.hubs.get(parts[1]);
      if (!hub) return sendJson(res, 404, { error: `no stream named "${parts[1]}"`, streams: [...opts.hubs.keys()] });
      res.writeHead(200, {
        'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Connection: 'close',
      });
      req.socket.setNoDelay(true);
      const client = { res, busy: false };
      hub.clients.add(client);
      log(`+ client ${req.socket.remoteAddress} → ${hub.name} (${hub.clients.size})`);
      if (hub.frame) writePart(client, hub.frame); // 変わるまで待たせない
      const drop = () => {
        if (hub.clients.delete(client)) log(`- client ${req.socket.remoteAddress} ← ${hub.name} (${hub.clients.size})`);
      };
      req.on('close', drop);
      res.on('error', drop);
      return;
    }

    if (req.method === 'GET' && parts[0] === 'frame' && parts.length === 2) {
      const hub = opts.hubs.get(parts[1].replace(/\.jpe?g$/i, ''));
      if (!hub) return sendJson(res, 404, { error: 'no such stream' });
      if (!hub.frame) return sendJson(res, 503, { error: 'no frame yet' });
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': hub.frame.length, 'Cache-Control': 'no-cache' });
      return res.end(hub.frame);
    }

    if (req.method === 'GET' && (parts[0] === 'status' || parts.length === 0)) {
      return sendJson(res, 200, {
        streams: [...opts.hubs.values()].map((h) => ({
          name: h.name, source: h.source, width: h.width, height: h.height, fps: h.fps(), clients: h.clients.size,
        })),
        control: opts.controlAvailable(),
      });
    }

    if (req.method === 'POST' && parts[0] === 'control') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', async () => {
        let msg = {};
        try { msg = body.trim() ? JSON.parse(body) : {}; } catch { return sendJson(res, 400, { error: 'body must be JSON' }); }
        // フォームや ?action= でも受ける (簡単なクライアント用)
        const action = String(msg.action || url.searchParams.get('action') || '');
        const key = msg.key != null ? String(msg.key) : url.searchParams.get('key') || undefined;
        try {
          const r = await opts.control(action, key);
          log(`control ${action}${key ? ' ' + key : ''} → ${r.status}`);
          sendJson(res, r.status, r.body);
        } catch (e) {
          sendJson(res, 500, { error: String(e && e.message || e) });
        }
      });
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      return res.end();
    }
    sendJson(res, 404, { error: 'not found', endpoints: ['/stream/<name>', '/frame/<name>.jpg', '/status', 'POST /control'] });
  });
  return server;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, ...corsHeaders() });
  res.end(body);
}

module.exports = { StreamHub, createServer, lanAddresses, BOUNDARY };
