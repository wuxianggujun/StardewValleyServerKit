"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const SMAPI_MODS_URL = "https://smapi.io/mods";
const NEXUS_API_BASE = "https://api.nexusmods.com/v1";
const NEXUS_GAME_DOMAIN = "stardewvalley";
const NEXUS_FILE_GROUP_ORDER = ["main", "patch", "optional", "old", "other"];
const NEXUS_API_RETRY_ATTEMPTS = 3;
const NEXUS_API_RETRY_BASE_MS = 1200;
const NEXUS_API_RETRY_MAX_WAIT_MS = 15000;
const NEXUS_FILE_CACHE_TTL_MS = 10 * 60 * 1000;
const SMAPI_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SMAPI_FETCH_MAX_BYTES = 30 * 1024 * 1024;
const MOD_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;
const MOD_DOWNLOAD_TIMEOUT_MS = 60000;
const MOD_CONFIG_MAX_BYTES = 1024 * 1024;
const ZIP_MAX_ENTRIES = 2000;
const ZIP_MAX_DEPTH = 16;
const ZIP_MAX_UNCOMPRESSED_BYTES = 300 * 1024 * 1024;
const ZIP_CENTRAL_DIRECTORY_MAX_BYTES = 8 * 1024 * 1024;
const ZIP_EOCD_MAX_SEARCH_BYTES = 22 + 0xffff;
const MAX_REDIRECTS = 5;
const DOWNLOAD_HOSTS = [
  "nexusmods.com",
  "nexus-cdn.com",
  "smapi.io",
  "github.com",
  "raw.githubusercontent.com",
  "githubusercontent.com",
];

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function cleanText(value, maxLength, fallback = "") {
  const next = String(value || "").trim();
  if (!next) return fallback;
  return next.slice(0, maxLength);
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function decodeHtmlEntities(value) {
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const named = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };
    const lower = entity.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(named, lower)) return named[lower];
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return match;
  });
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUpdateKeys(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^nexus\s*:\s*/, "")
    .trim();
}

function isAllowedDownloadHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return DOWNLOAD_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function assertHttpsUrl(value, options = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch (_) {
    throw new Error("下载 URL 无效。");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("下载 URL 必须使用 https。");
  }
  if (options.checkDownloadHost && !isAllowedDownloadHost(parsed.hostname)) {
    throw new Error("该下载来源不在允许列表中。");
  }
  return parsed;
}

function httpStatusError(prefix, statusCode, headers = {}) {
  const error = new Error(`${prefix}，HTTP ${statusCode}。`);
  error.statusCode = statusCode;
  error.retryAfterMs = parseRetryAfterMs(headers["retry-after"]);
  return error;
}

function parseRetryAfterMs(value, currentNowMs = Date.now()) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) {
    return Number(raw) * 1000;
  }
  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) return 0;
  return Math.max(0, timestamp - currentNowMs);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nexusRetryDelayMs(error, attempt) {
  if (error?.statusCode !== 429) return 0;
  const retryAfterMs = Number(error.retryAfterMs || 0);
  if (retryAfterMs > 0) return Math.min(retryAfterMs, NEXUS_API_RETRY_MAX_WAIT_MS);
  return Math.min(NEXUS_API_RETRY_BASE_MS * (2 ** attempt), NEXUS_API_RETRY_MAX_WAIT_MS);
}

function formatWaitSeconds(ms) {
  const seconds = Math.max(1, Math.ceil(Number(ms || 0) / 1000));
  return `${seconds} 秒`;
}

function requestBuffer(urlString, options = {}) {
  const maxBytes = options.maxBytes || SMAPI_FETCH_MAX_BYTES;
  const timeoutMs = options.timeoutMs || MOD_DOWNLOAD_TIMEOUT_MS;
  const redirectsLeft = options.redirectsLeft ?? MAX_REDIRECTS;
  const parsed = assertHttpsUrl(urlString, { checkDownloadHost: options.checkDownloadHost });
  const headers = {
    "Accept-Encoding": "identity",
    "User-Agent": "StardewValleyServerKitAdmin/1.0",
    ...(options.headers || {}),
  };

  return new Promise((resolve, reject) => {
    const req = https.get(
      parsed,
      {
        timeout: timeoutMs,
        headers,
      },
      (res) => {
        const statusCode = res.statusCode || 0;
        const location = res.headers.location;
        if (statusCode >= 300 && statusCode < 400 && location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error("请求重定向次数过多。"));
            return;
          }
          const nextUrl = new URL(location, parsed).toString();
          requestBuffer(nextUrl, { ...options, redirectsLeft: redirectsLeft - 1 }).then(resolve, reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          reject(httpStatusError("请求失败", statusCode, res.headers));
          return;
        }

        const contentLength = Number(res.headers["content-length"] || 0);
        if (contentLength > maxBytes) {
          res.resume();
          reject(new Error("响应内容超过大小限制。"));
          return;
        }

        const chunks = [];
        let totalBytes = 0;
        res.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > maxBytes) {
            req.destroy(new Error("响应内容超过大小限制。"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks, totalBytes)));
      },
    );

    req.on("timeout", () => req.destroy(new Error("请求超时。")));
    req.on("error", reject);
  });
}

function downloadFile(urlString, targetPath, options = {}) {
  const maxBytes = options.maxBytes || MOD_DOWNLOAD_MAX_BYTES;
  const timeoutMs = options.timeoutMs || MOD_DOWNLOAD_TIMEOUT_MS;
  const redirectsLeft = options.redirectsLeft ?? MAX_REDIRECTS;
  const parsed = assertHttpsUrl(urlString, { checkDownloadHost: true });

  return new Promise((resolve, reject) => {
    const req = https.get(
      parsed,
      {
        timeout: timeoutMs,
        headers: {
          "Accept-Encoding": "identity",
          "User-Agent": "StardewValleyServerKitAdmin/1.0",
        },
      },
      (res) => {
        const statusCode = res.statusCode || 0;
        const location = res.headers.location;
        if (statusCode >= 300 && statusCode < 400 && location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error("下载重定向次数过多。"));
            return;
          }
          const nextUrl = new URL(location, parsed).toString();
          downloadFile(nextUrl, targetPath, { ...options, redirectsLeft: redirectsLeft - 1 }).then(resolve, reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          reject(httpStatusError("下载失败", statusCode, res.headers));
          return;
        }

        const contentLength = Number(res.headers["content-length"] || 0);
        if (contentLength > maxBytes) {
          res.resume();
          reject(new Error("下载文件超过 100 MB 限制。"));
          return;
        }

        const output = fs.createWriteStream(targetPath);
        let totalBytes = 0;
        let settled = false;

        function fail(error) {
          if (settled) return;
          settled = true;
          output.destroy();
          reject(error);
        }

        res.on("data", (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes > maxBytes) {
            req.destroy(new Error("下载文件超过 100 MB 限制。"));
          }
        });
        res.on("error", fail);
        output.on("error", fail);
        output.on("finish", () => {
          if (settled) return;
          settled = true;
          output.close(() => resolve({ bytes: totalBytes, finalUrl: parsed.toString() }));
        });
        res.pipe(output);
      },
    );

    req.on("timeout", () => req.destroy(new Error("下载超时。")));
    req.on("error", reject);
  });
}

