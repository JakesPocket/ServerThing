// ═══════════════════════════════════════════════════════════════════════════
// ServerThing Simulator — Input Bridge
// Translates mouse / keyboard interactions into hardware events for the
// shell iframe.  Supports long-press detection on all buttons.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const frame   = document.getElementById('shell-frame');
  const dial    = document.getElementById('dial');
  const backBtn = document.getElementById('back-btn');

  // ── Core: call into the shell runtime directly ─────────────────────────

  function callShell(input) {
    try {
      const win = frame.contentWindow;
      if (win && win.shell && typeof win.shell.handleHardwareInput === 'function') {
        win.shell.handleHardwareInput(input);
      }
    } catch { /* cross-origin guard */ }
  }

  /** Dispatch a keyboard event into the shell iframe. */
  function sendKey(key) {
    try {
      const win = frame.contentWindow;
      if (!win) return;
      win.dispatchEvent(new KeyboardEvent('keydown', {
        key,
        code: key,
        bubbles: true,
        cancelable: true,
      }));
    } catch { /* cross-origin guard */ }
  }

  /** Visual feedback: briefly add a class, then remove it. */
  function flash(el, cls, ms = 120) {
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  // ── Prevent context menu on all sim controls ──────────────────────────

  document.getElementById('device').addEventListener('contextmenu', e => e.preventDefault());
  const controlPanel = document.getElementById('control-panel');
  if (controlPanel) controlPanel.addEventListener('contextmenu', e => e.preventDefault());

  // ── Long-press helper ─────────────────────────────────────────────────
  // Sends button_down on pointerdown, button_up on pointerup.
  // The shell's handleBackButtonDown/Up already has the 250ms threshold.

  function bindButton(el, downValue, upValue) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('held');
      callShell({ type: 'button', value: downValue });
    });

    el.addEventListener('pointerup', (e) => {
      el.releasePointerCapture(e.pointerId);
      el.classList.remove('held');
      if (upValue) callShell({ type: 'button', value: upValue });
    });

    el.addEventListener('pointercancel', (e) => {
      el.releasePointerCapture(e.pointerId);
      el.classList.remove('held');
      if (upValue) callShell({ type: 'button', value: upValue });
    });

    // Prevent context menu specifically on this element
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ── Dial: Scroll → Rotate ─────────────────────────────────────────────

  let wheelAccum = 0;
  const WHEEL_THRESHOLD = 40;

  dial.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheelAccum += e.deltaY;
    while (Math.abs(wheelAccum) >= WHEEL_THRESHOLD) {
      if (wheelAccum > 0) {
        callShell({ type: 'dial', value: 'right' });
        flash(dial, 'rotating-right');
        wheelAccum -= WHEEL_THRESHOLD;
      } else {
        callShell({ type: 'dial', value: 'left' });
        flash(dial, 'rotating-left');
        wheelAccum += WHEEL_THRESHOLD;
      }
    }
  }, { passive: false });

  // ── Dial: Click → dial_click_down ─────────────────────────────────────

  dial.addEventListener('click', () => {
    callShell({ type: 'button', value: 'dial_click_down' });
    flash(dial, 'pressing', 100);
  });

  // ── Back Button: long-press aware ─────────────────────────────────────

  bindButton(backBtn, 'back_button_down', 'back_button_up');

  // ── Preset Buttons ────────────────────────────────────────────────────

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const id = btn.dataset.btn;
      btn.classList.add('active');
      setTimeout(() => btn.classList.remove('active'), 150);
      callShell({ type: 'button', value: id });
    });
  });

  // ── Control Panel Buttons ─────────────────────────────────────────────

  // Dial buttons in control panel
  document.querySelectorAll('[data-sim]').forEach(btn => {
    const action = btn.dataset.sim;

    if (action === 'back') {
      // Long-press aware
      bindButton(btn, 'back_button_down', 'back_button_up');
    } else {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        btn.classList.add('active');
        setTimeout(() => btn.classList.remove('active'), 150);

        switch (action) {
          case 'dial-left':
            callShell({ type: 'dial', value: 'left' });
            flash(dial, 'rotating-left');
            break;
          case 'dial-right':
            callShell({ type: 'dial', value: 'right' });
            flash(dial, 'rotating-right');
            break;
          case 'dial-click':
            callShell({ type: 'button', value: 'dial_click_down' });
            flash(dial, 'pressing', 100);
            break;
          case 'preset_1': case 'preset_2': case 'preset_3': case 'preset_4': case 'settings':
            callShell({ type: 'button', value: action });
            break;
          case 'swipe-left':
            callShell({ type: 'touch', value: 'swipe-left' });
            break;
          case 'swipe-right':
            callShell({ type: 'touch', value: 'swipe-right' });
            break;
          case 'tap':
            callShell({ type: 'touch', value: 'tap' });
            break;
        }
      });
    }
  });

  // ── Keyboard Shortcuts ────────────────────────────────────────────────

  let escHeld = false;

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        callShell({ type: 'dial', value: 'left' });
        flash(dial, 'rotating-left');
        break;
      case 'ArrowRight':
        e.preventDefault();
        callShell({ type: 'dial', value: 'right' });
        flash(dial, 'rotating-right');
        break;
      case 'ArrowUp':
        e.preventDefault();
        callShell({ type: 'dial', value: 'up' });
        flash(dial, 'rotating-left');
        break;
      case 'ArrowDown':
        e.preventDefault();
        callShell({ type: 'dial', value: 'down' });
        flash(dial, 'rotating-right');
        break;
      case 'Enter':
        e.preventDefault();
        callShell({ type: 'button', value: 'dial_click_down' });
        flash(dial, 'pressing', 100);
        break;
      case 'Escape':
      case 'Backspace':
        e.preventDefault();
        if (!escHeld) {
          escHeld = true;
          callShell({ type: 'button', value: 'back_button_down' });
          backBtn.classList.add('held');
        }
        break;
      case '1': case '2': case '3': case '4': {
        const pbtn = document.querySelector(`.preset-btn[data-btn="preset_${e.key}"]`);
        if (pbtn) pbtn.click();
        break;
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape' || e.key === 'Backspace') {
      if (escHeld) {
        escHeld = false;
        callShell({ type: 'button', value: 'back_button_up' });
        backBtn.classList.remove('held');
      }
    }
  });

  // ── Wire the shell to accept SIM_HARDWARE_EVENT from the simulator ────

  frame.addEventListener('load', () => {
    try {
      const win = frame.contentWindow;
      win.addEventListener('message', (e) => {
        if (e.origin !== location.origin) return;
        const d = e.data;
        if (!d || d.type !== 'SIM_HARDWARE_EVENT') return;
        if (win.shell && typeof win.shell.handleHardwareInput === 'function') {
          win.shell.handleHardwareInput(d.data);
        }
      });
    } catch { /* cross-origin guard */ }
  });

  console.log('[Sim] ServerThing Simulator ready');
})();
