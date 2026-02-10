// Protocol constants shared between server, device, and UI.

const MessageType = {
  // Server to Device
  S2D_CONNECTED: 'connected',
  S2D_APP_ENABLED: 'app-enabled',
  S2D_APP_DISABLED: 'app-disabled',
  S2D_APPS_RELOADED: 'apps-reloaded',
  S2D_APP_RESPONSE: 'app-response',
  S2D_INPUT_RECEIVED: 'input-received',

  // Device to Server
  D2S_INPUT: 'input',
  
  // Server to UI
  S2U_DEVICES_CHANGED: 'devices-changed',
  S2U_APPS_CHANGED: 'apps-changed',
};

const InputType = {
  BUTTON: 'button',
  DIAL: 'dial',
  TOUCH: 'touch',
};

const ButtonValue = {
  PRESET_1: 'preset1',
  PRESET_2: 'preset2',
  PRESET_3: 'preset3',
  PRESET_4: 'preset4',
};

const DialValue = {
  LEFT: 'left',
  RIGHT: 'right',
};

const TouchValue = {
  SWIPE_LEFT: 'swipe-left',
  SWIPE_RIGHT: 'swipe-right',
  TAP: 'tap',
};

// This file is a CommonJS module, so we use module.exports
// This makes it easy to share between Node.js (server) and browser (with a bundler, or by manually including)
// For this project, we will use it as a CJS module on the server and an ES module on the client.
// This is a bit of a hack, but it's the simplest solution without introducing a build step.
try {
  module.exports = {
    MessageType,
    InputType,
    ButtonValue,
    DialValue,
    TouchValue
  };
} catch (e) {
  // We are in a browser environment, do nothing.
  // The file will be loaded as an ES module.
}

// In a real project, you would use a bundler like webpack or rollup to handle this.
// But for this project, we want to keep it simple.
// The browser will use this file as an ES module, and the server will use it as a CommonJS module.
// So we need to have both `module.exports` and `export`.
// This is not ideal, but it works for this simple case.
export {
  MessageType,
  InputType,
  ButtonValue,
  DialValue,
  TouchValue
};