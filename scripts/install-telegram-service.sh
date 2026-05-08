#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_LABEL="com.ag-pilot.telegram-bot"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

if [ -z "${AG_TELEGRAM_TOKEN:-}" ]; then
  echo "AG_TELEGRAM_TOKEN is not set"
  exit 1
fi

if [ -z "${AG_TELEGRAM_CHAT_ID:-}" ]; then
  echo "AG_TELEGRAM_CHAT_ID is not set"
  exit 1
fi

NODE_PATH="$(which node)"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${PROJECT_DIR}/telegram-bot.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AG_TELEGRAM_TOKEN</key>
    <string>${AG_TELEGRAM_TOKEN}</string>
    <key>AG_TELEGRAM_CHAT_ID</key>
    <string>${AG_TELEGRAM_CHAT_ID}</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${PROJECT_DIR}/logs/telegram-bot.log</string>
  <key>StandardErrorPath</key>
  <string>${PROJECT_DIR}/logs/telegram-bot.log</string>
</dict>
</plist>
EOF

mkdir -p "$PROJECT_DIR/logs"
launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"

echo "Telegram Bot service registered: ${PLIST_LABEL}"
echo "  Logs: ${PROJECT_DIR}/logs/telegram-bot.log"
echo "  Stop: launchctl bootout gui/$(id -u)/${PLIST_LABEL}"