async function requestJson(urlString, options = {}) {
  const body = await requestBuffer(urlString, {
    maxBytes: options.maxBytes || 5 * 1024 * 1024,
    timeoutMs: options.timeoutMs || 30000,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  try {
    return JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw new Error(`API 返回了无效 JSON：${error.message}`);
  }
}

function intPositive(value, name) {
  let parsed = value;
  if (typeof value !== "number") {
    const raw = String(value ?? "").trim();
    if (!/^\d+$/.test(raw)) {
      throw new Error(`${name} 必须是正整数。`);
    }
    parsed = Number(raw);
  }
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数。`);
  }
  return parsed;
}

async function nexusApiKey(state) {
  const env = await state.readEnvValue();
  const key = cleanText(env.NEXUS_API_KEY, 256, "");
  if (!key) {
    throw new Error("请先在配置页设置 Nexus API Key，或继续使用“从 URL 安装”。");
  }
  return key;
}

async function nexusApiRequest(state, pathname) {
  const key = await nexusApiKey(state);
  const cooldownMs = state.nexusRateLimitedUntil - state.nowMs();
  if (cooldownMs > 0) {
    throw normalizeNexusApiError({ statusCode: 429, retryAfterMs: cooldownMs, message: "HTTP 429" });
  }

  const requestOptions = {
    headers: {
      APIKEY: key,
      "Application-Name": "StardewValleyServerKit",
      "Application-Version": "1.0.0",
    },
  };
  let last429 = null;
  for (let attempt = 0; attempt <= NEXUS_API_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await state.nexusRequestJson(`${NEXUS_API_BASE}${pathname}`, requestOptions);
    } catch (error) {
      if (error?.statusCode !== 429) {
        throw normalizeNexusApiError(error);
      }
      last429 = error;
      if (attempt >= NEXUS_API_RETRY_ATTEMPTS) break;
      const retryAfterMs = Number(error.retryAfterMs || 0);
      if (retryAfterMs > NEXUS_API_RETRY_MAX_WAIT_MS) {
        state.nexusRateLimitedUntil = state.nowMs() + retryAfterMs;
        break;
      }
      await state.sleepMs(nexusRetryDelayMs(error, attempt));
    }
  }
  throw normalizeNexusApiError(last429);
}

function normalizeNexusApiError(error) {
  const message = error.message || String(error);
  if (error?.statusCode === 401 || error?.statusCode === 403 || /HTTP 401|HTTP 403/.test(message)) {
    throw new Error("Nexus API Key 无效、权限不足或账号不能访问该文件。");
  }
  if (error?.statusCode === 429 || /HTTP 429/.test(message)) {
    const retryAfterMs = Number(error?.retryAfterMs || 0);
    const waitText = retryAfterMs > 0 ? `，建议等待 ${formatWaitSeconds(retryAfterMs)}后再试` : "，请稍后再试";
    throw new Error(`Nexus API 请求过于频繁${waitText}；仍可改用“从 URL 安装”。`);
  }
  throw error;
}

async function ensureModsDir(state) {
  await fsp.mkdir(state.modsDir, { recursive: true });
}

async function readManifestFile(manifestPath) {
  const text = stripBom(await fsp.readFile(manifestPath, "utf8"));
  try {
    return JSON.parse(text);
  } catch (firstError) {
    try {
      return JSON.parse(stripJsonComments(text));
    } catch (_) {
      throw new Error(`manifest.json 解析失败：${path.basename(path.dirname(manifestPath))}：${firstError.message}`);
    }
  }
}

function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    const next = text[index + 1];
    if (inString) {
      output += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      output += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    output += ch;
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

async function readModManifest(modDir) {
  const manifestPath = path.join(modDir, "manifest.json");
  try {
    return await readManifestFile(manifestPath);
  } catch (error) {
    if (error.code === "ENOENT") return { parseError: "缺少 manifest.json" };
    return { parseError: error.message || String(error) };
  }
}

function shouldSkipModDirectory(directoryName) {
  const name = String(directoryName || "");
  return name.startsWith(".") || name === "__MACOSX";
}

function modRelativePath(rootDir, targetDir) {
  const relative = path.relative(path.resolve(rootDir), path.resolve(targetDir)).replace(/\\/g, "/");
  return relative === "." ? "" : relative;
}

function normalizeInstalledModDirectoryName(value) {
  const normalized = String(value || "").trim().replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes("\0") ||
    normalized.includes("//")
  ) {
    throw new Error("模组目录名无效。");
  }

  const parts = normalized.split("/");
  if (parts.length > 20 || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("模组目录名无效。");
  }
  return parts.join("/");
}

async function findInstalledModDirectories(state) {
  const root = path.resolve(state.modsDir);
  const mods = [];
  const stack = [{ dir: root, depth: 0 }];

  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > 20) continue;

    const entries = await fsp.readdir(dir, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === "manifest.json")) {
      const directoryName = modRelativePath(root, dir);
      if (directoryName) mods.push({ directoryName, modDir: dir });
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipModDirectory(entry.name)) continue;
      stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }

    if (mods.length > 500) {
      throw new Error("data/mods 下识别到的 Mod 过多，请清理后再刷新。");
    }
  }

  return mods;
}

async function listInstalledMods(state) {
  await fsp.mkdir(state.modsDir, { recursive: true });
  const entries = await findInstalledModDirectories(state);
  const mods = [];

  for (const entry of entries) {
    const { directoryName, modDir } = entry;
    const manifest = await readModManifest(modDir);
    const stat = await fsp.stat(modDir);
    const config = await configFileStat(path.join(modDir, "config.json"));

    mods.push({
      directoryName,
      name: cleanText(manifest?.Name, 120, directoryName),
      uniqueId: cleanText(manifest?.UniqueID || manifest?.UniqueId, 160, ""),
      version: cleanText(manifest?.Version, 64, ""),
      author: cleanText(manifest?.Author, 120, ""),
      description: cleanText(manifest?.Description, 240, ""),
      minimumApiVersion: cleanText(manifest?.MinimumApiVersion, 64, ""),
      entryDll: cleanText(manifest?.EntryDll, 120, ""),
      updateKeys: normalizeUpdateKeys(manifest?.UpdateKeys),
      hasManifest: Boolean(manifest && !manifest.parseError),
      manifestError: manifest?.parseError || "",
      hasConfig: config.exists,
      configSizeBytes: config.sizeBytes,
      configUpdatedAt: config.updatedAt,
      updatedAt: stat.mtime.toISOString(),
    });
  }

  mods.sort((a, b) => (
    a.name.localeCompare(b.name, "zh-Hans-CN") ||
    a.directoryName.localeCompare(b.directoryName, "zh-Hans-CN")
  ));
  return mods;
}

function normalizedNeedle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, " ")
    .trim();
}

function compactNeedle(value) {
  return normalizedNeedle(value).replace(/[^a-z0-9]+/g, "");
}

function modNeedles(mod) {
  const values = [
    mod.name,
    mod.uniqueId,
    mod.directoryName,
    path.basename(String(mod.directoryName || "")),
    ...(Array.isArray(mod.updateKeys) ? mod.updateKeys : []),
  ];
  const needles = [];
  for (const value of values) {
    const normalized = normalizedNeedle(value);
    if (normalized && normalized.length >= 3) needles.push(normalized);
    const compact = compactNeedle(value);
    if (compact && compact.length >= 5) needles.push(compact);
  }
  return [...new Set(needles)];
}

function stripComposeLogPrefix(line) {
  return String(line || "").replace(/^[A-Za-z0-9_.-]+(?:-\d+)?\s+\|\s*/, "");
}

function cleanSmapiLogLine(line) {
  return cleanText(
    stripComposeLogPrefix(line)
      .replace(/^\s*(?:\[[^\]]+\]\s*)?/, "")
      .replace(/^\s*[-*]\s*/, "")
      .replace(/^\s*(?:INFO|WARN|ERROR)\s+SMAPI\s+/i, "")
      .replace(/^\s*(?:SMAPI|TRACE|DEBUG|INFO|WARN|ERROR)\s*[:|-]\s*/i, "")
      .trim(),
    420,
  );
}

function collectSmapiLoadLines(lines) {
  const loadedLines = [];
  const skippedLines = [];
  let loadedSummaryCount = null;
  let section = "";

  for (const rawLine of lines) {
    const line = stripComposeLogPrefix(rawLine);
    const loadedMatch = line.match(/\bLoaded\s+(\d+)\s+mods?\b/i);
    if (loadedMatch) {
      loadedSummaryCount = Number.parseInt(loadedMatch[1], 10);
      section = "loaded";
      continue;
    }
    if (/\bSkipped\s+mods?\b/i.test(line) || /\bcould not be added to your game\b/i.test(line)) {
      section = "skipped";
      continue;
    }
    if (/^\s*$/.test(line)) {
      section = "";
      continue;
    }

    const cleaned = cleanSmapiLogLine(line);
    const nextHeader = /\b(?:Loaded|Skipped|Found|Patched|Started)\s+\d+\b/i.test(line) ||
      /^(?:Loaded|Skipped|Found|Patched|Started|Launching|Game|Type)\b/i.test(cleaned) ||
      /^\s*(?:INFO|WARN|ERROR)\s+(?!SMAPI\b)/i.test(line);
    if (section === "loaded" && cleaned && !nextHeader) {
      if (cleaned) loadedLines.push(cleaned);
    } else if (section === "skipped" && !nextHeader) {
      if (cleaned) skippedLines.push(cleaned);
    } else if (nextHeader) {
      section = "";
    }
  }

  return { loadedSummaryCount, loadedLines, skippedLines };
}

function lineMatchesAnyNeedle(line, needles) {
  const normalizedLine = normalizedNeedle(line);
  const compactLine = compactNeedle(line);
  return needles.some((needle) => (
    normalizedLine.includes(needle) ||
    (needle.length >= 5 && compactLine.includes(needle.replace(/[^a-z0-9]+/g, "")))
  ));
}

function pickMatchingLine(lines, needles) {
  return lines.find((line) => lineMatchesAnyNeedle(line, needles)) || "";
}

function uniqueLogLines(lines, maxItems) {
  const result = [];
  const seen = new Set();
  for (const line of lines) {
    const cleaned = cleanSmapiLogLine(line);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= maxItems) break;
  }
  return result;
}

function isSpecificModProblemLine(line) {
  const cleaned = cleanSmapiLogLine(line);
  if (!cleaned) return false;
  return (
    /\bfailed\s+(?:loading|to\s+load|to\s+initialize)\b/i.test(cleaned) ||
    /\bcould\s+not\s+be\s+(?:added|loaded|initialized)\b/i.test(cleaned) ||
    /\b(?:missing\s+dependency|requires\s+.+not\s+installed)\b/i.test(cleaned) ||
    /\b(?:invalid|missing)\s+manifest\b/i.test(cleaned) ||
    /\bbecause\b.*\b(?:missing|empty\s+folder|invalid|failed|requires|not\s+installed)\b/i.test(cleaned)
  );
}

function buildModLoadReport(logText, installed = []) {
  const lines = stripAnsi(logText)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-1200);
  const smapiDetected = lines.some((line) => /\bSMAPI\b|\bLoaded\s+\d+\s+mods?\b|\bSkipped\s+mods?\b/i.test(line));
  const { loadedSummaryCount, loadedLines, skippedLines } = collectSmapiLoadLines(lines);
  const smapiErrorFailure = /\b(?:failed|exception|crash|could not|missing dependency|requires .* not installed|invalid|empty folder|skipped mods?)\b/i;
  const errorLines = uniqueLogLines(lines.filter((line) => (
    (/\bERROR\s+SMAPI\b/i.test(line) && smapiErrorFailure.test(line)) ||
    /\bSMAPI\b.*\b(error|exception|failed|crash)\b/i.test(line) ||
    /\b(mod|manifest|content pack|content patcher|dependency)\b.*\b(error|exception|failed|missing|invalid)\b/i.test(line)
  )), 24);
  const warningLines = uniqueLogLines(lines.filter((line) => (
    /\bWARN\s+SMAPI\b/i.test(line) ||
    /\b(missing dependency|requires .* not installed|no update keys|skipped)\b/i.test(line)
  )), 24);
  const skipped = uniqueLogLines([...skippedLines.filter(isSpecificModProblemLine), ...lines.filter((line) => (
    /\bSkipped\s+mods?\b/i.test(line) ||
    /\bcould not be added to your game\b/i.test(line) ||
    /\brequires .* not installed\b/i.test(line) ||
    /\bmissing dependency\b/i.test(line)
  ))], 24);

  const loadedTextLines = uniqueLogLines(loadedLines, 80);
  const problemLines = uniqueLogLines([
    ...skippedLines,
    ...lines,
  ].filter(isSpecificModProblemLine), 80);
  const byDirectory = {};
  const confirmedLoaded = [];
  const problemMods = [];
  const unconfirmedInstalled = [];

  for (const mod of installed) {
    const needles = modNeedles(mod);
    const loadedEvidence = pickMatchingLine(loadedTextLines, needles);
    const problemEvidence = pickMatchingLine(problemLines, needles);
    let state = "unconfirmed";
    let evidence = "";
    if (problemEvidence) {
      state = "problem";
      evidence = problemEvidence;
    } else if (loadedEvidence) {
      state = "loaded";
      evidence = loadedEvidence;
    }

    const item = {
      directoryName: mod.directoryName,
      name: mod.name,
      uniqueId: mod.uniqueId || "",
      state,
      evidence,
    };
    byDirectory[mod.directoryName] = item;
    if (state === "loaded") confirmedLoaded.push(item);
    else if (state === "problem") problemMods.push(item);
    else unconfirmedInstalled.push(item);
  }

  return {
    source: "recent-smapi-logs",
    logAvailable: lines.length > 0,
    smapiDetected,
    installedCount: installed.length,
    loadedSummaryCount,
    loadedNames: loadedTextLines,
    loadedCount: confirmedLoaded.length,
    confirmedLoaded,
    problemMods,
    unconfirmedInstalled,
    skipped,
    errors: errorLines,
    warnings: warningLines,
    byDirectory,
  };
}

function extractFetchUri(html) {
  const match = String(html || "").match(/fetchUri:\s*"([^"]+)"/);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function nexusInfo(modPages) {
  for (const page of Array.isArray(modPages) ? modPages : []) {
    const url = String(page?.Url || "");
    const match = url.match(/nexusmods\.com\/stardewvalley\/mods\/(\d+)/i);
    if (match) {
      return {
        nexusId: match[1],
        nexusUrl: `https://www.nexusmods.com/stardewvalley/mods/${match[1]}`,
      };
    }
  }
  return { nexusId: "", nexusUrl: "" };
}

