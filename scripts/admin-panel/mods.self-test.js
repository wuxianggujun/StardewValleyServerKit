"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createModService, __test } = require("./mods");
const { PAGE } = require("./page");
const { I18N } = require("./i18n");

function assertThrowsMessage(fn, pattern) {
  assert.throws(fn, (error) => pattern.test(error.message));
}

async function pathExists(pathname) {
  try {
    await fsp.access(pathname);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || "");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((entry.externalAttributes || 0) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

async function main() {
  assert.equal(__test.intPositive("1915", "Nexus mod ID"), 1915);
  assert.equal(__test.intPositive(1915, "Nexus mod ID"), 1915);
  assertThrowsMessage(() => __test.intPositive("1915abc", "Nexus mod ID"), /正整数/);
  assertThrowsMessage(() => __test.intPositive("0", "Nexus mod ID"), /正整数/);
  assert.equal(__test.parseRetryAfterMs("2"), 2000);
  assert.equal(__test.parseRetryAfterMs("not-a-date"), 0);
  assert.equal(__test.nexusRetryDelayMs({ statusCode: 429, retryAfterMs: 20000 }, 0), 15000);
  assert.equal(__test.nexusRetryDelayMs({ statusCode: 429 }, 1), 2400);
  assert.equal(__test.formatWaitSeconds(1001), "2 秒");
  assert.equal(__test.isAllowedDownloadHost("supporter-files.nexus-cdn.com"), true);
  assert.equal(__test.isAllowedDownloadHost("evil-nexus-cdn.com"), false);
  assert.match(I18N["zh-CN"]["nexus.cacheSuffix"], /使用缓存/);
  assert.match(I18N["zh-CN"]["mods.notice"], /\/data\/Mods\/user/);
  assert.match(I18N["zh-CN"]["nexus.cachePrefix"], /未再次请求 Nexus API/);
  assert.equal(I18N.en["mods.installLocal"], "Install local file");
  assert.equal(I18N.en["mods.diagnose"], "Load check");
  assert.equal(I18N["zh-CN"]["mods.loadWarning"], "运行警告");
  assert.match(I18N["zh-CN"]["mods.diagnosed"], /Steam Auth 状态/);
  assert.doesNotMatch(PAGE, /id="refreshBtn"/);
  assert.doesNotMatch(PAGE, /querySelector\("#refreshBtn"\)/);
  assert.doesNotMatch(PAGE, /URLSearchParams\(location\.search\)/);
  assert.doesNotMatch(PAGE, /params\.get\("token"\)/);
  assert.doesNotMatch(PAGE, /<\/script><script>/i);
  const compose = await fsp.readFile(path.join(__dirname, "..", "..", "docker-compose.yml"), "utf8");
  assert.match(compose, /\.\/data\/mods:\/data\/Mods\/user/);
  assert.doesNotMatch(compose, /\.\/data\/mods:\/data\/Mods(?:\s|$)/);
  assert.match(PAGE, /safeExternalUrl/);
  assert.match(PAGE, /escapeHtml\(buttonText\)/);
  assert.match(PAGE, /id="languageSelect"/);
  assert.match(PAGE, /window\.SDV_I18N/);
  assert.match(PAGE, /data-i18n="mods\.installLocal"/);
  assert.match(PAGE, /id="diagnoseModsBtn"/);
  assert.match(PAGE, /id="modLoadSummary"/);
  assert.match(PAGE, /\/api\/diagnostics/);
  assert.match(PAGE, /Steam Auth:/);
  assert.match(PAGE, /report\.steamAuth/);
  assert.match(PAGE, /modLoadDetailHtml/);
  assert.match(PAGE, /\.field-8 \{ grid-column: span 8; \}/);
  assert.match(PAGE, /id="installModLocalDialog"/);
  assert.match(PAGE, /id="installModLocalForm"/);
  assert.match(PAGE, /id="modConfigDialog"/);
  assert.match(PAGE, /id="modConfigForm"/);
  assert.match(PAGE, /data-action="edit-mod-config"/);
  assert.match(PAGE, /\/api\/mods\/config/);
  assert.match(PAGE, /id="saveConfigRestartBtn"/);
  assert.match(PAGE, /id="saveEditConfigRestartBtn"/);
  assert.match(PAGE, /id="saveModConfigRestartBtn"/);
  assert.match(PAGE, /data-restart-after-save="true" data-i18n="action\.saveAndRestart"/);
  assert.match(PAGE, /restartServerAfterSave/);
  assert.match(PAGE, /setFormSubmitDisabled\(configForm, true\)/);
  assert.match(PAGE, /setFormSubmitDisabled\(editConfigForm, true\)/);
  assert.match(PAGE, /setFormSubmitDisabled\(modConfigForm, true\)/);
  assert.match(PAGE, /name="localZip" type="file"/);
  assert.match(PAGE, /\/api\/mods\/upload/);
  assert.match(PAGE, /\.management-panel \{/);
  assert.match(PAGE, /\.scroll-list \{/);
  assert.match(PAGE, /align-content: start;/);
  assert.match(PAGE, /overscroll-behavior: contain;/);
  assert.match(PAGE, /id="playerManagerPanel" class="panel span-12 management-panel"/);
  assert.match(PAGE, /id="saveManagerPanel" class="panel span-12 management-panel"/);
  assert.match(PAGE, /id="modManagerPanel" class="panel span-12 management-panel"/);
  assert.match(PAGE, /id="onlinePlayersList" class="manage-list scroll-list"/);
  assert.match(PAGE, /id="farmhandsList" class="manage-list scroll-list"/);
  assert.match(PAGE, /id="savesList" class="manage-list scroll-list"/);
  assert.match(PAGE, /id="backupsList" class="manage-list scroll-list"/);
  assert.match(PAGE, /id="modSearchResults" class="manage-list scroll-list"/);
  assert.match(PAGE, /id="installedModsList" class="manage-list scroll-list"/);
  assert.match(PAGE, /id="modGuidanceList" class="manage-list"/);
  assert.match(PAGE, /id="nexusFilesList" class="manage-list scroll-list"/);
  assert.match(PAGE, /data-i18n="config\.maxPlayers"><\/strong><input name="maxPlayers" type="number" min="1" max="10"/);
  assert.match(PAGE, /data-i18n="saveConfig\.targetCabins"><\/strong><input name="targetCabins" type="number" min="1" max="9"/);
  assert.match(PAGE, /id="repairCabinsFromConfigBtn"/);
  assert.match(PAGE, /repairSaveCabinsFromForm\(saveName, form\.targetCabins\.value, editConfigMessage\)/);
  assertThrowsMessage(
    () => __test.uploadedArchiveFromPayload({ fileName: "mod.txt", buffer: Buffer.from("PK\u0003\u0004") }),
    /\.zip 格式/,
  );
  assertThrowsMessage(
    () => __test.uploadedArchiveFromPayload({ fileName: "mod.zip", buffer: Buffer.alloc(0) }),
    /内容为空/,
  );
  assert.equal(
    __test.uploadedArchiveFromPayload({ fileName: "mod.zip", buffer: Buffer.from("PK\u0003\u0004") }).buffer.length,
    4,
  );
  assert.deepEqual(__test.stripJsonComments("{\n// comment\n\"Name\":\"A\",\n}\n"), "{\n\n\"Name\":\"A\"}\n");
  assertThrowsMessage(
    () => __test.normalizeNexusApiError({ statusCode: 429, retryAfterMs: 90000, message: "HTTP 429" }),
    /建议等待 90 秒后再试/,
  );
  assertThrowsMessage(
    () => __test.normalizeNexusApiError({ statusCode: 403, message: "HTTP 403" }),
    /Key 无效/,
  );

  const files = [
    __test.normalizeNexusFile({
      file_id: 1001,
      category_id: 1,
      category_name: "MAIN",
      name: "<b>Main</b> File",
      file_name: "main.zip",
      size_kb: 2048,
      version: "2.0.0",
      uploaded_timestamp: 1779998400,
      is_primary: true,
    }),
    __test.normalizeNexusFile({
      file_id: 1002,
      category_id: 2,
      category_name: "UPDATE",
      name: "Patch File",
    }),
    __test.normalizeNexusFile({
      file_id: 1003,
      category_id: 3,
      category_name: "OPTIONAL",
      name: "Optional File",
    }),
    __test.normalizeNexusFile({
      file_id: 1004,
      category_id: 4,
      category_name: "OLD_VERSION",
      name: "Old File",
    }),
  ];

  assert.deepEqual(files.map((file) => file.group), ["main", "patch", "optional", "old"]);
  assert.equal(files[0].name, "Main File");
  assert.equal(files[0].fileName, "main.zip");
  assert.equal(files[0].uploadedAt, "2026-05-28T20:00:00.000Z");

  const groups = __test.createNexusFileGroups(files);
  assert.equal(groups.main[0].fileId, 1001);
  assert.equal(groups.patch[0].fileId, 1002);
  assert.equal(groups.optional[0].fileId, 1003);
  assert.equal(groups.old[0].fileId, 1004);
  assert.equal(__test.pickRecommendedNexusFile(groups).fileId, 1001);

  const patchOnlyGroups = __test.createNexusFileGroups([files[1], files[3]]);
  assert.equal(__test.pickRecommendedNexusFile(patchOnlyGroups).fileId, 1002);
  assert.ok(__test.fileCategoryRank(files[0]) < __test.fileCategoryRank(files[1]));
  assert.ok(__test.fileCategoryRank(files[1]) < __test.fileCategoryRank(files[2]));
  assert.ok(__test.fileCategoryRank(files[2]) < __test.fileCategoryRank(files[3]));

  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), "sdv-mod-test-"));
  try {
    const service = createModService({
      rootDir,
      docker: async () => ({ ok: false }),
      readEnv: async () => ({}),
    });
    await assert.rejects(
      () => service.getNexusModFiles({ nexusId: 1915 }),
      /请先在配置页设置 Nexus API Key/,
    );
    await assert.rejects(
      () => service.installModFromUrl({ url: "http://github.com/example/mod.zip" }),
      /必须使用 https/,
    );
    await assert.rejects(
      () => service.installModFromUrl({ url: "https://example.com/mod.zip" }),
      /允许列表/,
    );
    await assert.rejects(
      () => service.deleteInstalledMod({ directoryName: "../evil" }),
      /模组目录名无效/,
    );
    assert.equal(__test.shouldSkipModDirectory(".installing-leftover"), true);
    assert.equal(__test.shouldSkipModDirectory(".hidden"), true);
    assert.equal(__test.shouldSkipModDirectory("ContentPatcher"), false);
    assert.equal(
      __test.assertInsideRoot(path.join(rootDir, "extract"), path.join(rootDir, "extract", "Mod", "manifest.json"), "root error"),
      path.resolve(rootDir, "extract", "Mod", "manifest.json"),
    );
    assertThrowsMessage(
      () => __test.assertInsideRoot(path.join(rootDir, "extract"), path.join(rootDir, "outside", "manifest.json"), "root error"),
      /root error/,
    );
    assertThrowsMessage(
      () => __test.assertSafeZipEntryName("../evil/manifest.json"),
      /path traversal/,
    );
    assertThrowsMessage(
      () => __test.assertSafeZipEntryName("/evil/manifest.json"),
      /absolute path/,
    );

    await fsp.writeFile(path.join(rootDir, "safe.zip"), createZip([
      { name: "Mod/manifest.json", data: "{}" },
      { name: "Mod/config.json", data: "{}" },
    ]));
    const zipInfo = await __test.inspectZipArchive(path.join(rootDir, "safe.zip"));
    assert.equal(zipInfo.entries, 2);
    await fsp.writeFile(path.join(rootDir, "traversal.zip"), createZip([
      { name: "../evil.txt", data: "bad" },
    ]));
    await assert.rejects(
      () => __test.inspectZipArchive(path.join(rootDir, "traversal.zip")),
      /path traversal/,
    );
    await fsp.writeFile(path.join(rootDir, "symlink.zip"), createZip([
      { name: "Mod/link", data: "target", externalAttributes: 0o120777 << 16 },
    ]));
    await assert.rejects(
      () => __test.inspectZipArchive(path.join(rootDir, "symlink.zip")),
      /symbolic links/,
    );
    await fsp.writeFile(path.join(rootDir, "not-central.zip"), Buffer.from("PK\u0003\u0004"));
    await assert.rejects(
      () => __test.inspectZipArchive(path.join(rootDir, "not-central.zip")),
      /too small|central directory/,
    );

    const modsDir = path.join(rootDir, "data", "mods");
    await fsp.mkdir(path.join(modsDir, "VisibleMod"), { recursive: true });
    await fsp.writeFile(path.join(modsDir, "VisibleMod", "manifest.json"), JSON.stringify({
      Name: "Visible Mod",
      UniqueID: "Example.Visible",
      Version: "1.0.0",
    }));
    await fsp.writeFile(path.join(modsDir, "VisibleMod", "config.json"), JSON.stringify({
      Enabled: true,
      Count: 2,
    }));
    await fsp.mkdir(path.join(modsDir, "smapi", "NestedMod"), { recursive: true });
    await fsp.writeFile(path.join(modsDir, "smapi", "NestedMod", "manifest.json"), JSON.stringify({
      Name: "Nested Mod",
      UniqueID: "Example.Nested",
      Version: "1.0.0",
    }));
    await fsp.writeFile(path.join(modsDir, "smapi", "NestedMod", "config.json"), JSON.stringify({
      Enabled: true,
    }));
    await fsp.mkdir(path.join(modsDir, ".installing-leftover"), { recursive: true });
    await fsp.writeFile(path.join(modsDir, ".installing-leftover", "manifest.json"), JSON.stringify({
      Name: "Staging Mod",
      UniqueID: "Example.Staging",
      Version: "1.0.0",
    }));
    await fsp.mkdir(path.join(modsDir, "empty-folder"), { recursive: true });
    const listed = await service.getModManagement();
    assert.deepEqual(listed.installed.map((mod) => mod.directoryName), ["smapi/NestedMod", "VisibleMod"]);
    assert.equal(listed.installed.every((mod) => mod.hasConfig), true);
    assert.equal(listed.installed.every((mod) => mod.configSizeBytes > 0), true);
    assert.equal(listed.directoryIssues.some((issue) => issue.directoryName === "empty-folder"), true);
    assert.equal(listed.loadReport.installedCount, 2);
    assert.equal(listed.loadReport.logAvailable, false);
    assert.equal(listed.loadReport.smapiDetected, false);
    assert.equal(listed.loadReport.directoryIssues.some((issue) => issue.reason === "empty-folder"), true);

    const loadedReport = __test.buildModLoadReport([
      "sdv-server  | [SMAPI] Loaded 3 mods:",
      "sdv-server  | [SMAPI]    Content Patcher 2.5.0 by Pathoschild | Loads content packs.",
      "sdv-server  | [SMAPI]    Visible Mod 1.0.0 by Local | Example.Visible",
      "sdv-server  | [SMAPI] Skipped mods",
      "sdv-server  | [SMAPI]    Broken Mod because it needs missing dependency Example.Dependency.",
      "sdv-server  | [SMAPI] ERROR SMAPI Failed loading Nested Mod from Mods/user/smapi/NestedMod.",
    ].join("\n"), listed.installed);
    assert.equal(loadedReport.loadedSummaryCount, 3);
    assert.equal(loadedReport.smapiDetected, true);
    assert.equal(loadedReport.confirmedLoaded.some((mod) => mod.directoryName === "VisibleMod"), true);
    assert.equal(loadedReport.problemMods.some((mod) => mod.directoryName === "smapi/NestedMod"), true);
    assert.equal(loadedReport.byDirectory["smapi/NestedMod"].severity, "error");
    assert.equal(loadedReport.byDirectory["smapi/NestedMod"].reason, "load-failed");
    assert.equal(loadedReport.skipped.length > 0, true);
    assert.equal(loadedReport.errors.length > 0, true);

    await fsp.mkdir(path.join(modsDir, "SVSKCrashGuard"), { recursive: true });
    await fsp.writeFile(path.join(modsDir, "SVSKCrashGuard", "manifest.json"), JSON.stringify({
      Name: "SVSK Crash Guard",
      UniqueID: "SVSK.CrashGuard",
      Version: "1.0.0",
    }));
    const protectedListed = await service.getModManagement();
    const protectedMod = protectedListed.installed.find((mod) => mod.directoryName === "SVSKCrashGuard");
    assert.equal(protectedMod.protected, true);
    assert.match(protectedMod.protectedReason, /系统内置 Mod/);
    await assert.rejects(
      () => service.deleteInstalledMod({ directoryName: "SVSKCrashGuard" }),
      /系统内置 Mod/,
    );

    const dependencyReport = __test.buildModLoadReport([
      "sdv-server  | [SMAPI] Loaded 1 mod:",
      "sdv-server  | [SMAPI]    Visible Mod 1.0.0 by Local | Example.Visible",
      "sdv-server  | [SMAPI] Skipped mods",
      "sdv-server  | [SMAPI]    Nested Mod because it needs missing dependency Example.Dependency.",
    ].join("\n"), listed.installed);
    assert.equal(dependencyReport.problemMods.some((mod) => mod.directoryName === "smapi/NestedMod"), true);
    assert.equal(dependencyReport.byDirectory["smapi/NestedMod"].reason, "missing-dependency");

    const advisoryReport = __test.buildModLoadReport([
      "sdv-server  | [SMAPI] Loaded 1 mod:",
      "sdv-server  | [SMAPI]    Visible Mod 1.0.0 by Local | Example.Visible",
      "sdv-server  | [03:02:43 ERROR SMAPI]    Patched game code",
      "sdv-server  | [03:02:43 ERROR SMAPI]       Visible Mod",
      "sdv-server  | [03:02:43 ERROR SMAPI]    Bypassed safety checks",
      "sdv-server  | [03:02:43 ERROR SMAPI]       Visible Mod",
    ].join("\n"), listed.installed);
    assert.equal(advisoryReport.errors.length, 0);
    assert.equal(advisoryReport.skipped.length, 0);
    assert.equal(advisoryReport.problemMods.some((mod) => mod.directoryName === "VisibleMod"), false);
    assert.equal(advisoryReport.byDirectory.VisibleMod.state, "loaded");

    const assetErrorReport = __test.buildModLoadReport([
      "sdv-server  | [SMAPI] Loaded 1 mod:",
      "sdv-server  | [SMAPI]    Visible Mod 1.0.0 by Local | Example.Visible",
      "sdv-server  | [03:02:48 ERROR Visible Mod] AssetHelper: failed to load asset 'level_up.ogg': Audio has failed to initialize.",
      "sdv-server  | [03:02:48 TRACE Visible Mod] Accessed mod-provided API (GenericModConfigMenu.Framework.Api) for Generic Mod Config Menu.",
    ].join("\n"), listed.installed);
    assert.equal(assetErrorReport.problemMods.some((mod) => mod.directoryName === "VisibleMod"), false);
    assert.equal(assetErrorReport.byDirectory.VisibleMod.state, "loaded");
    assert.equal(assetErrorReport.byDirectory.VisibleMod.severity, "warn");
    assert.equal(assetErrorReport.byDirectory.VisibleMod.reason, "runtime-warning");
    assert.equal(assetErrorReport.warningMods.some((mod) => mod.directoryName === "VisibleMod"), true);

    const manifestReport = __test.buildModLoadReport("", [{
      directoryName: "BrokenManifest",
      name: "Broken Manifest",
      uniqueId: "",
      hasManifest: false,
      manifestError: "manifest.json 解析失败",
    }]);
    assert.equal(manifestReport.byDirectory.BrokenManifest.state, "problem");
    assert.equal(manifestReport.byDirectory.BrokenManifest.reason, "manifest-error");
    assert.equal(manifestReport.byDirectory.BrokenManifest.severity, "error");

    const emptyFolderReport = __test.buildModLoadReport([
      "sdv-server  | [SMAPI] Skipped mods",
      "sdv-server  | [SMAPI]    smapi (ID: ???, path: smapi) because it's an empty folder.",
      "sdv-server  | [SMAPI]    user/smapi (ID: ???, path: user/smapi) because it's an empty folder.",
    ].join("\n"), listed.installed);
    assert.equal(emptyFolderReport.emptyFolderEntries.length, 2);
    assert.equal(emptyFolderReport.emptyFolderEntries[0].reason, "empty-folder");

    const config = await service.readModConfig({ directoryName: "VisibleMod" });
    assert.equal(config.directoryName, "VisibleMod");
    assert.match(config.text, /"Enabled":true|"Enabled": true/);
    const nestedConfig = await service.readModConfig({ directoryName: "smapi/NestedMod" });
    assert.equal(nestedConfig.directoryName, "smapi/NestedMod");
    assert.match(nestedConfig.text, /"Enabled":true|"Enabled": true/);
    await assert.rejects(
      () => service.saveModConfig({ directoryName: "../evil", text: "{}" }),
      /目录名无效/,
    );
    await assert.rejects(
      () => service.saveModConfig({ directoryName: "VisibleMod", text: "{bad json" }),
      /not valid JSON/,
    );
    const savedConfig = await service.saveModConfig({
      directoryName: "VisibleMod",
      text: '{"Enabled":false,"Nested":{"Value":3}}',
    });
    assert.equal(savedConfig.restartRequired, true);
    assert.match(savedConfig.backupName, /^VisibleMod\.config-\d{8}T\d{6}Z/);
    assert.match(savedConfig.text, /"Enabled": false/);
    assert.equal(await pathExists(path.join(rootDir, "backups", "mod-configs", savedConfig.backupName)), true);
    assert.match(await fsp.readFile(path.join(modsDir, "VisibleMod", "config.json"), "utf8"), /"Value": 3/);
    const savedNestedConfig = await service.saveModConfig({
      directoryName: "smapi/NestedMod",
      text: '{"Enabled":false}',
    });
    assert.equal(savedNestedConfig.directoryName, "smapi/NestedMod");
    assert.match(savedNestedConfig.backupName, /^smapi_NestedMod\.config-\d{8}T\d{6}Z/);
    assert.match(await fsp.readFile(path.join(modsDir, "smapi", "NestedMod", "config.json"), "utf8"), /"Enabled": false/);

    if (process.platform !== "win32") {
      await fsp.symlink(rootDir, path.join(modsDir, "LinkedMod"), "dir");
      await assert.rejects(
        () => service.readModConfig({ directoryName: "LinkedMod" }),
        /symbolic link/,
      );
    }

    const deleteResult = await service.deleteInstalledMod({ directoryName: "VisibleMod" });
    assert.equal(deleteResult.deleted, "VisibleMod");
    assert.match(deleteResult.backupName, /^VisibleMod\.bak-\d{8}T\d{6}Z/);
    assert.equal(await pathExists(path.join(modsDir, "VisibleMod")), false);
    assert.equal(await pathExists(path.join(rootDir, "backups", "mods", deleteResult.backupName, "manifest.json")), true);

    const uploadService = createModService({
      rootDir,
      docker: async (args) => {
        const volumeArg = args[args.lastIndexOf("-v") + 1];
        const mountSuffix = ":/work";
        const tempDir = volumeArg.endsWith(mountSuffix)
          ? volumeArg.slice(0, -mountSuffix.length)
          : volumeArg;
        const modDir = path.join(tempDir, "extract", "UploadedMod");
        await fsp.mkdir(modDir, { recursive: true });
        await fsp.writeFile(path.join(modDir, "manifest.json"), JSON.stringify({
          Name: "Uploaded Mod",
          UniqueID: "Example.Uploaded",
          Version: "1.2.3",
          Author: "Local",
        }));
        return { ok: true, stdout: "", stderr: "" };
      },
      readEnv: async () => ({}),
    });
    const uploadResult = await uploadService.installModFromUpload({
      fileName: "uploaded.zip",
      buffer: createZip([{ name: "UploadedMod/manifest.json", data: "{}" }]),
    });
    assert.equal(uploadResult.installedCount, 1);
    assert.equal(uploadResult.bytes > 22, true);
    assert.equal(uploadResult.installed[0].directoryName, "Uploaded Mod");
    assert.equal(await pathExists(path.join(modsDir, "Uploaded Mod", "manifest.json")), true);

    const jsoncService = createModService({
      rootDir,
      docker: async (args) => {
        const volumeArg = args[args.lastIndexOf("-v") + 1];
        const mountSuffix = ":/work";
        const tempDir = volumeArg.endsWith(mountSuffix)
          ? volumeArg.slice(0, -mountSuffix.length)
          : volumeArg;
        const modDir = path.join(tempDir, "extract", "JsoncMod");
        await fsp.mkdir(modDir, { recursive: true });
        await fsp.writeFile(path.join(modDir, "manifest.json"), '{\n// Nexus archive comment\n"Name": "Jsonc Mod",\n"UniqueID": "Example.Jsonc",\n"Version": "1.0.0",\n}\n');
        return { ok: true, stdout: "", stderr: "" };
      },
      readEnv: async () => ({}),
    });
    const jsoncUploadResult = await jsoncService.installModFromUpload({
      fileName: "jsonc.zip",
      buffer: createZip([{ name: "JsoncMod/manifest.json", data: "{}" }]),
    });
    assert.equal(jsoncUploadResult.installed[0].directoryName, "Jsonc Mod");

    let retryCalls = 0;
    const retrySleeps = [];
    const retryService = createModService({
      rootDir,
      docker: async () => ({ ok: false }),
      readEnv: async () => ({ NEXUS_API_KEY: "test-key" }),
      sleep: async (ms) => retrySleeps.push(ms),
      nexusRequestJson: async (_url, options) => {
        assert.equal(options.headers.APIKEY, "test-key");
        retryCalls += 1;
        if (retryCalls < 3) {
          const error = new Error("HTTP 429");
          error.statusCode = 429;
          error.retryAfterMs = 5;
          throw error;
        }
        return {
          files: [{
            file_id: 2001,
            category_id: 1,
            category_name: "MAIN",
            name: "Retried Main File",
            is_primary: true,
          }],
          file_updates: [],
        };
      },
    });
    const retryResult = await retryService.getNexusModFiles({ nexusId: 1915 });
    assert.equal(retryCalls, 3);
    assert.deepEqual(retrySleeps, [5, 5]);
    assert.equal(retryResult.recommendedFileId, "2001");
    const cachedRetryResult = await retryService.getNexusModFiles({ nexusId: 1915 });
    assert.equal(cachedRetryResult.cached, true);
    assert.equal(retryCalls, 3);

    let isolatedCalls = 0;
    const isolatedService = createModService({
      rootDir,
      docker: async () => ({ ok: false }),
      readEnv: async () => ({ NEXUS_API_KEY: "isolated-key" }),
      sleep: async () => {},
      nexusRequestJson: async (_url, options) => {
        assert.equal(options.headers.APIKEY, "isolated-key");
        isolatedCalls += 1;
        return {
          files: [{
            file_id: 3001,
            category_id: 1,
            category_name: "MAIN",
            name: "Isolated Main File",
            is_primary: true,
          }],
          file_updates: [],
        };
      },
    });
    const isolatedResult = await isolatedService.getNexusModFiles({ nexusId: 1915 });
    assert.equal(isolatedResult.recommendedFileId, "3001");
    assert.equal(isolatedCalls, 1);
    assert.equal(retryCalls, 3);

    let cooldownNow = 100000;
    let cooldownCalls = 0;
    const cooldownService = createModService({
      rootDir,
      docker: async () => ({ ok: false }),
      readEnv: async () => ({ NEXUS_API_KEY: "test-key" }),
      sleep: async () => assert.fail("长 Retry-After 不应阻塞等待"),
      now: () => cooldownNow,
      nexusRequestJson: async () => {
        cooldownCalls += 1;
        const error = new Error("HTTP 429");
        error.statusCode = 429;
        error.retryAfterMs = 30000;
        throw error;
      },
    });
    await assert.rejects(
      () => cooldownService.getNexusModFiles({ nexusId: 1915 }),
      /建议等待 30 秒后再试/,
    );
    assert.equal(cooldownCalls, 1);
    await assert.rejects(
      () => cooldownService.getNexusModFiles({ nexusId: 1916 }),
      /建议等待 30 秒后再试/,
    );
    assert.equal(cooldownCalls, 1);
    cooldownNow += 30001;
    await assert.rejects(
      () => cooldownService.getNexusModFiles({ nexusId: 1916 }),
      /建议等待 30 秒后再试/,
    );
    assert.equal(cooldownCalls, 2);
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
  }

  console.log("mods.self-test ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
