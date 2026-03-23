#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-3456}"
WEB_PORT="${WEB_PORT:-4173}"
HOST_IP="$(hostname -I | awk '{print $1}')"
API_TARGET="http://127.0.0.1:$API_PORT"

if [ ! -d node_modules ]; then
  echo "[agent-dashboard] installing dependencies..."
  npm install
fi

echo "[agent-dashboard] stopping old dashboard processes ..."
bash "$ROOT/stop.sh" >/dev/null 2>&1 || true

if command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[agent-dashboard] warning: port $API_PORT is still occupied"
  fi
  if lsof -iTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[agent-dashboard] warning: port $WEB_PORT is still occupied"
  fi
fi

echo "[agent-dashboard] building web (latest dist) ..."
npm run build

echo "[agent-dashboard] starting API on :$API_PORT ..."
nohup env PORT="$API_PORT" WEB_PORT="$WEB_PORT" API_BASE_URL="$API_TARGET" npm run dev:api > "$ROOT/.api.log" 2>&1 &
API_PID=$!

echo "[agent-dashboard] starting preview web on :$WEB_PORT (dist + /api proxy -> :$API_PORT) ..."
nohup env VITE_API_TARGET="$API_TARGET" npm run preview -- --host 0.0.0.0 --port "$WEB_PORT" > "$ROOT/.web.log" 2>&1 &
WEB_PID=$!

echo "$API_PID" > "$ROOT/.api.pid"
echo "$WEB_PID" > "$ROOT/.web.pid"

sleep 2

echo "started"
echo "- web: http://$HOST_IP:$WEB_PORT/"
echo "- api via web proxy: http://$HOST_IP:$WEB_PORT/api/health"
echo "- direct api: $API_TARGET/api/health"
echo "- api pid: $API_PID"
echo "- web pid: $WEB_PID"
echo "- logs: tail -f $ROOT/.api.log $ROOT/.web.log"
