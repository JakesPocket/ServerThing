// System UI Shell - Permanent Runtime for ServerThing
// Hardware-integrated version — resolution-independent (Car Thing / Tablet / Phone)

import { MessageType, InputType } from '/shared/protocol.js';

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
    baseFontSize = 16;                          // baseline — all rem authored against this
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

// ─── Config Manager ─────────────────────────────────────────────────────────
// Lightweight localStorage-backed state layer.  Single source of truth for app
// order, display-name overrides, and icon overrides.
class ConfigManager {
  static STORAGE_KEY = 'serverthing-shell-config';

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
        };
      }
    } catch (e) {
      console.warn('[ConfigManager] Failed to load — resetting', e);
    }
    return { appOrder: [], nameOverrides: {}, iconOverrides: {} };
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
    this.ws = null;
    this.deviceId = `shell-${Date.now()}`;
    this.iconManager = new IconManager();
    this.configManager = new ConfigManager();
    this.apps = [
      { id: 'counter', name: 'Counter', enabled: true },
      { id: 'makemkv-key', name: 'MakeMKV Manager', enabled: true }
    ];
    this.currentApp = { id: null, iframe: null, atRoot: true };
    this.interactionMode = 'dial';
    this.focusedAppIndex = 0;

    // Focus Zone: 'statusbar' | 'grid' | 'app'
    this.focusZone = 'grid';
    this.statusBarItems = [];  // populated in init()
    this.statusBarFocusIndex = 0;
    
    // Timer for Long Press
    this.backButtonTimer = null;
    this.isLongPress = false;

    this.elements = {
      statusBar: document.getElementById('status-bar'),
      sysNavButton: document.getElementById('sys-nav-button'),
      navIcon: document.getElementById('nav-icon'),
      statusTime: document.getElementById('status-time'),
      statusConnection: document.getElementById('status-connection'),
      homeScreen: document.getElementById('home-screen'),
      appGrid: document.getElementById('app-grid'),
      appContainer: document.getElementById('app-container'),
      loading: document.getElementById('loading'),
    };

    this.init();
  }

  init() {
    console.log('[Shell] Initializing Runtime');
    this.updateBodyDataset();
    this.statusBarItems = [this.elements.sysNavButton];
    this.startClock();
    this.addEventListeners();
    this.connectWebSocket();
    this.renderAppGrid();
    this.applyZoneFocus();
    window.focus();
  }

  // ─── WebSocket ──────────────────────────────────────────────────────────
  connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${location.host}/ws/device`;
    console.log(`[Shell] Connecting to ${url}`);

    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      console.log('[Shell] WebSocket connected');
      this.updateConnectionStatus(true);
    });

    this.ws.addEventListener('close', () => {
      console.log('[Shell] WebSocket disconnected — reconnecting in 3 s');
      this.updateConnectionStatus(false);
      setTimeout(() => this.connectWebSocket(), 3000);
    });

    this.ws.addEventListener('error', () => {
      this.updateConnectionStatus(false);
    });

    this.ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleServerMessage(msg);
      } catch { /* ignore non-JSON frames */ }
    });
  }

  updateConnectionStatus(connected) {
    this.elements.statusConnection.classList.toggle('connected', connected);
  }

  handleServerMessage(msg) {
    // Extensible: handle future server-pushed events here
    console.log('[Shell] Server message:', msg.type);
  }

  setInteractionMode(mode) {
    if (this.interactionMode === mode) return;
    this.interactionMode = mode;
    this.updateBodyDataset();
  }

  updateBodyDataset() {
    document.body.setAttribute('data-interaction-mode', this.interactionMode);
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
    window.addEventListener('message', (event) => this.handleIframeMessage(event));
  }

  handleHardwareInput(input) {
    this.setInteractionMode('dial');

    // Preset Shortcuts
    if (input.type === InputType.BUTTON) {
      const val = String(input.value).toLowerCase();
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
          this.applyZoneFocus();
        } else if (this.focusZone === 'app' && this.currentApp.atRoot) {
          // App is at top — pull focus up to status bar
          this.focusZone = 'statusbar';
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
        // Only one item in status bar for now; could expand later
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
        // Activate the focused status bar item
        this.handleBackButtonDown();
        setTimeout(() => this.handleBackButtonUp(), 60);
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
    // 'app' zone: focus lives inside the iframe — nothing to highlight in shell
  }

  handleBackButtonDown() {
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

  launchApp(appId) {
    this.showLoading(true);
    const iframe = document.createElement('iframe');
    iframe.src = `/apps/${appId}/index.html`;
    iframe.onload = () => this.showLoading(false);
    
    this.elements.appContainer.innerHTML = '';
    this.elements.appContainer.appendChild(iframe);
    this.currentApp = { id: appId, iframe, atRoot: true };
    
    this.elements.homeScreen.classList.remove('active');
    this.elements.appContainer.classList.add('active');

    // Show nav button — set focus zone to app
    this.elements.sysNavButton.classList.remove('hidden');
    this.focusZone = 'app';
    this.applyZoneFocus();
    this.updateNavIcon(true);
  }

  returnToHomeGrid() {
    this.elements.appContainer.innerHTML = '';
    this.currentApp = { id: null, iframe: null, atRoot: true };
    this.elements.appContainer.classList.remove('active');
    this.elements.homeScreen.classList.add('active');
    
    // Hide nav button on home screen, reset zone to grid
    this.elements.sysNavButton.classList.add('hidden');
    this.elements.sysNavButton.classList.remove('at-root', 'focused', 'muted');
    this.focusZone = 'grid';
    this.renderAppGrid();
  }

  renderAppGrid() {
    const enabledApps = this.apps.filter(app => app.enabled);
    const enabledIds  = enabledApps.map(a => a.id);

    // Sort apps according to ConfigManager's persisted order
    const orderedIds  = this.configManager.syncOrder(enabledIds);
    const appMap      = Object.fromEntries(enabledApps.map(a => [a.id, a]));
    const sortedApps  = orderedIds.map(id => appMap[id]).filter(Boolean);

    this.elements.appGrid.innerHTML = sortedApps.map((app, index) => {
      // Apply icon & name overrides from ConfigManager
      const iconOverrides = this.configManager.iconOverrides[app.id] || {};
      const icon = this.iconManager.getIcon(app.id, app, iconOverrides);
      const displayName = this.configManager.displayName(app);

      return `
        <div class="app-cell ${index === this.focusedAppIndex ? 'focused' : ''}" data-app-id="${app.id}">
          <div class="icon-wrapper" style="background:${icon.bg}; color:${icon.fg}">
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
      this.currentApp.iframe.contentWindow.postMessage(msg, '*');
    }
  }

  handleIframeMessage(event) {
    const { type, atRoot } = event.data || {};
    if (type === 'APP_NAV_STATE') {
      this.currentApp.atRoot = atRoot;
      this.updateNavIcon(atRoot);
    }
    // Bridge: app signals it's at its top — shell can catch the next "up" dial
    if (type === 'APP_AT_TOP') {
      this.currentApp.atRoot = true;
    }
  }

  /**
   * Swap the status-bar nav icon between home (apps) and back (arrow_back_ios_new).
   * Also toggles a dimmed appearance when the app is at its root level.
   */
  updateNavIcon(atRoot) {
    this.elements.navIcon.textContent = atRoot ? 'apps' : 'arrow_back_ios_new';
    this.elements.sysNavButton.classList.toggle('at-root', atRoot);
  }

  startClock() {
    const update = () => {
      const now = new Date();
      // Use 'numeric' to avoid leading zero on the hour
      this.elements.statusTime.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    };
    setInterval(update, 1000);
    update();
  }

  showLoading(show) {
    this.elements.loading.classList.toggle('hidden', !show);
  }
}

document.addEventListener('DOMContentLoaded', () => { window.shell = new ShellRuntime(); });