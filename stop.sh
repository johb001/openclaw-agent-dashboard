#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

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
pkill -f "vite --host 0.0.0.0 --port 4173" >/dev/null 2>&1 || true
pkill -f "npm run dev:api" >/dev/null 2>&1 || true
pkill -f "npm run dev -- --host 0.0.0.0 --port 4173" >/dev/null 2>&1 || true

echo "done"
