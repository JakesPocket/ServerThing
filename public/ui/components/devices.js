// public/ui/components/devices.js

const API_BASE = '';

function getFriendlyType(id) {
  if (!id) return 'Unknown Device';
  if (id === 'simulator') return 'Simulator';
  if (id === 'inputd') return 'Inputd';
  if (id === 'bootstrap-probe') return 'Bootstrap Probe';
  if (id.startsWith('shell-')) return 'Shell Client';
  return 'Device';
}

function looksLikeSerial(id) {
  return /^[A-Za-z0-9._:-]{8,}$/.test(id) && !id.startsWith('shell-');
}

function resolveSerial(device, adbSerials) {
  if (adbSerials.includes(device.id)) return device.id;
  if (looksLikeSerial(device.id)) return device.id;
  return null;
}

function classifyDevices(connectedDevices, adbSerials) {
  const assignment = new Map();
  const shellDevices = connectedDevices
    .filter((d) => {
      if (String(d.id || '').startsWith('shell-')) return true;
      return String(d.clientType || '').includes('shell');
    })
    .sort((a, b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0));

  // Explicit handshaked carthing-shell clients map to ADB slots.
  // Legacy clients fall back to newest-N heuristic.
  const slots = [...adbSerials];
  for (const device of shellDevices) {
    const caps = device.capabilities || {};
    const isCarThing = device.clientType === 'carthing-shell'
      || caps.acceptsHardwareKeycodes === true;
    if (isCarThing && slots.length > 0) {
      assignment.set(device.id, { kind: 'carthing', serial: slots.shift() });
    } else if (device.clientType === 'simulator-shell') {
      assignment.set(device.id, { kind: 'simulator' });
    } else {
      assignment.set(device.id, { kind: 'browser' });
    }
  }
  return assignment;
}

function displayName(device, adbSerials, assignment) {
  const a = assignment.get(device.id);
  if (a?.kind === 'carthing') return `Car Thing (${a.serial})`;
  if (a?.kind === 'simulator') return 'Simulator Shell';
  if (a?.kind === 'browser') {
    const browser = device.clientInfo?.browser;
    return browser && browser !== 'Unknown' ? `Browser (${browser})` : 'Browser';
  }

  const type = getFriendlyType(device.id);
  const serial = resolveSerial(device, adbSerials);
  if (device.clientType === 'carthing-shell') return serial ? `Car Thing (${serial})` : 'Car Thing';
  if (device.clientType === 'web-shell') return 'Browser Shell';
  if (device.clientType === 'simulator-shell') return 'Simulator Shell';
  return serial ? `${type} (${serial})` : type;
}

function displayId(device, assignment) {
  const a = assignment.get(device.id);
  if (a?.kind === 'carthing') return `shell-${a.serial}`;
  return device.id;
}

function displayClientDetails(device) {
  const info = device.clientInfo;
  const bits = [];
  if (device.clientType && device.clientType !== 'unknown') bits.push(device.clientType);
  if (Number.isInteger(device.protocolVersion)) bits.push(`proto v${device.protocolVersion}`);
  if (!info && bits.length === 0) return '';
  if (info && info.deviceClass && info.deviceClass !== 'unknown') bits.push(info.deviceClass);
  if (info && info.platform && info.platform !== 'Unknown') bits.push(info.platform);
  if (info && info.ip && info.ip !== 'unknown') bits.push(info.ip);
  if (bits.length === 0) return '';
  return `<p>Client: ${bits.join(' • ')}</p>`;
}

export async function loadDevices() {
  try {
    const [devicesResponse, adbResponse] = await Promise.all([
      fetch(`${API_BASE}/api/devices`),
      fetch(`${API_BASE}/api/adb/devices`).catch(() => null),
    ]);
    const devices = await devicesResponse.json();
    let adbSerials = [];
    if (adbResponse && adbResponse.ok) {
      const adbData = await adbResponse.json();
      adbSerials = Array.isArray(adbData.devices) ? adbData.devices : [];
    }
    
    const devicesDiv = document.getElementById('devices');
    const visibleDevices = devices.filter((device) => device.connected);
    if (visibleDevices.length === 0) {
      devicesDiv.innerHTML = '<p class="loading">No devices connected</p>';
      return;
    }
    const assignment = classifyDevices(visibleDevices, adbSerials);
    
    devicesDiv.innerHTML = visibleDevices.map(device => `
      <div class="device-card">
        <h3>${displayName(device, adbSerials, assignment)}</h3>
        <p>ID: ${displayId(device, assignment)}</p>
        ${displayClientDetails(device)}
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

export function initDeviceControls() {
  const provisionBtn = document.getElementById('provision-devices');
  const clearBtn = document.getElementById('clear-devices');
  if (!clearBtn || !provisionBtn) return;
  const originalProvisionLabel = provisionBtn.textContent;
  const originalLabel = clearBtn.textContent;

  // In custom-firmware mode, provisioning is intentionally disabled unless
  // ST_ENABLE_PROVISIONING is explicitly enabled on the server.
  fetch(`${API_BASE}/api/admin/status`)
    .then((r) => (r.ok ? r.json() : null))
    .then((status) => {
      if (!status) return;
      if (status.provisioningEnabled === false) {
        provisionBtn.disabled = true;
        provisionBtn.textContent = 'Provision (Disabled)';
        provisionBtn.title = 'Enable ST_ENABLE_PROVISIONING=1 on the server to use provisioning.';
      }
    })
    .catch(() => {});

  provisionBtn.addEventListener('click', async () => {
    provisionBtn.disabled = true;
    provisionBtn.textContent = 'Provisioning...';
    try {
      const response = await fetch(`${API_BASE}/api/admin/scan-devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      let result = {};
      try {
        result = await response.json();
      } catch {}
      if (!response.ok) {
        const msg = result.error ? ` ${result.error}` : '';
        throw new Error(`HTTP ${response.status}${msg}`);
      }
      const devices = Array.isArray(result.devices) ? result.devices : [];
      const successCount = devices.filter(d => d.status === 'success').length;
      const totalCount = devices.length;
      provisionBtn.textContent = `Provisioned ${successCount}/${totalCount}`;
      await loadDevices();
      setTimeout(() => {
        provisionBtn.textContent = originalProvisionLabel;
      }, 1800);
    } catch (err) {
      console.error('Error provisioning devices:', err);
      provisionBtn.textContent = `Provision failed (${err.message || 'error'})`;
      setTimeout(() => {
        provisionBtn.textContent = originalProvisionLabel;
      }, 1800);
    } finally {
      provisionBtn.disabled = false;
    }
  });

  clearBtn.addEventListener('click', async () => {
    clearBtn.disabled = true;
    clearBtn.textContent = 'Cleaning...';
    try {
      const response = await fetch(`${API_BASE}/api/devices/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'disconnected' }),
      });
      let result = {};
      try {
        result = await response.json();
      } catch {
        // Keep empty result for non-JSON responses (e.g. old server route missing).
      }
      if (!response.ok) {
        const msg = result.error ? ` ${result.error}` : '';
        throw new Error(`HTTP ${response.status}${msg}`);
      }
      await loadDevices();
      clearBtn.textContent = `Cleaned ${result.removed || 0}`;
      setTimeout(() => {
        clearBtn.textContent = originalLabel;
      }, 1200);
    } catch (err) {
      console.error('Error clearing devices:', err);
      clearBtn.textContent = `Cleanup failed (${err.message || 'error'})`;
      setTimeout(() => {
        clearBtn.textContent = originalLabel;
      }, 1200);
    } finally {
      clearBtn.disabled = false;
    }
  });
}
