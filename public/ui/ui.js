// public/ui/ui.js

import { loadDevices } from './components/devices.js';
import { loadApps } from './components/apps.js';
import { initSimulator } from './components/simulator.js';

const API_BASE = '';

// Reload apps
async function reloadApps() {
  try {
    const response = await fetch(`${API_BASE}/api/apps/reload`, {
      method: 'POST'
    });
    const result = await response.json();
    
    if (result.success) {
      // The apps-changed event will be broadcast via WebSocket,
      // which will trigger loadApps()
      console.log('Reload command sent');
    }
  } catch (err) {
    console.error('Error reloading apps:', err);
  }
}

// Connect to UI WebSocket for real-time updates
function connectUI() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/ui`;
  
  const uiWs = new WebSocket(wsUrl);
  
  uiWs.onopen = () => {
    console.log('UI WebSocket connected');
  };
  
  uiWs.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'devices-changed') {
        console.log('Device list changed, reloading...');
        loadDevices();
      } else if (message.type === 'apps-changed') {
        console.log('App list changed, reloading...');
        loadApps();
      }
    } catch (err) {
      console.error('Error processing UI WebSocket message:', err);
    }
  };
  
  uiWs.onclose = () => {
    console.log('UI WebSocket disconnected. Attempting to reconnect in 5 seconds...');
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
  
  document.getElementById('reload-apps').addEventListener('click', reloadApps);

  connectUI();
});
