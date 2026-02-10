// public/ui/components/apps.js

const API_BASE = '';

async function loadApps() {
  try {
    const response = await fetch(`${API_BASE}/api/apps`);
    const apps = await response.json();
    
    const appsDiv = document.getElementById('apps');
    if (apps.length === 0) {
      appsDiv.innerHTML = '<p class="loading">No apps installed</p>';
      return;
    }
    
    appsDiv.innerHTML = apps.map(app => `
      <div class="app-card">
        <h3>${app.name}</h3>
        <p>${app.description}</p>
        <p>Status: <span class="status ${app.enabled ? 'enabled' : 'disabled'}">${app.enabled ? 'Enabled' : 'Disabled'}</span></p>
        <button class="btn btn-small ${app.enabled ? 'btn-danger' : 'btn-success'}" 
                onclick="toggleApp('${app.id}', ${app.enabled})">
          ${app.enabled ? 'Disable' : 'Enable'}
        </button>
        ${app.hasPublicUI 
          ? `<a href="/apps/${app.id}/" target="_blank" rel="noopener noreferrer" class="btn btn-small btn-secondary">View UI</a>` 
          : ''
        }
      </div>
    `).join('');
  } catch (err)
 {
    console.error('Error loading apps:', err);
    document.getElementById('apps').innerHTML = '<p style="color: red;">Error loading apps</p>';
  }
}

async function toggleApp(appId, currentlyEnabled) {
  try {
    const action = currentlyEnabled ? 'disable' : 'enable';
    const response = await fetch(`${API_BASE}/api/apps/${appId}/${action}`, {
      method: 'POST'
    });
    const result = await response.json();
    
    if (!result.success) {
      alert(`Failed to ${action} app: ${result.message}`);
    }
    // The UI will be updated via WebSocket broadcast, no need to call loadApps() here
  } catch (err) {
    console.error('Error toggling app:', err);
    alert('Error toggling app');
  }
}

// Expose functions to the global scope so inline onclick handlers can find them
window.toggleApp = toggleApp;

export { loadApps };
