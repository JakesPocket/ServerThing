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
    console.log(`[ADB] Provisioning device ${deviceId}...`);

    try {
      // 1. Setup port reversal so device can hit localhost:serverPort
      await this.setupReverse(serverPort, deviceId);

      // 2. Remount root as RW
      await this.runCommand('shell "mount -o remount,rw /"', deviceId);

      // 3. Push the redirector to the stock app path
      const path = require('path');
      const redirectPath = path.join(__dirname, '..', 'redirect_v3.html');
      await this.runCommand(`push "${redirectPath}" /usr/share/qt-superbird-app/webapp/index.html`, deviceId);

      // 4. Kill the stock Spotify app to free up CPU/Memory
      await this.runCommand('shell "supervisorctl stop superbird"', deviceId).catch(() => {});

      // 5. Clear Chrome cache to prevent stale redirect or white screens
      await this.runCommand('shell "rm -rf /var/cache/chrome_storage/*"', deviceId).catch(() => {});

      // 6. Restart Chromium
      await this.runCommand('shell "supervisorctl restart chromium"', deviceId);

      console.log(`[ADB] Device ${deviceId} provisioned successfully.`);
      return `http://127.0.0.1:${serverPort}`;
    } catch (err) {
      console.error(`[ADB] Provisioning failed for ${deviceId}:`, err.message);
      throw err;
    }
  }

  /**
   * Sets the screen brightness.
   * Note: On some firmwares, values are 1-255. 0 can turn off the backlight.
   */
  /**
   * Sets up a reverse bridge for a port.
   */
  async setupReverse(port, deviceId) {
    console.log(`[ADB] Setting up reverse bridge for port ${port} on ${deviceId}`);
    return this.runCommand(`reverse tcp:${port} tcp:${port}`, deviceId);
  }

  async setBrightness(level, deviceId) {
    console.log(`[ADB] Setting brightness to ${level} on ${deviceId}`);
    return this.runCommand(`shell "echo ${level} > /sys/class/backlight/aml-bl/brightness"`, deviceId);
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
