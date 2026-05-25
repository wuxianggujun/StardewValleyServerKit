#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const ROOT_DIR = path.resolve(process.env.SDV_ADMIN_ROOT || path.join(__dirname, ".."));
const ENV_FILE = path.join(ROOT_DIR, ".env");
const ENV_EXAMPLE_FILE = path.join(ROOT_DIR, ".env.example");
const SETTINGS_FILE = path.join(ROOT_DIR, "data", "settings", "server-settings.json");
const BACKUP_DIR = path.join(ROOT_DIR, "backups");
const ADMIN_COOKIE = "sdv_admin_token";
const SAVES_VOLUME = "stardew-valley-server-kit_saves";
const SAVE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const BACKUP_ARCHIVE_PATTERN = /^saves-\d{8}-\d{6}\.tar\.gz$/;
const SAVE_COMPLETE_PATTERN = /SaveGame\.Save\(\) completed without exceptions|SaveGame\.Save.*completed/i;
const STOP_AFTER_SAVE_CHECK_MS = 30000;
const STOP_AFTER_SAVE_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const SMAPI_COMMAND_PIPE_TIMEOUT_MS = 90000;
const SMAPI_COMMAND_PIPE_POLL_MS = 2000;
const NEW_GAME_SAVE_WAIT_TIMEOUT_MS = 120000;
const NEW_GAME_SAVE_WAIT_POLL_MS = 3000;
const DEFAULT_AUTO_BACKUP_ENABLED = false;
const DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES = 360;
const DEFAULT_BACKUP_RETENTION = 10;
const MIN_AUTO_BACKUP_INTERVAL_MINUTES = 15;
const MAX_AUTO_BACKUP_INTERVAL_MINUTES = 10080;
const MIN_BACKUP_RETENTION = 1;
const MAX_BACKUP_RETENTION = 100;
const CABIN_BUILDING_TYPES = new Set(["Cabin", "Log Cabin", "Plank Cabin", "Stone Cabin"]);

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
  let text = "";
  if (fs.existsSync(ENV_FILE)) {
    text = await fsp.readFile(ENV_FILE, "utf8");
  }
  const escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const nextLine = `${key}="${escaped}"`;
  const lines = text ? text.split(/\r?\n/) : [];
  const pattern = new RegExp(`^\\s*#?\\s*${escapeRegExp(key)}\\s*=`);
  let replaced = false;
  const next = lines.map((line) => {
    if (!replaced && pattern.test(line)) {
      replaced = true;
      return nextLine;
    }
    return line;
  });
  if (!replaced) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(nextLine);
  }
  await fsp.writeFile(ENV_FILE, next.join(os.EOL), "utf8");
}

