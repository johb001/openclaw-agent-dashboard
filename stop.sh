#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-3456}"
WEB_PORT="${WEB_PORT:-4173}"

for file in .api.pid .web.pid; do
  if [ -f "$file" ]; then
    PID=$(cat "$file")
    if kill -0 "$PID" >/dev/null 2>&1; then
      kill "$PID" || true
      echo "stopped pid $PID"
    fi
    rm -f "$file"
  fi
done

pkill -f "node server.js" >/dev/null 2>&1 || true
pkill -f "npm run dev:api" >/dev/null 2>&1 || true
pkill -f "npm run preview -- --host 0.0.0.0 --port $WEB_PORT" >/dev/null 2>&1 || true
pkill -f "vite preview --host 0.0.0.0 --port $WEB_PORT" >/dev/null 2>&1 || true
pkill -f "npm run dev -- --host 0.0.0.0 --port $WEB_PORT" >/dev/null 2>&1 || true
pkill -f "vite --host 0.0.0.0 --port $WEB_PORT" >/dev/null 2>&1 || true

if command -v lsof >/dev/null 2>&1; then
  lsof -tiTCP:"$API_PORT" -sTCP:LISTEN | xargs -r kill >/dev/null 2>&1 || true
  lsof -tiTCP:"$WEB_PORT" -sTCP:LISTEN | xargs -r kill >/dev/null 2>&1 || true
fi

echo "done"