function normalizeSmapiMod(raw) {
  const { nexusId, nexusUrl } = nexusInfo(raw?.ModPages);
  const uniqueIds = Array.isArray(raw?.Id)
    ? raw.Id.map((item) => cleanText(item, 160)).filter(Boolean)
    : [];
  const compatibility = raw?.Compatibility || {};
  const summary = compatibility.Summary
    ? stripHtml(compatibility.Summary)
    : "兼容最新版本，SMAPI 列表未标记问题。";

  return {
    name: cleanText(raw?.Name, 160, "未命名模组"),
    alternateNames: cleanText(raw?.AlternateNames, 240, ""),
    author: cleanText(raw?.Author, 120, ""),
    alternateAuthors: cleanText(raw?.AlternateAuthors, 240, ""),
    uniqueId: uniqueIds[0] || "",
    uniqueIds,
    status: cleanText(compatibility.Status, 64, "compatible"),
    summary: cleanText(summary, 260, ""),
    brokeIn: cleanText(stripHtml(compatibility.BrokeIn), 120, ""),
    nexusId,
    nexusUrl,
    sourceUrl: cleanText(raw?.SourceUrl, 260, ""),
    slug: cleanText(raw?.Slug, 160, ""),
    pageLinks: (Array.isArray(raw?.ModPages) ? raw.ModPages : [])
      .map((link) => ({
        text: cleanText(link?.Text, 80, "link"),
        url: cleanText(link?.Url, 260, ""),
      }))
      .filter((link) => link.url),
  };
}

