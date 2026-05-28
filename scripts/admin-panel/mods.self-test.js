"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createModService, __test } = require("./mods");
const { PAGE } = require("./page");

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
  assert.match(PAGE, /使用缓存/);
  assert.match(PAGE, /未再次请求 Nexus API/);
  assert.match(PAGE, /\.field-8 \{ grid-column: span 8; \}/);
  assert.match(PAGE, /从本地安装/);
  assert.match(PAGE, /id="installModLocalDialog"/);
  assert.match(PAGE, /id="installModLocalForm"/);
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
  assert.match(PAGE, /<strong>最大玩家数<\/strong><input name="maxPlayers" type="number" min="1" max="10"/);
  assert.match(PAGE, /<strong>目标小屋\/角色槽<\/strong><input name="targetCabins" type="number" min="1" max="9"/);
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

    const modsDir = path.join(rootDir, "data", "mods");
    await fsp.mkdir(path.join(modsDir, "VisibleMod"), { recursive: true });
    await fsp.writeFile(path.join(modsDir, "VisibleMod", "manifest.json"), JSON.stringify({
      Name: "Visible Mod",
      UniqueID: "Example.Visible",
      Version: "1.0.0",
    }));
    await fsp.mkdir(path.join(modsDir, ".installing-leftover"), { recursive: true });
    await fsp.writeFile(path.join(modsDir, ".installing-leftover", "manifest.json"), JSON.stringify({
      Name: "Staging Mod",
      UniqueID: "Example.Staging",
      Version: "1.0.0",
    }));
    const listed = await service.getModManagement();
    assert.deepEqual(listed.installed.map((mod) => mod.directoryName), ["VisibleMod"]);

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
      buffer: Buffer.from("PK\u0003\u0004"),
    });
    assert.equal(uploadResult.installedCount, 1);
    assert.equal(uploadResult.bytes, 4);
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
      buffer: Buffer.from("PK\u0003\u0004"),
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
