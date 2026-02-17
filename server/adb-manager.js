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
      // 1. Ensure /usr/share/clientthing is writable on this boot.
      await this.ensureWritableClientThingPath(deviceId);

      // 2. Setup port reversal so device can hit localhost:serverPort
      await this.setupReverse(serverPort, deviceId);

      // 3. Push ClientThing runtime assets from CarThingRootDir staging.
      const path = require('path');
      const clientThingDir = path.join(__dirname, '..', 'CarThingRootDir', 'home', 'clientthing');
      const startupPath = path.join(clientThingDir, 'shell-bootstrap.html');
      const splashPath = path.join(clientThingDir, 'appstart.png');
      const bridgeJsPath = path.join(clientThingDir, 'input-bridge.js');
      const bridgeRunPath = path.join(clientThingDir, 'run-input-bridge.sh');
      const bridgeSupervisorConfPath = path.join(__dirname, '..', 'CarThingRootDir', 'etc', 'supervisor.d', 'clientthing.conf');

      // 4. Push all provisioned files to /usr/share/clientthing.
      await this.runCommand('shell "mkdir -p /usr/share/clientthing"', deviceId);
      await this.runCommand(`push "${startupPath}" /usr/share/clientthing/shell-bootstrap.html`, deviceId);
      await this.runCommand(`push "${splashPath}" /usr/share/clientthing/appstart.png`, deviceId);
      await this.runCommand(`push "${bridgeJsPath}" /usr/share/clientthing/input-bridge.js`, deviceId);
      await this.runCommand(`push "${bridgeRunPath}" /usr/share/clientthing/run-input-bridge.sh`, deviceId);
      await this.runCommand('shell "chmod +x /usr/share/clientthing/run-input-bridge.sh"', deviceId);
      // Best-effort: install supervisor program for persistent bridge lifecycle.
      await this.tryRunCommand('shell "mkdir -p /etc/supervisor.d"', deviceId);
      await this.tryRunCommand(`push "${bridgeSupervisorConfPath}" /etc/supervisor.d/clientthing.conf`, deviceId);

      // 5. Mirror startup entrypoint assets into stock paths used by Chromium/Weston.
      await this.runCommand('shell "cp /usr/share/clientthing/shell-bootstrap.html /usr/share/qt-superbird-app/webapp/index.html"', deviceId);
      await this.runCommand('shell "cp /usr/share/clientthing/appstart.png /usr/share/qt-superbird-app/webapp/images/appstart.png"', deviceId);

      // 6. Verify files landed on device
      await this.runCommand('shell "test -f /usr/share/qt-superbird-app/webapp/index.html"', deviceId);
      await this.runCommand('shell "test -f /usr/share/qt-superbird-app/webapp/images/appstart.png"', deviceId);
      await this.runCommand('shell "test -f /usr/share/clientthing/shell-bootstrap.html"', deviceId);
      await this.runCommand('shell "test -f /usr/share/clientthing/appstart.png"', deviceId);
      await this.runCommand('shell "test -f /usr/share/clientthing/input-bridge.js"', deviceId);
      await this.runCommand('shell "test -f /usr/share/clientthing/run-input-bridge.sh"', deviceId);

      // 7. Restart input bridge process (stop legacy python + prior node workers).
      await this.runCommand('shell "pkill -f input-bridge.py || true"', deviceId).catch(() => {});
      await this.runCommand('shell "pkill -f /tmp/input-bridge.js || true"', deviceId).catch(() => {});
      await this.runCommand('shell "pkill -f /home/clientthing/input-bridge.js || true"', deviceId).catch(() => {});
      await this.runCommand('shell "pkill -f /usr/share/clientthing/input-bridge.js || true"', deviceId).catch(() => {});
      await this.runCommand('shell "pkill -f /tmp/run-input-bridge.sh || true"', deviceId).catch(() => {});
      await this.runCommand('shell "pkill -f run-input-bridge.sh || true"', deviceId).catch(() => {});

      // Prefer supervised daemon lifecycle; fallback to nohup when supervisor config is unavailable.
      let bridgeStartedBySupervisor = false;
      try {
        await this.runCommand('shell "supervisorctl reread || true"', deviceId);
        await this.runCommand('shell "supervisorctl update || true"', deviceId);
        await this.runCommand('shell "supervisorctl restart clientthing"', deviceId);
        bridgeStartedBySupervisor = true;
      } catch (e) {
        console.warn(`[ADB] Supervisor-managed bridge start failed on ${deviceId}:`, e.message);
      }
      if (!bridgeStartedBySupervisor) {
        await this.runCommand('shell "nohup /usr/share/clientthing/run-input-bridge.sh >/usr/share/clientthing/input-bridge-supervisor.log 2>&1 &"', deviceId).catch(() => {});
      }

      // 8. Kill the stock Spotify app to free up CPU/Memory
      await this.runCommand('shell "supervisorctl stop superbird"', deviceId).catch(() => {});
      await this.runCommand('shell "pkill -x qt-superbird-app || true"', deviceId).catch(() => {});

      // 9. Clear Chrome cache to prevent stale redirect or white screens
      await this.runCommand('shell "rm -rf /var/cache/chrome_storage/*"', deviceId).catch(() => {});

      // 10. Restart Chromium
      await this.runCommand('shell "supervisorctl restart chromium"', deviceId);

      // 11. Re-assert that stock app stays down after Chromium restart
      await this.runCommand('shell "supervisorctl stop superbird || true"', deviceId).catch(() => {});
      await this.runCommand('shell "pkill -x qt-superbird-app || true"', deviceId).catch(() => {});

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

  async setAutoDim(enabled, deviceId) {
    const action = enabled ? 'start' : 'stop';
    console.log(`[ADB] Setting auto-dim to ${enabled ? 'ON' : 'OFF'} on ${deviceId}`);
    // The sp-als-backlight daemon is managed by supervisord as "backlight".
    await this.runCommand(`shell "supervisorctl ${action} backlight || true"`, deviceId).catch(() => {});
    if (!enabled) {
      // Ensure the ALS daemon isn't still running.
      await this.runCommand('shell "pkill -x sp-als-backlight || true"', deviceId).catch(() => {});
    }
  }

  async restartChromium(deviceId) {
    console.log(`[ADB] Restarting chromium on ${deviceId}`);
    return this.runCommand('shell "supervisorctl restart chromium"', deviceId);
  }

  async rebootDevice(deviceId) {
    console.log(`[ADB] Rebooting device ${deviceId}`);
    return this.runCommand('shell "reboot"', deviceId);
  }

  async repairClientThing(deviceId) {
    console.log(`[ADB] Repairing ClientThing runtime on ${deviceId}`);
    await this.ensureWritableClientThingPath(deviceId);

    // Re-copy known-good startup assets to stock paths used by boot flow.
    await this.runCommand('shell "cp /usr/share/clientthing/shell-bootstrap.html /usr/share/qt-superbird-app/webapp/index.html"', deviceId);
    await this.runCommand('shell "cp /usr/share/clientthing/appstart.png /usr/share/qt-superbird-app/webapp/images/appstart.png"', deviceId);
    // Re-apply supervisor config if present and restart bridge/runtime.
    await this.runCommand('shell "supervisorctl reread || true"', deviceId).catch(() => {});
    await this.runCommand('shell "supervisorctl update || true"', deviceId).catch(() => {});
    await this.runCommand('shell "supervisorctl restart clientthing || true"', deviceId).catch(() => {});
    await this.runCommand('shell "supervisorctl restart chromium"', deviceId);
  }

  /**
   * Checks whether the device has the expected ServerThing provisioning files.
   */
  async verifyProvisioning(deviceId) {
    try {
      await this.runCommand('shell "test -f /usr/share/qt-superbird-app/webapp/index.html"', deviceId);
      await this.runCommand('shell "test -f /usr/share/qt-superbird-app/webapp/images/appstart.png"', deviceId);
      // Marker from redirect.html to ensure stock page is replaced.
      await this.runCommand('shell "grep -q ServerThing /usr/share/qt-superbird-app/webapp/index.html"', deviceId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Continuously suppress the stock SuperbBird app process when present.
   */
  async suppressStockApp(deviceId) {
    await this.runCommand('shell "supervisorctl stop superbird || true"', deviceId).catch(() => {});
    await this.runCommand('shell "pkill -x qt-superbird-app || true"', deviceId).catch(() => {});
  }

  async ensureWritableClientThingPath(deviceId) {
    // Repair-only: best-effort escalation and remount before writing to /usr/share/clientthing.
    await this.tryRunCommand('root', deviceId);
    await this.tryRunCommand('wait-for-device', deviceId);

    // This is the most reliable command observed on your device for making /usr writable.
    await this.tryRunCommand('shell "mount -o remount,rw /"', deviceId);

    // Keep additional attempts as fallback for firmware differences.
    const remountAttempts = [
      'remount',
      'shell "mount -o remount,rw /usr"',
      'shell "su -c \'mount -o remount,rw /\'"',
      'shell "su -c \'mount -o remount,rw /usr\'"',
    ];
    for (const cmd of remountAttempts) {
      await this.tryRunCommand(cmd, deviceId);
    }

    // Ensure target directory exists with sane permissions before writing files.
    await this.tryRunCommand('shell "mkdir -p /usr/share/clientthing"', deviceId);
    await this.tryRunCommand('shell "chown root:root /usr/share/clientthing && chmod 755 /usr/share/clientthing"', deviceId);

    // Validate writability with a real write in target dir.
    const writeProbe = 'shell "sh -c \'echo st > /usr/share/clientthing/.st_write_test && rm -f /usr/share/clientthing/.st_write_test\'"';
    const canWrite = await this.tryRunCommand(writeProbe, deviceId);
    if (canWrite) return;

    const mounts = await this.runCommand('shell "cat /proc/mounts | grep -E \' / | /usr \' || true"', deviceId).catch(() => '');
    throw new Error(
      `Filesystem remains read-only at /usr/share/clientthing. ` +
      `Device likely booted with locked rootfs. Mounts: ${mounts || 'unavailable'}`
    );
  }

  async tryRunCommand(command, deviceId) {
    try {
      await this.runCommand(command, deviceId);
      return true;
    } catch {
      return false;
    }
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
