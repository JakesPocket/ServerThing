const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { MessageType } = require('../shared/protocol.js');
const multer = require('multer');
const AdmZip = require('adm-zip');
const adbManager = require('./adb-manager');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const APPS_DIR = path.join(__dirname, 'apps');

// Multer setup for file uploads in memory
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Manages reading and writing state to the filesystem.
 */
class PersistenceManager {
  /**
   * @param {string} dir The directory to store data files in.
   */
  constructor(dir) {
    this.dir = dir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Reads and parses a JSON file.
   * @param {string} name The name of the file (without extension).
   * @returns {object | null} The parsed JSON data or null if an error occurs.
   */
  read(name) {
    const filePath = path.join(this.dir, `${name}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
      } catch (err) {
        console.error(`Error reading persistence file ${name}.json:`, err.message);
        return null;
      }
    }
    return null;
  }

  /**
   * Writes data to a JSON file.
   * @param {string} name The name of the file (without extension).
   * @param {object} data The data to write.
   */
  write(name, data) {
    const filePath = path.join(this.dir, `${name}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`Error writing persistence file ${name}.json:`, err.message);
    }
  }
}

/**
 * Manages the state of all connected devices.
 */
class DeviceStateManager {
  /**
   * @param {PersistenceManager} persistenceManager
   */
  constructor(persistenceManager) {
    this.devices = new Map(); // deviceId -> state
    this.persistence = persistenceManager;
    this.loadState();
  }

  loadState() {
    const persistedDevices = this.persistence.read('devices');
    if (persistedDevices) {
      for (const device of persistedDevices) {
        this.devices.set(device.id, { ...device, connected: false });
      }
    }
  }

  saveState() {
    const allDevices = Array.from(this.devices.values());
    // Mark all as disconnected for persistence
    const persistedDevices = allDevices.map(d => ({ ...d, connected: false }));
    this.persistence.write('devices', persistedDevices);
  }

  getDevice(deviceId) {
    if (!this.devices.has(deviceId)) {
      this.devices.set(deviceId, {
        id: deviceId,
        connected: true,
        lastSeen: Date.now(),
        inputs: []
      });
      this.saveState();
    }
    return this.devices.get(deviceId);
  }

  updateDevice(deviceId, updates) {
    const device = this.getDevice(deviceId);
    Object.assign(device, updates, { lastSeen: Date.now() });
    this.saveState();
    return device;
  }

  addInput(deviceId, input) {
    const device = this.getDevice(deviceId);
    device.inputs.push({ ...input, timestamp: Date.now() });
    // Keep only last 100 inputs
    if (device.inputs.length > 100) {
      device.inputs.shift();
    }
    // Note: Not saving state on every input to avoid excessive writes
    return device;
  }

  getAllDevices() {
    return Array.from(this.devices.values());
  }

  removeDevice(deviceId) {
    this.devices.delete(deviceId);
    this.saveState();
  }
}

/**
 * Manages the lifecycle and state of all installed apps.
 */
class AppManager {
  /**
   * @param {PersistenceManager} persistenceManager
   */
  constructor(persistenceManager) {
    this.apps = new Map();
    this.persistence = persistenceManager;
    this.loadApps();
    this.loadState();
  }

  loadState() {
    const persistedApps = this.persistence.read('apps');
    if (persistedApps) {
      for (const persistedApp of persistedApps) {
        const app = this.apps.get(persistedApp.id);
        if (app) {
          app.enabled = persistedApp.enabled;
        }
      }
    }
  }

  saveState() {
    const appStates = Array.from(this.apps.values()).map(app => ({
      id: app.id,
      enabled: app.enabled
    }));
    this.persistence.write('apps', appStates);
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
        const appFolderPath = path.join(appsDir, entry.name);
        const appPath = path.join(appFolderPath, 'index.js');
        const manifestPath = path.join(appFolderPath, 'manifest.json');
        const publicUiPath = path.join(appFolderPath, 'public');
        
        let manifest = {};
        if (fs.existsSync(manifestPath)) {
          try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          } catch (err) {
            console.error(`Error reading manifest for app ${entry.name}:`, err.message);
          }
        }

