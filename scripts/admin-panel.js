#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { createModService } = require("./admin-panel/mods");
const { decodeXmlText, patchCabinsXml, extractSaveConfig, applySaveConfigEdits, extractFarmhands } = require("./admin-panel/save-repair");
const { PAGE } = require("./admin-panel/page");
const { createApiHandler } = require("./admin-panel/api-routes");
const { createPlayerService, buildPlayerManagement, hasFarmhandList } = require("./admin-panel/players");
const {
  SAVE_NAME_PATTERN,
  BACKUP_ARCHIVE_PATTERN,
  NEW_GAME_ONLY_SETTING_PATHS,
  stripAnsi,
  intInRange,
  numberInSet,
  bool,
  boolWithDefault,
  stringChoice,
  cleanText,
  settingValue,
  hasSettingChanges,
  parseSteamIds,
  listLanAddresses,
  parseTableLines,
  apiError,
  validateSaveName,
  validateBackupArchive,
  parseMetadata,
  formatTimestampForFile,
  tsv,
} = require("./admin-panel/utils");

const ROOT_DIR = path.resolve(process.env.SDV_ADMIN_ROOT || path.join(__dirname, ".."));
const modService = createModService({ rootDir: ROOT_DIR, docker, readEnv });
const ENV_FILE = path.join(ROOT_DIR, ".env");
const ENV_EXAMPLE_FILE = path.join(ROOT_DIR, ".env.example");
const SETTINGS_FILE = path.join(ROOT_DIR, "data", "settings", "server-settings.json");
const BACKUP_DIR = path.join(ROOT_DIR, "backups");
const ADMIN_COOKIE = "sdv_admin_token";
const SAVES_VOLUME = "stardew-valley-server-kit_saves";
const SAVE_COMPLETE_PATTERN = /SaveGame\.Save\(\) completed without exceptions|SaveGame\.Save.*completed/i;
const STOP_AFTER_SAVE_CHECK_MS = 30000;
const STOP_AFTER_SAVE_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const SMAPI_COMMAND_PIPE_TIMEOUT_MS = 90000;
const SMAPI_COMMAND_PIPE_POLL_MS = 2000;
const NEW_GAME_SAVE_WAIT_TIMEOUT_MS = 120000;
const NEW_GAME_SAVE_WAIT_POLL_MS = 3000;
const JSON_BODY_MAX_BYTES = 1024 * 1024;
const MOD_UPLOAD_BODY_MAX_BYTES = 110 * 1024 * 1024;
const CHILD_OUTPUT_MAX_BYTES = 1024 * 1024;
const CHILD_KILL_AFTER_TIMEOUT_MS = 5000;
const INTERNAL_API_RESPONSE_MAX_BYTES = 1024 * 1024;
const DEFAULT_AUTO_BACKUP_ENABLED = false;
const DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES = 360;
const DEFAULT_BACKUP_RETENTION = 10;
const MIN_AUTO_BACKUP_INTERVAL_MINUTES = 15;
const MAX_AUTO_BACKUP_INTERVAL_MINUTES = 10080;
const MIN_BACKUP_RETENTION = 1;
const MAX_BACKUP_RETENTION = 100;
const STACK_READY_TIMEOUT_MS = positiveIntEnv("SDV_ADMIN_STACK_READY_TIMEOUT_SECONDS", 240) * 1000;
const STACK_READY_POLL_MS = 3000;
const STACK_FAILURE_LOG_LINES = 180;
const STACK_FAILURE_LOG_MAX_CHARS = 7000;
const LATEST_LOG_LINES = 5000;
const LATEST_LOG_MAX_BYTES = 4 * 1024 * 1024;
const STACK_REQUIRED_CONTAINERS = ["sdv-server", "sdv-steam-auth"];
const DOCKER_INSPECT_API_FORMAT = '{{.State.Running}}{{printf "\\t"}}{{json .Config.Env}}{{printf "\\t"}}{{json .Mounts}}';
const ADMIN_ALLOW_PUBLIC_HTTP_KEY = "ADMIN_ALLOW_PUBLIC_HTTP";
let pendingStopAfterSave = null;
let autoBackupTimer = null;
let autoBackupState = {
  enabled: DEFAULT_AUTO_BACKUP_ENABLED,
  intervalMinutes: DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
  retention: DEFAULT_BACKUP_RETENTION,
  running: false,
  nextRunAt: null,
  lastRunAt: null,
  lastResult: null,
};

const FARM_TYPES = [
  { value: 0, label: "标准农场" },
  { value: 1, label: "河边农场" },
  { value: 2, label: "森林农场" },
  { value: 3, label: "山顶农场" },
  { value: 4, label: "荒野农场" },
  { value: 5, label: "四角农场" },
  { value: 6, label: "海滩农场" },
  { value: 7, label: "草原农场" },
];

const DEFAULT_SETTINGS = {
  Game: {
    FarmName: "Junimo",
    FarmType: 0,
    ProfitMargin: 1.0,
    StartingCabins: 1,
    SpawnMonstersAtNight: "auto",
  },
  Server: {
    MaxPlayers: 10,
    CabinStrategy: "CabinStack",
    SeparateWallets: false,
    ExistingCabinBehavior: "KeepExisting",
    VerboseLogging: false,
    AllowIpConnections: true,
    LobbyMode: "Shared",
    ActiveLobbyLayout: "default",
    AdminSteamIds: [],
  },
};

function cloneDefaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function positiveIntEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function newSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return values;
}

async function readEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  return parseEnv(await fsp.readFile(ENV_FILE, "utf8"));
}

async function setEnvValue(key, value) {
  await setEnvValues({ [key]: value });
}

function envLine(key, value) {
  const escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `${key}="${escaped}"`;
}

function patchEnvText(text, values) {
  const patches = Object.entries(values).map(([key, value]) => ({
    key,
    line: envLine(key, value),
    activePattern: new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`),
    commentedPattern: new RegExp(`^\\s*#\\s*${escapeRegExp(key)}\\s*=`),
  }));
  const eol = text.includes("\r\n") ? "\r\n" : os.EOL;
  const lines = text ? text.split(/\r?\n/) : [];

  for (const patch of patches) {
    const activeIndexes = [];
    let firstCommentedIndex = -1;
    for (let index = 0; index < lines.length; index += 1) {
      if (patch.activePattern.test(lines[index])) {
        activeIndexes.push(index);
      } else if (firstCommentedIndex === -1 && patch.commentedPattern.test(lines[index])) {
        firstCommentedIndex = index;
      }
    }

    if (activeIndexes.length) {
      for (const index of activeIndexes) lines[index] = patch.line;
      continue;
    }
    if (firstCommentedIndex !== -1) {
      lines[firstCommentedIndex] = patch.line;
    }
  }

  const missing = patches.filter((patch) => (
    !lines.some((line) => patch.activePattern.test(line))
  ));
  if (missing.length) {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(...missing.map((patch) => patch.line));
  }

  return lines.join(eol);
}

async function setEnvValues(values) {
  let text = "";
  if (fs.existsSync(ENV_FILE)) {
    text = await fsp.readFile(ENV_FILE, "utf8");
  }
  await writeTextAtomic(ENV_FILE, patchEnvText(text, values));
}

