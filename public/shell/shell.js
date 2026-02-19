// System UI Shell - Permanent Runtime for ServerThing
// Hardware-integrated version — resolution-independent (Car Thing / Tablet / Phone)

import { MessageType, InputType, Protocol } from '/shared/protocol.js';

// ─── Hardware Key Codes ─────────────────────────────────────────────────────
// Linux input event key codes from the inputd
const KEY_CODES = {
  KEY_BACK: 158,
  KEY_ENTER: 28,
  KEY_LEFT: 105,
  KEY_RIGHT: 106,
  // Settings button (varies by input bridge / firmware; include common candidates)
  KEY_MENU: 139,
  KEY_SETUP: 141,
  KEY_CONFIG: 171,
  BTN_0: 256,  // Preset 1
  BTN_1: 257,  // Preset 2
  BTN_2: 258,  // Preset 3
  BTN_3: 259   // Preset 4
};

// ─── Device Scaling Hook ────────────────────────────────────────────────────
// Detects the host device class and sets the root font-size so that all rem
// values scale proportionally.  The Car Thing has an 800×480 screen at low PPI;
// tablets and phones need a larger base size.
function applyDeviceScale() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const isCarThing = (w === 800 && h === 480);

  let baseFontSize;
  if (isCarThing) {
    baseFontSize = 18;                          // baseline — all rem authored against this
  } else if (Math.min(w, h) >= 600) {
    baseFontSize = 20;                          // tablet-class
  } else {
    baseFontSize = 18;                          // phone-class
  }

  document.documentElement.style.fontSize = `${baseFontSize}px`;
  document.body.setAttribute('data-device', isCarThing ? 'carthing' : 'generic');
  console.log(`[Shell] Device scale: ${baseFontSize}px  (${w}×${h})`);
}

// Apply once at boot and on any resize / orientation change
applyDeviceScale();
window.addEventListener('resize', applyDeviceScale);

// Preload Material Symbols and toggle a class once available so glyphs replace fallbacks
function loadMaterialSymbolsFont() {
  const CLASS_NAME = 'material-font-loaded';
  const FACE_DECL = '400 24px "Material Symbols Outlined"';
  const markLoaded = () => document.body.classList.add(CLASS_NAME);

  try {
    if (document.fonts && document.fonts.load) {
      document.fonts.load(FACE_DECL).then(() => {
        // Only enable when the browser confirms the face is present.
        if (document.fonts.check && document.fonts.check(FACE_DECL)) {
          markLoaded();
        }
      }).catch(() => {});
    } else {
      // Older engines: leave fallbacks in place.
    }
  } catch (e) {
    // Leave fallbacks in place on failure.
  }
}

// ─── Config Manager ─────────────────────────────────────────────────────────
// Lightweight localStorage-backed state layer.  Single source of truth for app
// order, display-name overrides, and icon overrides.
class ConfigManager {
  static get STORAGE_KEY() { return 'serverthing-shell-config'; }

  constructor() {
    this._data = this._load();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Ordered array of appIds.  renderAppGrid uses this for placement. */
  get appOrder()    { return this._data.appOrder; }
  set appOrder(arr) { this._data.appOrder = arr; this._save(); }

  /** Map of appId → custom display name string. */
  get nameOverrides()    { return this._data.nameOverrides; }

  /** Map of appId → { iconName?, backgroundColor?, glyphColor? }. */
  get iconOverrides()    { return this._data.iconOverrides; }

  /** System settings persisted for the shell UI. */
  get systemSettings()    { return this._data.systemSettings; }

  setSystemSetting(key, value) {
    if (!this._data.systemSettings) this._data.systemSettings = {};
    this._data.systemSettings[key] = value;
    this._save();
  }

  /** Get the display name for an app (override or original). */
  displayName(app) {
    return this._data.nameOverrides[app.id] || app.name;
  }

  /** Set a custom display name for an app. Pass null to clear. */
  setDisplayName(appId, name) {
    if (name === null || name === undefined) {
      delete this._data.nameOverrides[appId];
    } else {
      this._data.nameOverrides[appId] = name;
    }
    this._save();
  }

  /** Set icon overrides for an app. Pass null to clear. */
  setIconOverride(appId, overrides) {
    if (overrides === null || overrides === undefined) {
      delete this._data.iconOverrides[appId];
    } else {
      this._data.iconOverrides[appId] = overrides;
    }
    this._save();
  }

  /**
   * Ensure the order array is in sync with a live app list.
   * New apps are appended; removed apps are pruned.
   */
  syncOrder(enabledAppIds) {
    const ordered = this._data.appOrder.filter(id => enabledAppIds.includes(id));
    for (const id of enabledAppIds) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    this._data.appOrder = ordered;
    this._save();
    return ordered;
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  _load() {
    try {
      const raw = localStorage.getItem(ConfigManager.STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          appOrder:      Array.isArray(parsed.appOrder) ? parsed.appOrder : [],
          nameOverrides: parsed.nameOverrides || {},
          iconOverrides: parsed.iconOverrides || {},
          systemSettings: parsed.systemSettings || {
            autoDim: true,
            brightness: 128,
            mic: false,
          },
        };
      }
    } catch (e) {
      console.warn('[ConfigManager] Failed to load — resetting', e);
    }
    return {
      appOrder: [],
      nameOverrides: {},
      iconOverrides: {},
      systemSettings: { autoDim: true, brightness: 128, mic: false },
    };
  }

  _save() {
    try {
      localStorage.setItem(ConfigManager.STORAGE_KEY, JSON.stringify(this._data));
    } catch (e) {
      console.warn('[ConfigManager] Failed to save', e);
    }
  }
}

// ─── Icon Manager ───────────────────────────────────────────────────────────
// Centralized icon resolution for apps.  Uses Google Material Symbols (variable
// font) so that glyph weight can shift on focus for low-PPI legibility.
class IconManager {
  constructor() {
    // Keyword → Material Symbols glyph name
    this.iconMap = {
      'counter':    'pin',
      'count':      'pin',
      'timer':      'timer',
      'clock':      'schedule',
      'settings':   'settings',
      'music':      'album',
      'audio':      'headphones',
      'video':      'movie',
      'photo':      'photo_camera',
      'file':       'folder',
      'files':      'folder',
      'download':   'download',
      'upload':     'upload',
      'network':    'wifi',
      'bluetooth':  'bluetooth',
      'key':        'vpn_key',
      'makemkv':    'vpn_key',
      'disc':       'album',
      'weather':    'cloud',
      'home':       'home',
      'system':     'memory',
      'monitor':    'monitor_heart',
      'terminal':   'terminal',
      'notes':      'edit_note',
      'chat':       'chat',
      'map':        'map',
      'radio':      'radio',
      'spotify':    'headphones',
    };

    // Deterministic palette for auto-assigned tile backgrounds
    this.palette = [
      '#2d7d46', '#1565c0', '#c62828', '#6a1b9a',
      '#ef6c00', '#00838f', '#4e342e', '#37474f',
    ];
  }