        if (fs.existsSync(appPath)) {
          try {
            // Clear require cache to allow hot reload on server restart
            delete require.cache[require.resolve(appPath)];
            const appInstance = require(appPath);
            
            this.apps.set(entry.name, {
              id: entry.name,
              name: manifest.name || entry.name,
              description: manifest.description || '',
              version: manifest.version || '1.0.0',
              author: manifest.author || 'Unknown',
              enabled: true, // Default to enabled
              instance: appInstance,
              hasPublicUI: fs.existsSync(publicUiPath),
              ...appInstance.metadata,
              manifest: manifest
            });

            // If the app has an init method, run it with context
            if (typeof appInstance.init === 'function') {
              const context = {
                onInput: (handler) => {
                  const appEntry = this.apps.get(entry.name);
                  if (appEntry) appEntry.inputHandler = handler.bind(appInstance);
                },
                sendToDevice: (deviceId, data) => {
                  broadcastDevices({ appId: entry.name, ...data }, deviceId);
                }
              };
              appInstance.init(context);
            }
          } catch (err) {
            console.error(`Failed to load app ${entry.name}:`, err.message);
          }
        } else if (fs.existsSync(publicUiPath)) {
          // Pure UI apps (compatibility with some DeskThing patterns)
          this.apps.set(entry.name, {
            id: entry.name,
            name: manifest.name || entry.name,
            description: manifest.description || '',
            version: manifest.version || '1.0.0',
            enabled: true,
            hasPublicUI: true,
            manifest: manifest
          });
        }
      }
    }
  }

  getApps() {
    return Array.from(this.apps.values()).map(app => ({
      id: app.id,
      name: app.name || app.id,
      description: app.description || '',
      enabled: app.enabled,
      hasPublicUI: app.hasPublicUI
    }));
  }

  getApp(appId) {
    return this.apps.get(appId);
  }

  enableApp(appId) {
    const app = this.apps.get(appId);
    if (app) {
      app.enabled = true;
      this.saveState();
      return true;
    }
    return false;
  }

  disableApp(appId) {
    const app = this.apps.get(appId);
    if (app) {
      app.enabled = false;
      this.saveState();
      return true;
    }
    return false;
  }

  /**
   * Reloads all apps from disk and broadcasts the change.
   */
  reloadApps() {
    console.log('[AppManager] Reloading apps from disk...');
    this.apps.clear();
    this.loadApps();
  }

  handleInput(appId, deviceId, input) {
    const app = this.apps.get(appId);
    if (app && app.enabled) {
      // Priority 1: New dynamic inputHandler from .init()
      if (app.inputHandler) {
        return app.inputHandler(input);
      }
      // Priority 2: Legacy static handleInput method
      if (app.instance && typeof app.instance.handleInput === 'function') {
        return app.instance.handleInput(deviceId, input);
      }
    }
    return null;
  }
}

// Initialize managers
const persistenceManager = new PersistenceManager(DATA_DIR);
const deviceManager = new DeviceStateManager(persistenceManager);
const appManager = new AppManager(persistenceManager);

// Express app
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

/**
 * Mounts static UI directories for all apps that have a `public` folder.
 * @param {import('express').Express} expressApp The Express application instance.
 * @param {AppManager} appManager The app manager instance.
 */
function mountAppUIs(expressApp, appManager) {
  const apps = appManager.getApps();
  for (const app of apps) {
    if (app.hasPublicUI) {
      const publicUiPath = path.join(__dirname, 'apps', app.id, 'public');
      expressApp.use(`/apps/${app.id}`, express.static(publicUiPath));
    }
  }
}
mountAppUIs(app, appManager);

// Serve shared folder for frontend modules
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

// HTTP server
const server = http.createServer(app);

// WebSocket server for devices
const wssDevice = new WebSocketServer({ noServer: true });
const deviceConnections = new Map(); // deviceId -> ws

// WebSocket server for UI
const wssUI = new WebSocketServer({ noServer: true });
const uiConnections = new Set();

/**
 * Broadcasts a message to all connected UI clients.
 * @param {object} data The data to send.
 */
function broadcastUI(data) {
  const message = JSON.stringify(data);
  uiConnections.forEach(ws => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(message);
    }
  });
}

/**
 * Broadcasts a message to all connected devices.
 * @param {object} data The data to send.
 */
