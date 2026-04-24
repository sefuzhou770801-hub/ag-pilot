#!/usr/bin/env bash
set -euo pipefail

PORT="${AG_CDP_PORT:-9333}"
ARGV_PATH="${AG_ARGV_PATH:-$HOME/Library/Application Support/Antigravity/argv.json}"

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "Invalid CDP port: $PORT" >&2
  exit 1
fi

mkdir -p "$(dirname "$ARGV_PATH")"

CURRENT_PORT="$(node -e "
const fs = require('fs');
const file = process.argv[1];
try {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const port = data['remote-debugging-port'];
  if (port !== undefined) process.stdout.write(String(port));
} catch {}
" "$ARGV_PATH")"

if [ "$CURRENT_PORT" = "$PORT" ]; then
  echo "Antigravity CDP is already enabled on port $PORT."
  echo "No changes made: $ARGV_PATH"
  exit 0
fi

if [ -f "$ARGV_PATH" ]; then
  BACKUP_PATH="$ARGV_PATH.backup.$(date +%Y%m%d-%H%M%S)"
  cp "$ARGV_PATH" "$BACKUP_PATH"
  echo "Backup created: $BACKUP_PATH"
else
  echo "No existing argv.json found. Creating: $ARGV_PATH"
fi

node -e "
const fs = require('fs');
const file = process.argv[1];
const port = Number(process.argv[2]);
let data = {};
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error('Failed to parse argv.json. Restore from backup and fix the JSON first.');
    process.exit(1);
  }
}
if (!data || Array.isArray(data) || typeof data !== 'object') {
  console.error('argv.json must contain a JSON object.');
  process.exit(1);
}
data['remote-debugging-port'] = port;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\\n');
" "$ARGV_PATH" "$PORT"

echo "Antigravity CDP enabled on port $PORT."
echo "Restart Antigravity for the setting to take effect."