async function fetchSmapiMods(state) {
  const now = Date.now();
  if (state.smapiCache.mods && now - state.smapiCache.fetchedAt < SMAPI_CACHE_TTL_MS) {
    return state.smapiCache.mods;
  }

  const page = (await requestBuffer(SMAPI_MODS_URL, {
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 30000,
  })).toString("utf8");
  const fetchUri = extractFetchUri(page);
  if (!fetchUri) {
    throw new Error("无法从 SMAPI 页面读取模组数据地址。");
  }

  const rawText = (await requestBuffer(fetchUri, {
    maxBytes: SMAPI_FETCH_MAX_BYTES,
    timeoutMs: 30000,
  })).toString("utf8");
  const rawMods = JSON.parse(stripBom(rawText));
  if (!Array.isArray(rawMods)) {
    throw new Error("SMAPI 模组数据格式异常。");
  }

  const mods = rawMods.map(normalizeSmapiMod);
  state.smapiCache = { fetchedAt: now, mods };
  return mods;
}

function modSearchRank(mod, query) {
  const fields = [
    mod.name,
    mod.alternateNames,
    mod.author,
    mod.alternateAuthors,
    mod.uniqueId,
    ...(mod.uniqueIds || []),
    mod.nexusId,
    mod.slug,
  ].map(normalizeSearchText);
  const combined = fields.join(" ");

  if (mod.nexusId && mod.nexusId === query) return 0;
  if (fields.some((field) => field === query)) return 1;
  if (fields.some((field) => field.startsWith(query))) return 2;
  if (combined.includes(query)) return 3;
  return 99;
}

async function searchMods(state, payload) {
  const query = normalizeSearchText(payload?.query);
  if (!query) {
    throw new Error("请输入要搜索的模组名称、UniqueID 或 Nexus ID。");
  }

  const mods = await fetchSmapiMods(state);
  const results = mods
    .map((mod) => ({ mod, rank: modSearchRank(mod, query) }))
    .filter((item) => item.rank < 99)
    .sort((a, b) => a.rank - b.rank || a.mod.name.localeCompare(b.mod.name, "zh-Hans-CN"))
    .slice(0, 30)
    .map((item) => item.mod);

  return {
    query,
    count: results.length,
    results,
    cachedAt: new Date(state.smapiCache.fetchedAt).toISOString(),
  };
}

