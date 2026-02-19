#!/usr/bin/env node
/**
 * Hardened Inputd for Car Thing / SuperbBird
 *
 * - Auto-discovers button + dial event devices from /proc/bus/input/devices
 * - Reads raw numeric getevent output (stable across localized labels)
 * - Sends normalized input events to ServerThing via HTTP POST /api/input
 * - Uses bounded queue + retry backoff to handle transient server outages
 * - Has no third-party runtime dependency (runs with plain Node)
 */

const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const CFG = {
  serverUrl: process.env.BRIDGE_SERVER_URL || 'http://127.0.0.1:3000',
  deviceId: process.env.BRIDGE_DEVICE_ID || 'inputd',
  maxQueue: Number(process.env.BRIDGE_MAX_QUEUE || 256),
  maxBatchSize: Number(process.env.BRIDGE_MAX_BATCH_SIZE || 16),
  maxDialStep: Number(process.env.BRIDGE_MAX_DIAL_STEP || 6),
  dialReleaseMs: Number(process.env.BRIDGE_DIAL_RELEASE_MS || 12),
  monitorRestartMs: Number(process.env.BRIDGE_MONITOR_RESTART_MS || 800),
  rediscoverMs: Number(process.env.BRIDGE_REDISCOVER_MS || 1500),
  flushIntervalMs: Number(process.env.BRIDGE_FLUSH_INTERVAL_MS || 16),
  healthIntervalMs: Number(process.env.BRIDGE_HEALTH_INTERVAL_MS || 10000),
  requestTimeoutMs: Number(process.env.BRIDGE_REQUEST_TIMEOUT_MS || 1000),
  retryBaseMs: Number(process.env.BRIDGE_RETRY_BASE_MS || 200),
  retryMaxMs: Number(process.env.BRIDGE_RETRY_MAX_MS || 2000),
  fallbackButtons: process.env.BRIDGE_BUTTONS_EVENT || '/dev/input/event0',
  fallbackDial: process.env.BRIDGE_DIAL_EVENT || '/dev/input/event1',
};

const SERVER = new URL(CFG.serverUrl);
const AGENT = new http.Agent({ keepAlive: true, maxSockets: 1 });

// Shell virtual codes expected by public/shell/shell.js
const VKEY = {
  KEY_BACK: 158,
  KEY_ENTER: 28,
  KEY_LEFT: 105,
  KEY_RIGHT: 106,
  KEY_MENU: 139,
  KEY_SETUP: 141,
  KEY_CONFIG: 171,
  BTN_0: 256,
  BTN_1: 257,
  BTN_2: 258,
  BTN_3: 259,
};

// Raw Linux input event constants/codes from getevent
const EV_KEY = 0x0001;
const EV_REL = 0x0002;
const REL_CODES_DIAL = new Set([0x0006, 0x0007]);

const KEY_MAP = new Map([
  [1, VKEY.KEY_BACK],
  [2, VKEY.BTN_0],
  [3, VKEY.BTN_1],
  [4, VKEY.BTN_2],
  [5, VKEY.BTN_3],
  [28, VKEY.KEY_ENTER],
  [139, VKEY.KEY_MENU],
  [141, VKEY.KEY_SETUP],
  [171, VKEY.KEY_CONFIG],
]);

class InputBridge {
  constructor() {
    this.queue = [];
    this.flushTimer = null;
    this.healthTimer = null;
    this.retryTimer = null;
    this.retryDelayMs = CFG.retryBaseMs;
    this.flushing = false;
    this.seq = 0;

    this.monitors = new Map();

    // suppress repeated state spam
    this.lastPressedState = new Map();
    this.unknownKeyLogAt = new Map();
    this.stats = {
      queued: 0,
      sent: 0,
      dropped: 0,
      retries: 0,
      sendFailures: 0,
      lastError: '',
      monitorRestarts: 0,
      lastQueueSize: 0,
    };

    this.onSignal = this.shutdown.bind(this);
  }

  log(...args) {
    console.log('[InputBridge]', ...args);
  }

  warn(...args) {
    console.warn('[InputBridge]', ...args);
  }

  err(...args) {
    console.error('[InputBridge]', ...args);
  }

