const { execFile } = require('child_process');
const express = require('express');

const POSTER_TTL_MS = 6 * 60 * 60 * 1000;
const posterCache = new Map();

function getConfig() {
  return {
    host: process.env.MAKEMKV_HOST || '10.0.0.10',
    user: process.env.MAKEMKV_USER || 'me',
    sshKeyPath: process.env.MAKEMKV_SSH_KEY_PATH || '',
    settingsPath: process.env.MAKEMKV_SETTINGS_PATH || '/home/me/docker/acquisition/arm/.MakeMKV/settings.conf',
    ripLogPath: process.env.MAKEMKV_RIP_LOG_PATH || '/home/me/docker/acquisition/arm/logs/makemkv.log',
    transcodeLogPath: process.env.MAKEMKV_TRANSCODE_LOG_PATH || '/home/me/docker/acquisition/arm/logs/transcode.log',
    internetKey: process.env.MAKEMKV_INTERNET_KEY || 'T-URt6MHxNy3HmfVojU8pE05WQ6HfgVI8S@HiIeNcWFim9rBgNlOdLFROSATCsWikcKW',
    internetExpiry: process.env.MAKEMKV_INTERNET_EXPIRY || '2026-03-31',
    omdbKey: process.env.OMDB_API_KEY || '',
  };
}

function validateConfig(cfg) {
  const missing = [];
  if (!cfg.sshKeyPath) missing.push('MAKEMKV_SSH_KEY_PATH');
  return missing;
}

function shSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function shDoubleQuoteEscape(value) {
  return String(value).replace(/["\\$`]/g, '\\$&');
}

function sedReplacementEscape(value) {
  return shDoubleQuoteEscape(String(value)).replace(/[&|]/g, '\\$&');
}

function parsePercent(text) {
  if (!text) return null;
  const match = text.match(/(\d{1,3}(?:\.\d+)?)%/);
  if (!match) return null;
  const pct = Number(match[1]);
  if (Number.isNaN(pct)) return null;
  return Math.max(0, Math.min(100, pct));
}

function parseEtaSec(text) {
  if (!text) return null;
  const hms = text.match(/\bETA[:=\s]+(?:(\d+):)?(\d{1,2}):(\d{2})\b/i);
  if (hms) {
    const h = Number(hms[1] || 0);
    const m = Number(hms[2] || 0);
    const s = Number(hms[3] || 0);
    return h * 3600 + m * 60 + s;
  }
  const mins = text.match(/\bETA[:=\s]+(\d+)\s*(?:m|min|mins|minute|minutes)\b/i);
  if (mins) return Number(mins[1]) * 60;
  return null;
}

function parseLocalKey(settingsContent) {
  const quoted = settingsContent.match(/^\s*app_Key\s*=\s*"([^"]*)"/m);
  if (quoted && quoted[1]) return quoted[1].trim();
  const unquoted = settingsContent.match(/^\s*app_Key\s*=\s*([^\s#]+)\s*$/m);
  if (unquoted && unquoted[1]) return unquoted[1].trim();
  return '';
}

function parseRipLog(text) {
  const lower = text.toLowerCase();
  const active = /(makemkvcon|ripping|saving title|copy complete|title #\d+)/i.test(text) &&
    !/(idle|waiting for disc|no disc)/i.test(text);

  const titleMatch =
    text.match(/title(?:\s+name)?\s*[:=]\s*["']?(.+?)["']?$/im) ||
    text.match(/Saving\s+title\s+\d+\s+into\s+file\s+["']?(.+?)["']?$/im) ||
    text.match(/CINFO:\d+,\d+,"([^"]+)"/i);
  const discLabelMatch =
    text.match(/disc(?:\s+label)?\s*[:=]\s*["']?(.+?)["']?$/im) ||
    text.match(/DRV:\d+,\d+,\d+,\d+,"([^"]+)"/i);

  const phase = active ? 'ripping' : 'idle';
  const progressPct = parsePercent(text);
  const etaSec = parseEtaSec(text);

  return {
    active,
    title: titleMatch ? titleMatch[1].trim() : '',
    discLabel: discLabelMatch ? discLabelMatch[1].trim() : '',
    progressPct,
    phase,
    etaSec,
  };
}

function parseTranscodeLog(text) {
  const lower = text.toLowerCase();
  const active = /(ffmpeg|handbrake|transcod|encoding|x26[45]|vaapi|nvenc|qsv)/i.test(text) &&
    !/(transcode complete|finished encoding|idle)/i.test(text);

  const fpsMatch = text.match(/\b(?:fps|frame(?:s)?\/s)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  const speedMatch = text.match(/\bspeed\s*[:=]?\s*(\d+(?:\.\d+)?)x/i);
  const codecMatch =
    text.match(/\b(libx264|libx265|h264|h265|hevc|av1)\b/i) ||
    text.match(/\bVideo:\s*([a-zA-Z0-9_]+)/i);

  let gpuMode = 'unknown';
  let gpuDetail = 'unknown';
  if (/(vaapi|nvenc|qsv|vulkan|amf)/i.test(lower)) {
    gpuMode = 'gpu';
    const detail = lower.match(/(vaapi|nvenc|qsv|vulkan|amf)/i);
    gpuDetail = detail ? detail[1].toLowerCase() : 'gpu';
  } else if (/(libx264|libx265|software|cpu)/i.test(lower)) {
    gpuMode = 'cpu';
    gpuDetail = 'software';
  }

  return {
    active,
    progressPct: parsePercent(text),
    fps: fpsMatch ? Number(fpsMatch[1]) : null,
    speedX: speedMatch ? Number(speedMatch[1]) : null,
    codec: codecMatch ? codecMatch[1].toLowerCase() : '',
    gpuMode,
    gpuDetail,
    etaSec: parseEtaSec(text),
  };
}

function computeKeyStatus(localKey, internetKey, internetExpiry, errors) {
  if (errors && errors.length) {
    return {
      state: 'error',
      localMatch: false,
      expiresOn: internetExpiry || null,
      message: errors.join('; '),
      localKey,
      internetKey,
    };
  }
  if (!localKey) {
    return {
      state: 'missing',
      localMatch: false,
      expiresOn: internetExpiry || null,
      message: 'Local key missing',
      localKey,
      internetKey,
    };
  }
  if (!internetKey) {
    return {
      state: 'unknown',
      localMatch: false,
      expiresOn: internetExpiry || null,
      message: 'No internet reference key configured',
      localKey,
      internetKey,
    };
  }
  const localMatch = localKey === internetKey;
  return {
    state: localMatch ? 'valid' : 'expired',
    localMatch,
    expiresOn: internetExpiry || null,
    message: localMatch ? 'Ready' : 'Outdated key',
    localKey,
    internetKey,
  };
}

function computeOverallState({ rip, transcode, keyStatus, issues }) {
  if (issues.length > 0) return 'error';
  if (rip.active) return 'ripping';
  if (transcode.active) return 'transcoding';
  if (keyStatus.state === 'error') return 'degraded';
  return 'idle';
}

async function fetchPoster(title, omdbKey) {
  if (!title || !omdbKey) return null;
  const cacheKey = title.toLowerCase();
  const cached = posterCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdbKey)}&t=${encodeURIComponent(title)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const json = await response.json();
    if (json.Response !== 'True') return null;
    const value = {
      posterUrl: json.Poster && json.Poster !== 'N/A' ? json.Poster : '',
      title: json.Title || title,
      year: json.Year || '',
    };
    posterCache.set(cacheKey, { value, expiresAt: now + POSTER_TTL_MS });
    return value;
  } catch {
    return null;
  }
}

function runSsh(cfg, remoteCmd) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', cfg.sshKeyPath,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=6',
      `${cfg.user}@${cfg.host}`,
      remoteCmd,
    ];

    execFile('ssh', args, { timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr ? stderr.trim() : error.message;
        reject(new Error(message || 'SSH command failed'));
        return;
      }
      resolve((stdout || '').trim());
    });
  });
}

async function readRemoteFile(cfg, path) {
  const cmd = `cat ${shSingleQuote(path)} 2>/dev/null || true`;
  return runSsh(cfg, cmd);
}

async function detectDrive(cfg) {
  try {
    const out = await runSsh(cfg, "ls /dev/sr* /dev/cdrom* 2>/dev/null || true");
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function getTelemetry(cfg) {
  const issues = [];
  const settingsText = await readRemoteFile(cfg, cfg.settingsPath);
  if (!settingsText) issues.push('Unable to read settings.conf');

  const ripText = await readRemoteFile(cfg, cfg.ripLogPath);
  if (!ripText) issues.push(`Unable to read rip log at ${cfg.ripLogPath}`);

  const transText = await readRemoteFile(cfg, cfg.transcodeLogPath);
  if (!transText) issues.push(`Unable to read transcode log at ${cfg.transcodeLogPath}`);

  const drives = await detectDrive(cfg);
  const localKey = parseLocalKey(settingsText || '');
  const keyStatus = computeKeyStatus(localKey, cfg.internetKey, cfg.internetExpiry, settingsText ? [] : ['settings.conf unavailable']);
  const rip = parseRipLog(ripText || '');
  const transcode = parseTranscodeLog(transText || '');

  return { issues, rip, transcode, keyStatus, drives };
}

async function buildHealth(cfg) {
  const cfgMissing = validateConfig(cfg);
  if (cfgMissing.length > 0) {
    return {
      state: 'error',
      updatedAt: Date.now(),
      rip: { active: false, title: '', discLabel: '', progressPct: null, phase: 'idle', etaSec: null },
      transcode: { active: false, progressPct: null, fps: null, speedX: null, codec: '', gpuMode: 'unknown', gpuDetail: 'unknown', etaSec: null },
      media: { posterUrl: '', title: '', year: '' },
      keyStatus: {
        state: 'error',
        localMatch: false,
        expiresOn: cfg.internetExpiry || null,
        message: `Missing config: ${cfgMissing.join(', ')}`,
      },
      readyToRip: false,
      issues: [`Missing config: ${cfgMissing.join(', ')}`],
      drive: { detected: false, count: 0, devices: [] },
    };
  }

  try {
    const { issues, rip, transcode, keyStatus, drives } = await getTelemetry(cfg);
    const title = rip.title || rip.discLabel || '';
    const media = (await fetchPoster(title, cfg.omdbKey)) || { posterUrl: '', title, year: '' };
    const state = computeOverallState({ rip, transcode, keyStatus, issues });
    const driveDetected = drives.length > 0;
    const readyToRip = state === 'idle' && keyStatus.state === 'valid' && driveDetected;

    return {
      state,
      updatedAt: Date.now(),
      rip,
      transcode,
      media,
      keyStatus: {
        state: keyStatus.state,
        localMatch: keyStatus.localMatch,
        expiresOn: keyStatus.expiresOn,
        message: keyStatus.message,
      },
      readyToRip,
      issues,
      drive: {
        detected: driveDetected,
        count: drives.length,
        devices: drives,
      },
    };
  } catch (error) {
    return {
      state: 'error',
      updatedAt: Date.now(),
      rip: { active: false, title: '', discLabel: '', progressPct: null, phase: 'idle', etaSec: null },
      transcode: { active: false, progressPct: null, fps: null, speedX: null, codec: '', gpuMode: 'unknown', gpuDetail: 'unknown', etaSec: null },
      media: { posterUrl: '', title: '', year: '' },
      keyStatus: {
        state: 'error',
        localMatch: false,
        expiresOn: cfg.internetExpiry || null,
        message: error.message || 'Failed to gather telemetry',
      },
      readyToRip: false,
      issues: [error.message || 'Failed to gather telemetry'],
      drive: { detected: false, count: 0, devices: [] },
    };
  }
}

module.exports = {
  metadata: {
    name: 'MakeMKV Rip Monitor',
    description: 'Live rip/transcode monitor and license health for ARM MakeMKV host',
  },

  init({ app }) {
    app.get('/api/makemkv-key/health', async (req, res) => {
      const cfg = getConfig();
      const health = await buildHealth(cfg);
      res.json(health);
    });
    console.log('[MakeMKV App] Route /api/makemkv-key/health registered.');

    app.get('/api/makemkv-key/key-status', async (req, res) => {
      const cfg = getConfig();
      const missing = validateConfig(cfg);
      if (missing.length > 0) {
        return res.status(500).json({
          state: 'error',
          message: `Missing config: ${missing.join(', ')}`,
        });
      }

      try {
        const settingsText = await readRemoteFile(cfg, cfg.settingsPath);
        const localKey = parseLocalKey(settingsText || '');
        const status = computeKeyStatus(localKey, cfg.internetKey, cfg.internetExpiry, settingsText ? [] : ['settings.conf unavailable']);
        res.json({
          state: status.state,
          localMatch: status.localMatch,
          expiresOn: status.expiresOn,
          message: status.message,
          localKey: status.localKey,
          internetKey: status.internetKey,
        });
      } catch (error) {
        res.status(500).json({
          state: 'error',
          message: error.message || 'Failed to read key status',
        });
      }
    });
    console.log('[MakeMKV App] Route /api/makemkv-key/key-status registered.');

    app.get('/api/makemkv-key/localkey', async (req, res) => {
      const cfg = getConfig();
      const missing = validateConfig(cfg);
      if (missing.length > 0) {
        return res.status(500).json({ error: `Missing config: ${missing.join(', ')}` });
      }

      try {
        const settingsText = await readRemoteFile(cfg, cfg.settingsPath);
        const localKey = parseLocalKey(settingsText || '');
        if (!localKey) {
          return res.json({
            id: 'local',
            name: 'Local Config (ARM)',
            value: '',
            status: 'missing',
            expiry: 'Missing (will be added on update)',
          });
        }
        res.json({
          id: 'local',
          name: 'Local Config (ARM)',
          value: localKey,
          status: 'unknown',
          expiry: 'Unknown',
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch local key', details: error.message });
      }
    });
    console.log('[MakeMKV App] Route /api/makemkv-key/localkey registered.');

    app.post('/api/makemkv-key/update', express.json(), async (req, res) => {
      const cfg = getConfig();
      const missing = validateConfig(cfg);
      if (missing.length > 0) {
        return res.status(500).json({ error: `Missing config: ${missing.join(', ')}` });
      }

      const { newKey } = req.body || {};
      if (!newKey) {
        return res.status(400).json({ error: 'Missing newKey in request body' });
      }

      try {
        const escapedKey = shSingleQuote(newKey);
        const escapedForSed = sedReplacementEscape(newKey);
        const file = shSingleQuote(cfg.settingsPath);
        const cmd =
          `if grep -qE '^[[:space:]]*app_Key[[:space:]]*=' ${file}; then ` +
          `sed -i -E "s|^[[:space:]]*app_Key[[:space:]]*=.*$|app_Key = \\"${escapedForSed}\\"|" ${file}; ` +
          `else printf '\\napp_Key = "%s"\\n' ${escapedKey} >> ${file}; fi`;
        await runSsh(cfg, cmd);
        res.json({ success: true, message: 'Local key updated successfully.' });
      } catch (error) {
        res.status(500).json({ error: 'Failed to update local key', details: error.message });
      }
    });
    console.log('[MakeMKV App] Route /api/makemkv-key/update registered.');

    app.get('/apps/makemkv-key/status', (req, res) => {
      res.json({ status: 'ok', message: 'Rip monitor is running' });
    });
  },
};
