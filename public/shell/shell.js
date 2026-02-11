// System UI Shell - Permanent Runtime for ServerThing
// Hardware-integrated version for Spotify Car Thing (800x480)

import { MessageType, InputType } from '/shared/protocol.js';

/**
 * ShellRuntime - The permanent UI shell that never reloads
 * Manages app lifecycle, hardware input, and navigation
 */
class ShellRuntime {
  constructor() {
    this.ws = null;
    this.deviceId = 'carthing-' + Date.now();
    this.apps = [];
    this.currentAppId = null;
    this.selectedIndex = 0;
    this.navSelectedIndex = 0;
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    
    this.elements = {
      statusConnection: document.getElementById('status-connection'),
      statusAppName: document.getElementById('status-app-name'),
      statusTime: document.getElementById('status-time'),
      homeScreen: document.getElementById('home-screen'),
      appGrid: document.getElementById('app-grid'),
      appContainer: document.getElementById('app-container'),
      navOverlay: document.getElementById('nav-overlay'),
      loading: document.getElementById('loading')
    };

    this.init();
  }

  async init() {
    console.log('[Shell] Initializing System UI Shell');
    
    // Start clock
    this.updateClock();
    setInterval(() => this.updateClock(), 1000);
    
    // Connect to server
    this.connect();
    
    // Prevent context menu and long-press behaviors
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('touchstart', e => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    
    console.log('[Shell] Shell initialized');
  }

  updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    this.elements.statusTime.textContent = `${hours}:${minutes}`;
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/device?id=${this.deviceId}`;
    
    console.log(`[Shell] Connecting to ${wsUrl}`);
    this.showLoading('Connecting...');
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('[Shell] WebSocket connected');
      this.elements.statusConnection.classList.add('connected');
      this.reconnectAttempts = 0;
      this.hideLoading();
    };
    
    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleServerMessage(message);
      } catch (err) {
        console.error('[Shell] Error parsing message:', err);
      }
    };
    
    this.ws.onclose = () => {
      console.log('[Shell] WebSocket disconnected');
      this.elements.statusConnection.classList.remove('connected');
      
      // Exponential backoff reconnection
      this.reconnectAttempts++;
      const delay = Math.min(30000, this.reconnectDelay * Math.pow(2, this.reconnectAttempts));
      console.log(`[Shell] Reconnecting in ${delay}ms...`);
      setTimeout(() => this.connect(), delay);
    };
    
    this.ws.onerror = (err) => {
      console.error('[Shell] WebSocket error:', err);
    };
  }

  handleServerMessage(message) {
    console.log('[Shell] Received:', message.type);
    
    switch (message.type) {
      case MessageType.S2D_CONNECTED:
        console.log('[Shell] Connection confirmed, device ID:', message.deviceId);
        this.deviceId = message.deviceId;
        this.apps = message.apps || [];
        this.renderHomeScreen();
        break;
        
      case MessageType.S2D_APP_ENABLED:
      case MessageType.S2D_APP_DISABLED:
      case MessageType.S2D_APPS_RELOADED:
        // Fetch updated apps
        this.fetchApps();
        break;
        
      case MessageType.S2D_APP_RESPONSE:
        // Forward to active app iframe if present
        this.forwardToApp(message);
        break;
        
      case MessageType.S2D_INPUT_RECEIVED:
        // Input acknowledged
        break;
    }
  }

  async fetchApps() {
    try {
      const response = await fetch('/api/apps');
      this.apps = await response.json();
      this.renderHomeScreen();
    } catch (err) {
      console.error('[Shell] Failed to fetch apps:', err);
    }
  }

  sendInput(type, value) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = {
        type: MessageType.D2S_INPUT,
        data: {
          type,
          value,
          timestamp: Date.now()
        }
      };
      this.ws.send(JSON.stringify(message));
      console.log('[Shell] Sent input:', type, value);
    }
  }

  renderHomeScreen() {
    const enabledApps = this.apps.filter(app => app.enabled);
    
    this.elements.appGrid.innerHTML = '';
    
    if (enabledApps.length === 0) {
      this.elements.appGrid.innerHTML = '<p style="color: #666;">No apps available</p>';
      return;
    }
    
    enabledApps.forEach((app, index) => {
      const tile = document.createElement('div');
      tile.className = 'app-tile';
      if (index === this.selectedIndex) {
        tile.classList.add('selected');
      }
      tile.innerHTML = `
        <div class="app-tile-name">${app.name || app.id}</div>
        <div class="app-tile-desc">${app.description || ''}</div>
      `;
      tile.dataset.appId = app.id;
      this.elements.appGrid.appendChild(tile);
    });
  }

  showHomeScreen() {
    this.elements.homeScreen.classList.add('active');
    this.elements.appContainer.classList.remove('active');
    this.elements.statusAppName.textContent = 'Home';
    this.currentAppId = null;
    this.selectedIndex = 0;
    this.renderHomeScreen();
  }

  async launchApp(appId) {
    console.log('[Shell] Launching app:', appId);
    this.showLoading('Loading app...');
    
    const app = this.apps.find(a => a.id === appId);
    if (!app) {
      console.error('[Shell] App not found:', appId);
      this.hideLoading();
      return;
    }
    
    // Clear previous app
    this.elements.appContainer.innerHTML = '';
    
    // Check if app has a public UI
    if (app.hasPublicUI) {
      // Load app in iframe
      const iframe = document.createElement('iframe');
      iframe.src = `/apps/${appId}/index.html`;
      iframe.sandbox = 'allow-scripts allow-same-origin';
      
      iframe.onload = () => {
        console.log('[Shell] App loaded:', appId);
        this.hideLoading();
      };
      
      iframe.onerror = () => {
        console.error('[Shell] Failed to load app:', appId);
        this.hideLoading();
        this.showHomeScreen();
      };
      
      this.elements.appContainer.appendChild(iframe);
    } else {
      // Server-only app, just show placeholder
      this.elements.appContainer.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #1a1a2e;">
          <div style="text-align: center;">
            <h2 style="font-size: 32px; margin-bottom: 20px;">${app.name}</h2>
            <p style="color: #888;">Server-side app running</p>
          </div>
        </div>
      `;
      this.hideLoading();
    }
    
