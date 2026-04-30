#!/usr/bin/env bash
set -euo pipefail

PORT="${AG_PILOT_PORT:-4319}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.ag-pilot.card"
UID_VALUE="$(id -u)"

if ! launchctl print "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1; then
  "$ROOT/scripts/install-card-service.sh"
elif ! lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$UID_VALUE/$LABEL"
fi

sleep 0.4

if [ -d "/Applications/Google Chrome.app" ]; then
  open -n -a "Google Chrome" --args --app="http://127.0.0.1:$PORT/"
else
  open "http://127.0.0.1:$PORT/"
fi
