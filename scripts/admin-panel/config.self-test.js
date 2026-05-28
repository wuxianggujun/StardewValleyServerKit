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

    await fsp.mkdir(path.dirname(settingsFile), { recursive: true });
    await fsp.writeFile(envFile, [
      "GAME_PORT=\"24642\"",
      "QUERY_PORT=\"27015\"",
      "VNC_PORT=\"5800\"",
      "API_PORT=\"8080\"",
      "SERVER_PASSWORD=\"old-password\"",
      "NEXUS_API_KEY=\"old-key\"",
      "UNKNOWN=\"kept\"",
      "",
    ].join("\n"));

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
