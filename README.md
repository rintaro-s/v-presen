# v-presen

Quest をかぶって VRM の姿でプレゼンをし、その様子を動画にするアプリ。PC の画面(スライド)を仮想空間の大きなスクリーンに映し、
仮想カメラで「発表者 + スクリーン」を撮って、Quest の `Movies/Arsist/` に MP4 で保存する。

| フォルダ | 中身 |
|---|---|
| [`presentation-recorder/`](presentation-recorder/README.md) | Quest 側。[Arsist](https://github.com/rintaro-s/Arsist-EN) のプロジェクト(エディタで開いてビルドする) |
| [`ScreenCast/`](ScreenCast/README.md) | PC 側(Electron)。画面を LAN に配信し、Quest からのスライド送りを受けてキーを押す |

## 動かす

1. PC: `ScreenCast/start.sh`(Windows は `start.bat`)で起動し、配信 `slides` にスライドの画面を選ぶ。
2. Quest: Arsist のエディタで `presentation-recorder/` を開いてビルドする。拡張機能 `quest-input`(Arsist の `samples/extensions`)と `vrm10`(公式)が必要。

詳しくはそれぞれの README。
