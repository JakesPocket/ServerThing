// MakeMKV Key App - Refit for Shell Communication Bridge

// Production Build
import { InputType } from '/shared/protocol.js';

class MakeMkvApp {
  constructor() {
    this.elements = {
      mainScreen: document.getElementById('main-screen'),
      settingsScreen: document.getElementById('settings-screen'),
      keysList: document.getElementById('keys-list'),
      settingsButton: document.getElementById('settings-button'),
      backButton: document.getElementById('back-button'),
    };
    this.focusedIndex = 0;
    this.isSettingsVisible = false;
    this.init();
  }

  init() {
    console.log('[MakeMkvApp] Initializing');
    this.fetchAndRenderKeys();
    this.addEventListeners();
    // Inform the shell that we are at the root view
    this.sendNavState(true);
  }

  addEventListeners() {
    window.addEventListener('message', (event) => this.handleShellMessage(event));
    
    // UI Click Handlers
    this.elements.settingsButton.addEventListener('click', () => this.showSettings());
    this.elements.backButton.addEventListener('click', () => this.showMain());
  }

  handleShellMessage(event) {
    if (event.source !== window.parent) return;

    const message = event.data;
    console.log('[MakeMkvApp] Message received:', message);

    if (message.type === 'HARDWARE_EVENT' && message.data) {
      this.handleHardwareInput(message.data);
    } else if (message.type === 'CMD_BACK') {
      this.handleBackCommand();
    } else if (message.type === 'DIM_APP_FOCUS') {
      // Shell moved focus away — dim our highlights
      this.getFocusableElements().forEach(el => el.classList.remove('focused'));
    } else if (message.type === 'ZONE_FOCUS' && message.active) {
      // Shell returned focus to us — re-apply highlight
      this.updateFocus();
    }
  }

  handleHardwareInput(input) {
    if (!input) return;

    // Normalize input for OS-level consistency
    const type = String(input.type).toUpperCase();
    const value = String(input.value).toUpperCase();

    // 1. Context: Settings Screen
    if (this.isSettingsVisible) {
      if (type === 'BUTTON' && (value === 'DIAL_CLICK_DOWN' || value === 'BACK_BUTTON_DOWN')) {
        this.showMain();
      }
      return;
    }

    // 2. Context: Main Screen Navigation
    const focusable = this.getFocusableElements();
    if (type === 'DIAL') {
      if (value === 'RIGHT') {
        this.focusedIndex = (this.focusedIndex + 1) % focusable.length;
      } else if (value === 'LEFT') {
        if (this.focusedIndex > 0) {
          this.focusedIndex--;
        } else {
          // At first item — escape to Shell status bar
          window.parent.postMessage({ type: 'APP_AT_TOP' }, location.origin);
          return;
        }
      }
      this.updateFocus();
    } else if (type === 'BUTTON' && value === 'DIAL_CLICK_DOWN') {
      focusable[this.focusedIndex]?.click();
    }
  }

  handleBackCommand() {
    // If shell sends CMD_BACK while we are in settings, close settings
    if (this.isSettingsVisible) {
      this.showMain();
    }
  }

  getFocusableElements() {
    return [
      ...this.elements.keysList.querySelectorAll('.key-action-btn'),
      this.elements.settingsButton
    ];
  }

  updateFocus() {
    const focusable = this.getFocusableElements();
    focusable.forEach((el, index) => {
      el.classList.toggle('focused', index === this.focusedIndex);
    });
  }

  showSettings() {
    this.isSettingsVisible = true;
    this.elements.mainScreen.classList.remove('active');
    this.elements.settingsScreen.classList.add('active');
    this.sendNavState(false); // No longer at root
  }

  showMain() {
    this.isSettingsVisible = false;
    this.elements.settingsScreen.classList.remove('active');
    this.elements.mainScreen.classList.add('active');
    this.sendNavState(true); // Back at root
    this.updateFocus();
  }

  async fetchAndRenderKeys() {
    // 1. Setup the Forum Data (Internet)
    const forumExpiry = new Date('2026-03-31');
    const today = new Date();
    const isForumExpired = today > forumExpiry;

    // 2. Setup the Local Data (ARM)
    const localKey = "T-OLD_KEY_IN_YOUR_SETTINGS_FILE"; 
    const localExpiry = new Date('2026-01-31');
    const isLocalExpired = today > localExpiry;

    const data = {
      "keys": [
        { 
          "id": "internet",
          "name": "MakeMKV Forum (Internet)", 
          "value": "T-URt6MHxNy3HmfVojU8pE05WQ6HfgVI8S@HiIeNcWFim9rBgNlOdLFROSATCsWikcKW", 
          "status": isForumExpired ? "expired" : "valid",
          "expiry": "2026-03-31",
          "btnText": "Refresh"
        },
        { 
          "id": "local",
          "name": "Local Config (ARM)", 
          "value": localKey, 
          "status": isLocalExpired ? "expired" : "valid",
          "expiry": "2026-01-31",
          "btnText": "Update"
        }
      ]
    };

    this.elements.keysList.innerHTML = data.keys.map(key => `
      <div class="key-item status-${key.status}">
        <div class="key-info">
          <span class="key-item-name">${key.name}</span>
          <span class="key-expiry">Expires: ${key.expiry}</span>
        </div>
        <button class="key-action-btn" data-id="${key.id}" data-value="${key.value}">
          ${key.btnText}
        </button>
      </div>
    `).join('');

    // Re-attach listeners with new logic
    this.elements.keysList.querySelectorAll('.key-action-btn').forEach(button => {
      button.addEventListener('click', (e) => this.handleActionClick(e));
    });

    this.updateFocus();
  }

  handleActionClick(e) {
    const actionId = e.target.dataset.id;
    const value = e.target.dataset.value;

    if (actionId === 'internet') {
      // Action: Manual Refresh/Rescrape
      console.log('[MakeMkvApp] Requesting Rescrape...');
      e.target.textContent = 'Scanning...';
      // In the future: fetch('/api/rescrape')
      setTimeout(() => { e.target.textContent = 'Refreshed!'; }, 1500);
      
    } else if (actionId === 'local') {
      // Action: Overwrite Local Key with Internet Key
      console.log('[MakeMkvApp] Overwriting Local Key with Internet Key...');
      e.target.textContent = 'Updating...';
      
      // We grab the Internet key value from the data
      const internetKey = "T-URt6MHxNy3HmfVojU8pE05WQ6HfgVI8S@HiIeNcWFim9rBgNlOdLFROSATCsWikcKW";
      
      // Post to your server to update the file
      // window.parent.postMessage({ type: 'CMD_UPDATE_LOCAL_KEY', value: internetKey }, '*');
      
      setTimeout(() => { 
        e.target.textContent = 'Updated!'; 
        this.fetchAndRenderKeys(); // Refresh the list to show new status
      }, 1500);
    }
  }

  sendNavState(isAtRoot) {
    window.parent.postMessage({
      type: 'APP_NAV_STATE',
      atRoot: isAtRoot
    }, location.origin);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new MakeMkvApp();
});