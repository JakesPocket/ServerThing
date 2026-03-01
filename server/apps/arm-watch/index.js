const { execFile } = require('child_process');
const express = require('express');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const POSTER_TTL_MS = 6 * 60 * 60 * 1000;
const posterCache = new Map();
const INTERNET_KEY_SOURCE_URL_DEFAULT = 'https://cable.ayra.ch/makemkv/api.php?json';
const INTERNET_KEY_SOURCE_URL_BACKUP = 'https://forum.makemkv.com/forum/viewtopic.php?f=5&t=1053';
const INTERNET_KEY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_HISTORY_ITEMS = 120;
const HISTORY_FILE_PATH = path.join(__dirname, '..', '..', '..', 'data', 'makemkv-history.json');
let internetKeyCache = {
  fetchedAt: 0,
  internetKey: '',
  internetExpiry: '',
  fetchError: '',
  keyRecords: [],
};
let ripHistoryCache = null;
let runtimeRipTracker = {
  active: false,
  lastTitle: '',
  lastPosterUrl: '',
};

function isReadableFile(filePath) {
  if (!filePath) return false;
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveSshKeyPath() {
  const csvFallback = (process.env.MAKEMKV_SSH_KEY_PATHS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const candidates = [
    process.env.MAKEMKV_SSH_KEY_PATH || '',
    process.env.MAKEMKV_SSH_KEY_PATH_DOCKSERVER || '',
    process.env.MAKEMKV_SSH_KEY_PATH_MACMINI || '',
    ...csvFallback,
  ]
    .map((v) => v.trim())
    .filter(Boolean);

  if (candidates.length === 0) return '';
  const readable = candidates.find((v) => isReadableFile(v));
  return readable || candidates[0];
}

function getConfig() {
  const defaultLogsDir = '/home/me/docker/acquisition/arm/logs';
  const defaultArmLogPath = `${defaultLogsDir}/arm.log`;
  const sidecarDefaultEnabled = String(process.env.ST_USE_ARM_SIDECAR_DEFAULT || '').toLowerCase() === '1'
    || String(process.env.ST_USE_ARM_SIDECAR_DEFAULT || '').toLowerCase() === 'true';
  const sidecarDefaultUrl = process.env.ST_ARM_SIDECAR_BASE_URL || 'http://arm-sidecar:8080';
  return {
    apiMode: (process.env.MAKEMKV_API_MODE || '').trim().toLowerCase(),
    apiBaseUrl: process.env.MAKEMKV_API_BASE_URL || (sidecarDefaultEnabled ? sidecarDefaultUrl : ''),
    apiKey: process.env.MAKEMKV_API_KEY || process.env.ARM_API_KEY || '',
    armJsonPath: process.env.MAKEMKV_ARM_JSON_PATH || '/json',
    apiTelemetryPath: process.env.MAKEMKV_API_TELEMETRY_PATH || '/api/serverthing/telemetry',
    apiLocalKeyPath: process.env.MAKEMKV_API_LOCALKEY_PATH || '/api/serverthing/localkey',
    apiUpdateKeyPath: process.env.MAKEMKV_API_UPDATEKEY_PATH || '/api/serverthing/localkey',
    apiTimeoutMs: Number(process.env.MAKEMKV_API_TIMEOUT_MS || 10000),
    host: process.env.MAKEMKV_HOST || '10.0.0.10',
    user: process.env.MAKEMKV_USER || 'me',
    sshKeyPath: resolveSshKeyPath(),
    settingsPath: process.env.MAKEMKV_SETTINGS_PATH || '/home/me/docker/acquisition/arm/.MakeMKV/settings.conf',
    ripLogPath: process.env.MAKEMKV_RIP_LOG_PATH || defaultArmLogPath,
    transcodeLogPath: process.env.MAKEMKV_TRANSCODE_LOG_PATH || '/home/me/docker/acquisition/arm/logs/transcode.log',
    logsDir: process.env.MAKEMKV_LOGS_DIR || path.dirname(process.env.MAKEMKV_RIP_LOG_PATH || defaultArmLogPath),
    internetExpiry: process.env.MAKEMKV_INTERNET_EXPIRY || '2026-03-31',
    internetKeySourceUrl: INTERNET_KEY_SOURCE_URL_DEFAULT,
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
  const hmsCompact = text.match(/\bETA[:=\s]+(\d{1,3})h(\d{1,2})m(\d{1,2})s\b/i);
  if (hmsCompact) {
    const h = Number(hmsCompact[1] || 0);
    const m = Number(hmsCompact[2] || 0);
    const s = Number(hmsCompact[3] || 0);
    return h * 3600 + m * 60 + s;
  }
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

function parseIsoDate(input) {
  const v = String(input || '').trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const ts = Date.parse(v);
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toISOString().slice(0, 10);
}

function startOfUtcDayTs(ts = Date.now()) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function daysDeltaFromToday(isoDate) {
  const normalized = parseIsoDate(isoDate);
  if (!normalized) return null;
  const target = Date.parse(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(target)) return null;
  const today = startOfUtcDayTs(Date.now());
  return Math.floor((target - today) / (24 * 60 * 60 * 1000));
}

function formatDaysFuture(days) {
  if (!Number.isFinite(days)) return 'unknown days';
  if (days <= 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'}`;
}

function formatDaysPast(days) {
  if (!Number.isFinite(days)) return 'unknown days';
  const abs = Math.abs(days);
  if (abs === 0) return 'today';
  return `${abs} day${abs === 1 ? '' : 's'} ago`;
}

function titleForHistory(value) {
  const normalized = extractTitleMetadata(String(value || '')).title || String(value || '');
  const trimmed = normalized.trim();
  if (!trimmed) return '';
  if (/^no active media$/i.test(trimmed)) return '';
  if (isUnknownLabel(trimmed)) return '';
  return trimmed;
}

function ensureHistoryLoaded() {
  if (ripHistoryCache) return ripHistoryCache;
  let items = [];
  try {
    const text = fs.readFileSync(HISTORY_FILE_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.items)) {
      items = parsed.items
        .filter((v) => v && typeof v === 'object')
        .map((v) => ({
          id: String(v.id || ''),
          title: String(v.title || '').trim(),
          posterUrl: String(v.posterUrl || '').trim(),
          completedAt: Number(v.completedAt || 0),
          status: 'completed',
        }))
        .filter((v) => v.title && Number.isFinite(v.completedAt) && v.completedAt > 0);
    }
  } catch {
    items = [];
  }
  ripHistoryCache = items.slice(0, MAX_HISTORY_ITEMS);
  return ripHistoryCache;
}

function persistHistory(items) {
  try {
    const dir = path.dirname(HISTORY_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HISTORY_FILE_PATH, JSON.stringify({ items }, null, 2));
  } catch {
    // Best-effort persistence; UI should continue even if filesystem write fails.
  }
}

function addHistoryItem(title, posterUrl = '') {
  const cleanTitle = titleForHistory(title);
  if (!cleanTitle) return;

  const items = ensureHistoryLoaded();
  const now = Date.now();
  const key = cleanTitle.toLowerCase();
  const duplicate = items.find((item) => item.title.toLowerCase() === key && (now - item.completedAt) < 60 * 60 * 1000);
  if (duplicate) return;

  const entry = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: cleanTitle,
    posterUrl: String(posterUrl || '').trim(),
    completedAt: now,
    status: 'completed',
  };
  const next = [entry, ...items].slice(0, MAX_HISTORY_ITEMS);
  ripHistoryCache = next;
  persistHistory(next);
}

function updateRipHistoryFromTelemetry({ rip, transcode, media }) {
  const active = Boolean(rip?.active) || Boolean(transcode?.active);
  const currentTitle = titleForHistory(rip?.title || media?.title || rip?.discLabel || '');
  const currentPoster = String(media?.posterUrl || '').trim();

  if (active) {
    runtimeRipTracker.active = true;
    if (currentTitle) runtimeRipTracker.lastTitle = currentTitle;
    if (currentPoster) runtimeRipTracker.lastPosterUrl = currentPoster;
    return;
  }

  if (runtimeRipTracker.active) {
    addHistoryItem(runtimeRipTracker.lastTitle || currentTitle, runtimeRipTracker.lastPosterUrl || currentPoster);
    runtimeRipTracker.active = false;
    runtimeRipTracker.lastTitle = '';
    runtimeRipTracker.lastPosterUrl = '';
  }
}

function getRipHistory() {
  return ensureHistoryLoaded();
}

function collectKeyRecords(value, out = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeyRecords(item, out));
    return out;
  }
  if (!value || typeof value !== 'object') return out;

  const entries = Object.entries(value);
  const keyEntry = entries.find(([k, v]) => /(key|beta)/i.test(k) && typeof v === 'string' && /T-[A-Za-z0-9@]+/.test(v));
  const expiryEntry = entries.find(([k, v]) =>
    /(exp|valid|until|date)/i.test(k) &&
    (typeof v === 'string' || typeof v === 'number')
  );
  if (keyEntry) {
    const keyToken = String(keyEntry[1]).match(/T-[A-Za-z0-9@]+/);
    const expiryIso = parseIsoDate(expiryEntry ? String(expiryEntry[1]) : '');
    out.push({ key: keyToken ? keyToken[0] : '', expiry: expiryIso });
  }

  entries.forEach(([, v]) => {
    if (v && typeof v === 'object') collectKeyRecords(v, out);
  });
  return out;
}

function extractInternetReferenceFromJson(payload, fallbackExpiry) {
  const records = collectKeyRecords(payload, []).filter((v) => v.key);
  if (records.length > 0) {
    const sorted = records.slice().sort((a, b) => {
      const ad = Date.parse(`${a.expiry || '1970-01-01'}T00:00:00Z`);
      const bd = Date.parse(`${b.expiry || '1970-01-01'}T00:00:00Z`);
      return (Number.isFinite(bd) ? bd : 0) - (Number.isFinite(ad) ? ad : 0);
    });
    return {
      internetKey: sorted[0].key,
      internetExpiry: sorted[0].expiry || parseIsoDate(fallbackExpiry) || '',
      keyRecords: sorted,
    };
  }

  const raw = JSON.stringify(payload || {});
  const tokenMatch = raw.match(/T-[A-Za-z0-9@]+/);
  const dateMatch = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return {
    internetKey: tokenMatch ? tokenMatch[0] : '',
    internetExpiry: dateMatch ? dateMatch[1] : (parseIsoDate(fallbackExpiry) || ''),
    keyRecords: [],
  };
}

function extractInternetReferenceFromText(text, fallbackExpiry) {
  const raw = String(text || '');
  const keyMatch = raw.match(/T-[A-Za-z0-9@]+/);
  const dateMatch = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return {
    internetKey: keyMatch ? keyMatch[0] : '',
    internetExpiry: dateMatch ? dateMatch[1] : (parseIsoDate(fallbackExpiry) || ''),
    keyRecords: [],
  };
}

async function fetchInternetReferenceFromUrl(url, fallbackExpiry, controller) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json, text/plain;q=0.9, text/html;q=0.8',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
      Referer: 'https://cable.ayra.ch/',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
    signal: controller.signal,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from internet key source (${url})`);
  }

  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  const bodyText = await res.text();
  if (!bodyText.trim()) {
    throw new Error(`Empty response from internet key source (${url})`);
  }

  if (contentType.includes('json')) {
    try {
      const json = JSON.parse(bodyText);
      return extractInternetReferenceFromJson(json, fallbackExpiry || '');
    } catch {
      // Some proxies mislabel payloads; fall through to text extraction.
    }
  }

  // Try JSON parse first even for text to tolerate misconfigured content-type.
  try {
    const json = JSON.parse(bodyText);
    return extractInternetReferenceFromJson(json, fallbackExpiry || '');
  } catch {
    return extractInternetReferenceFromText(bodyText, fallbackExpiry || '');
  }
}

async function fetchInternetKeyReference(cfg) {
  const now = Date.now();
  if (internetKeyCache.internetKey && now - internetKeyCache.fetchedAt < INTERNET_KEY_CACHE_TTL_MS) {
    return { ...internetKeyCache };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    let extracted = null;
    const attempts = [cfg.internetKeySourceUrl, INTERNET_KEY_SOURCE_URL_BACKUP];
    let lastError = null;

    for (const sourceUrl of attempts) {
      try {
        extracted = await fetchInternetReferenceFromUrl(sourceUrl, cfg.internetExpiry || '', controller);
        if (extracted.internetKey) break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!extracted || !extracted.internetKey) {
      const reason = lastError ? (lastError.message || String(lastError)) : 'Unable to parse internet key from source';
      throw new Error(reason);
    }

    internetKeyCache = {
      fetchedAt: now,
      internetKey: extracted.internetKey,
      internetExpiry: extracted.internetExpiry || '',
      fetchError: '',
      keyRecords: extracted.keyRecords || [],
    };
    return { ...internetKeyCache };
  } catch (error) {
    const hasCachedKey = Boolean(internetKeyCache.internetKey);
    const fallback = {
      fetchedAt: now,
      internetKey: internetKeyCache.internetKey || '',
      internetExpiry: internetKeyCache.internetExpiry || cfg.internetExpiry || '',
      fetchError: hasCachedKey ? '' : (error.message || 'Failed to fetch internet key'),
      keyRecords: Array.isArray(internetKeyCache.keyRecords) ? internetKeyCache.keyRecords : [],
    };
    internetKeyCache = fallback;
    return { ...fallback };
  } finally {
    clearTimeout(timer);
  }
}

function extractTitleMetadata(rawTitle) {
  const raw = String(rawTitle || '');
  const yearMatch = raw.match(/\byear\s*:\s*(\d{4})\b/i);
  const videoTypeMatch = raw.match(/\bvideo_type\s*:\s*([^\s]+)/i);
  const discTypeMatch = raw.match(/\bdisctype\s*:\s*([^\s]+)/i);

  let title = raw
    .replace(/\byear\s*:\s*\d{4}\b/ig, ' ')
    .replace(/\bvideo_type\s*:\s*[^\s]+/ig, ' ')
    .replace(/\bdisctype\s*:\s*[^\s]+/ig, ' ')
    .trim();

  // ARM naming often uses "--" to separate title/subtitle and "-" as word separators.
  title = title
    .replace(/--+/g, ' : ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s*:\s*/g, ': ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title,
    year: yearMatch ? yearMatch[1] : '',
    videoType: videoTypeMatch ? videoTypeMatch[1] : '',
    discType: discTypeMatch ? discTypeMatch[1] : '',
  };
}

function formatDisplayTitle(title, year) {
  const base = String(title || '').trim();
  const y = String(year || '').trim();
  if (!base) return '';
  if (y && !base.includes(`(${y})`)) return `${base} (${y})`;
  return base;
}

function isUnknownLabel(value) {
  const v = String(value || '').trim();
  if (!v) return true;
  // Common optical-drive placeholders that should not be treated as movie titles.
  if (/^no[\s_-]*label(?:\b|[\s_-].*)$/i.test(v)) return true;
  if (/^(unknown|untitled|dvdrom|cdrom)$/i.test(v)) return true;
  return false;
}

function sanitizeMediaLabel(value) {
  const v = String(value || '').trim();
  return isUnknownLabel(v) ? '' : v;
}

function cleanVerboseArmLabel(value) {
  let v = String(value || '').trim();
  if (!v) return '';
  // Keep only the title part when ARM emits verbose sentence-style labels.
  const rippingFrom = v.match(/^Ripping\s+from\s+(.+?)(?:\.\s|$)/i);
  if (rippingFrom && rippingFrom[1]) v = rippingFrom[1].trim();
  // Drop trailing metadata and edit-link text that ARM may append.
  v = v
    .replace(/\bDisc\s*type\s+is\b.*$/i, '')
    .replace(/\bMain\s*Feature\s*is\b.*$/i, '')
    .replace(/\bEdit\s+entry\s+here\s*:\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:\-\s]+$/g, '');
  return v;
}

function parseArmTimestampMs(line) {
  if (!line) return NaN;
  const m = line.match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return NaN;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const ts = new Date(year, month - 1, day, hour, minute, second).getTime();
  return Number.isFinite(ts) ? ts : NaN;
}

function parseHandBrakeProgress(text) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  let latest = null;
  for (const line of lines) {
    const m = line.match(/Encoding:\s*task\s*(\d+)\s*of\s*(\d+),\s*([\d.]+)\s*%/i);
    if (!m) continue;
    const task = Number(m[1]);
    const totalTasks = Number(m[2]);
    const taskPct = Number(m[3]);
    if (!Number.isFinite(task) || !Number.isFinite(totalTasks) || totalTasks <= 0 || !Number.isFinite(taskPct)) continue;
    const clampedTaskPct = Math.max(0, Math.min(100, taskPct));
    const overall = ((Math.max(1, task) - 1) + (clampedTaskPct / 100)) / totalTasks * 100;
    const fpsCurrent = line.match(/\(\s*([\d.]+)\s*fps/i);
    const fpsAvg = line.match(/avg\s*([\d.]+)\s*fps/i);
    const etaSec = parseEtaSec(line);
    latest = {
      progressPct: Math.max(0, Math.min(100, overall)),
      fps: fpsAvg ? Number(fpsAvg[1]) : (fpsCurrent ? Number(fpsCurrent[1]) : null),
      etaSec,
    };
  }
  return latest;
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
  let etaSec = parseEtaSec(text);

  // ARM wrapper fallback parsing (when PRGV lines are absent).
  // Example:
  // [ARM] Starting ARM for DVD on sr0
  // [ARM] Not CD, Blu-ray, DVD or Data. Bailing out on sr0
  const armEvents = [];
  const lines = text.split(/\r?\n/);
  let ripStartTs = NaN;
  let lastTs = NaN;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineTs = parseArmTimestampMs(line);
    if (Number.isFinite(lineTs)) {
      lastTs = lineTs;
      if (/Ripping disc with MakeMKV|Starting MakeMKV rip|Starting Disc identification/i.test(line)) {
        ripStartTs = lineTs;
      }
    }
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

  // Fallback ETA estimate when we have progress but no explicit ETA in logs.
  if (
    etaSec === null &&
    phase === 'ripping' &&
    Number.isFinite(progressPct) &&
    progressPct > 0 &&
    progressPct < 100 &&
    Number.isFinite(ripStartTs) &&
    Number.isFinite(lastTs) &&
    lastTs > ripStartTs
  ) {
    const elapsedSec = (lastTs - ripStartTs) / 1000;
    etaSec = Math.round((elapsedSec * (100 - progressPct)) / progressPct);
  }

  const rawTitle = cleanVerboseArmLabel(titleMatch ? titleMatch[1].trim() : '');
  const rawDiscLabel = cleanVerboseArmLabel(discLabelMatch ? discLabelMatch[1].trim() : '');
  const parsedTitle = extractTitleMetadata(rawTitle);
  const parsedDisc = extractTitleMetadata(rawDiscLabel);
  const cleanTitle = sanitizeMediaLabel(parsedTitle.title || rawTitle);
  const cleanDiscLabel = sanitizeMediaLabel(parsedDisc.title || rawDiscLabel);

  return {
    active: prgvProgressPct !== null ? effectiveActive : phase === 'ripping',
    title: cleanTitle,
    discLabel: cleanDiscLabel,
    titleYear: parsedTitle.year || parsedDisc.year || '',
    progressPct,
    phase,
    etaSec,
    arm,
  };
}

function parseTranscodeLog(text) {
  const lower = text.toLowerCase();
  const hbProgress = parseHandBrakeProgress(text);
  const fpsMatch = text.match(/\b(?:fps|frame(?:s)?\/s)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  const timeMatch = text.match(/\btime\s*=\s*\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/i);
  const progressPct = (hbProgress && Number.isFinite(hbProgress.progressPct))
    ? hbProgress.progressPct
    : parsePercent(text);
  const fps = (hbProgress && Number.isFinite(hbProgress.fps))
    ? hbProgress.fps
    : (fpsMatch ? Number(fpsMatch[1]) : null);
  const etaSec = (hbProgress && Number.isFinite(hbProgress.etaSec))
    ? hbProgress.etaSec
    : parseEtaSec(text);
  const hasLiveTelemetry = Boolean(fpsMatch || timeMatch || Number.isFinite(progressPct));
  const hasTranscodeContext = /(ffmpeg|handbrake|transcod|encoding|x26[45]|vaapi|nvenc|qsv)/i.test(text);
  const completed = /(transcode complete|finished encoding|idle|all done|completed successfully|encode failed|fatal error)/i.test(text);
  const active = hasTranscodeContext && hasLiveTelemetry && !completed;

  const codecMatch =
    text.match(/(?:\+|\s)encoder:\s*(H\.?26[45]|HEVC|AV1)\b/i) ||
    text.match(/encavcodecInit:\s*(H\.?26[45]|HEVC|AV1)/i) ||
    text.match(/"Encoder"\s*:\s*"([^"]+)"/i) ||
    text.match(/\b(libx264|libx265|h264|h265|hevc|av1)\b/i) ||
    text.match(/\bVideo:\s*([a-zA-Z0-9_]+)/i);

  // Preferred signal from ARM/encoder logs:
  // "initialized encoder" followed by hw/sw encoder token.
  const initHwMatch = text.match(/initialized encoder[\s\S]{0,240}?\b(nvenc|qsv|quicksync|vaapi|amf|vce)\b/i);
  const initSwMatch = text.match(/initialized encoder[\s\S]{0,240}?\b(libx264|libx265|x264|x265)\b/i);

  let transcodeType = 'Unknown';
  let gpuMode = 'unknown';
  let gpuDetail = 'unknown';

  if (initHwMatch) {
    transcodeType = 'Hardware';
    gpuMode = 'gpu';
    gpuDetail = initHwMatch[1].toLowerCase();
  } else if (initSwMatch) {
    transcodeType = 'Software';
    gpuMode = 'cpu';
    gpuDetail = 'software';
  } else if (/(vaapi|nvenc|qsv|vulkan|amf|vce)/i.test(lower)) {
    transcodeType = 'Hardware';
    gpuMode = 'gpu';
    const detail = lower.match(/(vaapi|nvenc|qsv|vulkan|amf|vce)/i);
    gpuDetail = detail ? detail[1].toLowerCase() : 'gpu';
  } else if (/(libx264|libx265|software|cpu)/i.test(lower)) {
    transcodeType = 'Software';
    gpuMode = 'cpu';
    gpuDetail = 'software';
  }

  return {
    active,
    progressPct,
    fps,
    codec: codecMatch ? codecMatch[1].toLowerCase() : '',
    transcodeType,
    gpuMode,
    gpuDetail,
    etaSec,
  };
}

function applyTranscodeDetectionLine(state, line) {
  if (!line) return state;
  const hwMatch = line.match(/initialized.*(nvenc|qsv|vaapi)/i);
  if (hwMatch) {
    return {
      transcodeType: 'Hardware',
      gpuMode: 'gpu',
      gpuDetail: hwMatch[1].toLowerCase(),
    };
  }
  if (state.transcodeType === 'Unknown' && /(?:\b|_)(x264|x265|libx264|libx265)\b/i.test(line)) {
    return {
      transcodeType: 'Software',
      gpuMode: 'cpu',
      gpuDetail: 'software',
    };
  }
  return state;
}

// Stream-parse a dynamic ARM job log file path.
// This is tolerant of files currently being written by ARM: it reads available content
// and returns best-known detection state at EOF.
async function parseArmLogFileTranscodeType(logPath) {
  const initial = { transcodeType: 'Unknown', gpuMode: 'unknown', gpuDetail: 'unknown' };
  if (!logPath) return initial;
  try {
    await fs.promises.access(logPath, fs.constants.R_OK);
  } catch {
    return initial;
  }

  return new Promise((resolve) => {
    const input = fs.createReadStream(logPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    let state = initial;

    rl.on('line', (line) => {
      state = applyTranscodeDetectionLine(state, line);
    });
    rl.on('close', () => resolve(state));
    rl.on('error', () => resolve(initial));
    input.on('error', () => resolve(initial));
  });
}

function computeKeyStatus(localKey, internetKey, internetExpiry, errors) {
  const publicDaysDelta = daysDeltaFromToday(internetExpiry);
  const publicExpired = Number.isFinite(publicDaysDelta) ? publicDaysDelta < 0 : false;

  const buildLocalTiming = () => {
    if (!internetKey || !localKey) return 'local key timing unavailable';
    if (localKey === internetKey) {
      if (!Number.isFinite(publicDaysDelta)) return 'local key timing unavailable';
      return publicDaysDelta < 0
        ? `local key expired ${formatDaysPast(publicDaysDelta)}`
        : `local key expires in ${formatDaysFuture(publicDaysDelta)}`;
    }
    if (!Number.isFinite(publicDaysDelta)) return 'local key timing unavailable';
    return publicDaysDelta < 0
      ? `local key expired ${formatDaysPast(publicDaysDelta)}`
      : `local key expires in ${formatDaysFuture(publicDaysDelta)}`;
  };

  if (errors && errors.length) {
    return {
      state: 'error',
      severity: 'red',
      localMatch: false,
      expiresOn: internetExpiry || null,
      message: errors.join('; '),
      localKey,
      internetKey,
      publicDaysDelta,
      localTimingText: buildLocalTiming(),
    };
  }

  if (!internetKey || !Number.isFinite(publicDaysDelta)) {
    return {
      state: 'unknown',
      severity: 'yellow',
      localMatch: false,
      expiresOn: internetExpiry || null,
      message: 'No internet reference key configured',
      localKey,
      internetKey,
      publicDaysDelta,
      localTimingText: buildLocalTiming(),
    };
  }

  if (publicExpired) {
    return {
      state: 'expired',
      severity: 'red',
      localMatch: Boolean(localKey) && localKey === internetKey,
      expiresOn: internetExpiry || null,
      message: `MakeMKV Key Expired - No new key posted as of ${formatDaysPast(publicDaysDelta)}`,
      localKey,
      internetKey,
      publicDaysDelta,
      localTimingText: buildLocalTiming(),
    };
  }

  const localMatch = localKey === internetKey;
  if (localMatch) {
    return {
      state: 'valid',
      severity: 'green',
      localMatch: true,
      expiresOn: internetExpiry || null,
      message: `Ready to Rip - Public key expires in ${formatDaysFuture(publicDaysDelta)}`,
      localKey,
      internetKey,
      publicDaysDelta,
      localTimingText: `local key expires in ${formatDaysFuture(publicDaysDelta)}`,
    };
  }

  return {
    state: 'mismatch',
    severity: 'yellow',
    localMatch: false,
    expiresOn: internetExpiry || null,
    message: `MakeMKV Key Mismatch - Public key expires in ${formatDaysFuture(publicDaysDelta)} (${buildLocalTiming()})`,
    localKey,
    internetKey,
    publicDaysDelta,
    localTimingText: buildLocalTiming(),
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
        codec: pickFirstString(job, ['codec', 'video_codec']).toLowerCase(),
        transcodeType: pickFirstString(job, ['transcode_type']) || 'Unknown',
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
      transcode: { active: false, progressPct: null, fps: null, codec: '', transcodeType: 'Unknown', gpuMode: 'unknown', gpuDetail: 'unknown', etaSec: null },
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

async function fetchPoster(title, omdbKey, year = '') {
  if (!title || !omdbKey) return null;
  const cacheKey = title.toLowerCase();
  const cached = posterCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const yearParam = year ? `&y=${encodeURIComponent(year)}` : '';
  const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(omdbKey)}&t=${encodeURIComponent(title)}${yearParam}`;
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

function titleFromLogPath(logPath) {
  if (!logPath) return '';
  const base = path.basename(String(logPath));
  const withoutExt = base.replace(/\.[^.]+$/, '');
  const normalized = withoutExt
    .replace(/[_\.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return extractTitleMetadata(normalized).title;
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
    `find ${shSingleQuote(cfg.logsDir)} -maxdepth 1 -type f -name '*.log' ! -name 'arm.log' ! -name 'transcode.log' ` +
    `-printf '%T@ %p\\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-`;
  const out = await runSsh(cfg, cmd).catch(() => '');
  return (out || '').trim();
}

async function detectLatestProgressLogPath(cfg) {
  const progressDir = `${cfg.logsDir.replace(/\/+$/, '')}/progress`;
  const cmd =
    `find ${shSingleQuote(progressDir)} -maxdepth 1 -type f -name '*.log' ` +
    `-printf '%T@ %p\\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-`;
  const out = await runSsh(cfg, cmd).catch(() => '');
  return (out || '').trim();
}

async function detectDrive(cfg) {
  try {
    const out = await runSsh(
      cfg,
      "for d in /dev/sr* /dev/cdrom*; do " +
        "[ -e \"$d\" ] || continue; " +
        "readlink -f \"$d\" 2>/dev/null || echo \"$d\"; " +
      "done | awk '!seen[$0]++'"
    );
    return out.split('\n').map((v) => v.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function getTelemetry(cfg, keyRef) {
  if (useArmJsonApi(cfg)) {
    const telemetry = await getArmJsonTelemetry(cfg);
    const keyStatus = computeKeyStatus('', keyRef.internetKey, keyRef.internetExpiry, keyRef.fetchError ? [keyRef.fetchError] : []);
    return {
      issues: telemetry.issues || [],
      rip: telemetry.rip,
      transcode: telemetry.transcode,
      keyStatus,
      drives: telemetry.drives || [],
      latestJobLogPath: telemetry.latestJobLogPath || '',
      latestProgressLogPath: telemetry.latestProgressLogPath || '',
    };
  }

  if (hasApiMode(cfg)) {
    const issues = [];
    const telemetry = await getApiTelemetry(cfg);
    const settingsText = typeof telemetry.settingsText === 'string' ? telemetry.settingsText : '';
    const armLogText = typeof telemetry.armLogText === 'string' ? telemetry.armLogText : '';
    const latestJobLogPath = typeof telemetry.latestJobLogPath === 'string' ? telemetry.latestJobLogPath : '';
    const latestJobLogText = typeof telemetry.latestJobLogText === 'string' ? telemetry.latestJobLogText : '';
    const latestProgressLogPath = typeof telemetry.latestProgressLogPath === 'string' ? telemetry.latestProgressLogPath : '';
    const progressLogText = typeof telemetry.progressLogText === 'string' ? telemetry.progressLogText : '';

    if (!settingsText && !telemetry.localKey) issues.push('settings.conf unavailable via ARM API');
    if (!armLogText) issues.push('ARM log unavailable via ARM API');
    if (!latestJobLogPath && !latestProgressLogPath) issues.push('No ARM job/progress logs found via ARM API');

    const drives = Array.isArray(telemetry.drives) ? telemetry.drives : [];
    const localKey = typeof telemetry.localKey === 'string' ? telemetry.localKey : parseLocalKey(settingsText || '');
    const keyErrors = [];
    if (!localKey) keyErrors.push('settings.conf unavailable');
    if (keyRef.fetchError) keyErrors.push(keyRef.fetchError);
    const keyStatus = computeKeyStatus(localKey, keyRef.internetKey, keyRef.internetExpiry, keyErrors);
    const rip = (telemetry.rip && typeof telemetry.rip === 'object')
      ? telemetry.rip
      : parseRipLog([latestJobLogText, progressLogText, armLogText].filter(Boolean).join('\n'));
    const transcode = (telemetry.transcode && typeof telemetry.transcode === 'object')
      ? telemetry.transcode
      : parseTranscodeLog(latestJobLogText || '');

    return { issues, rip, transcode, keyStatus, drives, latestJobLogPath, latestProgressLogPath };
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
    // Progress logs can still provide reliable PRGV/PRGT status even without a title log.
  }

  const latestProgressLogPath = await detectLatestProgressLogPath(cfg);
  let progressLogText = '';
  if (latestProgressLogPath) {
    progressLogText = await readRemoteFile(cfg, latestProgressLogPath);
    if (!progressLogText) issues.push(`Unable to read latest progress log at ${latestProgressLogPath}`);
  }

  if (!latestJobLogPath && !latestProgressLogPath) {
    issues.push(`No ARM job/progress logs found in ${cfg.logsDir}`);
  }

  const drives = await detectDrive(cfg);
  const localKey = parseLocalKey(settingsText || '');
  const keyErrors = [];
  if (!settingsText) keyErrors.push('settings.conf unavailable');
  if (keyRef.fetchError) keyErrors.push(keyRef.fetchError);
  const keyStatus = computeKeyStatus(localKey, keyRef.internetKey, keyRef.internetExpiry, keyErrors);
  const rip = parseRipLog([latestJobLogText, progressLogText, armLogText].filter(Boolean).join('\n'));
  const transcode = parseTranscodeLog(latestJobLogText || '');

  return { issues, rip, transcode, keyStatus, drives, latestJobLogPath, latestProgressLogPath };
}

async function buildHealth(cfg) {
  const cfgMissing = validateConfig(cfg);
  if (cfgMissing.length > 0) {
    return {
      state: 'error',
      updatedAt: Date.now(),
      rip: { active: false, title: '', discLabel: '', progressPct: null, phase: 'idle', etaSec: null },
      transcode: { active: false, progressPct: null, fps: null, codec: '', transcodeType: 'Unknown', gpuMode: 'unknown', gpuDetail: 'unknown', etaSec: null },
      media: { posterUrl: '', title: '', year: '' },
      keyStatus: {
        state: 'error',
        severity: 'red',
        localMatch: false,
        expiresOn: cfg.internetExpiry || null,
        message: `Missing config: ${cfgMissing.join(', ')}`,
        publicDaysDelta: null,
        localTimingText: 'local key timing unavailable',
      },
      readyToRip: false,
      issues: [`Missing config: ${cfgMissing.join(', ')}`],
      drive: { detected: false, count: 0, devices: [] },
      history: getRipHistory(),
    };
  }

  try {
    const keyRef = await fetchInternetKeyReference(cfg);
    const { issues, rip, transcode, keyStatus, drives, latestJobLogPath, latestProgressLogPath } = await getTelemetry(cfg, keyRef);
    if (rip && rip.arm && rip.arm.event === 'bail') {
      issues.push(rip.arm.message);
    }
    const rawTitle = rip.title || rip.discLabel || titleFromLogPath(latestJobLogPath) || '';
    const parsed = extractTitleMetadata(rawTitle);
    const omdbTitle = parsed.title || rawTitle;
    const fallbackYear = rip.titleYear || parsed.year || '';
    const media = (await fetchPoster(omdbTitle, cfg.omdbKey, fallbackYear)) || {
      posterUrl: '',
      title: formatDisplayTitle(omdbTitle, fallbackYear),
      year: fallbackYear,
    };
    updateRipHistoryFromTelemetry({ rip, transcode, media });
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
        severity: keyStatus.severity,
        localMatch: keyStatus.localMatch,
        expiresOn: keyStatus.expiresOn,
        message: keyStatus.message,
        publicDaysDelta: keyStatus.publicDaysDelta,
        localTimingText: keyStatus.localTimingText,
      },
      readyToRip,
      issues,
      drive: {
        detected: driveDetected,
        count: drives.length,
        devices: drives,
      },
      history: getRipHistory(),
      debug: {
        latestJobLogPath: latestJobLogPath || '',
        latestProgressLogPath: latestProgressLogPath || '',
      },
    };
  } catch (error) {
    return {
      state: 'error',
      updatedAt: Date.now(),
      rip: { active: false, title: '', discLabel: '', progressPct: null, phase: 'idle', etaSec: null },
      transcode: { active: false, progressPct: null, fps: null, codec: '', transcodeType: 'Unknown', gpuMode: 'unknown', gpuDetail: 'unknown', etaSec: null },
      media: { posterUrl: '', title: '', year: '' },
      keyStatus: {
        state: 'error',
        severity: 'red',
        localMatch: false,
        expiresOn: cfg.internetExpiry || null,
        message: error.message || 'Failed to gather telemetry',
        publicDaysDelta: null,
        localTimingText: 'local key timing unavailable',
      },
      readyToRip: false,
      issues: [error.message || 'Failed to gather telemetry'],
      drive: { detected: false, count: 0, devices: [] },
      history: getRipHistory(),
    };
  }
}

module.exports = {
  metadata: {
    name: 'ARM Watch',
    description: 'Live rip/transcode monitor and license health for ARM MakeMKV host',
  },

  init({ app }) {
    app.get('/api/arm-watch/health', async (req, res) => {
      const cfg = getConfig();
      const health = await buildHealth(cfg);
      res.json(health);
    });
    console.log('[ARM Watch] Route /api/arm-watch/health registered.');

    app.get('/api/arm-watch/key-status', async (req, res) => {
      const cfg = getConfig();
      const missing = validateConfig(cfg);
      if (missing.length > 0) {
        return res.status(500).json({
          state: 'error',
          message: `Missing config: ${missing.join(', ')}`,
        });
      }

      try {
        const keyRef = await fetchInternetKeyReference(cfg);
        const localKey = useArmJsonApi(cfg)
          ? ''
          : hasApiMode(cfg)
          ? await getApiLocalKey(cfg)
          : parseLocalKey(await readRemoteFile(cfg, cfg.settingsPath) || '');
        const keyErrors = [];
        if (!localKey) keyErrors.push('settings.conf unavailable');
        if (keyRef.fetchError) keyErrors.push(keyRef.fetchError);
        const status = computeKeyStatus(localKey, keyRef.internetKey, keyRef.internetExpiry, keyErrors);
        res.json({
          state: status.state,
          severity: status.severity,
          localMatch: status.localMatch,
          expiresOn: status.expiresOn,
          message: status.message,
          publicDaysDelta: status.publicDaysDelta,
          localTimingText: status.localTimingText,
          localKey: status.localKey,
          internetKey: status.internetKey,
          source: cfg.internetKeySourceUrl,
        });
      } catch (error) {
        res.status(500).json({
          state: 'error',
          message: error.message || 'Failed to read key status',
        });
      }
    });
    console.log('[ARM Watch] Route /api/arm-watch/key-status registered.');

    app.get('/api/arm-watch/localkey', async (req, res) => {
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
    console.log('[ARM Watch] Route /api/arm-watch/localkey registered.');

    app.post('/api/arm-watch/update', express.json(), async (req, res) => {
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
    console.log('[ARM Watch] Route /api/arm-watch/update registered.');

    app.get('/apps/arm-watch/status', (req, res) => {
      res.json({ status: 'ok', message: 'Rip monitor is running' });
    });
  },
};