function nexusFileGroup(file) {
  const id = Number(file?.category_id || file?.categoryId || 0);
  const name = String(file?.category_name || file?.categoryName || "").toUpperCase();
  if (id === 1 || name === "MAIN") return "main";
  if (id === 2 || name.includes("UPDATE") || name.includes("PATCH")) return "patch";
  if (id === 3 || name.includes("OPTION")) return "optional";
  if (id === 4 || name.includes("OLD")) return "old";
  return "other";
}

function fileCategoryRank(file) {
  const group = nexusFileGroup(file);
  const rank = NEXUS_FILE_GROUP_ORDER.indexOf(group);
  return rank === -1 ? NEXUS_FILE_GROUP_ORDER.length : rank;
}

function createNexusFileGroups(files) {
  const groups = Object.fromEntries(NEXUS_FILE_GROUP_ORDER.map((group) => [group, []]));
  for (const file of files) {
    groups[nexusFileGroup(file)].push(file);
  }
  return groups;
}

function pickRecommendedNexusFile(groups) {
  return groups.main.find((file) => file.isPrimary) ||
    groups.main[0] ||
    groups.patch[0] ||
    groups.optional[0] ||
    groups.other[0] ||
    groups.old[0] ||
    null;
}

function normalizeNexusFile(file) {
  const uploadedTimestamp = Number(file?.uploaded_timestamp || 0);
  const normalized = {
    fileId: Number(file?.file_id || 0),
    categoryId: Number(file?.category_id || 0),
    categoryName: cleanText(file?.category_name, 40, "UNKNOWN"),
    name: cleanText(stripHtml(file?.name), 160, "未命名文件"),
    description: cleanText(stripHtml(file?.description), 260, ""),
    version: cleanText(file?.version || file?.mod_version, 80, ""),
    modVersion: cleanText(file?.mod_version, 80, ""),
    fileName: cleanText(file?.file_name, 180, ""),
    sizeKb: Number(file?.size_kb || file?.size || 0),
    uploadedAt: uploadedTimestamp > 0 ? new Date(uploadedTimestamp * 1000).toISOString() : "",
    isPrimary: Boolean(file?.is_primary),
  };
  normalized.group = nexusFileGroup(normalized);
  return normalized;
}

async function getNexusModFiles(state, payload) {
  const nexusId = intPositive(payload?.nexusId || payload?.modId, "Nexus mod ID");
  const cacheKey = String(nexusId);
  const cached = state.nexusFileCache.get(cacheKey);
  if (cached && state.nowMs() - cached.fetchedAt < NEXUS_FILE_CACHE_TTL_MS) {
    return {
      ...cached.result,
      cached: true,
    };
  }

  const data = await nexusApiRequest(state, `/games/${NEXUS_GAME_DOMAIN}/mods/${nexusId}/files`);
  const files = (Array.isArray(data?.files) ? data.files : [])
    .map(normalizeNexusFile)
    .filter((file) => file.fileId > 0)
    .sort((a, b) => fileCategoryRank(a) - fileCategoryRank(b) || Number(b.isPrimary) - Number(a.isPrimary) || String(b.uploadedAt).localeCompare(a.uploadedAt));
  const groups = createNexusFileGroups(files);
  const recommendedFile = pickRecommendedNexusFile(groups);

  const result = {
    nexusId: String(nexusId),
    files,
    groups,
    recommendedFileId: recommendedFile ? String(recommendedFile.fileId) : "",
    recommendedFileName: recommendedFile ? recommendedFile.name : "",
    fileUpdates: Array.isArray(data?.file_updates) ? data.file_updates.slice(0, 30) : [],
    apiKeyRequired: true,
  };
  state.nexusFileCache.set(cacheKey, { fetchedAt: state.nowMs(), result });
  return result;
}

async function getNexusDownloadLinks(state, payload) {
  const nexusId = intPositive(payload?.nexusId || payload?.modId, "Nexus mod ID");
  const fileId = intPositive(payload?.fileId, "Nexus file ID");
  const links = await nexusApiRequest(state, `/games/${NEXUS_GAME_DOMAIN}/mods/${nexusId}/files/${fileId}/download_link`);
  const list = (Array.isArray(links) ? links : [links])
    .map((link) => ({
      name: cleanText(link?.name || link?.short_name, 120, "Nexus"),
      url: cleanText(link?.URI || link?.uri || link?.url, 2000, ""),
    }))
    .filter((link) => link.url);

  if (!list.length) {
    throw new Error("Nexus 没有返回可用下载链接，请改用“从 URL 安装”。");
  }

  return {
    nexusId: String(nexusId),
    fileId: String(fileId),
    links: list,
  };
}

