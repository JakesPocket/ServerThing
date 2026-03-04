const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const {
  parseLocalKey,
  parseLocalKeyExpiry,
  isIsoDate,
  updateSettingsKeyAndExpiry,
  parseRipLog,
  parseTranscodeLog,
  readTextIfExists,
  detectLatestFile,
} = require('./lib/parser');

const app = express();
app.use(express.json());

const cfg = {
  port: Number(process.env.PORT || 8080),
  mode: (process.env.ARM_BRIDGE_MODE || process.env.ARM_SIDECAR_MODE || 'mock').trim().toLowerCase(),
  apiKey: String(process.env.ARM_BRIDGE_API_KEY || process.env.ARM_SIDECAR_API_KEY || '').trim(),
  settingsPath: process.env.ARM_SETTINGS_PATH || '/arm/settings/settings.conf',
  logsDir: process.env.ARM_LOGS_DIR || '/arm/logs',
  progressLogsDir: process.env.ARM_PROGRESS_LOGS_DIR || '/arm/logs/progress',
  armLogPath: process.env.ARM_ARM_LOG_PATH || '/arm/logs/arm.log',
  transcodeLogPath: process.env.ARM_TRANSCODE_LOG_PATH || '/arm/logs/transcode.log',
  dbPath: process.env.ARM_DB_PATH || '/arm/db/arm.db',
  dataDir: process.env.ARM_BRIDGE_DATA_DIR || process.env.ARM_SIDECAR_DATA_DIR || '/app/data',
  sshHost: String(process.env.ARM_SSH_HOST || '').trim(),
  sshUser: String(process.env.ARM_SSH_USER || '').trim(),
  sshKeyPath: String(process.env.ARM_SSH_KEY_PATH || '/run/secrets/arm_ssh_key').trim(),
  sshTimeoutMs: Number(process.env.ARM_SSH_TIMEOUT_MS || 10000),
};

const STATE_FILE = path.join(cfg.dataDir, 'arm-bridge-state.json');
const LEGACY_STATE_FILE = path.join(cfg.dataDir, 'arm-sidecar-state.json');

function ensureDataDir() {
  if (!fs.existsSync(cfg.dataDir)) {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
  }
}

function loadMockState() {
  ensureDataDir();
  for (const statePath of [STATE_FILE, LEGACY_STATE_FILE]) {
    try {
      const raw = fs.readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // try next path
    }
  }
  return {
    localKey: 'T-MOCK-LOCAL-KEY',
    localKeyExpiry: '',
    drives: ['/dev/sr0'],
    rip: {
      active: false,
      title: '',
      discLabel: '',
      progressPct: null,
      phase: 'idle',
      etaSec: null,
    },
    transcode: {
      active: false,
      progressPct: null,
      fps: null,
      codec: '',
      transcodeType: 'Unknown',
      gpuMode: 'unknown',
      gpuDetail: 'unknown',
      etaSec: null,
      failed: false,
      error: '',
    },
    armLogText: '[ARM] mock mode enabled',
    latestJobLogText: '',
    progressLogText: '',
  };
}

function saveMockState(state) {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getApiKeyFromRequest(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return String(req.headers['x-api-key'] || '').trim();
}

function authMiddleware(req, res, next) {
  if (req.path === '/healthz') return next();
  if (!cfg.apiKey) {
    return res.status(500).json({ error: 'ARM bridge misconfigured: ARM_BRIDGE_API_KEY missing' });
  }
  const token = getApiKeyFromRequest(req);
  if (!token || token !== cfg.apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

app.use(authMiddleware);

function shSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function shDoubleQuoteEscape(value) {
  return String(value).replace(/["\\$`]/g, '\\$&');
}

function sedReplacementEscape(value) {
  return shDoubleQuoteEscape(String(value)).replace(/[&|]/g, '\\$&');
}

function runSsh(remoteCmd) {
  return new Promise((resolve, reject) => {
    if (!cfg.sshHost || !cfg.sshUser || !cfg.sshKeyPath) {
      reject(new Error('SSH mode misconfigured: ARM_SSH_HOST/ARM_SSH_USER/ARM_SSH_KEY_PATH required'));
      return;
    }
    const args = [
      '-i', cfg.sshKeyPath,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=6',
      `${cfg.sshUser}@${cfg.sshHost}`,
      remoteCmd,
    ];
    execFile('ssh', args, { timeout: cfg.sshTimeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message || 'SSH command failed').trim()));
        return;
      }
      resolve((stdout || '').trim());
    });
  });
}

function runLocal(command, args = [], timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message || `${command} failed`).trim()));
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

