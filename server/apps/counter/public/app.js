// Counter App - Refit for Shell Communication Bridge

class CounterApp {
  constructor() {
    this.count = 0;
    this.elements = {
      // FIX: Matches the ID in your HTML exactly
      countDisplay: document.getElementById('counter-value'),
    };
    this.init();
  }

  init() {
    console.log('[CounterApp] Initializing');
    this.render();
    this.addEventListeners();
    // Inform the shell that we are at the root view
    this.sendNavState(true);
  }

  addEventListeners() {
    window.addEventListener('message', (event) => {
      this.handleShellMessage(event);
    });
  }

  handleShellMessage(event) {
    if (event.source !== window.parent) return;

    const message = event.data;
    console.log('[CounterApp] Message received:', message);

    // FIX: Access message.data (the input object) sent by shell.js
    if (message.type === 'HARDWARE_EVENT' && message.data) {
      this.handleHardwareInput(message.data); 
    }
  }

  handleHardwareInput(input) {
    if (!input || !input.type || !input.value) return;
    
    // Normalize to handle case sensitivity once and for all
    const type = input.type.toUpperCase();
    const value = input.value.toUpperCase();

    if (type === 'DIAL') {
      if (value === 'RIGHT') {
        this.count++;
      } else if (value === 'LEFT') {
        this.count--;
      }
    } else if (type === 'BUTTON' && value === 'DIAL_CLICK_DOWN') {
      this.count = 0;
    }
    this.render();
  }

  render() {
    // FIX: Guard against null elements to prevent script crashes
    if (this.elements.countDisplay) {
      this.elements.countDisplay.textContent = this.count;
      
      // Fun visual flair: add a temporary class for the "pop" effect
      this.elements.countDisplay.classList.add('changed');
      setTimeout(() => this.elements.countDisplay.classList.remove('changed'), 200);
    }
  }

  sendNavState(isAtRoot) {
    window.parent.postMessage({ type: 'APP_NAV_STATE', atRoot: isAtRoot }, '*');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new CounterApp();
});