/**
 * 見えない窓で画面を撮る。
 *
 * 映すもの (画面 / ウィンドウ) 1 つにつき getUserMedia (chromeMediaSource: 'desktop') は 1 回だけ (Source)。
 * 同じ画面を 2 本の配信に使っても取り込みは 1 つ (同じ画面を 2 回取り込むと X11 の取り込みが両方止まった)。
 *
 * 配信 (Stream) ごとに fps の間隔で最新の 1 コマを見て:
 *   1) 小さく縮めた画 (320×180) を前に送ったものと比べる。変わった画素の割合が threshold を超えたら送る
 *   2) 変わっていなくても keyframeMs (5 秒) ごとに最後の 1 枚を送り直す (つなぎ直した相手・途中で落ちた相手のため)
 * 送るときは maxWidth に縮めて JPEG (OffscreenCanvas.convertToBlob) にし、バイト列を main へ。
 */
'use strict';
(() => {
  const api = window.screencast;
  // 比べる画の大きさ。画面の取り込みには雑音が無いので、文字 1 つ変わっても拾えるように粗くしすぎない
  const SMALL_W = 320;
  const SMALL_H = 180;
  let streams = [];
  let sources = new Map(); // sourceId → Source

  api.onStart((cfg) => {
    stopAll();
    for (const s of cfg.streams) {
      let src = sources.get(s.sourceId);
      if (!src) {
        src = new Source(s.sourceId);
        sources.set(s.sourceId, src);
      }
      src.wantFps = Math.max(src.wantFps, s.fps);
      src.wantWidth = Math.max(src.wantWidth, s.maxWidth);
      streams.push(new Stream(s, cfg, src));
    }
    for (const src of sources.values()) src.open();
    for (const st of streams) st.start();
    for (const p of cfg.placeholders || []) streams.push(new Placeholder(p, cfg));
  });
  api.onStop(stopAll);

  function stopAll() {
    for (const st of streams) st.stop();
    for (const src of sources.values()) src.close();
    streams = [];
    sources = new Map();
  }

  /** 1 つの画面 / ウィンドウの取り込み。最新のコマ (VideoFrame) と通し番号を持つ */
  class Source {
    constructor(id) {
      this.id = id;
      this.wantFps = 1;
      this.wantWidth = 640;
      this.stream = null;
      this.latest = null; // VideoFrame (track processor)
      this.video = null; // 予備 (track processor が無いとき)
      this.seq = 0;
      this.closed = false;
      this.error = '';
      this.ready = null;
    }

    open() {
      this.ready = (async () => {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: this.id,
                // 縮めるのはこちらで (文字をつぶさないように大きめに受ける)
                maxWidth: Math.max(this.wantWidth, 640) * 2,
                maxHeight: 4320,
                maxFrameRate: Math.max(this.wantFps, 5),
              },
            },
          });
        } catch (e) {
          this.error = `${e && e.name ? e.name + ' ' : ''}${e && e.message || e}`;
          return;
        }
        if (this.closed) { this.close(); return; }
        const track = this.stream.getVideoTracks()[0];
        track.addEventListener('ended', () => { this.error = 'source ended (window closed?)'; });
        if (typeof MediaStreamTrackProcessor === 'function') {
          this.readLoop(new MediaStreamTrackProcessor({ track }).readable.getReader());
        } else {
          this.video = document.createElement('video');
          this.video.muted = true;
          this.video.srcObject = this.stream;
          await this.video.play().catch(() => {});
        }
      })();
      return this.ready;
    }

    async readLoop(reader) {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || this.closed) { if (value) value.close(); break; }
          if (this.latest) this.latest.close();
          this.latest = value;
          this.seq++;
        }
      } catch (e) {
        if (!this.closed) this.error = String(e && e.message || e);
      }
    }

    /** [描けるもの, 幅, 高さ, 通し番号] か null */
    current() {
      if (this.latest) return [this.latest, this.latest.displayWidth, this.latest.displayHeight, this.seq];
      if (this.video && this.video.videoWidth) return [this.video, this.video.videoWidth, this.video.videoHeight, ++this.seq];
      return null;
    }

    close() {
      this.closed = true;
      if (this.latest) { this.latest.close(); this.latest = null; }
      if (this.stream) for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
      if (this.video) { this.video.srcObject = null; this.video = null; }
    }
  }

  /** 1 本の配信 (名前付き)。Source のコマを見て、変わったら JPEG にして送る */
  class Stream {
    constructor(s, cfg, src) {
      this.s = s;
      this.src = src;
      this.threshold = cfg.threshold;
      this.keyframeMs = cfg.keyframeMs;
      this.seenSeq = 0;
      this.busy = false;
      this.prevSmall = null;
      this.lastBytes = null;
      this.lastSize = [0, 0];
      this.lastSent = 0;
      this.timer = null;
      this.stopped = false;
      this.reported = '';
      this.small = new OffscreenCanvas(SMALL_W, SMALL_H);
      this.smallCtx = this.small.getContext('2d', { willReadFrequently: true });
      this.big = new OffscreenCanvas(16, 16);
      this.bigCtx = this.big.getContext('2d', { alpha: false });
    }

    async start() {
      this.state('starting');
      await this.src.ready;
      if (this.stopped) return;
      if (this.src.error) { this.state(`error: ${this.src.error}`); return; }
      this.timer = setInterval(() => this.tick(), Math.round(1000 / this.s.fps));
      this.state('live');
    }

    state(v) {
      if (v === this.reported) return;
      this.reported = v;
      api.sendState(this.s.name, v);
    }

    async tick() {
      if (this.busy || this.stopped) return;
      if (this.src.error) { this.state(`error: ${this.src.error}`); return; }
      const now = performance.now();
      const keyframeDue = this.lastBytes && now - this.lastSent >= this.keyframeMs;
      const cur = this.src.current();
      if (!cur || cur[3] === this.seenSeq) {
        // 画面が止まっていると desktop capturer はコマを出さない。最後の 1 枚を送り直す
        if (keyframeDue) this.send(this.lastBytes, this.lastSize, now);
        return;
      }
      const [img, w, h, seq] = cur;
      this.seenSeq = seq;
      this.busy = true;
      try {
        this.smallCtx.drawImage(img, 0, 0, SMALL_W, SMALL_H);
        const small = this.smallCtx.getImageData(0, 0, SMALL_W, SMALL_H).data;
        const changed = !this.prevSmall || changedRatio(small, this.prevSmall) > this.threshold
          || w !== this.srcW || h !== this.srcH;
        if (!changed) {
          if (keyframeDue) this.send(this.lastBytes, this.lastSize, now);
          return;
        }
        this.srcW = w;
        this.srcH = h;
        const scale = Math.min(1, this.s.maxWidth / w);
        const ow = Math.max(2, Math.round(w * scale / 2) * 2);
        const oh = Math.max(2, Math.round(h * scale / 2) * 2);
        if (this.big.width !== ow || this.big.height !== oh) { this.big.width = ow; this.big.height = oh; }
        this.bigCtx.imageSmoothingQuality = 'high';
        this.bigCtx.drawImage(img, 0, 0, ow, oh);
        const blob = await this.big.convertToBlob({ type: 'image/jpeg', quality: this.s.quality });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        this.prevSmall = small;
        this.lastBytes = bytes;
        this.lastSize = [ow, oh];
        this.send(bytes, this.lastSize, now);
        this.state('live');
      } catch (e) {
        this.state(`error: ${e && e.message || e}`);
      } finally {
        this.busy = false;
      }
    }

    send(bytes, [w, h], now) {
      this.lastSent = now;
      api.sendFrame(this.s.name, bytes, w, h);
    }

    stop() {
      this.stopped = true;
      clearInterval(this.timer);
    }
  }

  /**
   * まだ何も選ばれていない枠。「選ばれていません」の 1 枚を作り、keyframeMs ごとに送り直す。
   * Quest の側は「つながったのに何も来ない」で待たされず、PC の画面で選べばよいと分かる。
   */
  class Placeholder {
    constructor(p, cfg) {
      this.name = p.name;
      this.timer = null;
      this.bytes = null;
      this.draw(p).then((bytes) => {
        if (this.stopped) return;
        this.bytes = bytes;
        api.sendFrame(this.name, bytes, 1280, 720);
        api.sendState(this.name, 'waiting');
        this.timer = setInterval(() => api.sendFrame(this.name, this.bytes, 1280, 720), cfg.keyframeMs || 5000);
      });
    }

    async draw(p) {
      const c = new OffscreenCanvas(1280, 720);
      const g = c.getContext('2d', { alpha: false });
      g.fillStyle = '#1d2128';
      g.fillRect(0, 0, 1280, 720);
      g.fillStyle = '#e7e9ee';
      g.textAlign = 'center';
      g.font = '600 64px "Noto Sans CJK JP", "Noto Sans JP", "Yu Gothic UI", sans-serif';
      g.fillText(p.title || p.name, 640, 320);
      g.fillStyle = '#8b93a3';
      g.font = '36px "Noto Sans CJK JP", "Noto Sans JP", "Yu Gothic UI", sans-serif';
      g.fillText(p.text || '', 640, 400);
      const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      return new Uint8Array(await blob.arrayBuffer());
    }

    stop() {
      this.stopped = true;
      clearInterval(this.timer);
    }
  }

  /** 変わった画素の割合 (RGB の差の合計が 48 を超えた画素 / 全体) */
  function changedRatio(a, b) {
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (d > 48) n++;
    }
    return n / (a.length / 4);
  }
})();
