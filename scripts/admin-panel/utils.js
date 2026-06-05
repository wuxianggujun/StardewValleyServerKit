"use strict";

const os = require("node:os");
const path = require("node:path");

const SAVE_NAME_PATTERN = /^[\p{L}\p{N}_.-]+$/u;
const BACKUP_ARCHIVE_PATTERN = /^saves-\d{8}-\d{6}\.tar\.gz$/;

const NEW_GAME_ONLY_SETTING_PATHS = [
  ["Game", "FarmName"],
  ["Game", "FarmType"],
  ["Game", "ProfitMargin"],
  ["Game", "StartingCabins"],
  ["Game", "SpawnMonstersAtNight"],
];

function stripAnsi(value) {
  return value.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "");
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

function validateSaveName(value) {
  const saveName = String(value || "").trim();
  if (!SAVE_NAME_PATTERN.test(saveName) || saveName === "." || saveName === "..") {
    throw new Error("Save name is invalid.");
  }
  return saveName;
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

module.exports = {
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
};
