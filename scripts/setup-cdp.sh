#!/usr/bin/env bash
set -euo pipefail

PORT="${AG_CDP_PORT:-9333}"
ARGV_PATH="${AG_ARGV_PATH:-$HOME/.antigravity/argv.json}"

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "Invalid CDP port: $PORT" >&2
  exit 1
fi

mkdir -p "$(dirname "$ARGV_PATH")"

CURRENT_PORT="$(
  node - "$ARGV_PATH" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
try {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^[ \t]*"remote-debugging-port"[ \t]*:[ \t]*([0-9]+)/m);
  if (match) process.stdout.write(match[1]);
} catch {}
NODE
)"

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

node - "$ARGV_PATH" "$PORT" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const port = Number(process.argv[3]);
let text = '';

try {
  text = fs.readFileSync(file, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error('Failed to read argv.json. Restore from backup and check file permissions.');
    process.exit(1);
  }
  text = '{\n}\n';
}

const portLine = /^[ \t]*"remote-debugging-port"[ \t]*:[ \t]*[0-9]+[ \t]*,?/m;
if (portLine.test(text)) {
  text = text.replace(portLine, (line) => line.replace(/[0-9]+/, String(port)));
} else {
  const closeIndex = text.lastIndexOf('}');
  if (closeIndex === -1) {
    console.error('argv.json must contain a JSON object.');
    process.exit(1);
  }

  let before = text.slice(0, closeIndex);
  const after = text.slice(closeIndex);
  const lastMeaningful = before.replace(/\s+$/g, '').slice(-1);
  if (lastMeaningful && lastMeaningful !== '{' && lastMeaningful !== ',') {
    before = before.replace(/(\S)(\s*)$/s, '$1,$2');
  }
  text = `${before}  "remote-debugging-port": ${port}\n${after}`;
}

fs.writeFileSync(file, text);
NODE

echo "Antigravity CDP enabled on port $PORT."
echo "Restart Antigravity for the setting to take effect."
