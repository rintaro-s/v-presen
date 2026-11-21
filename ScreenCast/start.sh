#!/bin/sh
# Arsist ScreenCast を起動する。引数はそのまま渡す (例: ./start.sh --headless --source screen:0 --name slides)
HERE="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$HERE/../../node_modules/.bin/electron"
if [ ! -x "$ELECTRON" ]; then
  if command -v electron >/dev/null 2>&1; then
    ELECTRON="$(command -v electron)"
  else
    echo "Electron が見つかりません。リポジトリの直下で npm install してください。" >&2
    exit 1
  fi
fi
# 画面の無い場所 (SSH など) では xvfb-run の中で: xvfb-run -a ./start.sh --headless ...
exec "$ELECTRON" "$HERE" "$@"
