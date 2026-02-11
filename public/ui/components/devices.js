// public/ui/components/devices.js

const API_BASE = '';

export async function loadDevices() {
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