async function installModFromNexusFile(state, payload) {
  const nexusId = intPositive(payload?.nexusId || payload?.modId, "Nexus mod ID");
  const fileId = intPositive(payload?.fileId, "Nexus file ID");
  const displayName = cleanText(payload?.displayName, 120, "");
  const { links } = await getNexusDownloadLinks(state, { nexusId, fileId });
  let lastError = null;

  for (const link of links) {
    try {
      return await installModFromUrl(state, {
        url: link.url,
        displayName,
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Nexus 文件下载失败，请改用“从 URL 安装”。");
}

function safeDirectoryName(value, fallback) {
  let name = cleanText(value, 80, fallback || "mod")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!name || name === "." || name === "..") name = fallback || "mod";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) {
    name = `${name}_mod`;
  }
  return name.slice(0, 80);
}

function resolveInstalledModDirectory(state, directoryName) {
  const name = normalizeInstalledModDirectoryName(directoryName);
  const root = path.resolve(state.modsDir);
  const target = path.resolve(root, ...name.split("/"));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("模组目录必须位于 data/mods 下。");
  }
  return { name, target };
}

async function resolveExistingInstalledModDirectory(state, directoryName) {
  const resolved = resolveInstalledModDirectory(state, directoryName);
  const rootReal = await fsp.realpath(state.modsDir);
  const stat = await fsp.lstat(resolved.target).catch((error) => {
    if (error.code === "ENOENT") {
      throw new Error(`Mod directory does not exist: ${resolved.name}`);
    }
    throw error;
  });
  if (stat.isSymbolicLink()) {
    throw new Error("Mod directory must not be a symbolic link.");
  }
  if (!stat.isDirectory()) {
    throw new Error(`Mod target is not a directory: ${resolved.name}`);
  }
  const targetReal = await fsp.realpath(resolved.target);
  assertInsideRoot(rootReal, targetReal, "Mod directory must stay inside data/mods.");
  return resolved;
}

function formatBackupTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
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

async function existingPath(pathname) {
  try {
    await fsp.access(pathname);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function backupExistingTarget(state, target, directoryName) {
  if (!(await existingPath(target))) return "";

  await fsp.mkdir(state.modBackupDir, { recursive: true });
  const timestamp = formatBackupTimestamp();
  const safeName = safeDirectoryName(directoryName, "mod");
  for (let index = 0; index < 100; index += 1) {
    const suffix = index ? `-${index}` : "";
    const backupName = `${safeName}.bak-${timestamp}${suffix}`;
    const backupPath = path.join(state.modBackupDir, backupName);
    if (await existingPath(backupPath)) continue;
    await fsp.rename(target, backupPath);
    return backupName;
  }

  throw new Error("无法为已有模组目录生成备份名称。");
}

async function configFileStat(configPath) {
  try {
    const stat = await fsp.stat(configPath);
    if (!stat.isFile()) {
      return { exists: false, sizeBytes: 0, updatedAt: "" };
    }
    return {
      exists: true,
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, sizeBytes: 0, updatedAt: "" };
    throw error;
  }
}

function resolveInstalledModConfigPath(state, directoryName) {
  const resolved = resolveInstalledModDirectory(state, directoryName);
  return {
    ...resolved,
    configPath: path.join(resolved.target, "config.json"),
  };
}

async function resolveExistingInstalledModConfigPath(state, directoryName) {
  const resolved = await resolveExistingInstalledModDirectory(state, directoryName);
  return {
    ...resolved,
    configPath: path.join(resolved.target, "config.json"),
  };
}

async function assertRegularConfigFile(configPath, directoryName) {
  const stat = await fsp.lstat(configPath).catch((error) => {
    if (error.code === "ENOENT") {
      throw new Error(`Mod ${directoryName} does not have config.json yet. Start the server once so the mod can generate it.`);
    }
    throw error;
  });
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("config.json must be a regular file directly inside the mod directory.");
  }
  if (stat.size > MOD_CONFIG_MAX_BYTES) {
    throw new Error("config.json is larger than 1 MB. Edit it on the server manually.");
  }
  return stat;
}

function normalizeModConfigText(text) {
  let parsed;
  try {
    parsed = JSON.parse(stripBom(String(text || "")));
  } catch (error) {
    throw new Error(`config.json is not valid JSON: ${error.message}`);
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

async function backupExistingConfig(state, configPath, directoryName) {
  if (!(await existingPath(configPath))) return "";

  await fsp.mkdir(state.modConfigBackupDir, { recursive: true });
  const timestamp = formatBackupTimestamp();
  const safeName = safeDirectoryName(directoryName, "mod");
  for (let index = 0; index < 100; index += 1) {
    const suffix = index ? `-${index}` : "";
    const backupName = `${safeName}.config-${timestamp}${suffix}.json`;
    const backupPath = path.join(state.modConfigBackupDir, backupName);
    if (await existingPath(backupPath)) continue;
    await fsp.copyFile(configPath, backupPath);
    return backupName;
  }

  throw new Error("Could not create a backup name for the mod config.");
}

async function assertZipMagic(zipPath) {
  const handle = await fsp.open(zipPath, "r");
  try {
    const buffer = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new Error("下载文件不是有效的 zip 压缩包。");
    }
  } finally {
    await handle.close();
  }
}

function zipModeFromExternalAttributes(externalAttributes) {
  return (externalAttributes >>> 16) & 0xffff;
}

function assertSafeZipEntryName(name) {
  const normalized = String(name || "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0")) {
    throw new Error("Zip archive contains an invalid entry name.");
  }
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error("Zip archive contains an absolute path.");
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.includes("..")) {
    throw new Error("Zip archive contains a path traversal entry.");
  }
  if (parts.length > ZIP_MAX_DEPTH) {
    throw new Error("Zip archive contains entries nested too deeply.");
  }
}

async function inspectZipArchive(zipPath) {
  const stat = await fsp.stat(zipPath);
  if (stat.size < 22) {
    throw new Error("Zip archive is too small to be valid.");
  }
  const tailLength = Math.min(stat.size, ZIP_EOCD_MAX_SEARCH_BYTES);
  const handle = await fsp.open(zipPath, "r");
  try {
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, stat.size - tailLength);

    let eocdOffset = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50) {
        eocdOffset = index;
        break;
      }
    }
    if (eocdOffset === -1) {
      throw new Error("Zip archive central directory was not found.");
    }

    const diskNumber = tail.readUInt16LE(eocdOffset + 4);
    const centralDirectoryDisk = tail.readUInt16LE(eocdOffset + 6);
    const entriesOnDisk = tail.readUInt16LE(eocdOffset + 8);
    const totalEntries = tail.readUInt16LE(eocdOffset + 10);
    const centralDirectorySize = tail.readUInt32LE(eocdOffset + 12);
    const centralDirectoryOffset = tail.readUInt32LE(eocdOffset + 16);
    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) {
      throw new Error("Multi-disk zip archives are not supported.");
    }
    if (
      totalEntries === 0xffff ||
      centralDirectorySize === 0xffffffff ||
      centralDirectoryOffset === 0xffffffff
    ) {
      throw new Error("Zip64 mod archives are not supported by the web installer.");
    }
    if (totalEntries > ZIP_MAX_ENTRIES) {
      throw new Error(`Zip archive contains too many entries: ${totalEntries}.`);
    }
    if (centralDirectorySize > ZIP_CENTRAL_DIRECTORY_MAX_BYTES) {
      throw new Error("Zip central directory is too large.");
    }
    if (centralDirectoryOffset + centralDirectorySize > stat.size) {
      throw new Error("Zip central directory points outside the archive.");
    }

    const centralDirectory = Buffer.alloc(centralDirectorySize);
    await handle.read(centralDirectory, 0, centralDirectorySize, centralDirectoryOffset);
    let offset = 0;
    let uncompressedBytes = 0;
    for (let index = 0; index < totalEntries; index += 1) {
      if (offset + 46 > centralDirectory.length || centralDirectory.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error("Zip central directory is malformed.");
      }

      const compressedSize = centralDirectory.readUInt32LE(offset + 20);
      const uncompressedSize = centralDirectory.readUInt32LE(offset + 24);
      const fileNameLength = centralDirectory.readUInt16LE(offset + 28);
      const extraLength = centralDirectory.readUInt16LE(offset + 30);
      const commentLength = centralDirectory.readUInt16LE(offset + 32);
      const entryDisk = centralDirectory.readUInt16LE(offset + 34);
      const externalAttributes = centralDirectory.readUInt32LE(offset + 38);
      const nameStart = offset + 46;
      const nextOffset = nameStart + fileNameLength + extraLength + commentLength;
      if (nextOffset > centralDirectory.length) {
        throw new Error("Zip central directory entry is truncated.");
      }
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
        throw new Error("Zip64 mod archives are not supported by the web installer.");
      }
      if (entryDisk !== 0) {
        throw new Error("Multi-disk zip archives are not supported.");
      }

      const entryName = centralDirectory.slice(nameStart, nameStart + fileNameLength).toString("utf8");
      assertSafeZipEntryName(entryName);
      const mode = zipModeFromExternalAttributes(externalAttributes);
      if ((mode & 0o170000) === 0o120000) {
        throw new Error("Zip archive contains symbolic links.");
      }
      if (!entryName.endsWith("/")) {
        uncompressedBytes += uncompressedSize;
        if (uncompressedBytes > ZIP_MAX_UNCOMPRESSED_BYTES) {
          throw new Error("Zip archive expands beyond the 300 MB safety limit.");
        }
      }
      offset = nextOffset;
    }

    return { entries: totalEntries, uncompressedBytes };
  } finally {
    await handle.close();
  }
}

