# ServerThing

Headless Node.js server for embedded devices (Superbird/Car Thing). Provides a web UI for monitoring and control, WebSocket endpoint for device communication, and an extensible app plugin system.

## Features

- 🚀 **Lightweight** - Minimal Node.js server with no database, no auth, no Electron
- 🔌 **WebSocket Communication** - Real-time device input handling (button, dial, touch events)
- 🎨 **System UI Shell** - Embedded-style UI runtime for Car Thing (800x480) - never reloads!
- 🖥️ **Control Panel** - Clean web UI for monitoring devices and managing apps
- 🔧 **Plugin System** - Install server-side apps in `server/apps/` directory
- 🔄 **Hot Reload** - Enable/disable apps without server restart
- 📱 **Device Simulator** - Built-in simulator for testing without hardware

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start
```

Server will start on http://localhost:3000

- **System UI Shell** (for Car Thing): http://localhost:3000/shell/
- **Control Panel** (for desktop): http://localhost:3000/ui
- **WebSocket**: ws://localhost:3000/ws/device

## Architecture

```
ServerThing/
├── server/
│   ├── index.js           # Main server (HTTP + WebSocket)
│   └── apps/              # Installable apps
│       └── counter/       # Example counter app
│           ├── index.js   # Server-side logic
│           └── public/    # App UI (served in shell)
├── public/
│   ├── shell/             # System UI Shell (for Car Thing)
│   │   ├── index.html
│   │   ├── shell.css
│   │   └── shell.js
│   └── ui/                # Control Panel (for desktop)
│       ├── index.html
│       ├── style.css
│       └── ui.js
├── shared/
│   └── protocol.js        # Shared message types
└── package.json
```

## Device Communication

Devices connect via WebSocket to `/ws/device?id=<device-id>` and send input events:

```javascript
// Connect to server
const ws = new WebSocket('ws://localhost:3000/ws/device?id=my-device');

// Send input event
ws.send(JSON.stringify({
  type: 'input',
  data: {
    type: 'button',      // 'button', 'dial', or 'touch'
    value: 'preset1',    // button: preset1-4, dial: left/right, touch: tap/swipe-left/swipe-right
    timestamp: Date.now()
  }
}));

// Receive responses
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Server message:', message);
};
```

## System UI Shell

The **System UI Shell** (`/shell/`) is a permanent, embedded-style UI runtime designed specifically for the Spotify Car Thing (800x480 display).

### Key Features

- **Never Reloads**: The shell loads once and runs permanently - apps are loaded/unloaded within it
- **Hardware-Integrated**: Receives all input (rotary encoder, buttons) via WebSocket
- **Full-Screen Apps**: Apps run in isolated iframes with complete viewport control
- **Low Memory**: Optimized for very limited RAM environments
- **Instant Navigation**: Smooth transitions with dial-based navigation

### Usage

1. Point your Car Thing browser to: `http://your-server:3000/shell/`
2. Use the rotary dial to navigate between apps
3. Click the dial to launch an app
4. Press back to open navigation menu (Home, Close App)

### Keyboard Controls (for testing)

- **Arrow Left/Right**: Turn dial
- **Enter**: Dial click
- **Escape**: Back button
- **1-4**: Preset buttons

For detailed documentation, see [SHELL_GUIDE.md](SHELL_GUIDE.md).

## Creating Apps

Apps are Node.js modules placed in `server/apps/<app-name>/index.js`. Each app exports:

```javascript
module.exports = {
  // App metadata
  metadata: {
    name: 'My App',
    description: 'What this app does',
    version: '1.0.0'
  },

  // Handle device input events (optional)
  handleInput(deviceId, input) {
    // Process input and return response
    if (input.type === 'button' && input.value === 'preset1') {
      return { action: 'do-something', data: 'result' };
    }
    return null;
  },

  // Provide HTML UI (optional)
  getUI() {
    return `<div>Your app UI here</div>`;
  }
};
```

### Example: Counter App

See `server/apps/counter/index.js` for a complete example that:
- Maintains per-device counter state
- Increments on Preset 1 / Dial Right
- Decrements on Preset 2 / Dial Left
- Resets on Preset 3
- Displays current counts in the UI

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/devices` | GET | List all connected devices |
| `/api/apps` | GET | List all installed apps |
| `/api/apps/:appId/enable` | POST | Enable an app |
| `/api/apps/:appId/disable` | POST | Disable an app |
| `/api/apps/reload` | POST | Reload all apps from disk |
| `/api/apps/:appId/ui` | GET | Get app UI HTML |

## Input Event Types

**Button Events:**
- `preset1`, `preset2`, `preset3`, `preset4`

**Dial Events:**
- `left` (turn counter-clockwise)
- `right` (turn clockwise)

**Touch Events:**
- `tap`
- `swipe-left`
- `swipe-right`

## Development

The server maintains state for:
- **Connected devices** - ID, connection status, last seen time
- **Input history** - Last 100 input events per device
- **App instances** - Loaded apps with enable/disable state

Apps can be added by:
1. Creating a directory in `server/apps/<app-name>/`
2. Adding an `index.js` file with the app module
3. Clicking "Reload Apps" in the UI or calling `/api/apps/reload`

No server restart required!

## Use Cases

- **Car Thing / Superbird UI** - Custom interfaces for embedded devices
- **Input Event Processing** - React to button, dial, and touch inputs
- **Multi-Device Management** - Monitor and control multiple devices
- **Rapid Prototyping** - Quick app development with hot reload

## License

MIT
ServerThing is a headless server for Car Thing and similar devices. It serves a web-based UI over HTTP/USB, handles device inputs, and supports installable server-side apps. This project was inspired by DeskThing.