  start() {
    this.log('Starting hardened input bridge');
    this.log('Server:', CFG.serverUrl);
    this.log(
      `Config: queue=${CFG.maxQueue} batch=${CFG.maxBatchSize} ` +
      `dialMaxStep=${CFG.maxDialStep} flush=${CFG.flushIntervalMs}ms`
    );

    this.discoverAndStartMonitors();
    this.flushTimer = setInterval(() => this.flushQueue(), CFG.flushIntervalMs);
    this.healthTimer = setInterval(() => this.sendHealth(), CFG.healthIntervalMs);

    process.on('SIGINT', this.onSignal);
    process.on('SIGTERM', this.onSignal);
  }

  shutdown() {
    this.log('Shutting down');

    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);

    for (const [, child] of this.monitors.entries()) {
      try { child.kill('SIGTERM'); } catch {}
    }
    this.monitors.clear();

    AGENT.destroy();
    process.exit(0);
  }

  scheduleRetry() {
    if (this.retryTimer) return;

    const jitter = Math.floor(Math.random() * 80);
    const delay = Math.min(CFG.retryMaxMs, this.retryDelayMs) + jitter;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.flushQueue();
    }, delay);

    this.retryDelayMs = Math.min(CFG.retryMaxMs, this.retryDelayMs * 2);
    this.stats.retries += 1;
  }

  enqueueEvent(keyCode, isPressed) {
    const evt = {
      deviceId: CFG.deviceId,
      keyCode,
      isPressed,
      seq: ++this.seq,
      ts: Date.now(),
    };

    if (this.queue.length >= CFG.maxQueue) {
      this.queue.shift();
      this.stats.dropped += 1;
    }
    this.queue.push(evt);
    this.stats.queued += 1;
    this.stats.lastQueueSize = this.queue.length;
  }

  sendInput(keyCode, isPressed) {
    const last = this.lastPressedState.get(keyCode);
    if (last === isPressed) return;
    this.lastPressedState.set(keyCode, isPressed);

    this.enqueueEvent(keyCode, isPressed);
  }

  sendDialPulse(keyCode) {
    this.sendInput(keyCode, true);
    setTimeout(() => this.sendInput(keyCode, false), CFG.dialReleaseMs);
  }

  flushQueue() {
    if (this.flushing) return;
    if (this.queue.length === 0) return;

    this.flushing = true;
    const batchSize = Math.max(1, Math.min(CFG.maxBatchSize, this.queue.length));
    const batch = this.queue.slice(0, batchSize);

    this.postInputBatch(batch)
      .then(() => {
        this.queue.splice(0, batch.length);
        this.stats.sent += batch.length;
        this.stats.lastQueueSize = this.queue.length;
        this.retryDelayMs = CFG.retryBaseMs;
      })
      .catch((e) => {
        this.stats.sendFailures += 1;
        this.stats.lastError = e.message;
        this.warn(`Send failed (${e.message}), queue=${this.queue.length}, batch=${batch.length}`);
        this.scheduleRetry();
      })
      .finally(() => {
        this.flushing = false;
      });
  }

  postInputBatch(events) {
    const body = JSON.stringify({
      deviceId: CFG.deviceId,
      events,
    });

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          protocol: SERVER.protocol,
          hostname: SERVER.hostname,
          port: SERVER.port || 80,
          path: '/api/input/batch',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: CFG.requestTimeoutMs,
          agent: AGENT,
        },
        (res) => {
          // Drain response body
          res.on('data', () => {});
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
            } else {
              reject(new Error(`HTTP ${res.statusCode || 0}`));
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error('timeout'));
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  sendHealth() {
    const payload = JSON.stringify({
      deviceId: CFG.deviceId,
      ts: Date.now(),
      queueSize: this.queue.length,
      monitorCount: this.monitors.size,
      stats: this.stats,
    });

    const req = http.request(
      {
        protocol: SERVER.protocol,
        hostname: SERVER.hostname,
        port: SERVER.port || 80,
        path: '/api/input/health',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: Math.min(CFG.requestTimeoutMs, 800),
        agent: AGENT,
      },
      (res) => {
        res.resume();
      }
    );

    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.write(payload);
    req.end();
  }

  discoverAndStartMonitors() {
    const discovered = this.discoverInputDevices();
    this.log('Input devices:', discovered);

    this.startMonitor('buttons', discovered.buttons);
    this.startMonitor('dial', discovered.dial);
  }

  discoverInputDevices() {
    let text = '';
    try {
      text = fs.readFileSync('/proc/bus/input/devices', 'utf8');
    } catch (e) {
      this.warn('Unable to read /proc/bus/input/devices, using fallback events');
      return { buttons: CFG.fallbackButtons, dial: CFG.fallbackDial };
    }

    const blocks = text.split(/\n\n+/);
    let buttons = null;
    let dial = null;

    for (const block of blocks) {
      const lower = block.toLowerCase();
      const match = block.match(/Handlers=([^\n]+)/);
      if (!match) continue;

      const handlers = match[1].split(/\s+/);
      const eventToken = handlers.find((h) => /^event\d+$/.test(h));
      if (!eventToken) continue;
      const path = `/dev/input/${eventToken}`;

      const isButtonLike =
        lower.includes('gpio-keys') ||
        lower.includes('keyboard') ||
        lower.includes('button');

      const isDialLike =
        lower.includes('rotary') ||
        lower.includes('dial') ||
        lower.includes('encoder') ||
        lower.includes('volume');

      if (!buttons && isButtonLike) buttons = path;
      if (!dial && isDialLike) dial = path;
    }

    return {
      buttons: buttons || CFG.fallbackButtons,
      dial: dial || CFG.fallbackDial,
    };
  }

  startMonitor(kind, devicePath) {
    const existing = this.monitors.get(kind);
    if (existing) {
      try { existing.kill('SIGTERM'); } catch {}
    }

    this.log(`Starting ${kind} monitor on ${devicePath}`);

    const child = spawn('getevent', [devicePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.monitors.set(kind, child);

    child.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        this.parseGeteventLine(kind, line);
      }
    });

    child.stderr.on('data', (chunk) => {
      const s = chunk.toString().trim();
      if (s) this.warn(`${kind} stderr: ${s}`);
    });

    child.on('error', (e) => {
      this.err(`${kind} monitor error:`, e.message);
    });

    child.on('exit', (code, signal) => {
      this.warn(`${kind} monitor exited code=${code} signal=${signal || 'none'}`);
      this.monitors.delete(kind);
      this.stats.monitorRestarts += 1;

      setTimeout(() => {
        // Re-discover; event numbering can change after reconnect/reboot.
        this.discoverAndStartMonitors();
      }, kind === 'dial' ? CFG.rediscoverMs : CFG.monitorRestartMs);
    });
  }

  parseGeteventLine(kind, line) {
    // Typical formats include one of:
    //   /dev/input/event1: 0002 0007 ffffffff
    //   [ 1234.567890] /dev/input/event1: 0001 001c 00000001
    const m = line.match(/:\s*([0-9a-fA-F]{4})\s+([0-9a-fA-F]{4})\s+([0-9a-fA-F]{8})/);
    if (!m) return;

    const evType = parseInt(m[1], 16);
    const code = parseInt(m[2], 16);
    const valueU32 = parseInt(m[3], 16) >>> 0;
    const value = valueU32 > 0x7fffffff ? valueU32 - 0x100000000 : valueU32;

    if (kind === 'buttons') {
      this.handleButtonEvent(evType, code, value);
      return;
    }

    if (kind === 'dial') {
      this.handleDialEvent(evType, code, value);
    }
  }

  handleButtonEvent(evType, code, value) {
    if (evType !== EV_KEY) return;

    const mapped = KEY_MAP.get(code);
    if (mapped === undefined) {
      // Throttle unknown key logging to once per 30s per code.
      const now = Date.now();
      const last = this.unknownKeyLogAt.get(code) || 0;
      if (now - last > 30000) {
        this.warn(`Unknown button code: ${code} (0x${code.toString(16)})`);
        this.unknownKeyLogAt.set(code, now);
      }
      return;
    }

    // value: 0=UP, 1=DOWN, 2=REPEAT
    if (value === 1) this.sendInput(mapped, true);
    else if (value === 0) this.sendInput(mapped, false);
    // ignore repeats to avoid flooding
  }

  handleDialEvent(evType, code, value) {
    if (evType !== EV_REL) return;
    if (!REL_CODES_DIAL.has(code)) return;

    const clampedAbs = Math.min(Math.abs(value), CFG.maxDialStep);
    if (clampedAbs < Math.abs(value)) this.stats.dropped += Math.abs(value) - clampedAbs;

    if (value > 0) {
      for (let i = 0; i < clampedAbs; i += 1) this.sendDialPulse(VKEY.KEY_RIGHT);
    } else if (value < 0) {
      for (let i = 0; i < clampedAbs; i += 1) this.sendDialPulse(VKEY.KEY_LEFT);
    }
  }
}

new InputBridge().start();
