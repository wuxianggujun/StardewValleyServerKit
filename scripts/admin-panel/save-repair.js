"use strict";

const crypto = require("node:crypto");

const CABIN_BUILDING_TYPES = new Set(["Cabin", "Log Cabin", "Plank Cabin", "Stone Cabin"]);
const STANDARD_FARM_TYPE = 0;
const STANDARD_FARM_CABIN_AREA = {
  minX: 8,
  minY: 16,
  maxX: 72,
  maxY: 58,
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function replaceOrInsertXmlTagValue(xml, tagName, value, insertAfterTagName) {
  const source = String(xml || "");
  const replacement = `<${tagName}>${escapeXmlText(value)}</${tagName}>`;
  const existing = new RegExp(`<${escapeRegExp(tagName)}\\s*/>|<${escapeRegExp(tagName)}>[^]*?<\\/${escapeRegExp(tagName)}>`);
  if (existing.test(source)) return source.replace(existing, replacement);
  if (insertAfterTagName) {
    const anchor = new RegExp(`(<${escapeRegExp(insertAfterTagName)}\\s*/>|<${escapeRegExp(insertAfterTagName)}>[^]*?<\\/${escapeRegExp(insertAfterTagName)}>)`);
    if (anchor.test(source)) return source.replace(anchor, `$1${replacement}`);
  }
  return `${source}${replacement}`;
}

function replaceOrInsertRawXmlTagValue(xml, tagName, rawValue, insertAfterTagName) {
  const source = String(xml || "");
  const replacement = `<${tagName}>${rawValue}</${tagName}>`;
  const existing = new RegExp(`<${escapeRegExp(tagName)}\\s*/>|<${escapeRegExp(tagName)}>[^]*?<\\/${escapeRegExp(tagName)}>`);
  if (existing.test(source)) return source.replace(existing, replacement);
  if (insertAfterTagName) {
    const anchor = new RegExp(`(<${escapeRegExp(insertAfterTagName)}\\s*/>|<${escapeRegExp(insertAfterTagName)}>[^]*?<\\/${escapeRegExp(insertAfterTagName)}>)`);
    if (anchor.test(source)) return source.replace(anchor, `$1${replacement}`);
  }
  return `${source}${replacement}`;
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

function cabinReservedRect(rect) {
  return {
    x: rect.x - 1,
    y: rect.y - 1,
    width: rect.width + 2,
    height: rect.height + 5,
  };
}

function pointInRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

function pointInAnyRect(point, rects) {
  return rects.some((rect) => pointInRect(point, rect));
}

function readSaveFarmType(xml) {
  return xmlTagNumber(xml, "whichFarm");
}

function cabinPlacementPolicy(farmType) {
  if (farmType === STANDARD_FARM_TYPE) {
    return {
      useSafeAreaForNewCabins: true,
      area: STANDARD_FARM_CABIN_AREA,
    };
  }
  return {
    useSafeAreaForNewCabins: false,
    area: null,
  };
}

function safeCabinPlacementOrigin(sourceRect, policy) {
  if (!policy.useSafeAreaForNewCabins) {
    return { x: sourceRect.x, y: sourceRect.y };
  }
  const area = policy.area;
  return {
    x: Math.max(sourceRect.x, area.minX),
    y: sourceRect.y < area.minY
      ? Math.max(sourceRect.y + 10, area.minY)
      : sourceRect.y,
  };
}

function findCabinPlacement(sourceBlock, occupiedRects, policy) {
  const sourceRect = readBuildingRect(sourceBlock) || { x: 0, y: 0, width: 5, height: 3 };
  const stepX = Math.max(sourceRect.width + 1, 6);
  const stepY = Math.max(sourceRect.height + 3, 6);
  const origin = safeCabinPlacementOrigin(sourceRect, policy);
  const maxX = policy.area?.maxX;
  const maxY = policy.area?.maxY;

  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      const candidate = {
        x: origin.x + col * stepX,
        y: origin.y + row * stepY,
        width: sourceRect.width,
        height: sourceRect.height,
      };
      if (candidate.x < 0 || candidate.y < 0) continue;
      if (maxX != null && candidate.x > maxX) continue;
      if (maxY != null && candidate.y > maxY) continue;
      if (occupiedRects.some((rect) => rectsOverlap(cabinReservedRect(candidate), rect))) continue;
      return candidate;
    }
  }

  return {
    x: maxX == null ? origin.x + stepX * (occupiedRects.length + 1) : Math.min(origin.x + stepX * (occupiedRects.length + 1), maxX),
    y: origin.y,
    width: sourceRect.width,
    height: sourceRect.height,
  };
}

