#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [ ! -d node_modules ]; then
  echo "[agent-dashboard] installing dependencies..."
  npm install
fi

echo "[agent-dashboard] starting API on :3456 ..."
nohup npm run dev:api > "$ROOT/.api.log" 2>&1 &
API_PID=$!

echo "[agent-dashboard] starting web on :4173 ..."
nohup npm run dev -- --host 0.0.0.0 --port 4173 > "$ROOT/.web.log" 2>&1 &
WEB_PID=$!

echo "$API_PID" > "$ROOT/.api.pid"
echo "$WEB_PID" > "$ROOT/.web.pid"

echo "started"
echo "- web: http://$(hostname -I | awk '{print $1}'):4173/"
echo "- api: http://$(hostname -I | awk '{print $1}'):4173/api/health"
echo "- api pid: $API_PID"
echo "- web pid: $WEB_PID"
