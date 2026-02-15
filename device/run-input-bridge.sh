#!/bin/sh
while true; do
  python3 /tmp/input-bridge.py >/tmp/input-bridge.log 2>&1
  sleep 1
done
