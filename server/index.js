const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;

// Device state manager
class DeviceStateManager {
  constructor() {
    this.devices = new Map(); // deviceId -> state
  }

  getDevice(deviceId) {
    if (!this.devices.has(deviceId)) {
      this.devices.set(deviceId, {
        id: deviceId,
        connected: true,
        lastSeen: Date.now(),
        inputs: []
      });
    }
    return this.devices.get(deviceId);
  }

  updateDevice(deviceId, updates) {
    const device = this.getDevice(deviceId);
    Object.assign(device, updates, { lastSeen: Date.now() });
    return device;
  }

  addInput(deviceId, input) {
    const device = this.getDevice(deviceId);
    device.inputs.push({ ...input, timestamp: Date.now() });
    // Keep only last 100 inputs
    if (device.inputs.length > 100) {
      device.inputs.shift();
    }
    return device;
  }

  getAllDevices() {
    return Array.from(this.devices.values());
  }

  removeDevice(deviceId) {
    this.devices.delete(deviceId);
  }
}

// App manager
class AppManager {
  constructor() {
    this.apps = new Map();
    this.loadApps();
  }

  loadApps() {
    const appsDir = path.join(__dirname, 'apps');
    if (!fs.existsSync(appsDir)) {
      fs.mkdirSync(appsDir, { recursive: true });
      return;
    }

    const entries = fs.readdirSync(appsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const appPath = path.join(appsDir, entry.name, 'index.js');
        if (fs.existsSync(appPath)) {
          try {
            // Clear require cache to allow hot reload
            delete require.cache[require.resolve(appPath)];
            const app = require(appPath);
            this.apps.set(entry.name, {
              id: entry.name,
              enabled: true,
              instance: app,
              ...app.metadata
            });
            console.log(`Loaded app: ${entry.name}`);
          } catch (err) {
            console.error(`Failed to load app ${entry.name}:`, err.message);
          }
        }
      }
    }
  }

  getApps() {
    return Array.from(this.apps.values()).map(app => ({
      id: app.id,
      name: app.name || app.id,
      description: app.description || '',
      enabled: app.enabled
    }));
  }

  getApp(appId) {
    return this.apps.get(appId);
  }

  enableApp(appId) {
    const app = this.apps.get(appId);
    if (app) {
      app.enabled = true;
      return true;
    }
    return false;
  }

  disableApp(appId) {
    const app = this.apps.get(appId);
    if (app) {
      app.enabled = false;
      return true;
    }
    return false;
  }

  reloadApps() {
    this.apps.clear();
    this.loadApps();
  }

  handleInput(appId, deviceId, input) {
    const app = this.apps.get(appId);
    if (app && app.enabled && app.instance.handleInput) {
      return app.instance.handleInput(deviceId, input);
    }
    return null;
  }
}

// Initialize managers
const deviceManager = new DeviceStateManager();
const appManager = new AppManager();

// Express app
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// HTTP server
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocketServer({ noServer: true });

// WebSocket connections (deviceId -> ws)
const wsConnections = new Map();

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, 'ws://localhost').pathname;
  
  if (pathname === '/ws/device') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Handle WebSocket connections
wss.on('connection', (ws, request) => {
  const deviceId = new URL(request.url, 'ws://localhost').searchParams.get('id') || `device-${Date.now()}`;
  
  console.log(`Device connected: ${deviceId}`);
  wsConnections.set(deviceId, ws);
  deviceManager.updateDevice(deviceId, { connected: true });

  // Send initial state
  ws.send(JSON.stringify({
    type: 'connected',
    deviceId,
    apps: appManager.getApps()
  }));

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'input') {
        // Store input event
        deviceManager.addInput(deviceId, message.data);
        
        // Broadcast to all enabled apps
        const apps = appManager.getApps().filter(app => app.enabled);
        for (const app of apps) {
          const response = appManager.handleInput(app.id, deviceId, message.data);
          if (response) {
            ws.send(JSON.stringify({
              type: 'app-response',
              appId: app.id,
              data: response
            }));
          }
        }
        
        // Echo back to device
        ws.send(JSON.stringify({
          type: 'input-received',
          data: message.data
        }));
      }
    } catch (err) {
      console.error('Error handling message:', err.message);
    }
  });

  ws.on('close', () => {
    console.log(`Device disconnected: ${deviceId}`);
    wsConnections.delete(deviceId);
    deviceManager.updateDevice(deviceId, { connected: false });
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error for ${deviceId}:`, err.message);
  });
});

// API Routes
app.get('/api/devices', (req, res) => {
  res.json(deviceManager.getAllDevices());
});

app.get('/api/apps', (req, res) => {
  res.json(appManager.getApps());
});

app.post('/api/apps/:appId/enable', (req, res) => {
  const { appId } = req.params;
  if (appManager.enableApp(appId)) {
    res.json({ success: true, message: `App ${appId} enabled` });
    
    // Notify all connected devices
    wsConnections.forEach(ws => {
      ws.send(JSON.stringify({
        type: 'app-enabled',
        appId
      }));
    });
  } else {
    res.status(404).json({ success: false, message: 'App not found' });
  }
});

app.post('/api/apps/:appId/disable', (req, res) => {
  const { appId } = req.params;
  if (appManager.disableApp(appId)) {
    res.json({ success: true, message: `App ${appId} disabled` });
    
    // Notify all connected devices
    wsConnections.forEach(ws => {
      ws.send(JSON.stringify({
        type: 'app-disabled',
        appId
      }));
    });
  } else {
    res.status(404).json({ success: false, message: 'App not found' });
  }
});

app.post('/api/apps/reload', (req, res) => {
  appManager.reloadApps();
  res.json({ success: true, message: 'Apps reloaded', apps: appManager.getApps() });
  
  // Notify all connected devices
  wsConnections.forEach(ws => {
    ws.send(JSON.stringify({
      type: 'apps-reloaded',
      apps: appManager.getApps()
    }));
  });
});

app.get('/api/apps/:appId/ui', (req, res) => {
  const { appId } = req.params;
  const app = appManager.getApp(appId);
  
  if (app && app.instance.getUI) {
    res.send(app.instance.getUI());
  } else {
    res.status(404).send('<p>No UI available for this app</p>');
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`ServerThing running on http://localhost:${PORT}`);
  console.log(`Web UI available at http://localhost:${PORT}/ui`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws/device`);
  console.log(`Loaded ${appManager.getApps().length} app(s)`);
});
