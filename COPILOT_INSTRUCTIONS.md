This repository contains a headless server for embedded devices.

Rules:
- No Electron or desktop UI
- Server runs headless
- UI is served over HTTP
- Devices connect via WebSocket
- Firmware is minimal and hardware-only

Architecture:
- server/: core server logic
- server/apps/: installable server-side apps
- ui/: web UI delivered to devices
- shared/: protocol and shared types

Apps:
- Apps are server-side modules
- Apps can be enabled/disabled
- Apps expose UI fragments and logic
- No authentication or databases

Keep device protocol, state management, and app framework separate.