function extractRetryCommandsFromLog(logText) {
  const text = String(logText || '');
  const unknownOpts = Array.from(text.matchAll(/unknown option\s*\((--[^)]+)\)/gi))
    .map((m) => String(m[1] || '').trim())
    .filter(Boolean);

  const rawCommands = Array.from(text.matchAll(/Sending command:\s*(.+)$/gmi))
    .map((m) => String(m[1] || '').trim())
    .filter((cmd) => /HandBrakeCLI/i.test(cmd));

  const normalized = rawCommands.map((cmd) => {
    let out = cmd;
    for (const opt of ['--nosubtitles', ...unknownOpts]) {
      const esc = opt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`\\s+${esc}(?=\\s|$)`, 'gi'), '');
    }
    return out.replace(/\s+/g, ' ').trim();
  }).filter(Boolean);

  return Array.from(new Set(normalized));
}

async function retryTranscodeFromLatestLog() {
  if (cfg.mode === 'mock') {
    return {
      success: true,
      started: 1,
      message: 'Mock retry accepted',
      logPath: '/mock/logs/job-000.log',
    };
  }

  const logPath = cfg.mode === 'ssh'
    ? await detectLatestRemoteLog(cfg.logsDir)
    : await detectLatestFile(cfg.logsDir, (name) =>
      name.endsWith('.log') && name !== 'arm.log' && name !== 'transcode.log'
    );

  if (!logPath) {
    throw new Error('No ARM job log found for retry');
  }

  const logText = cfg.mode === 'ssh'
    ? await readRemoteFile(logPath)
    : await readTextIfExists(logPath);
  const commands = extractRetryCommandsFromLog(logText);
  if (!commands.length) {
    throw new Error('No HandBrake command found in latest job log');
  }

  if (cfg.mode === 'ssh') {
    for (const cmd of commands) {
      const detached = `${cmd} >/dev/null 2>&1 &`;
      await runSsh(`bash -lc ${shSingleQuote(detached)}`);
    }
  } else {
    for (const cmd of commands) {
      await runLocal('bash', ['-lc', `${cmd} >/dev/null 2>&1 &`], 15000);
    }
  }

  return {
    success: true,
    started: commands.length,
    message: `Started ${commands.length} transcode command${commands.length === 1 ? '' : 's'}`,
    logPath,
  };
}

function parseArmDateTimeMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  const normalized = raw.replace(' ', 'T').replace(/\.\d{6}$/, (m) => m.slice(0, 4));
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? ts : NaN;
}

function normalizeHistoryTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function querySqliteRows(sql, columns) {
  const parseRows = (out) => String(out || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const row = {};
      columns.forEach((col, i) => {
        row[col] = String(parts[i] || '');
      });
      return row;
    });

  if (cfg.mode === 'ssh') {
    const cmd = `sqlite3 -tabs -noheader ${shSingleQuote(cfg.dbPath)} ${shSingleQuote(sql)}`;
    const out = await runSsh(cmd).catch(() => '');
    return parseRows(out);
  }

  if (cfg.mode === 'live') {
    const out = await runLocal('sqlite3', ['-tabs', '-noheader', cfg.dbPath, sql]).catch(() => '');
    return parseRows(out);
  }

  return [];
}

