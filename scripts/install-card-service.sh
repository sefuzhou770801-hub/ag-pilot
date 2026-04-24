#!/usr/bin/env bash
set -euo pipefail

LABEL="com.zhousefu.cc-codex-bridge.card"
PORT="${CC_CODEX_BRIDGE_PORT:-4319}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/$LABEL.plist"
LOG="$ROOT/card-server.log"
ERR_LOG="$ROOT/card-server.err.log"
UID_VALUE="$(id -u)"

mkdir -p "$PLIST_DIR"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$ROOT/server.mjs</string>
    <string>$PORT</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CC_CODEX_BRIDGE_PORT</key>
    <string>$PORT</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>1</integer>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$ERR_LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1 || true

EXISTING_PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$EXISTING_PIDS" ]; then
  kill $EXISTING_PIDS 2>/dev/null || true
  sleep 0.3
fi

launchctl bootstrap "gui/$UID_VALUE" "$PLIST"
launchctl enable "gui/$UID_VALUE/$LABEL"
launchctl kickstart -k "gui/$UID_VALUE/$LABEL"

sleep 0.6

if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Card service did not start on port $PORT" >&2
  exit 1
fi

echo "Card service installed: http://127.0.0.1:$PORT/"