async function ensureAdminFiles() {
  await fsp.mkdir(path.join(ROOT_DIR, "data", "settings"), { recursive: true });
  await modService.ensureModsDir();

  if (!fs.existsSync(ENV_FILE) && fs.existsSync(ENV_EXAMPLE_FILE)) {
    await fsp.copyFile(ENV_EXAMPLE_FILE, ENV_FILE);
  }

  const env = await readEnv();
  const missingSecrets = {};
  if (!env.VNC_PASSWORD) missingSecrets.VNC_PASSWORD = newSecret(18);
  if (!env.API_KEY) missingSecrets.API_KEY = newSecret(32);
  if (!env.ADMIN_TOKEN) missingSecrets.ADMIN_TOKEN = newSecret(32);
  if (Object.keys(missingSecrets).length) await setEnvValues(missingSecrets);

  if (!fs.existsSync(SETTINGS_FILE)) {
    await writeSettings(cloneDefaultSettings());
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function readSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return cloneDefaultSettings();
  const parsed = JSON.parse(stripBom(await fsp.readFile(SETTINGS_FILE, "utf8")));
  return {
    ...cloneDefaultSettings(),
    ...parsed,
    Game: { ...cloneDefaultSettings().Game, ...(parsed.Game || {}) },
    Server: { ...cloneDefaultSettings().Server, ...(parsed.Server || {}) },
  };
}

function settingsFileText(settings) {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function tempFileFor(filePath) {
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.${suffix}.tmp`);
}

async function writeTextAtomic(filePath, text) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempFile = tempFileFor(filePath);
  try {
    await fsp.writeFile(tempFile, text, "utf8");
    await fsp.rename(tempFile, filePath);
  } finally {
    await fsp.rm(tempFile, { force: true }).catch(() => {});
  }
}

async function readOptionalText(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, text: "" };
  return { exists: true, text: await fsp.readFile(filePath, "utf8") };
}

async function restoreOptionalText(filePath, snapshot) {
  if (snapshot.exists) {
    await writeTextAtomic(filePath, snapshot.text);
    return;
  }
  await fsp.rm(filePath, { force: true });
}

async function writeRuntimeConfigFiles(settings, envValues) {
  const previousEnv = await readOptionalText(ENV_FILE);
  const envTemp = tempFileFor(ENV_FILE);
  const settingsTemp = tempFileFor(SETTINGS_FILE);
  let envCommitted = false;

  try {
    await fsp.mkdir(path.dirname(ENV_FILE), { recursive: true });
    await fsp.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
    await fsp.writeFile(envTemp, patchEnvText(previousEnv.text, envValues), "utf8");
    await fsp.writeFile(settingsTemp, settingsFileText(settings), "utf8");
    await fsp.rename(envTemp, ENV_FILE);
    envCommitted = true;
    await fsp.rename(settingsTemp, SETTINGS_FILE);
  } catch (error) {
    if (envCommitted) {
      await restoreOptionalText(ENV_FILE, previousEnv).catch((rollbackError) => {
        error.message = `${error.message}; rollback failed: ${rollbackError.message || rollbackError}`;
      });
    }
    throw error;
  } finally {
    await fsp.rm(envTemp, { force: true }).catch(() => {});
    await fsp.rm(settingsTemp, { force: true }).catch(() => {});
  }
}

async function writeSettings(settings) {
  await writeTextAtomic(SETTINGS_FILE, settingsFileText(settings));
}

function commandExists(command) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const pathEnv = process.env.PATH || "";
  return pathEnv.split(path.delimiter).some((dir) => fs.existsSync(path.join(dir, command + suffix)));
}

function run(command, args, options = {}) {
  const timeoutMs = options.timeoutMs || 15000;
  const maxOutputBytes = options.maxOutputBytes || CHILD_OUTPUT_MAX_BYTES;
  const killAfterTimeoutMs = options.killAfterTimeoutMs || CHILD_KILL_AFTER_TIMEOUT_MS;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env: process.env,
      windowsHide: true,
      shell: false,
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timedOut = false;
    let killTimer = null;

    function pushOutput(chunks, chunk, state) {
      if (state.bytes >= maxOutputBytes) {
        state.truncated = true;
        return state;
      }
      const remaining = maxOutputBytes - state.bytes;
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        return { bytes: maxOutputBytes, truncated: true };
      }
      chunks.push(chunk);
      return { bytes: state.bytes + chunk.length, truncated: state.truncated };
    }

    function outputText(chunks, truncated) {
      const text = Buffer.concat(chunks).toString();
      return truncated ? `${text}\n[output truncated]\n` : text;
    }

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      const stdout = outputText(stdoutChunks, stdoutTruncated);
      let stderr = outputText(stderrChunks, stderrTruncated);
      if (timedOut) {
        stderr += `\nCommand timed out after ${timeoutMs} ms.\n`;
      }
      resolve({ ...result, stdout, stderr });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, killAfterTimeoutMs);
      if (typeof killTimer.unref === "function") killTimer.unref();
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    child.stdout.on("data", (chunk) => {
      const next = pushOutput(stdoutChunks, chunk, { bytes: stdoutBytes, truncated: stdoutTruncated });
      stdoutBytes = next.bytes;
      stdoutTruncated = next.truncated;
    });
    child.stderr.on("data", (chunk) => {
      const next = pushOutput(stderrChunks, chunk, { bytes: stderrBytes, truncated: stderrTruncated });
      stderrBytes = next.bytes;
      stderrTruncated = next.truncated;
    });
    child.on("error", (error) => {
      stderrChunks.push(Buffer.from(error.message));
      finish({ ok: false, code: -1 });
    });
    child.on("close", (code, signal) => {
      finish({ ok: !timedOut && code === 0, code: code ?? -1, signal });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function docker(args, options = {}) {
  if (!commandExists("docker")) {
    return { ok: false, code: -1, stdout: "", stderr: "Docker command was not found." };
  }
  return run("docker", args, options);
}

async function compose(args, options = {}) {
  return docker(["compose", "--env-file", ENV_FILE, ...args], options);
}

async function ensureGameModsDirectory() {
  const modsDir = path.join(ROOT_DIR, "data", "mods");
  await fsp.mkdir(modsDir, { recursive: true });
  const script = "mkdir -p /data/game/Mods /data/Mods/user && touch /data/game/Mods/SVSK_PLACEHOLDER.txt";
  const result = await docker(
    ["run", "--rm", "--user", "0:0", "--mount", `type=bind,source=${modsDir},target=/data/Mods/user`, "busybox:1.36", "sh", "-lc", script],
    { timeoutMs: 120000 },
  );
  if (!result.ok) {
    throw new Error(await sanitize(result.stderr || result.stdout || "failed to prepare /data/game/Mods"));
  }
  return result;
}

async function composeUpDetached(options = {}) {
  await ensureGameModsDirectory();
  return compose(["up", "-d"], options);
}

async function sanitize(text) {
  const env = await readEnv();
  let next = stripAnsi(text || "");
  for (const key of [
    "STEAM_USERNAME",
    "STEAM_PASSWORD",
    "STEAM_REFRESH_TOKEN",
    "VNC_PASSWORD",
    "API_KEY",
    "ADMIN_TOKEN",
    "SERVER_PASSWORD",
    "NEXUS_API_KEY",
    "DISCORD_BOT_TOKEN",
  ]) {
    const value = env[key];
    if (value) next = next.split(value).join("<redacted>");
  }
  return next;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function html(res, body) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    try {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    } catch (_) {}
  }
  return cookies;
}

function normalizeAdminHost(host) {
  return String(host || "").trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

function isLoopbackAdminHost(host) {
  const normalized = normalizeAdminHost(host);
  return normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1" ||
    normalized.startsWith("127.");
}

function adminHostRequiresPublicHttpOptIn(host) {
  const normalized = normalizeAdminHost(host);
  return Boolean(normalized) && !isLoopbackAdminHost(normalized);
}

function isPublicHttpAdminAllowed(env = {}) {
  return bool(env[ADMIN_ALLOW_PUBLIC_HTTP_KEY] || process.env[ADMIN_ALLOW_PUBLIC_HTTP_KEY]);
}

function assertAdminBindAllowed(host, env = {}) {
  if (!adminHostRequiresPublicHttpOptIn(host) || isPublicHttpAdminAllowed(env)) return;
  throw new Error(
    `Refusing to run the admin panel over plain HTTP on public bind address ${host}. ` +
    "Use ADMIN_HOST=127.0.0.1 behind an HTTPS reverse proxy, or set " +
    `${ADMIN_ALLOW_PUBLIC_HTTP_KEY}=true only on a trusted private network.`,
  );
}

async function isAuthorized(req) {
  const env = await readEnv();
  const expected = env.ADMIN_TOKEN || "";
  if (!expected) return false;
  const token =
    req.headers["x-admin-token"] ||
    parseCookies(req)[ADMIN_COOKIE] ||
    "";
  const actual = Array.isArray(token) ? token[0] : token;
  if (!actual || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function requestTooLargeError() {
  return apiError(413, "请求体过大。");
}

async function readJsonBody(req, options = {}) {
  const maxBytes = options.maxBytes || JSON_BODY_MAX_BYTES;
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      const error = requestTooLargeError();
      req.destroy(error);
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readRequestBuffer(req, options = {}) {
  const maxBytes = options.maxBytes || JSON_BODY_MAX_BYTES;
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      const error = requestTooLargeError();
      req.destroy(error);
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function multipartBoundary(req, body) {
  const contentType = String(req.headers["content-type"] || "");
  const boundaryMatch = contentType.match(/multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  if (boundaryMatch) return boundaryMatch[1] || boundaryMatch[2];
  const firstLineEnd = body.indexOf(Buffer.from("\r\n"));
  const firstLine = body.slice(0, firstLineEnd === -1 ? Math.min(body.length, 200) : firstLineEnd).toString("latin1");
  if (firstLine.startsWith("--") && firstLine.length > 2) return firstLine.slice(2);
  return "";
}

function parseMultipartUpload(req, body) {
  const boundaryText = multipartBoundary(req, body);
  if (!boundaryText) {
    throw apiError(415, "本地上传必须使用 multipart/form-data。");
  }

  const boundary = Buffer.from(`--${boundaryText}`, "latin1");
  const parts = [];
  let cursor = body.indexOf(boundary);
  while (cursor !== -1) {
    cursor += boundary.length;
    if (body[cursor] === 45 && body[cursor + 1] === 45) break;
    if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2;

    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) break;
    const headerText = body.slice(cursor, headerEnd).toString("latin1");
    let dataStart = headerEnd + 4;
    let next = body.indexOf(boundary, dataStart);
    if (next === -1) break;
    let dataEnd = next;
    if (dataEnd >= 2 && body[dataEnd - 2] === 13 && body[dataEnd - 1] === 10) dataEnd -= 2;

    const disposition = headerText.match(/content-disposition:\s*form-data;([^\r\n]*)/i)?.[1] || "";
    const name = disposition.match(/name="([^"]+)"/i)?.[1] || "";
    const fileName = disposition.match(/filename="([^"]*)"/i)?.[1] || "";
    parts.push({ name, fileName, data: body.slice(dataStart, dataEnd) });
    cursor = next;
  }

  const payload = {};
  const filePart = parts.find((part) => part.name === "file");
  if (filePart) {
    payload.fileName = filePart.fileName;
    payload.buffer = filePart.data;
  }
  const displayNamePart = parts.find((part) => part.name === "displayName");
  if (displayNamePart) {
    payload.displayName = displayNamePart.data.toString("utf8");
  }
  return payload;
}

function uploadPayloadFromJson(body) {
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw apiError(400, "上传请求格式无效，请刷新页面后重新选择 zip 文件上传。");
  }
  const rawContent = typeof payload?.contentBase64 === "string" ? payload.contentBase64.trim() : "";
  const commaIndex = rawContent.indexOf(",");
  const base64 = (commaIndex >= 0 ? rawContent.slice(commaIndex + 1) : rawContent).replace(/\s+/g, "");
  return {
    fileName: payload?.fileName,
    displayName: payload?.displayName,
    buffer: base64 ? Buffer.from(base64, "base64") : Buffer.alloc(0),
  };
}

async function readUploadBody(req) {
  const body = await readRequestBuffer(req, { maxBytes: MOD_UPLOAD_BODY_MAX_BYTES });
  const contentType = String(req.headers["content-type"] || "");
  const firstByte = body.find((byte) => ![9, 10, 13, 32].includes(byte));
  if (/multipart\/form-data/i.test(contentType) || firstByte === 45) {
    return parseMultipartUpload(req, body);
  }
  if (/application\/json/i.test(contentType) || firstByte === 123) {
    return uploadPayloadFromJson(body);
  }
  throw apiError(415, "本地上传必须使用 multipart/form-data。");
}

function shouldQuoteJsonInteger(raw) {
  try {
    const value = BigInt(raw);
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    return value > maxSafe || value < -maxSafe;
  } catch (_) {
    return false;
  }
}

function quoteUnsafeJsonIntegers(jsonText) {
  const source = String(jsonText || "");
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length;) {
    const char = source[index];

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      index += 1;
      continue;
    }

    if (char === "\"") {
      inString = true;
      result += char;
      index += 1;
      continue;
    }

    if (char === "-" || /[0-9]/.test(char)) {
      const start = index;
      if (char === "-") index += 1;
      while (/[0-9]/.test(source[index] || "")) index += 1;

      let isInteger = true;
      if (source[index] === ".") {
        isInteger = false;
        index += 1;
        while (/[0-9]/.test(source[index] || "")) index += 1;
      }
      if (/[eE]/.test(source[index] || "")) {
        isInteger = false;
        index += 1;
        if (/[+-]/.test(source[index] || "")) index += 1;
        while (/[0-9]/.test(source[index] || "")) index += 1;
      }

      const raw = source.slice(start, index);
      result += isInteger && shouldQuoteJsonInteger(raw) ? `"${raw}"` : raw;
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

function parseJsonPreservingUnsafeIntegers(jsonText) {
  return JSON.parse(quoteUnsafeJsonIntegers(jsonText));
}

async function serverApiRequest(method, pathname, body, options = {}) {
  const env = await readEnv();
  if (env.API_ENABLED === "false") {
    if (options.optional) return null;
    throw apiError(503, "HTTP API 未启用，无法执行该玩家管理操作。");
  }

  const port = Number(env.API_PORT || 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    if (options.optional) return null;
    throw apiError(503, "HTTP API 端口无效，无法连接服务端 API。");
  }

  const headers = {};
  if (env.API_KEY) headers.Authorization = `Bearer ${env.API_KEY}`;
  let payload = null;
  if (body !== undefined && body !== null) {
    payload = typeof body === "string" ? body : JSON.stringify(body);
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method,
        headers,
        timeout: 2500,
      },
      (res) => {
        let body = "";
        let responseBytes = 0;
        const responseMaxBytes = options.responseMaxBytes || INTERNAL_API_RESPONSE_MAX_BYTES;
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseBytes += Buffer.byteLength(chunk);
          if (responseBytes > responseMaxBytes) {
            req.destroy(new Error("HTTP API response is too large."));
            res.destroy();
            return;
          }
          body += chunk;
        });
        res.on("end", () => {
          const statusCode = res.statusCode || 0;
          let parsed = null;
          if (body) {
            try {
              parsed = parseJsonPreservingUnsafeIntegers(body);
            } catch (_) {}
          }

          if (statusCode < 200 || statusCode >= 300) {
            if (options.optional) {
              resolve(null);
              return;
            }
            const message = parsed?.error || parsed?.message || `HTTP API returned ${statusCode}.`;
            reject(apiError(statusCode || 502, message));
            return;
          }
          resolve(parsed || {});
        });
      },
    );

    req.on("timeout", () => req.destroy(new Error("API request timed out.")));
    req.on("error", (error) => {
      if (options.optional) {
        resolve(null);
        return;
      }
      reject(apiError(503, `无法连接服务端 HTTP API：${error.message}`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function serverApiJson(pathname) {
  return serverApiRequest("GET", pathname, null, { optional: true });
}

const playerService = createPlayerService({
  serverApiJson,
  serverApiRequest,
  apiError,
  readFallbackFarmhands: readFarmhandsFromLatestSave,
  readApiDiagnostic: getServerApiDiagnostic,
});

function apiPortFromEnv(env) {
  const port = Number(env.API_PORT || 8080);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

async function serverApiProbe(pathname, options = {}) {
  const env = await readEnv();
  const port = apiPortFromEnv(env);
  if (!port) {
    return { ok: false, statusCode: 0, error: "HTTP API 端口无效。" };
  }

  const headers = {};
  if (options.auth !== false && env.API_KEY) {
    headers.Authorization = `Bearer ${env.API_KEY}`;
  }

  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method: "GET",
        headers,
        timeout: 2500,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (body.length < 4096) body += chunk;
        });
        res.on("end", () => {
          const statusCode = res.statusCode || 0;
          let parsed = null;
          if (body) {
            try {
              parsed = JSON.parse(body);
            } catch (_) {}
          }
          resolve({
            ok: statusCode >= 200 && statusCode < 300,
            statusCode,
            error: parsed?.error || parsed?.message || (statusCode ? `HTTP ${statusCode}` : ""),
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("API request timed out.")));
    req.on("error", (error) => resolve({ ok: false, statusCode: 0, error: error.message || String(error) }));
    req.end();
  });
}

function dockerEnvObject(envJson) {
  try {
    const items = JSON.parse(envJson || "[]");
    return Object.fromEntries((Array.isArray(items) ? items : [])
      .map((item) => {
        const index = String(item).indexOf("=");
        return index === -1 ? [String(item), ""] : [String(item).slice(0, index), String(item).slice(index + 1)];
      }));
  } catch (_) {
    return {};
  }
}

function dockerMountDestinations(mountsJson) {
  try {
    const mounts = JSON.parse(mountsJson || "[]");
    return (Array.isArray(mounts) ? mounts : [])
      .map((mount) => String(mount?.Destination || mount?.destination || "").trim())
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function inspectServerApiRuntimeEnv(projectEnv) {
  const result = await docker(
    ["inspect", "-f", DOCKER_INSPECT_API_FORMAT, "sdv-server"],
    { timeoutMs: 8000 },
  );
  if (!result.ok) {
    return {
      exists: false,
      running: false,
      error: await sanitize(result.stderr || result.stdout || "sdv-server 容器不存在。"),
    };
  }
  const [runningText, envJson = "[]", mountsJson = "[]"] = result.stdout.trim().split("\t");
  const containerEnv = dockerEnvObject(envJson);
  const mountDestinations = dockerMountDestinations(mountsJson);
  return {
    exists: true,
    running: runningText === "true",
    apiEnabled: containerEnv.API_ENABLED || "",
    apiPort: containerEnv.API_PORT || "",
    apiKeySet: Boolean(containerEnv.API_KEY),
    apiKeyMatches: String(containerEnv.API_KEY || "") === String(projectEnv.API_KEY || ""),
    apiPortMatches: String(containerEnv.API_PORT || "8080") === String(projectEnv.API_PORT || "8080"),
    apiEnabledMatches: String(containerEnv.API_ENABLED || "true") === String(projectEnv.API_ENABLED || "true"),
    userModsShadowApiMod: mountDestinations.includes("/data/Mods"),
  };
}

function apiDiagnosticMessage(env, runtime, healthProbe, statusProbe) {
  if (env.API_ENABLED === "false") {
    return "HTTP API 在 .env 中被关闭：API_ENABLED=false。";
  }
  if (!apiPortFromEnv(env)) {
    return "HTTP API 端口无效，请在配置页保存 1-65535 范围内的 API_PORT。";
  }
  if (!env.API_KEY) {
    return "HTTP API_KEY 为空；面板会自动补齐，但需要重启游戏服务端让容器读取新密钥。";
  }
  if (!runtime.exists) {
    return `sdv-server 容器不存在或无法检查：${runtime.error || "docker inspect 失败"}`;
  }
  if (!runtime.running) {
    return "sdv-server 容器没有运行，请先启动游戏服务端。";
  }
  if (runtime.apiEnabled === "false") {
    return "sdv-server 容器内 API_ENABLED=false；需要用当前 .env 重建游戏容器。";
  }
  if (runtime.userModsShadowApiMod) {
    return "当前 sdv-server 容器把宿主机 data/mods 挂载到了 /data/Mods，遮住了镜像内置 JunimoServer API Mod；请拉取最新代码并重建游戏容器。";
  }
  if (!runtime.apiEnabledMatches || !runtime.apiPortMatches || !runtime.apiKeyMatches) {
    return "sdv-server 容器内 API 配置与当前 .env 不一致；通常是只重启了 sdv-admin.service，没有重建游戏容器。请重启游戏服务端。";
  }
  if (statusProbe.statusCode === 401) {
    return "HTTP API 已启动，但 API_KEY 授权失败；当前 .env 和运行中容器的密钥不一致，需要重启游戏服务端。";
  }
  if (healthProbe.ok && !statusProbe.ok) {
    return `HTTP API 健康检查可用，但受保护接口失败：${statusProbe.error || "未知错误"}`;
  }
  return `无法连接服务端 HTTP API：${healthProbe.error || statusProbe.error || "连接失败"}`;
}

async function getServerApiDiagnostic() {
  const env = await readEnv();
  const runtime = await inspectServerApiRuntimeEnv(env).catch((error) => ({
    exists: false,
    running: false,
    error: error.message || String(error),
  }));
  const [healthProbe, statusProbe] = await Promise.all([
    serverApiProbe("/health", { auth: false }).catch((error) => ({ ok: false, statusCode: 0, error: error.message })),
    serverApiProbe("/status", { auth: true }).catch((error) => ({ ok: false, statusCode: 0, error: error.message })),
  ]);
  return {
    available: Boolean(statusProbe.ok),
    message: statusProbe.ok ? "服务端 HTTP API 已连接。" : apiDiagnosticMessage(env, runtime, healthProbe, statusProbe),
    env: {
      apiEnabled: env.API_ENABLED !== "false",
      apiPort: apiPortFromEnv(env) || 0,
      apiKeySet: Boolean(env.API_KEY),
    },
    container: runtime,
    probes: {
      health: healthProbe,
      status: statusProbe,
    },
  };
}

async function savesVolumeExists() {
  const inspect = await docker(["volume", "inspect", SAVES_VOLUME], { timeoutMs: 8000 });
  return inspect.ok;
}

async function listSaves() {
  if (!(await savesVolumeExists())) {
    return { volumeExists: false, saves: [] };
  }

  const script = [
    "set -eu",
    "base=/saves/Saves",
    '[ -d "$base" ] || exit 0',
    'for dir in "$base"/*; do',
    '  [ -d "$dir" ] || continue',
    '  name="${dir##*/}"',
    '  info="$dir/SaveGameInfo"',
    '  main="$dir/$name"',
    '  mtime="$(stat -c %Y "$dir" 2>/dev/null || echo 0)"',
    '  farm="$(sed -n \'s/.*<farmName>\\([^<]*\\)<\\/farmName>.*/\\1/p\' "$info" 2>/dev/null | head -n 1)"',
    '  farm_type="$(sed -n \'s/.*<whichFarm>\\([^<]*\\)<\\/whichFarm>.*/\\1/p\' "$main" 2>/dev/null | head -n 1)"',
    '  indoor_count="$(grep -o \'<indoors[^>]*xsi:type="Cabin"\' "$main" 2>/dev/null | wc -l | tr -d \' \')"',
    '  type_count="$(grep -E -o \'<buildingType>(Cabin|Log Cabin|Plank Cabin|Stone Cabin)</buildingType>\' "$main" 2>/dev/null | wc -l | tr -d \' \')"',
    '  cabins="$indoor_count"',
    '  [ "${cabins:-0}" -gt 0 ] || cabins="$type_count"',
    '  ref_count="$(grep -o \'<farmhandReference>-*[0-9]*</farmhandReference>\' "$main" 2>/dev/null | sed \'s/<\\/?farmhandReference>//g\' | sort -u | wc -l | tr -d \' \')"',
    '  unique_ids="$(grep -o \'<UniqueMultiplayerID>-*[0-9]*</UniqueMultiplayerID>\' "$main" 2>/dev/null | sed \'s/<\\/?UniqueMultiplayerID>//g\' | sort -u | wc -l | tr -d \' \')"',
    '  usable_cabins=0',
    '  if [ "${ref_count:-0}" -gt 0 ]; then usable_cabins="$ref_count"; elif [ "${unique_ids:-0}" -gt 1 ]; then usable_cabins=$((unique_ids - 1)); fi',
    '  if [ "${usable_cabins:-0}" -gt "${cabins:-0}" ]; then usable_cabins="$cabins"; fi',
    '  printf \'%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n\' "$name" "$mtime" "$farm" "$farm_type" "$cabins" "$usable_cabins"',
    "done",
  ].join("\n");

  const result = await docker(
    ["run", "--rm", "-v", `${SAVES_VOLUME}:/saves:ro`, "alpine:3.20", "sh", "-c", script],
    { timeoutMs: 15000 },
  );
  if (!result.ok) {
    throw new Error(await sanitize(result.stderr || result.stdout || "Failed to list saves."));
  }

  const saves = parseTableLines(result.stdout)
    .map((line) => {
      const [name, mtime, farmName, farmType, cabinCount, usableCabinCount] = line.split("\t");
      const updatedMs = Number(mtime) * 1000;
      const parsedFarmType = /^\d+$/.test(farmType || "") ? Number(farmType) : null;
      const parsedCabinCount = /^\d+$/.test(cabinCount || "") ? Number(cabinCount) : 0;
      const parsedUsableCabinCount = /^\d+$/.test(usableCabinCount || "") ? Number(usableCabinCount) : parsedCabinCount;
      return {
        name: tsv(name),
        farmName: decodeXmlText(tsv(farmName)) || "Unknown",
        farmType: parsedFarmType,
        cabinCount: parsedCabinCount,
        usableCabinCount: parsedUsableCabinCount,
        updatedAt: updatedMs > 0 ? new Date(updatedMs).toISOString() : null,
      };
    })
    .filter((item) => item.name)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  return { volumeExists: true, saves };
}

async function verifyPatchedSaveCabins(saveName, targetCabins) {
  if (targetCabins <= 1) return null;
  const verification = await readSaveCabinVerification(saveName, "Cabin patch verification failed");
  if (verification.cabinCount < targetCabins || verification.usableCabinCount < targetCabins) {
    throw new Error(
      `Cabin patch verification failed for ${saveName}: target ${targetCabins}, found ${verification.cabinCount} cabin building(s), ${verification.usableCabinCount} usable farmhand slot(s).`,
    );
  }
  return verification;
}

async function readSaveCabinVerification(saveName, failureLabel = "Cabin verification failed") {
  const safeSaveName = validateSaveName(saveName);
  const { saves } = await listSaves();
  const save = saves.find((item) => item.name === safeSaveName);
  if (!save) {
    throw new Error(`${failureLabel}: save not found (${safeSaveName}).`);
  }
  return {
    cabinCount: save.cabinCount,
    usableCabinCount: save.usableCabinCount,
  };
}

async function waitForNewGameSave(farmName, sinceMs, timeoutMs = NEW_GAME_SAVE_WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  const minUpdatedMs = Math.max(0, Number(sinceMs || 0) - 10000);
  let lastSeen = "";

  while (Date.now() < deadline) {
    const { saves } = await listSaves();
    lastSeen = saves
      .map((save) => `${save.name}:${save.farmName}:cabins=${save.cabinCount}:${save.updatedAt || "unknown"}`)
      .join(", ");
    const exact = saves.find((save) => {
      const updatedMs = save.updatedAt ? Date.parse(save.updatedAt) : 0;
      return save.farmName === farmName && (!updatedMs || updatedMs >= minUpdatedMs);
    });
    if (exact) return exact;

    const recent = saves.find((save) => {
      const updatedMs = save.updatedAt ? Date.parse(save.updatedAt) : 0;
      return save.cabinCount > 0 && updatedMs >= minUpdatedMs;
    });
    if (recent) return recent;

    await delay(NEW_GAME_SAVE_WAIT_POLL_MS);
  }

  throw new Error(`New save was not found after creating farm ${farmName}. Last seen saves: ${lastSeen || "none"}`);
}

async function copySaveFileFromVolume(saveName, tempDir) {
  const script = `set -eu
case "$SDV_SAVE_NAME" in ""|"."|".."|*/*|*\\\\*) echo "Unsafe save name."; exit 64;; esac
src="/saves/Saves/$SDV_SAVE_NAME/$SDV_SAVE_NAME"
if [ ! -f "$src" ]; then
  echo "Save file not found: $SDV_SAVE_NAME"
  exit 1
fi
cp "$src" /work/save.xml`;

  const result = await docker(
    [
      "run",
      "--rm",
      "-e",
      `SDV_SAVE_NAME=${saveName}`,
      "-v",
      `${SAVES_VOLUME}:/saves:ro`,
      "-v",
      `${tempDir}:/work`,
      "alpine:3.20",
      "sh",
      "-c",
      script,
    ],
    { timeoutMs: 30000 },
  );
  if (!result.ok) {
    throw new Error(await sanitize(result.stderr || result.stdout || "Failed to copy save file."));
  }
}

async function writeSaveFileToVolume(saveName, tempDir) {
  const script = `set -eu
case "$SDV_SAVE_NAME" in ""|"."|".."|*/*|*\\\\*) echo "Unsafe save name."; exit 64;; esac
target="/saves/Saves/$SDV_SAVE_NAME/$SDV_SAVE_NAME"
if [ ! -f "$target" ]; then
  echo "Save file not found: $SDV_SAVE_NAME"
  exit 1
fi
cp /work/save.xml "$target.tmp"
mv "$target.tmp" "$target"
chown 1000:1000 "$target" 2>/dev/null || true`;

  const result = await docker(
    [
      "run",
      "--rm",
      "-e",
      `SDV_SAVE_NAME=${saveName}`,
      "-v",
      `${SAVES_VOLUME}:/saves`,
      "-v",
      `${tempDir}:/work:ro`,
      "alpine:3.20",
      "sh",
      "-c",
      script,
    ],
    { timeoutMs: 30000 },
  );
  if (!result.ok) {
    throw new Error(await sanitize(result.stderr || result.stdout || "Failed to write save file."));
  }
}

async function patchSaveCabins(saveName, targetCabins) {
  const safeSaveName = validateSaveName(saveName);
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "sdv-cabins-"));
  try {
    await copySaveFileFromVolume(safeSaveName, tempDir);
    const saveFile = path.join(tempDir, "save.xml");
    const xml = await fsp.readFile(saveFile, "utf8");
    const patched = patchCabinsXml(xml, targetCabins);
    if (patched.changed) {
      await fsp.writeFile(saveFile, patched.xml, "utf8");
      await writeSaveFileToVolume(safeSaveName, tempDir);
    }
    const verification = await verifyPatchedSaveCabins(safeSaveName, targetCabins);

    return {
      saveName: safeSaveName,
      targetCabins,
      currentCabins: patched.currentCabins,
      cabinCount: patched.cabinCount,
      addedCabins: patched.addedCabins,
      movedCabins: patched.movedCabins,
      clearedFarmObstacles: patched.clearedFarmObstacles,
      fixedFarmhandIds: patched.fixedFarmhandIds,
      fixedCabinReferences: patched.fixedCabinReferences,
      addedFarmhands: patched.addedFarmhands,
      fixedFarmhandHomes: patched.fixedFarmhandHomes,
      verification,
      patched: patched.changed,
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function addOperationStep(steps, label, detail = "") {
  steps.push({
    at: new Date().toISOString(),
    label,
    detail,
  });
}

async function restartStackAfterNewGame(farmName, targetCabins, newGameStartedAtMs, steps = []) {
  const save = await waitForNewGameSave(farmName, newGameStartedAtMs);
  const selectedSaveName = validateSaveName(save.name);
  addOperationStep(steps, "已确认新存档生成", selectedSaveName);

  await sendSmapiCommand(`saves select ${selectedSaveName} --confirm`);
  addOperationStep(steps, "已自动设为下次加载", selectedSaveName);

  const nativeCabinVerification =
    targetCabins > 1
      ? await readSaveCabinVerification(selectedSaveName, "New save cabin verification failed")
      : null;
  const needsCabinPatch =
    targetCabins > 1 &&
    (
      nativeCabinVerification.cabinCount < targetCabins ||
      nativeCabinVerification.usableCabinCount < targetCabins
    );

  const down = await compose(["down"], { timeoutMs: 120000 });
  if (!down.ok) {
    throw new Error(await sanitize(down.stderr || down.stdout || "docker compose down failed"));
  }
  addOperationStep(steps, "已停止服务端", "准备写入新存档补丁并重新启动。");

  try {
    const cabinPatch = needsCabinPatch ? await patchSaveCabins(selectedSaveName, targetCabins) : null;
    if (cabinPatch) {
      addOperationStep(
        steps,
        "已补齐新存档小屋",
        `目标 ${targetCabins}，补建 ${cabinPatch.addedCabins || 0}，移动 ${cabinPatch.movedCabins || 0}，清理障碍 ${cabinPatch.clearedFarmObstacles || 0}，新增角色槽 ${cabinPatch.addedFarmhands || 0}`,
      );
    } else {
      addOperationStep(
        steps,
        "无需补齐小屋",
        nativeCabinVerification
          ? `目标 ${targetCabins}，新存档已有 ${nativeCabinVerification.cabinCount} 座小屋，可用角色槽 ${nativeCabinVerification.usableCabinCount} 个`
          : `目标小屋数 ${targetCabins}`,
      );
    }

    const up = await composeUpDetached({ timeoutMs: 120000 });
    if (!up.ok) {
      throw new Error(await sanitize(up.stderr || up.stdout || "docker compose up failed"));
    }
    const stackState = await inspectStackState();
    addOperationStep(
      steps,
      stackRestartVerified(stackState) ? "服务端重启已确认" : "服务端已发送启动命令",
      stackState.ok ? "已读取 Docker 容器状态。" : stackState.error,
    );
    return {
      message: "Server stack restarted.",
      newSaveName: selectedSaveName,
      selectedSaveName,
      cabinPatch,
      restarted: true,
      restartVerified: stackRestartVerified(stackState),
      stackState,
      steps,
    };
  } catch (error) {
    await composeUpDetached({ timeoutMs: 120000 }).catch(() => {});
    throw error;
  }
}

async function listBackups() {
  try {
    await fsp.mkdir(BACKUP_DIR, { recursive: true });
  } catch (_) {
    return [];
  }

  const entries = await fsp.readdir(BACKUP_DIR, { withFileTypes: true });
  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile() || !BACKUP_ARCHIVE_PATTERN.test(entry.name)) continue;
    const archivePath = path.join(BACKUP_DIR, entry.name);
    const stat = await fsp.stat(archivePath);
    const metadataPath = path.join(BACKUP_DIR, entry.name.replace(/\.tar\.gz$/, ".meta.txt"));
    let metadata = {};
    try {
      metadata = parseMetadata(await fsp.readFile(metadataPath, "utf8"));
    } catch (_) {}
    backups.push({
      archive: entry.name,
      sizeBytes: stat.size,
      createdAt: metadata.created_at || stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      metadata,
    });
  }
  backups.sort((a, b) => String(b.createdAt || b.modifiedAt).localeCompare(String(a.createdAt || a.modifiedAt)));
  return backups;
}

async function readBackupPolicy() {
  const env = await readEnv();
  const interval = Number.parseInt(env.SAVE_BACKUP_INTERVAL_MINUTES || "", 10);
  const retention = Number.parseInt(env.SAVE_BACKUP_RETENTION || "", 10);
  return {
    enabled: boolWithDefault(env.AUTO_BACKUP_ENABLED, DEFAULT_AUTO_BACKUP_ENABLED),
    intervalMinutes:
      Number.isInteger(interval) &&
      interval >= MIN_AUTO_BACKUP_INTERVAL_MINUTES &&
      interval <= MAX_AUTO_BACKUP_INTERVAL_MINUTES
        ? interval
        : DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
    retention:
      Number.isInteger(retention) && retention >= MIN_BACKUP_RETENTION && retention <= MAX_BACKUP_RETENTION
        ? retention
        : DEFAULT_BACKUP_RETENTION,
  };
}

function getAutoBackupState() {
  return {
    enabled: autoBackupState.enabled,
    intervalMinutes: autoBackupState.intervalMinutes,
    retention: autoBackupState.retention,
    running: autoBackupState.running,
    nextRunAt: autoBackupState.nextRunAt,
    lastRunAt: autoBackupState.lastRunAt,
    lastResult: autoBackupState.lastResult,
  };
}

async function pruneBackups(retention, options = {}) {
  const keepCount = intInRange(retention, "Backup retention", MIN_BACKUP_RETENTION, MAX_BACKUP_RETENTION);
  const preserve = new Set(options.preserveArchives || []);
  const backups = await listBackups();
  const deleted = [];
  let kept = 0;

  for (const backup of backups) {
    if (preserve.has(backup.archive)) {
      kept += 1;
      continue;
    }
    if (kept < keepCount) {
      kept += 1;
      continue;
    }

    const archivePath = path.join(BACKUP_DIR, backup.archive);
    const metadataPath = path.join(BACKUP_DIR, backup.archive.replace(/\.tar\.gz$/, ".meta.txt"));
    await fsp.unlink(archivePath);
    try {
      await fsp.unlink(metadataPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    deleted.push(backup.archive);
  }

  return deleted;
}

async function readSaveConfigFromVolume(payload) {
  const saveName = validateSaveName(payload.saveName);
  const [{ saves }, settings] = await Promise.all([listSaves(), readSettings()]);
  const save = saves.find((item) => item.name === saveName);
  if (!save) {
    throw new Error(`Save not found: ${saveName}`);
  }
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "sdv-config-"));
  try {
    await copySaveFileFromVolume(saveName, tempDir);
    const xml = await fsp.readFile(path.join(tempDir, "save.xml"), "utf8");
    return { saveName, config: extractSaveConfig(xml), save, settings };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function readFarmhandsFromLatestSave() {
  const { saves } = await listSaves();
  const save = saves[0];
  if (!save) return { saveName: "", farmhands: [] };

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "sdv-farmhands-"));
  try {
    await copySaveFileFromVolume(save.name, tempDir);
    const xml = await fsp.readFile(path.join(tempDir, "save.xml"), "utf8");
    return {
      saveName: save.name,
      farmhands: extractFarmhands(xml),
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function writeSaveConfigToVolume(payload) {
  const saveName = validateSaveName(payload.saveName);
  const { saves } = await listSaves();
  if (!saves.some((save) => save.name === saveName)) {
    throw new Error(`Save not found: ${saveName}`);
  }

  const edits = {};
  if (payload.farmName != null) {
    edits.farmName = cleanText(payload.farmName, 48, "Farm");
  }
  if (payload.money != null) {
    edits.money = intInRange(payload.money, "Money", 0, 999999999);
  }
  if (payload.year != null) {
    edits.year = intInRange(payload.year, "Year", 1, 9999);
  }
  if (payload.currentSeason != null) {
    edits.currentSeason = stringChoice(payload.currentSeason, "Season", ["spring", "summer", "fall", "winter"]);
  }
  if (payload.dayOfMonth != null) {
    edits.dayOfMonth = intInRange(payload.dayOfMonth, "Day", 1, 28);
  }

  const settings = await readSettings();
  const maintenanceEdits = applySaveMaintenanceSettings(settings, payload);
  const hasSaveEdits = Object.keys(edits).length > 0;
  const hasMaintenanceEdits = Object.keys(maintenanceEdits).length > 0;
  if (!hasSaveEdits && !hasMaintenanceEdits) {
    throw new Error("No editable fields provided.");
  }

  const preEditBackup = hasSaveEdits
    ? await createSavesBackup(`Automatic backup before editing config of save ${saveName}.`)
    : null;
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "sdv-config-"));
  try {
    await copySaveFileFromVolume(saveName, tempDir);
    const saveFile = path.join(tempDir, "save.xml");
    const xml = await fsp.readFile(saveFile, "utf8");
    const patched = hasSaveEdits ? applySaveConfigEdits(xml, edits) : xml;
    if (hasSaveEdits) {
      await fsp.writeFile(saveFile, patched, "utf8");
      await writeSaveFileToVolume(saveName, tempDir);
    }
    if (Object.keys(maintenanceEdits).length) {
      await writeSettings(settings);
    }
    return {
      saveName,
      edits,
      maintenanceEdits,
      preEditBackup: preEditBackup?.archive || null,
      config: extractSaveConfig(patched),
      settings,
      restartRequired: Boolean(Object.keys(maintenanceEdits).length),
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function getSaveManagement() {
  const [{ volumeExists, saves }, backups, backupPolicy] = await Promise.all([
    listSaves(),
    listBackups(),
    readBackupPolicy(),
  ]);
  return { volumeExists, saves, backups, backupPolicy, autoBackup: getAutoBackupState() };
}

function findRecentSave(logText) {
  const lines = stripAnsi(logText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const matched = lines.filter((line) => SAVE_COMPLETE_PATTERN.test(line));
  const lastLine = matched.length ? matched[matched.length - 1] : "";
  return {
    hasRecentSave: Boolean(lastLine),
    lastSaveLine: lastLine,
  };
}

function buildShutdownReadiness(playerManagement, signals, apiStatus) {
  const saveInfo = findRecentSave(signals?.logs || "");
  const apiPlayersAvailable = playerManagement.apiAvailable && Array.isArray(playerManagement.onlinePlayers);
  const apiStatusCount = Number(apiStatus?.playerCount);
  let onlinePlayerCount = null;

  if (apiPlayersAvailable) {
    onlinePlayerCount = playerManagement.onlinePlayers.length;
  } else if (Number.isFinite(apiStatusCount) && apiStatusCount >= 0) {
    onlinePlayerCount = apiStatusCount;
  }

  const onlinePlayerCountKnown = onlinePlayerCount !== null;
  let mode = "unknown";
  let message = "无法确认当前在线人数。停服前建议先确认游戏内无人在线，或等待下一次过夜存档。";

  if (onlinePlayerCountKnown && onlinePlayerCount === 0) {
    mode = "safe-empty";
    message = "在线人数为 0，可以直接停服释放 Docker 资源。";
  } else if (onlinePlayerCountKnown && onlinePlayerCount > 0 && saveInfo.hasRecentSave) {
    mode = "safe-saved";
    message = `当前在线 ${onlinePlayerCount} 人，但最近检测到 SaveGame.Save，存档已完成，可以安全停止。`;
  } else if (onlinePlayerCountKnown && onlinePlayerCount > 0) {
    mode = "warn-unsaved";
    message = `当前在线 ${onlinePlayerCount} 人，最近日志里没有检测到完成的 SaveGame.Save，玩家可能有未保存进度。`;
  } else if (saveInfo.hasRecentSave) {
    mode = "unknown-saved";
    message = "无法确认在线人数，但最近检测到 SaveGame.Save。停服前仍建议确认玩家状态。";
  }

  return {
    mode,
    message,
    onlinePlayerCount,
    onlinePlayerCountKnown,
    hasRecentSave: saveInfo.hasRecentSave,
    lastSaveLine: saveInfo.lastSaveLine,
    logWindow: "最近 260 行服务端运行日志",
  };
}

function parsePlayers(logText) {
  const players = new Map();
  for (const line of stripAnsi(logText).split(/\r?\n/)) {
    const joined = line.match(/OnChatMessage:\s*(.+?)\s*\(([^)]+)\)\s*has joined/i);
    if (joined) {
      players.set(joined[1], {
        name: joined[1],
        address: joined[2],
        lastEvent: "joined",
        line: line.trim(),
      });
      continue;
    }
    const disconnected = line.match(/OnChatMessage:\s*(.+?)\s*(has left|disconnected)/i);
    if (disconnected) {
      const previous = players.get(disconnected[1]) || { name: disconnected[1], address: "" };
      players.set(disconnected[1], {
        ...previous,
        lastEvent: "left",
        line: line.trim(),
      });
    }
  }
  return Array.from(players.values()).reverse().slice(0, 12);
}

async function runtimeSignals() {
  const output = await docker(
    [
      "exec",
      "sdv-server",
      "sh",
      "-lc",
      "printf 'invite_code='; cat /tmp/invite-code.txt 2>/dev/null || printf 'n/a'; printf '\\n'; tail -n 260 /tmp/server-output.log 2>/dev/null || true",
    ],
    { timeoutMs: 12000 },
  );
  const sanitized = await sanitize(output.stdout || output.stderr || "");
  const inviteMatch = sanitized.match(/^invite_code=(.*)$/m);
  const logs = sanitized
    .split(/\r?\n/)
    .filter((line) => !/^invite_code=|Connected to the docker container shell|Exit and run 'make cli'/.test(line))
    .join("\n");
  return {
    inviteCode: inviteMatch ? inviteMatch[1].trim() : "n/a",
    logs,
    players: parsePlayers(logs),
  };
}

async function getStatus() {
  const env = await readEnv();
  const settings = await readSettings();
  const [ps, stats, ports, inspect, signals, apiStatus, apiPlayers, apiFarmhands, apiAuth] = await Promise.all([
    docker(["ps", "--filter", "name=sdv", "--format", "{{.Names}}\t{{.Status}}\t{{.Ports}}"]),
    docker(["stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}", "sdv-server", "sdv-steam-auth"], {
      timeoutMs: 8000,
    }),
    docker(["port", "sdv-server"], { timeoutMs: 8000 }),
    docker(
      [
        "inspect",
        "-f",
        "{{.Name}}\t{{.State.Status}}\t{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}\t{{.State.StartedAt}}",
        "sdv-server",
        "sdv-steam-auth",
      ],
      { timeoutMs: 8000 },
    ),
    runtimeSignals().catch((error) => ({ inviteCode: "n/a", logs: error.message, players: [] })),
    serverApiJson("/status").catch(() => null),
    serverApiJson("/players").catch(() => null),
    serverApiJson("/farmhands").catch(() => null),
    serverApiJson("/auth").catch(() => null),
  ]);
  const apiDiagnostic = !(apiStatus || apiPlayers || apiFarmhands || apiAuth)
    ? await getServerApiDiagnostic().catch(() => null)
    : null;
  const fallbackFarmhands = hasFarmhandList(apiFarmhands)
    ? null
    : await readFarmhandsFromLatestSave().catch(() => null);
  const playerManagement = buildPlayerManagement(apiPlayers, apiFarmhands, apiAuth, signals.players, {
    fallbackFarmhands: fallbackFarmhands?.farmhands || [],
    fallbackSaveName: fallbackFarmhands?.saveName || "",
    apiDiagnostic,
  });
  const shutdownReadiness = buildShutdownReadiness(playerManagement, signals, apiStatus);
  const containers = parseTableLines(ps.stdout).map((line) => {
    const [name, status, portText] = line.split("\t");
    return { name, status, ports: portText || "" };
  });

  return {
    generatedAt: new Date().toISOString(),
    dockerAvailable: commandExists("docker"),
    stackRunning: containers.some((item) => item.name === "sdv-server"),
    containers,
    health: parseTableLines(inspect.stdout).map((line) => {
      const [name, status, health, startedAt] = line.split("\t");
      return { name: name ? name.replace(/^\//, "") : "", status, health, startedAt };
    }),
    stats: parseTableLines(stats.stdout).map((line) => {
      const [name, cpu, memory] = line.split("\t");
      return { name, cpu, memory };
    }),
    publishedPorts: parseTableLines(ports.stdout),
    lanAddresses: listLanAddresses(),
    join: {
      sameMachine: "127.0.0.1",
      gamePort: Number(env.GAME_PORT || 24642),
      queryPort: Number(env.QUERY_PORT || 27015),
      inviteCode: signals.inviteCode,
      allowIpConnections: Boolean(settings.Server.AllowIpConnections),
    },
    runtime: apiStatus
      ? {
          farmName: apiStatus.farmName || "",
          day: apiStatus.day || 0,
          season: apiStatus.season || "",
          year: apiStatus.year || 0,
          timeOfDay: apiStatus.timeOfDay || 0,
          playerCount: apiStatus.playerCount || 0,
          maxPlayers: apiStatus.maxPlayers || 0,
          isReady: Boolean(apiStatus.isReady),
        }
      : null,
    players: playerManagement.onlinePlayers.length
      ? playerManagement.onlinePlayers.map((player) => ({
          name: player.name,
          address: player.id ? `ID: ${player.id}` : "",
          lastEvent: "online",
        }))
      : signals.players,
    playerManagement,
    serverApi: apiDiagnostic,
    shutdownReadiness,
    shutdownJob: getStopAfterSaveJob(),
    recentSignals: signals.logs.split(/\r?\n/).filter(Boolean).slice(-260),
  };
}

async function getConfig() {
  const env = await readEnv();
  const settings = await readSettings();
  return {
    farmTypes: FARM_TYPES,
    settings,
    env: {
      imageVersion: env.IMAGE_VERSION || "preview",
      gamePort: Number(env.GAME_PORT || 24642),
      queryPort: Number(env.QUERY_PORT || 27015),
      vncPort: Number(env.VNC_PORT || 5800),
      apiPort: Number(env.API_PORT || 8080),
      adminHost: env.ADMIN_HOST || "127.0.0.1",
      adminPort: Number(env.ADMIN_PORT || 8088),
      steamUsernameSet: Boolean(env.STEAM_USERNAME),
      steamPasswordSet: Boolean(env.STEAM_PASSWORD || env.STEAM_REFRESH_TOKEN),
      serverPasswordSet: Boolean(env.SERVER_PASSWORD),
      nexusApiKeySet: Boolean(env.NEXUS_API_KEY),
      apiEnabled: env.API_ENABLED !== "false",
    },
  };
}

function applyGameCreationSettings(settings, payload) {
  settings.Game.FarmName = cleanText(payload.farmName, 48, "Junimo");
  settings.Game.FarmType = intInRange(payload.farmType, "Farm type", 0, 7);
  settings.Game.ProfitMargin = numberInSet(payload.profitMargin, "Profit margin", [1, 0.75, 0.5, 0.25]);
  settings.Game.StartingCabins = intInRange(payload.startingCabins, "Starting cabins", 0, 9);
  settings.Game.SpawnMonstersAtNight = stringChoice(payload.spawnMonstersAtNight, "Monster spawn", [
    "auto",
    "true",
    "false",
  ]);
}

function applyRuntimeSettings(settings, payload) {
  settings.Server.MaxPlayers = intInRange(payload.maxPlayers, "Max players", 1, 10);
  settings.Server.CabinStrategy = stringChoice(payload.cabinStrategy, "Cabin strategy", [
    "CabinStack",
    "None",
  ]);
  settings.Server.ExistingCabinBehavior = stringChoice(payload.existingCabinBehavior, "Existing cabin behavior", [
    "KeepExisting",
  ]);
  settings.Server.SeparateWallets = bool(payload.separateWallets);
  settings.Server.AllowIpConnections = bool(payload.allowIpConnections);
  settings.Server.VerboseLogging = bool(payload.verboseLogging);
  settings.Server.LobbyMode = stringChoice(payload.lobbyMode, "Lobby mode", ["Shared", "Individual"]);
  settings.Server.AdminSteamIds = parseSteamIds(payload.adminSteamIds);
}

function applySaveMaintenanceSettings(settings, payload) {
  const edits = {};
  if (payload.maxPlayers != null) {
    edits.maxPlayers = intInRange(payload.maxPlayers, "Max players", 1, 10);
    settings.Server.MaxPlayers = edits.maxPlayers;
  }
  if (payload.targetCabins != null) {
    edits.targetCabins = intInRange(payload.targetCabins, "Target cabins", 1, 9);
    settings.Game.StartingCabins = edits.targetCabins;
  }
  return edits;
}

function runtimeEnvValues(payload, settings) {
  const values = {
    GAME_PORT: intInRange(payload.gamePort, "Game port", 1, 65535),
    QUERY_PORT: intInRange(payload.queryPort, "Query port", 1, 65535),
    VNC_PORT: intInRange(payload.vncPort, "VNC port", 1, 65535),
    API_PORT: intInRange(payload.apiPort, "API port", 1, 65535),
    VERBOSE_LOGGING: settings.Server.VerboseLogging ? "true" : "false",
  };

  const passwordAction = payload.serverPasswordAction || "keep";
  if (passwordAction === "clear") {
    values.SERVER_PASSWORD = "";
  } else if (passwordAction === "set") {
    values.SERVER_PASSWORD = cleanText(payload.serverPassword, 80, "");
  } else if (passwordAction !== "keep") {
    throw new Error("Server password action is invalid.");
  }

  const nexusApiKeyAction = payload.nexusApiKeyAction || "keep";
  if (nexusApiKeyAction === "clear") {
    values.NEXUS_API_KEY = "";
  } else if (nexusApiKeyAction === "set") {
    const nexusApiKey = cleanText(payload.nexusApiKey, 256, "");
    if (!nexusApiKey) {
      throw new Error("Nexus API Key cannot be empty when setting a new key.");
    }
    values.NEXUS_API_KEY = nexusApiKey;
  } else if (nexusApiKeyAction !== "keep") {
    throw new Error("Nexus API key action is invalid.");
  }

  return values;
}

async function saveNewGameConfig(payload, options = {}) {
  const previousSettings = await readSettings();
  const settings = JSON.parse(JSON.stringify(previousSettings));
  applyGameCreationSettings(settings, payload);
  settings.Server.MaxPlayers = intInRange(payload.maxPlayers, "Max players", 1, 10);
  settings.Server.SeparateWallets = bool(payload.separateWallets);

  if (options.forceCabinStrategy) {
    settings.Server.CabinStrategy = stringChoice(
      options.forceCabinStrategy,
      "Cabin strategy",
      ["CabinStack", "None"],
    );
  }

  await writeSettings(settings);

  return {
    settings,
    restartRequired: true,
    newGameOnlyChanged: hasSettingChanges(previousSettings, settings, NEW_GAME_ONLY_SETTING_PATHS),
  };
}

async function saveConfig(payload) {
  const previousSettings = await readSettings();
  const settings = JSON.parse(JSON.stringify(previousSettings));
  applyRuntimeSettings(settings, payload);
  const envValues = runtimeEnvValues(payload, settings);

  await writeRuntimeConfigFiles(settings, envValues);

  return {
    settings,
    restartRequired: true,
    newGameOnlyChanged: hasSettingChanges(previousSettings, settings, NEW_GAME_ONLY_SETTING_PATHS),
  };
}

async function restartStack() {
  const previousStackState = await inspectStackState();
  const down = await compose(["down"], { timeoutMs: 120000 });
  if (!down.ok) {
    throw new Error(await sanitize(down.stderr || down.stdout || "docker compose down failed"));
  }
  const up = await composeUpDetached({ timeoutMs: 120000 });
  if (!up.ok) {
    throw new Error(await sanitize(up.stderr || up.stdout || "docker compose up failed"));
  }
  const stackState = await waitForStackReady("重启");
  return {
    message: "Server stack restarted.",
    restarted: true,
    restartVerified: true,
    previousStackState,
    stackState,
  };
}

async function repairServerApi() {
  const env = await readEnv();
  const patches = {};
  if (env.API_ENABLED === "false") patches.API_ENABLED = "true";
  if (!env.API_KEY) patches.API_KEY = newSecret(32);
  if (!apiPortFromEnv(env)) patches.API_PORT = "8080";
  if (Object.keys(patches).length) await setEnvValues(patches);

  const before = await getServerApiDiagnostic().catch(() => null);
  if (before?.available) {
    return {
      repaired: false,
      restarted: false,
      message: "服务端 HTTP API 已可用，无需修复。",
      before,
      after: before,
    };
  }

  const restart = await restartStack();
  const after = await getServerApiDiagnostic();
  if (!after.available) {
    throw apiError(503, after.message || "HTTP API 修复后仍不可用。");
  }
  return {
    repaired: true,
    restarted: true,
    message: "已修复 HTTP API 配置并重启游戏服务端。",
    before,
    after,
    restart,
  };
}

async function startStack() {
  const up = await composeUpDetached({ timeoutMs: 120000 });
  if (!up.ok) {
    throw new Error(await sanitize(up.stderr || up.stdout || "docker compose up failed"));
  }
  const stackState = await waitForStackReady("启动");
  return {
    message: "Server stack started.",
    started: true,
    startVerified: true,
    stackState,
  };
}

async function stopStack(reason = "Stopped from admin panel.") {
  const down = await compose(["down"], { timeoutMs: 120000 });
  if (!down.ok) {
    throw new Error(await sanitize(down.stderr || down.stdout || "docker compose down failed"));
  }
  return {
    message: "Server stack stopped. Docker volumes and project data were preserved.",
    reason,
  };
}

function getStopAfterSaveJob() {
  if (!pendingStopAfterSave) return null;
  const { timer, ...job } = pendingStopAfterSave;
  return job;
}

function finishStopAfterSaveJob(updates) {
  if (!pendingStopAfterSave) return null;
  if (pendingStopAfterSave.timer) {
    clearInterval(pendingStopAfterSave.timer);
    pendingStopAfterSave.timer = null;
  }
  pendingStopAfterSave = {
    ...pendingStopAfterSave,
    active: false,
    finishedAt: new Date().toISOString(),
    ...updates,
  };
  return getStopAfterSaveJob();
}

async function collectShutdownReadiness() {
  const [signals, apiStatus, apiPlayers, apiFarmhands, apiAuth] = await Promise.all([
    runtimeSignals().catch((error) => ({ inviteCode: "n/a", logs: error.message, players: [] })),
    serverApiJson("/status").catch(() => null),
    serverApiJson("/players").catch(() => null),
    serverApiJson("/farmhands").catch(() => null),
    serverApiJson("/auth").catch(() => null),
  ]);
  const playerManagement = buildPlayerManagement(apiPlayers, apiFarmhands, apiAuth, signals.players);
  return buildShutdownReadiness(playerManagement, signals, apiStatus);
}

async function checkStopAfterSaveJob() {
  if (!pendingStopAfterSave || !pendingStopAfterSave.active || pendingStopAfterSave.state !== "waiting") return;

  const now = Date.now();
  if (now >= pendingStopAfterSave.timeoutAtMs) {
    finishStopAfterSaveJob({
      state: "timed-out",
      message: "等待过夜存档超时，未执行停服。",
    });
    return;
  }

  try {
    const readiness = await collectShutdownReadiness();
    pendingStopAfterSave = {
      ...pendingStopAfterSave,
      lastCheckAt: new Date().toISOString(),
      readiness,
      message: readiness.message,
    };

    const canStop =
      readiness.hasRecentSave ||
      (readiness.onlinePlayerCountKnown && readiness.onlinePlayerCount === 0);
    if (!canStop) return;

    pendingStopAfterSave = {
      ...pendingStopAfterSave,
      state: "stopping",
      message: readiness.hasRecentSave
        ? "已检测到 SaveGame.Save，正在自动停服。"
        : "在线人数已变为 0，正在自动停服。",
    };
    await stopStack("Automatic stop after save/empty server.");
    finishStopAfterSaveJob({
      state: "stopped",
      message: "已自动停服，Docker 资源已释放，数据已保留。",
    });
  } catch (error) {
    finishStopAfterSaveJob({
      state: "failed",
      message: error.message || String(error),
    });
  }
}

function startStopAfterSaveJob(readiness) {
  if (pendingStopAfterSave?.active) return getStopAfterSaveJob();

  const now = Date.now();
  pendingStopAfterSave = {
    active: true,
    state: "waiting",
    requestedAt: new Date(now).toISOString(),
    lastCheckAt: null,
    timeoutAt: new Date(now + STOP_AFTER_SAVE_TIMEOUT_MS).toISOString(),
    timeoutAtMs: now + STOP_AFTER_SAVE_TIMEOUT_MS,
    readiness,
    message: "正在等待下一次 SaveGame.Save；检测到过夜存档完成后会自动停服。",
    timer: null,
  };

  pendingStopAfterSave.timer = setInterval(() => {
    checkStopAfterSaveJob().catch(() => {});
  }, STOP_AFTER_SAVE_CHECK_MS);
  if (typeof pendingStopAfterSave.timer.unref === "function") {
    pendingStopAfterSave.timer.unref();
  }
  checkStopAfterSaveJob().catch(() => {});
  return getStopAfterSaveJob();
}

function cancelStopAfterSaveJob() {
  if (!pendingStopAfterSave?.active) {
    return getStopAfterSaveJob();
  }
  return finishStopAfterSaveJob({
    state: "canceled",
    message: "已取消等待存档后自动停服。",
  });
}

async function requestStopStack(payload) {
  const mode = payload.mode || "now";
  if (mode === "after-save") {
    const readiness = await collectShutdownReadiness();
    if (
      readiness.hasRecentSave ||
      (readiness.onlinePlayerCountKnown && readiness.onlinePlayerCount === 0)
    ) {
      return stopStack("Stopped immediately because the server is already saved or empty.");
    }
    return {
      pending: true,
      job: startStopAfterSaveJob(readiness),
    };
  }

  if (mode !== "now") {
    throw new Error("Stop mode is invalid.");
  }
  const readiness = await collectShutdownReadiness();
  if (!["safe-empty", "safe-saved"].includes(readiness.mode) && payload.force !== true) {
    throw apiError(409, readiness.message);
  }
  return stopStack("Stopped from admin panel.");
}

function isSafeForImmediateRestart(readiness) {
  return ["safe-empty", "safe-saved"].includes(readiness?.mode);
}

async function latestLogs(options = {}) {
  const tail = Number.parseInt(options.tail || LATEST_LOG_LINES, 10);
  const safeTail = Number.isFinite(tail) && tail > 0 ? Math.min(tail, 20000) : LATEST_LOG_LINES;
  const logs = await compose(
    ["logs", "--tail", String(safeTail), "--no-color", "server", "steam-auth"],
    { timeoutMs: 20000, maxOutputBytes: LATEST_LOG_MAX_BYTES },
  );
  return { logs: await sanitize(logs.stdout || logs.stderr || "") };
}

async function latestServerLogText() {
  const [composeLogs, runtime] = await Promise.all([
    latestLogs().catch((error) => ({ logs: error.message || String(error) })),
    runtimeSignals().catch((error) => ({ logs: error.message || String(error) })),
  ]);
  return [composeLogs.logs || "", runtime.logs || ""].filter(Boolean).join("\n");
}

function publicEnvSnapshot(env) {
  return {
    apiEnabled: env.API_ENABLED !== "false",
    apiPort: apiPortFromEnv(env) || 0,
    apiKeySet: Boolean(env.API_KEY),
    adminHost: env.ADMIN_HOST || "127.0.0.1",
    adminPort: Number(env.ADMIN_PORT || 8088),
    imageVersion: env.IMAGE_VERSION || "preview",
    gamePort: Number(env.GAME_PORT || 24642),
    queryPort: Number(env.QUERY_PORT || 27015),
    nexusApiKeySet: Boolean(env.NEXUS_API_KEY),
  };
}

function normalizeComposePsItem(item) {
  return {
    name: item.Name || item.name || "",
    service: item.Service || item.service || "",
    state: item.State || item.state || "",
    status: item.Status || item.status || "",
    ports: item.Publishers || item.Ports || item.ports || "",
  };
}

async function inspectComposePs() {
  const result = await compose(["ps", "-a", "--format", "json"], { timeoutMs: 12000 });
  if (!result.ok) {
    return {
      ok: false,
      error: await sanitize(result.stderr || result.stdout || "docker compose ps failed"),
      containers: [],
    };
  }

  const containers = [];
  const output = String(result.stdout || "").trim();
  try {
    const parsed = JSON.parse(output);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return { ok: true, containers: items.map((item) => normalizeComposePsItem(item)) };
  } catch (_) {}

  for (const line of parseTableLines(output)) {
    try {
      const item = JSON.parse(line);
      containers.push(normalizeComposePsItem(item));
    } catch (_) {
      containers.push({ raw: line });
    }
  }

  return { ok: true, containers };
}

function uniqueDiagnosticLines(lines, maxItems = 20) {
  const result = [];
  const seen = new Set();
  for (const rawLine of lines) {
    const line = cleanText(rawLine, 420, "");
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
    if (result.length >= maxItems) break;
  }
  return result;
}

function stripComposeServicePrefix(line) {
  return String(line || "").replace(/^[A-Za-z0-9_.-]+(?:-\d+)?\s+\|\s*/, "").trim();
}

function buildSteamAuthLogReport(logText) {
  const rawLines = stripAnsi(logText || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-1200);
  const steamAuthLines = rawLines.filter((line) => /^[A-Za-z0-9_.-]*steam-auth(?:-\d+)?\s+\|/i.test(line));
  const sourceLines = steamAuthLines.length ? steamAuthLines : rawLines;
  const lines = sourceLines.map(stripComposeServicePrefix);
  const text = lines.join("\n");
  const notLoggedIn = /No saved session|not logged in|run ['"]?setup['"]? first|run ['"]?login['"]? first/i.test(text);
  const guardRequired = /Steam Guard|two[- ]factor|2FA|authenticator|This computer has not been authenticated/i.test(text);
  const steamClientDisconnected = /SteamClient instance must be connected|TryAnotherCM|temporarily unavailable/i.test(text);
  const manifestForbidden = /(?:manifest|download|depot|Steam).*?(?:403|Forbidden)|(?:403|Forbidden).*?(?:manifest|download|depot|Steam)/i.test(text);
  const refreshTokenInvalid = /refresh token|access token|invalid token|expired token/i.test(text);
  const setupCommand = "./scripts/sdv-server.sh login";
  const composeLoginCommand = "docker compose --env-file .env run --rm -it steam-auth login";
  const issues = [];

  if (notLoggedIn) {
    issues.push(`Steam Auth 尚未登录。先在服务器项目目录执行 ${setupCommand}；等价底层命令：${composeLoginCommand}`);
  }
  if (guardRequired) {
    issues.push("Steam Guard 需要二次验证；验证码必须输入到运行登录命令的服务器终端。");
  }
  if (steamClientDisconnected) {
    issues.push("SteamClient 连接链路未就绪或被 Steam 临时拒绝，可稍后重试登录；下载阶段可使用 SteamCMD 备用流程。");
  }
  if (manifestForbidden) {
    issues.push("Steam manifest/CDN 下载返回 403；建议执行 ./scripts/sdv-server.sh steamcmd-download 使用 SteamCMD 备用下载。");
  }
  if (refreshTokenInvalid) {
    issues.push("Steam 登录 token 可能失效，需要重新执行 Steam Auth 登录。");
  }

  const recentErrors = uniqueDiagnosticLines(lines.filter((line) => (
    /error|exception|failed|forbidden|not logged in|No saved session|SteamClient instance must be connected/i.test(line) &&
    (steamAuthLines.length || /Steam|steam-auth|SteamService|session|manifest|depot|download|Guard|token|setup/i.test(line))
  )), 20);
  const recentWarnings = uniqueDiagnosticLines(lines.filter((line) => (
    /warn|Steam Guard|setup first|TryAnotherCM|authenticated/i.test(line) &&
    (steamAuthLines.length || /Steam|steam-auth|SteamService|session|manifest|depot|download|Guard|token|setup/i.test(line))
  )), 20);

  let status = "ok";
  let message = "Steam Auth 日志未发现明显授权或下载异常。";
  if (notLoggedIn || guardRequired || refreshTokenInvalid) {
    status = "needs-login";
    message = issues[0];
  } else if (steamClientDisconnected || manifestForbidden) {
    status = "needs-attention";
    message = issues[0];
  } else if (!lines.length) {
    status = "unknown";
    message = "未读取到 Steam Auth 日志。";
  }

  return {
    status,
    message,
    issues,
    setupCommand,
    composeLoginCommand,
    guardRequired,
    notLoggedIn,
    steamClientDisconnected,
    manifestForbidden,
    refreshTokenInvalid,
    fallbackRecommended: steamClientDisconnected || manifestForbidden,
    recentErrors,
    recentWarnings,
  };
}

function buildSteamAuthDiagnostic(logText, stackState) {
  const containers = Array.isArray(stackState?.containers) ? stackState.containers : [];
  const container = containers.find((item) => item.name === "sdv-steam-auth") || null;
  const logReport = buildSteamAuthLogReport(logText);
  const issues = [...logReport.issues];
  if (!container) {
    issues.unshift("没有找到 sdv-steam-auth 容器。");
  } else if (container.status && container.status !== "running") {
    issues.unshift(`sdv-steam-auth 容器状态异常：${container.status}/${container.health || "none"}。`);
  } else if (container.health && !["healthy", "none"].includes(container.health)) {
    issues.unshift(`sdv-steam-auth 健康检查异常：${container.health}。`);
  }

  const status = issues.length
    ? (logReport.status === "ok" ? "needs-attention" : logReport.status)
    : logReport.status;
  return {
    status,
    ok: status === "ok",
    message: issues[0] || logReport.message,
    issues,
    container,
    logReport,
  };
}

function buildGameCrashReport(logText) {
  const rawLines = stripAnsi(logText || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-1600);
  const text = rawLines.join("\n");
  const keyIds = Array.from(text.matchAll(/The given key '(-?\d+)' was not present in the dictionary/gi))
    .map((match) => match[1]);
  const uniqueKeyIds = [...new Set(keyIds)];
  const crashGuardLoaded = /\bSVSK Crash Guard\b.*\bInstalled disconnect guard\b/i.test(text);
  const crashGuardSuppressedLines = uniqueDiagnosticLines(rawLines.filter((line) => (
    /\bSVSK Crash Guard\b.*\bSuppressed missing player disconnect\b/i.test(line)
  )), 20);
  const crashGuardSuppressedCount = crashGuardSuppressedLines.length;
  const newDayDisconnectCrash =
    /Error on new day/i.test(text) &&
    /KeyNotFoundException/i.test(text) &&
    /LidgrenServer\.playerDisconnected/i.test(text);
  const newDaySyncCrash =
    newDayDisconnectCrash ||
    (
      /_newDayTask failed/i.test(text) &&
      /NetSynchronizer\.barrier/i.test(text) &&
      /KeyNotFoundException/i.test(text)
    );
  const firstCrashLine = rawLines.find((line) => /Error on new day|_newDayTask failed/i.test(line)) || "";
  const timestamp = firstCrashLine.match(/\[(\d{2}:\d{2}:\d{2})\s+ERROR game\]/i)?.[1] || "";
  const issues = [];
  const recommendations = [];

  if (newDayDisconnectCrash) {
    const idText = uniqueKeyIds.length ? `，异常玩家 ID：${uniqueKeyIds.join(", ")}` : "";
    issues.push(`游戏本体在新一天同步时处理断线玩家失败${idText}。这通常是联机断线状态、农场手/小屋引用或过夜阶段 Mod 逻辑让多人状态字典不一致。`);
    if (!crashGuardLoaded) {
      recommendations.push("先构建并加载 SVSK Crash Guard；它会拦截已知的过夜断线 KeyNotFoundException，避免整个游戏进程退出。");
    }
    recommendations.push("先确认没有玩家在线，然后完全重启游戏容器，清掉内存里的残留联机状态。");
    recommendations.push("如果重启后过夜仍复现，先备份存档，再在“存档配置/小屋修复”里修复当前存档的小屋和农场手引用。");
    recommendations.push("如果问题是在新增或更新 Mod 后开始出现，停服后临时移走最近变更的 Mod，按一次一个 Mod 的方式恢复验证。");
  } else if (newDaySyncCrash) {
    issues.push("游戏本体在新一天同步阶段崩溃。日志没有完整指向断线玩家处理，但已经进入过夜同步失败状态。");
    recommendations.push("先确认无人在线并重启游戏容器；若复现，备份后检查当前存档的小屋/农场手引用和最近安装的 Mod。");
  }

  const recentErrors = uniqueDiagnosticLines(rawLines.filter((line) => (
    /Error on new day|_newDayTask failed|KeyNotFoundException|LidgrenServer\.playerDisconnected|NetSynchronizer\.barrier|Game1\._newDayAfterFade/i.test(line)
  )), 30);
  const crashGuardRecentEvents = uniqueDiagnosticLines(rawLines.filter((line) => (
    /\bSVSK Crash Guard\b/i.test(line)
  )), 30);

  return {
    status: issues.length ? "needs-attention" : "ok",
    ok: issues.length === 0,
    message: issues[0] || (crashGuardSuppressedCount
      ? `SVSK Crash Guard 已拦截 ${crashGuardSuppressedCount} 次断线异常，未发现游戏本体新一天崩溃。`
      : "未发现游戏本体新一天崩溃。"),
    issues,
    recommendations,
    newDayDisconnectCrash,
    newDaySyncCrash,
    crashGuardLoaded,
    crashGuardSuppressedCount,
    crashGuardRecentEvents,
    keyIds: uniqueKeyIds,
    repeatCount: keyIds.length,
    timestamp,
    recentErrors,
  };
}

function diagnosticSummary(apiDiagnostic, modManagement, stackState, steamAuthDiagnostic, gameCrashDiagnostic) {
  const issues = [];
  if (gameCrashDiagnostic && gameCrashDiagnostic.status !== "ok") {
    issues.push(gameCrashDiagnostic.message || "游戏本体运行日志包含崩溃。");
  }
  if (apiDiagnostic && !apiDiagnostic.available) {
    issues.push(apiDiagnostic.message || "服务端 HTTP API 不可用。");
  }
  if (apiDiagnostic?.container?.userModsShadowApiMod) {
    issues.push("检测到旧挂载：data/mods 仍遮住 /data/Mods，需要拉取最新代码并重建游戏容器。");
  }
  const loadReport = modManagement?.loadReport || {};
  if (loadReport.errors?.length) {
    issues.push(`最近 SMAPI 日志包含 ${loadReport.errors.length} 条错误。`);
  }
  if (loadReport.skipped?.length || loadReport.problemMods?.length) {
    issues.push(`最近 SMAPI 日志显示有 Mod 被跳过或加载异常。`);
  }
  if (loadReport.warningMods?.length || loadReport.runtimeWarnings?.length) {
    issues.push(`最近 SMAPI 日志包含 ${loadReport.warningMods?.length || loadReport.runtimeWarnings.length} 条 Mod 运行警告。`);
  }
  if (loadReport.directoryIssues?.length || modManagement?.directoryIssues?.length) {
    issues.push("data/mods 下存在空目录或异常目录；SMAPI 会跳过这些目录。");
  }
  const containerVisibility = modManagement?.containerVisibility;
  if (containerVisibility?.available && containerVisibility.status !== "ok") {
    issues.push(containerVisibility.message || "容器内用户 Mod 挂载目录需要检查。");
  }
  if (loadReport.logWindowMissedStartup) {
    issues.push("最近日志没有覆盖 SMAPI 启动加载摘要；这不能证明 Mod 加载失败，请重启游戏容器后重新检测。");
  }
  if (steamAuthDiagnostic && steamAuthDiagnostic.status !== "ok") {
    issues.push(steamAuthDiagnostic.message || "Steam Auth 需要处理。");
  }
  if (stackState?.ok === false) {
    issues.push(stackState.error || "Docker 容器状态读取失败。");
  }

  return {
    status: issues.length ? "needs-attention" : "ok",
    message: issues.length ? issues[0] : "未发现明显的 API、挂载或 SMAPI 加载异常。",
    issues,
  };
}

async function getDiagnosticReport() {
  const env = await readEnv();
  const logText = await latestServerLogText();
  const [status, apiDiagnostic, modManagement, stackState, composePs] = await Promise.all([
    getStatus().catch((error) => ({ error: error.message || String(error) })),
    getServerApiDiagnostic().catch((error) => ({ available: false, message: error.message || String(error) })),
    modService.getModManagement({ logText }).catch((error) => ({ error: error.message || String(error), installed: [], loadReport: null })),
    inspectStackState().catch((error) => ({ ok: false, error: error.message || String(error), containers: [] })),
    inspectComposePs().catch((error) => ({ ok: false, error: error.message || String(error), containers: [] })),
  ]);
  const logTail = tailLogText(logText, 220, 9000);
  const steamAuth = buildSteamAuthDiagnostic(logText, stackState);
  const gameCrash = buildGameCrashReport(logText);

  return {
    generatedAt: new Date().toISOString(),
    summary: diagnosticSummary(apiDiagnostic, modManagement, stackState, steamAuth, gameCrash),
    env: publicEnvSnapshot(env),
    stack: {
      inspect: stackState,
      composePs,
      running: Boolean(status.stackRunning),
      health: status.health || [],
      publishedPorts: status.publishedPorts || [],
    },
    serverApi: apiDiagnostic,
    steamAuth,
    mods: {
      modsDir: modManagement.modsDir || "data/mods",
      containerModsDir: modManagement.containerModsDir || "/data/Mods/user",
      installedCount: modManagement.installed?.length || 0,
      directoryIssues: modManagement.directoryIssues || [],
      containerVisibility: modManagement.containerVisibility || null,
      installed: (modManagement.installed || []).map((mod) => ({
        directoryName: mod.directoryName,
        name: mod.name,
        uniqueId: mod.uniqueId,
        version: mod.version,
        protected: Boolean(mod.protected),
        protectedReason: mod.protectedReason || "",
        hasConfig: mod.hasConfig,
        hasManifest: mod.hasManifest,
        manifestError: mod.manifestError || "",
      })),
      loadReport: modManagement.loadReport,
    },
    runtime: {
      farmName: status.runtime?.farmName || "",
      playerCount: status.runtime?.playerCount ?? null,
      maxPlayers: status.runtime?.maxPlayers ?? null,
      inviteCode: status.join?.inviteCode || "n/a",
    },
    gameCrash,
    logs: {
      tail: logTail,
    },
  };
}

async function isServerContainerRunning() {
  const result = await docker(["inspect", "-f", "{{.State.Running}}", "sdv-server"], { timeoutMs: 8000 });
  return result.ok && result.stdout.trim() === "true";
}

async function inspectStackState() {
  const result = await docker(
    [
      "inspect",
      "-f",
      "{{.Name}}\t{{.State.Status}}\t{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}\t{{.State.StartedAt}}",
      "sdv-server",
      "sdv-steam-auth",
    ],
    { timeoutMs: 8000 },
  );
  if (!result.ok) {
    return {
      ok: false,
      error: await sanitize(result.stderr || result.stdout || "docker inspect failed"),
      containers: [],
    };
  }
  return {
    ok: true,
    containers: parseTableLines(result.stdout).map((line) => {
      const [name, status, health, startedAt] = line.split("\t");
      return {
        name: name ? name.replace(/^\//, "") : "",
        status,
        health,
        startedAt,
      };
    }),
  };
}

function containerReady(container) {
  if (!container || container.status !== "running") return false;
  const health = container.health || "none";
  return health === "healthy" || health === "none";
}

function stackRestartVerified(state) {
  if (!state?.ok) return false;
  const byName = new Map((state.containers || []).map((container) => [container.name, container]));
  return STACK_REQUIRED_CONTAINERS.every((name) => containerReady(byName.get(name)));
}

function stackStateSummary(state) {
  if (!state?.ok) return `容器状态读取失败：${state?.error || "unknown error"}`;
  if (!state.containers?.length) return "没有找到 sdv-server / sdv-steam-auth 容器";
  return state.containers
    .map((container) => `${container.name || "unknown"}=${container.status || "unknown"}/${container.health || "none"}`)
    .join(", ");
}

function tailLogText(text, maxLines = STACK_FAILURE_LOG_LINES, maxChars = STACK_FAILURE_LOG_MAX_CHARS) {
  const lines = stripAnsi(String(text || ""))
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-maxLines);
  const tail = lines.join("\n");
  return tail.length > maxChars ? tail.slice(-maxChars) : tail;
}

async function stackStartupFailureMessage(action, state) {
  const parts = [
    `服务端${action}后没有进入健康状态。`,
    `当前容器状态：${stackStateSummary(state)}。`,
    "这通常表示 SMAPI/游戏进程启动失败，常见原因是刚安装的 Mod 不兼容、缺少前置依赖或 Mod 配置错误。",
  ];
  const logs = await latestLogs().catch((error) => ({ logs: error.message || String(error) }));
  const logTail = tailLogText(logs.logs);
  if (logTail) {
    parts.push(`最近日志：\n${logTail}`);
  }
  return parts.join("\n");
}

async function waitForStackReady(action, options = {}) {
  const timeoutMs = options.timeoutMs || STACK_READY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let state = await inspectStackState();

  while (Date.now() < deadline) {
    if (stackRestartVerified(state)) return state;
    await delay(STACK_READY_POLL_MS);
    state = await inspectStackState();
  }

  throw new Error(await stackStartupFailureMessage(action, state));
}

async function waitForSmapiCommandPipe(timeoutMs = SMAPI_COMMAND_PIPE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastOutput = "";

  while (Date.now() < deadline) {
    const result = await docker(["exec", "sdv-server", "sh", "-lc", "test -p /tmp/smapi-input"], {
      timeoutMs: 6000,
    });
    if (result.ok) return;

    lastOutput = await sanitize(result.stderr || result.stdout || "");
    await delay(SMAPI_COMMAND_PIPE_POLL_MS);
  }

  throw new Error(
    `SMAPI command pipe is not ready. Wait for the server to finish booting and try again.${lastOutput ? ` Last output: ${lastOutput}` : ""}`,
  );
}

async function ensureServerReadyForSmapiCommand() {
  const wasRunning = await isServerContainerRunning();
  if (!wasRunning) {
    const up = await composeUpDetached({ timeoutMs: 120000 });
    if (!up.ok) {
      throw new Error(await sanitize(up.stderr || up.stdout || "docker compose up failed"));
    }
  }

  await waitForSmapiCommandPipe();
  return { wasRunning, started: !wasRunning };
}

async function sendSmapiCommand(command) {
  if (String(command).includes("\n") || String(command).includes("\r")) {
    throw new Error("SMAPI command is invalid.");
  }
  const result = await docker(
    [
      "exec",
      "-e",
      `SDV_SMAPI_COMMAND=${command}`,
      "sdv-server",
      "sh",
      "-lc",
      "set -eu; test -p /tmp/smapi-input || { echo 'SMAPI input pipe not found'; exit 1; }; printf '%s\\n' \"$SDV_SMAPI_COMMAND\" > /tmp/smapi-input; sleep 1; tail -n 80 /tmp/server-output.log 2>/dev/null | tail -n 30 || true",
    ],
    { timeoutMs: 12000 },
  );
  if (!result.ok) {
    throw new Error(await sanitize(result.stderr || result.stdout || "Failed to send SMAPI command."));
  }
  return { logs: await sanitize(result.stdout || result.stderr || "") };
}

async function selectSave(payload) {
  const saveName = validateSaveName(payload.saveName);
  const { saves } = await listSaves();
  if (!saves.some((save) => save.name === saveName)) {
    throw new Error(`Save not found: ${saveName}`);
  }

  await sendSmapiCommand(`saves select ${saveName} --confirm`);
  return { saveName, restartRequired: true };
}

async function createNewGame(payload) {
  const farmName = cleanText(payload.farmName, 48, "Junimo");
  const steps = [];
  const requestedTargetCabins = intInRange(payload.startingCabins, "Starting cabins", 0, 9);

  const wasRunning = await isServerContainerRunning();
  const { saves: savesBefore } = await listSaves();
  const hasExistingSaves = savesBefore.length > 0;
  let readiness = null;
  if (wasRunning) {
    readiness = await collectShutdownReadiness();
    if (!isSafeForImmediateRestart(readiness) && payload.force !== true) {
      throw apiError(409, readiness.message);
    }
  }

  const savedConfig = await saveNewGameConfig(payload, {
    forceCabinStrategy: requestedTargetCabins > 1 ? "None" : undefined,
  });
  const targetCabins = savedConfig.settings.Game.StartingCabins;
  if (requestedTargetCabins > 1 && savedConfig.settings.Server.CabinStrategy === "None") {
    addOperationStep(
      steps,
      "已启用官方小屋生成",
      `当前 CabinStrategy=None，StartingCabins=${targetCabins} 会优先走上游原生创建；只有不足时才回退 XML 补丁。`,
    );
  }
  addOperationStep(steps, "已保存新地图配置", `农场 ${farmName}，初始小屋 ${targetCabins}`);
  let preNewGameBackup = null;
  if (hasExistingSaves) {
    preNewGameBackup = await createSavesBackup(`Automatic backup before creating new farm ${farmName}.`);
    addOperationStep(steps, "已创建执行前备份", preNewGameBackup.archive);
  }

  if (!wasRunning && !hasExistingSaves) {
    const newGameStartedAtMs = Date.now();
    const up = await composeUpDetached({ timeoutMs: 120000 });
    if (!up.ok) {
      throw new Error(await sanitize(up.stderr || up.stdout || "docker compose up failed"));
    }
    addOperationStep(steps, "已启动服务端", "正在等待服务端生成新存档。");
    const restart = await restartStackAfterNewGame(farmName, targetCabins, newGameStartedAtMs, steps);
    return {
      farmName,
      settings: savedConfig.settings,
      preNewGameBackup: null,
      commandStartedServer: true,
      readiness,
      restarted: restart.restarted,
      restartVerified: restart.restartVerified,
      newSaveName: restart.newSaveName,
      selectedSaveName: restart.selectedSaveName,
      stackState: restart.stackState,
      cabinPatch: restart.cabinPatch,
      steps,
      message: restart.message,
    };
  }

  if (wasRunning) {
    const down = await compose(["down"], { timeoutMs: 120000 });
    if (!down.ok) {
      throw new Error(await sanitize(down.stderr || down.stdout || "docker compose down failed"));
    }
    addOperationStep(steps, "已停止原服务端", "准备启动 SMAPI 并发送 newgame 命令。");
  }

  const commandState = await ensureServerReadyForSmapiCommand();
  if (commandState.started) {
    addOperationStep(steps, "已启动服务端", "用于接收 SMAPI newgame 命令。");
  }
  await sendSmapiCommand("settings newgame --confirm");
  addOperationStep(steps, "已发送官方 newgame 命令", "等待新存档落盘。");
  const downForCreate = await compose(["down"], { timeoutMs: 120000 });
  if (!downForCreate.ok) {
    throw new Error(await sanitize(downForCreate.stderr || downForCreate.stdout || "docker compose down failed"));
  }
  addOperationStep(steps, "已停止服务端", "准备重启并执行官方新建流程。");
  const newGameStartedAtMs = Date.now();
  const upForCreate = await composeUpDetached({ timeoutMs: 120000 });
  if (!upForCreate.ok) {
    throw new Error(await sanitize(upForCreate.stderr || upForCreate.stdout || "docker compose up failed"));
  }
  addOperationStep(steps, "已重启服务端", "正在等待官方流程生成新存档。");
  const restart = await restartStackAfterNewGame(farmName, targetCabins, newGameStartedAtMs, steps);

  return {
    farmName,
    settings: savedConfig.settings,
    preNewGameBackup: preNewGameBackup?.archive || null,
    commandStartedServer: commandState.started,
    readiness,
    restarted: restart.restarted,
    restartVerified: restart.restartVerified,
    newSaveName: restart.newSaveName,
    selectedSaveName: restart.selectedSaveName,
    stackState: restart.stackState,
    cabinPatch: restart.cabinPatch,
    steps,
    message: restart.message,
  };
}

async function repairSaveCabins(payload) {
  const saveName = validateSaveName(payload.saveName);

  const { saves } = await listSaves();
  if (!saves.some((save) => save.name === saveName)) {
    throw new Error(`Save not found: ${saveName}`);
  }

  const settings = await readSettings();
  const targetCabins = intInRange(
    payload.targetCabins ?? settings.Game.StartingCabins,
    "Target cabins",
    1,
    9,
  );
  const wasRunning = await isServerContainerRunning();
  let readiness = null;
  if (wasRunning) {
    readiness = await collectShutdownReadiness();
    if (!isSafeForImmediateRestart(readiness) && payload.force !== true) {
      throw apiError(409, readiness.message);
    }

    const down = await compose(["down"], { timeoutMs: 120000 });
    if (!down.ok) {
      throw new Error(await sanitize(down.stderr || down.stdout || "docker compose down failed"));
    }
  }

  try {
    const preRepairBackup = await createSavesBackup(`Automatic backup before repairing cabins in save ${saveName}.`);
    const cabinPatch = await patchSaveCabins(saveName, targetCabins);

    if (wasRunning) {
      const up = await composeUpDetached({ timeoutMs: 120000 });
      if (!up.ok) {
        throw new Error(await sanitize(up.stderr || up.stdout || "docker compose up failed"));
      }
    }

    return {
      saveName,
      targetCabins,
      preRepairBackup: preRepairBackup.archive,
      readiness,
      restarted: wasRunning,
      cabinPatch,
    };
  } catch (error) {
    if (wasRunning) {
      await composeUpDetached({ timeoutMs: 120000 }).catch(() => {});
    }
    throw error;
  }
}

async function deleteSave(payload) {
  const saveName = validateSaveName(payload.saveName);

  const { saves } = await listSaves();
  if (!saves.some((save) => save.name === saveName)) {
    throw new Error(`Save not found: ${saveName}`);
  }
  const remainingSaveCount = saves.filter((save) => save.name !== saveName).length;

  const wasRunning = await isServerContainerRunning();
  let readiness = null;
  if (wasRunning) {
    readiness = await collectShutdownReadiness();
    if (!isSafeForImmediateRestart(readiness) && payload.force !== true) {
      throw apiError(409, readiness.message);
    }

    const down = await compose(["down"], { timeoutMs: 120000 });
    if (!down.ok) {
      throw new Error(await sanitize(down.stderr || down.stdout || "docker compose down failed"));
    }
  }

  try {
    const preDeleteBackup = await createSavesBackup(`Automatic backup before deleting save ${saveName}.`);
    const script = `set -eu
case "$SDV_SAVE_NAME" in ""|"."|".."|*/*|*\\\\*) echo "Unsafe save name."; exit 64;; esac
target="/saves/Saves/$SDV_SAVE_NAME"
if [ ! -d "$target" ]; then
  echo "Save not found: $SDV_SAVE_NAME"
  exit 2
fi
rm -rf -- "$target"`;

    const result = await docker(
      [
        "run",
        "--rm",
        "-e",
        `SDV_SAVE_NAME=${saveName}`,
        "-v",
        `${SAVES_VOLUME}:/saves`,
        "alpine:3.20",
        "sh",
        "-c",
        script,
      ],
      { timeoutMs: 120000 },
    );
    if (!result.ok) {
      throw new Error(await sanitize(result.stderr || result.stdout || "Save delete failed."));
    }

    const shouldRestart = wasRunning && remainingSaveCount > 0;
    if (shouldRestart) {
      const up = await composeUpDetached({ timeoutMs: 120000 });
      if (!up.ok) {
        throw new Error(await sanitize(up.stderr || up.stdout || "docker compose up failed"));
      }
    }

    return {
      deleted: saveName,
      preDeleteBackup: preDeleteBackup.archive,
      restarted: shouldRestart,
      stoppedBecauseNoSaves: wasRunning && remainingSaveCount === 0,
      remainingSaveCount,
      readiness,
    };
  } catch (error) {
    if (wasRunning) {
      await composeUpDetached({ timeoutMs: 120000 }).catch(() => {});
    }
    throw error;
  }
}

async function createSavesBackup(note = "Created from admin panel.", options = {}) {
  if (!(await savesVolumeExists())) {
    throw new Error(`Save volume not found: ${SAVES_VOLUME}. Start the server once before backing up.`);
  }

  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const timestamp = formatTimestampForFile();
  const archiveName = `saves-${timestamp}.tar.gz`;
  const metadataName = `saves-${timestamp}.meta.txt`;
  const metadataPath = path.join(BACKUP_DIR, metadataName);

  const result = await docker(
    ["run", "--rm", "-v", `${SAVES_VOLUME}:/saves:ro`, "-v", `${BACKUP_DIR}:/backup`, "alpine:3.20", "sh", "-c", `tar -czf /backup/${archiveName} -C /saves .`],
    { timeoutMs: 120000 },
  );
  if (!result.ok) {
    throw new Error(await sanitize(result.stderr || result.stdout || "Save backup failed."));
  }

  const metadata = [
    `created_at=${new Date().toISOString()}`,
    `volume=${SAVES_VOLUME}`,
    `archive=${archiveName}`,
    "note=This file intentionally contains no Steam credentials, API keys, or VNC passwords.",
    `admin_note=${String(note).replace(/[\r\n]/g, " ")}`,
    "restore_hint=Use the admin panel restore action while no overnight save is in progress.",
  ].join(os.EOL);

  await fsp.writeFile(metadataPath, `${metadata}${os.EOL}`, "utf8");
  const policy = await readBackupPolicy();
  const pruned = options.skipPrune
    ? []
    : await pruneBackups(options.retention || policy.retention, {
        preserveArchives: [archiveName, ...(options.preserveArchives || [])],
      });
  return {
    archive: archiveName,
    metadata: metadataName,
    pruned,
  };
}

function restoreBackupScript(archive) {
  return `set -eu
tar -tzf /backup/${archive} > /tmp/archive-files
if grep -Eq '(^/|(^|/)\\.\\.(/|$))' /tmp/archive-files; then
  echo 'Backup archive contains unsafe paths.'
  exit 1
fi
tar -tzvf /backup/${archive} > /tmp/archive-entries
if awk '{ type = substr($1, 1, 1); if (type != "-" && type != "d") bad = 1 } END { exit bad }' /tmp/archive-entries; then
  :
else
  echo 'Backup archive contains unsupported special file entries.'
  exit 1
fi
rm -rf /restore-check
mkdir -p /restore-check
tar -xzf /backup/${archive} -C /restore-check
cd /restore-check
if find . \\( -type l -o -type p -o -type b -o -type c -o -type s \\) -print -quit | grep -q .; then
  echo 'Backup archive contains unsupported special file entries.'
  exit 1
fi
find /saves -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a /restore-check/. /saves/
chown -R 1000:1000 /saves 2>/dev/null || true`;
}

async function restoreBackup(payload) {
  const archive = validateBackupArchive(payload.archive);

  const archivePath = path.join(BACKUP_DIR, archive);
  await fsp.access(archivePath, fs.constants.R_OK);

  const preRestoreBackup = await createSavesBackup(`Automatic backup before restoring ${archive}.`, {
    preserveArchives: [archive],
  });
  const down = await compose(["down"], { timeoutMs: 120000 });
  if (!down.ok) {
    throw new Error(await sanitize(down.stderr || down.stdout || "docker compose down failed"));
  }

  const script = restoreBackupScript(archive);

  try {
    const restore = await docker(
      ["run", "--rm", "-v", `${SAVES_VOLUME}:/saves`, "-v", `${BACKUP_DIR}:/backup:ro`, "alpine:3.20", "sh", "-c", script],
      { timeoutMs: 120000 },
    );
    if (!restore.ok) {
      throw new Error(await sanitize(restore.stderr || restore.stdout || "Backup restore failed."));
    }

    const up = await composeUpDetached({ timeoutMs: 120000 });
    if (!up.ok) {
      throw new Error(await sanitize(up.stderr || up.stdout || "docker compose up failed"));
    }
  } catch (error) {
    await composeUpDetached({ timeoutMs: 120000 }).catch(() => {});
    throw error;
  }

  return {
    restored: archive,
    preRestoreBackup: preRestoreBackup.archive,
    restarted: true,
  };
}

async function deleteBackup(payload) {
  return deleteBackups({ archives: [payload.archive] });
}

async function deleteBackups(payload) {
  const rawArchives = Array.isArray(payload.archives) ? payload.archives : [payload.archive];
  const archives = [...new Set(rawArchives.map((archive) => validateBackupArchive(archive)))];
  if (!archives.length) {
    throw new Error("No backup archive was selected.");
  }

  const deleted = [];
  for (const archive of archives) {
    const archivePath = path.join(BACKUP_DIR, archive);
    const metadataPath = path.join(BACKUP_DIR, archive.replace(/\.tar\.gz$/, ".meta.txt"));
    await fsp.unlink(archivePath);
    try {
      await fsp.unlink(metadataPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    deleted.push(archive);
  }

  return { deleted };
}

async function configureAutoBackupSchedule() {
  const policy = await readBackupPolicy();
  if (autoBackupTimer) {
    clearTimeout(autoBackupTimer);
    autoBackupTimer = null;
  }

  autoBackupState = {
    ...autoBackupState,
    enabled: policy.enabled,
    intervalMinutes: policy.intervalMinutes,
    retention: policy.retention,
    nextRunAt: null,
  };

  if (!policy.enabled) return getAutoBackupState();

  const nextRunMs = Date.now() + policy.intervalMinutes * 60 * 1000;
  autoBackupState.nextRunAt = new Date(nextRunMs).toISOString();
  autoBackupTimer = setTimeout(() => {
    runAutoBackup().catch(() => {});
  }, policy.intervalMinutes * 60 * 1000);
  if (typeof autoBackupTimer.unref === "function") {
    autoBackupTimer.unref();
  }
  return getAutoBackupState();
}

async function runAutoBackup() {
  if (autoBackupState.running) return getAutoBackupState();

  autoBackupState = {
    ...autoBackupState,
    running: true,
    nextRunAt: null,
  };

  try {
    const result = await createSavesBackup("Automatic scheduled backup from admin panel.");
    autoBackupState = {
      ...autoBackupState,
      running: false,
      lastRunAt: new Date().toISOString(),
      lastResult: {
        ok: true,
        archive: result.archive,
        pruned: result.pruned || [],
      },
    };
  } catch (error) {
    autoBackupState = {
      ...autoBackupState,
      running: false,
      lastRunAt: new Date().toISOString(),
      lastResult: {
        ok: false,
        error: error.message || String(error),
      },
    };
  } finally {
    await configureAutoBackupSchedule();
  }

  return getAutoBackupState();
}

async function updateBackupPolicy(payload) {
  const enabled = bool(payload.enabled);
  const intervalMinutes = intInRange(
    payload.intervalMinutes,
    "Auto backup interval",
    MIN_AUTO_BACKUP_INTERVAL_MINUTES,
    MAX_AUTO_BACKUP_INTERVAL_MINUTES,
  );
  const retention = intInRange(payload.retention, "Backup retention", MIN_BACKUP_RETENTION, MAX_BACKUP_RETENTION);

  await setEnvValue("AUTO_BACKUP_ENABLED", enabled ? "true" : "false");
  await setEnvValue("SAVE_BACKUP_INTERVAL_MINUTES", intervalMinutes);
  await setEnvValue("SAVE_BACKUP_RETENTION", retention);
  const autoBackup = await configureAutoBackupSchedule();
  const pruned = await pruneBackups(retention);

  return {
    backupPolicy: { enabled, intervalMinutes, retention },
    autoBackup,
    pruned,
  };
}

const handleApi = createApiHandler({
  ADMIN_COOKIE,
  readJsonBody,
  readUploadBody,
  readEnv,
  isAuthorized,
  json,
  getStatus,
  runtimeSignals,
  getPlayerManagement: playerService.getPlayerManagement,
  grantAdminRole: playerService.grantAdminRole,
  unsupportedKickBan: playerService.unsupportedKickBan,
  deleteFarmhand: playerService.deleteFarmhand,
  getConfig,
  saveConfig,
  restartStack,
  repairServerApi,
  startStack,
  requestStopStack,
  cancelStopAfterSaveJob,
  getSaveManagement,
  getModManagement: async () => modService.getModManagement({ logText: await latestServerLogText() }),
  searchMods: modService.searchMods,
  getNexusModFiles: modService.getNexusModFiles,
  installModFromUrl: modService.installModFromUrl,
  installModFromUpload: modService.installModFromUpload,
  installModFromNexusFile: modService.installModFromNexusFile,
  deleteInstalledMod: modService.deleteInstalledMod,
  readModConfig: modService.readModConfig,
  saveModConfig: modService.saveModConfig,
  selectSave,
  createNewGame,
  repairSaveCabins,
  deleteSave,
  readSaveConfigFromVolume,
  writeSaveConfigToVolume,
  createSavesBackup,
  updateBackupPolicy,
  restoreBackup,
  deleteBackups,
  latestLogs,
  getDiagnosticReport,
});

async function main() {
  await ensureAdminFiles();
  await configureAutoBackupSchedule();
  const env = await readEnv();
  const host = env.ADMIN_HOST || process.env.ADMIN_HOST || "127.0.0.1";
  const port = Number.parseInt(env.ADMIN_PORT || process.env.ADMIN_PORT || "8088", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("ADMIN_PORT must be between 1 and 65535.");
  }
  assertAdminBindAllowed(host, env);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      const apiPrefixIndex = url.pathname.indexOf("/api/");
      if (apiPrefixIndex !== -1) {
        await handleApi(req, res, url.pathname.slice(apiPrefixIndex));
        return;
      }
      if (
        req.method === "GET" &&
        (
          url.pathname === "/" ||
          url.pathname === "/index.html" ||
          url.pathname.endsWith("/") ||
          url.pathname.endsWith("/index.html")
        )
      ) {
        html(res, PAGE);
        return;
      }
      json(res, 404, { error: "Not found." });
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      json(res, status, { error: error.message || String(error) });
    }
  });

  server.listen(port, host, async () => {
    const freshEnv = await readEnv();
    if (host === "0.0.0.0") {
      console.log(`Admin panel (local): http://127.0.0.1:${port}`);
      console.log(`Admin panel (public): http://<server-public-ip>:${port}`);
    } else {
      console.log(`Admin panel: http://${host}:${port}`);
    }
    if (freshEnv.ADMIN_TOKEN) {
      console.log("ADMIN_TOKEN is configured. Enter the token from .env on the login page; it is not printed to logs.");
    } else {
      console.log("ADMIN_TOKEN is missing. Login is disabled until .env contains ADMIN_TOKEN.");
    }
    if (process.env.INVOCATION_ID || process.env.JOURNAL_STREAM) {
      console.log("Admin panel is running under systemd.");
    } else {
      console.log("Keep this terminal open while using the admin panel.");
    }
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    parseEnv,
    patchEnvText,
    parseMultipartUpload,
    readJsonBody,
    readRequestBuffer,
    uploadPayloadFromJson,
    isAuthorized,
    runtimeEnvValues,
    saveConfig,
    applySaveMaintenanceSettings,
    getConfig,
    readEnv,
    readSettings,
    normalizeAdminHost,
    isLoopbackAdminHost,
    adminHostRequiresPublicHttpOptIn,
    isPublicHttpAdminAllowed,
    assertAdminBindAllowed,
    restoreBackupScript,
    containerReady,
    stackRestartVerified,
    stackStateSummary,
    tailLogText,
    buildSteamAuthLogReport,
    buildSteamAuthDiagnostic,
    buildGameCrashReport,
    quoteUnsafeJsonIntegers,
    parseJsonPreservingUnsafeIntegers,
    diagnosticSummary,
    DOCKER_INSPECT_API_FORMAT,
  },
};
