// ═══════════════════════════════════════════════════════════════════════════
// ServerThing Simulator — Input Bridge (Hotspot Edition)
//
// Translates mouse / keyboard / touch-panel interactions into hardware
// events for the Shell iframe.  All physical controls are represented as
// percentage-positioned hotspots over the device image.
//
// Controls:
//   Preset 1-4 & Settings  →  click
//   Dial                    →  scroll (rotate), click (select), hold (back)
//   Back Button             →  click (back), hold (home)
//   Touch Panel             →  swipe-left / swipe-right
//   Iframe                  →  direct click/tap (screen touch)
//   Keyboard                →  arrows, enter, esc, 1-4
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Elements ──────────────────────────────────────────────────────────

  const frame       = document.getElementById('shell-frame');
  const deviceFrame = document.getElementById('device-frame');
  const deviceImage = document.getElementById('device-image');
  const hsDial      = document.getElementById('hs-dial');
  const hsBack      = document.getElementById('hs-back');

  // ── Core: call into the shell runtime directly ────────────────────────

  function callShell(input) {
    try {
      const win = frame.contentWindow;
      if (win && win.shell && typeof win.shell.handleHardwareInput === 'function') {
        win.shell.handleHardwareInput(input);
      }
    } catch { /* cross-origin guard */ }
  }

  // ── Visual Feedback ───────────────────────────────────────────────────

  /** Briefly add a CSS class for animation, forcing reflow to restart. */
  function flash(el, cls, ms = 250) {
    el.classList.remove(cls);
    void el.offsetWidth;           // force reflow → restart animation
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  // ── Iframe Scaling ────────────────────────────────────────────────────
  // Shell renders at native 800×480.  We scale the iframe element to fit
  // the screen area within the device image using transform: scale().
  // Fractions represent how much of the image's width/height the screen occupies.
  // Calibrated to grande_spotify-car-thing.jpg (1940×1320).

  const SCREEN_FRAC_X = 0.5315;   // screen width  / image width
  const SCREEN_FRAC_Y = 0.4618;   // screen height / image height

  function updateFrameScale() {
    const imgW = deviceImage.offsetWidth;
    const imgH = deviceImage.offsetHeight;
    if (imgW <= 0 || imgH <= 0) return;
    const scaleX = (imgW * SCREEN_FRAC_X) / 800;
    const scaleY = (imgH * SCREEN_FRAC_Y) / 480;
    frame.style.transform = `scale(${scaleX}, ${scaleY})`;
  }

  window.addEventListener('resize', updateFrameScale);

  // Run once the image has loaded so dimensions are correct.
  if (deviceImage.complete) {
    updateFrameScale();
  } else {
    deviceImage.addEventListener('load', updateFrameScale);
  }

  // ── Prevent Context Menu on Sim Controls ──────────────────────────────

  deviceFrame.addEventListener('contextmenu', e => e.preventDefault());
  const touchPanel = document.getElementById('touch-panel');
  if (touchPanel) touchPanel.addEventListener('contextmenu', e => e.preventDefault());

  // ═════════════════════════════════════════════════════════════════════
  //  LONG-PRESS HELPER
  //  Used by all hardware buttons.
  //   Short press  (<250 ms)  →  fires shortAction callback
  //   Long press   (≥250 ms)  →  fires longAction callback
  //  Visual: 'pressing' class on pointerdown, 'held' on long threshold.
  // ═════════════════════════════════════════════════════════════════════

  const LONG_PRESS_MS = 250;

  function bindLongPress(el, { onShort, onLong, onRelease }) {
    let timer = null;
    let isLong = false;

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('pressing');
      isLong = false;

      timer = setTimeout(() => {
        isLong = true;
        el.classList.remove('pressing');
        el.classList.add('held');
        if (onLong) onLong();
      }, LONG_PRESS_MS);
    });

    el.addEventListener('pointerup', (e) => {
      el.releasePointerCapture(e.pointerId);
      el.classList.remove('pressing', 'held');
      clearTimeout(timer);

      if (!isLong) {
        if (onShort) onShort();
        flash(el, 'pulse');
      } else {
        if (onRelease) onRelease();
      }
      isLong = false;
    });

    el.addEventListener('pointercancel', (e) => {
      el.releasePointerCapture(e.pointerId);
      el.classList.remove('pressing', 'held');
      clearTimeout(timer);
      if (isLong && onRelease) onRelease();
      isLong = false;
    });

    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ═════════════════════════════════════════════════════════════════════
  //  PRESET BUTTONS  (short = preset action, long = held visual)
  // ═════════════════════════════════════════════════════════════════════

  document.querySelectorAll('.hotspot-preset').forEach(hs => {
    bindLongPress(hs, {
      onShort: () => callShell({ type: 'button', value: hs.dataset.action }),
      onLong:  () => callShell({ type: 'button', value: hs.dataset.action + '_long' }),
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //  DIAL — Scroll → Rotate
  // ═════════════════════════════════════════════════════════════════════

  let wheelAccum = 0;
  const WHEEL_THRESHOLD = 40;

  hsDial.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheelAccum += e.deltaY;
    while (Math.abs(wheelAccum) >= WHEEL_THRESHOLD) {
      if (wheelAccum > 0) {
        callShell({ type: 'dial', value: 'right' });
        flash(hsDial, 'rotating-right');
        wheelAccum -= WHEEL_THRESHOLD;
      } else {
        callShell({ type: 'dial', value: 'left' });
        flash(hsDial, 'rotating-left');
        wheelAccum += WHEEL_THRESHOLD;
      }
    }
  }, { passive: false });

  // ═════════════════════════════════════════════════════════════════════
  //  DIAL — Click + Long Press
  //   Short click  (<250 ms)  →  dial_click_down  (select / enter)
  //   Long press   (≥250 ms)  →  back navigation  (cancel / back)
  // ═════════════════════════════════════════════════════════════════════

  bindLongPress(hsDial, {
    onShort: () => callShell({ type: 'button', value: 'dial_click_down' }),
    onLong:  () => callShell({ type: 'button', value: 'back_button_down' }),
    onRelease: () => callShell({ type: 'button', value: 'back_button_up' }),
  });

  // ═════════════════════════════════════════════════════════════════════
  //  BACK BUTTON — Long-press aware
  //   Short press  (<250 ms)  →  short back (back_button_down + up)
  //   Long press   (≥250 ms)  →  home (held down until release)
  // ═════════════════════════════════════════════════════════════════════

  bindLongPress(hsBack, {
    onShort:   () => {
      callShell({ type: 'button', value: 'back_button_down' });
      setTimeout(() => callShell({ type: 'button', value: 'back_button_up' }), 20);
    },
    onLong:    () => callShell({ type: 'button', value: 'back_button_down' }),
    onRelease: () => callShell({ type: 'button', value: 'back_button_up' }),
  });

  // ═════════════════════════════════════════════════════════════════════
  //  TOUCH PANEL  (Swipe Left / Swipe Right)
  // ═════════════════════════════════════════════════════════════════════

  document.querySelectorAll('[data-sim]').forEach(btn => {
    const action = btn.dataset.sim;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      btn.classList.add('active');
      setTimeout(() => btn.classList.remove('active'), 150);

      if (action === 'swipe-left')  callShell({ type: 'touch', value: 'swipe-left' });
      if (action === 'swipe-right') callShell({ type: 'touch', value: 'swipe-right' });
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  //  KEYBOARD SHORTCUTS
  // ═════════════════════════════════════════════════════════════════════

  let escHeld = false;

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        callShell({ type: 'dial', value: 'left' });
        flash(hsDial, 'rotating-left');
        break;
      case 'ArrowRight':
        e.preventDefault();
        callShell({ type: 'dial', value: 'right' });
        flash(hsDial, 'rotating-right');
        break;
      case 'ArrowUp':
        e.preventDefault();
        callShell({ type: 'dial', value: 'up' });
        flash(hsDial, 'rotating-left');
        break;
      case 'ArrowDown':
        e.preventDefault();
        callShell({ type: 'dial', value: 'down' });
        flash(hsDial, 'rotating-right');
        break;
      case 'Enter':
        e.preventDefault();
        callShell({ type: 'button', value: 'dial_click_down' });
        flash(hsDial, 'pulse');
        break;
      case 'Escape':
      case 'Backspace':
        e.preventDefault();
        if (!escHeld) {
          escHeld = true;
          hsBack.classList.add('held');
          callShell({ type: 'button', value: 'back_button_down' });
        }
        break;
      case '1': case '2': case '3': case '4': {
        const hs = document.getElementById(`hs-preset-${e.key}`);
        if (hs) {
          flash(hs, 'pulse');
          callShell({ type: 'button', value: `preset_${e.key}` });
        }
        break;
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Escape' || e.key === 'Backspace') {
      if (escHeld) {
        escHeld = false;
        hsBack.classList.remove('held');
        callShell({ type: 'button', value: 'back_button_up' });
      }
    }
  });

  // ═════════════════════════════════════════════════════════════════════
  //  SIM_HARDWARE_EVENT bridge  (iframe → sim → shell)
  // ═════════════════════════════════════════════════════════════════════

  frame.addEventListener('load', () => {
    updateFrameScale();
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