function buildingReservedRect(building) {
  const rect = readBuildingRect(building.text || building);
  if (!rect) return null;
  return isCabinBuildingBlock(building.text || building) ? cabinReservedRect(rect) : rect;
}

function findNestedXmlBlocks(xml, tagName) {
  const blocks = [];
  const pattern = new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>|<\\/${escapeRegExp(tagName)}>`, "g");
  let depth = 0;
  let start = -1;
  let match = null;

  while ((match = pattern.exec(String(xml || ""))) !== null) {
    const token = match[0];
    if (token.startsWith("</")) {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        blocks.push({
          text: String(xml).slice(start, match.index + token.length),
          start,
          end: match.index + token.length,
        });
        start = -1;
      }
      continue;
    }

    if (/\/>$/.test(token)) continue;
    if (depth === 0) start = match.index;
    depth += 1;
  }

  return blocks;
}

function findChildXmlBlockRanges(xml, tagName) {
  const ranges = [];
  const stack = [];
  const pattern = new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>|<\\/${escapeRegExp(tagName)}>`, "g");
  let match = null;

  while ((match = pattern.exec(String(xml || ""))) !== null) {
    const token = match[0];
    if (token.startsWith("</")) {
      const start = stack.pop();
      if (start == null) continue;
      if (stack.length > 0) {
        ranges.push({ start, end: match.index + token.length });
      }
      continue;
    }
    if (!/\/>$/.test(token)) stack.push(match.index);
  }

  return ranges;
}