function broadcastDevices(data) {
  const message = JSON.stringify(data);
  deviceConnections.forEach(ws => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(message);
    }
  });
}

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  try {
    const pathname = new URL(request.url, 'ws://localhost').pathname;
    console.log(`[Upgrade] Incoming WebSocket upgrade request: ${request.url} (path: ${pathname})`);
    
    if (pathname === '/ws/device') {
      console.log('[Upgrade] Routing to device WebSocket server');
      wssDevice.handleUpgrade(request, socket, head, (ws) => {
        console.log('[Upgrade] Device WebSocket upgraded successfully');
        wssDevice.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/ui') {
      console.log('[Upgrade] Routing to UI WebSocket server');
      wssUI.handleUpgrade(request, socket, head, (ws) => {
        console.log('[Upgrade] UI WebSocket upgraded successfully');
        wssUI.emit('connection', ws, request);
      });
    } else {
      console.log(`[Upgrade] Unknown path, destroying socket: ${pathname}`);
      socket.destroy();
    }
  } catch (err) {
    console.error('WebSocket upgrade error:', err.message, err.stack);
    socket.destroy();
  }
});

// Handle UI WebSocket connections
wssUI.on('connection', (ws) => {
  try {
    console.log('[UI] New UI WebSocket connection');
    uiConnections.add(ws);
    console.log(`[UI] UI client connected. Total UI clients: ${uiConnections.size}`);
    
    ws.on('close', () => {
      console.log('[UI] UI WebSocket closed');
      uiConnections.delete(ws);
      console.log(`[UI] UI client disconnected. Total UI clients: ${uiConnections.size}`);
    });
    ws.on('error', (err) => {
      console.error('[UI] WebSocket error:', err.message);
    });
  } catch (err) {
    console.error('Error in UI connection handler:', err.message, err.stack);
    ws.close();
  }
});

// Handle device WebSocket connections
wssDevice.on('connection', (ws, request) => {
  try {
    const deviceId = new URL(request.url, 'ws://localhost').searchParams.get('id') || `device-${Date.now()}`;
    console.log(`[Device] New device connection: ${deviceId}`);
    
    deviceConnections.set(deviceId, ws);
    deviceManager.updateDevice(deviceId, { connected: true });
    console.log(`[Device] Device ${deviceId} added to connections. Total devices: ${deviceConnections.size}`);
    
    broadcastUI({ type: MessageType.S2U_DEVICES_CHANGED });

    // Send initial state
    const initialMessage = {
      type: MessageType.S2D_CONNECTED,
      deviceId,
      apps: appManager.getApps()
    };
    console.log(`[Device] Sending initial state to ${deviceId}:`, JSON.stringify(initialMessage));
    ws.send(JSON.stringify(initialMessage));

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(`[Device] Message from ${deviceId}:`, message.type);
        
        if (message.type === MessageType.D2S_INPUT) {
          // Store input event
          deviceManager.addInput(deviceId, message.data);
          
          // Broadcast to all enabled apps
          const apps = appManager.getApps().filter(app => app.enabled);
          for (const app of apps) {
            const response = appManager.handleInput(app.id, deviceId, message.data);
            if (response) {
              ws.send(JSON.stringify({
                type: MessageType.S2D_APP_RESPONSE,
                appId: app.id,
                data: response
              }));
            }
          }
          
          // Echo back to device
          ws.send(JSON.stringify({
            type: MessageType.S2D_INPUT_RECEIVED,
            data: message.data
          }));
        }
      } catch (err) {
        console.error(`[Device] Error handling message from ${deviceId}:`, err.message);
      }
    });

    ws.on('close', () => {
      console.log(`[Device] Device disconnected: ${deviceId}`);
      deviceConnections.delete(deviceId);
      deviceManager.updateDevice(deviceId, { connected: false });
      broadcastUI({ type: MessageType.S2U_DEVICES_CHANGED });
    });

    ws.on('error', (err) => {
      console.error(`[Device] WebSocket error for ${deviceId}:`, err.message);
    });
  } catch (err) {
    console.error('Error in device connection handler:', err.message, err.stack);
    ws.close();
  }
});

// API Routes
app.get('/api/devices', (req, res) => {
  res.json(deviceManager.getAllDevices());
});