function mapDbHistory({ jobs, limit }) {
  const items = jobs.map((j) => {
    const jobId = Number(j.job_id || 0);
    const title = String(j.title_manual || j.title || j.title_auto || j.label || '').trim();
    const titleNorm = normalizeHistoryTitle(title);
    const startMs = parseArmDateTimeMs(j.start_time);
    const stopMs = parseArmDateTimeMs(j.stop_time);
    const posterUrl = String(j.poster_url_manual || j.poster_url || j.poster_url_auto || '').trim();
    const status = String(j.status || 'completed').trim();
    const stage = String(j.stage || '').trim().toLowerCase();

    let ripCompletedAt = NaN;
    if (titleNorm) {
      const match = notifCandidates.find((n) => {
        if (!n.msgNorm.includes(titleNorm)) return false;
        if (Number.isFinite(startMs) && n.ts < (startMs - 6 * 60 * 60 * 1000)) return false;
        if (Number.isFinite(stopMs) && n.ts > (stopMs + 6 * 60 * 60 * 1000)) return false;
        return true;
      });
      if (match) ripCompletedAt = match.ts;
    }

    const hasTranscodeSignals = /(transcode|handbrake|encode)/i.test(`${status} ${stage} ${j.logfile || ''}`);
    const transcodeCompletedAt = Number.isFinite(stopMs) && hasTranscodeSignals ? stopMs : NaN;
    if (!Number.isFinite(ripCompletedAt) && Number.isFinite(stopMs) && !Number.isFinite(transcodeCompletedAt)) {
      ripCompletedAt = stopMs;
    }

    const completedAt = Number.isFinite(transcodeCompletedAt)
      ? transcodeCompletedAt
      : Number.isFinite(ripCompletedAt)
      ? ripCompletedAt
      : stopMs;

    return {
      id: `job-${jobId}`,
      jobId,
      title,
      posterUrl,
      ripCompletedAt: Number.isFinite(ripCompletedAt) ? ripCompletedAt : 0,
      transcodeCompletedAt: Number.isFinite(transcodeCompletedAt) ? transcodeCompletedAt : 0,
      completedAt: Number.isFinite(completedAt) ? completedAt : 0,
      status: status || 'completed',
      source: 'arm-db',
    };
  })
    .filter((v) => v.title && Number.isFinite(v.completedAt) && v.completedAt > 0)
    .sort((a, b) => b.completedAt - a.completedAt)
    .slice(0, limit);

  return items;
}

async function buildDbHistory(limit = 120) {
  if (cfg.mode === 'mock') {
    const state = loadMockState();
    const mock = Array.isArray(state.history) ? state.history : [];
    return mock.slice(0, limit);
  }

  const fetchLimit = Math.max(200, limit * 3);
  const jobsSql =
    `SELECT job_id,title,title_auto,title_manual,label,poster_url,poster_url_auto,poster_url_manual,status,stage,start_time,stop_time,logfile ` +
    `FROM job WHERE stop_time IS NOT NULL ORDER BY job_id DESC LIMIT ${fetchLimit}`;

  const jobs = await querySqliteRows(jobsSql, [
    'job_id', 'title', 'title_auto', 'title_manual', 'label',
    'poster_url', 'poster_url_auto', 'poster_url_manual',
    'status', 'stage', 'start_time', 'stop_time', 'logfile',
  ]);
  return mapDbHistory({ jobs, limit });
}

async function readRemoteFile(filePath) {
  const cmd = `cat ${shSingleQuote(filePath)} 2>/dev/null || true`;
  return runSsh(cmd).catch(() => '');
}

async function detectLatestRemoteLog(logsDir) {
  const cmd =
    `find ${shSingleQuote(logsDir)} -maxdepth 1 -type f -name '*.log' ! -name 'arm.log' ! -name 'transcode.log' ` +
    `-printf '%T@ %p\\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-`;
  const out = await runSsh(cmd).catch(() => '');
  return (out || '').trim();
}

async function detectLatestRemoteProgressLog(progressDir) {
  const cmd =
    `find ${shSingleQuote(progressDir)} -maxdepth 1 -type f -name '*.log' ` +
    `-printf '%T@ %p\\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-`;
  const out = await runSsh(cmd).catch(() => '');
  return (out || '').trim();
}

