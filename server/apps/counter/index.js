const { InputType, ButtonValue, DialValue } = require('../../shared/protocol.js');

// Counter App - Example app for ServerThing
// Demonstrates app structure with UI and input handling

const counters = new Map(); // deviceId -> count

module.exports = {
  metadata: {
    name: 'Counter',
    description: 'Simple counter app - increment/decrement with buttons',
    version: '1.0.0'
  },

  // Handle input events from devices
  handleInput(deviceId, input) {
    if (!counters.has(deviceId)) {
      counters.set(deviceId, 0);
    }

    let count = counters.get(deviceId);
    let changed = false;

    // Handle button presses
    if (input.type === InputType.BUTTON) {
      if (input.value === ButtonValue.PRESET_1) {
        count++;
        changed = true;
      } else if (input.value === ButtonValue.PRESET_2) {
        count--;
        changed = true;
      } else if (input.value === ButtonValue.PRESET_3) {
        count = 0;
        changed = true;
      }
    }

    // Handle dial turns
    if (input.type === InputType.DIAL) {
      if (input.value === DialValue.RIGHT) {
        count++;
        changed = true;
      } else if (input.value === DialValue.LEFT) {
        count--;
        changed = true;
      }
    }

    if (changed) {
      counters.set(deviceId, count);
      return {
        action: 'update',
        count
      };
    }

    return null;
  },

  // Return HTML for app UI
  // This is now handled by the static file server
};