  /**
   * Primary API — resolves glyph, background, and foreground for an app.
   * @param {string} appId
   * @param {{ id: string, name: string }} metadata — the app's base metadata
   * @param {{ iconName?: string, backgroundColor?: string, glyphColor?: string }} [overrides]
   * @returns {{ glyph: string, bg: string, fg: string }}
   */
  getIcon(appId, metadata, overrides = {}) {
    const glyph = overrides.iconName   || metadata.iconName   || this._autoGlyph(metadata);
    const bg    = overrides.backgroundColor || metadata.backgroundColor || this._autoBg(appId);
    const fg    = overrides.glyphColor || metadata.glyphColor || '#ffffff';
    return { glyph, bg, fg };
  }

  /** Auto-select a glyph by scanning app id/name against the keyword map. */
  _autoGlyph(app) {
    const haystack = `${app.id} ${app.name}`.toLowerCase();
    for (const [keyword, icon] of Object.entries(this.iconMap)) {
      if (haystack.includes(keyword)) return icon;
    }
    return 'apps'; // universal fallback
  }

  /** Deterministic color from the palette based on app-id hash. */
  _autoBg(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    return this.palette[Math.abs(hash) % this.palette.length];
  }
}

class ShellRuntime {
  constructor() {
    this.version = "1.0.1-syncFix";
    this.protocolVersion = Protocol.SHELL_PROTOCOL_VERSION;
    this.clientType = this.detectClientType();
    this.capabilities = this.detectCapabilities(this.clientType);
    this.isHardwareBackedShell = !!this.capabilities.acceptsHardwareKeycodes;
    this.ws = null;
    this.deviceId = this.getOrCreateStableDeviceId();
    this.iconManager = new IconManager();
    this.configManager = new ConfigManager();
    this.apps = []; // Populated via WebSocket from server
    this.currentApp = { id: null, iframe: null, atRoot: true };
    this.interactionMode = 'dial';
    this.focusedAppIndex = 0;
    
    // Time Sync
    this.serverTimeOffset = 0;
    this.serverTzOffset = 0;

    // Focus Zone: 'statusbar' | 'grid' | 'app'
    this.focusZone = 'grid';
    this.statusBarItems = [];  // populated in init()
    this.statusBarFocusIndex = 0;

    // Dial throttle — 25 ms for scroll, leading-edge for clicks
    this._dialThrottleMs = 25;
    this._lastDialTime = 0;
    
    // Timer for Long Press
    this.backButtonTimer = null;
    this.isLongPress = false;
    this.settingsButtonTimer = null;
    this.isSettingsLongPress = false;
    this.hasConnectedOnce = false;
    this.isDisconnectedScreenVisible = false;
    this.reconnectTimer = null;
    this._brightnessLastSent = null;
    this.inputHealthPollTimer = null;

    this.elements = {
      statusBar: document.getElementById('status-bar'),
      sysNavButton: document.getElementById('sys-nav-button'),
      sysSettingsButton: document.getElementById('sys-settings-button'),
      navIcon: document.getElementById('nav-icon'),
      statusTime: document.getElementById('status-time'),
      homeScreen: document.getElementById('home-screen'),
      appGrid: document.getElementById('app-grid'),
      appContainer: document.getElementById('app-container'),
      loading: document.getElementById('loading'),
      disconnectScreen: document.getElementById('disconnect-screen'),
      settingsOverlay: document.getElementById('settings-overlay'),
      closeSettings: document.getElementById('close-settings'),
      brightnessSlider: document.getElementById('brightness-slider'),
      brightnessValue: document.getElementById('brightness-value'),
      autoDimToggle: document.getElementById('auto-dim-toggle'),
      micToggle: document.getElementById('mic-toggle'),
      diagnosticsSection: document.getElementById('diagnostics-section'),
      diagnosticsToggle: document.getElementById('diagnostics-toggle'),
      restartChromiumBtn: document.getElementById('restart-chromium'),
      rebootDeviceBtn: document.getElementById('reboot-device'),
      diagServerLink: document.getElementById('diag-server-link'),
      diagQueueSize: document.getElementById('diag-queue-size'),
      diagSendFailures: document.getElementById('diag-send-failures'),
      diagMonitorCount: document.getElementById('diag-monitor-count'),
      diagLastUpdate: document.getElementById('diag-last-update'),
    };

    this.init();
  }

