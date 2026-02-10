/*
  Protocol for WebSocket communication between devices and the server.

  All messages are JSON objects with a 'type' field.
*/

// --- Server to Device ---

// Sent when the device first connects
const connect = {
  type: 'connected',
  deviceId: 'string',
  apps: [{
    id: 'string',
    name: 'string',
    enabled: 'boolean'
  }]
};

// Sent when an app is enabled
const appEnabled = {
  type: 'app-enabled',
  appId: 'string'
};

// Sent when an app is disabled
const appDisabled = {
  type: 'app-disabled',
  appId: 'string'
};

// Sent when apps are reloaded
const appsReloaded = {
  type: 'apps-reloaded',
  apps: [{
    id: 'string',
    name: 'string',
    enabled: 'boolean'
  }]
};

// Response from an app to a device input
const appResponse = {
  type: 'app-response',
  appId: 'string',
  data: 'any'
};

// Confirmation that an input was received
const inputReceived = {
  type: 'input-received',
  data: 'any'
};


// --- Device to Server ---

// Sent when a device sends an input event
const input = {
  type: 'input',
  data: {
    type: 'string', // e.g., 'button', 'dial', 'touch'
    value: 'any', // e.g., 'preset1', 'left', { x: 10, y: 20 }
    timestamp: 'number'
  }
};