async function detectRemoteDrives() {
  const cmd =
    "for d in /dev/sr* /dev/cdrom*; do " +
      "[ -e \"$d\" ] || continue; " +
      "readlink -f \"$d\" 2>/dev/null || echo \"$d\"; " +
    "done | awk '!seen[$0]++'";
  const out = await runSsh(cmd).catch(() => '');
  return out.split('\n').map((v) => v.trim()).filter(Boolean);
}

async function buildLiveTelemetry() {
  const issues = [];

  const settingsText = await readTextIfExists(cfg.settingsPath);
  if (!settingsText) issues.push(`Unable to read settings at ${cfg.settingsPath}`);

  const armLogText = await readTextIfExists(cfg.armLogPath);
  if (!armLogText) issues.push(`Unable to read ARM log at ${cfg.armLogPath}`);

  const latestJobLogPath = await detectLatestFile(cfg.logsDir, (name) =>
    name.endsWith('.log') && name !== 'arm.log' && name !== 'transcode.log'
  );
  const latestJobLogText = latestJobLogPath ? await readTextIfExists(latestJobLogPath) : '';

  const latestProgressLogPath = await detectLatestFile(cfg.progressLogsDir, (name) => name.endsWith('.log'));
  const progressLogText = latestProgressLogPath ? await readTextIfExists(latestProgressLogPath) : '';

  const transcodeLogText = await readTextIfExists(cfg.transcodeLogPath);

  if (!latestJobLogPath && !latestProgressLogPath) {
    issues.push(`No ARM job/progress logs found in ${cfg.logsDir}`);
  }

  const localKey = parseLocalKey(settingsText || '');
  const localKeyExpiry = parseLocalKeyExpiry(settingsText || '');
  const rip = parseRipLog([latestJobLogText, progressLogText, armLogText].filter(Boolean).join('\n'));
  const transcode = parseTranscodeLog([latestJobLogText, transcodeLogText].filter(Boolean).join('\n'));

  const drives = [];
  if (rip.arm && rip.arm.device) drives.push(rip.arm.device);

  return {
    telemetry: {
      localKey,
      localKeyExpiry,
      drives,
      rip,
      transcode,
      settingsText,
      armLogText,
      latestJobLogPath,
      latestJobLogText,
      latestProgressLogPath,
      progressLogText,
      issues,
    },
  };
}

async function buildSshTelemetry() {
  const issues = [];
  const settingsText = await readRemoteFile(cfg.settingsPath);
  if (!settingsText) issues.push(`Unable to read settings at ${cfg.settingsPath}`);

  const armLogText = await readRemoteFile(cfg.armLogPath);
  if (!armLogText) issues.push(`Unable to read ARM log at ${cfg.armLogPath}`);

  const latestJobLogPath = await detectLatestRemoteLog(cfg.logsDir);
  const latestJobLogText = latestJobLogPath ? await readRemoteFile(latestJobLogPath) : '';

  const latestProgressLogPath = await detectLatestRemoteProgressLog(cfg.progressLogsDir);
  const progressLogText = latestProgressLogPath ? await readRemoteFile(latestProgressLogPath) : '';

  const transcodeLogText = await readRemoteFile(cfg.transcodeLogPath);

  if (!latestJobLogPath && !latestProgressLogPath) {
    issues.push(`No ARM job/progress logs found in ${cfg.logsDir}`);
  }

  const localKey = parseLocalKey(settingsText || '');
  const localKeyExpiry = parseLocalKeyExpiry(settingsText || '');
  const rip = parseRipLog([latestJobLogText, progressLogText, armLogText].filter(Boolean).join('\n'));
  const transcode = parseTranscodeLog([latestJobLogText, transcodeLogText].filter(Boolean).join('\n'));

  let drives = await detectRemoteDrives();
  if (!drives.length && rip.arm && rip.arm.device) drives = [rip.arm.device];

  return {
    telemetry: {
      localKey,
      localKeyExpiry,
      drives,
      rip,
      transcode,
      settingsText,
      armLogText,
      latestJobLogPath,
      latestJobLogText,
      latestProgressLogPath,
      progressLogText,
      issues,
    },
  };
}