  getOrCreateStableDeviceId() {
    const key = 'serverthing-shell-device-id';
    try {
      const existing = localStorage.getItem(key);
      if (existing && existing.trim()) return existing;
      const created = `shell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(key, created);
      return created;
    } catch {
      // Fallback for restricted storage environments.
      return `shell-${Date.now()}`;
    }
  }

  init() {
    console.log('[Shell] Initializing Runtime');
    this.updateBodyDataset();
    this.applyClientCapabilitiesToUI();
    // Order: Back button (Left), Settings (Right)
    this.statusBarItems = [this.elements.sysNavButton, this.elements.sysSettingsButton];
    this.startClock();
    this.addEventListeners();
    this.applySystemSettingsToUI();
    this.connectWebSocket();
    this.renderAppGrid();
    this.applyZoneFocus();
    window.focus();
  }

  // ─── WebSocket ──────────────────────────────────────────────────────────
  connectWebSocket() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${location.host}/ws/device?id=${encodeURIComponent(this.deviceId)}`;
    console.log(`[Shell] Connecting to ${url}`);

    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      console.log('[Shell] WebSocket connected');
      this.sendHello();
      this.hasConnectedOnce = true;
      this.clearReconnectTimer();
      this.updateConnectionStatus(true);
      this.showDisconnectScreen(false);
      // Re-apply persisted system settings to the device on reconnect.
      if (this.isHardwareBackedShell) this.applySystemSettingsToDevice();
    });

