"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");

let ROOT_DIR = "";
let MODS_DIR = "";

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function cleanText(value, maxLength, fallback = "") {
  const next = String(value || "").trim();
  if (!next) return fallback;
  return next.slice(0, maxLength);
}

async function ensureModsDir() {
  await fsp.mkdir(MODS_DIR, { recursive: true });
}

async function readModManifest(modDir) {
  const manifestPath = path.join(modDir, "manifest.json");
  try {
    return JSON.parse(stripBom(await fsp.readFile(manifestPath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return { parseError: "缺少 manifest.json" };
    return { parseError: error.message || String(error) };
  }
}

function normalizeUpdateKeys(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

async function listInstalledMods() {
  await fsp.mkdir(MODS_DIR, { recursive: true });
  const entries = await fsp.readdir(MODS_DIR, { withFileTypes: true });
  const mods = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directoryName = entry.name;
    const modDir = path.join(MODS_DIR, directoryName);
    const manifest = await readModManifest(modDir);
    const stat = await fsp.stat(modDir);

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
      updatedAt: stat.mtime.toISOString(),
    });
  }

  mods.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  return mods;
}

async function getModManagement() {
  const installed = await listInstalledMods();
  return {
    modsDir: path.relative(ROOT_DIR, MODS_DIR).replace(/\\/g, "/"),
    installed,
    sources: {
      primary: "SMAPI / Nexus Mods",
      steamWorkshopAvailable: false,
      steamWorkshopMessage:
        "Stardew Valley 的主流 SMAPI 模组不通过 Steam Workshop 分发；SteamCMD 目前只用于下载游戏本体。",
      searchUrls: {
        smapiCompatibility: "https://smapi.io/mods",
        nexusSearch: "https://www.nexusmods.com/stardewvalley/search/",
        moddingGuide: "https://stardewvalleywiki.com/Modding:Player_Guide/Getting_Started",
      },
    },
    guidance: [
      "新增或升级 Mod 前先创建存档备份。",
      "把 SMAPI Mod 解压到 data/mods 后重启服务端才会生效。",
      "已有存档通常可以继续加 Mod，但大型内容、地图、作物、NPC 或改存档结构的 Mod 风险更高。",
    ],
  };
}

function createModService(options) {
  ROOT_DIR = options.rootDir;
  MODS_DIR = path.join(ROOT_DIR, "data", "mods");
  return { ensureModsDir, getModManagement };
}

module.exports = { createModService };
