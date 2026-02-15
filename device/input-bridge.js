#!/usr/bin/env node
/**
 * Hardware Input Bridge for Spotify Car Thing
 * Reads from /dev/input/event* and forwards to server via WebSocket
 */

const { spawn } = require('child_process');
const WebSocket = require('ws');

// Event device mapping (from /proc/bus/input/devices)
const DEVICES = {
  BUTTONS: '/dev/input/event0',  // gpio-keys (preset buttons, back button)
  DIAL: '/dev/input/event1'       // rotary@0 (dial rotation)
};

// Key codes from linux/input-event-codes.h
const KEY_CODES = {
  KEY_BACK: 158,
  KEY_ENTER: 28,
  KEY_LEFT: 105,   // Dial counter-clockwise
  KEY_RIGHT: 106,  // Dial clockwise
  BTN_0: 256,      // Preset button 1
  BTN_1: 257,      // Preset button 2
  BTN_2: 258,      // Preset button 3
  BTN_3: 259       // Preset button 4
};

// Event types
const EV_KEY = 0x01;
const EV_REL = 0x02;
const REL_DIAL = 0x07;

class InputBridge {
  constructor(serverUrl = 'ws://127.0.0.1:3000') {
    this.serverUrl = serverUrl;
    this.ws = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
  }

  connect() {
    console.log('[Input Bridge] Connecting to server:', this.serverUrl);
    
    this.ws = new WebSocket(`${this.serverUrl}/ws/device?id=input-bridge`);
    
    this.ws.on('open', () => {
      console.log('[Input Bridge] Connected to server');
      this.reconnectDelay = 1000;
    });
    
    this.ws.on('close', () => {
      console.log('[Input Bridge] Disconnected from server, reconnecting in', this.reconnectDelay, 'ms');
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    });
    
    this.ws.on('error', (err) => {
      console.error('[Input Bridge] WebSocket error:', err.message);
    });
  }

  sendInput(keyCode, isPressed) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = {
        type: 'input',
        keyCode,
        isPressed
      };
      this.ws.send(JSON.stringify(message));
      console.log('[Input Bridge] Sent:', message);
    }
  }

  startButtonMonitor() {
    console.log('[Input Bridge] Starting button monitor:', DEVICES.BUTTONS);
    
    const getevent = spawn('getevent', ['-l', DEVICES.BUTTONS], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    getevent.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        this.parseButtonEvent(line);
      }
    });

    getevent.on('error', (err) => {
      console.error('[Input Bridge] Button monitor error:', err);
    });

    getevent.on('exit', (code) => {
      console.log('[Input Bridge] Button monitor exited with code:', code);
      setTimeout(() => this.startButtonMonitor(), 1000);
    });
  }

  startDialMonitor() {
    console.log('[Input Bridge] Starting dial monitor:', DEVICES.DIAL);
    
    const getevent = spawn('getevent', ['-l', DEVICES.DIAL], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    getevent.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        this.parseDialEvent(line);
      }
    });

    getevent.on('error', (err) => {
      console.error('[Input Bridge] Dial monitor error:', err);
    });

    getevent.on('exit', (code) => {
      console.log('[Input Bridge] Dial monitor exited with code:', code);
      setTimeout(() => this.startDialMonitor(), 1000);
    });
  }

  parseButtonEvent(line) {
    // Example: EV_KEY       KEY_BACK             DOWN
    // Example: EV_KEY       BTN_0                UP
    const match = line.match(/EV_KEY\s+(\S+)\s+(DOWN|UP)/);
    if (!match) return;

    const [, keyName, state] = match;
    const isPressed = state === 'DOWN';

    // Map key names to codes
    let keyCode = null;
    switch (keyName) {
      case 'KEY_BACK':
        keyCode = KEY_CODES.KEY_BACK;
        break;
      case 'BTN_0':
        keyCode = KEY_CODES.BTN_0;
        break;
      case 'BTN_1':
        keyCode = KEY_CODES.BTN_1;
        break;
      case 'BTN_2':
        keyCode = KEY_CODES.BTN_2;
        break;
      case 'BTN_3':
        keyCode = KEY_CODES.BTN_3;
        break;
      case 'KEY_ENTER':
        keyCode = KEY_CODES.KEY_ENTER;
        break;
    }

    if (keyCode !== null) {
      this.sendInput(keyCode, isPressed);
    }
  }

  parseDialEvent(line) {
    // Example: EV_REL       REL_DIAL             00000001
    // Example: EV_REL       REL_DIAL             ffffffff
    const match = line.match(/EV_REL\s+REL_DIAL\s+([0-9a-f]{8})/i);
    if (!match) return;

    const valueHex = match[1];
    const value = parseInt(valueHex, 16);
    
    // Convert to signed 32-bit integer
    const signedValue = value > 0x7fffffff ? value - 0x100000000 : value;

    // Positive = clockwise = RIGHT, Negative = counter-clockwise = LEFT
    if (signedValue > 0) {
      // Clockwise rotation
      this.sendInput(KEY_CODES.KEY_RIGHT, true);
      setTimeout(() => this.sendInput(KEY_CODES.KEY_RIGHT, false), 50);
    } else if (signedValue < 0) {
      // Counter-clockwise rotation
      this.sendInput(KEY_CODES.KEY_LEFT, true);
      setTimeout(() => this.sendInput(KEY_CODES.KEY_LEFT, false), 50);
    }
  }

  start() {
    console.log('[Input Bridge] Starting...');
    this.connect();
    this.startButtonMonitor();
    this.startDialMonitor();
  }
}

// Start the bridge
const bridge = new InputBridge();
bridge.start();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[Input Bridge] Shutting down...');
  process.exit(0);
});