    this.ws.addEventListener('close', () => {
      console.log('[Shell] WebSocket disconnected — reconnecting in 3 s');
      this.updateConnectionStatus(false);
      if (this.hasConnectedOnce) this.showDisconnectScreen(true);
      this.scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      this.updateConnectionStatus(false);
      if (this.hasConnectedOnce) this.showDisconnectScreen(true);
      this.scheduleReconnect();
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleServerMessage(msg);
      } catch { /* ignore non-JSON frames */ }
    });
  }

  updateConnectionStatus(connected) {
    // Connection state is reflected by the full-screen disconnect overlay.
  }

  showDisconnectScreen(show) {
    if (!this.elements.disconnectScreen || this.isDisconnectedScreenVisible === show) return;
    this.isDisconnectedScreenVisible = show;
    this.elements.disconnectScreen.classList.toggle('hidden', !show);
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, 3000);
  }

  clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  handleServerMessage(msg) {
    console.log('[Shell] Server message:', msg.type);
    
    switch (msg.type) {
      case MessageType.S2D_CONNECTED:
        console.log(`[Shell] Device registered as ${msg.deviceId}`);
        if (msg.serverTime) {
          this.serverTimeOffset = msg.serverTime - Date.now();
        }
        if (typeof msg.serverTzOffset !== 'undefined') {
          this.serverTzOffset = msg.serverTzOffset;
        }
        if (msg.apps) {
          this.apps = msg.apps;
          this.renderAppGrid();
        }
        break;

      case MessageType.S2D_HELLO_ACK:
        console.log('[Shell] Handshake acknowledged by server');
        break;

      case MessageType.S2D_TIME_SYNC:
        if (msg.serverTime) {
          this.serverTimeOffset = msg.serverTime - Date.now();
        }
        if (typeof msg.serverTzOffset !== 'undefined') {
          this.serverTzOffset = msg.serverTzOffset;
        }
        break;

      case MessageType.S2D_APPS_RELOADED:
        console.log('[Shell] Apps reloaded on server');
        if (msg.apps) {
          this.apps = msg.apps;
          this.renderAppGrid();
        }
        break;

      case MessageType.S2D_APP_ENABLED:
      case MessageType.S2D_APP_DISABLED:
        // For performance, we could just toggle enabled state, but 
        // a full refresh is safer for now.
        this.fetchApps();
        break;

      case MessageType.S2D_APP_RESPONSE:
        this.forwardToActiveApp(msg);
        break;

      case MessageType.S2D_INPUT:
        // Hardware input from inputd
        this.handleHardwareKeyCode(msg.keyCode, msg.isPressed);
        break;

      case MessageType.S2D_INPUT_RECEIVED:
        // Feedback if needed
        break;
    }
  }

  /** Fetch latest app list from REST API as a fallback. */
  async fetchApps() {
    try {
      const res = await fetch('/api/apps');
      const apps = await res.json();
      this.apps = apps;
      this.renderAppGrid();
    } catch (err) {
      console.error('[Shell] Failed to fetch apps:', err);
    }
  }

  forwardToActiveApp(msg) {
    if (this.currentApp.iframe && this.currentApp.iframe.contentWindow) {
      this.currentApp.iframe.contentWindow.postMessage({
        type: 'server-message',
        message: msg
      }, '*');
    }
  }

  handleHardwareKeyCode(keyCode, isPressed) {
    // Convert Linux key codes from inputd to shell input format
    let input = null;

    switch (keyCode) {
      case KEY_CODES.KEY_LEFT:
        if (isPressed) {
          input = { type: InputType.DIAL, value: 'left' };
        }
        break;

      case KEY_CODES.KEY_RIGHT:
        if (isPressed) {
          input = { type: InputType.DIAL, value: 'right' };
        }
        break;

      case KEY_CODES.KEY_ENTER:
        input = { 
          type: InputType.BUTTON, 
          value: isPressed ? 'dial_click_down' : 'dial_click_up' 
        };
        break;

      case KEY_CODES.KEY_BACK:
        input = { 
          type: InputType.BUTTON, 
          value: isPressed ? 'back_button_down' : 'back_button_up' 
        };
        break;

      case KEY_CODES.KEY_MENU:
      case KEY_CODES.KEY_SETUP:
      case KEY_CODES.KEY_CONFIG:
        input = {
          type: InputType.BUTTON,
          value: isPressed ? 'settings_button_down' : 'settings_button_up'
        };
        break;

      case KEY_CODES.BTN_0:
        if (isPressed) {
          input = { type: InputType.BUTTON, value: 'preset_1' };
        }
        break;

      case KEY_CODES.BTN_1:
        if (isPressed) {
          input = { type: InputType.BUTTON, value: 'preset_2' };
        }
        break;

      case KEY_CODES.BTN_2:
        if (isPressed) {
          input = { type: InputType.BUTTON, value: 'preset_3' };
        }
        break;

      case KEY_CODES.BTN_3:
        if (isPressed) {
          input = { type: InputType.BUTTON, value: 'preset_4' };
        }
        break;
    }

    if (input) {
      console.log('[Shell] Hardware input:', input);
      this.handleHardwareInput(input);
    } else if (isPressed) {
      console.log('[Shell] Unmapped hardware keyCode:', keyCode);
    }
  }

  setInteractionMode(mode) {
    if (this.interactionMode === mode) return;
    this.interactionMode = mode;
    this.updateBodyDataset();
  }

  updateBodyDataset() {
    document.body.setAttribute('data-interaction-mode', this.interactionMode);
    document.body.setAttribute('data-client-type', this.clientType);
  }

  detectClientType() {
    const qp = new URLSearchParams(window.location.search);
    const raw = String(qp.get('client') || '').toLowerCase();
    if (raw === 'carthing' || raw === 'carthing-shell') return 'carthing-shell';
    if (raw === 'simulator' || raw === 'sim-shell' || raw === 'simulator-shell') return 'simulator-shell';
    return 'web-shell';
  }

  detectCapabilities(clientType) {
    const isCarThing = clientType === 'carthing-shell';
    const isSimulator = clientType === 'simulator-shell';
    return {
      acceptsHardwareKeycodes: isCarThing,
      supportsSystemCommands: isCarThing,
      supportsTouch: !isCarThing || isSimulator,
      supportsDialInput: true,
      supportsButtons: true,
    };
  }

  applyClientCapabilitiesToUI() {
    if (this.isHardwareBackedShell) return;
    if (this.elements.autoDimToggle) this.elements.autoDimToggle.disabled = true;
    if (this.elements.micToggle) this.elements.micToggle.disabled = true;
    if (this.elements.brightnessSlider) this.elements.brightnessSlider.disabled = true;
    if (this.elements.restartChromiumBtn) this.elements.restartChromiumBtn.disabled = true;
    if (this.elements.rebootDeviceBtn) this.elements.rebootDeviceBtn.disabled = true;
  }

  sendHello() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: MessageType.D2S_HELLO,
      deviceId: this.deviceId,
      clientType: this.clientType,
      protocolVersion: this.protocolVersion,
      capabilities: this.capabilities,
      shellVersion: this.version,
    }));
  }

  addEventListeners() {
    document.body.addEventListener('pointerdown', () => {
      this.setInteractionMode('touch');
      window.focus();
    });

    window.addEventListener('blur', () => {
      setTimeout(() => window.focus(), 150);
    });

    window.addEventListener('keydown', (e) => {
      let input = null;
      switch (e.key) {
        case 'ArrowRight': input = { type: InputType.DIAL, value: 'right' }; break;
        case 'ArrowLeft':  input = { type: InputType.DIAL, value: 'left' }; break;
        case 'ArrowUp':    input = { type: InputType.DIAL, value: 'up' }; break;
        case 'ArrowDown':  input = { type: InputType.DIAL, value: 'down' }; break;
        case 'Enter':      input = { type: InputType.BUTTON, value: 'dial_click_down' }; break;
        case 'Backspace':
        case 'Escape':
          this.handleHardwareInput({ type: InputType.BUTTON, value: 'back_button_down' });
          setTimeout(() => this.handleHardwareInput({ type: InputType.BUTTON, value: 'back_button_up' }), 50);
          return;
      }
      if (input) {
        e.preventDefault();
        this.handleHardwareInput(input);
      }
    });

    this.elements.sysNavButton.addEventListener('pointerdown', () => this.handleBackButtonDown());
    this.elements.sysNavButton.addEventListener('pointerup', () => this.handleBackButtonUp());
    this.elements.sysSettingsButton.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.toggleSettings(true);
    });
    this.elements.closeSettings.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.toggleSettings(false);
    });
    
    this.elements.brightnessSlider.addEventListener('input', (e) => {
      this.onBrightnessChanged(e.target.value);
    });

    if (this.elements.autoDimToggle) {
      this.elements.autoDimToggle.addEventListener('change', (e) => {
        const enabled = !!e.target.checked;
        this.configManager.setSystemSetting('autoDim', enabled);
        this.applySystemSettingsToUI();
        // Apply immediately to the device. If disabling auto-dim, also apply stored brightness.
        this.sendHardwareCommand('auto_dim', enabled ? '1' : '0');
        if (!enabled) {
          const b = this.configManager.systemSettings.brightness;
          this.sendHardwareCommand('brightness', String(b));
        }
      });
    }

    if (this.elements.micToggle) {
      this.elements.micToggle.addEventListener('change', (e) => {
        const enabled = !!e.target.checked;
        this.configManager.setSystemSetting('mic', enabled);
        // Placeholder: we persist and optionally forward to server for future support.
        this.sendHardwareCommand('mic', enabled ? '1' : '0');
      });
    }

    if (this.elements.diagnosticsToggle && this.elements.diagnosticsSection) {
      this.elements.diagnosticsToggle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const isCollapsed = this.elements.diagnosticsSection.classList.toggle('collapsed');
        this.elements.diagnosticsToggle.setAttribute('aria-expanded', String(!isCollapsed));
      });
    }

    if (this.elements.restartChromiumBtn) {
      this.elements.restartChromiumBtn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.sendHardwareCommand('restart_chromium', '1');
        this.toggleSettings(false);
      });
    }

    if (this.elements.rebootDeviceBtn) {
      this.elements.rebootDeviceBtn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.sendHardwareCommand('reboot', '1');
        this.toggleSettings(false);
      });
    }

    window.addEventListener('message', (event) => this.handleIframeMessage(event));
  }

  applySystemSettingsToUI() {
    const s = this.configManager.systemSettings || {};
    if (this.elements.autoDimToggle) {
      this.elements.autoDimToggle.checked = !!s.autoDim;
      this.elements.autoDimToggle.disabled = !this.isHardwareBackedShell;
    }
    if (this.elements.micToggle) {
      this.elements.micToggle.checked = !!s.mic;
      this.elements.micToggle.disabled = !this.isHardwareBackedShell;
    }
    if (this.elements.brightnessSlider) {
      const b = Number(s.brightness || 128);
      const clamped = Math.max(1, Math.min(255, b));
      this.elements.brightnessSlider.value = String(clamped);
      // Manual brightness is only meaningful when Auto-Dim is off (backlight daemon stopped).
      this.elements.brightnessSlider.disabled = !this.isHardwareBackedShell || !!s.autoDim;
      if (this.elements.brightnessValue) this.elements.brightnessValue.textContent = String(Math.round(clamped));
    }
    if (this.elements.restartChromiumBtn) this.elements.restartChromiumBtn.disabled = !this.isHardwareBackedShell;
    if (this.elements.rebootDeviceBtn) this.elements.rebootDeviceBtn.disabled = !this.isHardwareBackedShell;
  }

  applySystemSettingsToDevice() {
    if (!this.isHardwareBackedShell) return;
    const s = this.configManager.systemSettings || {};
    // Auto-Dim first (controls whether backlight daemon is running).
    this.sendHardwareCommand('auto_dim', s.autoDim ? '1' : '0');
    // Only set brightness if auto-dim is disabled.
    if (!s.autoDim) this.sendHardwareCommand('brightness', String(s.brightness || 128));
    // Forward mic state (server may ignore for now).
    this.sendHardwareCommand('mic', s.mic ? '1' : '0');
  }

  onBrightnessChanged(value) {
    const s = this.configManager.systemSettings || {};
    const autoDim = !!s.autoDim;
    const b = Number(value);
    if (!Number.isFinite(b)) return;

    const clamped = Math.max(1, Math.min(255, Math.round(b)));
    this.configManager.setSystemSetting('brightness', clamped);
    if (this.elements.brightnessValue) this.elements.brightnessValue.textContent = String(clamped);

    // If auto-dim is enabled, brightness will be immediately overridden by ALS daemon.
    if (autoDim) return;

    // No delay: send on every input event (slider step controls how chatty this is).
    // Avoid re-sending identical values.
    if (this._brightnessLastSent === clamped) return;
    this._brightnessLastSent = clamped;
    this.sendHardwareCommand('brightness', String(clamped));
  }

  // ── Focus Recovery Safety Valve ──────────────────────────────────────────
  // If a dial event arrives but nothing is visually focused, reset to a
  // known-good state so the user is never "stuck".
  recoverFocus() {
    const hasFocusedCell = this.elements.appGrid.querySelector('.app-cell.focused');
    const hasFocusedNav  = this.elements.sysNavButton.classList.contains('focused');

    if (hasFocusedCell || hasFocusedNav) return false; // focus is fine
    if (this.focusZone === 'app' && this.currentApp.iframe) return false; // app owns focus

    console.warn('[Shell] Focus lost — recovering to status bar');
    this.focusZone = 'statusbar';
    this.applyZoneFocus();
    return true;
  }

  handleHardwareInput(input) {
    this.setInteractionMode('dial');

    // ── Dial throttle (25 ms) — prevents flood on fast rotary spin ─────
    if (input.type === InputType.DIAL) {
      const now = performance.now();
      if (now - this._lastDialTime < this._dialThrottleMs) return;
      this._lastDialTime = now;
      // Safety valve: if focus was lost, recover before processing
      this.recoverFocus();
    }

    // Preset Shortcuts
    if (input.type === InputType.BUTTON) {
      const val = String(input.value).toLowerCase();

      // System: physical Settings long press opens System Settings overlay
      if (val === 'settings_long') {
        this.focusZone = 'statusbar';
        this.statusBarFocusIndex = this.statusBarItems.indexOf(this.elements.sysSettingsButton);
        this.applyZoneFocus();
        this.toggleSettings(true);
        return;
      }
      if (val === 'settings_button_down') return this.handleSettingsButtonDown();
      if (val === 'settings_button_up') return this.handleSettingsButtonUp();

      if (val === 'preset_1') return this.launchApp('counter');
      if (val === 'preset_2') return this.launchApp('makemkv-key');
      if (val === 'preset_4') return this.returnToHomeGrid();

      // Handle the physical back button from ServerThing
      if (val === 'back_button_down') return this.handleBackButtonDown();
      if (val === 'back_button_up') return this.handleBackButtonUp();
    }

    // ── Zone-based dial routing ───────────────────────────────────────────
    if (input.type === InputType.DIAL) {
      const dir = String(input.value).toLowerCase();

      // Vertical movement: cross-zone navigation
      if (dir === 'up') {
        if (this.focusZone === 'grid') {
          this.focusZone = 'statusbar';
          // Land on settings button (index 1) when coming up from grid/apps
          this.statusBarFocusIndex = this.statusBarItems.indexOf(this.elements.sysSettingsButton);
          this.applyZoneFocus();
        } else if (this.focusZone === 'app' && this.currentApp.atRoot) {
          // App is at top — pull focus up to status bar
          this.focusZone = 'statusbar';
          this.statusBarFocusIndex = this.statusBarItems.indexOf(this.elements.sysSettingsButton);
          this.applyZoneFocus();
        } else if (this.focusZone === 'app') {
          // Let the app handle internal up-navigation
          this.postMessageToApp({ type: 'HARDWARE_EVENT', data: input });
        }
        return;
      }
      if (dir === 'down') {
        if (this.focusZone === 'statusbar') {
          this.focusZone = this.currentApp.id ? 'app' : 'grid';
          this.applyZoneFocus();
        } else if (this.focusZone === 'app') {
          this.postMessageToApp({ type: 'HARDWARE_EVENT', data: input });
        }
        return;
      }

      // Horizontal movement: within-zone navigation
      if (this.focusZone === 'statusbar') {
        const visibleItems = this.statusBarItems.filter(el => !el.classList.contains('hidden'));
        
        if (dir === 'right') {
          if (this.statusBarFocusIndex < visibleItems.length - 1) {
            this.statusBarFocusIndex++;
            this.applyZoneFocus();
          } else {
            // Exit status bar to the right -> enters app/grid
            this.focusZone = this.currentApp.id ? 'app' : 'grid';
            this.applyZoneFocus();
          }
        } else if (dir === 'left') {
          if (this.statusBarFocusIndex > 0) {
            this.statusBarFocusIndex--;
            this.applyZoneFocus();
          }
        }
        return;
      }

      if (this.focusZone === 'grid') {
        const enabledApps = this.apps.filter(app => app.enabled);
        if (dir === 'right') this.focusedAppIndex = (this.focusedAppIndex + 1) % enabledApps.length;
        else if (dir === 'left') this.focusedAppIndex = (this.focusedAppIndex - 1 + enabledApps.length) % enabledApps.length;
        this.renderAppGrid();
        return;
      }

      if (this.focusZone === 'app') {
        this.postMessageToApp({ type: 'HARDWARE_EVENT', data: input });
        return;
      }
    }

    // ── Button press routing ──────────────────────────────────────────────
    if (input.type === InputType.BUTTON && String(input.value).toLowerCase() === 'dial_click_down') {
      if (this.focusZone === 'statusbar') {
        const visibleItems = this.statusBarItems.filter(el => !el.classList.contains('hidden'));
        const focusedItem = visibleItems[this.statusBarFocusIndex];
        
        if (focusedItem === this.elements.sysNavButton) {
          this.handleBackButtonDown();
          setTimeout(() => this.handleBackButtonUp(), 60);
        } else if (focusedItem === this.elements.sysSettingsButton) {
          this.toggleSettings(true);
        }
        return;
      }
      if (this.focusZone === 'grid') {
        const enabledApps = this.apps.filter(app => app.enabled);
        const app = enabledApps[this.focusedAppIndex];
        if (app) this.launchApp(app.id);
        return;
      }
      if (this.focusZone === 'app') {
        this.postMessageToApp({ type: 'HARDWARE_EVENT', data: input });
        return;
      }
    }
  }

  // ── Zone Focus Visuals ───────────────────────────────────────────────────
  applyZoneFocus() {
    // Clear all zone highlights
    this.statusBarItems.forEach(el => el.classList.remove('focused', 'muted'));
    this.elements.appGrid.querySelectorAll('.app-cell').forEach(c => c.classList.remove('focused'));

    if (this.focusZone === 'statusbar') {
      const item = this.statusBarItems[this.statusBarFocusIndex];
      if (item && !item.classList.contains('hidden')) {
        item.classList.add('focused');
      }
    } else if (this.focusZone === 'grid') {
      // Re-render sets .focused on the correct cell
      this.renderAppGrid();
    }
    // 'app' zone: tell the iframe whether it's the primary focus
    if (this.focusZone === 'app') {
      this.postMessageToApp({ type: 'ZONE_FOCUS', active: true });
    } else if (this.currentApp.id) {
      // Another zone owns focus — dim the app's internal highlights
      this.postMessageToApp({ type: 'DIM_APP_FOCUS' });
    }
  }

  handleBackButtonDown() {
    // If settings are open, reserve back for closing the overlay.
    if (this.elements.settingsOverlay && !this.elements.settingsOverlay.classList.contains('hidden')) {
      this.isLongPress = false;
      clearTimeout(this.backButtonTimer);
      return;
    }

    this.isLongPress = false;
    clearTimeout(this.backButtonTimer);
    
    // Start timer for 250ms — tight threshold prevents accidental triggers
    // during rapid dial navigation while remaining responsive to intentional holds
    this.backButtonTimer = setTimeout(() => {
      this.isLongPress = true;
      console.log('[Shell] Long Press detected: Returning Home');
      this.returnToHomeGrid();
    }, 250);
  }

  handleBackButtonUp() {
    // Close settings first on back button release.
    if (this.elements.settingsOverlay && !this.elements.settingsOverlay.classList.contains('hidden')) {
      clearTimeout(this.backButtonTimer);
      this.toggleSettings(false);
      this.isLongPress = false;
      return;
    }

    clearTimeout(this.backButtonTimer);
    
    // If it wasn't a long press, do the normal back action
    if (!this.isLongPress) {
      console.log('[Shell] Short Press detected: Standard Back');
      if (this.currentApp.id) {
        // If at the root of an app, the button acts as a "Home" button
        if (this.currentApp.atRoot) {
          this.returnToHomeGrid();
        } else {
          // Otherwise, send a "Back" command to the app
          this.postMessageToApp({ type: 'CMD_BACK' });
        }
      }
    }
    this.isLongPress = false;
  }

  handleSettingsButtonDown() {
    this.isSettingsLongPress = false;
    clearTimeout(this.settingsButtonTimer);

    // Intentional long press only; avoids stealing the short press behavior.
    this.settingsButtonTimer = setTimeout(() => {
      this.isSettingsLongPress = true;
      console.log('[Shell] Long Press detected: Opening System Settings');
      this.focusZone = 'statusbar';
      this.statusBarFocusIndex = this.statusBarItems.indexOf(this.elements.sysSettingsButton);
      this.applyZoneFocus();
      this.toggleSettings(true);
    }, 650);
  }

  handleSettingsButtonUp() {
    clearTimeout(this.settingsButtonTimer);
    this.isSettingsLongPress = false;
  }

  launchApp(appId) {
    // ── Cleanup previous app (memory-leak prevention) ──────────────────
    this._teardownCurrentApp();

    this.showLoading(true);
    const iframe = document.createElement('iframe');
    iframe.src = `/apps/${appId}/index.html`;
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.onload = () => {
      this.showLoading(false);
      this.injectBridgeTheme(iframe);
    };
    
    this.elements.appContainer.innerHTML = '';
    this.elements.appContainer.appendChild(iframe);
    this.currentApp = { id: appId, iframe, atRoot: true };
    document.body.classList.add('app-open');
    
    this.elements.homeScreen.classList.remove('active');
    this.elements.appContainer.classList.add('active');

    // Show nav button — set focus zone to app
    this.elements.sysNavButton.classList.remove('hidden');
    this.focusZone = 'app';
    this.applyZoneFocus();
    this.updateNavIcon(true);
  }

  // ── UI Bridge: Theme Injection ──────────────────────────────────────────
  /** Inject CSS custom-properties and .st-selectable rules into the iframe's <head>. */
  injectBridgeTheme(iframe) {
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const style = doc.createElement('style');
      style.setAttribute('data-shell-bridge', 'true');
      style.textContent = `
        /* Shell UI Bridge — injected by ShellRuntime */
        :root {
          --st-highlight-bg:     #ffffff;
          --st-muted-opacity:    0.5;
          --st-transition-speed: 0.1s;
        }
        .st-selectable {
          transform: none !important;
          font-weight: inherit !important;
          transition: opacity var(--st-transition-speed) ease,
                      outline var(--st-transition-speed) ease;
        }
        .st-selectable.st-focused {
          outline: 0.1875rem solid var(--st-highlight-bg);
          outline-offset: 0.125rem;
          opacity: 1;
        }
        .st-selectable.st-muted {
          outline: 0.1875rem solid rgba(255,255,255, var(--st-muted-opacity));
          outline-offset: 0.125rem;
          opacity: var(--st-muted-opacity);
        }
      `;
      doc.head.appendChild(style);
      // Notify the app that the bridge theme is ready
      this.postMessageToApp({ type: 'THEME_READY' });
      console.log(`[Shell] Bridge theme injected into ${iframe.src}`);
    } catch (e) {
      // Cross-origin iframes will throw — fall back to postMessage
      console.warn('[Shell] Could not inject theme (cross-origin?), sending via postMessage');
      this.postMessageToApp({
        type: 'THEME_UPDATE',
        tokens: {
          '--st-highlight-bg':     '#ffffff',
          '--st-muted-opacity':    '0.5',
          '--st-transition-speed': '0.1s',
        }
      });
    }
  }

  returnToHomeGrid() {
    this._teardownCurrentApp();
    this.currentApp = { id: null, iframe: null, atRoot: true };
    document.body.classList.remove('app-open');
    this.elements.appContainer.classList.remove('active');
    this.elements.homeScreen.classList.add('active');
    
    // Hide nav button on home screen, reset zone to grid
    this.elements.sysNavButton.classList.add('hidden');
    this.elements.sysNavButton.classList.remove('at-root', 'focused', 'muted');
    this.focusZone = 'grid';
    this.renderAppGrid();
  }

  // ── Iframe Teardown (memory-leak prevention) ────────────────────────────
  _teardownCurrentApp() {
    if (this.currentApp.iframe) {
      try {
        // Stop any running timers/intervals inside the iframe
        const win = this.currentApp.iframe.contentWindow;
        if (win) {
          // Clear the iframe document before removal
          const doc = this.currentApp.iframe.contentDocument;
          if (doc) doc.open(), doc.write(''), doc.close();
        }
      } catch { /* cross-origin — iframe will be GC'd on removal */ }
      this.currentApp.iframe.onload = null;
      this.currentApp.iframe.onerror = null;
      this.currentApp.iframe.src = 'about:blank';
    }
    this.elements.appContainer.innerHTML = '';
  }

  renderAppGrid() {
    const enabledApps = this.apps.filter(app => app.enabled);
    const enabledIds  = enabledApps.map(a => a.id);

    // Sort apps according to ConfigManager's persisted order
    const orderedIds  = this.configManager.syncOrder(enabledIds);
    // Build map manually (Object.fromEntries is ES2019, too new for Chromium 69)
    const appMap = {};
    enabledApps.forEach(app => {
      appMap[app.id] = app;
    });
    const sortedApps  = orderedIds.map(id => appMap[id]).filter(Boolean);

    // Clamp focus index to avoid out-of-bounds on refresh (e.g. if an app was removed)
    if (this.focusedAppIndex >= sortedApps.length && sortedApps.length > 0) {
      this.focusedAppIndex = Math.max(0, sortedApps.length - 1);
    }

    this.elements.appGrid.innerHTML = sortedApps.map((app, index) => {
      // Apply icon & name overrides from ConfigManager
      const iconOverrides = this.configManager.iconOverrides[app.id] || {};
      const icon = this.iconManager.getIcon(app.id, app, iconOverrides);
      const displayName = this.configManager.displayName(app);
      const initial = displayName.charAt(0).toUpperCase();

      return `
        <div class="app-cell ${index === this.focusedAppIndex ? 'focused' : ''}" data-app-id="${app.id}">
          <div class="icon-wrapper" style="background:${icon.bg}; color:${icon.fg}">
            <div class="fallback-icon">${initial}</div>
            <span class="material-symbols-outlined">${icon.glyph}</span>
          </div>
          <span class="label-text">${displayName}</span>
        </div>
      `;
    }).join('');

    // Re-attach event listeners for touch interaction — Tap-to-Focus bridge:
    // First tap moves focusedAppIndex AND immediately launches.
    this.elements.appGrid.querySelectorAll('.app-cell').forEach((cell, index) => {
      cell.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.setInteractionMode('touch');

        // Move focus to the tapped cell
        this.focusedAppIndex = index;

        // Apply muted highlight during transition
        this.elements.appGrid.querySelectorAll('.app-cell').forEach(c => {
          c.classList.remove('focused', 'muted');
        });
        cell.classList.add('focused', 'muted');

        const appId = cell.getAttribute('data-app-id');
        this.launchApp(appId);
      });
    });
  }

  postMessageToApp(msg) {
    if (this.currentApp.iframe) {
      this.currentApp.iframe.contentWindow.postMessage(msg, location.origin);
    }
  }

  handleIframeMessage(event) {
    // ── Origin & schema validation ────────────────────────────────────────
    if (event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
    const ALLOWED_TYPES = ['APP_NAV_STATE','APP_AT_TOP','UI_ACTION_START'];
    if (!ALLOWED_TYPES.includes(data.type)) return;

    const { type, atRoot, elementId } = data;
    if (type === 'APP_NAV_STATE') {
      this.currentApp.atRoot = atRoot;
      this.updateNavIcon(atRoot);
    }
    // Bridge: app signals it's at its top — immediately move focus to status bar
    if (type === 'APP_AT_TOP') {
      this.currentApp.atRoot = true;
      if (this.focusZone === 'app') {
        this.focusZone = 'statusbar';
        this.applyZoneFocus();
      }
    }
    // Bridge: app reports a tap/click — Shell renders muted highlight
    if (type === 'UI_ACTION_START') {
      console.log('[Shell] App action started', elementId || '');
      // Acknowledge — the app can show its own muted state immediately
      this.postMessageToApp({ type: 'UI_ACTION_ACK', elementId });
    }
  }

  /**
   * Swap the status-bar nav icon between home (apps) and back (arrow_back_ios_new).
   * Also toggles a dimmed appearance when the app is at its root level.
   */
  updateNavIcon(atRoot) {
    const icon = this.elements.sysNavButton.querySelector('.material-symbols-outlined');
    if (icon) {
      icon.textContent = atRoot ? 'apps' : 'arrow_back_ios_new';
    }
    this.elements.sysNavButton.classList.toggle('at-root', atRoot);
  }

  startClock() {
    const update = () => {
      // Adjusted time based on server sync and server's timezone
      // We subtract the server's TZ offset (in minutes) to shift UTC to Server Local
      // then use getUTC methods to avoid the device's own local TZ shift.
      const now = new Date(Date.now() + this.serverTimeOffset - (this.serverTzOffset * 60000));
      
      let h = now.getUTCHours();
      const m = now.getUTCMinutes().toString().padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      
      // Convert to 12h format
      h = h % 12;
      h = h ? h : 12; 
      
      this.elements.statusTime.textContent = `${h}:${m} ${ampm}`;
      this.elements.statusTime.style.color = ''; // Reset to default (white)
    };
    setInterval(update, 1000);
    update();
  }

  toggleSettings(show) {
    if (show) {
      this.elements.settingsOverlay.classList.remove('hidden');
      this.startInputHealthPolling();
      this.refreshInputHealth();
    } else {
      this.elements.settingsOverlay.classList.add('hidden');
      this.stopInputHealthPolling();
    }
  }

  startInputHealthPolling() {
    if (this.inputHealthPollTimer) return;
    this.inputHealthPollTimer = setInterval(() => this.refreshInputHealth(), 3000);
  }

  stopInputHealthPolling() {
    if (!this.inputHealthPollTimer) return;
    clearInterval(this.inputHealthPollTimer);
    this.inputHealthPollTimer = null;
  }

  async refreshInputHealth() {
    if (!this.elements.diagServerLink) return;
    const wsConnected = !!(this.ws && this.ws.readyState === WebSocket.OPEN);
    this.elements.diagServerLink.textContent = wsConnected ? 'Connected' : 'Disconnected';
    try {
      const res = await fetch('/api/input/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      const h = payload && payload.health ? payload.health : null;
      this.elements.diagQueueSize.textContent = h ? String(h.queueSize) : '--';
      this.elements.diagSendFailures.textContent = h && h.stats ? String(h.stats.sendFailures || 0) : '--';
      this.elements.diagMonitorCount.textContent = h ? String(h.monitorCount) : '--';
      if (h && h.receivedAt) {
        const ageSec = Math.max(0, Math.floor((Date.now() - h.receivedAt) / 1000));
        this.elements.diagLastUpdate.textContent = `${ageSec}s ago`;
      } else {
        this.elements.diagLastUpdate.textContent = '--';
      }
    } catch {
      this.elements.diagQueueSize.textContent = '--';
      this.elements.diagSendFailures.textContent = '--';
      this.elements.diagMonitorCount.textContent = '--';
      this.elements.diagLastUpdate.textContent = '--';
    }
  }

  sendHardwareCommand(command, value) {
    if (!this.isHardwareBackedShell) return;
    console.log(`[Shell] Sending hardware command: ${command} = ${value}`);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: MessageType.D2S_INPUT,
        deviceId: this.deviceId,
        input: {
          type: 'SYS_COMMAND',
          command: command,
          value: value
        }
      }));
    }
  }

  showLoading(show) {
    this.elements.loading.classList.toggle('hidden', !show);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadMaterialSymbolsFont();
  window.shell = new ShellRuntime();
});

