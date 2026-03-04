class ArmWatchApp {
  constructor() {
    this.elements = {
      mainScreen: document.getElementById('main-screen'),
      updatedAt: document.getElementById('updated-at'),
      refreshBtn: document.getElementById('refresh-btn'),
      statusBar: document.getElementById('status-bar'),
      statusMessage: document.getElementById('status-message'),
      updateKeyBtn: document.getElementById('update-key-btn'),
      primaryCard: document.getElementById('primary-card'),
      posterBox: document.getElementById('poster-box'),
      posterImg: document.getElementById('poster-img'),
      posterFallback: document.getElementById('poster-fallback'),
      posterStatus: document.getElementById('poster-status'),
      movieTitle: document.getElementById('movie-title'),
      movieSubline: document.getElementById('movie-subline'),
      progressBar: document.getElementById('progress-bar'),
      rowRipProgress: document.getElementById('row-rip-progress'),
      ripProgress: document.getElementById('rip-progress'),
      rowRipEta: document.getElementById('row-rip-eta'),
      ripEta: document.getElementById('rip-eta'),
      rowTranscodeProgress: document.getElementById('row-transcode-progress'),
      transcodeProgress: document.getElementById('transcode-progress'),
      rowTranscodeEta: document.getElementById('row-transcode-eta'),
      transcodeEta: document.getElementById('transcode-eta'),
      rowFps: document.getElementById('row-fps'),
      fps: document.getElementById('fps'),
      rowCodec: document.getElementById('row-codec'),
      codec: document.getElementById('codec'),
      rowGpu: document.getElementById('row-gpu'),
      gpu: document.getElementById('gpu'),
      issues: document.getElementById('issues'),
      historyList: document.getElementById('history-list'),
    };

    this.focusedIndex = 0;
    this.pollMs = 2000;
    this.failCount = 0;
    this.pollTimer = null;
    this.pollAbort = null;
    this.lastGoodData = null;

    this.init();
  }

  init() {
    window.addEventListener('message', (event) => this.handleShellMessage(event));
    this.elements.refreshBtn.addEventListener('click', () => this.fetchAndRenderHealth(true));
    this.elements.updateKeyBtn.addEventListener('click', () => this.applyLatestKey());
    this.fetchAndRenderHealth();
    this.sendNavState(true);
  }

  sendNavState(isAtRoot) {
    window.parent.postMessage({ type: 'APP_NAV_STATE', atRoot: isAtRoot }, location.origin);
  }

  handleShellMessage(event) {
    if (event.source !== window.parent) return;
    const message = event.data || {};

    if (message.type === 'HARDWARE_EVENT' && message.data) {
      this.handleHardwareInput(message.data);
    } else if (message.type === 'DIM_APP_FOCUS') {
      this.getFocusableElements().forEach((el) => el.classList.remove('focus-outline'));
    } else if (message.type === 'ZONE_FOCUS' && message.active) {
      this.updateFocus();
    }
  }

  handleHardwareInput(input) {
    const type = String(input.type || '').toUpperCase();
    const value = String(input.value || '').toUpperCase();
    if (!type || !value) return;

    const focusable = this.getFocusableElements();
    if (!focusable.length) return;

    if (type === 'DIAL') {
      if (value === 'RIGHT') {
        this.focusedIndex = (this.focusedIndex + 1) % focusable.length;
      } else if (value === 'LEFT') {
        if (this.focusedIndex > 0) {
          this.focusedIndex -= 1;
        } else {
          window.parent.postMessage({ type: 'APP_AT_TOP' }, location.origin);
          return;
        }
      }
      this.updateFocus();
      return;
    }

    if (type === 'BUTTON' && value === 'DIAL_CLICK_DOWN') {
      focusable[this.focusedIndex]?.click();
    }
  }

  getFocusableElements() {
    const list = [];
    if (this.elements.updateKeyBtn.classList.contains('visible')) list.push(this.elements.updateKeyBtn);
    list.push(this.elements.refreshBtn);
    return list;
  }

  updateFocus() {
    const focusable = this.getFocusableElements();
    if (!focusable.length) return;
    if (this.focusedIndex >= focusable.length) this.focusedIndex = focusable.length - 1;
    focusable.forEach((el, idx) => el.classList.toggle('focus-outline', idx === this.focusedIndex));
  }

  isActiveMode(data) {
    return data.state === 'ripping'
      || data.state === 'transcoding'
      || data.state === 'transcode_failed'
      || Boolean(data.rip?.active)
      || Boolean(data.transcode?.active);
  }

  setRowVisible(rowEl, visible) {
    if (!rowEl) return;
    rowEl.style.display = visible ? 'block' : 'none';
  }

  formatEta(sec) {
    if (!Number.isFinite(sec) || sec <= 0) return '';
    const s = Math.floor(sec % 60);
    const m = Math.floor((sec / 60) % 60);
    const h = Math.floor(sec / 3600);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  }

  toneFromKeyStatus(keyStatus = {}) {
    const severity = String(keyStatus.severity || '').toLowerCase();
    if (severity === 'green') return 'good';
    if (severity === 'red') return 'bad';

    if (keyStatus.state === 'valid') return 'good';
    if (keyStatus.state === 'error' || keyStatus.state === 'expired') return 'bad';
    return 'warn';
  }

  applyToneClass(element, baseClass, tone) {
    element.className = `${baseClass} ${tone}`;
  }

  renderStatusBar(data) {
    const active = this.isActiveMode(data);
    if (active) {
      if (data.state === 'transcode_failed') {
        this.applyToneClass(this.elements.statusBar, 'status-bar', 'bad');
        this.elements.statusMessage.textContent = 'Transcode Failed';
        this.elements.updateKeyBtn.classList.remove('visible');
        this.elements.updateKeyBtn.disabled = false;
        this.elements.updateKeyBtn.textContent = 'Update Key';
        return;
      }
      this.applyToneClass(this.elements.statusBar, 'status-bar', 'active');
      this.elements.statusMessage.textContent = data.state === 'transcoding'
        ? 'Transcoding in Progress'
        : 'Ripping in Progress';
      this.elements.updateKeyBtn.classList.remove('visible');
      this.elements.updateKeyBtn.disabled = false;
      this.elements.updateKeyBtn.textContent = 'Update Key';
      return;
    }

    const tone = this.toneFromKeyStatus(data.keyStatus || {});
    this.applyToneClass(this.elements.statusBar, 'status-bar', tone);
    this.elements.statusMessage.textContent = data.keyStatus?.message || 'Key status unavailable';

    const shouldShowUpdate = tone === 'warn';
    this.elements.updateKeyBtn.classList.toggle('visible', shouldShowUpdate);
    this.elements.updateKeyBtn.disabled = false;
    this.elements.updateKeyBtn.textContent = 'Update Key';
  }

  renderPosterState(data) {
    const activeRip = data.state === 'ripping' || Boolean(data.rip?.active);
    const activeTranscode = data.state === 'transcoding' || Boolean(data.transcode?.active);

    if (activeRip) {
      this.applyToneClass(this.elements.posterBox, 'poster', 'status-active');
      this.applyToneClass(this.elements.posterStatus, 'poster-status', 'ripping');
      this.elements.posterStatus.textContent = '◉';
      this.elements.posterStatus.title = 'Ripping in progress';
      return;
    }

    if (activeTranscode) {
      this.applyToneClass(this.elements.posterBox, 'poster', 'status-active');
      this.applyToneClass(this.elements.posterStatus, 'poster-status', 'transcoding');
      this.elements.posterStatus.textContent = '◉↺';
      this.elements.posterStatus.title = 'Transcoding in progress';
      return;
    }

    const tone = this.toneFromKeyStatus(data.keyStatus || {});
    this.applyToneClass(this.elements.posterBox, 'poster', `status-${tone}`);

    const symbol = tone === 'good' ? '✓' : (tone === 'bad' ? 'X' : '-');
    this.applyToneClass(this.elements.posterStatus, 'poster-status', tone);
    this.elements.posterStatus.textContent = symbol;
    this.elements.posterStatus.title = '';
  }

  renderPoster(media) {
    const url = String(media?.posterUrl || '').trim();
    if (url) {
      this.elements.posterImg.src = url;
      this.elements.posterImg.style.display = 'block';
      this.elements.posterFallback.style.display = 'none';
      return;
    }

    this.elements.posterImg.removeAttribute('src');
    this.elements.posterImg.style.display = 'none';
    this.elements.posterFallback.style.display = 'block';
    this.elements.posterFallback.textContent = media?.title ? `No cover for ${media.title}` : 'No cover art';
  }

  renderPrimaryCard(data) {
    const title = data.media?.title || data.rip?.title || data.rip?.discLabel || 'Current Rip';
    this.elements.movieTitle.textContent = title;

    if (data.state === 'ripping') {
      this.elements.movieSubline.textContent = `Ripping from ${data.rip?.discLabel || 'disc source'}`;
    } else if (data.state === 'transcoding') {
      this.elements.movieSubline.textContent = 'Transcoding in progress';
    } else if (data.state === 'transcode_failed') {
      this.elements.movieSubline.textContent = 'Transcode Failed';
    } else {
      this.elements.movieSubline.textContent = 'Active job detected';
    }

    const progressPct = Number.isFinite(data.rip?.progressPct)
      ? data.rip.progressPct
      : (Number.isFinite(data.transcode?.progressPct) ? data.transcode.progressPct : 0);
    this.elements.progressBar.style.width = `${Math.max(0, Math.min(100, progressPct))}%`;

    const ripProgressText = Number.isFinite(data.rip?.progressPct) ? `${data.rip.progressPct.toFixed(1)}%` : '';
    this.elements.ripProgress.textContent = ripProgressText;
    this.setRowVisible(this.elements.rowRipProgress, Boolean(ripProgressText));

    const ripEtaText = this.formatEta(data.rip?.etaSec);
    this.elements.ripEta.textContent = ripEtaText;
    this.setRowVisible(this.elements.rowRipEta, Boolean(ripEtaText));

    const transcodeProgressText = Number.isFinite(data.transcode?.progressPct) ? `${data.transcode.progressPct.toFixed(1)}%` : '';
    this.elements.transcodeProgress.textContent = transcodeProgressText;
    this.setRowVisible(this.elements.rowTranscodeProgress, Boolean(transcodeProgressText));

    const transcodeEtaText = this.formatEta(data.transcode?.etaSec);
    this.elements.transcodeEta.textContent = transcodeEtaText;
    this.setRowVisible(this.elements.rowTranscodeEta, Boolean(transcodeEtaText));

    const fpsText = Number.isFinite(data.transcode?.fps) ? `${data.transcode.fps.toFixed(1)} fps` : '';
    this.elements.fps.textContent = fpsText;
    this.setRowVisible(this.elements.rowFps, Boolean(fpsText));

    const codecText = String(data.transcode?.codec || '').trim();
    this.elements.codec.textContent = codecText;
    this.setRowVisible(this.elements.rowCodec, Boolean(codecText));

    const gpu = String(data.transcode?.gpuDetail || '').trim().toLowerCase();
    const gpuText = gpu && gpu !== 'unknown' ? gpu : '';
    this.elements.gpu.textContent = gpuText;
    this.setRowVisible(this.elements.rowGpu, Boolean(gpuText));

    this.renderPoster(data.media || {});
    this.renderPosterState(data);

    const baseIssues = Array.isArray(data.issues) ? data.issues : [];
    const transcodeErrors = (data.state === 'transcode_failed' && data.transcode?.errorMessage)
      ? [data.transcode.errorMessage]
      : [];
    const issues = [...transcodeErrors, ...baseIssues];
    if (issues.length) {
      this.elements.issues.style.display = 'block';
      this.elements.issues.innerHTML = issues.map((issue) => `- ${issue}`).join('<br>');
    } else {
      this.elements.issues.style.display = 'none';
      this.elements.issues.innerHTML = '';
    }
  }

  makeSecondaryCard(item) {
    const card = document.createElement('div');
    card.className = 'secondary-card';

    const thumb = document.createElement('div');
    thumb.className = 'secondary-thumb';

    const img = document.createElement('img');
    img.alt = `Poster for ${item.title || 'completed rip'}`;
    const noArt = document.createElement('div');
    noArt.textContent = 'No art';

    const posterUrl = String(item.posterUrl || '').trim();
    if (posterUrl) {
      img.src = posterUrl;
      img.style.display = 'block';
      noArt.style.display = 'none';
    } else {
      img.style.display = 'none';
      noArt.style.display = 'block';
    }

    thumb.appendChild(img);
    thumb.appendChild(noArt);

    const meta = document.createElement('div');
    meta.className = 'secondary-meta';

    const title = document.createElement('div');
    title.className = 'secondary-title';
    title.textContent = String(item.title || 'Unknown title').toUpperCase();

    const status = document.createElement('div');
    status.className = 'secondary-status';
    status.textContent = 'Completed';

    meta.appendChild(title);
    meta.appendChild(status);

    card.appendChild(thumb);
    card.appendChild(meta);
    return card;
  }

  renderHistory(data) {
    const history = Array.isArray(data.history) ? data.history : [];
    this.elements.historyList.innerHTML = '';

    if (!history.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-history';
      empty.textContent = 'No completed rips recorded yet.';
      this.elements.historyList.appendChild(empty);
      return;
    }

    history.forEach((item) => {
      this.elements.historyList.appendChild(this.makeSecondaryCard(item));
    });
  }

  renderHealth(data, stale = false) {
    const updatedDate = data.updatedAt ? new Date(data.updatedAt) : new Date();
    this.elements.updatedAt.textContent = `${stale ? 'Stale' : 'Updated'}: ${updatedDate.toLocaleTimeString()}`;

    this.renderStatusBar(data);

    const active = this.isActiveMode(data);
    this.elements.mainScreen.classList.toggle('mode-active', active);
    this.elements.mainScreen.classList.toggle('mode-idle', !active);

    if (active) {
      this.renderPrimaryCard(data);
    } else {
      this.elements.issues.style.display = 'none';
      this.elements.issues.innerHTML = '';
    }

    this.renderHistory(data);
    this.updateFocus();
  }

  scheduleNextPoll() {
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.fetchAndRenderHealth(), this.pollMs);
  }

  async fetchAndRenderHealth(manual = false) {
    if (this.pollAbort) this.pollAbort.abort();
    const controller = new AbortController();
    this.pollAbort = controller;

    try {
      const response = await fetch('/api/arm-watch/health', { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || data.message || `HTTP ${response.status}`);
      }

      this.lastGoodData = data;
      this.failCount = 0;
      this.pollMs = 2000;
      this.renderHealth(data, false);
    } catch (error) {
      const msg = (error && error.message) ? String(error.message) : '';
      const isAbort = Boolean(
        error?.name === 'AbortError'
        || /aborted/i.test(msg)
        || msg === 'signal is aborted without reason'
      );
      if (isAbort) return;

      this.failCount += 1;
      this.pollMs = this.failCount >= 2 ? 5000 : 2000;

      if (this.lastGoodData) {
        const staleData = {
          ...this.lastGoodData,
          issues: [...(this.lastGoodData.issues || []), `Live update failed: ${error.message}`],
        };
        this.renderHealth(staleData, true);
      } else {
        this.renderHealth({
          state: 'error',
          updatedAt: Date.now(),
          rip: {},
          transcode: {},
          media: {},
          keyStatus: {
            state: 'error',
            severity: 'red',
            message: error.message || 'Health fetch failed',
          },
          history: [],
          issues: [error.message || 'Health fetch failed'],
        }, false);
      }
    } finally {
      if (!manual) this.scheduleNextPoll();
      if (this.pollAbort === controller) this.pollAbort = null;
    }
  }

  async fetchJson(url, options = {}, timeoutMs = 9000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      let json = {};
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error(text);
        }
      }
      if (!response.ok) {
        throw new Error(json.error || json.message || `HTTP ${response.status}`);
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  async applyLatestKey() {
    this.elements.updateKeyBtn.disabled = true;
    const oldText = this.elements.updateKeyBtn.textContent;
    this.elements.updateKeyBtn.textContent = 'Updating...';

    try {
      const keyStatus = await this.fetchJson('/api/arm-watch/key-status');
      const internetKey = keyStatus.internetKey;
      if (!internetKey) throw new Error('No internet key configured on server');

      await this.fetchJson('/api/arm-watch/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newKey: internetKey }),
      });

      this.elements.updateKeyBtn.textContent = 'Updated';
      setTimeout(() => {
        this.elements.updateKeyBtn.textContent = oldText;
        this.elements.updateKeyBtn.disabled = false;
      }, 900);
      this.fetchAndRenderHealth(true);
    } catch (error) {
      this.elements.updateKeyBtn.textContent = 'Failed';
      setTimeout(() => {
        this.elements.updateKeyBtn.textContent = oldText;
        this.elements.updateKeyBtn.disabled = false;
      }, 1500);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ArmWatchApp();
});