async function unzipArchive(state, tempDir) {
  if (typeof state.dockerCommand !== "function") {
    throw new Error("Docker 执行器未初始化，无法解压模组。");
  }

  const script = [
    "set -eu",
    "rm -rf /work/extract",
    "mkdir -p /work/extract",
    "unzip -q /work/archive.zip -d /work/extract",
  ].join("\n");
  const result = await state.dockerCommand(
    ["run", "--rm", "-v", `${tempDir}:/work`, "alpine:3.20", "sh", "-c", script],
    { timeoutMs: 120000 },
  );
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || "模组压缩包解压失败。");
  }
}

function assertInsideRoot(rootDir, targetPath, message) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(message);
  }
  return target;
}

async function findManifestFiles(rootDir) {
  const manifests = [];
  const stack = [{ dir: rootDir, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > 20) continue;
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__MACOSX") continue;
        stack.push({ dir: entryPath, depth: depth + 1 });
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === "manifest.json") {
        manifests.push(assertInsideRoot(rootDir, entryPath, "压缩包内 manifest.json 路径无效。"));
      }
    }
    if (manifests.length > 80) {
      throw new Error("压缩包内 manifest.json 过多，请拆分后再安装。");
    }
  }
  return manifests;
}

async function copyDirectory(sourceDir, targetDir, sourceRoot = sourceDir) {
  sourceDir = assertInsideRoot(sourceRoot, sourceDir, "模组源目录必须位于解压目录内。");
  const stat = await fsp.lstat(sourceDir);
  if (!stat.isDirectory()) {
    throw new Error("模组源目录无效。");
  }

  await fsp.mkdir(targetDir, { recursive: true });
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("压缩包包含符号链接，已拒绝安装。");
    }
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath, sourceRoot);
    } else if (entry.isFile()) {
      await fsp.copyFile(sourcePath, targetPath);
    }
  }
}

function uniqueDirectoryName(baseName, usedNames) {
  let name = baseName;
  for (let index = 2; usedNames.has(name.toLowerCase()); index += 1) {
    name = safeDirectoryName(`${baseName}-${index}`, baseName);
  }
  usedNames.add(name.toLowerCase());
  return name;
}

function uploadedArchiveFromPayload(payload) {
  const fileName = cleanText(payload?.fileName, 180, "");
  if (!fileName || !/\.zip$/i.test(fileName)) {
    throw new Error("请选择 .zip 格式的本地模组压缩包。");
  }

  const buffer = Buffer.isBuffer(payload?.buffer) ? payload.buffer : Buffer.alloc(0);
  if (!buffer.length) {
    throw new Error("上传文件内容为空。");
  }
  if (buffer.length > MOD_DOWNLOAD_MAX_BYTES) {
    throw new Error("上传文件超过 100 MB 限制。");
  }

  return { fileName, buffer };
}

