const { execFile } = require('child_process');
const express = require('express');
const path = require('path');

const POSTER_TTL_MS = 6 * 60 * 60 * 1000;
const posterCache = new Map();

function getConfig() {
  const defaultLogsDir = '/home/me/docker/acquisition/arm/logs';
  const defaultArmLogPath = `${defaultLogsDir}/arm.log`;
  return {
    apiMode: (process.env.MAKEMKV_API_MODE || '').trim().toLowerCase(),
    apiBaseUrl: process.env.MAKEMKV_API_BASE_URL || '',
    apiKey: process.env.MAKEMKV_API_KEY || process.env.ARM_API_KEY || '',
    armJsonPath: process.env.MAKEMKV_ARM_JSON_PATH || '/json',
    apiTelemetryPath: process.env.MAKEMKV_API_TELEMETRY_PATH || '/api/serverthing/telemetry',
    apiLocalKeyPath: process.env.MAKEMKV_API_LOCALKEY_PATH || '/api/serverthing/localkey',
    apiUpdateKeyPath: process.env.MAKEMKV_API_UPDATEKEY_PATH || '/api/serverthing/localkey',
    apiTimeoutMs: Number(process.env.MAKEMKV_API_TIMEOUT_MS || 10000),
    host: process.env.MAKEMKV_HOST || '10.0.0.10',
    user: process.env.MAKEMKV_USER || 'me',
    sshKeyPath: process.env.MAKEMKV_SSH_KEY_PATH || '',
    settingsPath: process.env.MAKEMKV_SETTINGS_PATH || '/home/me/docker/acquisition/arm/.MakeMKV/settings.conf',
    ripLogPath: process.env.MAKEMKV_RIP_LOG_PATH || defaultArmLogPath,
    transcodeLogPath: process.env.MAKEMKV_TRANSCODE_LOG_PATH || '/home/me/docker/acquisition/arm/logs/transcode.log',
    logsDir: process.env.MAKEMKV_LOGS_DIR || path.dirname(process.env.MAKEMKV_RIP_LOG_PATH || defaultArmLogPath),
    internetKey: process.env.MAKEMKV_INTERNET_KEY || 'T-URt6MHxNy3HmfVojU8pE05WQ6HfgVI8S@HiIeNcWFim9rBgNlOdLFROSATCsWikcKW',
    internetExpiry: process.env.MAKEMKV_INTERNET_EXPIRY || '2026-03-31',
    omdbKey: process.env.OMDB_API_KEY || '',
  };
}

