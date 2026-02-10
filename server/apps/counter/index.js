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
    if (input.type === 'button') {
      if (input.value === 'preset1') {
        count++;
        changed = true;
      } else if (input.value === 'preset2') {
        count--;
        changed = true;
      } else if (input.value === 'preset3') {
        count = 0;
        changed = true;
      }
    }

    // Handle dial turns
    if (input.type === 'dial') {
      if (input.value === 'right') {
        count++;
        changed = true;
      } else if (input.value === 'left') {
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
  getUI() {
    const allCounters = Array.from(counters.entries());
    
    if (allCounters.length === 0) {
      return `
        <div style="padding: 20px; text-align: center; color: #666;">
          <h3>Counter App</h3>
          <p>No devices have used the counter yet.</p>
          <p style="margin-top: 15px; font-size: 0.9em;">
            <strong>Controls:</strong><br>
            Preset 1 / Dial Right: Increment<br>
            Preset 2 / Dial Left: Decrement<br>
            Preset 3: Reset
          </p>
        </div>
      `;
    }

    return `
      <div style="padding: 20px;">
        <h3 style="margin-bottom: 15px;">Counter App - Device Counts</h3>
        <div style="display: grid; gap: 10px;">
          ${allCounters.map(([deviceId, count]) => `
            <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; border-left: 3px solid #0066cc;">
              <div style="font-weight: 500; color: #333; margin-bottom: 5px;">${deviceId}</div>
              <div style="font-size: 2em; font-weight: bold; color: #0066cc;">${count}</div>
            </div>
          `).join('')}
        </div>
        <p style="margin-top: 20px; font-size: 0.9em; color: #666;">
          <strong>Controls:</strong><br>
          Preset 1 / Dial Right: Increment (+1)<br>
          Preset 2 / Dial Left: Decrement (-1)<br>
          Preset 3: Reset to 0
        </p>
      </div>
    `;
  }
};
