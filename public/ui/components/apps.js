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

export { loadApps, initAppInstaller };

function initAppInstaller() {
  const form = document.getElementById('app-upload-form');
  const input = document.getElementById('app-zip-input');
  const statusDiv = document.getElementById('upload-status');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const file = input.files[0];
    if (!file) {
      statusDiv.textContent = 'Please select a file to upload.';
      statusDiv.className = 'status-error';
      return;
    }

    const formData = new FormData();
    formData.append('app-zip', file);

    statusDiv.textContent = 'Uploading and installing...';
    statusDiv.className = 'status-loading';

    try {
      const response = await fetch(`${API_BASE}/api/apps/install`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        statusDiv.textContent = result.message;
        statusDiv.className = 'status-success';
        form.reset();
        // The server will restart via nodemon, and the WebSocket will
        // trigger a reload of the app list.
      } else {
        throw new Error(result.message || 'Installation failed.');
      }
    } catch (err) {
      statusDiv.textContent = `Error: ${err.message}`;
      statusDiv.className = 'status-error';
      console.error('Error installing app:', err);
    }
  });
}

