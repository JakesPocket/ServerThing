// system-ui/shell.js
// Hybrid Icon System for ServerThing System UI

// Icon cache for dynamically loaded icons
const iconCache = new Map();

// Curated icons registry (loaded from curated.json)
let curatedIcons = {};

// SVG sprite element reference
let spriteElement = null;

/**
 * Initialize the icon system
 * Loads the sprite and curated icons list
 */
async function initIconSystem() {
  try {
    // Load curated icons list
    const curatedResponse = await fetch('/system-ui/icons/curated.json');
    curatedIcons = await curatedResponse.json();
    
    // Load and inject sprite.svg
    const spriteResponse = await fetch('/system-ui/icons/sprite.svg');
    const spriteText = await spriteResponse.text();
    
    // Create a container div for the sprite
    const spriteContainer = document.createElement('div');
    spriteContainer.innerHTML = spriteText;
    spriteElement = spriteContainer.querySelector('svg');
    
    if (spriteElement) {
      document.body.insertBefore(spriteElement, document.body.firstChild);
      console.log('[IconSystem] Sprite loaded successfully');
    }
  } catch (err) {
    console.error('[IconSystem] Failed to initialize icon system:', err);
  }
}

/**
 * Load an icon by name and style
 * @param {string} name - Icon name (e.g., "arrow_back_ios_new", "apps")
 * @param {string} style - Icon style (default: "outlined", also supports "filled", "rounded", "sharp")
 * @returns {Promise<string>} SVG string for the icon
 */
async function loadIcon(name, style = 'outlined') {
  // Check if icon is in curated set (local sprite)
  if (curatedIcons[name]) {
    // Return reference to sprite symbol
    return `<svg class="icon-sprite"><use href="#${name}"></use></svg>`;
  }
  
  // Check memory cache
  const cacheKey = `${name}_${style}`;
  if (iconCache.has(cacheKey)) {
    return iconCache.get(cacheKey);
  }
  
  // Fetch from server
  try {
    const response = await fetch(`/api/icons?name=${encodeURIComponent(name)}&style=${encodeURIComponent(style)}`);
    if (!response.ok) {
      console.warn(`[IconSystem] Icon not found: ${name} (${style})`);
      // Return a fallback icon
      return `<svg class="icon-sprite"><use href="#apps"></use></svg>`;
    }
    
    const svg = await response.text();
    iconCache.set(cacheKey, svg);
    return svg;
  } catch (err) {
    console.error(`[IconSystem] Failed to load icon ${name}:`, err);
    // Return fallback
    return `<svg class="icon-sprite"><use href="#apps"></use></svg>`;
  }
}

/**
 * Render an icon with custom styling
 * @param {Object} options - Icon rendering options
 * @param {string} options.name - Icon name
 * @param {string} [options.style='outlined'] - Icon style
 * @param {string} [options.color='#ffffff'] - Icon color
 * @param {string} [options.bg='#2a2a2a'] - Background color
 * @param {number} [options.size=48] - Icon size in pixels
 * @returns {Promise<HTMLElement>} Icon wrapper element
 */
async function renderIcon({
  name,
  style = 'outlined',
  color = '#ffffff',
  bg = '#2a2a2a',
  size = 48
}) {
  const iconSvg = await loadIcon(name, style);
  
  // Create wrapper element
  const wrapper = document.createElement('div');
  wrapper.className = 'icon-wrapper';
  wrapper.style.cssText = `
    width: ${size}px;
    height: ${size}px;
    background-color: ${bg};
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
  `;
  
  // Create inner container for the icon
  const iconContainer = document.createElement('div');
  iconContainer.className = 'icon-content';
  iconContainer.style.cssText = `
    width: ${size * 0.6}px;
    height: ${size * 0.6}px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${color};
  `;
  iconContainer.innerHTML = iconSvg;
  
  // Style the SVG
  const svgElement = iconContainer.querySelector('svg');
  if (svgElement) {
    svgElement.style.cssText = `
      width: 100%;
      height: 100%;
      fill: currentColor;
    `;
  }
  
  wrapper.appendChild(iconContainer);
  return wrapper;
}

/**
 * Create a navigation button with icon
 * @param {string} name - Icon name
 * @param {string} label - Accessible label
 * @param {Function} onClick - Click handler
 * @returns {Promise<HTMLButtonElement>}
 */
async function createNavButton(name, label, onClick) {
  const button = document.createElement('button');
  button.className = 'nav-button';
  button.setAttribute('aria-label', label);
  button.setAttribute('tabindex', '0');
  
  const icon = await renderIcon({
    name,
    style: 'outlined',
    color: '#ffffff',
    bg: '#2a2a2a',
    size: 60
  });
  
  button.appendChild(icon);
  
  if (onClick) {
    button.addEventListener('click', onClick);
  }
  
  return button;
}

// Status bar management
let statusBar = null;

/**
 * Initialize the status bar with navigation buttons
 */
async function initStatusBar() {
  statusBar = document.getElementById('status-bar');
  if (!statusBar) {
    console.warn('[Shell] Status bar element not found');
    return;
  }
  
  const navContainer = document.createElement('div');
  navContainer.className = 'nav-container';
  
  // Back button
  const backButton = await createNavButton('arrow_back_ios_new', 'Back', () => {
    window.history.back();
  });
  
  // Home button
  const homeButton = await createNavButton('apps', 'Home', () => {
    window.location.href = '/system-ui';
  });
  
  navContainer.appendChild(backButton);
  navContainer.appendChild(homeButton);
  statusBar.appendChild(navContainer);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    await initIconSystem();
    await initStatusBar();
  });
} else {
  initIconSystem().then(() => initStatusBar());
}

// Export functions for use in other modules
window.Shell = {
  loadIcon,
  renderIcon,
  createNavButton
};
