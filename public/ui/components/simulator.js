import { MessageType } from '/shared/protocol.js';

// public/ui/components/simulator.js

let ws = null;
let deviceId = 'simulator';

function logEvent(type, message) {
  const logContent = document.getElementById('sim-log-content');
  if (!logContent) return;

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  
  const time = new Date().toLocaleTimeString();
  entry.innerHTML = `<span class="log-time">${time}</span> [${type}] ${message}`;
  
  logContent.insertBefore(entry, logContent.firstChild);
  
  // Keep only last 50 entries
  while (logContent.children.length > 50) {
    logContent.removeChild(logContent.lastChild);
  }
}

function connectSimulator() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/device?id=${deviceId}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    document.getElementById('sim-status').textContent = 'connected';
    document.getElementById('sim-status').className = 'status connected';
    document.getElementById('sim-connect').disabled = true;
    document.getElementById('sim-disconnect').disabled = false;
    document.getElementById('sim-controls').style.display = 'block';
    logEvent('system', 'Connected to server');
  };
  
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      logEvent('received', JSON.stringify(message, null, 2));
    } catch (err) {
      logEvent('error', 'Invalid message received');
    }
  };
  
  ws.onclose = () => {
    document.getElementById('sim-status').textContent = 'disconnected';
    document.getElementById('sim-status').className = 'status disconnected';
    document.getElementById('sim-connect').disabled = false;
    document.getElementById('sim-disconnect').disabled = true;
    document.getElementById('sim-controls').style.display = 'none';
    logEvent('system', 'Disconnected from server');
    ws = null;
  };
  
  ws.onerror = (err) => {
    logEvent('error', 'WebSocket error');
    console.error('WebSocket error:', err);
  };
}

function disconnectSimulator() {
  if (ws) {
    ws.close();
  }
}

function sendInput(type, value) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    logEvent('error', 'Not connected to server');
    return;
  }
  
  const message = {
    type: MessageType.D2S_INPUT,
    data: {
      type,
      value,
      timestamp: Date.now()
    }
  };
  
  ws.send(JSON.stringify(message));
  logEvent('sent', `${type}: ${value}`);
}

export function initSimulator() {
  document.getElementById('sim-connect').addEventListener('click', connectSimulator);
  document.getElementById('sim-disconnect').addEventListener('click', disconnectSimulator);

  // Add click handlers for all input buttons
  // Handles:
  // - Preset buttons: data-input="button", data-value="preset1-4"
  // - Settings button: data-input="button", data-value="settings"
  // - Dial click: data-input="button", data-value="dial-click"
  // - Dial turn: data-input="dial", data-value="left|right"
  // - Back button: data-input="button", data-value="back"
  // - Touch gestures: data-input="touch", data-value="swipe-left|swipe-right|tap"
  document.addEventListener('click', (e) => {
    if (e.target.dataset.input) {
      const inputType = e.target.dataset.input;
      const inputValue = e.target.dataset.value;
      sendInput(inputType, inputValue);
    }
  });
}
