This repository contains a headless server for embedded devices.

Rules:
- No Electron or desktop UI
- Server runs headless
- UI is served over HTTP
- Devices connect via WebSocket
- Firmware is minimal and hardware-only
- Keep dependencies minimal (express, ws only)
- Validate all input events from devices before passing to apps
- Hot-swappable apps must not crash the server or affect other apps

Architecture:
- server/: core server logic
- server/apps/: installable server-side apps
- ui/: web UI delivered to devices
- shared/: protocol and shared types
- Keep three areas strictly separate:
  1. Device protocol & WebSocket input handling
  2. Server app/plugin system (hot-swappable modules)
  3. Web UI serving & device/app display

Apps:
- Apps are server-side Node.js modules
- Apps can be enabled/disabled without server restart
- Apps receive device input events and may update device state
- Apps expose UI fragments via `getUI()` for the web UI
- Apps should be stateless; any persistent state should go through the server's per-device state manager
- No authentication or databases

Goal:
- Maintain a clean separation of concerns
- Ensure apps can be added, removed, or updated safely
- Keep WebSocket input/output and device state handling robust and isolated from app/UI logic

Apps:
- Apps are server-side modules
- Apps can be enabled/disabled
- Apps expose UI fragments and logic
- No authentication or databases

Keep device protocol, state management, and app framework separate.