// ─── Heap Monitor (DevTools diagnostic) ─────────────────────────────────────
// Paste into console or enable with: shell.startHeapMonitor()
// Logs a warning if JS heap grows by >10 MB in 5 minutes.
ShellRuntime.prototype.startHeapMonitor = function (intervalSec = 30, thresholdMB = 10, windowMin = 5) {
  if (!performance.memory) { console.warn('[HeapMon] performance.memory not available (use Chrome with --enable-precise-memory-info)'); return; }
  const samples = [];
  setInterval(() => {
    const mb = performance.memory.usedJSHeapSize / 1048576;
    const now = Date.now();
    samples.push({ t: now, mb });
    // Prune samples older than the window
    const cutoff = now - windowMin * 60000;
    while (samples.length && samples[0].t < cutoff) samples.shift();
    if (samples.length >= 2) {
      const delta = mb - samples[0].mb;
      if (delta > thresholdMB) console.warn(`[HeapMon] ⚠ Heap grew ${delta.toFixed(1)} MB in ${windowMin} min (${mb.toFixed(1)} MB used)`);
    }
    console.log(`[HeapMon] ${mb.toFixed(1)} MB`);
  }, intervalSec * 1000);
  console.log(`[HeapMon] Started — sampling every ${intervalSec}s, alert on +${thresholdMB}MB/${windowMin}min`);
};