function buildMockTelemetry() {
  const state = loadMockState();
  return {
    telemetry: {
      localKey: String(state.localKey || ''),
      localKeyExpiry: String(state.localKeyExpiry || ''),
      drives: Array.isArray(state.drives) ? state.drives : ['/dev/sr0'],
      rip: state.rip || {
        active: false,
        title: '',
        discLabel: '',
        progressPct: null,
        phase: 'idle',
        etaSec: null,
      },
      transcode: state.transcode || {
        active: false,
        progressPct: null,
        fps: null,
        codec: '',
        transcodeType: 'Unknown',
        gpuMode: 'unknown',
        gpuDetail: 'unknown',
        etaSec: null,
      },
      settingsText: `app_Key = "${String(state.localKey || '')}"\n`,
      armLogText: String(state.armLogText || '[ARM] mock mode enabled'),
      latestJobLogPath: '/mock/logs/job-000.log',
      latestJobLogText: String(state.latestJobLogText || ''),
      latestProgressLogPath: '/mock/logs/progress/job-000.log',
      progressLogText: String(state.progressLogText || ''),
      issues: [],
    },
  };
}

async function buildTelemetry() {
  if (cfg.mode === 'live') {
    return buildLiveTelemetry();
  }
  if (cfg.mode === 'ssh') {
    return buildSshTelemetry();
  }
  return buildMockTelemetry();
}

app.get('/healthz', async (req, res) => {
  const checks = {
    mode: cfg.mode,
    apiKeyConfigured: Boolean(cfg.apiKey),
    settingsPath: cfg.settingsPath,
    logsDir: cfg.logsDir,
    progressLogsDir: cfg.progressLogsDir,
    settingsReadable: false,
    logsReadable: false,
    progressLogsReadable: false,
  };

  if (cfg.mode === 'mock') {
    checks.settingsReadable = true;
    checks.logsReadable = true;
    checks.progressLogsReadable = true;
    return res.json({ ok: true, ...checks });
  }

  if (cfg.mode === 'ssh') {
    checks.settingsPath = `${cfg.sshUser}@${cfg.sshHost}:${cfg.settingsPath}`;
    checks.logsDir = `${cfg.sshUser}@${cfg.sshHost}:${cfg.logsDir}`;
    checks.progressLogsDir = `${cfg.sshUser}@${cfg.sshHost}:${cfg.progressLogsDir}`;
    try {
      await runSsh(`test -r ${shSingleQuote(cfg.settingsPath)} && echo ok`);
      checks.settingsReadable = true;
    } catch {
      checks.settingsReadable = false;
    }
    try {
      await runSsh(`test -d ${shSingleQuote(cfg.logsDir)} && test -r ${shSingleQuote(cfg.logsDir)} && echo ok`);
      checks.logsReadable = true;
    } catch {
      checks.logsReadable = false;
    }
    try {
      await runSsh(`test -d ${shSingleQuote(cfg.progressLogsDir)} && test -r ${shSingleQuote(cfg.progressLogsDir)} && echo ok`);
      checks.progressLogsReadable = true;
    } catch {
      checks.progressLogsReadable = false;
    }
    const ok = checks.apiKeyConfigured && checks.settingsReadable && checks.logsReadable && checks.progressLogsReadable;
    return res.status(ok ? 200 : 503).json({ ok, ...checks });
  }

  try {
    await fs.promises.access(cfg.settingsPath, fs.constants.R_OK);
    checks.settingsReadable = true;
  } catch {
    checks.settingsReadable = false;
  }

  try {
    await fs.promises.access(cfg.logsDir, fs.constants.R_OK);
    checks.logsReadable = true;
  } catch {
    checks.logsReadable = false;
  }
  try {
    await fs.promises.access(cfg.progressLogsDir, fs.constants.R_OK);
    checks.progressLogsReadable = true;
  } catch {
    checks.progressLogsReadable = false;
  }

  const ok = checks.apiKeyConfigured && checks.settingsReadable && checks.logsReadable && checks.progressLogsReadable;
  return res.status(ok ? 200 : 503).json({ ok, ...checks });
});

