# Arsist ScreenCast

PC の **画面かウィンドウを MJPEG で LAN に配信** し、Quest のアプリからの **スライド送り** を受けて PC でキーを押す、
小さな PC アプリ (Electron)。Arsist の UI の画像 (`source: { kind: 'stream', url: 'http://{store:pc.address}/stream/slides' }`)
がこれを映す。仕様は `doc/23-cameras-media.md` §5、使い方の見本は `../presentation-recorder`。

## 起動

リポジトリの直下で一度 `npm install` してあれば、新しく入れるものは無い (そこの Electron を使う)。

```bash
ScreenCast/start.sh          # Linux / macOS
products\ScreenCast\start.bat         # Windows
# または: npx electron ScreenCast
```

起動すると、すぐに配信が始まる (サーバーは起動した時点で立つ)。

1. 一番上の **「Quest に入れるアドレス」** (`192.168.x.x:8090`) を、Quest のアプリの「PC のアドレス」に入れる。
   いくつか出ているときは Quest と同じ Wi-Fi のもの。
2. **スライド** と **カンペ** の 2 つの枠に、映すものを選ぶ:
   - X11 / Windows / macOS: 「画面を選ぶ」か「ウィンドウを選ぶ」→ サムネイルの一覧から 1 つクリック
   - Wayland: 「画面かウィンドウを選ぶ」→ OS の共有の窓で選ぶ (起動し直したら選び直す)
   選ぶとすぐ映る。枠の中の画は Quest に届いているのと同じ 1 枚。選んでいない枠は、Quest に「選ばれていません」と出る。
   前回選んだもの (X11 / Windows / macOS) は次の起動でも使う (ウィンドウは名前で探し直す)。
3. **Quest からの接続** に「〇〇 から届きました」と出れば、つながっている。
   出ないまま Quest がタイムアウトするなら、たいていファイアウォール。下の「ポート 8090 を開ける」を押す
   (Linux: ufw / firewalld を見つけたら出る。管理者の確認の窓が出る。LAN (同じ /24) からだけ許す。
   Windows: 管理者の確認のあと Windows Defender に規則を足す)。押せないときは、出てくるコマンドを端末で実行。
4. 画質 (最大の幅・fps の上限・JPEG の画質) とポート・トークンは「詳しい設定」。

設定はこのアプリだけの場所 (`~/.config/arsist-screencast/settings.json`、Windows は `%APPDATA%\arsist-screencast\`) に残る。

### 画面の無い起動 (テスト・常駐)

```bash
start.sh --headless --source screen:0 --name slides [--source window:Notes --name notes] \
         [--port 8090] [--host 0.0.0.0] [--fps 15] [--max-width 1920] [--quality 0.8] [--token X]
start.sh --list-sources        # 選べる画面とウィンドウの id と名前
```

`--source` は元の id (`screen:0:0`)、`screen:N` (N 番目の画面)、`window:<名前の一部>`、名前の一部のどれでもよい。
同じ画面を 2 本に使ってもよい (取り込みは 1 つにまとめる)。ディスプレイの無いマシンでは `xvfb-run -a start.sh --headless …`。

## HTTP

| | |
|---|---|
| `GET /stream/<name>` | `multipart/x-mixed-replace; boundary=arsistframe`。部分ごとに `Content-Type: image/jpeg` と `Content-Length`。つないだら最新の 1 枚をすぐ送り、あとは **画面が変わったときだけ** (と 5 秒に 1 回) 送る |
| `GET /frame/<name>.jpg` | 最新の 1 枚 |
| `GET /status` | `{ streams: [{ name, source, width, height, fps, clients }], control }` (`control` = キーを押せるか) |
| `POST /control` | `{ "action": "next" \| "prev" \| "first" \| "last" \| "key", "key"?: "Right" … }` → PC でキーを押す。押せなければ 501 |

- 「変わった」は、320×180 に縮めた画で色が変わった画素の割合で決める (既定 0.0001 ≒ 6 画素。数字 1 つ・マウスの移動でも送る)。
  止まっている画面ではほとんど何も流れないので、Wi-Fi に優しい。
- `key` で押せるのは決まった名前だけ: `Right Left Up Down Home End Page_Up Page_Down space Return Escape F5 b w period`。
  `next` = →、`prev` = ←、`first` = Home、`last` = End。
- **トークン** (任意) を入れると、全部に `?token=…` か `X-Token` ヘッダーが要る (無いと 401)。画面の URL には付いている。

### キーの押し方 (スライド送り)

| OS | 使うもの |
|---|---|
| Linux (X11) | `xdotool` (`sudo apt install xdotool` など) |
| Linux (Wayland) | `wtype` か `ydotool` (ydotool は `ydotoold` が動いていること)。どちらも無ければ 501 |
| Windows | PowerShell の `WScript.Shell.SendKeys` (追加は不要) |
| macOS | `osascript` (初回に「アクセシビリティ」の許可を求められる) |

キーは **前面のウィンドウ** に届く。スライドのアプリ (PowerPoint・Keynote・Google スライド・PDF ビューア) を前面に。

## Quest の見本と使う

`../presentation-recorder` (README あり):

1. PC でこのアプリを起動し、`slides` にスライド、`notes` に発表者ツール / カンペを選んで配信開始
2. Quest でアプリを起動し、手元の板のキーボードで `192.168.x.x:8090` を入れて Enter
3. スクリーンにスライド、正面のカンペに `notes` が映る。右 A / B (または板のボタン) で PC のスライドが進む / 戻る
4. 左 X で録画開始 / 停止 → Quest の `Movies/Arsist/` に MP4

## 注意

- **ファイアウォール**: ポート 8090 (TCP) の受信を許可する。Windows は初回起動時に「アクセスを許可」でプライベートネットワークを選ぶ。
  Linux の ufw なら `sudo ufw allow 8090/tcp`。PC と Quest は同じ LAN (同じ Wi-Fi) に。ゲスト Wi-Fi は端末どうしの通信を止めていることが多い。
- **Wayland** (GNOME / KDE の既定) では、画面の取り込みは **xdg-desktop-portal (PipeWire)** を通る。「画面を読み直す」や配信開始のときに
  OS が「どの画面を共有するか」を尋ねる窓を出すので、そこで選ぶ (アプリの一覧は、その窓で選んだものになる)。
  ポータルが無い環境では何も選べない。X11 のセッションならこの窓は出ない。
- 暗号化は無い (HTTP)。家や会社の LAN の中だけで使う。外から見えるネットワークではトークンを付ける。
- 映すのは画面の画だけで、音は送らない。

## ファイル

| | |
|---|---|
| `main.cjs` | Electron の main。設定、窓、取り込み窓、IPC、`--headless` |
| `capture.html` / `capture.js` | 見えない窓。`getUserMedia({ chromeMediaSource: 'desktop' })` → 変わったら JPEG → main |
| `server.cjs` | HTTP (Electron に依存しない) |
| `keys.cjs` | キーを押す (OS ごと。シェルを通さない) |
| `ui.html` / `ui.js` / `preload.cjs` | 設定の窓 (日本語 / English) |
| `start.sh` / `start.bat` | 起動 |
