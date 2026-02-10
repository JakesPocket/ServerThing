// public/ui/ui.js

import { MessageType } from '/shared/protocol.js';
import { loadDevices } from './components/devices.js';
import { loadApps, initAppInstaller } from './components/apps.js';
import { initSimulator } from './components/simulator.js';

// Connect to UI WebSocket for real-time updates
function connectUI() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/ui`;
  
  const uiWs = new WebSocket(wsUrl);
  
  uiWs.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === MessageType.S2U_DEVICES_CHANGED) {
        loadDevices();
      } else if (message.type === MessageType.S2U_APPS_CHANGED) {
        loadApps();
      }
    } catch (err) {
      console.error('Error processing UI WebSocket message:', err);
    }
  };
  
  uiWs.onclose = () => {
    setTimeout(connectUI, 5000);
  };
  
  uiWs.onerror = (err) => {
    console.error('UI WebSocket error:', err);
  };
}

// Initial load
document.addEventListener('DOMContentLoaded', () => {
  loadDevices();
  loadApps();
  initSimulator();
  initAppInstaller();
  
  connectUI();
});
