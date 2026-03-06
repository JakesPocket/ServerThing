const fs = require('fs');
const path = require('path');
let ripEtaTwaState = {
  jobKey: '',
  startTimeMs: NaN,
  lastProgressDecimal: NaN,
};

function parseLocalKey(settingsContent) {
  const quoted = String(settingsContent || '').match(/^\s*app_Key\s*=\s*"([^"]*)"/m);
  if (quoted && quoted[1]) return quoted[1].trim();
  const unquoted = String(settingsContent || '').match(/^\s*app_Key\s*=\s*([^\s#]+)\s*$/m);
  if (unquoted && unquoted[1]) return unquoted[1].trim();
  return '';
}

function parseLocalKeyExpiry(settingsContent) {
  const quoted = String(settingsContent || '').match(/^\s*key_Expiry\s*=\s*"([^"]*)"/m);
  if (quoted && quoted[1]) return quoted[1].trim();
  const unquoted = String(settingsContent || '').match(/^\s*key_Expiry\s*=\s*([^\s#]+)\s*$/m);
  if (unquoted && unquoted[1]) return unquoted[1].trim();
  return '';
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function updateSettingsKey(settingsContent, newKey) {
  const content = String(settingsContent || '');
  const normalizedKey = String(newKey || '').trim();
  if (!normalizedKey) return content;
  const replacement = `app_Key = "${normalizedKey}"`;
  if (/^\s*app_Key\s*=.*$/m.test(content)) {
    return content.replace(/^\s*app_Key\s*=.*$/m, replacement);
  }
  const suffix = content.endsWith('\n') || !content ? '' : '\n';
  return `${content}${suffix}${replacement}\n`;
}

function updateSettingsKeyExpiry(settingsContent, expiryDate) {
  const content = String(settingsContent || '');
  const normalizedDate = String(expiryDate || '').trim();
  if (!isIsoDate(normalizedDate)) return content;

  const expiryLine = `key_Expiry = "${normalizedDate}"`;
  if (/^\s*key_Expiry\s*=.*$/m.test(content)) {
    return content.replace(/^\s*key_Expiry\s*=.*$/m, expiryLine);
  }

  const keyLineMatch = content.match(/^\s*app_Key\s*=.*$/m);
  if (keyLineMatch && typeof keyLineMatch.index === 'number') {
    const lineStart = keyLineMatch.index;
    const lineEnd = content.indexOf('\n', lineStart);
    if (lineEnd === -1) return `${content}\n${expiryLine}\n`;
    return `${content.slice(0, lineEnd + 1)}${expiryLine}\n${content.slice(lineEnd + 1)}`;
  }

  const suffix = content.endsWith('\n') || !content ? '' : '\n';
  return `${content}${suffix}${expiryLine}\n`;
}

function updateSettingsKeyAndExpiry(settingsContent, newKey, expiryDate) {
  const withKey = updateSettingsKey(settingsContent, newKey);
  return updateSettingsKeyExpiry(withKey, expiryDate);
}

function parsePercent(text) {
  if (!text) return null;
  const match = String(text).match(/(\d{1,3}(?:\.\d+)?)%/);
  if (!match) return null;
  const pct = Number(match[1]);
  if (Number.isNaN(pct)) return null;
  return Math.max(0, Math.min(100, pct));
}

function parseEtaSec(text) {
  if (!text) return null;
  const hmsCompact = String(text).match(/\bETA[:=\s]+(\d{1,3})h(\d{1,2})m(\d{1,2})s\b/i);
  if (hmsCompact) {
    const h = Number(hmsCompact[1] || 0);
    const m = Number(hmsCompact[2] || 0);
    const s = Number(hmsCompact[3] || 0);
    return h * 3600 + m * 60 + s;
  }
  const hms = String(text).match(/\bETA[:=\s]+(?:(\d+):)?(\d{1,2}):(\d{2})\b/i);
  if (hms) {
    const h = Number(hms[1] || 0);
    const m = Number(hms[2] || 0);
    const s = Number(hms[3] || 0);
    return h * 3600 + m * 60 + s;
  }
  const mins = String(text).match(/\bETA[:=\s]+(\d+)\s*(?:m|min|mins|minute|minutes)\b/i);
  if (mins) return Number(mins[1]) * 60;
  return null;
}

function parseArmTimestampMs(line) {
  if (!line) return NaN;
  const m = String(line).match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
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

function extractTitleMetadata(rawTitle) {
  const raw = String(rawTitle || '')
    .replace(/:\s*<class\s+'str'>/ig, '')
    .replace(/<class\s+'str'>/ig, '')
    .trim();
  const yearMatch = raw.match(/\byear\s*:\s*(\d{4})\b/i);

  let title = raw
    .replace(/\byear\s*:\s*\d{4}\b/ig, ' ')
    .replace(/\bvideo_type\s*:\s*[^\s]+/ig, ' ')
    .replace(/\bdisctype\s*:\s*[^\s]+/ig, ' ')
    .trim();

  title = title
    .replace(/--+/g, ' : ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s*:\s*/g, ': ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title,
    year: yearMatch ? yearMatch[1] : '',
  };
}

function cleanVerboseArmLabel(value) {
  let v = String(value || '').trim();
  if (!v) return '';
  const rippingFrom = v.match(/^Ripping\s+from\s+(.+?)(?:\.\s|$)/i);
  if (rippingFrom && rippingFrom[1]) v = rippingFrom[1].trim();
  v = v
    .replace(/\bDisc\s*type\s+is\b.*$/i, '')
    .replace(/\bMain\s*Feature\s*is\b.*$/i, '')
    .replace(/\bEdit\s+entry\s+here\s*:\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:\-\s]+$/g, '');
  return v;
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
  const active = /(makemkvcon|ripping|saving title|copy complete|title #\d+)/i.test(text) &&
    !/(idle|waiting for disc|no disc)/i.test(text);

  const titleMatch =
    String(text).match(/title(?:\s+name)?\s*[:=]\s*["']?(.+?)["']?$/im) ||
    String(text).match(/Saving\s+title\s+\d+\s+into\s+file\s+["']?(.+?)["']?$/im) ||
    String(text).match(/CINFO:\d+,\d+,"([^"]+)"/i);
  const discLabelMatch =
    String(text).match(/disc(?:\s+label)?\s*[:=]\s*["']?(.+?)["']?$/im) ||
    String(text).match(/DRV:\d+,\d+,\d+,\d+,"([^"]+)"/i);

  const prgvMatches = Array.from(String(text).matchAll(/PRGV:(\d+),(\d+),(\d+)/g));
  let prgvProgressPct = null;
  let prgvProgressDecimal = NaN;
  let prgvMax = NaN;
  let prgvActive = null;
  if (prgvMatches.length > 0) {
    const last = prgvMatches[prgvMatches.length - 1];
    const total = Number(last[2]);
    const max = Number(last[3]);
    if (Number.isFinite(total) && Number.isFinite(max) && max > 0) {
      prgvProgressDecimal = Math.max(0, Math.min(1, total / max));
      prgvProgressPct = prgvProgressDecimal * 100;
      prgvMax = max;
      prgvActive = total < max;
    }
  }

  const effectiveActive = (prgvActive !== null) ? prgvActive : active;
  let phase = effectiveActive ? 'ripping' : 'idle';
  let progressPct = (prgvProgressPct !== null) ? prgvProgressPct : parsePercent(text);
  let etaSec = parseEtaSec(text);

  // ARM can have an active job even when PRGV has reached 100% for the last
  // sampled task (e.g., waiting for manual override/next phase).
  const armJobRunning = /Job\\s*#\\d+\\s+with\\s+PID\\s+\\d+\\s+is\\s+currently\\s+running|Waiting\\s+\\d+\\s+seconds\\s+for\\s+manual\\s+override/i.test(String(text));
  const armJobEnded = /Finished\\s+ARM\\s+processing|ARM\\s+processing\\s+completed|completed\\s+successfully|all\\s+done|job\\s+complete/i.test(String(text));
  if (armJobRunning && !armJobEnded) {
    phase = 'ripping';
    if (progressPct === 100) progressPct = null;
  }

  const armEvents = [];
  const lines = String(text).split(/\r?\n/);
  let ripStartTs = NaN;
  let lastTs = NaN;
  let firstPrgvTs = NaN;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineTs = parseArmTimestampMs(line);
    if (Number.isFinite(lineTs)) {
      lastTs = lineTs;
      if (/Ripping disc with MakeMKV|Starting MakeMKV rip|Starting Disc identification/i.test(line)) {
        ripStartTs = lineTs;
      }
    }
    if (!Number.isFinite(firstPrgvTs) && /PRGV:\d+,\d+,\d+/.test(line)) {
      if (Number.isFinite(lineTs)) firstPrgvTs = lineTs;
      else if (Number.isFinite(lastTs)) firstPrgvTs = lastTs;
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

  if (phase === 'ripping' && Number.isFinite(prgvProgressDecimal) && prgvProgressDecimal > 0 && prgvProgressDecimal < 1) {
    const currentTimeMs = Number.isFinite(lastTs) ? lastTs : Date.now();
    const baseStartMs = Number.isFinite(firstPrgvTs)
      ? firstPrgvTs
      : (Number.isFinite(ripStartTs) ? ripStartTs : currentTimeMs);
    const etaJobHint = `${(discLabelMatch && discLabelMatch[1]) ? discLabelMatch[1].trim() : ''}|${(titleMatch && titleMatch[1]) ? titleMatch[1].trim() : ''}`;
    const jobKey = `${prgvMax}|${etaJobHint}`;
    const resetByProgress = Number.isFinite(ripEtaTwaState.lastProgressDecimal) &&
      (prgvProgressDecimal + 0.02 < ripEtaTwaState.lastProgressDecimal);
    const resetByKey = ripEtaTwaState.jobKey !== jobKey;
    if (resetByKey || resetByProgress || !Number.isFinite(ripEtaTwaState.startTimeMs)) {
      ripEtaTwaState = {
        jobKey,
        startTimeMs: baseStartMs,
        lastProgressDecimal: prgvProgressDecimal,
      };
    } else {
      ripEtaTwaState.lastProgressDecimal = prgvProgressDecimal;
    }

    const elapsedSec = Math.max(0, (currentTimeMs - ripEtaTwaState.startTimeMs) / 1000);
    if (elapsedSec > 0) {
      const totalDurationSec = elapsedSec / prgvProgressDecimal;
      let etaSecComputed = Math.max(0, totalDurationSec - elapsedSec);
      if (prgvProgressDecimal > 0.99) etaSecComputed = Math.max(60, etaSecComputed);
      etaSec = Math.round(etaSecComputed);
    }
  } else if (phase !== 'ripping') {
    ripEtaTwaState = {
      jobKey: '',
      startTimeMs: NaN,
      lastProgressDecimal: NaN,
    };
  }

  const rawTitle = cleanVerboseArmLabel(titleMatch ? titleMatch[1].trim() : '');
  const rawDiscLabel = cleanVerboseArmLabel(discLabelMatch ? discLabelMatch[1].trim() : '');
  const parsedTitle = extractTitleMetadata(rawTitle);
  const parsedDisc = extractTitleMetadata(rawDiscLabel);

  return {
    active: armJobRunning && !armJobEnded
      ? true
      : (prgvProgressPct !== null ? effectiveActive : phase === 'ripping'),
    title: parsedTitle.title || rawTitle,
    discLabel: parsedDisc.title || rawDiscLabel,
    titleYear: parsedTitle.year || parsedDisc.year || '',
    progressPct,
    phase,
    etaSec,
    arm,
  };
}

function parseTranscodeLog(text) {
  const body = String(text || '');
  const lower = body.toLowerCase();
  const hbProgress = parseHandBrakeProgress(body);
  const fpsMatch = body.match(/\b(?:fps|frame(?:s)?\/s)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  const timeMatch = body.match(/\btime\s*=\s*\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/i);
  const progressPct = (hbProgress && Number.isFinite(hbProgress.progressPct))
    ? hbProgress.progressPct
    : parsePercent(body);
  const fps = (hbProgress && Number.isFinite(hbProgress.fps))
    ? hbProgress.fps
    : (fpsMatch ? Number(fpsMatch[1]) : null);
  const etaSec = (hbProgress && Number.isFinite(hbProgress.etaSec))
    ? hbProgress.etaSec
    : parseEtaSec(body);
  const hasLiveTelemetry = Boolean(fpsMatch || timeMatch || Number.isFinite(progressPct));
  const hasTranscodeContext = /(ffmpeg|handbrake|encoding|x26[45]|vaapi|nvenc|qsv|hb_init)/i.test(body);
  const completed = /(transcode complete|finished encoding|idle|all done|completed successfully|handbrake processing complete)/i.test(body);
  const errorLine =
    body.match(/unknown option\s*\((--[^)]+)\)/i) ||
    body.match(/unrecognized option\s*['"]?(--\S+)/i) ||
    body.match(/\b(?:encode failed|fatal error|handbrake\s+has\s+exited)\b/i) ||
    body.match(/\bhandbrake\b[\s\S]{0,80}\bexit code\b[\s:=]+[1-9]\d*\b/i);
  const failed = hasTranscodeContext && Boolean(errorLine);
  const active = hasTranscodeContext && hasLiveTelemetry && !completed && !failed;

  const codecMatch =
    body.match(/(?:\+|\s)encoder:\s*(H\.?26[45]|HEVC|AV1)\b/i) ||
    body.match(/encavcodecInit:\s*(H\.?26[45]|HEVC|AV1)/i) ||
    body.match(/"Encoder"\s*:\s*"([^"]+)"/i) ||
    body.match(/\b(libx264|libx265|h264|h265|hevc|av1)\b/i) ||
    body.match(/\bVideo:\s*([a-zA-Z0-9_]+)/i);

  let transcodeType = 'Unknown';
  let gpuMode = 'unknown';
  let gpuDetail = 'unknown';

  const initHwMatch = body.match(/initialized encoder[\s\S]{0,240}?\b(nvenc|qsv|quicksync|vaapi|amf|vce)\b/i);
  const initSwMatch = body.match(/initialized encoder[\s\S]{0,240}?\b(libx264|libx265|x264|x265)\b/i);

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
    failed,
    error: failed ? String(errorLine[0] || '').trim() : '',
    progressPct,
    fps,
    codec: codecMatch ? codecMatch[1].toLowerCase() : '',
    transcodeType,
    gpuMode,
    gpuDetail,
    etaSec,
  };
}

async function readTextIfExists(filePath) {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function detectLatestFile(dirPath, filterFn = null) {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => path.join(dirPath, e.name));
    const filtered = filterFn ? files.filter((p) => filterFn(path.basename(p))) : files;
    if (!filtered.length) return '';

    const stats = await Promise.all(filtered.map(async (p) => ({
      path: p,
      stat: await fs.promises.stat(p),
    })));
    stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    return stats[0].path;
  } catch {
    return '';
  }
}

module.exports = {
  parseLocalKey,
  parseLocalKeyExpiry,
  isIsoDate,
  updateSettingsKey,
  updateSettingsKeyExpiry,
  updateSettingsKeyAndExpiry,
  parseRipLog,
  parseTranscodeLog,
  readTextIfExists,
  detectLatestFile,
};
