'use strict';
(() => {
  const api = window.screencast;

  // ---------- 文字 (en / ja) ----------
  const S = {
    serving: { en: 'Serving', ja: '配信中' },
    notServing: { en: 'Not serving', ja: '止まっています' },
    addrTitle: { en: 'Enter this on the Quest (PC address)', ja: 'Quest に入れるアドレス (PC のアドレス)' },
    addrNote: {
      en: 'Type it into the "PC address" field of the Quest app. If there are several, use the one on the same Wi-Fi as the Quest.',
      ja: 'Quest のアプリの「PC のアドレス」に入れます。いくつか出ているときは、Quest と同じ Wi-Fi のものを使ってください。',
    },
    copy: { en: 'Copy', ja: 'コピー' },
    copied: { en: 'Copied', ja: 'コピーしました' },
    pickScreen: { en: 'Choose a screen', ja: '画面を選ぶ' },
    pickWindow: { en: 'Choose a window', ja: 'ウィンドウを選ぶ' },
    pickWayland: { en: 'Choose a screen or window', ja: '画面かウィンドウを選ぶ' },
    clear: { en: 'Stop showing', ja: '映すのをやめる' },
    nothing: { en: 'Nothing chosen yet — the Quest shows "not chosen".', ja: 'まだ選んでいません (Quest には「選ばれていません」と出ます)' },
    showing: { en: 'Showing: {src}', ja: '映しているもの: {src}' },
    viewers: { en: '{n} watching', ja: '{n} 台が視聴中' },
    st_live: { en: 'live', ja: '配信中' },
    st_waiting: { en: 'not chosen', ja: '未選択' },
    st_starting: { en: 'starting…', ja: '開始中…' },
    pickerScreen: { en: 'Which screen?', ja: 'どの画面を映しますか？' },
    pickerWindow: { en: 'Which window?', ja: 'どのウィンドウを映しますか？' },
    pickerEmpty: { en: 'Nothing found.', ja: '見つかりませんでした。' },
    cancel: { en: 'Cancel', ja: 'やめる' },
    waylandNote: {
      en: 'On Wayland the system asks which screen or window to share. Choose again after restarting the app.',
      ja: 'Wayland では、OS の窓で画面かウィンドウを選びます。アプリを起動し直したら、選び直してください。',
    },
    connTitle: { en: 'Connection from the Quest', ja: 'Quest からの接続' },
    connNone: {
      en: 'Nothing has reached this PC from another device yet. If the Quest times out, check the firewall below and that both are on the same Wi-Fi.',
      ja: 'まだ他の機器から届いていません。Quest がタイムアウトするときは、下のファイアウォールと、同じ Wi-Fi につながっているかを確かめてください。',
    },
    connSeen: { en: 'Reached from {addr} ({ago})', ja: '{addr} から届きました ({ago})' },
    secAgo: { en: '{n} s ago', ja: '{n} 秒前' },
    minAgo: { en: '{n} min ago', ja: '{n} 分前' },
    fwActive: {
      en: '{kind} is on. It may block the Quest. Allow port {port} from your LAN:',
      ja: 'ファイアウォール ({kind}) が有効です。Quest からの接続が止められることがあります。LAN からポート {port} を許可してください:',
    },
    fwOpened: { en: 'Port {port} is allowed in {kind}.', ja: 'ファイアウォール ({kind}) でポート {port} を許可済みです。' },
    fwButton: { en: 'Allow port {port}', ja: 'ポート {port} を開ける' },
    fwAsking: { en: 'Asking for permission…', ja: '管理者の確認を待っています…' },
    fwDone: { en: 'Allowed: {msg}', ja: '許可しました: {msg}' },
    fwFailed: { en: 'Could not change it ({msg}). Run this in a terminal:', ja: '変えられませんでした ({msg})。端末でこれを実行してください:' },
    fwNone: { en: 'No firewall found on this PC.', ja: 'この PC にファイアウォールは見つかりませんでした。' },
    control: { en: 'Slide control from the Quest', ja: 'Quest からのスライド送り' },
    controlVia: { en: 'Keys are pressed with: {via}', ja: 'キーを押す方法: {via}' },
    controlNone: {
      en: 'No key tool found (Linux: install xdotool, or wtype / ydotool on Wayland). Streaming still works.',
      ja: 'キーを押す道具が見つかりません (Linux: xdotool、Wayland なら wtype か ydotool)。配信はできます。',
    },
    prev: { en: '◀ Previous', ja: '◀ 前へ' },
    next: { en: 'Next ▶', ja: '次へ ▶' },
    advanced: { en: 'Advanced', ja: '詳しい設定' },
    port: { en: 'Port', ja: 'ポート' },
    token: { en: 'Token (optional)', ja: 'トークン (任意)' },
    applyServer: { en: 'Apply', ja: '反映' },
    tokenNote: {
      en: 'With a token, the Quest needs ?token=… in its URLs. Leave empty on a home LAN.',
      ja: 'トークンを入れると、Quest 側の URL にも ?token=… が要ります。家の LAN なら空のままで構いません。',
    },
    maxWidth: { en: 'Max width (px)', ja: '最大の幅 (px)' },
    fps: { en: 'FPS cap', ja: 'fps の上限' },
    quality: { en: 'JPEG quality', ja: 'JPEG の画質' },
    lang: { en: '日本語', ja: 'English' },
  };
  let lang = 'ja';
  const t = (k, p) => {
    let s = (S[k] && (S[k][lang] || S[k].en)) || k;
    if (p) for (const [a, b] of Object.entries(p)) s = s.split(`{${a}}`).join(b);
    return s;
  };

  let info = null;
  let status = null;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  async function init() {
    info = await api.settings();
    lang = info.settings.language || (String(info.locale).startsWith('ja') ? 'ja' : 'en');
    $('lang').onclick = async () => { lang = lang === 'ja' ? 'en' : 'ja'; await api.language(lang); renderStatic(); poll(); };
    $('prev').onclick = () => control('prev');
    $('next').onclick = () => control('next');
    $('pickerClose').onclick = () => $('picker').classList.remove('on');
    $('applyServer').onclick = async () => {
      const r = await api.server({ port: Number($('port').value) || 8090, token: $('token').value });
      $('serverError').textContent = r.ok ? '' : r.error;
      poll();
    };
    $('port').value = info.settings.port;
    $('token').value = info.settings.token || '';
    renderStatic();
    await poll();
    setInterval(poll, 1000);
  }

  function renderStatic() {
    document.documentElement.lang = lang;
    $('lang').textContent = t('lang');
    for (const e of document.querySelectorAll('[data-t]')) e.textContent = t(e.dataset.t);
  }

  async function poll() {
    status = await api.status();
    render();
  }

  // ---------- 描画 ----------
  let slotEls = null;
  function render() {
    $('servePill').textContent = status.serving ? t('serving') : t('notServing');
    $('servePill').className = status.serving ? 'pill ok' : 'pill err';
    if (status.serverError) $('serverError').textContent = status.serverError;

    // アドレス
    const box = $('addrs');
    const key = JSON.stringify([status.addresses, status.port, lang]);
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.textContent = '';
      const list = status.addresses.length ? status.addresses : [{ address: '127.0.0.1', ifname: 'lo' }];
      for (const a of list) {
        const text = `${a.address}:${status.port}`;
        const code = el('code', null, text);
        const b = el('button', null, t('copy'));
        b.onclick = async () => { await api.copy(text); b.textContent = t('copied'); setTimeout(() => { b.textContent = t('copy'); }, 1200); };
        box.append(code, el('span', 'muted', a.ifname), b);
      }
    }

    // 枠
    if (!slotEls || slotEls.lang !== lang) buildSlots();
    for (const s of status.slots) updateSlot(s);

    // 接続
    const conn = $('conn');
    conn.textContent = '';
    if (status.lastRemote) {
      const sec = Math.round((Date.now() - status.lastRemote.at) / 1000);
      const ago = sec < 120 ? t('secAgo', { n: sec }) : t('minAgo', { n: Math.round(sec / 60) });
      conn.append(el('span', 'pill ok', t('connSeen', { addr: status.lastRemote.address, ago })));
    } else {
      conn.append(el('div', 'muted', t('connNone')));
    }
    renderFirewall();

    $('controlInfo').textContent = status.control ? t('controlVia', { via: status.control }) : t('controlNone');
  }

  function buildSlots() {
    const box = $('slots');
    box.textContent = '';
    slotEls = { lang, map: {} };
    for (const s of status.slots) {
      const sec = el('section', 'slot');
      const h = el('h3', null, s.title[lang] || s.title.en);
      const pill = el('span', 'pill');
      h.append(pill);
      const img = el('img', 'preview');
      img.alt = '';
      const src = el('div', 'src');
      const row = el('div', 'row');
      if (status.wayland) {
        const b = el('button', 'primary', t('pickWayland'));
        b.onclick = () => pick(s.name, 'screen');
        row.append(b);
      } else {
        const bs = el('button', 'primary', t('pickScreen'));
        bs.onclick = () => pick(s.name, 'screen');
        const bw = el('button', null, t('pickWindow'));
        bw.onclick = () => pick(s.name, 'window');
        row.append(bs, bw);
      }
      const clear = el('button', 'ghost', t('clear'));
      clear.onclick = async () => { await api.clear(s.name); poll(); };
      row.append(el('span', 'grow'), clear);
      sec.append(h, img, src, row);
      if (status.wayland) sec.append(el('div', 'note', t('waylandNote')));
      box.append(sec);
      slotEls.map[s.name] = { pill, img, src, clear, lastFrame: -1 };
    }
    buildQuality();
  }

  function updateSlot(s) {
    const e = slotEls.map[s.name];
    if (!e) return;
    const st = String(s.state || '');
    const known = { live: 'st_live', waiting: 'st_waiting', starting: 'st_starting' }[st];
    e.pill.textContent = (known ? t(known) : st) + (s.clients ? ` · ${t('viewers', { n: s.clients })}` : '');
    e.pill.className = st === 'live' ? 'pill ok' : st.startsWith('error') ? 'pill err' : 'pill warn';
    e.src.textContent = s.sourceId ? t('showing', { src: s.sourceName || s.sourceId }) : t('nothing');
    e.clear.disabled = !s.sourceId;
    // 下見: Quest に届くのと同じ 1 枚 (新しいコマが来たときだけ読み直す)
    if (s.frames !== e.lastFrame && status.serving) {
      e.lastFrame = s.frames;
      const q = status.token ? `&token=${encodeURIComponent(status.token)}` : '';
      e.img.src = `http://127.0.0.1:${status.port}/frame/${s.name}.jpg?n=${s.frames}${q}`;
    }
  }

  async function pick(slot, kind) {
    const r = await api.pick(slot, kind);
    if (!r.ok) { if (r.error !== 'cancelled') $('serverError').textContent = r.error; return; }
    if (r.chosen) { poll(); return; } // Wayland: OS の窓で選び終わっている
    const list = $('pickerList');
    list.textContent = '';
    $('pickerTitle').textContent = kind === 'window' ? t('pickerWindow') : t('pickerScreen');
    if (!r.list.length) list.append(el('div', 'muted', t('pickerEmpty')));
    for (const src of r.list) {
      const b = el('button', 'item');
      const img = el('img');
      img.src = src.thumbnail || '';
      img.alt = '';
      b.append(img, el('span', null, src.name));
      b.onclick = async () => { $('picker').classList.remove('on'); await api.choose(slot, src); poll(); };
      list.append(b);
    }
    $('picker').classList.add('on');
  }

  function renderFirewall() {
    const box = $('fw');
    const fw = status.firewall || {};
    const key = JSON.stringify([fw, status.port, lang, box.dataset.busy || '']);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    if (box.dataset.busy) return;
    box.textContent = '';
    if (!fw.kind) { box.append(el('div', 'note', t('fwNone'))); return; }
    if (fw.opened) { box.append(el('div', 'note', t('fwOpened', { kind: fw.kind, port: status.port }))); return; }
    box.append(el('div', 'muted', t('fwActive', { kind: fw.kind, port: status.port })));
    const b = el('button', 'warn', t('fwButton', { port: status.port }));
    b.style.marginTop = '8px';
    const out = el('div', 'note');
    b.onclick = async () => {
      box.dataset.busy = '1';
      b.disabled = true;
      out.textContent = t('fwAsking');
      const r = await api.firewall();
      delete box.dataset.busy;
      b.disabled = false;
      out.textContent = r.ok ? t('fwDone', { msg: r.message }) : t('fwFailed', { msg: r.message });
      if (!r.ok && r.command) out.append(el('code', 'cmd', r.command));
    };
    box.append(b, out);
  }

  function buildQuality() {
    const box = $('qualityBox');
    box.textContent = '';
    for (const s of status.slots) {
      const h = el('h2', null, s.title[lang] || s.title.en);
      h.style.marginTop = '14px';
      box.append(h);
      const g = el('div', 'grid');
      const num = (label, value, k, attrs) => {
        const l = el('label');
        const i = el('input');
        Object.assign(i, { type: 'number', value }, attrs);
        i.onchange = () => api.quality(s.name, { [k]: Number(i.value) });
        l.append(el('span', null, label), i);
        return l;
      };
      g.append(
        num(t('maxWidth'), s.maxWidth, 'maxWidth', { min: 160, max: 7680, step: 160 }),
        num(t('fps'), s.fps, 'fps', { min: 1, max: 60 }),
        num(t('quality'), s.quality, 'quality', { min: 0.1, max: 1, step: 0.05 }),
      );
      box.append(g);
    }
  }

  async function control(action) {
    const r = await api.control(action);
    $('controlResult').textContent = r.status === 200 ? `✓ ${r.body.key} (${r.body.via})` : (r.body.error || r.status);
  }

  init();
})();