app.get('/api/serverthing/telemetry', async (req, res) => {
  try {
    const payload = await buildTelemetry();
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to build telemetry' });
  }
});

app.get('/api/serverthing/history', async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || 120);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 120;
    const items = await buildDbHistory(limit);
    return res.json({ items, source: 'arm-db' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to load history from ARM DB' });
  }
});

app.get('/api/serverthing/localkey', async (req, res) => {
  try {
    if (cfg.mode === 'live') {
      const settingsText = await readTextIfExists(cfg.settingsPath);
      return res.json({
        localKey: parseLocalKey(settingsText || ''),
        localKeyExpiry: parseLocalKeyExpiry(settingsText || ''),
      });
    }
    if (cfg.mode === 'ssh') {
      const settingsText = await readRemoteFile(cfg.settingsPath);
      return res.json({
        localKey: parseLocalKey(settingsText || ''),
        localKeyExpiry: parseLocalKeyExpiry(settingsText || ''),
      });
    }
    const state = loadMockState();
    return res.json({
      localKey: String(state.localKey || ''),
      localKeyExpiry: String(state.localKeyExpiry || ''),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to fetch local key' });
  }
});

app.post('/api/serverthing/localkey', async (req, res) => {
  const newKey = String(req.body?.newKey || '').trim();
  const newExpiryRaw = String(req.body?.newExpiry || '').trim();
  const newExpiry = isIsoDate(newExpiryRaw) ? newExpiryRaw : '';
  if (!newKey) {
    return res.status(400).json({ error: 'Missing newKey in request body' });
  }

  try {
    if (cfg.mode === 'live') {
      const settingsText = await readTextIfExists(cfg.settingsPath);
      const updated = updateSettingsKeyAndExpiry(settingsText || '', newKey, newExpiry);
      await fs.promises.writeFile(cfg.settingsPath, updated, 'utf8');
      return res.json({ success: true, message: 'Local key updated in settings.conf' });
    }
    if (cfg.mode === 'ssh') {
      const escapedKey = shSingleQuote(newKey);
      const escapedForSed = sedReplacementEscape(newKey);
      const file = shSingleQuote(cfg.settingsPath);
      let cmd =
        `if grep -qE '^[[:space:]]*app_Key[[:space:]]*=' ${file}; then ` +
        `sed -i -E \"s|^[[:space:]]*app_Key[[:space:]]*=.*$|app_Key = \\\\\\\"${escapedForSed}\\\\\\\"|\" ${file}; ` +
        `else printf '\\napp_Key = \"%s\"\\n' ${escapedKey} >> ${file}; fi`;
      if (newExpiry) {
        const escapedExpiry = shSingleQuote(newExpiry);
        const escapedExpiryForSed = sedReplacementEscape(newExpiry);
        cmd +=
          `; if grep -qE '^[[:space:]]*key_Expiry[[:space:]]*=' ${file}; then ` +
          `sed -i -E \"s|^[[:space:]]*key_Expiry[[:space:]]*=.*$|key_Expiry = \\\\\\\"${escapedExpiryForSed}\\\\\\\"|\" ${file}; ` +
          `else printf '\\nkey_Expiry = \"%s\"\\n' ${escapedExpiry} >> ${file}; fi`;
      }
      await runSsh(cmd);
      return res.json({ success: true, message: 'Local key updated in remote settings.conf' });
    }

    const state = loadMockState();
    state.localKey = newKey;
    if (newExpiry) state.localKeyExpiry = newExpiry;
    saveMockState(state);
    return res.json({ success: true, message: 'Mock local key updated' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to update local key' });
  }
});

app.post('/api/serverthing/transcode/retry', async (req, res) => {
  try {
    const result = await retryTranscodeFromLatestLog();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to retry transcode' });
  }
});

app.listen(cfg.port, () => {
  console.log(`[arm-bridge] listening on :${cfg.port} (mode=${cfg.mode})`);
});
