#!/usr/bin/env bash
set -euo pipefail

LABEL="com.zhousefu.cc-codex-bridge.card"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_VALUE="$(id -u)"

launchctl bootout "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST"

echo "Card service uninstalled"
