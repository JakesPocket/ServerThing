// ═══════════════════════════════════════════════════════════════════════════
// ServerThing Simulator — Input Bridge
// Translates mouse / keyboard interactions into hardware events for the
// shell iframe, using the same KeyboardEvent dispatch the shell already
// listens for.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const frame   = document.getElementById('shell-frame');
  const dial    = document.getElementById('dial');
  const backBtn = document.getElementById('back-btn');

  // ── Helpers ────────────────────────────────────────────────────────────

  /** Dispatch a keyboard event into the shell iframe so the shell's own
   *  keydown handler picks it up natively. */
  function sendKey(key) {
    try {
      const win = frame.contentWindow;
      if (!win) return;
      win.dispatchEvent(new KeyboardEvent('keydown', {
        key,
        code: keyToCode(key),
        bubbles: true,
        cancelable: true,
      }));
    } catch { /* cross-origin guard */ }
  }

  function keyToCode(key) {
    switch (key) {
      case 'ArrowLeft':  return 'ArrowLeft';
      case 'ArrowRight': return 'ArrowRight';
      case 'ArrowUp':    return 'ArrowUp';
      case 'ArrowDown':  return 'ArrowDown';
      case 'Enter':      return 'Enter';
      case 'Escape':     return 'Escape';
      default:           return '';
    }
  }

  /** Visual feedback: briefly add a class, then remove it. */
  function flash(el, cls, ms = 120) {
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  /** Flash a preset button. */
  function flashPreset(btn) {
    btn.classList.add('active');
    setTimeout(() => btn.classList.remove('active'), 150);
  }

  // ── Dial: Scroll → Rotate ─────────────────────────────────────────────

  let wheelAccum = 0;
  const WHEEL_THRESHOLD = 40;  // px of scroll per "tick"

  dial.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheelAccum += e.deltaY;

    while (Math.abs(wheelAccum) >= WHEEL_THRESHOLD) {
      if (wheelAccum > 0) {
        sendKey('ArrowRight');
        flash(dial, 'rotating-right');
        wheelAccum -= WHEEL_THRESHOLD;
      } else {
        sendKey('ArrowLeft');
        flash(dial, 'rotating-left');
        wheelAccum += WHEEL_THRESHOLD;
      }
    }
  }, { passive: false });

  // ── Dial: Click → Enter ───────────────────────────────────────────────

  dial.addEventListener('click', () => {
    sendKey('Enter');
    flash(dial, 'pressing', 100);
  });

  // ── Back Button ───────────────────────────────────────────────────────

  backBtn.addEventListener('mousedown', () => {
    sendKey('Escape');
  });

  // ── Preset Buttons ────────────────────────────────────────────────────

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.btn;      // e.g. 'preset_1'
      flashPreset(btn);
      try {
        // Send as a postMessage using the shell's hardware input schema
        frame.contentWindow.postMessage({
          type: 'SIM_HARDWARE_EVENT',
          data: { type: 'button', value: id }
        }, location.origin);
      } catch { /* cross-origin guard */ }
    });
  });

  // ── Keyboard Shortcuts (when sim page has focus) ──────────────────────

  document.addEventListener('keydown', (e) => {
    // Don't intercept if an input element is focused
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        sendKey('ArrowLeft');
        flash(dial, 'rotating-left');
        break;
      case 'ArrowRight':
        e.preventDefault();
        sendKey('ArrowRight');
        flash(dial, 'rotating-right');
        break;
      case 'ArrowUp':
        e.preventDefault();
        sendKey('ArrowUp');
        flash(dial, 'rotating-left');
        break;
      case 'ArrowDown':
        e.preventDefault();
        sendKey('ArrowDown');
        flash(dial, 'rotating-right');
        break;
      case 'Enter':
        e.preventDefault();
        sendKey('Enter');
        flash(dial, 'pressing', 100);
        break;
      case 'Escape':
      case 'Backspace':
        e.preventDefault();
        sendKey('Escape');
        break;
      // Preset shortcuts: 1-4
      case '1': case '2': case '3': case '4': {
        const btn = document.querySelector(`.preset-btn[data-btn="preset_${e.key}"]`);
        if (btn) { btn.click(); }
        break;
      }
    }
  });

  // ── Wire the shell to accept SIM_HARDWARE_EVENT from the simulator ────
  // The shell only listens to its own keydown events and postMessages from
  // child iframes (apps).  For preset buttons we send a SIM_HARDWARE_EVENT
  // that the shell needs to handle.  We inject a tiny listener once the
  // iframe loads.

  frame.addEventListener('load', () => {
    try {
      const win = frame.contentWindow;
      win.addEventListener('message', (e) => {
        if (e.origin !== location.origin) return;
        const d = e.data;
        if (!d || d.type !== 'SIM_HARDWARE_EVENT') return;
        // Access the shell runtime and call handleHardwareInput directly
        if (win.shell && typeof win.shell.handleHardwareInput === 'function') {
          win.shell.handleHardwareInput(d.data);
        }
      });
    } catch { /* cross-origin guard */ }
  });

  console.log('[Sim] ServerThing Simulator ready');
})();
