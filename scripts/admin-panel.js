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
const ADMIN_COOKIE = "sdv_admin_token";

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

async function readSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return cloneDefaultSettings();
  const parsed = JSON.parse(await fsp.readFile(SETTINGS_FILE, "utf8"));
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

function stringChoice(value, name, allowed) {
  if (!allowed.includes(value)) throw new Error(`${name} is invalid.`);
  return value;
}

function cleanText(value, maxLength, fallback = "") {
  const next = String(value || "").trim();
  if (!next) return fallback;
  return next.slice(0, maxLength);
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
    .filter((line) => !/Connected to the docker container shell|Exit and run 'make cli'/.test(line))
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
  const [ps, stats, ports, inspect, signals] = await Promise.all([
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
  ]);

  return {
    generatedAt: new Date().toISOString(),
    dockerAvailable: commandExists("docker"),
    containers: parseTableLines(ps.stdout).map((line) => {
      const [name, status, portText] = line.split("\t");
      return { name, status, ports: portText || "" };
    }),
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
    players: signals.players,
    recentSignals: signals.logs
      .split(/\r?\n/)
      .filter((line) =>
        /Healthcheck|SaveGame\.Save|Client connected|has joined|disconnected|NoMatch|ERROR|Exception|StartSleep|IP connections enabled/i.test(
          line,
        ),
      )
      .slice(-80),
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

async function saveConfig(payload) {
  const settings = await readSettings();
  settings.Game.FarmName = cleanText(payload.farmName, 48, "Junimo");
  settings.Game.FarmType = intInRange(payload.farmType, "Farm type", 0, 7);
  settings.Game.ProfitMargin = numberInSet(payload.profitMargin, "Profit margin", [1, 0.75, 0.5, 0.25]);
  settings.Game.StartingCabins = intInRange(payload.startingCabins, "Starting cabins", 0, 9);
  settings.Game.SpawnMonstersAtNight = stringChoice(payload.spawnMonstersAtNight, "Monster spawn", [
    "auto",
    "true",
    "false",
  ]);

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
  settings.Server.LobbyMode = stringChoice(payload.lobbyMode, "Lobby mode", ["Shared", "FriendsOnly", "InviteOnly"]);
  settings.Server.AdminSteamIds = parseSteamIds(payload.adminSteamIds);

  await writeSettings(settings);

  await setEnvValue("GAME_PORT", intInRange(payload.gamePort, "Game port", 1, 65535));
  await setEnvValue("QUERY_PORT", intInRange(payload.queryPort, "Query port", 1, 65535));
  await setEnvValue("VNC_PORT", intInRange(payload.vncPort, "VNC port", 1, 65535));
  await setEnvValue("API_PORT", intInRange(payload.apiPort, "API port", 1, 65535));

  const passwordAction = payload.serverPasswordAction || "keep";
  if (passwordAction === "clear") {
    await setEnvValue("SERVER_PASSWORD", "");
  } else if (passwordAction === "set") {
    await setEnvValue("SERVER_PASSWORD", cleanText(payload.serverPassword, 80, ""));
  } else if (passwordAction !== "keep") {
    throw new Error("Server password action is invalid.");
  }

  return { settings, restartRequired: true };
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

async function latestLogs() {
  const logs = await compose(["logs", "--tail", "160", "--no-color", "server", "steam-auth"], { timeoutMs: 12000 });
  return { logs: await sanitize(logs.stdout || logs.stderr || "") };
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
    pre {
      margin: 0;
      min-height: 220px;
      max-height: 420px;
      overflow: auto;
      white-space: pre-wrap;
      background: #111827;
      color: #e5e7eb;
      border-radius: 6px;
      padding: 12px;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
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
    @media (max-width: 860px) {
      .span-4, .span-6, .span-8 { grid-column: span 12; }
      .field-3, .field-4, .field-6 { grid-column: span 12; }
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
        <button id="restartBtn" class="danger" type="button">重启服务端</button>
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
          <h2>最近玩家</h2>
        </div>
        <div id="players" class="players"></div>
      </div>

      <div class="panel span-12">
        <div class="section-title">
          <h2>开服配置</h2>
          <span class="hint">地图、农场名、初始小屋主要影响新建农场。</span>
        </div>
        <form id="configForm">
          <fieldset>
            <legend>农场</legend>
            <label class="field-4"><strong>农场名称</strong><input name="farmName" maxlength="48" /></label>
            <label class="field-4"><strong>地图类型</strong><select name="farmType"></select></label>
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
          </fieldset>

          <fieldset>
            <legend>联机</legend>
            <label class="field-4"><strong>游戏 UDP 端口</strong><input name="gamePort" type="number" min="1" max="65535" /></label>
            <label class="field-4"><strong>查询 UDP 端口</strong><input name="queryPort" type="number" min="1" max="65535" /></label>
            <label class="field-4"><strong>大厅模式</strong>
              <select name="lobbyMode">
                <option value="Shared">Shared</option>
                <option value="FriendsOnly">FriendsOnly</option>
                <option value="InviteOnly">InviteOnly</option>
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
            保存只写配置文件。端口、人数、IP 直连等配置需要重启服务端后生效；地图和初始小屋通常只对新建农场生效。
          </div>
          <div class="toolbar">
            <button class="primary" type="submit">保存配置</button>
            <span id="saveMessage" class="message"></span>
          </div>
        </form>
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
          <button id="loadLogsBtn" type="button">读取完整日志</button>
        </div>
        <pre id="logs"></pre>
      </div>
    </section>
  </main>

  <script>
    const authPanel = document.querySelector("#authPanel");
    const appPanel = document.querySelector("#appPanel");
    const authForm = document.querySelector("#authForm");
    const tokenInput = document.querySelector("#tokenInput");
    const authMessage = document.querySelector("#authMessage");
    const configForm = document.querySelector("#configForm");
    const saveMessage = document.querySelector("#saveMessage");
    let hasConfig = false;

    function setMessage(target, text, type) {
      target.textContent = text || "";
      target.className = "message" + (type ? " " + type : "");
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
        throw new Error(message);
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

    function fillConfig(data) {
      const settings = data.settings;
      const env = data.env;
      const farmTypeSelect = configForm.elements.farmType;
      farmTypeSelect.innerHTML = data.farmTypes.map((item) => (
        '<option value="' + item.value + '">' + escapeHtml(item.label) + "</option>"
      )).join("");

      configForm.elements.farmName.value = settings.Game.FarmName || "Junimo";
      configForm.elements.farmType.value = settings.Game.FarmType ?? 0;
      configForm.elements.profitMargin.value = settings.Game.ProfitMargin ?? 1;
      configForm.elements.maxPlayers.value = settings.Server.MaxPlayers ?? 4;
      configForm.elements.startingCabins.value = settings.Game.StartingCabins ?? 1;
      configForm.elements.spawnMonstersAtNight.value = String(settings.Game.SpawnMonstersAtNight ?? "auto");
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
      configForm.elements.adminSteamIds.value = (settings.Server.AdminSteamIds || []).join("\\n");
      configForm.elements.serverPasswordAction.value = "keep";
      configForm.elements.serverPassword.value = "";
      hasConfig = true;
    }

    function formPayload() {
      const form = configForm.elements;
      return {
        farmName: form.farmName.value,
        farmType: form.farmType.value,
        profitMargin: form.profitMargin.value,
        maxPlayers: form.maxPlayers.value,
        startingCabins: form.startingCabins.value,
        spawnMonstersAtNight: form.spawnMonstersAtNight.value,
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

    function renderStatus(data) {
      document.querySelector("#generatedAt").textContent = new Date(data.generatedAt).toLocaleTimeString();
      const health = document.querySelector("#healthList");
      health.innerHTML = data.health.length ? data.health.map((item) => {
        const kind = item.health === "healthy" || item.status === "running" ? "ok" : "bad";
        return row(item.name, pill((item.status || "unknown") + " / " + (item.health || "none"), kind));
      }).join("") : row("Docker", pill(data.dockerAvailable ? "未发现容器" : "不可用", "warn"));

      const join = document.querySelector("#joinInfo");
      const lan = data.lanAddresses.filter((item) => item.recommended)[0] || data.lanAddresses[0];
      join.innerHTML = [
        row("本机 IP", escapeHtml(data.join.sameMachine)),
        row("局域网 IP", escapeHtml(lan ? lan.address : "n/a")),
        row("游戏端口", escapeHtml(data.join.gamePort)),
        row("IP 直连", pill(data.join.allowIpConnections ? "已开启" : "已关闭", data.join.allowIpConnections ? "ok" : "bad")),
        row("邀请码", escapeHtml(data.join.inviteCode || "n/a")),
      ].join("");

      document.querySelector("#players").innerHTML = data.players.length ? data.players.map((player) => (
        '<div class="row"><span>' + escapeHtml(player.name) + '<br><span class="hint">' + escapeHtml(player.address || "") + '</span></span>' +
        pill(player.lastEvent || "seen", player.lastEvent === "joined" ? "ok" : "warn") + "</div>"
      )).join("") : '<p class="muted">还没有最近玩家活动。</p>';

      document.querySelector("#ports").innerHTML = data.publishedPorts.length
        ? data.publishedPorts.map((line, index) => row("映射 " + (index + 1), escapeHtml(line))).join("")
        : '<p class="muted">未读取到端口映射。</p>';

      document.querySelector("#stats").innerHTML = data.stats.length
        ? data.stats.map((item) => row(item.name, escapeHtml((item.cpu || "") + " / " + (item.memory || "")))).join("")
        : '<p class="muted">未读取到资源占用。</p>';

      document.querySelector("#logs").textContent = data.recentSignals.join("\\n");
    }

    async function loadAll() {
      const [status, config] = await Promise.all([request("/api/status"), request("/api/config")]);
      renderStatus(status);
      if (!hasConfig) fillConfig(config);
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
        setMessage(saveMessage, "已保存，重启后生效。", "ok");
      } catch (error) {
        setMessage(saveMessage, error.message, "bad");
      }
    });

    document.querySelector("#refreshBtn").addEventListener("click", () => {
      loadAll().catch((error) => setMessage(saveMessage, error.message, "bad"));
    });

    document.querySelector("#restartBtn").addEventListener("click", async () => {
      if (!confirm("重启会断开当前在线玩家，确认继续？")) return;
      setMessage(saveMessage, "正在重启服务端...");
      try {
        await request("/api/restart", { method: "POST", body: "{}" });
        setTimeout(() => loadAll().catch(() => {}), 4000);
        setMessage(saveMessage, "重启命令已完成。", "ok");
      } catch (error) {
        setMessage(saveMessage, error.message, "bad");
      }
    });

    document.querySelector("#loadLogsBtn").addEventListener("click", async () => {
      const logs = await request("/api/logs");
      document.querySelector("#logs").textContent = logs.logs;
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
      } catch (_) {
        authPanel.classList.remove("hidden");
      }
    })();
  </script>
</body>
</html>`;

async function main() {
  await ensureAdminFiles();
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
      json(res, 500, { error: error.message || String(error) });
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
