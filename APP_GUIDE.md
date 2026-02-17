# App Development Guide

This guide explains how to create apps for ServerThing.

## App Structure

Apps are placed in `server/apps/<app-name>/index.js` and export a module with:

```javascript
module.exports = {
  // Required: App metadata
  metadata: {
    name: 'Display Name',
    description: 'What this app does',
    version: '1.0.0'
  },

  // Recommended: Initialization hook
  init({ app, onInput, sendToDevice }) {
    // app: The Express app instance (for routes)
    // onInput: Register a callback for device input
    // sendToDevice: Broadcast messages back to devices

    onInput((input) => {
      console.log('App received input:', input);
    });

    app.get('/apps/my-app/data', (req, res) => {
      res.json({ message: 'Hello from ServerThing!' });
    });
  },

  // Legacy (Optional): Handle device input events
  handleInput(deviceId, input) {
    // input.type: 'button', 'dial', or 'touch'
    // input.value: button value, dial direction, or touch gesture
    // input.timestamp: when the event occurred
    
    // Return data to send back to device, or null
    return { action: 'response', data: 'value' };
  },

  // Optional: Provide HTML UI
  getUI() {
    return '<div>Your app interface</div>';
  }
};
```

## Input Event Reference

### Button Events
- `preset1` - Preset button 1
- `preset2` - Preset button 2
- `preset3` - Preset button 3
- `preset4` - Preset button 4

### Dial Events
- `left` - Dial turned counter-clockwise
- `right` - Dial turned clockwise

### Touch Events
- `tap` - Screen tap
- `swipe-left` - Swipe left gesture
- `swipe-right` - Swipe right gesture

## State Management

Apps should maintain their own state. Use JavaScript data structures:

```javascript
const state = new Map(); // deviceId -> device state

module.exports = {
  handleInput(deviceId, input) {
    if (!state.has(deviceId)) {
      state.set(deviceId, { /* initial state */ });
    }
    
    const deviceState = state.get(deviceId);
    // Update state based on input
    
    return { /* response */ };
  }
};
```

## UI Guidelines

- Return HTML string from `getUI()`
- Use inline styles or standard CSS
- Keep UI simple and responsive
- Display per-device state when relevant

## Example: Counter App

See `server/apps/counter/index.js` for a complete working example.

## Adding New Apps

1. Create directory: `server/apps/my-app/`
2. Create file: `server/apps/my-app/index.js`
3. Implement the module structure above
4. Use "Reload Apps" in the UI or call `/api/apps/reload`
5. No server restart needed!

## Testing

Use the built-in Device Simulator in the web UI:
1. Navigate to http://localhost:3000/ui
2. Click "Connect" in Device Simulator
3. Send test inputs using the buttons
4. View app responses in the Event Log
5. Check app UI in the "App UIs" section
