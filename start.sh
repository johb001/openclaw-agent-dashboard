#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "[agent-dashboard] dev start delegates to latest restart flow to avoid stale code / stale preview mismatch ..."
bash "$ROOT/start-prod.sh"
