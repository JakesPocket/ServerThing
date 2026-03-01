class MakeMkvMonitorApp {
  constructor() {
    this.elements = {
      mainScreen: document.getElementById('main-screen'),
      settingsScreen: document.getElementById('settings-screen'),
      updatedAt: document.getElementById('updated-at'),
      posterBox: document.getElementById('poster-box'),
      hero: document.getElementById('hero'),
      posterImg: document.getElementById('poster-img'),
      posterFallback: document.getElementById('poster-fallback'),
      posterStatusIcon: document.getElementById('poster-status-icon'),
      movieTitle: document.getElementById('movie-title'),
      movieSubline: document.getElementById('movie-subline'),
      keyCompare: document.getElementById('key-compare'),
      keyExpiry: document.getElementById('key-expiry'),
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
      keyChip: document.getElementById('key-chip'),
      driveChip: document.getElementById('drive-chip'),
      readyChip: document.getElementById('ready-chip'),
      issues: document.getElementById('issues'),
      historyCard: document.getElementById('history-card'),
      historyPosterImg: document.getElementById('history-poster-img'),
      historyPosterFallback: document.getElementById('history-poster-fallback'),
      historyTitle: document.getElementById('history-title'),
      applyKeyBtn: document.getElementById('apply-key-btn'),
      refreshBtn: document.getElementById('refresh-btn'),
      settingsBtn: document.getElementById('settings-btn'),
      backBtn: document.getElementById('back-btn'),
    };

    this.isSettingsVisible = false;
    this.focusedIndex = 0;
    this.pollMs = 2000;
    this.failCount = 0;
    this.pollTimer = null;
    this.pollAbort = null;
    this.lastGoodData = null;
    this.lastCompletedMedia = { title: '', posterUrl: '' };

    this.init();
  }

  init() {
    this.addEventListeners();
    this.fetchAndRenderHealth();
    this.sendNavState(true);
  }

  addEventListeners() {
    window.addEventListener('message', (event) => this.handleShellMessage(event));
    this.elements.refreshBtn.addEventListener('click', () => this.fetchAndRenderHealth(true));
    this.elements.settingsBtn.addEventListener('click', () => this.showSettings());
    this.elements.backBtn.addEventListener('click', () => this.showMain());
    this.elements.applyKeyBtn.addEventListener('click', () => this.applyLatestKey());
  }

  handleShellMessage(event) {
    if (event.source !== window.parent) return;
    const message = event.data || {};

    if (message.type === 'HARDWARE_EVENT' && message.data) {
      this.handleHardwareInput(message.data);
    } else if (message.type === 'CMD_BACK') {
      if (this.isSettingsVisible) this.showMain();
    } else if (message.type === 'DIM_APP_FOCUS') {
      this.getFocusableElements().forEach((el) => el.classList.remove('focused'));
    } else if (message.type === 'ZONE_FOCUS' && message.active) {
      this.updateFocus();
    }
  }

  handleHardwareInput(input) {
    const type = String(input.type || '').toUpperCase();
    const value = String(input.value || '').toUpperCase();
    if (!type || !value) return;

    if (this.isSettingsVisible) {
      if (type === 'BUTTON' && (value === 'DIAL_CLICK_DOWN' || value === 'BACK_BUTTON_DOWN')) {
        this.showMain();
      }
      return;
    }

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
    return this.isSettingsVisible
      ? [this.elements.backBtn]
      : [this.elements.applyKeyBtn, this.elements.refreshBtn, this.elements.settingsBtn];
  }

  updateFocus() {
    const focusable = this.getFocusableElements();
    focusable.forEach((el, index) => {
      el.classList.toggle('focused', index === this.focusedIndex);
    });
  }

  showSettings() {
    this.isSettingsVisible = true;
    this.focusedIndex = 0;
    this.elements.mainScreen.classList.remove('active');
    this.elements.settingsScreen.classList.add('active');
    this.sendNavState(false);
    this.updateFocus();
  }

  showMain() {
    this.isSettingsVisible = false;
    this.focusedIndex = 0;
    this.elements.settingsScreen.classList.remove('active');
    this.elements.mainScreen.classList.add('active');
    this.sendNavState(true);
    this.updateFocus();
  }

  sendNavState(isAtRoot) {
    window.parent.postMessage({ type: 'APP_NAV_STATE', atRoot: isAtRoot }, location.origin);
  }

  formatEta(sec) {
    if (!Number.isFinite(sec) || sec <= 0) return '';
    const s = Math.floor(sec % 60);
    const m = Math.floor((sec / 60) % 60);
    const h = Math.floor(sec / 3600);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  }

  setRowVisible(rowEl, visible) {
    if (!rowEl) return;
    rowEl.style.display = visible ? 'block' : 'none';
  }

  renderChips(data) {
    const keyState = data.keyStatus?.state || 'unknown';
    this.elements.keyChip.textContent = `License: ${keyState}`;
    this.elements.keyChip.className = 'chip';
    if (keyState === 'valid') this.elements.keyChip.classList.add('good');
    else if (keyState === 'expired' || keyState === 'missing') this.elements.keyChip.classList.add('warn');
    else if (keyState === 'error') this.elements.keyChip.classList.add('bad');

    const driveText = data.drive?.detected ? `Drive: ${data.drive.count} detected` : 'Drive: none';
    this.elements.driveChip.textContent = driveText;
    this.elements.driveChip.className = `chip ${data.drive?.detected ? 'good' : 'warn'}`;

    const ready = !!data.readyToRip;
    this.elements.readyChip.textContent = ready ? 'Ready: yes' : 'Ready: no';
    this.elements.readyChip.className = `chip ${ready ? 'good' : 'warn'}`;
  }

  renderHero(data) {
    this.elements.hero.className = 'hero';
    if (data.state === 'ripping') {
      this.elements.hero.classList.add('ripping');
      this.elements.hero.textContent = 'Ripping in Progress';
      return;
    }
    if (data.state === 'transcoding') {
      this.elements.hero.classList.add('transcoding');
      this.elements.hero.textContent = 'Transcoding in Progress';
      return;
    }
    if (data.state === 'error' || data.state === 'degraded') {
      this.elements.hero.classList.add('error');
      this.elements.hero.textContent = 'System Needs Attention';
      return;
    }
    if (data.readyToRip) {
      this.elements.hero.classList.add('idle-good');
      this.elements.hero.textContent = 'Ready to Rip';
      return;
    }
    this.elements.hero.classList.add('idle-bad');
    this.elements.hero.textContent = 'Not Ready to Rip';
  }

  renderPoster(media) {
    const url = media?.posterUrl || '';
    if (url) {
      this.elements.posterImg.src = url;
      this.elements.posterImg.style.display = 'block';
      this.elements.posterFallback.style.display = 'none';
    } else {
      this.elements.posterImg.removeAttribute('src');
      this.elements.posterImg.style.display = 'none';
      this.elements.posterFallback.style.display = 'block';
      this.elements.posterFallback.textContent = media?.title ? `No cover for ${media.title}` : 'No cover art';
    }
  }

  getKeyVisualStatus(data) {
    const keyState = data.keyStatus?.state || 'unknown';
    const statusMessage = String(data.keyStatus?.message || '').toLowerCase();
    const isDateExpired = keyState === 'expired' && statusMessage.includes('expired');

    if (keyState === 'valid') {
      return { tone: 'good', symbol: '✓' };
    }
    if (keyState === 'error' || isDateExpired) {
      return { tone: 'bad', symbol: 'X' };
    }
    return { tone: 'warn', symbol: '-' };
  }

  renderPosterStatusLight(data) {
    const visual = this.getKeyVisualStatus(data);

    this.elements.posterBox.className = 'poster';
    if (visual.tone === 'good') {
      this.elements.posterBox.classList.add('status-good');
    } else if (visual.tone === 'bad') {
      this.elements.posterBox.classList.add('status-bad');
    } else {
      this.elements.posterBox.classList.add('status-warn');
    }

    this.elements.posterStatusIcon.className = `poster-status-icon ${visual.tone}`;
    this.elements.posterStatusIcon.textContent = visual.symbol;
  }

  renderKeyMonitor(data) {
    const state = data.keyStatus?.state || 'unknown';
    const localMatch = data.keyStatus?.localMatch;

    let compareText = 'Local/public beta comparison unavailable';
    const statusMessage = String(data.keyStatus?.message || '').toLowerCase();
    const isDateExpired = state === 'expired' && statusMessage.includes('expired');

    if (state === 'valid' && localMatch) {
      compareText = 'Local key matches public beta key';
    } else if (isDateExpired) {
      compareText = 'Public beta key is expired';
    } else if (state === 'expired') {
      compareText = 'Local key does not match current public beta key';
    } else if (state === 'missing') {
      compareText = 'Local key missing in settings.conf';
    } else if (state === 'error') {
      compareText = data.keyStatus?.message || 'Beta key monitor unavailable';
    }

    const expiresOn = String(data.keyStatus?.expiresOn || '').trim();
    const expiryText = expiresOn ? `Public beta expiry: ${expiresOn}` : 'Public beta expiry: unknown';

    this.elements.keyCompare.textContent = compareText;
    this.elements.keyExpiry.textContent = expiryText;
  }

  isActiveMode(data) {
    return data.state === 'ripping'
      || data.state === 'transcoding'
      || Boolean(data.rip?.active)
      || Boolean(data.transcode?.active);
  }

  renderLayoutMode(data) {
    const active = this.isActiveMode(data);
    this.elements.mainScreen.classList.toggle('mode-active', active);
    this.elements.mainScreen.classList.toggle('mode-idle', !active);
  }

  renderRecentHistory(data) {
    const candidateTitle = String(data.rip?.title || data.media?.title || data.rip?.discLabel || '').trim();
    const candidatePoster = String(data.media?.posterUrl || '').trim();
    const ignoreTitle = !candidateTitle || /^no active media$/i.test(candidateTitle);

    if (!ignoreTitle) {
      this.lastCompletedMedia.title = candidateTitle;
      if (candidatePoster) this.lastCompletedMedia.posterUrl = candidatePoster;
    }

    const historyTitle = this.lastCompletedMedia.title
      ? this.lastCompletedMedia.title.toUpperCase()
      : 'No completed rip yet';
    this.elements.historyTitle.textContent = historyTitle;

    if (this.lastCompletedMedia.posterUrl) {
      this.elements.historyPosterImg.src = this.lastCompletedMedia.posterUrl;
      this.elements.historyPosterImg.style.display = 'block';
      this.elements.historyPosterFallback.style.display = 'none';
    } else {
      this.elements.historyPosterImg.removeAttribute('src');
      this.elements.historyPosterImg.style.display = 'none';
      this.elements.historyPosterFallback.style.display = 'block';
      this.elements.historyPosterFallback.textContent = 'No art';
    }
  }

  renderIssues(issues) {
    if (!issues || !issues.length) {
      this.elements.issues.style.display = 'none';
      this.elements.issues.innerHTML = '';
      return;
    }
    this.elements.issues.style.display = 'block';
    this.elements.issues.innerHTML = issues.map((issue) => `- ${issue}`).join('<br>');
  }

  renderHealth(data, stale = false) {
    const active = this.isActiveMode(data);
    this.renderLayoutMode(data);
    const updatedDate = data.updatedAt ? new Date(data.updatedAt) : new Date();
    this.elements.updatedAt.textContent = `${stale ? 'Stale' : 'Updated'}: ${updatedDate.toLocaleTimeString()}`;
    this.renderHero(data);

    if (active) {
      const title = data.media?.title || data.rip?.title || data.rip?.discLabel || 'No active media';
      this.elements.movieTitle.textContent = title;
      if (data.state === 'ripping') {
        this.elements.movieSubline.textContent = `Ripping from ${data.rip?.discLabel || 'disc source'}`;
      } else if (data.state === 'transcoding') {
        this.elements.movieSubline.textContent = 'Transcoding active';
      } else {
        this.elements.movieSubline.textContent = data.keyStatus?.message || 'Active';
      }
      this.renderPoster(data.media || {});
    } else {
      this.elements.movieTitle.textContent = 'MakeMKV Beta Key Status';
      this.elements.movieSubline.textContent = 'Local vs public beta key monitor';
      this.renderPoster({ posterUrl: '', title: 'MakeMKV Beta Key Status' });
    }

    const progressPct =
      Number.isFinite(data.rip?.progressPct) ? data.rip.progressPct :
      Number.isFinite(data.transcode?.progressPct) ? data.transcode.progressPct :
      0;
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

    const codecText = (data.transcode?.codec || '').trim();
    this.elements.codec.textContent = codecText;
    this.setRowVisible(this.elements.rowCodec, Boolean(codecText));

    const gpuValue = (data.transcode?.gpuDetail || '').trim().toLowerCase();
    const gpuText = gpuValue && gpuValue !== 'unknown' ? gpuValue : '';
    this.elements.gpu.textContent = gpuText;
    this.setRowVisible(this.elements.rowGpu, Boolean(gpuText));

    this.renderPosterStatusLight(data);
    this.renderKeyMonitor(data);
    this.renderRecentHistory(data);
    this.renderChips(data);
    this.renderIssues(data.issues || []);
    this.updateFocus();
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

  scheduleNextPoll() {
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.fetchAndRenderHealth(), this.pollMs);
  }

  async fetchAndRenderHealth(manual = false) {
    if (this.pollAbort) this.pollAbort.abort();
    const controller = new AbortController();
    this.pollAbort = controller;

    try {
      const response = await fetch('/api/makemkv-key/health', { signal: controller.signal });
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
        error?.name === 'AbortError' ||
        /aborted/i.test(msg) ||
        msg === 'signal is aborted without reason'
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
          keyStatus: { state: 'error', message: 'No telemetry yet' },
          readyToRip: false,
          issues: [error.message || 'Health fetch failed'],
          drive: { detected: false, count: 0, devices: [] },
        }, false);
      }
    } finally {
      if (!manual) this.scheduleNextPoll();
      if (this.pollAbort === controller) this.pollAbort = null;
    }
  }

  async applyLatestKey() {
    this.elements.applyKeyBtn.disabled = true;
    const oldText = this.elements.applyKeyBtn.textContent;
    this.elements.applyKeyBtn.textContent = 'Applying...';

    try {
      const keyStatus = await this.fetchJson('/api/makemkv-key/key-status');
      const internetKey = keyStatus.internetKey;
      if (!internetKey) throw new Error('No internet key configured on server');

      await this.fetchJson('/api/makemkv-key/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newKey: internetKey }),
      });

      this.elements.applyKeyBtn.textContent = 'Applied';
      setTimeout(() => {
        this.elements.applyKeyBtn.textContent = oldText;
        this.elements.applyKeyBtn.disabled = false;
      }, 1000);
      this.fetchAndRenderHealth(true);
    } catch (error) {
      this.elements.applyKeyBtn.textContent = 'Failed';
      const currentIssues = this.lastGoodData?.issues || [];
      this.renderIssues([...currentIssues, `Apply key failed: ${error.message}`]);
      setTimeout(() => {
        this.elements.applyKeyBtn.textContent = oldText;
        this.elements.applyKeyBtn.disabled = false;
      }, 1600);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new MakeMkvMonitorApp();
});
