// ServerThing App Bridge Plugin — include in any iframe app
// Manages .st-focused / .st-muted classes on .st-selectable elements
// and synchronises with the Shell's zone-focus and hardware events.
(function () {
  let items = [], idx = 0, dimmed = false;

  function refresh() { items = [...document.querySelectorAll('.st-selectable')]; }

  function focus(i) {
    items.forEach(el => el.classList.remove('st-focused', 'st-muted'));
    if (items[i]) { items[i].classList.add(dimmed ? 'st-muted' : 'st-focused'); idx = i; }
  }

  function dimAll() {
    dimmed = true;
    items.forEach(el => { el.classList.remove('st-focused'); el.classList.add('st-muted'); });
  }

  function undim() { dimmed = false; focus(idx); }

  function applyTokens(tokens) {
    const r = document.documentElement.style;
    for (const [k, v] of Object.entries(tokens)) r.setProperty(k, v);
  }

  window.addEventListener('message', e => {
    if (e.origin !== location.origin) return;
    const d = e.data;  if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;
    if (d.type === 'THEME_UPDATE')    applyTokens(d.tokens);
    if (d.type === 'THEME_READY')     refresh();
    if (d.type === 'DIM_APP_FOCUS')   dimAll();
    if (d.type === 'ZONE_FOCUS')      d.active ? undim() : dimAll();
    if (d.type === 'HARDWARE_EVENT')  handleDial(d.data);
  });

  function handleDial(input) {
    if (!input) return; refresh();
    const v = String(input.value).toUpperCase();
    if (input.type === 'DIAL') {
      if (v === 'RIGHT' || v === 'DOWN') {
        if (idx < items.length - 1) focus(idx + 1);
        // At last item: don't wrap — stay put
      }
      if (v === 'LEFT' || v === 'UP') {
        if (idx > 0) { focus(idx - 1); }
        else {
          // At first item — escape to Shell status bar
          window.parent.postMessage({ type: 'APP_AT_TOP' }, location.origin);
        }
      }
    }
    if (v === 'DIAL_CLICK_DOWN' && items[idx]) items[idx].click();
  }

  // On click/tap: notify Shell, show muted state during action
  document.addEventListener('pointerdown', e => {
    const sel = e.target.closest('.st-selectable');
    if (!sel) return;
    const i = items.indexOf(sel); if (i >= 0) { focus(i); dimAll(); }
    window.parent.postMessage({ type: 'UI_ACTION_START', elementId: sel.id || null }, location.origin);
  });

  // Bootstrap on DOM ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh);
  else refresh();
})();
