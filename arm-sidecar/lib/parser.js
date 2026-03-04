const fs = require('fs');
const path = require('path');

function parseLocalKey(settingsContent) {
  const quoted = String(settingsContent || '').match(/^\s*app_Key\s*=\s*"([^"]*)"/m);
  if (quoted && quoted[1]) return quoted[1].trim();
  const unquoted = String(settingsContent || '').match(/^\s*app_Key\s*=\s*([^\s#]+)\s*$/m);
  if (unquoted && unquoted[1]) return unquoted[1].trim();
  return '';
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
  const raw = String(rawTitle || '');
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
  const lower = String(text || '').toLowerCase();
  const hbProgress = parseHandBrakeProgress(text);
  const fpsMatch = String(text || '').match(/\b(?:fps|frame(?:s)?\/s)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  const timeMatch = String(text || '').match(/\btime\s*=\s*\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/i);
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
  const failedLineMatch = (text || '').match(/[^\n]*(encode failed|fatal error)[^\n]*/i);
  const failed = Boolean(failedLineMatch);
  const errorMessage = failedLineMatch ? failedLineMatch[0].trim() : '';

  const codecMatch =
    String(text || '').match(/(?:\+|\s)encoder:\s*(H\.?26[45]|HEVC|AV1)\b/i) ||
    String(text || '').match(/encavcodecInit:\s*(H\.?26[45]|HEVC|AV1)/i) ||
    String(text || '').match(/"Encoder"\s*:\s*"([^"]+)"/i) ||
    String(text || '').match(/\b(libx264|libx265|h264|h265|hevc|av1)\b/i) ||
    String(text || '').match(/\bVideo:\s*([a-zA-Z0-9_]+)/i);

  let transcodeType = 'Unknown';
  let gpuMode = 'unknown';
  let gpuDetail = 'unknown';

  const initHwMatch = String(text || '').match(/initialized encoder[\s\S]{0,240}?\b(nvenc|qsv|quicksync|vaapi|amf|vce)\b/i);
  const initSwMatch = String(text || '').match(/initialized encoder[\s\S]{0,240}?\b(libx264|libx265|x264|x265)\b/i);

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
    errorMessage,
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
  updateSettingsKey,
  parseRipLog,
  parseTranscodeLog,
  readTextIfExists,
  detectLatestFile,
};
