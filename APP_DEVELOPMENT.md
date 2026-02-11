# App Development Guide

This guide explains how to create and install custom apps for ServerThing.

## App Structure

An app is a directory inside `server/apps/`. The directory name is the app's unique ID.

A valid app must have the following structure:

```
my-cool-app/
├── index.js        (Required)
└── public/           (Optional)
    ├── index.html
    ├── style.css
    └── script.js
```

### `index.js` (Required)

This is the main entry point for your app's server-side logic. It must be a CommonJS module that exports an object with the following properties:

- **`metadata`** (object, required): Contains information about your app.
  - `name` (string, required): The display name of your app.
  - `description` (string): A short description.
  - `version` (string): The app's version number.

- **`handleInput(deviceId, input)`** (function, required): This function is called every time a device sends an input event and your app is enabled.
  - `deviceId` (string): The ID of the device that sent the input.
  - `input` (object): The input data from the device.
  - **Return Value**: Your function can return a data payload (object, string, etc.) which will be sent back to the device in a message of type `app-response`. If you return `null` or `undefined`, no message is sent.

**Example `index.js`:**
```javascript
const { InputType, ButtonValue } = require('../../shared/protocol.js');

module.exports = {
  metadata: {
    name: 'My Cool App',
    description: 'A very cool app.',
    version: '1.0.0'
  },

  handleInput(deviceId, input) {
    if (input.type === InputType.BUTTON && input.value === ButtonValue.PRESET_1) {
      console.log(`Device ${deviceId} pressed Preset 1 in My Cool App!`);
      // Send a message back to the device
      return { message: 'Hello from My Cool App!' };
    }
    return null;
  }
};
```

### `public/` (Optional)

If your app has a web interface, you can place all its static files (HTML, CSS, JavaScript) in a directory named `public`.

The server will automatically detect this directory and serve its contents at the URL `/apps/<your-app-id>/`. For an app named `my-cool-app`, its UI would be accessible at `http://localhost:3000/apps/my-cool-app/`.

## Installation

1.  **Package Your App**: Create a ZIP archive of your app's directory (e.g., `my-cool-app.zip` containing the `my-cool-app/` folder).
2.  **Open the Control Panel**: Navigate to the ServerThing control panel in your browser (usually `http://localhost:3000/ui`).
3.  **Upload**: In the "Install New App" section, select your ZIP file and click "Upload and Install".
4.  **Restart**: The server will automatically restart via `nodemon` to load the new app. The control panel will refresh, and you should see your new app in the "Installed Apps" list.

> **SECURITY WARNING**
> The app installer executes code from the uploaded ZIP file directly on the server. This is a significant security risk. **Only install apps from developers you know and trust.** A malicious app could compromise your server and the machine it is running on.