function validateConfig(cfg) {
  const missing = [];
  if (cfg.apiBaseUrl) {
    if (cfg.apiMode !== 'arm-json' && !cfg.apiKey) missing.push('MAKEMKV_API_KEY (or ARM_API_KEY)');
  } else if (!cfg.sshKeyPath) {
    missing.push('MAKEMKV_SSH_KEY_PATH');
  }
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

  // MakeMKV emits progress lines like:
  // PRGV:<current>,<total>,<max>
  // Use the latest sample and prefer total/max for overall progress.
  const prgvMatches = Array.from(text.matchAll(/PRGV:(\d+),(\d+),(\d+)/g));
  let prgvProgressPct = null;
  let prgvActive = null;
  if (prgvMatches.length > 0) {
    const last = prgvMatches[prgvMatches.length - 1];
    const total = Number(last[2]);
    const max = Number(last[3]);
    if (Number.isFinite(total) && Number.isFinite(max) && max > 0) {
      prgvProgressPct = Math.max(0, Math.min(100, (total / max) * 100));
      prgvActive = total < max;
    }
  }

  const effectiveActive = (prgvActive !== null) ? prgvActive : active;
  let phase = effectiveActive ? 'ripping' : 'idle';
  let progressPct = (prgvProgressPct !== null) ? prgvProgressPct : parsePercent(text);
  const etaSec = parseEtaSec(text);

  // ARM wrapper fallback parsing (when PRGV lines are absent).
  // Example:
  // [ARM] Starting ARM for DVD on sr0
  // [ARM] Not CD, Blu-ray, DVD or Data. Bailing out on sr0
  const armEvents = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const start = line.match(/\[ARM\]\s+Starting ARM for\s+(.+?)\s+on\s+(\S+)/i);
    if (start) armEvents.push({ kind: 'start', media: start[1].trim(), device: start[2].trim(), idx: i });
    const bail = line.match(/\[ARM\]\s+Not CD, Blu-ray, DVD or Data\. Bailing out on\s+(\S+)/i);
    if (bail) armEvents.push({ kind: 'bail', media: 'unknown', device: bail[1].trim(), idx: i });
  }

  let arm = null;
  if (armEvents.length > 0) {
    const last = armEvents[armEvents.length - 1];
    arm = {
      event: last.kind,
      media: last.media,
      device: last.device,
      message: last.kind === 'bail'
        ? `Unsupported media detected on ${last.device}`
        : `ARM started for ${last.media} on ${last.device}`,
    };

    // If we don't have PRGV-based activity, use ARM event state.
    if (prgvProgressPct === null) {
      if (last.kind === 'start') {
        phase = 'ripping';
        progressPct = null;
      } else if (last.kind === 'bail') {
        phase = 'idle';
        progressPct = null;
      }
    }
  }

  return {
    active: prgvProgressPct !== null ? effectiveActive : phase === 'ripping',
    title: titleMatch ? titleMatch[1].trim() : '',
    discLabel: discLabelMatch ? discLabelMatch[1].trim() : '',
    progressPct,
    phase,
    etaSec,
    arm,
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
  const now = Date.now();
  const expiryTs = internetExpiry ? Date.parse(`${internetExpiry}T23:59:59Z`) : NaN;
  const hasExpiry = Number.isFinite(expiryTs);
  const dateValid = hasExpiry ? now <= expiryTs : null;

  if (!localKey) {
    if (dateValid === false) {
      return {
        state: 'expired',
        localMatch: false,
        expiresOn: internetExpiry || null,
        message: 'Beta key expired',
        localKey,
        internetKey,
      };
    }
    if (dateValid === true) {
      return {
        state: 'valid',
        localMatch: false,
        expiresOn: internetExpiry || null,
        message: 'Beta key date valid',
        localKey,
        internetKey,
      };
    }
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

function hasApiMode(cfg) {
  return Boolean(cfg.apiBaseUrl);
}

function useArmJsonApi(cfg) {
  return hasApiMode(cfg) && (cfg.apiMode === 'arm-json' || cfg.apiMode === '');
}

function buildApiUrl(baseUrl, apiPath) {
  const base = String(baseUrl || '').trim();
  const p = String(apiPath || '').trim();
  if (!p) return base;
  if (/^https?:\/\//i.test(p)) return p;
  return `${base.replace(/\/+$/, '')}/${p.replace(/^\/+/, '')}`;
}

async function apiFetchJson(cfg, apiPath, options = {}) {
  const url = buildApiUrl(cfg.apiBaseUrl, apiPath);
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(cfg.apiTimeoutMs) ? cfg.apiTimeoutMs : 10000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    ...(cfg.apiKey ? { 'X-API-Key': cfg.apiKey } : {}),
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    const text = await res.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!res.ok) {
      throw new Error(payload.error || payload.message || `HTTP ${res.status} calling ${url}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function armJsonRequest(cfg, mode, params = {}) {
  const endpoint = buildApiUrl(cfg.apiBaseUrl, cfg.armJsonPath || '/json');
  const url = new URL(endpoint);
  url.searchParams.set('mode', mode);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  if (cfg.apiKey) url.searchParams.set('api_key', cfg.apiKey);

  const controller = new AbortController();
  const timeoutMs = Number.isFinite(cfg.apiTimeoutMs) ? cfg.apiTimeoutMs : 10000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        ...(cfg.apiKey ? { 'X-API-Key': cfg.apiKey } : {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!res.ok) {
      throw new Error(payload.error || payload.message || `HTTP ${res.status} calling ${url}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const num = Number(match[1]);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function pickFirstString(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) {
    if (typeof obj[k] === 'string' && obj[k].trim()) return obj[k].trim();
  }
  return '';
}

function pickFirstNumber(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    const num = asNumber(obj[k]);
    if (num !== null) return num;
  }
  return null;
}

function extractJobs(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [
    payload.jobs,
    payload.joblist,
    payload.results,
    payload.data,
    payload.value,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      const values = Object.values(candidate).filter((v) => v && typeof v === 'object');
      if (values.length > 0) return values;
    }
  }
  return [];
}

function mapArmJobTelemetry(job) {
  const title = pickFirstString(job, ['title', 'movie', 'movie_name', 'name', 'label', 'disc_title']);
  const progressPct = pickFirstNumber(job, ['progress', 'progress_pct', 'percent', 'percent_complete', 'progressPercent']);
  const etaSec = pickFirstNumber(job, ['eta_sec', 'eta', 'remaining_sec', 'time_remaining']);
  const statusText = [
    pickFirstString(job, ['status', 'stage', 'state']),
    pickFirstString(job, ['activity', 'current_task']),
  ].join(' ').toLowerCase();
  const transcodeLike = /(transcod|handbrake|ffmpeg|encoding)/i.test(statusText);

  return {
    rip: {
      active: !transcodeLike,
      title,
      discLabel: pickFirstString(job, ['label', 'disc_label', 'volume']),
      progressPct,
      phase: !transcodeLike ? 'ripping' : 'idle',
      etaSec,
    },
    transcode: {
      active: transcodeLike,
      progressPct: transcodeLike ? progressPct : null,
      fps: pickFirstNumber(job, ['fps']),
      speedX: pickFirstNumber(job, ['speed', 'speedx']),
      codec: pickFirstString(job, ['codec', 'video_codec']).toLowerCase(),
      gpuMode: pickFirstString(job, ['gpu_mode']) || 'unknown',
      gpuDetail: pickFirstString(job, ['gpu_detail']) || 'unknown',
      etaSec: transcodeLike ? etaSec : null,
    },
  };
}

async function getArmJsonTelemetry(cfg) {
  const jobPayload = await armJsonRequest(cfg, 'joblist');
  const jobs = extractJobs(jobPayload);
  const activeJob = jobs.find((j) => {
    const s = `${j?.status || ''} ${j?.stage || ''} ${j?.state || ''}`.toLowerCase();
    if (!s) return true;
    return !/(success|failed|done|complete|abandon|deleted|idle)/i.test(s);
  }) || jobs[0] || null;

  if (!activeJob) {
    return {
      issues: [],
      drives: [],
      latestJobLogPath: '',
      localKey: '',
      rip: { active: false, title: '', discLabel: '', progressPct: null, phase: 'idle', etaSec: null },
      transcode: { active: false, progressPct: null, fps: null, speedX: null, codec: '', gpuMode: 'unknown', gpuDetail: 'unknown', etaSec: null },
    };
  }

  const mapped = mapArmJobTelemetry(activeJob);
  const drive = pickFirstString(activeJob, ['devpath', 'device', 'drive', 'source']);
  return {
    issues: [],
    drives: drive ? [drive] : [],
    latestJobLogPath: pickFirstString(activeJob, ['logfile', 'log_path', 'log']),
    localKey: '',
    rip: mapped.rip,
    transcode: mapped.transcode,
  };
}

async function getApiTelemetry(cfg) {
  const payload = await apiFetchJson(cfg, cfg.apiTelemetryPath);
  return payload.telemetry && typeof payload.telemetry === 'object' ? payload.telemetry : payload;
}

async function getApiLocalKey(cfg) {
  const payload = await apiFetchJson(cfg, cfg.apiLocalKeyPath);
  if (typeof payload === 'string') return payload;
  if (typeof payload.localKey === 'string') return payload.localKey;
  if (typeof payload.key === 'string') return payload.key;
  if (typeof payload.value === 'string') return payload.value;
  if (payload.data && typeof payload.data.localKey === 'string') return payload.data.localKey;
  return '';
}

async function updateApiLocalKey(cfg, newKey) {
  const payload = await apiFetchJson(cfg, cfg.apiUpdateKeyPath, {
    method: 'POST',
    body: JSON.stringify({ newKey, restartContainer: true }),
  });
  if (payload && payload.success === false) {
    throw new Error(payload.error || payload.message || 'ARM API rejected key update');
  }
  return payload;
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

async function detectLatestJobLogPath(cfg) {
  const cmd =
    `find ${shSingleQuote(cfg.logsDir)} -maxdepth 1 -type f -name '*_[0-9]*.log' ` +
    `-printf '%T@ %p\\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-`;
  const out = await runSsh(cfg, cmd).catch(() => '');
  return (out || '').trim();
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
  if (useArmJsonApi(cfg)) {
    const telemetry = await getArmJsonTelemetry(cfg);
    const keyStatus = computeKeyStatus('', cfg.internetKey, cfg.internetExpiry, []);
    return {
      issues: telemetry.issues || [],
      rip: telemetry.rip,
      transcode: telemetry.transcode,
      keyStatus,
      drives: telemetry.drives || [],
      latestJobLogPath: telemetry.latestJobLogPath || '',
    };
  }

  if (hasApiMode(cfg)) {
    const issues = [];
    const telemetry = await getApiTelemetry(cfg);
    const settingsText = typeof telemetry.settingsText === 'string' ? telemetry.settingsText : '';
    const armLogText = typeof telemetry.armLogText === 'string' ? telemetry.armLogText : '';
    const latestJobLogPath = typeof telemetry.latestJobLogPath === 'string' ? telemetry.latestJobLogPath : '';
    const latestJobLogText = typeof telemetry.latestJobLogText === 'string' ? telemetry.latestJobLogText : '';
    const transText = typeof telemetry.transcodeLogText === 'string' ? telemetry.transcodeLogText : '';

    if (!settingsText && !telemetry.localKey) issues.push('settings.conf unavailable via ARM API');
    if (!armLogText) issues.push('ARM log unavailable via ARM API');
    if (!latestJobLogPath) issues.push('No ARM job logs found via ARM API');
    if (!transText) issues.push('Transcode log unavailable via ARM API');

    const drives = Array.isArray(telemetry.drives) ? telemetry.drives : [];
    const localKey = typeof telemetry.localKey === 'string' ? telemetry.localKey : parseLocalKey(settingsText || '');
    const keyStatus = computeKeyStatus(localKey, cfg.internetKey, cfg.internetExpiry, localKey ? [] : ['settings.conf unavailable']);
    const rip = (telemetry.rip && typeof telemetry.rip === 'object')
      ? telemetry.rip
      : parseRipLog([latestJobLogText, armLogText].filter(Boolean).join('\n'));
    const transcode = (telemetry.transcode && typeof telemetry.transcode === 'object')
      ? telemetry.transcode
      : parseTranscodeLog([transText, latestJobLogText].filter(Boolean).join('\n'));

    return { issues, rip, transcode, keyStatus, drives, latestJobLogPath };
  }

  const issues = [];
  const settingsText = await readRemoteFile(cfg, cfg.settingsPath);
  if (!settingsText) issues.push('Unable to read settings.conf');

  const armLogText = await readRemoteFile(cfg, cfg.ripLogPath);
  if (!armLogText) issues.push(`Unable to read ARM log at ${cfg.ripLogPath}`);

  const latestJobLogPath = await detectLatestJobLogPath(cfg);
  let latestJobLogText = '';
  if (latestJobLogPath) {
    latestJobLogText = await readRemoteFile(cfg, latestJobLogPath);
    if (!latestJobLogText) issues.push(`Unable to read latest job log at ${latestJobLogPath}`);
  } else {
    issues.push(`No ARM job logs found in ${cfg.logsDir}`);
  }

  const transText = await readRemoteFile(cfg, cfg.transcodeLogPath);
  if (!transText) issues.push(`Unable to read transcode log at ${cfg.transcodeLogPath}`);

  const drives = await detectDrive(cfg);
  const localKey = parseLocalKey(settingsText || '');
  const keyStatus = computeKeyStatus(localKey, cfg.internetKey, cfg.internetExpiry, settingsText ? [] : ['settings.conf unavailable']);
  const rip = parseRipLog([latestJobLogText, armLogText].filter(Boolean).join('\n'));
  const transcode = parseTranscodeLog([transText, latestJobLogText].filter(Boolean).join('\n'));

  return { issues, rip, transcode, keyStatus, drives, latestJobLogPath };
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
    const { issues, rip, transcode, keyStatus, drives, latestJobLogPath } = await getTelemetry(cfg);
    if (rip && rip.arm && rip.arm.event === 'bail') {
      issues.push(rip.arm.message);
    }
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
      debug: {
        latestJobLogPath: latestJobLogPath || '',
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
        const localKey = useArmJsonApi(cfg)
          ? ''
          : hasApiMode(cfg)
          ? await getApiLocalKey(cfg)
          : parseLocalKey(await readRemoteFile(cfg, cfg.settingsPath) || '');
        const status = computeKeyStatus(localKey, cfg.internetKey, cfg.internetExpiry, localKey ? [] : ['settings.conf unavailable']);
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
        const localKey = useArmJsonApi(cfg)
          ? ''
          : hasApiMode(cfg)
          ? await getApiLocalKey(cfg)
          : parseLocalKey(await readRemoteFile(cfg, cfg.settingsPath) || '');
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
        if (hasApiMode(cfg)) {
          await updateApiLocalKey(cfg, newKey);
          return res.json({ success: true, message: 'Local key updated successfully via ARM API.' });
        }

        const escapedKey = shSingleQuote(newKey);
        const escapedForSed = sedReplacementEscape(newKey);
        const file = shSingleQuote(cfg.settingsPath);
        const cmd =
          `if grep -qE '^[[:space:]]*app_Key[[:space:]]*=' ${file}; then ` +
          `sed -i -E "s|^[[:space:]]*app_Key[[:space:]]*=.*$|app_Key = \\"${escapedForSed}\\"|" ${file}; ` +
          `else printf '\\napp_Key = "%s"\\n' ${escapedKey} >> ${file}; fi`;
        await runSsh(cfg, cmd);
        res.json({ success: true, message: 'Local key updated successfully via SSH.' });
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
