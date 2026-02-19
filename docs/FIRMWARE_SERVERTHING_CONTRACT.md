# Firmware -> ServerThing Contract

This document is the source-of-truth connection contract for aligning ServerThing with current Car Thing firmware behavior.

## Bootstrap and Launch

- Server base URLs (in order):
  - `http://127.0.0.1:3000`
  - `http://172.16.42.1:3000`
- Shell launch URL:
  - `/shell/index.html?client=carthing`
- Cache-buster behavior:
  - Appends `t=<timestamp>` to shell URL.
  - Uses `&` if URL already contains `?`, otherwise uses `?`.
- WebSocket pre-launch probe:
  - Path: `/ws/device?id=bootstrap-probe`
  - URL format: `{base http->ws}{wsProbePath}&t=<timestamp>`
  - Success condition: `onopen` only (no message required)
  - Timeout per endpoint: `900ms`
- Failover/retry:
  - Tries endpoints in order each cycle
  - If all fail:
    - first 5 attempts: retry after `1200ms`
    - then retry every `3000ms`

## Input Bridge Defaults

- Service: `clientthing-inputd`
- Default server URL: `http://127.0.0.1:3000`
- Default device ID: `inputd`

## Required Server Endpoints

- `POST /api/input/batch`
  - Request body:
    ```json
    {
      "deviceId": "inputd",
      "events": [
        {
          "deviceId": "inputd",
          "keyCode": 28,
          "isPressed": true,
          "seq": 1,
          "ts": 1730000000000
        }
      ]
    }
    ```
  - Must return 2xx on success; non-2xx causes firmware retry/backoff.

- `POST /api/input/health`
  - Payload includes: `deviceId`, `ts`, `queueSize`, `monitorCount`, `stats`
  - Sent every 10 seconds by default
  - Non-200 is ignored by client

## Input Semantics and Keycodes

- Input events are edge-based (`isPressed: true|false`)
- Repeated pressed state is suppressed by firmware bridge
- Dial emits synthetic press/release pulses

- Virtual keycodes:
  - `KEY_BACK` = 158
  - `KEY_ENTER` = 28
  - `KEY_LEFT` = 105
  - `KEY_RIGHT` = 106
  - `KEY_MENU` = 139
  - `KEY_SETUP` = 141
  - `KEY_CONFIG` = 171
  - `BTN_0` = 256
  - `BTN_1` = 257
  - `BTN_2` = 258
  - `BTN_3` = 259

- Physical to virtual mapping:
  - `1 -> KEY_BACK (158)`
  - `2 -> BTN_0 (256)`
  - `3 -> BTN_1 (257)`
  - `4 -> BTN_2 (258)`
  - `5 -> BTN_3 (259)`
  - `28 -> KEY_ENTER (28)`
  - `139 -> KEY_MENU (139)`
  - `141 -> KEY_SETUP (141)`
  - `171 -> KEY_CONFIG (171)`
  - Dial REL `0x0006/0x0007`: positive -> repeated `KEY_RIGHT`, negative -> repeated `KEY_LEFT`
  - Dial step clamp default max: `6`

## Throughput and Backpressure Expectations

- Queue max default: `256` (oldest dropped when full)
- Batch max default: `16`
- Flush interval default: `16ms`
- Request timeout default: `1000ms`
- Exponential retry default: `200ms` -> `2000ms` (+ jitter)

## Shell Runtime Naming

- Canonical shell runtime filename is `shell.js`.
- Firmware-side bridge comments should reference `shell.js`.

## Out of Scope for Current Firmware Runtime Contract

- No active runtime `clientthing-config.json` override hook in active firmware module.
- No active bridge env override file hook in active firmware module.

## ServerThing Verification Checklist

- Shell identifies `carthing-shell | simulator-shell | web-shell` from query param.
- Canonical runtime is `shell.js`.
- Protocol constants include:
  - `D2S_HELLO='hello'`
  - `S2D_HELLO_ACK='hello-ack'`
  - `Protocol.SHELL_PROTOCOL_VERSION=1`
  - exported in both CJS and ESM
- Shell sends hello on WebSocket open with:
  - `type, deviceId, clientType, protocolVersion, capabilities, shellVersion`
  - `capabilities.acceptsHardwareKeycodes === true` only for `carthing-shell`
- `/ws/device?id=bootstrap-probe` accepts quick open without additional auth/message requirement.
- Shell supports hardware keycodes:
  - `158, 28, 105, 106, 139, 141, 171, 256-259`
- Non-carthing clients cannot execute hardware system commands (reboot/restart/brightness/etc), including disabled UI controls.
- Simulator URL is `/shell/index.html?client=simulator`.
- `/api/input/batch` accepts firmware batch payload and returns prompt 2xx.
- `/api/input/health` accepts periodic status posts.
