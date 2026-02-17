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
      const target = focusable[this.focusedIndex];
      if (target) target.click();
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
    this.elements.keysList.innerHTML = `<div class="key-item">Loading keys...</div>`;

    // 1. Fetch Local Key from our new backend endpoint
    let localKeyData;
    try {
      const response = await fetch('/api/makemkv-key/localkey');
      const responseText = await response.text(); // Get response as text first

      if (!response.ok) {
        // If the server returned an error, try to parse it as JSON, but fall back to raw text
        try {
          const errData = JSON.parse(responseText);
          throw new Error(errData.details || errData.error || `Server error: ${response.status}`);
        } catch (e) {
          // If the error response wasn't JSON, throw the raw text
          throw new Error(`Server returned non-JSON error: ${responseText}`);
        }
      }
      
      // If the response was ok, parse the text as JSON
      localKeyData = JSON.parse(responseText);
      localKeyData.btnText = "Update"; // Add button text

    } catch (error) {
      console.error('[MakeMkvApp] Error fetching local key:', error.message);
      localKeyData = {
        id: 'local',
        name: 'Local Config (ARM)',
        value: 'N/A',
        status: 'error',
        expiry: `Error: ${error.message}`, // Display the detailed error
        btnText: 'Retry'
      };
    }

    // 2. Define Internet Key (still placeholder for now)
    const forumExpiry = new Date('2026-03-31');
    const today = new Date();
    const isForumExpired = today > forumExpiry;
    
    const internetKeyData = { 
      "id": "internet",
      "name": "MakeMKV Forum (Internet)", 
      "value": "T-URt6MHxNy3HmfVojU8pE05WQ6HfgVI8S@HiIeNcWFim9rBgNlOdLFROSATCsWikcKW", 
      "status": isForumExpired ? "expired" : "valid",
      "expiry": "2026-03-31",
      "btnText": "Refresh"
    };
    
    // 3. Compare local key to internet key to determine status/expiry
    if (localKeyData && localKeyData.status !== 'error') {
      if (localKeyData.value === internetKeyData.value) {
        localKeyData.status = 'valid';
        localKeyData.expiry = internetKeyData.expiry; // Inherit expiry from the valid key
      } else {
        localKeyData.status = 'expired';
        localKeyData.expiry = 'Outdated';
      }
    }

    // 4. Combine and Render
    const keys = [internetKeyData, localKeyData];

    this.elements.keysList.innerHTML = keys.map(key => `
      <div class="key-item status-${key.status}">
        <div class="key-info">
          <span class="key-item-name">${key.name}</span>
          ${key.value && key.value !== 'N/A' ? `<span class="key-item-value">${key.value.substring(0, key.value.length / 2)}...</span>` : ''}
          <span class="key-expiry">Expires: ${key.expiry}</span>
        </div>
        <button class="key-action-btn" data-id="${key.id}" data-value="${key.value}">
          ${key.btnText}
        </button>
      </div>
    `).join('');

    // 4. Re-attach listeners and update focus
    this.elements.keysList.querySelectorAll('.key-action-btn').forEach(button => {
      button.addEventListener('click', (e) => this.handleActionClick(e));
    });
    this.updateFocus();
  }

  async handleActionClick(e) {
    const button = e.target;
    const actionId = button.dataset.id;

    if (actionId === 'internet') {
      // Action: Manual Refresh/Rescrape
      console.log('[MakeMkvApp] Requesting Rescrape...');
      button.textContent = 'Scanning...';
      // In the future: fetch('/api/rescrape')
      setTimeout(() => { button.textContent = 'Refreshed!'; }, 1500);
      
    } else if (actionId === 'local') {
      // Action: Overwrite Local Key with Internet Key
      console.log('[MakeMkvApp] Updating Local Key...');
      button.disabled = true;
      button.textContent = 'Updating...';

      // Find the internet key's value from the other button's data attribute
      const internetKeyBtn = this.elements.keysList.querySelector('.key-action-btn[data-id="internet"]');
      const newKey = internetKeyBtn ? internetKeyBtn.dataset.value : null;

      if (!newKey) {
        console.error('Could not find internet key value to update with.');
        button.textContent = 'Error!';
        button.disabled = false;
        return;
      }

      try {
        const response = await fetch('/api/makemkv-key/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newKey: newKey })
        });

        if (!response.ok) {
          const responseText = await response.text();
          try {
            const errData = JSON.parse(responseText);
            throw new Error(errData.details || errData.error);
          } catch (e) {
            throw new Error(`Server error: ${responseText}`);
          }
        }

        button.textContent = 'Updated!';
        // Refresh the list after a short delay to show the new status
        setTimeout(() => {
          this.fetchAndRenderKeys();
        }, 1000);

      } catch (error) {
        console.error('[MakeMkvApp] Update failed:', error.message);
        button.textContent = 'Failed!';
        
        // Display the specific error message in the UI for debugging
        const keyItem = button.closest('.key-item');
        if (keyItem) {
          const expirySpan = keyItem.querySelector('.key-expiry');
          if (expirySpan) {
            expirySpan.textContent = `Update Error: ${error.message}`;
            expirySpan.style.color = 'var(--error-color)';
          }
        }

        setTimeout(() => {
          button.disabled = false;
          button.textContent = 'Retry';
          // After timeout, maybe refresh to clear the error state
          this.fetchAndRenderKeys();
        }, 4000); // Longer timeout to allow reading the error
      }
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