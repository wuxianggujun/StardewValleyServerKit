"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function validPayload(overrides = {}) {
  return {
    maxPlayers: "4",
    gamePort: "24642",
    queryPort: "27015",
    vncPort: "5800",
    apiPort: "8080",
    lobbyMode: "Shared",
    allowIpConnections: true,
    separateWallets: false,
    verboseLogging: true,
    cabinStrategy: "CabinStack",
    existingCabinBehavior: "KeepExisting",
    serverPasswordAction: "keep",
    serverPassword: "",
    nexusApiKeyAction: "keep",
    nexusApiKey: "",
    adminSteamIds: "76561198000000000\n76561198000000000",
    ...overrides,
  };
}

async function readText(filePath) {
  return fsp.readFile(filePath, "utf8");
}

async function main() {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), "sdv-config-test-"));
  process.env.SDV_ADMIN_ROOT = rootDir;
  const eol = os.EOL;

  try {
    const { __test } = require("../admin-panel");
    const envFile = path.join(rootDir, ".env");
    const settingsFile = path.join(rootDir, "data", "settings", "server-settings.json");

    assert.equal(
      __test.patchEnvText("GAME_PORT=\"1\"\n# QUERY_PORT=\"2\"\nOTHER=\"keep\"\n", {
        GAME_PORT: 24642,
        QUERY_PORT: 27015,
      }),
      `GAME_PORT="24642"${eol}QUERY_PORT="27015"${eol}OTHER="keep"${eol}`,
    );
    assert.equal(
      __test.patchEnvText("GAME_PORT=\"1\"\nGAME_PORT=\"2\"\n", { GAME_PORT: 3 }),
      `GAME_PORT="3"${eol}GAME_PORT="3"${eol}`,
    );

    const boundary = "----sdv-test-boundary";
    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="displayName"\r\n\r\nLocal Mod\r\n`, "utf8"),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="local.zip"\r\nContent-Type: application/zip\r\n\r\n`, "utf8"),
      Buffer.from("PK\u0003\u0004", "latin1"),
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
    ]);
    const uploadPayload = __test.parseMultipartUpload({
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    }, multipartBody);
    assert.equal(uploadPayload.fileName, "local.zip");
    assert.equal(uploadPayload.displayName, "Local Mod");
    assert.equal(uploadPayload.buffer.length, 4);
    const inferredMultipart = __test.parseMultipartUpload({
      headers: { "content-type": "application/json" },
    }, multipartBody);
    assert.equal(inferredMultipart.fileName, "local.zip");
    const legacyUpload = __test.uploadPayloadFromJson(Buffer.from(JSON.stringify({
      fileName: "legacy.zip",
      displayName: "Legacy Mod",
      contentBase64: "UEsDBA==",
    })));
    assert.equal(legacyUpload.fileName, "legacy.zip");
    assert.equal(legacyUpload.buffer.length, 4);
    assert.throws(
      () => __test.uploadPayloadFromJson(Buffer.from("{bad")),
      /上传请求格式无效/,
    );

    const oversizedReq = (async function* () {
      yield Buffer.alloc(8);
    })();
    oversizedReq.destroy = () => {};
    await assert.rejects(
      () => __test.readRequestBuffer(oversizedReq, { maxBytes: 4 }),
      /请求体过大|too large/i,
    );
    await fsp.mkdir(path.dirname(settingsFile), { recursive: true });
    await fsp.writeFile(envFile, [
      "GAME_PORT=\"24642\"",
      "QUERY_PORT=\"27015\"",
      "VNC_PORT=\"5800\"",
      "API_PORT=\"8080\"",
      "SERVER_PASSWORD=\"old-password\"",
      "NEXUS_API_KEY=\"old-key\"",
      "ADMIN_TOKEN=\"test-token\"",
      "UNKNOWN=\"kept\"",
      "",
    ].join("\n"));

    const authorizedReq = { url: "/api/status?token=test-token", headers: { cookie: "sdv_admin_token=test-token" } };
    assert.equal(await __test.isAuthorized(authorizedReq), true);
    const headerReq = { url: "/api/status", headers: { "x-admin-token": "test-token" } };
    assert.equal(await __test.isAuthorized(headerReq), true);
    const queryOnlyReq = { url: "/api/status?token=test-token", headers: {} };
    assert.equal(await __test.isAuthorized(queryOnlyReq), false);
    assert.equal(__test.isLoopbackAdminHost("127.0.0.1"), true);
    assert.equal(__test.isLoopbackAdminHost("localhost"), true);
    assert.equal(__test.adminHostRequiresPublicHttpOptIn("0.0.0.0"), true);
    assert.equal(__test.adminHostRequiresPublicHttpOptIn("192.168.1.50"), true);
    assert.doesNotThrow(() => __test.assertAdminBindAllowed("127.0.0.1", {}));
    assert.throws(
      () => __test.assertAdminBindAllowed("0.0.0.0", {}),
      /Refusing to run the admin panel over plain HTTP/,
    );
    assert.doesNotThrow(() => __test.assertAdminBindAllowed("0.0.0.0", { ADMIN_ALLOW_PUBLIC_HTTP: "true" }));
    assert.match(__test.restoreBackupScript("saves-20260529-120000.tar.gz"), /tar -tzvf/);
    assert.match(__test.restoreBackupScript("saves-20260529-120000.tar.gz"), /unsupported special file entries/);
    assert.equal(__test.containerReady({ status: "running", health: "healthy" }), true);
    assert.equal(__test.containerReady({ status: "running", health: "none" }), true);
    assert.equal(__test.containerReady({ status: "running", health: "unhealthy" }), false);
    assert.equal(__test.containerReady({ status: "restarting", health: "unhealthy" }), false);
    assert.equal(__test.stackRestartVerified({
      ok: true,
      containers: [
        { name: "sdv-server", status: "running", health: "healthy" },
        { name: "sdv-steam-auth", status: "running", health: "healthy" },
      ],
    }), true);
    assert.equal(__test.stackRestartVerified({
      ok: true,
      containers: [
        { name: "sdv-server", status: "running", health: "unhealthy" },
        { name: "sdv-steam-auth", status: "running", health: "healthy" },
      ],
    }), false);
    assert.match(__test.stackStateSummary({
      ok: true,
      containers: [{ name: "sdv-server", status: "restarting", health: "unhealthy" }],
    }), /sdv-server=restarting\/unhealthy/);
    assert.equal(__test.tailLogText("a\nb\nc\n", 2, 100), "b\nc");
    assert.match(__test.DOCKER_INSPECT_API_FORMAT, /printf "\\t"/);
    assert.match(__test.DOCKER_INSPECT_API_FORMAT, /json \.Mounts/);

    const beforeEnv = await readText(envFile);
    await assert.rejects(
      () => __test.saveConfig(validPayload({
        apiPort: "70000",
        maxPlayers: "5",
        verboseLogging: false,
      })),
      /API port must be between 1 and 65535/,
    );
    assert.equal(await readText(envFile), beforeEnv);
    await assert.rejects(() => readText(settingsFile), /ENOENT/);

    await __test.saveConfig(validPayload({
      gamePort: "1",
      queryPort: "65535",
      vncPort: "5900",
      apiPort: "8090",
      serverPasswordAction: "set",
      serverPassword: "new-password",
      nexusApiKeyAction: "set",
      nexusApiKey: "new-key",
      adminSteamIds: "76561198000000000 76561198000000001",
    }));

    const savedEnv = __test.parseEnv(await readText(envFile));
    assert.equal(savedEnv.GAME_PORT, "1");
    assert.equal(savedEnv.QUERY_PORT, "65535");
    assert.equal(savedEnv.VNC_PORT, "5900");
    assert.equal(savedEnv.API_PORT, "8090");
    assert.equal(savedEnv.VERBOSE_LOGGING, "true");
    assert.equal(savedEnv.SERVER_PASSWORD, "new-password");
    assert.equal(savedEnv.NEXUS_API_KEY, "new-key");
    assert.equal(savedEnv.UNKNOWN, "kept");

    const savedSettings = JSON.parse(await readText(settingsFile));
    assert.equal(savedSettings.Server.MaxPlayers, 4);
    assert.deepEqual(savedSettings.Server.AdminSteamIds, [
      "76561198000000000",
      "76561198000000001",
    ]);
    const maintenanceSettings = JSON.parse(JSON.stringify(savedSettings));
    assert.deepEqual(
      __test.applySaveMaintenanceSettings(maintenanceSettings, { maxPlayers: "7", targetCabins: "6" }),
      { maxPlayers: 7, targetCabins: 6 },
    );
    assert.equal(maintenanceSettings.Server.MaxPlayers, 7);
    assert.equal(maintenanceSettings.Game.StartingCabins, 6);
    assert.throws(
      () => __test.applySaveMaintenanceSettings(maintenanceSettings, { maxPlayers: "11" }),
      /Max players must be between 1 and 10/,
    );

    const beforeKeepEnv = await readText(envFile);
    await assert.rejects(
      () => __test.saveConfig(validPayload({ nexusApiKeyAction: "set", nexusApiKey: "" })),
      /Nexus API Key cannot be empty/,
    );
    assert.equal(await readText(envFile), beforeKeepEnv);

    await __test.saveConfig(validPayload({
      serverPasswordAction: "clear",
      nexusApiKeyAction: "clear",
    }));
    const clearedEnv = __test.parseEnv(await readText(envFile));
    assert.equal(clearedEnv.SERVER_PASSWORD, "");
    assert.equal(clearedEnv.NEXUS_API_KEY, "");

    console.log("config.self-test ok");
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