function indexInRanges(index, ranges) {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function findFarmLocationBlock(xml) {
  return findNestedXmlBlocks(xml, "GameLocation").find((block) => {
    const opening = block.text.match(/^<GameLocation\b[^>]*>/)?.[0] || "";
    return /\bxsi:type=(["'])Farm\1/.test(opening) || /<name>Farm<\/name>/.test(block.text);
  }) || null;
}

function xmlCoordinate(value) {
  const number = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(number) ? Math.floor(number) : null;
}

function vector2KeyPoint(xml) {
  const match = String(xml || "").match(
    /<key>\s*<Vector2>\s*<X>(-?\d+(?:\.\d+)?)<\/X>\s*<Y>(-?\d+(?:\.\d+)?)<\/Y>\s*<\/Vector2>\s*<\/key>/,
  );
  if (!match) return null;
  const x = xmlCoordinate(match[1]);
  const y = xmlCoordinate(match[2]);
  return x == null || y == null ? null : { x, y };
}

function tileRectFromBlock(xml) {
  const match = String(xml || "").match(
    /<(?:tile|tilePosition)>\s*<X>(-?\d+(?:\.\d+)?)<\/X>\s*<Y>(-?\d+(?:\.\d+)?)<\/Y>\s*<\/(?:tile|tilePosition)>/,
  );
  if (!match) return null;
  const x = xmlCoordinate(match[1]);
  const y = xmlCoordinate(match[2]);
  if (x == null || y == null) return null;
  return {
    x,
    y,
    width: xmlTagNumber(xml, "width") || 1,
    height: xmlTagNumber(xml, "height") || 1,
  };
}

function removeVectorKeyItemsInRects(xml, rects, ignoredRanges = []) {
  const replacements = [];
  for (const item of findNestedXmlBlocks(xml, "item")) {
    if (indexInRanges(item.start, ignoredRanges)) continue;
    const point = vector2KeyPoint(item.text);
    if (!point || !pointInAnyRect(point, rects)) continue;
    replacements.push({ start: item.start, end: item.end, text: "" });
  }
  return {
    xml: replacements.length ? applyTextReplacements(xml, replacements) : xml,
    removed: replacements.length,
  };
}

function removeTileBlocksInRects(xml, tagName, rects, ignoredRanges = []) {
  const replacements = [];
  for (const block of findNestedXmlBlocks(xml, tagName)) {
    if (indexInRanges(block.start, ignoredRanges)) continue;
    const rect = tileRectFromBlock(block.text);
    if (!rect || !rects.some((clearRect) => rectsOverlap(rect, clearRect))) continue;
    replacements.push({ start: block.start, end: block.end, text: "" });
  }
  return {
    xml: replacements.length ? applyTextReplacements(xml, replacements) : xml,
    removed: replacements.length,
  };
}

function clearFarmObstaclesForCabins(xml, cabinRects) {
  const cabinClearRects = (cabinRects || [])
    .filter(Boolean)
    .map((rect) => cabinReservedRect(rect));
  if (!cabinClearRects.length) return { xml, clearedFarmObstacles: 0 };

  const farm = findFarmLocationBlock(xml);
  if (!farm) return { xml, clearedFarmObstacles: 0 };

  let farmXml = farm.text;
  let clearedFarmObstacles = 0;
  const nestedLocationRanges = findChildXmlBlockRanges(farmXml, "GameLocation");
  const itemClear = removeVectorKeyItemsInRects(farmXml, cabinClearRects, nestedLocationRanges);
  farmXml = itemClear.xml;
  clearedFarmObstacles += itemClear.removed;

  for (const tagName of ["ResourceClump", "LargeTerrainFeature"]) {
    const tileIgnoredRanges = findChildXmlBlockRanges(farmXml, "GameLocation");
    const clear = removeTileBlocksInRects(farmXml, tagName, cabinClearRects, tileIgnoredRanges);
    farmXml = clear.xml;
    clearedFarmObstacles += clear.removed;
  }

  if (!clearedFarmObstacles) return { xml, clearedFarmObstacles: 0 };
  return {
    xml: `${xml.slice(0, farm.start)}${farmXml}${xml.slice(farm.end)}`,
    clearedFarmObstacles,
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

function replaceFirstUniqueMultiplayerId(xml, id) {
  if (!/<UniqueMultiplayerID>-?\d+<\/UniqueMultiplayerID>/.test(String(xml || ""))) {
    throw new Error("Farmhand data does not contain a multiplayer ID.");
  }
  return String(xml || "").replace(
    /(<UniqueMultiplayerID>)-?\d+(<\/UniqueMultiplayerID>)/,
    `$1${id}$2`,
  );
}

function clearFarmhandUserId(xml) {
  const source = String(xml || "");
  if (/<userID\b/.test(source)) {
    return source.replace(/<userID\s*\/>|<userID>[\s\S]*?<\/userID>/, "<userID />");
  }
  const anchor = /(<UniqueMultiplayerID>-?\d+<\/UniqueMultiplayerID>)/;
  return anchor.test(source) ? source.replace(anchor, "$1<userID />") : source;
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

function findTopLevelFarmhandsSection(xml) {
  const pattern = /<farmhands\s*\/>|<farmhands\b[^>]*>[\s\S]*?<\/farmhands>/;
  const match = String(xml || "").match(pattern);
  if (!match) return null;
  return {
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
    selfClosing: /\/>$/.test(match[0]),
  };
}

function findFarmerBlocks(xml) {
  const blocks = [];
  const pattern = /<Farmer\b[^>]*>[\s\S]*?<\/Farmer>/g;
  let match = null;
  while ((match = pattern.exec(String(xml || ""))) !== null) {
    blocks.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return blocks;
}

function uniqueFarmhands(farmhands) {
  const seen = new Set();
  return farmhands.filter((farmhand) => {
    const key = farmhand.id ? `id:${farmhand.id}` : `name:${String(farmhand.name || "").toLowerCase()}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function farmhandSummaryFromFarmer(farmerXml, fallbackId = "") {
  return {
    id: firstUniqueMultiplayerId(farmerXml) || fallbackId || "",
    name: xmlTagValue(farmerXml, "name") || "",
    isCustomized: xmlTagValue(farmerXml, "isCustomized") === "true",
  };
}

function extractFarmhands(xml) {
  const section = findTopLevelFarmhandsSection(xml);
  if (section && !section.selfClosing) {
    const farmhands = findFarmerBlocks(section.text)
      .map((farmer) => farmhandSummaryFromFarmer(farmer.text))
      .filter((farmhand) => farmhand.id || farmhand.name);
    if (farmhands.length) return uniqueFarmhands(farmhands);
  }

  const cabinFarmhands = findBuildingBlocks(xml)
    .filter((building) => isCabinBuildingBlock(building.text))
    .map((building) => {
      const embedded = cabinEmbeddedFarmerBlock(building.text);
      const reference = xmlTagValue(building.text, "farmhandReference") || firstUniqueMultiplayerId(building.text) || "";
      return embedded
        ? farmhandSummaryFromFarmer(embedded, reference)
        : { id: reference, name: "", isCustomized: false };
    })
    .filter((farmhand) => farmhand.id || farmhand.name);
  return uniqueFarmhands(cabinFarmhands);
}

function cabinEmbeddedFarmerBlock(cabinBlock) {
  const match = String(cabinBlock || "").match(/<farmhand\b[^>]*>\s*(<Farmer\b[^>]*>[\s\S]*?<\/Farmer>)\s*<\/farmhand>/);
  return match ? match[1] : null;
}

function setFarmhandHomeLocation(farmerXml, homeLocation) {
  return replaceOrInsertXmlTagValue(farmerXml, "homeLocation", homeLocation, "UniqueMultiplayerID");
}

function makeEmptyFarmhandForCabin(sourceFarmer, farmhandId, homeLocation) {
  let next = replaceFirstUniqueMultiplayerId(sourceFarmer, farmhandId);
  next = setFarmhandHomeLocation(next, homeLocation);
  next = clearFarmhandUserId(next);
  if (/<isCustomized\b/.test(next)) {
    next = replaceOrInsertRawXmlTagValue(next, "isCustomized", "false", "userID");
  }
  if (/<name\b/.test(next)) {
    next = replaceOrInsertXmlTagValue(next, "name", "Unnamed Farmhand", "UniqueMultiplayerID");
  }
  return next;
}

function applyTextReplacements(xml, replacements) {
  let next = xml;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    next = `${next.slice(0, replacement.start)}${replacement.text}${next.slice(replacement.end)}`;
  }
  return next;
}

function updateCabinFarmhandReferences(xml) {
  const existingIds = uniqueMultiplayerIds(xml);
  const buildings = findBuildingBlocks(xml);
  const cabinRefs = [];
  const replacements = [];
  let fixedCabinReferences = 0;

  for (const building of buildings) {
    if (!isCabinBuildingBlock(building.text)) continue;
    const uniqueName = xmlTagValue(building.text, "uniqueName") || uniqueCabinIndoorName("FarmHouse", crypto.randomUUID());
    const farmhandReference = xmlTagValue(building.text, "farmhandReference");
    const farmhandId = firstUniqueMultiplayerId(building.text) || farmhandReference || newUniqueMultiplayerId(existingIds);
    let next = building.text;
    if (/<UniqueMultiplayerID>-?\d+<\/UniqueMultiplayerID>/.test(next)) {
      next = replaceUniqueMultiplayerIds(next, farmhandId);
    }
    next = replaceOrInsertRawXmlTagValue(next, "farmhandReference", farmhandId, "uniqueName");
    if (/<owner\b/.test(next)) {
      next = replaceOrInsertRawXmlTagValue(next, "owner", farmhandId, "farmhandReference");
    }
    if (/<homeLocation\b/.test(next)) {
      next = setFarmhandHomeLocation(next, uniqueName);
    }
    if (next !== building.text) {
      replacements.push({ start: building.start, end: building.end, text: next });
      fixedCabinReferences += 1;
    }
    cabinRefs.push({ id: farmhandId, homeLocation: uniqueName });
  }

  return {
    xml: replacements.length ? applyTextReplacements(xml, replacements) : xml,
    cabinRefs,
    fixedCabinReferences,
  };
}

function ensureTopLevelFarmhands(xml, cabinRefs) {
  if (!cabinRefs.length) return { xml, addedFarmhands: 0, fixedFarmhandHomes: 0 };

  const section = findTopLevelFarmhandsSection(xml);
  const sectionText = section?.text || "<farmhands />";
  const farmers = section && !section.selfClosing ? findFarmerBlocks(section.text) : [];
  const existing = new Map();
  for (const farmer of farmers) {
    const id = firstUniqueMultiplayerId(farmer.text);
    if (id) existing.set(id, farmer);
  }

  let sourceFarmer = farmers[0]?.text || null;
  if (!sourceFarmer) {
    const sourceCabin = findBuildingBlocks(xml).find((building) => isCabinBuildingBlock(building.text));
    sourceFarmer = sourceCabin ? cabinEmbeddedFarmerBlock(sourceCabin.text) : null;
  }
  if (!sourceFarmer) {
    throw new Error("No farmhand template was found in the save.");
  }

  const replacements = [];
  const additions = [];
  let fixedFarmhandHomes = 0;

  for (const cabin of cabinRefs) {
    const farmer = existing.get(cabin.id);
    if (farmer) {
      const next = setFarmhandHomeLocation(farmer.text, cabin.homeLocation);
      if (next !== farmer.text) {
        replacements.push({ start: farmer.start, end: farmer.end, text: next });
        fixedFarmhandHomes += 1;
      }
      continue;
    }
    additions.push(makeEmptyFarmhandForCabin(sourceFarmer, cabin.id, cabin.homeLocation));
  }

  let nextSection = sectionText;
  if (replacements.length) {
    nextSection = applyTextReplacements(nextSection, replacements);
  }
  if (additions.length) {
    nextSection = section?.selfClosing
      ? `<farmhands>${additions.join("")}</farmhands>`
      : nextSection.replace(/<\/farmhands>$/, `${additions.join("")}</farmhands>`);
  }

  if (section) {
    return {
      xml: `${xml.slice(0, section.start)}${nextSection}${xml.slice(section.end)}`,
      addedFarmhands: additions.length,
      fixedFarmhandHomes,
    };
  }

  return {
    xml: xml.replace(/<\/SaveGame>\s*$/, `${nextSection}</SaveGame>`),
    addedFarmhands: additions.length,
    fixedFarmhandHomes,
  };
}

function repairCabinFarmhandLinks(xml) {
  const cabinUpdate = updateCabinFarmhandReferences(xml);
  const farmhandsUpdate = ensureTopLevelFarmhands(cabinUpdate.xml, cabinUpdate.cabinRefs);
  return {
    xml: farmhandsUpdate.xml,
    fixedCabinReferences: cabinUpdate.fixedCabinReferences,
    addedFarmhands: farmhandsUpdate.addedFarmhands,
    fixedFarmhandHomes: farmhandsUpdate.fixedFarmhandHomes,
  };
}

function cloneCabinBlock(sourceBlock, placement, existingIds) {
  const id = crypto.randomUUID();
  const farmhandId = newUniqueMultiplayerId(existingIds);
  let next = replaceXmlTagValue(sourceBlock, "tileX", placement.x);
  next = replaceXmlTagValue(next, "tileY", placement.y);
  next = replaceXmlTagValue(next, "id", id);
  const originalUniqueName = xmlTagValue(next, "uniqueName");
  const uniqueName = originalUniqueName == null ? uniqueCabinIndoorName("FarmHouse", id) : uniqueCabinIndoorName(originalUniqueName, id);
  if (originalUniqueName != null) {
    next = replaceXmlTagValue(next, "uniqueName", uniqueName);
  }
  if (/<UniqueMultiplayerID>-?\d+<\/UniqueMultiplayerID>/.test(next)) {
    next = replaceUniqueMultiplayerIds(next, farmhandId);
  }
  next = replaceOrInsertRawXmlTagValue(next, "farmhandReference", farmhandId, "uniqueName");
  if (/<owner\b/.test(next)) {
    next = replaceOrInsertRawXmlTagValue(next, "owner", farmhandId, "farmhandReference");
  }
  if (/<homeLocation\b/.test(next)) {
    next = setFarmhandHomeLocation(next, uniqueName);
  }
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

  const farmType = readSaveFarmType(currentXml);
  const placementPolicy = cabinPlacementPolicy(farmType);
  const movedCabins = 0;
  const clearedFarmObstacles = 0;

  if (cabins.length >= targetCabins) {
    const linkRepair = repairCabinFarmhandLinks(currentXml);
    return {
      xml: linkRepair.xml,
      changed:
        normalized.fixedFarmhandIds > 0 ||
        linkRepair.fixedCabinReferences > 0 ||
        linkRepair.addedFarmhands > 0 ||
        linkRepair.fixedFarmhandHomes > 0,
      currentCabins: cabins.length,
      cabinCount: cabins.length,
      addedCabins: 0,
      movedCabins,
      clearedFarmObstacles,
      fixedFarmhandIds: normalized.fixedFarmhandIds,
      fixedCabinReferences: linkRepair.fixedCabinReferences,
      addedFarmhands: linkRepair.addedFarmhands,
      fixedFarmhandHomes: linkRepair.fixedFarmhandHomes,
    };
  }
  if (!cabins.length) {
    throw new Error("No generated Cabin building was found in the new save.");
  }

  const existingIds = uniqueMultiplayerIds(currentXml);
  const sourceCabin = cabins[0].text;
  const occupiedRects = buildings.map((building) => buildingReservedRect(building)).filter(Boolean);
  const clones = [];
  const clonedRects = [];
  for (let count = cabins.length; count < targetCabins; count += 1) {
    const placement = findCabinPlacement(sourceCabin, occupiedRects, placementPolicy);
    clones.push(cloneCabinBlock(sourceCabin, placement, existingIds));
    clonedRects.push(placement);
    occupiedRects.push(cabinReservedRect(placement));
  }

  const insertAt = cabins[cabins.length - 1].end;
  const withClones = `${currentXml.slice(0, insertAt)}${clones.join("")}${currentXml.slice(insertAt)}`;
  const clear = clearFarmObstaclesForCabins(withClones, clonedRects);
  const linked = repairCabinFarmhandLinks(clear.xml);
  return {
    xml: linked.xml,
    changed: true,
    currentCabins: cabins.length,
    cabinCount: targetCabins,
    addedCabins: clones.length,
    movedCabins,
    clearedFarmObstacles: clear.clearedFarmObstacles,
    fixedFarmhandIds: normalized.fixedFarmhandIds,
    fixedCabinReferences: linked.fixedCabinReferences,
    addedFarmhands: linked.addedFarmhands,
    fixedFarmhandHomes: linked.fixedFarmhandHomes,
  };
}

function findPlayerBlock(xml) {
  const match = String(xml || "").match(/<player\b[^>]*>([\s\S]*?)<\/player>/);
  return match ? match[0] : null;
}

function extractSaveConfig(xml) {
  const playerBlock = findPlayerBlock(xml);
  return {
    farmName: xmlTagValue(xml, "farmName") || "",
    money: playerBlock ? (xmlTagNumber(playerBlock, "money") ?? 0) : 0,
    totalMoneyEarned: playerBlock ? (xmlTagNumber(playerBlock, "totalMoneyEarned") ?? 0) : 0,
    year: xmlTagNumber(xml, "year") ?? 1,
    currentSeason: xmlTagValue(xml, "currentSeason") || "spring",
    dayOfMonth: xmlTagNumber(xml, "dayOfMonth") ?? 1,
    timeOfDay: xmlTagNumber(xml, "timeOfDay") ?? 600,
    whichFarm: xmlTagNumber(xml, "whichFarm") ?? 0,
  };
}

function applySaveConfigEdits(xml, edits) {
  let result = xml;

  if (edits.farmName != null) {
    result = replaceXmlTagValue(result, "farmName", edits.farmName);
  }

  if (edits.money != null) {
    const playerBlock = findPlayerBlock(result);
    if (playerBlock) {
      const patched = replaceXmlTagValue(playerBlock, "money", String(edits.money));
      result = result.replace(playerBlock, patched);
    }
  }

  if (edits.year != null) {
    result = replaceXmlTagValue(result, "year", String(edits.year));
  }

  if (edits.currentSeason != null) {
    result = replaceXmlTagValue(result, "currentSeason", edits.currentSeason);
  }

  if (edits.dayOfMonth != null) {
    result = replaceXmlTagValue(result, "dayOfMonth", String(edits.dayOfMonth));
  }

  return result;
}

module.exports = { decodeXmlText, patchCabinsXml, extractSaveConfig, applySaveConfigEdits, extractFarmhands };
