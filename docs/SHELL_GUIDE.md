# System UI Shell - Architecture & Development Guide

## Overview

The **System UI Shell** is a permanent, embedded-style UI runtime designed for the Spotify Car Thing (800x480 display). It never reloads, acts as a lightweight operating system layer, and manages the lifecycle of full-screen apps.

## Architecture

### Core Principles

1. **Permanent Runtime**: The shell loads once and never reloads. Apps are loaded/unloaded within the shell.
2. **Embedded-First**: Optimized for very limited RAM and no Wi-Fi connectivity.
3. **Hardware-Integrated**: Receives all hardware input (rotary encoder, buttons) via WebSocket from the server.
4. **Full-Screen Apps**: Apps run in isolated iframes with full viewport access.
5. **Lightweight**: Minimal dependencies, no framework overhead.

### File Structure

```
public/shell/
├── index.html      # Shell HTML structure
├── shell.css       # Optimized CSS for 800x480
└── shell.js        # Shell runtime and lifecycle manager
```

## Shell Components

### 1. Status Bar (30px height)
- Always visible at the top
- Shows connection status, current app name, and time
- Fixed position, z-index 1000

### 2. App Viewport (450px height)
- Full-screen container for apps
- Handles transitions between screens
- Manages home screen and app container

### 3. Home Screen / Launcher
- Grid layout for installed apps
- Dial navigation (left/right to select)
- Enter/dial-click to launch

### 4. App Container
- Full-screen iframe for app UIs
- Sandboxed with `allow-scripts allow-same-origin`
- Message passing for server communication

### 5. Navigation Overlay
- Triggered by "back" button (Escape key)
- Options: Continue, Home, Close App
- Dial navigation, Enter to select

### 6. Loading Indicator
- Shown during app loading
- Prevents interaction during transitions

## Hardware Input Mapping

| Hardware Input | Key Binding | Shell Action |
|---------------|-------------|--------------|
| Dial Left | Arrow Left | Navigate left in grid/menu |
| Dial Right | Arrow Right | Navigate right in grid/menu |
| Dial Click | Enter | Select/Launch/Confirm |
| Back Button | Escape | Show navigation overlay |
| Preset 1-4 | 1-4 keys | Forwarded to active app |

## App Integration

### App Requirements

Apps must provide a `public/index.html` file in their directory:

```
server/apps/my-app/
├── index.js          # Server-side logic (required)
└── public/           # UI files (optional)
    ├── index.html    # Main UI file
    ├── style.css     # App styles
    └── app.js        # App client-side logic
```

### App Lifecycle

1. **Discovery**: Server scans `server/apps/` and marks apps with `hasPublicUI: true`
2. **Launch**: Shell creates iframe pointing to `/apps/{appId}/index.html`
3. **Running**: App receives WebSocket messages via `postMessage` from shell
4. **Close**: Iframe is destroyed, app state cleared from memory

### Server-to-App Communication

Apps receive server messages via `window.postMessage`:

```javascript
// In your app's JavaScript:
window.addEventListener('message', (event) => {
  if (event.data.type === 'server-message') {
    const message = event.data.message;
    // Handle message.type: 'app-response', 'input-received', etc.
  }
});
```

### App-to-Server Communication

Apps can send input or custom messages by posting to the parent:

```javascript
// Send input event
window.parent.postMessage({
  type: 'send-input',
  input: { type: 'button', value: 'preset1' }
}, '*');
```

## Shell Runtime API

The shell exposes a global `window.shell` object for debugging:

```javascript
// Launch an app
shell.launchApp('counter');

// Go to home screen
shell.showHomeScreen();

// Show navigation overlay
shell.showNavigation();

// Send input to server
shell.sendInput('button', 'preset1');
```

## Memory Optimization

### Techniques Used

1. **Single Page Architecture**: No page reloads, minimal DOM creation
2. **Iframe Cleanup**: Apps are fully destroyed when closed
3. **Minimal CSS**: Inline styles, no external frameworks
4. **Asset Optimization**: No images in shell, uses Unicode icons
5. **Event Delegation**: Single event listeners, not per-element

### Best Practices for Apps

- Keep app bundle size minimal (<100KB recommended)
- Use CSS animations over JavaScript when possible
- Clean up event listeners and timers when app closes
- Lazy-load assets only when needed
- Avoid memory leaks with proper cleanup

## Development & Testing

### Local Testing

1. Start the server: `npm start`
2. Open shell: `http://localhost:3000/shell/`
3. Use keyboard for testing:
   - Arrow keys = Dial
   - Enter = Dial Click
   - Escape = Back Button
   - 1-4 = Preset Buttons

### Creating Shell-Compatible Apps

1. Create app directory: `server/apps/my-app/`
2. Add server logic: `index.js` with `metadata` and `handleInput()`
3. Add UI directory: `public/`
4. Create `public/index.html` with your app UI
5. Reload apps in control panel or restart server
6. App appears in shell home screen

### Example: Minimal App

**server/apps/hello/index.js:**
```javascript
module.exports = {
  metadata: {
    name: 'Hello World',
    description: 'Simple test app',
    version: '1.0.0'
  },
  handleInput(deviceId, input) {
    console.log('Input received:', input);
    return { message: 'Hello from server!' };
  }
};
```

**server/apps/hello/public/index.html:**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=800, height=450">
  <style>
    body { 
      margin: 0; 
      background: #1a1a2e; 
      color: #fff; 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      height: 450px;
      font-family: sans-serif;
    }
  </style>
</head>
<body>
  <h1>Hello, Car Thing! 👋</h1>
</body>
</html>
```

## Performance Targets

- **Initial Load**: < 1 second
- **App Launch**: < 500ms
- **Navigation**: < 200ms (instant feel)
- **Memory Usage**: < 50MB for shell + 1 app
- **Frame Rate**: 60fps for all transitions

## Security Considerations

1. **Iframe Sandbox**: Apps run in sandboxed iframes (though with `allow-same-origin` for server communication)
2. **No Eval**: No dynamic code execution in shell
3. **XSS Prevention**: All user content is properly escaped
4. **Input Validation**: All WebSocket messages are validated before processing

## Future Enhancements

- App permissions system
- Inter-app communication
- Persistent app state across shell sessions
- Background app execution
- Push notifications from server
- Custom themes/wallpapers
- Multi-device sync

## Troubleshooting

### App doesn't appear in home screen
- Check that app has `hasPublicUI: true` in server response
- Verify `public/index.html` exists in app directory
- Reload apps via control panel

### App doesn't load
- Check browser console for iframe errors
- Verify app HTML is valid
- Check Content Security Policy headers

### Input not working
- Verify WebSocket connection (green dot in status bar)
- Check server logs for input events
- Ensure app is listening for postMessage events

### Performance issues
- Check memory usage in DevTools
- Look for memory leaks in app code
- Reduce asset sizes (images, fonts)

## Related Documentation

- [App Development Guide](../APP_GUIDE.md)
- [Server API Reference](../README.md)
- [WebSocket Protocol](../shared/protocol.js)
