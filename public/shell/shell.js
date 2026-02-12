// System UI Shell - Permanent Runtime for ServerThing
// Hardware-integrated version for Spotify Car Thing (800x480)

import { MessageType, InputType } from '/shared/protocol.js';

// ─── Icon Manager ───────────────────────────────────────────────────────────
// Centralized icon resolution for apps. Uses Google Material Icons glyphs.
// Supports auto-mapping by app name and per-app metadata overrides.
class IconManager {
  constructor() {
    // Default icon mapping: lowercase keyword → Material Icon name
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
      'weather':    'wb_sunny',
      'home':       'home',
      'system':     'memory',
      'monitor':    'monitor_heart',
      'terminal':   'terminal',
      'notes':      'edit_note',
      'chat':       'chat',
      'map':        'map',
      'radio':      'radio',
    };

    // Default palette for auto-assigned backgrounds
    this.palette = [
      '#2d7d46', '#1565c0', '#c62828', '#6a1b9a',
      '#ef6c00', '#00838f', '#4e342e', '#37474f',
    ];
  }

  /**
   * Resolve icon properties for an app.
   * @param {object} app - { id, name, enabled, iconName?, backgroundColor?, glyphColor? }
   * @returns {{ glyph: string, bg: string, fg: string }}
   */
  resolve(app) {
    const glyph = app.iconName || this._autoGlyph(app);
    const bg    = app.backgroundColor || this._autoBg(app.id);
    const fg    = app.glyphColor || '#ffffff';
    return { glyph, bg, fg };
  }

  /** Auto-select a glyph by scanning app id/name against the keyword map. */
  _autoGlyph(app) {
    const haystack = `${app.id} ${app.name}`.toLowerCase();
    for (const [keyword, icon] of Object.entries(this.iconMap)) {
      if (haystack.includes(keyword)) return icon;
    }
    return 'apps'; // Fallback
  }

  /** Deterministic color from the palette based on app id hash. */
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
    this.apps = [
      { id: 'counter', name: 'Counter', enabled: true },
      { id: 'makemkv-key', name: 'MakeMKV Manager', enabled: true }
    ];
    this.currentApp = { id: null, iframe: null, atRoot: true };
    this.interactionMode = 'dial';
    this.focusedAppIndex = 0;
    
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
    this.startClock();
    this.addEventListeners();
    this.renderAppGrid();
    window.focus();
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

    if (!this.currentApp.id) {
      const enabledApps = this.apps.filter(app => app.enabled);
      if (input.type === InputType.DIAL) {
        if (input.value === 'right') this.focusedAppIndex = (this.focusedAppIndex + 1) % enabledApps.length;
        else if (input.value === 'left') this.focusedAppIndex = (this.focusedAppIndex - 1 + enabledApps.length) % enabledApps.length;
        this.renderAppGrid();
      } else if (input.value === 'dial_click_down') {
        const app = enabledApps[this.focusedAppIndex];
        if (app) this.launchApp(app.id);
      }
    } else {
      this.postMessageToApp({ type: 'HARDWARE_EVENT', data: input });
    }
  }

  handleBackButtonDown() {
    this.isLongPress = false;
    clearTimeout(this.backButtonTimer);
    
    // Start timer for 600ms (standard for "long press")
    this.backButtonTimer = setTimeout(() => {
      this.isLongPress = true;
      console.log('[Shell] Long Press detected: Returning Home');
      this.returnToHomeGrid();
    }, 600);
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

    // Show nav button — default icon depends on app root state
    this.elements.sysNavButton.classList.remove('hidden');
    this.updateNavIcon(true);
  }

  returnToHomeGrid() {
    this.elements.appContainer.innerHTML = '';
    this.currentApp = { id: null, iframe: null, atRoot: true };
    this.elements.appContainer.classList.remove('active');
    this.elements.homeScreen.classList.add('active');
    
    // Hide nav button on home screen
    this.elements.sysNavButton.classList.add('hidden');
    this.elements.sysNavButton.classList.remove('at-root');
    this.renderAppGrid();
  }

  renderAppGrid() {
    const enabledApps = this.apps.filter(app => app.enabled);
    this.elements.appGrid.innerHTML = enabledApps.map((app, index) => {
      const icon = this.iconManager.resolve(app);
      return `
        <div class="app-card ${index === this.focusedAppIndex ? 'focused' : ''}" data-app-id="${app.id}">
          <div class="app-icon" style="background:${icon.bg}; color:${icon.fg}">
            <span class="material-icons">${icon.glyph}</span>
          </div>
          <div class="app-card-name">${app.name}</div>
        </div>
      `;
    }).join('');

    // Re-attach event listeners for touch interaction
    this.elements.appGrid.querySelectorAll('.app-card').forEach(card => {
      card.addEventListener('pointerdown', (e) => {
        // Prevent interference with dial navigation
        e.stopPropagation(); 
        const appId = card.getAttribute('data-app-id');
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
    const { type, atRoot } = event.data;
    if (type === 'APP_NAV_STATE') {
      this.currentApp.atRoot = atRoot;
      this.updateNavIcon(atRoot);
    }
  }

  /**
   * Swap the status-bar nav icon between home (grid_view) and back (arrow_back_ios_new).
   * Also toggles a dimmed appearance when the app is at its root level.
   */
  updateNavIcon(atRoot) {
    this.elements.navIcon.textContent = atRoot ? 'grid_view' : 'arrow_back_ios_new';
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