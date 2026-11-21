/**
 * ファイアウォールで、このポートへの LAN からの接続を許す。
 *
 *   detect()          { kind: 'ufw' | 'firewalld' | 'windows' | null, active }   (管理者の権限は要らない)
 *   allow(port, lans) 管理者の確認 (Linux: pkexec の窓 / Windows: UAC) を出してから規則を足す
 *
 * Linux の ufw / firewalld は「有効か」までしか見えない (規則を読むには root が要る) ので、
 * 本当に届いたかは画面の「Quest からの接続」で確かめる。足す規則は LAN (同じ /24) からだけ。
 * コマンドは決まった引数だけを execFile で渡す (shell を通さない。firewalld だけは 2 つを 1 回の確認で
 * 済ませるために sh -c を使うが、中身はポート番号 (数字) だけを埋めた固定の文)。
 */
'use strict';
const { execFile } = require('node:child_process');
const fs = require('node:fs');

function run(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim() });
    });
  });
}

function which(cmd) {
  for (const dir of String(process.env.PATH || '').split(':')) {
    if (dir && fs.existsSync(`${dir}/${cmd}`)) return `${dir}/${cmd}`;
  }
  return null;
}

async function detect() {
  if (process.platform === 'win32') return { kind: 'windows', active: true };
  if (process.platform !== 'linux') return { kind: null, active: false };
  for (const [kind, unit] of [['ufw', 'ufw'], ['firewalld', 'firewalld']]) {
    if (!which(kind === 'ufw' ? 'ufw' : 'firewall-cmd')) continue;
    const r = await run('systemctl', ['is-active', unit], 5000);
    if (r.out === 'active') return { kind, active: true };
  }
  return { kind: null, active: false };
}

/** 192.168.0.12 → 192.168.0.0/24 */
function subnet24(address) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.\d+$/.exec(address || '');
  return m ? `${m[1]}.${m[2]}.${m[3]}.0/24` : null;
}

/**
 * @param {number} port
 * @param {string[]} lanAddresses この PC の LAN のアドレス (規則を LAN に絞るため)
 * @returns {Promise<{ ok: boolean, message: string, command?: string }>}
 */
async function allow(port, lanAddresses) {
  port = Number(port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, message: 'bad port' };
  const fw = await detect();
  const nets = [...new Set(lanAddresses.map(subnet24).filter(Boolean))];

  if (fw.kind === 'ufw') {
    if (!which('pkexec')) return { ok: false, message: 'pkexec not found', command: manual(fw.kind, port, nets) };
    const from = nets[0] || 'any';
    // 1 回の確認で済むように、LAN が複数あっても最初の 1 つ (Quest がつながる Wi-Fi はたいていこれ)
    const r = await run('pkexec', ['ufw', 'allow', 'proto', 'tcp', 'from', from, 'to', 'any', 'port', String(port), 'comment', 'Arsist ScreenCast']);
    return r.ok
      ? { ok: true, message: `ufw: ${from} → ${port}/tcp` }
      : { ok: false, message: r.code === 126 ? 'cancelled' : (r.err || `exit ${r.code}`), command: manual(fw.kind, port, nets) };
  }
  if (fw.kind === 'firewalld') {
    if (!which('pkexec')) return { ok: false, message: 'pkexec not found', command: manual(fw.kind, port, nets) };
    const script = `firewall-cmd --add-port=${port}/tcp && firewall-cmd --permanent --add-port=${port}/tcp`;
    const r = await run('pkexec', ['sh', '-c', script]);
    return r.ok ? { ok: true, message: `firewalld: ${port}/tcp` } : { ok: false, message: r.code === 126 ? 'cancelled' : (r.err || `exit ${r.code}`), command: manual(fw.kind, port, nets) };
  }
  if (fw.kind === 'windows') {
    const rule = `New-NetFirewallRule -DisplayName 'Arsist ScreenCast ${port}' -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow -Profile Private,Domain`;
    const r = await run('powershell.exe', ['-NoProfile', '-Command', `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command',"${rule}"`]);
    return r.ok ? { ok: true, message: `Windows Defender: ${port}/tcp` } : { ok: false, message: r.err || `exit ${r.code}`, command: manual('windows', port, nets) };
  }
  return { ok: true, message: 'no firewall found' };
}

function manual(kind, port, nets) {
  if (kind === 'ufw') return `sudo ufw allow proto tcp from ${nets[0] || 'any'} to any port ${port}`;
  if (kind === 'firewalld') return `sudo firewall-cmd --add-port=${port}/tcp && sudo firewall-cmd --permanent --add-port=${port}/tcp`;
  if (kind === 'windows') return `New-NetFirewallRule -DisplayName 'Arsist ScreenCast' -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow -Profile Private`;
  return '';
}

module.exports = { detect, allow, manual, subnet24 };