async function installModArchive(state, options) {
  const tempDir = options.tempDir;
  const zipPath = options.zipPath;
  const displayName = cleanText(options.displayName, 120, "");
  const bytes = Number.isFinite(options.bytes) ? options.bytes : 0;
  const extractDir = path.join(tempDir, "extract");
  let stagingRoot = "";

  try {
    await ensureModsDir(state);
    await assertZipMagic(zipPath);
    await inspectZipArchive(zipPath);
    await unzipArchive(state, tempDir);

    const manifests = await findManifestFiles(extractDir);
    if (!manifests.length) {
      throw new Error("压缩包内没有找到 manifest.json，无法识别 SMAPI 模组。");
    }

    stagingRoot = await fsp.mkdtemp(path.join(state.modsDir, ".installing-"));
    const plans = [];
    const usedNames = new Set();
    for (const manifestPath of manifests) {
      assertInsideRoot(extractDir, manifestPath, "压缩包内 manifest.json 路径无效。");
      const manifest = await readManifestFile(manifestPath);
      const sourceDir = path.dirname(manifestPath);
      const baseName = safeDirectoryName(manifest?.Name || manifest?.UniqueID || manifest?.UniqueId, displayName || path.basename(sourceDir));
      const directoryName = uniqueDirectoryName(baseName, usedNames);
      const stagingDir = path.join(stagingRoot, directoryName);
      const targetDir = path.join(state.modsDir, directoryName);
      await copyDirectory(sourceDir, stagingDir, extractDir);
      plans.push({
        directoryName,
        targetDir,
        stagingDir,
        manifest,
      });
    }

    const installed = [];
    for (const plan of plans) {
      const { directoryName, targetDir, stagingDir, manifest } = plan;
      const backupName = await backupExistingTarget(state, targetDir, directoryName);
      try {
        await fsp.rename(stagingDir, targetDir);
      } catch (error) {
        if (backupName && !(await existingPath(targetDir))) {
          await fsp.rename(path.join(state.modBackupDir, backupName), targetDir).catch(() => {});
        }
        throw error;
      }

      installed.push({
        directoryName,
        name: cleanText(manifest?.Name, 120, directoryName),
        uniqueId: cleanText(manifest?.UniqueID || manifest?.UniqueId, 160, ""),
        version: cleanText(manifest?.Version, 64, ""),
        author: cleanText(manifest?.Author, 120, ""),
        backupName,
      });
    }

    return {
      installed,
      installedCount: installed.length,
      bytes,
      restartRequired: true,
      message: `已安装 ${installed.length} 个模组，重启服务端后生效。`,
      allInstalled: await listInstalledMods(state),
    };
  } finally {
    if (stagingRoot) {
      await fsp.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function installModFromUrl(state, payload) {
  const downloadUrl = assertHttpsUrl(payload?.url, { checkDownloadHost: true }).toString();
  const displayName = cleanText(payload?.displayName, 120, "");
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "sdv-mod-"));
  const zipPath = path.join(tempDir, "archive.zip");

  try {
    const download = await downloadFile(downloadUrl, zipPath, {
      maxBytes: MOD_DOWNLOAD_MAX_BYTES,
      timeoutMs: MOD_DOWNLOAD_TIMEOUT_MS,
    });
    return await installModArchive(state, {
      tempDir,
      zipPath,
      displayName,
      bytes: download.bytes,
    });
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function installModFromUpload(state, payload) {
  const { fileName, buffer } = uploadedArchiveFromPayload(payload);
  const displayName = cleanText(payload?.displayName, 120, "") || safeDirectoryName(fileName.replace(/\.zip$/i, ""), "mod");
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "sdv-mod-upload-"));
  const zipPath = path.join(tempDir, "archive.zip");

  try {
    await fsp.writeFile(zipPath, buffer);
    return await installModArchive(state, {
      tempDir,
      zipPath,
      displayName,
      bytes: buffer.length,
    });
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function deleteInstalledMod(state, payload) {
  await ensureModsDir(state);
  const { name, target } = await resolveExistingInstalledModDirectory(state, payload?.directoryName);
  const stat = await fsp.stat(target).catch((error) => {
    if (error.code === "ENOENT") throw new Error(`模组目录不存在：${name}`);
    throw error;
  });
  if (!stat.isDirectory()) {
    throw new Error(`目标不是模组目录：${name}`);
  }

  const backupName = await backupExistingTarget(state, target, name);
  return {
    deleted: name,
    backupName,
    restartRequired: true,
    message: `已删除模组 ${name}，删除前备份：${backupName}，重启服务端后生效。`,
    allInstalled: await listInstalledMods(state),
  };
}

async function readModConfig(state, payload) {
  await ensureModsDir(state);
  const { name, configPath } = await resolveExistingInstalledModConfigPath(state, payload?.directoryName);
  const stat = await assertRegularConfigFile(configPath, name);
  const text = await fsp.readFile(configPath, "utf8");
  return {
    directoryName: name,
    fileName: "config.json",
    text,
    sizeBytes: stat.size,
    updatedAt: stat.mtime.toISOString(),
  };
}

async function saveModConfig(state, payload) {
  await ensureModsDir(state);
  const { name, configPath } = await resolveExistingInstalledModConfigPath(state, payload?.directoryName);
  await assertRegularConfigFile(configPath, name);
  const text = normalizeModConfigText(payload?.text);
  const backupName = await backupExistingConfig(state, configPath, name);
  await writeTextAtomic(configPath, text);
  const stat = await fsp.stat(configPath);
  return {
    directoryName: name,
    fileName: "config.json",
    text,
    backupName,
    sizeBytes: stat.size,
    updatedAt: stat.mtime.toISOString(),
    restartRequired: true,
    message: "Mod config saved. Restart the server for changes to take effect.",
  };
}

async function getModManagement(state, options = {}) {
  const installed = await listInstalledMods(state);
  const loadReport = buildModLoadReport(options.logText || "", installed);
  return {
    modsDir: path.relative(state.rootDir, state.modsDir).replace(/\\/g, "/"),
    installed,
    loadReport,
    sources: {
      primary: "SMAPI / Nexus Mods",
      steamWorkshopAvailable: false,
      steamWorkshopMessage:
        "Stardew Valley 的主流 SMAPI 模组不通过 Steam Workshop 分发；SteamCMD 目前只用于下载游戏本体。",
      searchUrls: {
        smapiCompatibility: SMAPI_MODS_URL,
        nexusSearch: "https://www.nexusmods.com/stardewvalley/search/",
        moddingGuide: "https://stardewvalleywiki.com/Modding:Player_Guide/Getting_Started",
      },
    },
    guidance: [
      "新增或升级 Mod 前先创建存档备份。",
      "可先搜索 SMAPI 兼容列表，再从 Nexus 或 GitHub 复制 zip 下载 URL 交给面板安装。",
      "新增、升级或删除 Mod 后需要重启服务端，SMAPI 才会重新加载。",
      "已有存档通常可以继续加 Mod，但大型内容、地图、作物、NPC 或改存档结构的 Mod 风险更高。",
    ],
  };
}

function createModService(options) {
  const rootDir = path.resolve(options.rootDir);
  const state = {
    rootDir,
    modsDir: path.join(rootDir, "data", "mods"),
    modBackupDir: path.join(rootDir, "backups", "mods"),
    modConfigBackupDir: path.join(rootDir, "backups", "mod-configs"),
    dockerCommand: options.docker || null,
    readEnvValue: options.readEnv || (async () => ({})),
    nexusRequestJson: options.nexusRequestJson || requestJson,
    sleepMs: options.sleep || sleep,
    nowMs: options.now || (() => Date.now()),
    nexusRateLimitedUntil: 0,
    nexusFileCache: new Map(),
    smapiCache: {
      fetchedAt: 0,
      mods: null,
    },
  };

  return {
    ensureModsDir: () => ensureModsDir(state),
    getModManagement: (options) => getModManagement(state, options),
    searchMods: (payload) => searchMods(state, payload),
    getNexusModFiles: (payload) => getNexusModFiles(state, payload),
    installModFromUrl: (payload) => installModFromUrl(state, payload),
    installModFromUpload: (payload) => installModFromUpload(state, payload),
    installModFromNexusFile: (payload) => installModFromNexusFile(state, payload),
    deleteInstalledMod: (payload) => deleteInstalledMod(state, payload),
    readModConfig: (payload) => readModConfig(state, payload),
    saveModConfig: (payload) => saveModConfig(state, payload),
  };
}

module.exports = {
  createModService,
  __test: {
    createNexusFileGroups,
    fileCategoryRank,
    formatWaitSeconds,
    intPositive,
    isAllowedDownloadHost,
    shouldSkipModDirectory,
    assertInsideRoot,
    assertSafeZipEntryName,
    inspectZipArchive,
    stripJsonComments,
    uploadedArchiveFromPayload,
    nexusFileGroup,
    nexusRetryDelayMs,
    normalizeNexusFile,
    normalizeNexusApiError,
    normalizeModConfigText,
    parseRetryAfterMs,
    pickRecommendedNexusFile,
    buildModLoadReport,
    collectSmapiLoadLines,
  },
};