async function ensureAdminFiles() {
  await fsp.mkdir(path.join(ROOT_DIR, "data", "settings"), { recursive: true });
  await fsp.mkdir(path.join(ROOT_DIR, "data", "mods"), { recursive: true });

  if (!fs.existsSync(ENV_FILE) && fs.existsSync(ENV_EXAMPLE_FILE)) {
    await fsp.copyFile(ENV_EXAMPLE_FILE, ENV_FILE);
  }

  const env = await readEnv();
  if (!env.VNC_PASSWORD) await setEnvValue("VNC_PASSWORD", newSecret(18));
  if (!env.API_KEY) await setEnvValue("API_KEY", newSecret(32));
  if (!env.ADMIN_TOKEN) await setEnvValue("ADMIN_TOKEN", newSecret(32));

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

async function writeSettings(settings) {
  await fsp.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  const tempFile = `${SETTINGS_FILE}.tmp`;
  await fsp.writeFile(tempFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await fsp.rename(tempFile, SETTINGS_FILE);
}

function commandExists(command) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const pathEnv = process.env.PATH || "";
  return pathEnv.split(path.delimiter).some((dir) => fs.existsSync(path.join(dir, command + suffix)));
}

function run(command, args, options = {}) {
  const timeoutMs = options.timeoutMs || 15000;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      env: process.env,
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
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

function stripAnsi(value) {
  return value.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "");
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
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

async function isAuthorized(req) {
  const env = await readEnv();
  const expected = env.ADMIN_TOKEN || "";
  if (!expected) return false;
  const url = new URL(req.url, "http://127.0.0.1");
  const token =
    req.headers["x-admin-token"] ||
    url.searchParams.get("token") ||
    parseCookies(req)[ADMIN_COOKIE] ||
    "";
  const actual = Array.isArray(token) ? token[0] : token;
  if (!actual || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function intInRange(value, name, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function numberInSet(value, name, allowed) {
  const parsed = Number(value);
  if (!allowed.includes(parsed)) {
    throw new Error(`${name} is invalid.`);
  }
  return parsed;
}

function bool(value) {
  return value === true || value === "true" || value === "on" || value === 1;
}

function boolWithDefault(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return bool(value);
}

function stringChoice(value, name, allowed) {
  if (!allowed.includes(value)) throw new Error(`${name} is invalid.`);
  return value;
}

function cleanText(value, maxLength, fallback = "") {
  const next = String(value || "").trim();
  if (!next) return fallback;
  return next.slice(0, maxLength);
}

const NEW_GAME_ONLY_SETTING_PATHS = [
  ["Game", "FarmName"],
  ["Game", "FarmType"],
  ["Game", "ProfitMargin"],
  ["Game", "StartingCabins"],
  ["Game", "SpawnMonstersAtNight"],
];

function settingValue(settings, pathParts) {
  return pathParts.reduce((value, key) => (value == null ? undefined : value[key]), settings);
}

function hasSettingChanges(before, after, paths) {
  return paths.some((pathParts) => settingValue(before, pathParts) !== settingValue(after, pathParts));
}

function parseSteamIds(value) {
  const text = Array.isArray(value) ? value.join("\n") : String(value || "");
  const ids = text
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  for (const id of ids) {
    if (!/^\d{15,20}$/.test(id)) {
      throw new Error(`Invalid Steam ID: ${id}`);
    }
  }
  return [...new Set(ids)];
}

function listLanAddresses() {
  const ignored = /(vmware|virtualbox|vbox|wsl|hyper-v|docker|loopback|npcap)/i;
  const result = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const item of addresses || []) {
      if (item.family !== "IPv4" || item.internal) continue;
      result.push({
        address: item.address,
        interface: name,
        recommended: !ignored.test(name),
      });
    }
  }
  return result;
}

function parseTableLines(text) {
  return stripAnsi(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function apiError(statusCode, message) {
  const error = new Error(message);
  error.status = statusCode;
  return error;
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
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          const statusCode = res.statusCode || 0;
          let parsed = null;
          if (body) {
            try {
              parsed = JSON.parse(body);
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

function validateSaveName(value) {
  const saveName = String(value || "").trim();
  if (!SAVE_NAME_PATTERN.test(saveName) || saveName === "." || saveName === "..") {
    throw new Error("Save name is invalid.");
  }
  return saveName;
}

function decodeXmlText(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlTagValue(xml, tagName) {
  const match = String(xml || "").match(new RegExp(`<${escapeRegExp(tagName)}>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`));
  return match ? decodeXmlText(match[1]) : null;
}

function xmlTagNumber(xml, tagName) {
  const value = xmlTagValue(xml, tagName);
  if (value == null || !/^-?\d+$/.test(String(value).trim())) return null;
  return Number.parseInt(value, 10);
}

function replaceXmlTagValue(xml, tagName, value) {
  const pattern = new RegExp(`(<${escapeRegExp(tagName)}>)[\\s\\S]*?(<\\/${escapeRegExp(tagName)}>)`);
  return String(xml || "").replace(pattern, (_match, open, close) => `${open}${escapeXmlText(value)}${close}`);
}

function findBuildingBlocks(xml) {
  const blocks = [];
  const pattern = /<Building\b[^>]*>[\s\S]*?<\/Building>/g;
  let match = null;
  while ((match = pattern.exec(xml)) !== null) {
    blocks.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return blocks;
}

function isCabinBuildingBlock(block) {
  const buildingType = xmlTagValue(block, "buildingType");
  return CABIN_BUILDING_TYPES.has(buildingType) || /<indoors\b[^>]*xsi:type="Cabin"/.test(block);
}

function readBuildingRect(block) {
  const x = xmlTagNumber(block, "tileX");
  const y = xmlTagNumber(block, "tileY");
  if (x == null || y == null) return null;
  return {
    x,
    y,
    width: xmlTagNumber(block, "tilesWide") || 5,
    height: xmlTagNumber(block, "tilesHigh") || 3,
  };
}

function rectsOverlap(left, right) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function findCabinPlacement(sourceBlock, occupiedRects) {
  const sourceRect = readBuildingRect(sourceBlock) || { x: 0, y: 0, width: 5, height: 3 };
  const stepX = Math.max(sourceRect.width + 1, 6);
  const stepY = Math.max(sourceRect.height + 1, 4);

  // 优先在原始 Cabin 右侧和下方寻找空位，避免覆盖已有建筑。
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      const candidate = {
        x: sourceRect.x + col * stepX,
        y: sourceRect.y + row * stepY,
        width: sourceRect.width,
        height: sourceRect.height,
      };
      if (candidate.x < 0 || candidate.y < 0) continue;
      if (occupiedRects.some((rect) => rectsOverlap(candidate, rect))) continue;
      return candidate;
    }
  }

  return {
    x: sourceRect.x + stepX * (occupiedRects.length + 1),
    y: sourceRect.y,
    width: sourceRect.width,
    height: sourceRect.height,
  };
}

function uniqueCabinIndoorName(originalName, id) {
  const prefix = String(originalName || "FarmHouse").replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "",
  );
  return `${prefix || "FarmHouse"}${id}`;
}

function uniqueMultiplayerIds(xml) {
  const ids = new Set();
  const pattern = /<UniqueMultiplayerID>(-?\d+)<\/UniqueMultiplayerID>/g;
  let match = null;
  while ((match = pattern.exec(String(xml || ""))) !== null) {
    ids.add(match[1]);
  }
  return ids;
}

function firstUniqueMultiplayerId(xml) {
  const match = String(xml || "").match(/<UniqueMultiplayerID>(-?\d+)<\/UniqueMultiplayerID>/);
  return match ? match[1] : null;
}

function newUniqueMultiplayerId(existingIds) {
  const maxSignedLong = (1n << 63n) - 1n;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = BigInt(`0x${crypto.randomBytes(8).toString("hex")}`) & maxSignedLong;
    const id = value === 0n ? "1" : value.toString();
    if (!existingIds.has(id)) {
      existingIds.add(id);
      return id;
    }
  }
  throw new Error("Failed to generate a unique farmhand ID.");
}

function replaceUniqueMultiplayerIds(xml, id) {
  if (!/<UniqueMultiplayerID>-?\d+<\/UniqueMultiplayerID>/.test(String(xml || ""))) {
    throw new Error("Generated Cabin does not contain farmhand multiplayer data.");
  }
  return String(xml || "").replace(
    /(<UniqueMultiplayerID>)-?\d+(<\/UniqueMultiplayerID>)/g,
    `$1${id}$2`,
  );
}

function normalizeCabinFarmhandIds(xml, cabins) {
  const existingIds = uniqueMultiplayerIds(xml);
  const seenCabinIds = new Set();
  const replacements = [];

  for (const cabin of cabins) {
    const id = firstUniqueMultiplayerId(cabin.text);
    if (!id) continue;
    if (!seenCabinIds.has(id)) {
      seenCabinIds.add(id);
      continue;
    }
    const replacementId = newUniqueMultiplayerId(existingIds);
    replacements.push({
      start: cabin.start,
      end: cabin.end,
      text: replaceUniqueMultiplayerIds(cabin.text, replacementId),
    });
    seenCabinIds.add(replacementId);
  }

  if (!replacements.length) {
    return { xml, fixedFarmhandIds: 0 };
  }

  let nextXml = xml;
  for (const replacement of replacements.reverse()) {
    nextXml = `${nextXml.slice(0, replacement.start)}${replacement.text}${nextXml.slice(replacement.end)}`;
  }
  return { xml: nextXml, fixedFarmhandIds: replacements.length };
}

function cloneCabinBlock(sourceBlock, placement, existingIds) {
  const id = crypto.randomUUID();
  let next = replaceXmlTagValue(sourceBlock, "tileX", placement.x);
  next = replaceXmlTagValue(next, "tileY", placement.y);
  next = replaceXmlTagValue(next, "id", id);
  const originalUniqueName = xmlTagValue(next, "uniqueName");
  if (originalUniqueName != null) {
    next = replaceXmlTagValue(next, "uniqueName", uniqueCabinIndoorName(originalUniqueName, id));
  }
  next = replaceUniqueMultiplayerIds(next, newUniqueMultiplayerId(existingIds));
  return next;
}

function patchCabinsXml(xml, targetCabins) {
  let currentXml = xml;
  let buildings = findBuildingBlocks(currentXml);
  let cabins = buildings.filter((building) => isCabinBuildingBlock(building.text));
  const normalized = normalizeCabinFarmhandIds(currentXml, cabins);
  currentXml = normalized.xml;
  if (normalized.fixedFarmhandIds) {
    buildings = findBuildingBlocks(currentXml);
    cabins = buildings.filter((building) => isCabinBuildingBlock(building.text));
  }

  if (cabins.length >= targetCabins) {
    return {
      xml: currentXml,
      changed: normalized.fixedFarmhandIds > 0,
      currentCabins: cabins.length,
      cabinCount: cabins.length,
      addedCabins: 0,
      fixedFarmhandIds: normalized.fixedFarmhandIds,
    };
  }
  if (!cabins.length) {
    throw new Error("No generated Cabin building was found in the new save.");
  }

  const existingIds = uniqueMultiplayerIds(currentXml);
  const sourceCabin = cabins[0].text;
  const occupiedRects = buildings.map((building) => readBuildingRect(building.text)).filter(Boolean);
  const clones = [];
  for (let count = cabins.length; count < targetCabins; count += 1) {
    const placement = findCabinPlacement(sourceCabin, occupiedRects);
    clones.push(cloneCabinBlock(sourceCabin, placement, existingIds));
    occupiedRects.push(placement);
  }

  const insertAt = cabins[cabins.length - 1].end;
  return {
    xml: `${currentXml.slice(0, insertAt)}${clones.join("")}${currentXml.slice(insertAt)}`,
    changed: true,
    currentCabins: cabins.length,
    cabinCount: targetCabins,
    addedCabins: clones.length,
    fixedFarmhandIds: normalized.fixedFarmhandIds,
  };
}

function validateBackupArchive(value) {
  const archive = String(value || "").trim();
  if (!BACKUP_ARCHIVE_PATTERN.test(archive) || path.basename(archive) !== archive) {
    throw new Error("Backup archive name is invalid.");
  }
  return archive;
}

function parseMetadata(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index === -1) continue;
    values[line.slice(0, index)] = line.slice(index + 1);
  }
  return values;
}

function formatTimestampForFile(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "-" +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

function tsv(value) {
  return String(value ?? "").replace(/[\t\r\n]/g, " ").trim();
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
    '  unique_ids="$(grep -o \'<UniqueMultiplayerID>-*[0-9]*</UniqueMultiplayerID>\' "$main" 2>/dev/null | sed \'s/<\\/?UniqueMultiplayerID>//g\' | sort -u | wc -l | tr -d \' \')"',
    '  usable_cabins=0',
    '  if [ "${unique_ids:-0}" -gt 1 ]; then usable_cabins=$((unique_ids - 1)); fi',
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
      return save.cabinCount > 0 && save.farmName === farmName && (!updatedMs || updatedMs >= minUpdatedMs);
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

    return {
      saveName: safeSaveName,
      targetCabins,
      currentCabins: patched.currentCabins,
      cabinCount: patched.cabinCount,
      addedCabins: patched.addedCabins,
      fixedFarmhandIds: patched.fixedFarmhandIds,
      patched: patched.changed,
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function restartStackAfterNewGame(farmName, targetCabins, newGameStartedAtMs) {
  if (targetCabins <= 1) {
    return {
      ...(await restartStack()),
      cabinPatch: null,
    };
  }

  const save = await waitForNewGameSave(farmName, newGameStartedAtMs);
  const down = await compose(["down"], { timeoutMs: 120000 });
  if (!down.ok) {
    throw new Error(await sanitize(down.stderr || down.stdout || "docker compose down failed"));
  }

  try {
    const cabinPatch = await patchSaveCabins(save.name, targetCabins);
    const up = await compose(["up", "-d"], { timeoutMs: 120000 });
    if (!up.ok) {
      throw new Error(await sanitize(up.stderr || up.stdout || "docker compose up failed"));
    }
    return {
      message: "Server stack restarted.",
      cabinPatch,
    };
  } catch (error) {
    await compose(["up", "-d"], { timeoutMs: 120000 }).catch(() => {});
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

async function getSaveManagement() {
  const [{ volumeExists, saves }, backups, backupPolicy] = await Promise.all([
    listSaves(),
    listBackups(),
    readBackupPolicy(),
  ]);
  return { volumeExists, saves, backups, backupPolicy, autoBackup: getAutoBackupState() };
}

function validatePlayerName(value) {
  const raw = String(value || "");
  if (/[\r\n]/.test(raw)) throw new Error("玩家名称无效。");
  const name = raw.trim();
  if (!name || name.length > 64) throw new Error("玩家名称无效。");
  return name;
}

function normalizeApiPlayers(response) {
  if (!response || !Array.isArray(response.players)) return [];
  return response.players
    .map((player) => ({
      id: player.id == null ? "" : String(player.id),
      name: cleanText(player.name, 64, "Unknown"),
      isOnline: player.isOnline !== false,
    }))
    .filter((player) => player.name);
}

function normalizeFarmhands(response, onlinePlayers) {
  if (!response || !Array.isArray(response.farmhands)) return [];
  const onlineIds = new Set(onlinePlayers.map((player) => player.id).filter(Boolean));
  const onlineNames = new Set(onlinePlayers.map((player) => player.name.toLowerCase()));
  return response.farmhands
    .map((farmhand) => {
      const id = farmhand.id == null ? "" : String(farmhand.id);
      const name = cleanText(farmhand.name, 64, "");
      return {
        id,
        name,
        isCustomized: Boolean(farmhand.isCustomized),
        isOnline: (id && onlineIds.has(id)) || (name && onlineNames.has(name.toLowerCase())),
      };
    })
    .filter((farmhand) => farmhand.id || farmhand.name);
}

function normalizeAuthStatus(response) {
  if (!response) return null;
  return {
    enabled: Boolean(response.enabled),
    authenticatedCount: Number(response.authenticatedCount || 0),
    pendingCount: Number(response.pendingCount || 0),
    timeoutSeconds: Number(response.timeoutSeconds || 0),
    maxAttempts: Number(response.maxAttempts || 0),
  };
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

function buildPlayerManagement(apiPlayers, apiFarmhands, apiAuth, recentPlayers = []) {
  const onlinePlayers = normalizeApiPlayers(apiPlayers);
  const farmhands = normalizeFarmhands(apiFarmhands, onlinePlayers);
  const apiAvailable = Boolean(apiPlayers || apiFarmhands || apiAuth);
  return {
    apiAvailable,
    onlinePlayers,
    farmhands,
    recentPlayers,
    auth: normalizeAuthStatus(apiAuth),
    capabilities: {
      grantAdmin: Boolean(apiPlayers),
      deleteFarmhand: Boolean(apiFarmhands),
      kick: false,
      ban: false,
    },
    unsupportedMessage:
      "当前 sdvd/server 镜像没有暴露 HTTP 踢出/封禁接口；只能由游戏内管理员使用 !kick / !ban，或升级到支持该 API 的服务端镜像。",
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

async function getPlayerManagement(recentPlayers = []) {
  const [apiPlayers, apiFarmhands, apiAuth] = await Promise.all([
    serverApiJson("/players").catch(() => null),
    serverApiJson("/farmhands").catch(() => null),
    serverApiJson("/auth").catch(() => null),
  ]);
  return buildPlayerManagement(apiPlayers, apiFarmhands, apiAuth, recentPlayers);
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
  const playerManagement = buildPlayerManagement(apiPlayers, apiFarmhands, apiAuth, signals.players);
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

async function saveNewGameConfig(payload) {
  const previousSettings = await readSettings();
  const settings = JSON.parse(JSON.stringify(previousSettings));
  applyGameCreationSettings(settings, payload);
  settings.Server.MaxPlayers = intInRange(payload.maxPlayers, "Max players", 1, 10);
  settings.Server.SeparateWallets = bool(payload.separateWallets);

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

  await writeSettings(settings);

  await setEnvValue("GAME_PORT", intInRange(payload.gamePort, "Game port", 1, 65535));
  await setEnvValue("QUERY_PORT", intInRange(payload.queryPort, "Query port", 1, 65535));
  await setEnvValue("VNC_PORT", intInRange(payload.vncPort, "VNC port", 1, 65535));
  await setEnvValue("API_PORT", intInRange(payload.apiPort, "API port", 1, 65535));
  await setEnvValue("VERBOSE_LOGGING", settings.Server.VerboseLogging ? "true" : "false");

  const passwordAction = payload.serverPasswordAction || "keep";
  if (passwordAction === "clear") {
    await setEnvValue("SERVER_PASSWORD", "");
  } else if (passwordAction === "set") {
    await setEnvValue("SERVER_PASSWORD", cleanText(payload.serverPassword, 80, ""));
  } else if (passwordAction !== "keep") {
    throw new Error("Server password action is invalid.");
  }

  return {
    settings,
    restartRequired: true,
    newGameOnlyChanged: hasSettingChanges(previousSettings, settings, NEW_GAME_ONLY_SETTING_PATHS),
  };
}

async function restartStack() {
  const down = await compose(["down"], { timeoutMs: 120000 });
  if (!down.ok) {
    throw new Error(await sanitize(down.stderr || down.stdout || "docker compose down failed"));
  }
  const up = await compose(["up", "-d"], { timeoutMs: 120000 });
  if (!up.ok) {
    throw new Error(await sanitize(up.stderr || up.stdout || "docker compose up failed"));
  }
  return { message: "Server stack restarted." };
}

async function startStack() {
  const up = await compose(["up", "-d"], { timeoutMs: 120000 });
  if (!up.ok) {
    throw new Error(await sanitize(up.stderr || up.stdout || "docker compose up failed"));
  }
  return { message: "Server stack started." };
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

async function latestLogs() {
  const logs = await compose(["logs", "--tail", "1200", "--no-color", "server", "steam-auth"], { timeoutMs: 12000 });
  return { logs: await sanitize(logs.stdout || logs.stderr || "") };
}

async function isServerContainerRunning() {
  const result = await docker(["inspect", "-f", "{{.State.Running}}", "sdv-server"], { timeoutMs: 8000 });
  return result.ok && result.stdout.trim() === "true";
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
    const up = await compose(["up", "-d"], { timeoutMs: 120000 });
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
  if (String(payload.confirm || "") !== farmName) {
    throw new Error("New farm confirmation did not match the configured farm name.");
  }

  const wasRunning = await isServerContainerRunning();
  const volumeExistsBefore = await savesVolumeExists();
  let readiness = null;
  if (wasRunning) {
    readiness = await collectShutdownReadiness();
    if (!isSafeForImmediateRestart(readiness) && payload.force !== true) {
      throw apiError(409, readiness.message);
    }
  }

  const savedConfig = await saveNewGameConfig(payload);
  const targetCabins = savedConfig.settings.Game.StartingCabins;
  const newGameStartedAtMs = Date.now();
  let preNewGameBackup = null;
  if (volumeExistsBefore) {
    preNewGameBackup = await createSavesBackup(`Automatic backup before creating new farm ${farmName}.`);
  }

  if (!wasRunning && !volumeExistsBefore) {
    const up = await compose(["up", "-d"], { timeoutMs: 120000 });
    if (!up.ok) {
      throw new Error(await sanitize(up.stderr || up.stdout || "docker compose up failed"));
    }
    let cabinPatch = null;
    let restarted = false;
    let message = "Server stack started. A new farm will be created from the saved settings.";
    if (targetCabins > 1) {
      const restart = await restartStackAfterNewGame(farmName, targetCabins, newGameStartedAtMs);
      cabinPatch = restart.cabinPatch;
      restarted = true;
      message = restart.message;
    }
    return {
      farmName,
      settings: savedConfig.settings,
      preNewGameBackup: null,
      commandStartedServer: true,
      readiness,
      restarted,
      cabinPatch,
      message,
    };
  }

  if (wasRunning) {
    const down = await compose(["down"], { timeoutMs: 120000 });
    if (!down.ok) {
      throw new Error(await sanitize(down.stderr || down.stdout || "docker compose down failed"));
    }
  }

  const commandState = await ensureServerReadyForSmapiCommand();
  await sendSmapiCommand("settings newgame --confirm");
  const restart = await restartStackAfterNewGame(farmName, targetCabins, newGameStartedAtMs);

  return {
    farmName,
    settings: savedConfig.settings,
    preNewGameBackup: preNewGameBackup?.archive || null,
    commandStartedServer: commandState.started,
    readiness,
    restarted: true,
    cabinPatch: restart.cabinPatch,
    message: restart.message,
  };
}

async function repairSaveCabins(payload) {
  const saveName = validateSaveName(payload.saveName);
  if (payload.confirm !== saveName) {
    throw new Error("Repair confirmation did not match the save name.");
  }

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
      const up = await compose(["up", "-d"], { timeoutMs: 120000 });
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
      await compose(["up", "-d"], { timeoutMs: 120000 }).catch(() => {});
    }
    throw error;
  }
}

async function deleteSave(payload) {
  const saveName = validateSaveName(payload.saveName);
  if (payload.confirm !== saveName) {
    throw new Error("Delete confirmation did not match the save name.");
  }

  const { saves } = await listSaves();
  if (!saves.some((save) => save.name === saveName)) {
    throw new Error(`Save not found: ${saveName}`);
  }

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

    if (wasRunning) {
      const up = await compose(["up", "-d"], { timeoutMs: 120000 });
      if (!up.ok) {
        throw new Error(await sanitize(up.stderr || up.stdout || "docker compose up failed"));
      }
    }

    return {
      deleted: saveName,
      preDeleteBackup: preDeleteBackup.archive,
      restarted: wasRunning,
      readiness,
    };
  } catch (error) {
    if (wasRunning) {
      await compose(["up", "-d"], { timeoutMs: 120000 }).catch(() => {});
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

async function restoreBackup(payload) {
  const archive = validateBackupArchive(payload.archive);
  if (payload.confirm !== archive) {
    throw new Error("Restore confirmation did not match the backup archive name.");
  }

  const archivePath = path.join(BACKUP_DIR, archive);
  await fsp.access(archivePath, fs.constants.R_OK);

  const preRestoreBackup = await createSavesBackup(`Automatic backup before restoring ${archive}.`, {
    preserveArchives: [archive],
  });
  const down = await compose(["down"], { timeoutMs: 120000 });
  if (!down.ok) {
    throw new Error(await sanitize(down.stderr || down.stdout || "docker compose down failed"));
  }

  const script = `set -eu
tar -tzf /backup/${archive} > /tmp/archive-files
if grep -Eq '(^/|(^|/)\\.\\.(/|$))' /tmp/archive-files; then
  echo 'Backup archive contains unsafe paths.'
  exit 1
fi
find /saves -mindepth 1 -maxdepth 1 -exec rm -rf {} +
tar -xzf /backup/${archive} -C /saves
chown -R 1000:1000 /saves 2>/dev/null || true`;

  try {
    const restore = await docker(
      ["run", "--rm", "-v", `${SAVES_VOLUME}:/saves`, "-v", `${BACKUP_DIR}:/backup:ro`, "alpine:3.20", "sh", "-c", script],
      { timeoutMs: 120000 },
    );
    if (!restore.ok) {
      throw new Error(await sanitize(restore.stderr || restore.stdout || "Backup restore failed."));
    }

    const up = await compose(["up", "-d"], { timeoutMs: 120000 });
    if (!up.ok) {
      throw new Error(await sanitize(up.stderr || up.stdout || "docker compose up failed"));
    }
  } catch (error) {
    await compose(["up", "-d"], { timeoutMs: 120000 }).catch(() => {});
    throw error;
  }

  return {
    restored: archive,
    preRestoreBackup: preRestoreBackup.archive,
    restarted: true,
  };
}

async function deleteBackup(payload) {
  const archive = validateBackupArchive(payload.archive);
  if (payload.confirm !== archive) {
    throw new Error("Delete confirmation did not match the backup archive name.");
  }

  const archivePath = path.join(BACKUP_DIR, archive);
  const metadataPath = path.join(BACKUP_DIR, archive.replace(/\.tar\.gz$/, ".meta.txt"));
  await fsp.unlink(archivePath);
  try {
    await fsp.unlink(metadataPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return { deleted: archive };
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

function ensureApiSuccess(response, actionLabel) {
  if (response && response.success === false) {
    throw apiError(400, response.error || response.message || `${actionLabel} failed.`);
  }
  return response || {};
}

async function grantAdminRole(payload) {
  const name = validatePlayerName(payload.name);
  const response = await serverApiRequest("POST", `/roles/admin?name=${encodeURIComponent(name)}`);
  const result = ensureApiSuccess(response, "Grant admin");
  return {
    name,
    playerId: result.playerId == null ? "" : String(result.playerId),
    message: result.message || `已授予管理员：${name}`,
  };
}

async function deleteFarmhand(payload) {
  const name = validatePlayerName(payload.name);
  if (payload.confirm !== name) {
    throw new Error("删除确认内容必须和角色名称完全一致。");
  }
  const response = await serverApiRequest("DELETE", `/farmhands?name=${encodeURIComponent(name)}`);
  const result = ensureApiSuccess(response, "Delete farmhand");
  return {
    name,
    message: result.message || `已删除离线角色：${name}`,
  };
}

function unsupportedKickBan(action) {
  throw apiError(
    501,
    `当前 sdvd/server 镜像未暴露 HTTP ${action} 接口；面板不会伪装执行成功。请在游戏内由管理员使用 !kick / !ban，或升级到支持该 API 的服务端镜像。`,
  );
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/auth" && req.method === "POST") {
    const body = await readJsonBody(req);
    const env = await readEnv();
    if (body.token && body.token === env.ADMIN_TOKEN) {
      res.writeHead(204, {
        "Set-Cookie": `${ADMIN_COOKIE}=${encodeURIComponent(body.token)}; Path=/; SameSite=Strict; HttpOnly`,
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }
    json(res, 401, { error: "Invalid admin token." });
    return;
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    res.writeHead(204, {
      "Set-Cookie": `${ADMIN_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0`,
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  if (!(await isAuthorized(req))) {
    json(res, 401, { error: "Admin token required." });
    return;
  }

  if (pathname === "/api/status" && req.method === "GET") {
    json(res, 200, await getStatus());
    return;
  }
  if (pathname === "/api/players" && req.method === "GET") {
    const signals = await runtimeSignals().catch(() => ({ players: [] }));
    json(res, 200, await getPlayerManagement(signals.players));
    return;
  }
  if (pathname === "/api/players/grant-admin" && req.method === "POST") {
    json(res, 200, await grantAdminRole(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/players/kick" && req.method === "POST") {
    unsupportedKickBan("踢出玩家");
    return;
  }
  if (pathname === "/api/players/ban" && req.method === "POST") {
    unsupportedKickBan("封禁玩家");
    return;
  }
  if (pathname === "/api/farmhands" && req.method === "DELETE") {
    json(res, 200, await deleteFarmhand(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/config" && req.method === "GET") {
    json(res, 200, await getConfig());
    return;
  }
  if (pathname === "/api/config" && req.method === "POST") {
    json(res, 200, await saveConfig(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/restart" && req.method === "POST") {
    json(res, 200, await restartStack());
    return;
  }
  if (pathname === "/api/start" && req.method === "POST") {
    json(res, 200, await startStack());
    return;
  }
  if (pathname === "/api/stop" && req.method === "POST") {
    json(res, 200, await requestStopStack(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/stop/cancel" && req.method === "POST") {
    json(res, 200, { job: cancelStopAfterSaveJob() });
    return;
  }
  if (pathname === "/api/saves" && req.method === "GET") {
    json(res, 200, await getSaveManagement());
    return;
  }
  if (pathname === "/api/saves/select" && req.method === "POST") {
    json(res, 200, await selectSave(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/saves/newgame" && req.method === "POST") {
    json(res, 200, await createNewGame(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/saves/repair-cabins" && req.method === "POST") {
    json(res, 200, await repairSaveCabins(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/saves/delete" && req.method === "POST") {
    json(res, 200, await deleteSave(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/saves/backup" && req.method === "POST") {
    json(res, 200, await createSavesBackup("Created from admin panel."));
    return;
  }
  if (pathname === "/api/backups/policy" && req.method === "POST") {
    json(res, 200, await updateBackupPolicy(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/backups/restore" && req.method === "POST") {
    json(res, 200, await restoreBackup(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/backups/delete" && req.method === "POST") {
    json(res, 200, await deleteBackup(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/logs" && req.method === "GET") {
    json(res, 200, await latestLogs());
    return;
  }

  json(res, 404, { error: "Not found." });
}

const PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Stardew Valley Server Kit Admin</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --line: #d9dee7;
      --text: #172033;
      --muted: #687386;
      --blue: #2563eb;
      --green: #16803c;
      --amber: #a15c00;
      --red: #b42318;
      --shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }
    header {
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 5;
    }
    .topbar {
      max-width: 1180px;
      margin: 0 auto;
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .brand h1 {
      margin: 0;
      font-size: 18px;
      letter-spacing: 0;
    }
    .brand p {
      margin: 2px 0 0;
      color: var(--muted);
      font-size: 12px;
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 20px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    button, input, select, textarea {
      font: inherit;
    }
    button {
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      padding: 7px 12px;
      cursor: pointer;
    }
    button.primary {
      background: var(--blue);
      border-color: var(--blue);
      color: #fff;
    }
    button.danger {
      border-color: #f0b5ae;
      color: var(--red);
    }
    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 14px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 16px;
    }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .span-8 { grid-column: span 8; }
    .span-12 { grid-column: span 12; }
    .section-title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
    }
    .section-title h2 {
      margin: 0;
      font-size: 15px;
      letter-spacing: 0;
    }
    .hint, .muted {
      color: var(--muted);
      font-size: 12px;
    }
    .status-list, .kv-list, .players {
      display: grid;
      gap: 8px;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-top: 1px solid #eef1f5;
      padding-top: 8px;
    }
    .row:first-child {
      border-top: 0;
      padding-top: 0;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 2px 9px;
      border: 1px solid var(--line);
      background: #f8fafc;
      color: var(--muted);
      white-space: nowrap;
    }
    .pill.ok { color: var(--green); background: #eefaf1; border-color: #c7ebd2; }
    .pill.warn { color: var(--amber); background: #fff8e8; border-color: #f4ddaa; }
    .pill.bad { color: var(--red); background: #fff1f0; border-color: #f1b8b2; }
    form {
      display: grid;
      gap: 18px;
    }
    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 12px;
    }
    legend {
      grid-column: span 12;
      font-weight: 700;
      margin-bottom: -2px;
    }
    label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
    }
    label strong {
      color: var(--text);
      font-size: 13px;
    }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 10px;
      background: #fff;
      color: var(--text);
    }
    textarea {
      min-height: 86px;
      resize: vertical;
    }
    .field-3 { grid-column: span 3; }
    .field-4 { grid-column: span 4; }
    .field-6 { grid-column: span 6; }
    .field-12 { grid-column: span 12; }
    .checkline {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      color: var(--text);
      font-size: 13px;
    }
    .checkline input {
      width: auto;
    }
    .backup-policy {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 12px;
      align-items: end;
      margin-top: 12px;
      padding: 12px;
      border: 1px solid #eef1f5;
      border-radius: 6px;
      background: #fbfcfe;
    }
    .manage-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      margin-top: 14px;
    }
    .manage-column h3 {
      margin: 0 0 8px;
      font-size: 13px;
    }
    .manage-list {
      display: grid;
      gap: 0;
      border-top: 1px solid #eef1f5;
    }
    .manage-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid #eef1f5;
    }
    .manage-item strong {
      display: block;
      overflow-wrap: anywhere;
    }
    .manage-item .hint {
      display: block;
      margin-top: 3px;
    }
    .manage-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px;
    }
    .manage-actions button {
      min-height: 30px;
      padding: 5px 9px;
    }
    pre {
      margin: 0;
      min-height: 360px;
      max-height: 65vh;
      overflow: auto;
      white-space: pre-wrap;
      background: #111827;
      color: #e5e7eb;
      border-radius: 6px;
      padding: 12px;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
      resize: vertical;
    }
    .notice {
      border-left: 3px solid var(--amber);
      background: #fff9eb;
      padding: 10px 12px;
      color: #604000;
      border-radius: 6px;
    }
    .auth {
      max-width: 480px;
      margin: 60px auto;
    }
    .hidden { display: none !important; }
    .message {
      min-height: 22px;
      color: var(--muted);
    }
    .message.bad { color: var(--red); }
    .message.ok { color: var(--green); }
    .modal {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: grid;
      place-items: center;
      padding: 20px;
      background: rgba(15, 23, 42, 0.42);
    }
    .modal-panel {
      width: min(620px, 100%);
      display: grid;
      gap: 14px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.24);
      padding: 18px;
    }
    .modal-panel h2 {
      margin: 0;
      font-size: 17px;
    }
    .modal-message {
      margin: 0;
      white-space: pre-line;
      color: var(--text);
    }
    .copy-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
    }
    .copy-row input {
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      user-select: all;
    }
    .modal-actions {
      justify-content: flex-end;
    }
    @media (max-width: 860px) {
      .span-4, .span-6, .span-8 { grid-column: span 12; }
      .field-3, .field-4, .field-6 { grid-column: span 12; }
      .backup-policy { grid-template-columns: 1fr; }
      .manage-grid { grid-template-columns: 1fr; }
      .manage-item { grid-template-columns: 1fr; }
      .manage-actions { justify-content: flex-start; }
      .copy-row { grid-template-columns: 1fr; }
      .topbar { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <div class="brand">
        <h1>Stardew Valley Server Kit Admin</h1>
        <p>管理面板，配置保存后通常需要重启服务端。</p>
      </div>
      <div class="toolbar">
        <button id="refreshBtn" type="button">刷新</button>
        <button id="startBtn" class="primary" type="button">启动服务端</button>
        <button id="stopBtn" class="danger" type="button">停服释放资源</button>
        <button id="cancelAutoStopBtn" type="button" disabled>取消自动停服</button>
        <button id="restartBtn" class="danger" type="button">重启服务端</button>
        <span id="serverActionMessage" class="message"></span>
      </div>
    </div>
  </header>

  <main>
    <section id="authPanel" class="panel auth hidden">
      <div class="section-title">
        <h2>管理令牌</h2>
      </div>
      <p class="muted">请输入 .env 里的 ADMIN_TOKEN。令牌只用于本地管理 API，不会展示敏感配置。</p>
      <form id="authForm">
        <label>
          <strong>ADMIN_TOKEN</strong>
          <input id="tokenInput" type="password" autocomplete="current-password" />
        </label>
        <button class="primary" type="submit">进入面板</button>
        <div id="authMessage" class="message"></div>
      </form>
    </section>

    <section id="appPanel" class="grid hidden">
      <div class="panel span-4">
        <div class="section-title">
          <h2>运行状态</h2>
          <span id="generatedAt" class="hint"></span>
        </div>
        <div id="healthList" class="status-list"></div>
      </div>

      <div class="panel span-4">
        <div class="section-title">
          <h2>加入信息</h2>
        </div>
        <div id="joinInfo" class="kv-list"></div>
      </div>

      <div class="panel span-4">
        <div class="section-title">
          <h2>玩家摘要</h2>
        </div>
        <div id="players" class="players"></div>
      </div>

      <div id="playerManagerPanel" class="panel span-12">
        <div class="section-title">
          <h2>玩家管理</h2>
          <div class="toolbar">
            <button id="refreshPlayersBtn" type="button">刷新玩家</button>
          </div>
        </div>
        <div class="notice">
          玩家名称来自服务端 HTTP API；当前镜像没有开放面板直接踢出/封禁的接口，相关按钮会明确标记为不可用。
        </div>
        <div id="playersMessage" class="message"></div>
        <div class="manage-grid">
          <div class="manage-column">
            <h3>在线玩家</h3>
            <div id="onlinePlayersList" class="manage-list"></div>
          </div>
          <div class="manage-column">
            <h3>农场角色</h3>
            <div id="farmhandsList" class="manage-list"></div>
          </div>
        </div>
      </div>

      <div class="panel span-12">
        <div class="section-title">
          <h2>开服配置</h2>
          <span class="hint">这里只保存服务端运行配置；地图创建在存档管理里单独完成。</span>
        </div>
        <div id="runtimeFarmNotice" class="notice hidden"></div>
        <form id="configForm">
          <fieldset>
            <legend>联机</legend>
            <label class="field-4"><strong>房间总人数</strong><input name="maxPlayers" type="number" min="1" max="10" /></label>
            <label class="field-4"><strong>游戏 UDP 端口</strong><input name="gamePort" type="number" min="1" max="65535" /></label>
            <label class="field-4"><strong>查询 UDP 端口</strong><input name="queryPort" type="number" min="1" max="65535" /></label>
            <label class="field-4"><strong>大厅模式</strong>
              <select name="lobbyMode">
                <option value="Shared">Shared</option>
                <option value="Individual">Individual</option>
              </select>
            </label>
            <label class="field-4 checkline"><input name="allowIpConnections" type="checkbox" />允许 IP 直连</label>
            <label class="field-4 checkline"><input name="separateWallets" type="checkbox" />玩家钱包分开</label>
            <label class="field-4 checkline"><input name="verboseLogging" type="checkbox" />详细日志</label>
          </fieldset>

          <fieldset>
            <legend>用户与访问</legend>
            <label class="field-4"><strong>小屋策略</strong>
              <select name="cabinStrategy">
                <option value="CabinStack">CabinStack</option>
              </select>
            </label>
            <label class="field-4"><strong>已有小屋处理</strong>
              <select name="existingCabinBehavior">
                <option value="KeepExisting">KeepExisting</option>
              </select>
            </label>
            <label class="field-4"><strong>进服密码操作</strong>
              <select name="serverPasswordAction">
                <option value="keep">保持不变</option>
                <option value="set">设置新密码</option>
                <option value="clear">清空密码</option>
              </select>
            </label>
            <label class="field-4"><strong>新进服密码</strong><input name="serverPassword" type="password" autocomplete="new-password" /></label>
            <label class="field-4"><strong>VNC 端口</strong><input name="vncPort" type="number" min="1" max="65535" /></label>
            <label class="field-4"><strong>HTTP API 端口</strong><input name="apiPort" type="number" min="1" max="65535" /></label>
            <label class="field-12"><strong>管理员 Steam64 ID</strong><textarea name="adminSteamIds" placeholder="每行一个 Steam64 ID"></textarea></label>
          </fieldset>

          <div class="notice">
            保存只写运行配置。端口、人数、IP 直连、密码和管理员等设置需要重启服务端后生效；农场名称和地图类型请在“存档管理”里点击“创建地图”单独设置。
          </div>
          <div class="toolbar">
            <button class="primary" type="submit">保存配置</button>
            <span id="saveMessage" class="message"></span>
          </div>
        </form>
      </div>

      <div id="saveManagerPanel" class="panel span-12">
        <div class="section-title">
          <h2>存档管理</h2>
          <div class="toolbar">
            <button id="refreshSavesBtn" type="button">刷新存档</button>
            <button id="createBackupBtn" type="button">创建备份</button>
            <button id="createNewGameBtn" class="primary" type="button">创建地图</button>
          </div>
        </div>
        <div class="notice">
          选择存档只设置下次重启要加载的存档。创建地图会打开独立表单，保存新农场配置后调用服务端官方 newgame 命令并重启。删除存档会先自动备份整个 saves 卷，再只移除选中的存档目录。恢复备份会停止服务端，用备份覆盖整个 saves 卷，并在恢复前自动备份当前状态。
        </div>
        <div class="backup-policy">
          <label class="field-3 checkline"><input id="autoBackupEnabled" type="checkbox" />自动备份</label>
          <label class="field-3"><strong>间隔分钟</strong><input id="autoBackupInterval" type="number" min="15" max="10080" /></label>
          <label class="field-3"><strong>最多保留</strong><input id="backupRetention" type="number" min="1" max="100" /></label>
          <div class="field-3 toolbar">
            <button id="saveBackupPolicyBtn" type="button">保存备份策略</button>
          </div>
          <div id="backupPolicyStatus" class="field-12 hint"></div>
        </div>
        <div id="savesMessage" class="message"></div>
        <div class="manage-grid">
          <div class="manage-column">
            <h3>可加载存档</h3>
            <div id="savesList" class="manage-list"></div>
          </div>
          <div class="manage-column">
            <h3>备份文件</h3>
            <div id="backupsList" class="manage-list"></div>
          </div>
        </div>
      </div>

      <div class="panel span-6">
        <div class="section-title">
          <h2>端口映射</h2>
        </div>
        <div id="ports" class="kv-list"></div>
      </div>

      <div class="panel span-6">
        <div class="section-title">
          <h2>资源占用</h2>
        </div>
        <div id="stats" class="kv-list"></div>
      </div>

      <div class="panel span-12">
        <div class="section-title">
          <h2>最近日志</h2>
          <div class="toolbar">
            <button id="loadLogsBtn" type="button">刷新更多日志</button>
            <button id="copyLogsBtn" type="button">复制日志</button>
          </div>
        </div>
        <pre id="logs"></pre>
      </div>
    </section>
  </main>

  <div id="createMapDialog" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="createMapTitle">
    <form id="createMapForm" class="modal-panel">
      <h2 id="createMapTitle">创建地图</h2>
      <p class="modal-message">填写新农场信息后，面板会保存这些新地图配置，再调用服务端官方 newgame 命令并重启。旧存档不会删除。</p>
      <fieldset>
        <label class="field-6"><strong>农场名称</strong><input name="farmName" maxlength="48" /></label>
        <label class="field-6"><strong>地图类型</strong><select name="farmType"></select></label>
        <label class="field-4"><strong>利润比例</strong>
          <select name="profitMargin">
            <option value="1">100%</option>
            <option value="0.75">75%</option>
            <option value="0.5">50%</option>
            <option value="0.25">25%</option>
          </select>
        </label>
        <label class="field-4"><strong>房间总人数</strong><input name="maxPlayers" type="number" min="1" max="10" /></label>
        <label class="field-4"><strong>初始小屋数量</strong><input name="startingCabins" type="number" min="0" max="9" /></label>
        <label class="field-4"><strong>夜间怪物</strong>
          <select name="spawnMonstersAtNight">
            <option value="auto">自动</option>
            <option value="true">开启</option>
            <option value="false">关闭</option>
          </select>
        </label>
        <label class="field-4 checkline"><input name="separateWallets" type="checkbox" />玩家钱包分开</label>
      </fieldset>
      <div id="createMapMessage" class="message"></div>
      <div class="toolbar modal-actions">
        <button id="cancelCreateMapBtn" type="button">取消</button>
        <button class="primary" type="submit">创建地图并开服</button>
      </div>
    </form>
  </div>

  <div id="confirmDialog" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="confirmDialogTitle">
    <div class="modal-panel">
      <h2 id="confirmDialogTitle">确认操作</h2>
      <p id="confirmDialogMessage" class="modal-message"></p>
      <label>
        <strong>需要输入的完整内容</strong>
        <div class="copy-row">
          <input id="confirmDialogTarget" type="text" readonly />
          <button id="confirmDialogCopyBtn" type="button">复制</button>
        </div>
      </label>
      <label>
        <strong>输入确认内容</strong>
        <input id="confirmDialogInput" type="text" autocomplete="off" />
      </label>
      <div id="confirmDialogHint" class="hint"></div>
      <div class="toolbar modal-actions">
        <button id="confirmDialogCancelBtn" type="button">取消</button>
        <button id="confirmDialogActionBtn" class="danger" type="button" disabled>确认</button>
      </div>
    </div>
  </div>

  <script>
    const authPanel = document.querySelector("#authPanel");
    const appPanel = document.querySelector("#appPanel");
    const authForm = document.querySelector("#authForm");
    const tokenInput = document.querySelector("#tokenInput");
    const authMessage = document.querySelector("#authMessage");
    const configForm = document.querySelector("#configForm");
    const saveMessage = document.querySelector("#saveMessage");
    const serverActionMessage = document.querySelector("#serverActionMessage");
    const startBtn = document.querySelector("#startBtn");
    const stopBtn = document.querySelector("#stopBtn");
    const restartBtn = document.querySelector("#restartBtn");
    const cancelAutoStopBtn = document.querySelector("#cancelAutoStopBtn");
    const runtimeFarmNotice = document.querySelector("#runtimeFarmNotice");
    const savesMessage = document.querySelector("#savesMessage");
    const savesList = document.querySelector("#savesList");
    const backupsList = document.querySelector("#backupsList");
    const saveManagerPanel = document.querySelector("#saveManagerPanel");
    const autoBackupEnabled = document.querySelector("#autoBackupEnabled");
    const autoBackupInterval = document.querySelector("#autoBackupInterval");
    const backupRetention = document.querySelector("#backupRetention");
    const backupPolicyStatus = document.querySelector("#backupPolicyStatus");
    const saveBackupPolicyBtn = document.querySelector("#saveBackupPolicyBtn");
    const createNewGameBtn = document.querySelector("#createNewGameBtn");
    const createMapDialog = document.querySelector("#createMapDialog");
    const createMapForm = document.querySelector("#createMapForm");
    const createMapMessage = document.querySelector("#createMapMessage");
    const cancelCreateMapBtn = document.querySelector("#cancelCreateMapBtn");
    const playersMessage = document.querySelector("#playersMessage");
    const onlinePlayersList = document.querySelector("#onlinePlayersList");
    const farmhandsList = document.querySelector("#farmhandsList");
    const playerManagerPanel = document.querySelector("#playerManagerPanel");
    const confirmDialog = document.querySelector("#confirmDialog");
    const confirmDialogTitle = document.querySelector("#confirmDialogTitle");
    const confirmDialogMessage = document.querySelector("#confirmDialogMessage");
    const confirmDialogTarget = document.querySelector("#confirmDialogTarget");
    const confirmDialogCopyBtn = document.querySelector("#confirmDialogCopyBtn");
    const confirmDialogInput = document.querySelector("#confirmDialogInput");
    const confirmDialogHint = document.querySelector("#confirmDialogHint");
    const confirmDialogCancelBtn = document.querySelector("#confirmDialogCancelBtn");
    const confirmDialogActionBtn = document.querySelector("#confirmDialogActionBtn");
    const logsPanel = document.querySelector("#logs");
    const loadLogsBtn = document.querySelector("#loadLogsBtn");
    const copyLogsBtn = document.querySelector("#copyLogsBtn");
    let hasConfig = false;
    let shutdownPollTimer = null;
    let logsMode = "recent";

    function setMessage(target, text, type) {
      target.textContent = text || "";
      target.className = "message" + (type ? " " + type : "");
    }

    function setLogsText(text, mode) {
      const shouldStickToBottom =
        logsPanel.scrollHeight - logsPanel.scrollTop - logsPanel.clientHeight < 48;
      logsPanel.textContent = text || "";
      logsMode = mode || logsMode;
      if (shouldStickToBottom || mode === "full") {
        logsPanel.scrollTop = logsPanel.scrollHeight;
      }
    }

    function exactConfirm(options) {
      const value = String(options.value ?? "");
      confirmDialogTitle.textContent = options.title || "确认操作";
      confirmDialogMessage.textContent = options.message || "";
      confirmDialogTarget.value = value;
      confirmDialogInput.value = "";
      confirmDialogHint.textContent = "可以点“复制”，也可以手动选中上面的内容复制。";
      confirmDialogActionBtn.textContent = options.actionText || "确认";
      confirmDialogActionBtn.className = options.danger === false ? "primary" : "danger";
      confirmDialogActionBtn.disabled = true;
      confirmDialog.classList.remove("hidden");

      return new Promise((resolve) => {
        const cleanup = (result) => {
          confirmDialog.classList.add("hidden");
          confirmDialogInput.removeEventListener("input", update);
          confirmDialogCopyBtn.removeEventListener("click", copyTarget);
          confirmDialogCancelBtn.removeEventListener("click", cancel);
          confirmDialogActionBtn.removeEventListener("click", submit);
          confirmDialog.removeEventListener("click", clickBackdrop);
          document.removeEventListener("keydown", handleKeydown);
          resolve(result);
        };
        const update = () => {
          confirmDialogActionBtn.disabled = confirmDialogInput.value !== value;
        };
        const copyTarget = async () => {
          confirmDialogTarget.focus();
          confirmDialogTarget.select();
          try {
            await navigator.clipboard.writeText(value);
            confirmDialogHint.textContent = "已复制。";
          } catch (_) {
            try {
              document.execCommand("copy");
              confirmDialogHint.textContent = "已复制。";
            } catch (error) {
              confirmDialogHint.textContent = "已选中，请按 Ctrl+C 复制。";
            }
          }
        };
        const cancel = () => cleanup(null);
        const submit = () => {
          if (confirmDialogInput.value === value) cleanup(value);
        };
        const clickBackdrop = (event) => {
          if (event.target === confirmDialog) cancel();
        };
        const handleKeydown = (event) => {
          if (event.key === "Escape") cancel();
        };

        confirmDialogInput.addEventListener("input", update);
        confirmDialogCopyBtn.addEventListener("click", copyTarget);
        confirmDialogCancelBtn.addEventListener("click", cancel);
        confirmDialogActionBtn.addEventListener("click", submit);
        confirmDialog.addEventListener("click", clickBackdrop);
        document.addEventListener("keydown", handleKeydown);
        setTimeout(() => confirmDialogInput.focus(), 0);
      });
    }

    function openCreateMapDialog() {
      setMessage(createMapMessage, "");
      createMapDialog.classList.remove("hidden");
      setTimeout(() => createMapForm.elements.farmName.focus(), 0);
    }

    function closeCreateMapDialog() {
      createMapDialog.classList.add("hidden");
      setMessage(createMapMessage, "");
    }

    async function request(path, options = {}) {
      const response = await fetch(path, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
      });
      if (response.status === 401) {
        appPanel.classList.add("hidden");
        authPanel.classList.remove("hidden");
        throw new Error("需要管理令牌");
      }
      if (!response.ok) {
        let message = response.statusText;
        try {
          const body = await response.json();
          message = body.error || message;
        } catch (_) {}
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      if (response.status === 204) return null;
      return response.json();
    }

    function pill(text, kind) {
      return '<span class="pill ' + (kind || "") + '">' + escapeHtml(text) + "</span>";
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch]));
    }

    function row(label, value) {
      return '<div class="row"><span>' + escapeHtml(label) + '</span><strong>' + value + "</strong></div>";
    }

    function formatDateTime(value) {
      if (!value) return "n/a";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "n/a";
      return date.toLocaleString();
    }

    function formatBytes(value) {
      const bytes = Number(value || 0);
      if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
      const units = ["B", "KB", "MB", "GB"];
      let size = bytes;
      let unit = 0;
      while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
      }
      return (unit === 0 ? size.toFixed(0) : size.toFixed(1)) + " " + units[unit];
    }

    function formatGameDate(runtime) {
      if (!runtime || !runtime.year) return "n/a";
      const seasons = { spring: "春", summer: "夏", fall: "秋", winter: "冬" };
      const season = seasons[String(runtime.season || "").toLowerCase()] || runtime.season || "";
      const rawTime = String(runtime.timeOfDay || 0).padStart(4, "0");
      const time = rawTime.slice(0, -2) + ":" + rawTime.slice(-2);
      return "第 " + runtime.year + " 年 " + season + " " + runtime.day + " 日 " + time;
    }

    function renderRuntimeFarmNotice(status, config) {
      const runtime = status.runtime;
      if (!runtime || !runtime.farmName) {
        runtimeFarmNotice.classList.add("hidden");
        runtimeFarmNotice.textContent = "";
        return;
      }

      const configuredName = config.settings.Game.FarmName || "Junimo";
      const nameText = "当前运行中的存档是「" + runtime.farmName + "」，配置里的新农场名称是「" + configuredName + "」。";
      const suffix = runtime.farmName === configuredName
        ? "地图、利润、初始小屋等字段仍以存档内容为准。"
        : "重启会继续加载当前存档，不会把它改名或换地图。";

      runtimeFarmNotice.textContent = nameText + suffix;
      runtimeFarmNotice.classList.remove("hidden");
    }

    function renderBackupPolicy(data) {
      const policy = data.backupPolicy || {};
      const state = data.autoBackup || {};
      autoBackupEnabled.checked = Boolean(policy.enabled);
      autoBackupInterval.value = policy.intervalMinutes || 360;
      backupRetention.value = policy.retention || 10;

      const parts = [];
      parts.push(policy.enabled ? "自动备份已开启" : "自动备份已关闭");
      parts.push("最多保留 " + (policy.retention || 10) + " 份");
      if (policy.enabled && state.nextRunAt) parts.push("下次：" + formatDateTime(state.nextRunAt));
      if (state.running) parts.push("正在备份");
      if (state.lastResult?.ok) {
        parts.push("上次：" + formatDateTime(state.lastRunAt) + "，" + state.lastResult.archive);
        if (state.lastResult.pruned?.length) parts.push("已清理旧备份 " + state.lastResult.pruned.length + " 份");
      } else if (state.lastResult?.error) {
        parts.push("上次失败：" + state.lastResult.error);
      }
      backupPolicyStatus.textContent = parts.join(" · ");
    }

    function renderSaveManagement(data) {
      renderBackupPolicy(data);
      if (!data.volumeExists) {
        savesList.innerHTML = '<p class="muted">还没有 saves Docker volume。先启动服务端一次。</p>';
      } else if (data.saves.length) {
        savesList.innerHTML = data.saves.map((save) => (
          (() => {
            const cabinText = save.usableCabinCount === save.cabinCount
              ? ' · 小屋：' + escapeHtml(save.cabinCount ?? 0)
              : ' · 小屋：' + escapeHtml(save.cabinCount ?? 0) + ' · 可用角色：' + escapeHtml(save.usableCabinCount ?? 0);
            return (
          '<div class="manage-item">' +
            '<div><strong>' + escapeHtml(save.name) + '</strong>' +
              '<span class="hint">农场：' + escapeHtml(save.farmName || "Unknown") +
              ' · 地图：' + escapeHtml(save.farmType ?? "n/a") +
              cabinText +
              ' · 更新：' + escapeHtml(formatDateTime(save.updatedAt)) + '</span></div>' +
            '<div class="manage-actions">' +
              '<button data-action="select-save" data-name="' + escapeHtml(save.name) + '">下次加载</button>' +
              '<button data-action="repair-cabins" data-name="' + escapeHtml(save.name) + '">修复小屋</button>' +
              '<button class="danger" data-action="delete-save" data-name="' + escapeHtml(save.name) + '">删除</button>' +
            '</div>' +
          '</div>'
            );
          })()
        )).join("");
      } else {
        savesList.innerHTML = '<p class="muted">未发现可加载存档。</p>';
      }

      backupsList.innerHTML = data.backups.length ? data.backups.map((backup) => (
        '<div class="manage-item">' +
          '<div><strong>' + escapeHtml(backup.archive) + '</strong>' +
            '<span class="hint">' + escapeHtml(formatBytes(backup.sizeBytes)) +
            ' · 创建：' + escapeHtml(formatDateTime(backup.createdAt)) + '</span></div>' +
          '<div class="manage-actions">' +
            '<button data-action="restore-backup" data-archive="' + escapeHtml(backup.archive) + '">恢复</button>' +
            '<button class="danger" data-action="delete-backup" data-archive="' + escapeHtml(backup.archive) + '">删除</button>' +
          '</div>' +
        '</div>'
      )).join("") : '<p class="muted">还没有备份文件。</p>';
    }

    function renderPlayerManagement(data) {
      const unsupported = data.unsupportedMessage || "当前服务端镜像未开放该操作。";
      const apiHint = data.apiAvailable
        ? (data.auth?.enabled
          ? "进服密码保护：已启用，已验证 " + data.auth.authenticatedCount + " 人，待验证 " + data.auth.pendingCount + " 人。"
          : "服务端 HTTP API 已连接。")
        : "未连接到服务端 HTTP API。请确认 API_ENABLED=true、容器已启动且 API_KEY 一致。";
      setMessage(playersMessage, apiHint, data.apiAvailable ? "ok" : "bad");

      if (data.onlinePlayers?.length) {
        onlinePlayersList.innerHTML = data.onlinePlayers.map((player) => (
          '<div class="manage-item">' +
            '<div><strong>' + escapeHtml(player.name) + '</strong>' +
              '<span class="hint">ID：' + escapeHtml(player.id || "n/a") +
              ' · 状态：在线</span></div>' +
            '<div class="manage-actions">' +
              '<button data-action="grant-admin" data-name="' + escapeHtml(player.name) + '">授予管理员</button>' +
              '<button disabled title="' + escapeHtml(unsupported) + '">踢出</button>' +
              '<button class="danger" disabled title="' + escapeHtml(unsupported) + '">封禁</button>' +
            '</div>' +
          '</div>'
        )).join("");
      } else if (data.recentPlayers?.length) {
        onlinePlayersList.innerHTML = data.recentPlayers.map((player) => (
          '<div class="manage-item">' +
            '<div><strong>' + escapeHtml(player.name) + '</strong>' +
              '<span class="hint">' + escapeHtml(player.address || "最近日志记录") +
              ' · ' + escapeHtml(player.lastEvent || "seen") + '</span></div>' +
            '<div class="manage-actions">' +
              '<button disabled title="需要服务端 HTTP API 在线玩家列表。">授予管理员</button>' +
              '<button disabled title="' + escapeHtml(unsupported) + '">踢出</button>' +
              '<button class="danger" disabled title="' + escapeHtml(unsupported) + '">封禁</button>' +
            '</div>' +
          '</div>'
        )).join("");
      } else {
        onlinePlayersList.innerHTML = '<p class="muted">当前没有在线玩家。</p>';
      }

      if (data.farmhands?.length) {
        farmhandsList.innerHTML = data.farmhands.map((farmhand) => {
          const name = farmhand.name || "未命名角色";
          const canDelete = farmhand.name && !farmhand.isOnline;
          const deleteTitle = farmhand.isOnline
            ? "在线角色不能删除。"
            : (farmhand.name ? "删除该离线角色和对应小屋。" : "未命名角色不能按名称删除。");
          return (
            '<div class="manage-item">' +
              '<div><strong>' + escapeHtml(name) + '</strong>' +
                '<span class="hint">ID：' + escapeHtml(farmhand.id || "n/a") +
                ' · ' + escapeHtml(farmhand.isCustomized ? "已创建" : "未创建") +
                ' · ' + escapeHtml(farmhand.isOnline ? "在线" : "离线") + '</span></div>' +
              '<div class="manage-actions">' +
                '<button class="danger" ' +
                  (canDelete ? 'data-action="delete-farmhand" data-name="' + escapeHtml(farmhand.name) + '"' : "disabled") +
                  ' title="' + escapeHtml(deleteTitle) + '">删除离线角色</button>' +
              '</div>' +
            '</div>'
          );
        }).join("");
      } else {
        farmhandsList.innerHTML = '<p class="muted">未读取到农场角色。</p>';
      }
    }

    function fillConfig(data) {
      const settings = data.settings;
      const env = data.env;
      const farmTypeOptions = data.farmTypes.map((item) => (
        '<option value="' + item.value + '">' + escapeHtml(item.label) + "</option>"
      )).join("");
      createMapForm.elements.farmType.innerHTML = farmTypeOptions;

      createMapForm.elements.farmName.value = settings.Game.FarmName || "Junimo";
      createMapForm.elements.farmType.value = settings.Game.FarmType ?? 0;
      createMapForm.elements.profitMargin.value = settings.Game.ProfitMargin ?? 1;
      createMapForm.elements.maxPlayers.value = settings.Server.MaxPlayers ?? 4;
      createMapForm.elements.startingCabins.value = settings.Game.StartingCabins ?? 1;
      createMapForm.elements.spawnMonstersAtNight.value = String(settings.Game.SpawnMonstersAtNight ?? "auto");
      createMapForm.elements.separateWallets.checked = Boolean(settings.Server.SeparateWallets);
      configForm.elements.maxPlayers.value = settings.Server.MaxPlayers ?? 4;
      configForm.elements.gamePort.value = env.gamePort;
      configForm.elements.queryPort.value = env.queryPort;
      configForm.elements.vncPort.value = env.vncPort;
      configForm.elements.apiPort.value = env.apiPort;
      configForm.elements.lobbyMode.value = settings.Server.LobbyMode || "Shared";
      configForm.elements.allowIpConnections.checked = Boolean(settings.Server.AllowIpConnections);
      configForm.elements.separateWallets.checked = Boolean(settings.Server.SeparateWallets);
      configForm.elements.verboseLogging.checked = Boolean(settings.Server.VerboseLogging);
      configForm.elements.cabinStrategy.value = settings.Server.CabinStrategy || "CabinStack";
      configForm.elements.existingCabinBehavior.value = settings.Server.ExistingCabinBehavior || "KeepExisting";
      configForm.elements.adminSteamIds.value = (settings.Server.AdminSteamIds || []).join("\n");
      configForm.elements.serverPasswordAction.value = "keep";
      configForm.elements.serverPassword.value = "";
      hasConfig = true;
    }

    function formPayload() {
      const form = configForm.elements;
      return {
        maxPlayers: form.maxPlayers.value,
        gamePort: form.gamePort.value,
        queryPort: form.queryPort.value,
        vncPort: form.vncPort.value,
        apiPort: form.apiPort.value,
        lobbyMode: form.lobbyMode.value,
        allowIpConnections: form.allowIpConnections.checked,
        separateWallets: form.separateWallets.checked,
        verboseLogging: form.verboseLogging.checked,
        cabinStrategy: form.cabinStrategy.value,
        existingCabinBehavior: form.existingCabinBehavior.value,
        serverPasswordAction: form.serverPasswordAction.value,
        serverPassword: form.serverPassword.value,
        adminSteamIds: form.adminSteamIds.value,
      };
    }

    function createMapPayload() {
      const form = createMapForm.elements;
      return {
        farmName: form.farmName.value,
        farmType: form.farmType.value,
        profitMargin: form.profitMargin.value,
        maxPlayers: form.maxPlayers.value,
        startingCabins: form.startingCabins.value,
        spawnMonstersAtNight: form.spawnMonstersAtNight.value,
        separateWallets: form.separateWallets.checked,
      };
    }

    function shutdownLabel(readiness) {
      if (!readiness) return "n/a";
      if (readiness.mode === "safe-empty") return "可停服：在线 0 人";
      if (readiness.mode === "safe-saved") return "可停服：近期已存档";
      if (readiness.mode === "warn-unsaved") return "需谨慎：可能未存档";
      if (readiness.mode === "unknown-saved") return "需确认：人数未知但近期已存档";
      return "需确认：在线人数未知";
    }

    function renderServerActions(data) {
      const running = Boolean(data.stackRunning);
      const job = data.shutdownJob;
      const jobActive = Boolean(job?.active);
      startBtn.disabled = running || jobActive;
      stopBtn.disabled = !running || jobActive;
      restartBtn.disabled = jobActive;
      cancelAutoStopBtn.disabled = !jobActive;
      createNewGameBtn.disabled = jobActive;

      if (jobActive) {
        setMessage(serverActionMessage, job.message || "正在等待自动停服...", "warn");
        if (!shutdownPollTimer) {
          shutdownPollTimer = setTimeout(() => {
            shutdownPollTimer = null;
            loadAll().catch((error) => setMessage(serverActionMessage, error.message, "bad"));
          }, 15000);
        }
      } else if (job?.state === "stopped") {
        if (shutdownPollTimer) {
          clearTimeout(shutdownPollTimer);
          shutdownPollTimer = null;
        }
        setMessage(serverActionMessage, job.message || "已自动停服。", "ok");
      } else if (job?.state === "failed" || job?.state === "timed-out") {
        if (shutdownPollTimer) {
          clearTimeout(shutdownPollTimer);
          shutdownPollTimer = null;
        }
        setMessage(serverActionMessage, job.message || "自动停服未完成。", "bad");
      } else if (!serverActionMessage.textContent) {
        if (shutdownPollTimer) {
          clearTimeout(shutdownPollTimer);
          shutdownPollTimer = null;
        }
        setMessage(serverActionMessage, "");
      }
    }

    function renderStatus(data) {
      document.querySelector("#generatedAt").textContent = new Date(data.generatedAt).toLocaleTimeString();
      renderServerActions(data);
      const health = document.querySelector("#healthList");
      health.innerHTML = data.health.length ? data.health.map((item) => {
        const kind = item.health === "healthy" || item.status === "running" ? "ok" : "bad";
        return row(item.name, pill((item.status || "unknown") + " / " + (item.health || "none"), kind));
      }).join("") : row("Docker", pill(data.dockerAvailable ? "服务端已停止" : "不可用", data.dockerAvailable ? "warn" : "bad"));

      const join = document.querySelector("#joinInfo");
      const lan = data.lanAddresses.filter((item) => item.recommended)[0] || data.lanAddresses[0];
      join.innerHTML = [
        row("服务端", pill(data.stackRunning ? "运行中" : "已停止", data.stackRunning ? "ok" : "warn")),
        row("本机 IP", escapeHtml(data.join.sameMachine)),
        row("局域网 IP", escapeHtml(lan ? lan.address : "n/a")),
        row("游戏端口", escapeHtml(data.join.gamePort)),
        row("IP 直连", pill(data.join.allowIpConnections ? "已开启" : "已关闭", data.join.allowIpConnections ? "ok" : "bad")),
        row("邀请码", escapeHtml(data.join.inviteCode || "n/a")),
        row("当前农场", escapeHtml(data.runtime?.farmName || "n/a")),
        row("游戏日期", escapeHtml(formatGameDate(data.runtime))),
        row("停服判断", escapeHtml(shutdownLabel(data.shutdownReadiness))),
      ].join("");

      document.querySelector("#players").innerHTML = data.players.length ? data.players.map((player) => (
        '<div class="row"><span>' + escapeHtml(player.name) + '<br><span class="hint">' + escapeHtml(player.address || "") + '</span></span>' +
        pill(player.lastEvent || "seen", player.lastEvent === "joined" || player.lastEvent === "online" ? "ok" : "warn") + "</div>"
      )).join("") : '<p class="muted">还没有最近玩家活动。</p>';

      renderPlayerManagement(data.playerManagement || {});

      document.querySelector("#ports").innerHTML = data.publishedPorts.length
        ? data.publishedPorts.map((line, index) => row("映射 " + (index + 1), escapeHtml(line))).join("")
        : '<p class="muted">未读取到端口映射。</p>';

      document.querySelector("#stats").innerHTML = data.stats.length
        ? data.stats.map((item) => row(item.name, escapeHtml((item.cpu || "") + " / " + (item.memory || "")))).join("")
        : '<p class="muted">未读取到资源占用。</p>';

      if (logsMode === "recent") {
        setLogsText(data.recentSignals.join("\n"), "recent");
      }
    }

    async function loadAll() {
      const [status, config, saveManagement] = await Promise.all([
        request("/api/status"),
        request("/api/config"),
        request("/api/saves"),
      ]);
      renderStatus(status);
      if (!hasConfig) fillConfig(config);
      renderRuntimeFarmNotice(status, config);
      renderSaveManagement(saveManagement);
      authPanel.classList.add("hidden");
      appPanel.classList.remove("hidden");
    }

    authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setMessage(authMessage, "验证中...");
      try {
        await request("/api/auth", {
          method: "POST",
          body: JSON.stringify({ token: tokenInput.value }),
        });
        tokenInput.value = "";
        setMessage(authMessage, "");
        await loadAll();
      } catch (error) {
        setMessage(authMessage, error.message, "bad");
      }
    });

    configForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      setMessage(saveMessage, "保存中...");
      try {
        await request("/api/config", { method: "POST", body: JSON.stringify(formPayload()) });
        hasConfig = false;
        await loadAll();
        setMessage(saveMessage, "已保存，运行配置重启后生效。", "ok");
      } catch (error) {
        setMessage(saveMessage, error.message, "bad");
      }
    });

    async function reloadSaveManagement() {
      const data = await request("/api/saves");
      renderSaveManagement(data);
      return data;
    }

    async function reloadPlayerManagement() {
      const data = await request("/api/players");
      renderPlayerManagement(data);
      return data;
    }

    document.querySelector("#refreshPlayersBtn").addEventListener("click", async () => {
      setMessage(playersMessage, "刷新中...");
      try {
        await reloadPlayerManagement();
      } catch (error) {
        setMessage(playersMessage, error.message, "bad");
      }
    });

    playerManagerPanel.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      try {
        if (action === "grant-admin") {
          const name = button.dataset.name;
          if (!confirm("授予玩家管理员权限：" + name + "？")) return;
          setMessage(playersMessage, "正在授予管理员...");
          const result = await request("/api/players/grant-admin", {
            method: "POST",
            body: JSON.stringify({ name }),
          });
          await reloadPlayerManagement();
          setMessage(playersMessage, result.message || "已授予管理员：" + name, "ok");
          return;
        }

        if (action === "delete-farmhand") {
          const name = button.dataset.name;
          const confirmText = await exactConfirm({
            title: "删除离线角色",
            message: "删除离线角色会移除该角色和对应小屋。请输入完整角色名称确认。",
            value: name,
            actionText: "删除",
          });
          if (confirmText !== name) return;
          setMessage(playersMessage, "正在删除离线角色...");
          const result = await request("/api/farmhands", {
            method: "DELETE",
            body: JSON.stringify({ name, confirm: confirmText }),
          });
          await reloadPlayerManagement();
          setMessage(playersMessage, result.message || "已删除离线角色：" + name, "ok");
        }
      } catch (error) {
        setMessage(playersMessage, error.message, "bad");
      }
    });

    saveBackupPolicyBtn.addEventListener("click", async () => {
      setMessage(savesMessage, "正在保存备份策略...");
      try {
        const result = await request("/api/backups/policy", {
          method: "POST",
          body: JSON.stringify({
            enabled: autoBackupEnabled.checked,
            intervalMinutes: autoBackupInterval.value,
            retention: backupRetention.value,
          }),
        });
        const data = await reloadSaveManagement();
        const prunedCount = result.pruned?.length || 0;
        setMessage(
          savesMessage,
          prunedCount ? "备份策略已保存，并清理旧备份 " + prunedCount + " 份。" : "备份策略已保存。",
          "ok",
        );
        renderBackupPolicy(data);
      } catch (error) {
        setMessage(savesMessage, error.message, "bad");
      }
    });

    document.querySelector("#refreshSavesBtn").addEventListener("click", async () => {
      setMessage(savesMessage, "刷新中...");
      try {
        await reloadSaveManagement();
        setMessage(savesMessage, "已刷新。", "ok");
      } catch (error) {
        setMessage(savesMessage, error.message, "bad");
      }
    });

    document.querySelector("#createBackupBtn").addEventListener("click", async () => {
      setMessage(savesMessage, "正在创建备份...");
      try {
        const result = await request("/api/saves/backup", { method: "POST", body: "{}" });
        await reloadSaveManagement();
        setMessage(savesMessage, "备份已创建：" + result.archive, "ok");
      } catch (error) {
        setMessage(savesMessage, error.message, "bad");
      }
    });

    createNewGameBtn.addEventListener("click", openCreateMapDialog);
    cancelCreateMapBtn.addEventListener("click", closeCreateMapDialog);
    createMapDialog.addEventListener("click", (event) => {
      if (event.target === createMapDialog) closeCreateMapDialog();
    });

    createMapForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = createMapPayload();
      const farmName = (String(payload.farmName || "").trim() || "Junimo").slice(0, 48);
      const farmTypeSelect = createMapForm.elements.farmType;
      const farmTypeLabel = farmTypeSelect.options[farmTypeSelect.selectedIndex]?.textContent || payload.farmType;
      const confirmText = await exactConfirm({
        title: "新建地图并开服",
        message:
          "这会保存当前地图表单，并按这些配置新建地图后重启服务端。旧存档不会删除；如果已有 saves volume，会先自动创建一份备份。\n\n" +
          "新农场：" + farmName + "\n" +
          "地图：" + farmTypeLabel + "\n\n" +
          "人数：" + payload.maxPlayers + "\n" +
          "请输入新农场名称确认。",
        value: farmName,
        actionText: "新建地图",
        danger: false,
      });
      if (confirmText !== farmName) return;

      async function submit(force) {
        return request("/api/saves/newgame", {
          method: "POST",
          body: JSON.stringify({ ...payload, confirm: confirmText, force }),
        });
      }

      setMessage(createMapMessage, "正在保存地图配置、设置新地图并重启服务端...");
      try {
        let result;
        try {
          result = await submit(false);
        } catch (error) {
          if (error.status !== 409) throw error;
          if (!confirm(error.message + "\n\n仍然强制新建地图并重启？")) return;
          setMessage(createMapMessage, "正在强制新建地图并重启服务端...");
          result = await submit(true);
        }

        hasConfig = false;
        await loadAll();
        closeCreateMapDialog();
        const backupText = result.preNewGameBackup ? "；执行前备份：" + result.preNewGameBackup : "";
        setMessage(savesMessage, "新地图已设置并重启：" + result.farmName + backupText, "ok");
      } catch (error) {
        setMessage(createMapMessage, error.message, "bad");
      }
    });

    saveManagerPanel.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      try {
        if (action === "select-save") {
          const saveName = button.dataset.name;
          if (!confirm("设置下次重启加载存档：" + saveName + "？")) return;
          setMessage(savesMessage, "正在设置下次加载的存档...");
          await request("/api/saves/select", {
            method: "POST",
            body: JSON.stringify({ saveName }),
          });
          setMessage(savesMessage, "已设置。重启服务端后会加载：" + saveName, "ok");
          return;
        }

        if (action === "repair-cabins") {
          const saveName = button.dataset.name;
          const confirmText = await exactConfirm({
            title: "修复小屋",
            message:
              "这会先备份整个 saves 卷，然后停止服务端，修复该存档里重复的小屋角色 ID，并按当前配置补齐小屋。完成后会重新启动服务端。\n\n" +
              "请输入完整存档名确认。",
            value: saveName,
            actionText: "修复小屋",
          });
          if (confirmText !== saveName) return;

          async function submit(force) {
            return request("/api/saves/repair-cabins", {
              method: "POST",
              body: JSON.stringify({ saveName, confirm: confirmText, force }),
            });
          }

          setMessage(savesMessage, "正在备份并修复小屋...");
          let result;
          try {
            result = await submit(false);
          } catch (error) {
            if (error.status !== 409) throw error;
            if (!confirm(error.message + "\n\n仍然强制修复该存档的小屋？")) return;
            setMessage(savesMessage, "正在强制备份并修复小屋...");
            result = await submit(true);
          }

          hasConfig = false;
          await loadAll();
          const patch = result.cabinPatch || {};
          const restartText = result.restarted ? "；服务端已重启" : "";
          setMessage(
            savesMessage,
            "小屋已修复：" + result.saveName +
              "；补建 " + (patch.addedCabins || 0) +
              " 座；修正角色 ID " + (patch.fixedFarmhandIds || 0) +
              " 个；执行前备份：" + result.preRepairBackup + restartText,
            "ok",
          );
          return;
        }

        if (action === "delete-save") {
          const saveName = button.dataset.name;
          const confirmText = await exactConfirm({
            title: "删除存档",
            message:
              "删除存档不可撤销。面板会先自动创建一份 saves 整卷备份，再删除这个存档目录。\n\n" +
              "如果服务端正在运行，会先停止、删除后再启动，避免存档写入冲突。\n\n" +
              "请输入完整存档名称确认。",
            value: saveName,
            actionText: "删除",
          });
          if (confirmText !== saveName) return;

          async function submit(force) {
            return request("/api/saves/delete", {
              method: "POST",
              body: JSON.stringify({ saveName, confirm: confirmText, force }),
            });
          }

          setMessage(savesMessage, "正在备份并删除存档...");
          let result;
          try {
            result = await submit(false);
          } catch (error) {
            if (error.status !== 409) throw error;
            if (!confirm(error.message + "\n\n仍然强制删除该存档？")) return;
            setMessage(savesMessage, "正在强制备份并删除存档...");
            result = await submit(true);
          }

          hasConfig = false;
          await loadAll();
          const restartText = result.restarted ? "；服务端已重启" : "";
          setMessage(
            savesMessage,
            "已删除存档：" + result.deleted + "；删除前备份：" + result.preDeleteBackup + restartText,
            "ok",
          );
          return;
        }

        if (action === "restore-backup") {
          const archive = button.dataset.archive;
          const confirmText = await exactConfirm({
            title: "恢复备份",
            message: "恢复会停止服务端，并用该备份覆盖整个 saves 卷。恢复前会自动备份当前状态。\n请输入备份文件名确认。",
            value: archive,
            actionText: "恢复",
          });
          if (confirmText !== archive) return;
          setMessage(savesMessage, "正在恢复备份...");
          const result = await request("/api/backups/restore", {
            method: "POST",
            body: JSON.stringify({ archive, confirm: confirmText }),
          });
          hasConfig = false;
          await loadAll();
          setMessage(savesMessage, "已恢复：" + result.restored + "；恢复前备份：" + result.preRestoreBackup, "ok");
          return;
        }

        if (action === "delete-backup") {
          const archive = button.dataset.archive;
          const confirmText = await exactConfirm({
            title: "删除备份",
            message: "删除不可撤销。请输入备份文件名确认删除。",
            value: archive,
            actionText: "删除",
          });
          if (confirmText !== archive) return;
          setMessage(savesMessage, "正在删除备份...");
          await request("/api/backups/delete", {
            method: "POST",
            body: JSON.stringify({ archive, confirm: confirmText }),
          });
          await reloadSaveManagement();
          setMessage(savesMessage, "已删除：" + archive, "ok");
        }
      } catch (error) {
        setMessage(savesMessage, error.message, "bad");
      }
    });

    document.querySelector("#refreshBtn").addEventListener("click", () => {
      loadAll().catch((error) => setMessage(saveMessage, error.message, "bad"));
    });

    startBtn.addEventListener("click", async () => {
      setMessage(serverActionMessage, "正在启动服务端...");
      try {
        await request("/api/start", { method: "POST", body: "{}" });
        setTimeout(() => loadAll().catch(() => {}), 4000);
        setMessage(serverActionMessage, "启动命令已完成。", "ok");
      } catch (error) {
        setMessage(serverActionMessage, error.message, "bad");
      }
    });

    stopBtn.addEventListener("click", async () => {
      setMessage(serverActionMessage, "正在检查停服条件...");
      try {
        const status = await request("/api/status");
        renderStatus(status);
        const readiness = status.shutdownReadiness || {};
        const prefix = "停服会执行 docker compose down，停止游戏相关容器以释放 CPU/内存；Docker volume、存档、配置和备份都会保留，Web 管理面板会继续运行。\n\n";

        if (readiness.mode === "safe-empty") {
          if (!confirm(prefix + "在线人数为 0，可以直接停服。")) return;
          await request("/api/stop", { method: "POST", body: JSON.stringify({ mode: "now" }) });
          setMessage(serverActionMessage, "已停服，Docker 资源已释放，数据已保留。", "ok");
          setTimeout(() => loadAll().catch(() => {}), 2000);
          return;
        }

        if (readiness.mode === "safe-saved") {
          if (!confirm(prefix + "存档已完成，可以安全停止。\n\n" + (readiness.lastSaveLine || readiness.message))) return;
          await request("/api/stop", { method: "POST", body: JSON.stringify({ mode: "now" }) });
          setMessage(serverActionMessage, "已停服，Docker 资源已释放，数据已保留。", "ok");
          setTimeout(() => loadAll().catch(() => {}), 2000);
          return;
        }

        if (readiness.mode === "warn-unsaved") {
          if (!confirm(prefix + readiness.message + "\n\n点“确定”后，面板会等待下一次 SaveGame.Save 完成，再自动停服。")) return;
          const result = await request("/api/stop", { method: "POST", body: JSON.stringify({ mode: "after-save" }) });
          setMessage(serverActionMessage, result.job?.message || "已开始等待下一次存档后自动停服。", "warn");
          setTimeout(() => loadAll().catch(() => {}), 2000);
          return;
        }

        const confirmText = await exactConfirm({
          title: "强制立即停服",
          message: prefix + readiness.message + "\n\n如果仍要立即停服，请输入 STOP。",
          value: "STOP",
          actionText: "立即停服",
        });
        if (confirmText !== "STOP") return;
        await request("/api/stop", { method: "POST", body: JSON.stringify({ mode: "now", force: true }) });
        setMessage(serverActionMessage, "已按确认立即停服，数据已保留。", "ok");
        setTimeout(() => loadAll().catch(() => {}), 2000);
      } catch (error) {
        setMessage(serverActionMessage, error.message, "bad");
      }
    });

    cancelAutoStopBtn.addEventListener("click", async () => {
      setMessage(serverActionMessage, "正在取消自动停服...");
      try {
        const result = await request("/api/stop/cancel", { method: "POST", body: "{}" });
        setMessage(serverActionMessage, result.job?.message || "已取消自动停服。", "ok");
        await loadAll();
      } catch (error) {
        setMessage(serverActionMessage, error.message, "bad");
      }
    });

    restartBtn.addEventListener("click", async () => {
      if (!confirm("重启会断开当前在线玩家，确认继续？")) return;
      setMessage(serverActionMessage, "正在重启服务端...");
      try {
        await request("/api/restart", { method: "POST", body: "{}" });
        setTimeout(() => loadAll().catch(() => {}), 4000);
        setMessage(serverActionMessage, "重启命令已完成。", "ok");
      } catch (error) {
        setMessage(serverActionMessage, error.message, "bad");
      }
    });

    loadLogsBtn.addEventListener("click", async () => {
      loadLogsBtn.disabled = true;
      try {
        const logs = await request("/api/logs");
        setLogsText(logs.logs, "full");
      } finally {
        loadLogsBtn.disabled = false;
      }
    });

    copyLogsBtn.addEventListener("click", async () => {
      const text = logsPanel.textContent || "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        copyLogsBtn.textContent = "已复制";
        setTimeout(() => {
          copyLogsBtn.textContent = "复制日志";
        }, 1600);
      } catch (_) {
        const range = document.createRange();
        range.selectNodeContents(logsPanel);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        copyLogsBtn.textContent = "已选中";
        setTimeout(() => {
          copyLogsBtn.textContent = "复制日志";
        }, 1600);
      }
    });

    let backgroundPollTimer = null;
    let backgroundPollInFlight = false;
    function startBackgroundPolling() {
      if (backgroundPollTimer) return;
      backgroundPollTimer = setInterval(async () => {
        if (document.hidden) return;
        if (backgroundPollInFlight) return;
        if (authPanel && !authPanel.classList.contains("hidden")) return;
        backgroundPollInFlight = true;
        try {
          await loadAll();
        } catch (_) {
          // ignore transient polling errors so the loop keeps going
        } finally {
          backgroundPollInFlight = false;
        }
      }, 8000);
    }
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        loadAll().catch(() => {});
      }
    });

    (async function boot() {
      const params = new URLSearchParams(location.search);
      const token = params.get("token");
      if (token) {
        history.replaceState(null, "", location.pathname);
        try {
          await request("/api/auth", { method: "POST", body: JSON.stringify({ token }) });
        } catch (_) {}
      }
      try {
        await loadAll();
        startBackgroundPolling();
      } catch (_) {
        authPanel.classList.remove("hidden");
      }
    })();
  </script>
</body>
</html>`;

async function main() {
  await ensureAdminFiles();
  await configureAutoBackupSchedule();
  const env = await readEnv();
  const host = env.ADMIN_HOST || process.env.ADMIN_HOST || "127.0.0.1";
  const port = Number.parseInt(env.ADMIN_PORT || process.env.ADMIN_PORT || "8088", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("ADMIN_PORT must be between 1 and 65535.");
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url.pathname);
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
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
    console.log(`ADMIN_TOKEN: ${freshEnv.ADMIN_TOKEN}`);
    if (process.env.INVOCATION_ID || process.env.JOURNAL_STREAM) {
      console.log("Admin panel is running under systemd.");
    } else {
      console.log("Keep this terminal open while using the admin panel.");
    }
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