    // Switch to app view
    this.elements.homeScreen.classList.remove('active');
    this.elements.appContainer.classList.add('active');
    this.elements.statusAppName.textContent = app.name || appId;
    this.currentAppId = appId;
  }

  forwardToApp(message) {
    // If app is running in iframe, post message to it
    const iframe = this.elements.appContainer.querySelector('iframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'server-message',
        message
      }, '*');
    }
  }

  showNavigation() {
    this.navSelectedIndex = 0;
    this.updateNavSelection();
    this.elements.navOverlay.classList.remove('hidden');
  }

  hideNavigation() {
    this.elements.navOverlay.classList.add('hidden');
  }

  updateNavSelection() {
    const items = this.elements.navOverlay.querySelectorAll('.nav-item');
    items.forEach((item, index) => {
      item.classList.toggle('selected', index === this.navSelectedIndex);
    });
  }

  executeNavAction() {
    const items = this.elements.navOverlay.querySelectorAll('.nav-item');
    const selected = items[this.navSelectedIndex];
    const action = selected?.dataset.action;
    
    this.hideNavigation();
    
    switch (action) {
      case 'home':
        this.showHomeScreen();
        break;
      case 'close-app':
        if (this.currentAppId) {
          this.showHomeScreen();
        }
        break;
      case 'current-app':
        // Do nothing, just close nav
        break;
    }
  }

  // Hardware Input Handlers
  handleButton(value) {
    console.log('[Shell] Button:', value);
    
    // Send to server for app processing
    this.sendInput(InputType.BUTTON, value);
    
    // Handle shell-level controls
    if (value === 'back') {
      if (this.elements.navOverlay.classList.contains('hidden')) {
        this.showNavigation();
      } else {
        this.hideNavigation();
      }
    } else if (value === 'dial-click') {
      if (!this.elements.navOverlay.classList.contains('hidden')) {
        this.executeNavAction();
      } else if (!this.elements.homeScreen.classList.contains('active')) {
        // In app, forward to app
      } else {
        // On home, launch selected app
        const enabledApps = this.apps.filter(app => app.enabled);
        if (enabledApps[this.selectedIndex]) {
          this.launchApp(enabledApps[this.selectedIndex].id);
        }
      }
    }
  }

  handleDial(value) {
    console.log('[Shell] Dial:', value);
    
    // Send to server for app processing
    this.sendInput(InputType.DIAL, value);
    
    // Handle shell-level navigation
    if (!this.elements.navOverlay.classList.contains('hidden')) {
      // Navigate in nav menu
      const items = this.elements.navOverlay.querySelectorAll('.nav-item');
      if (items.length > 0) {
        if (value === 'right') {
          this.navSelectedIndex = (this.navSelectedIndex + 1) % items.length;
        } else if (value === 'left') {
          this.navSelectedIndex = (this.navSelectedIndex - 1 + items.length) % items.length;
        }
        this.updateNavSelection();
      }
    } else if (this.elements.homeScreen.classList.contains('active')) {
      // Navigate in app grid
      const enabledApps = this.apps.filter(app => app.enabled);
      if (enabledApps.length > 0) {
        if (value === 'right') {
          this.selectedIndex = (this.selectedIndex + 1) % enabledApps.length;
        } else if (value === 'left') {
          this.selectedIndex = (this.selectedIndex - 1 + enabledApps.length) % enabledApps.length;
        }
        this.renderHomeScreen();
      }
    }
  }

  handleTouch(value) {
    console.log('[Shell] Touch:', value);
    this.sendInput(InputType.TOUCH, value);
  }

  showLoading(message = 'Loading...') {
    this.elements.loading.querySelector('p').textContent = message;
    this.elements.loading.classList.remove('hidden');
  }

  hideLoading() {
    this.elements.loading.classList.add('hidden');
  }
}

// Initialize shell when DOM is ready
let shell = null;

document.addEventListener('DOMContentLoaded', () => {
  shell = new ShellRuntime();
  
  // Expose for debugging/testing
  window.shell = shell;
});

// Keyboard simulation for development/testing
document.addEventListener('keydown', (e) => {
  if (!shell) return;
  
  // Dial: Arrow keys
  if (e.key === 'ArrowLeft') {
    shell.handleDial('left');
  } else if (e.key === 'ArrowRight') {
    shell.handleDial('right');
  }
  // Dial click: Enter
  else if (e.key === 'Enter') {
    shell.handleButton('dial-click');
  }
  // Back: Escape
  else if (e.key === 'Escape') {
    shell.handleButton('back');
  }
  // Preset buttons: 1-4
  else if (e.key >= '1' && e.key <= '4') {
    shell.handleButton(`preset${e.key}`);
  }
});

export { shell };
