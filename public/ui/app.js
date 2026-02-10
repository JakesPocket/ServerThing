// API base URL
const API_BASE = '';

// WebSocket connection for simulator
let ws = null;
let deviceId = 'simulator';

// Load devices
async function loadDevices() {
  try {
    const response = await fetch(`${API_BASE}/api/devices`);
    const devices = await response.json();
    
    const devicesDiv = document.getElementById('devices');
    if (devices.length === 0) {
      devicesDiv.innerHTML = '<p class="loading">No devices connected</p>';
      return;
    }
    
    devicesDiv.innerHTML = devices.map(device => `
      <div class="device-card">
        <h3>${device.id}</h3>
        <p>Status: <span class="status ${device.connected ? 'connected' : 'disconnected'}">${device.connected ? 'Connected' : 'Disconnected'}</span></p>
        <p>Last seen: ${new Date(device.lastSeen).toLocaleString()}</p>
        <p>Input events: ${device.inputs.length}</p>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading devices:', err);
    document.getElementById('devices').innerHTML = '<p style="color: red;">Error loading devices</p>';
  }
}

// Load apps
async function loadApps() {
  try {
    const response = await fetch(`${API_BASE}/api/apps`);
    const apps = await response.json();
    
    const appsDiv = document.getElementById('apps');
    if (apps.length === 0) {
      appsDiv.innerHTML = '<p class="loading">No apps installed</p>';
      return;
    }
    
    appsDiv.innerHTML = apps.map(app => `
      <div class="app-card">
        <h3>${app.name}</h3>
        <p>${app.description}</p>
        <p>Status: <span class="status ${app.enabled ? 'enabled' : 'disabled'}">${app.enabled ? 'Enabled' : 'Disabled'}</span></p>
        <button class="btn btn-small ${app.enabled ? 'btn-danger' : 'btn-success'}" 
                onclick="toggleApp('${app.id}', ${app.enabled})">
          ${app.enabled ? 'Disable' : 'Enable'}
        </button>
        <button class="btn btn-small btn-secondary" onclick="loadAppUI('${app.id}')">View UI</button>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading apps:', err);
    document.getElementById('apps').innerHTML = '<p style="color: red;">Error loading apps</p>';
  }
}

// Toggle app enabled/disabled
async function toggleApp(appId, currentlyEnabled) {
  try {
    const action = currentlyEnabled ? 'disable' : 'enable';
    const response = await fetch(`${API_BASE}/api/apps/${appId}/${action}`, {
      method: 'POST'
    });
    const result = await response.json();
    
    if (result.success) {
      await loadApps();
    } else {
      alert(`Failed to ${action} app: ${result.message}`);
    }
  } catch (err) {
    console.error('Error toggling app:', err);
    alert('Error toggling app');
  }
}

// Load app UI
async function loadAppUI(appId) {
  try {
    const response = await fetch(`${API_BASE}/api/apps/${appId}/ui`);
    const html = await response.text();
    
    const appUIsDiv = document.getElementById('app-uis');
    appUIsDiv.innerHTML = `
      <div class="app-ui-container">
        <h3>${appId} UI</h3>
        <div>${html}</div>
      </div>
    `;
  } catch (err) {
    console.error('Error loading app UI:', err);
  }
}

// Reload apps
async function reloadApps() {
  try {
    const response = await fetch(`${API_BASE}/api/apps/reload`, {
      method: 'POST'
    });
    const result = await response.json();
    
    if (result.success) {
      await loadApps();
      logEvent('system', 'Apps reloaded successfully');
    }
  } catch (err) {
    console.error('Error reloading apps:', err);
  }
}

// Simulator functions
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
    type: 'input',
    data: {
      type,
      value,
      timestamp: Date.now()
    }
  };
  
  ws.send(JSON.stringify(message));
  logEvent('sent', `${type}: ${value}`);
}

function logEvent(type, message) {
  const logContent = document.getElementById('sim-log-content');
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

// Event listeners
document.getElementById('sim-connect').addEventListener('click', connectSimulator);
document.getElementById('sim-disconnect').addEventListener('click', disconnectSimulator);
document.getElementById('reload-apps').addEventListener('click', reloadApps);

// Add click handlers for input buttons
document.addEventListener('click', (e) => {
  if (e.target.dataset.input) {
    sendInput(e.target.dataset.input, e.target.dataset.value);
  }
});

// Initial load
loadDevices();
loadApps();

// Refresh devices and apps every 5 seconds
setInterval(() => {
  loadDevices();
  loadApps();
}, 5000);