app.get('/api/apps', (req, res) => {
  res.json(appManager.getApps());
});

app.post('/api/apps/reload', (req, res) => {
  appManager.reloadApps();
  broadcastUI({ type: MessageType.S2U_APPS_CHANGED });
  broadcastDevices({ type: MessageType.S2D_APPS_RELOADED, apps: appManager.getApps() });
  res.json({ success: true, message: 'Apps reloaded' });
});

app.post('/api/apps/:appId/enable', (req, res) => {
  const { appId } = req.params;
  if (appManager.enableApp(appId)) {
    res.json({ success: true, message: `App ${appId} enabled` });
    
    // Notify all connected devices
    broadcastDevices({
      type: MessageType.S2D_APP_ENABLED,
      appId
    });
    broadcastUI({ type: MessageType.S2U_APPS_CHANGED });
  } else {
    res.status(404).json({ success: false, message: 'App not found' });
  }
});

app.post('/api/apps/:appId/disable', (req, res) => {
  const { appId } = req.params;
  if (appManager.disableApp(appId)) {
    res.json({ success: true, message: `App ${appId} disabled` });
    
    // Notify all connected devices
    broadcastDevices({
      type: MessageType.S2D_APP_DISABLED,
      appId
    });
    broadcastUI({ type: MessageType.S2U_APPS_CHANGED });
  } else {
    res.status(404).json({ success: false, message: 'App not found' });
  }
});

app.post('/api/apps/install', upload.single('app-zip'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No app file uploaded.' });
  }

  const appName = path.basename(req.file.originalname, '.zip');
  const appInstallPath = path.join(APPS_DIR, appName);

  if (fs.existsSync(appInstallPath)) {
    return res.status(400).json({ success: false, message: `App "${appName}" already exists.` });
  }

  try {
    const zip = new AdmZip(req.file.buffer);
    zip.extractAllTo(appInstallPath, true);

    // Validate that the extracted app has the required structure
    const expectedIndexFile = path.join(appInstallPath, 'index.js');
    if (!fs.existsSync(expectedIndexFile)) {
      // Clean up the partially installed app
      fs.rmSync(appInstallPath, { recursive: true, force: true });
      return res.status(400).json({ 
        success: false, 
        message: 'Installation failed: App must contain an index.js file.' 
      });
    }

    res.json({ 
      success: true, 
      message: `App "${appName}" installed successfully. Server is restarting.` 
    });

  } catch (err) {
    console.error('App installation failed:', err);
    // Clean up if the folder was created
    if (fs.existsSync(appInstallPath)) {
      fs.rmSync(appInstallPath, { recursive: true, force: true });
    }
    res.status(500).json({ success: false, message: 'Failed to extract or install app.' });
  }
});

// --- Admin API Routes ---

/**
 * Scan for connected ADB devices and attempt setup.
 */
app.post('/api/admin/scan-devices', async (req, res) => {
  try {
    const isAdbAvailable = await adbManager.checkADB();
    if (!isAdbAvailable) {
      return res.status(500).json({ error: 'ADB not found on server. Please install platform-tools.' });
    }

    const deviceIds = await adbManager.listDevices();
    const results = [];

    for (const id of deviceIds) {
      try {
        const url = await adbManager.setupDevice(id, PORT);
        results.push({ id, status: 'success', serverURL: url });
      } catch (err) {
        results.push({ id, status: 'error', error: err.message });
      }
    }

    res.json({ devices: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get system status (ADB, IP, etc.)
 */
app.get('/api/admin/status', async (req, res) => {
  const adbAvailable = await adbManager.checkADB();
  res.json({
    adbAvailable,
    localIP: adbManager.getLocalIP(),
    serverPort: PORT,
    platform: os.platform()
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`ServerThing running on http://localhost:${PORT}`);
  console.log(`Web UI available at http://localhost:${PORT}/ui`);
  console.log(`WebSocket endpoint for devices: ws://localhost:${PORT}/ws/device`);
  console.log(`WebSocket endpoint for UI: ws://localhost:${PORT}/ws/ui`);
  console.log(`Loaded ${appManager.getApps().length} app(s)`);
  console.log(`========================================\n`);
});
