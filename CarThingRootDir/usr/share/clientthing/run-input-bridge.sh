#!/bin/sh
set -eu

# Resilient launcher for on-device input bridge
BASE_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
LOG_FILE="${BASE_DIR}/input-bridge.log"
while true; do
  NODE_BIN="$(command -v node || command -v nodejs || true)"
  if [ -z "$NODE_BIN" ]; then
    echo "[input-bridge] node runtime not found" >"$LOG_FILE"
    sleep 5
    continue
  fi
  "$NODE_BIN" "${BASE_DIR}/input-bridge.js" >"$LOG_FILE" 2>&1
  sleep 1
done
