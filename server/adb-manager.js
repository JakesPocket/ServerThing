const { exec } = require('child_process');
const os = require('os');

class ADBManager {
  constructor() {
    this.adbPath = 'adb'; // Assumes adb is in PATH
  }

  /**
   * Gets the local network IP address of this machine.
   */
  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  /**
   * Checks if ADB is available.
   */
  async checkADB() {
    return new Promise((resolve) => {
      exec(`${this.adbPath} version`, (error) => {
        resolve(!error);
      });
    });
  }

  /**
   * Lists connected devices.
   */
  async listDevices() {
    return new Promise((resolve, reject) => {
      exec(`${this.adbPath} devices`, (error, stdout) => {
        if (error) return reject(error);
        const lines = stdout.trim().split('\n');
        const devices = lines.slice(1)
          .map(line => line.split('\t'))
          .filter(parts => parts.length === 2 && parts[1] === 'device')
          .map(parts => parts[0]);
        resolve(devices);
      });
    });
  }

  /**
   * Configures a device to point to this server.
   * This is the "Plug and Play" magic.
   */
  async setupDevice(deviceId, serverPort) {
    const localIP = this.getLocalIP();
    const serverURL = `http://${localIP}:${serverPort}`;
    console.log(`Setting up device ${deviceId} to connect to ${serverURL}`);

    // Commands to point the Car Thing browser to our server
    // Note: These exact commands may vary based on the firmware used (Superbird-Debian, etc.)
    // For Superbird-Debian, we often update a config file or use 'am start'
    const commands = [
      // Example for a typical custom firmware:
      `shell "echo '${serverURL}' > /tmp/server_url"`,
      `shell "supervisorctl restart webapp"` // Force reload
    ];

    for (const cmd of commands) {
      await this.runCommand(cmd, deviceId);
    }

    return serverURL;
  }

  runCommand(command, deviceId) {
    return new Promise((resolve, reject) => {
      const fullCmd = `${this.adbPath} -s ${deviceId} ${command}`;
      exec(fullCmd, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim());
      });
    });
  }
}

module.exports = new ADBManager();
