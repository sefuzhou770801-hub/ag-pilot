#!/usr/bin/env bash
set -euo pipefail

PORT="${CC_CODEX_BRIDGE_PORT:-4319}"
ROOT="/Users/zhousefu/.gemini/tools/cc-codex-bridge"
LOG="$ROOT/card-server.log"

if ! lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  nohup node "$ROOT/server.mjs" "$PORT" >"$LOG" 2>&1 &
fi

sleep 0.4

if [ -d "/Applications/Google Chrome.app" ]; then
  open -n -a "Google Chrome" --args --app="http://127.0.0.1:$PORT/"
else
  open "http://127.0.0.1:$PORT/"
fi
