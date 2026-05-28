"use strict";

function createApiHandler(deps) {
  const {
    ADMIN_COOKIE,
    readJsonBody,
    readUploadBody,
    readEnv,
    isAuthorized,
    json,
    getStatus,
    runtimeSignals,
    getPlayerManagement,
    grantAdminRole,
    unsupportedKickBan,
    deleteFarmhand,
    getConfig,
    saveConfig,
    restartStack,
    startStack,
    requestStopStack,
    cancelStopAfterSaveJob,
    getSaveManagement,
    getModManagement,
    searchMods,
    getNexusModFiles,
    installModFromUrl,
    installModFromUpload,
    installModFromNexusFile,
    deleteInstalledMod,
    selectSave,
    createNewGame,
    repairSaveCabins,
    deleteSave,
    readSaveConfigFromVolume,
    writeSaveConfigToVolume,
    createSavesBackup,
    updateBackupPolicy,
    restoreBackup,
    deleteBackups,
    latestLogs,
  } = deps;

  return async function handleApi(req, res, pathname) {
  if (pathname === "/api/auth" && req.method === "POST") {
    const body = await readJsonBody(req);
    const env = await readEnv();
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (token && token === env.ADMIN_TOKEN) {
      res.writeHead(204, {
        "Set-Cookie": `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=Lax; HttpOnly`,
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
      "Set-Cookie": `${ADMIN_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`,
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
  if (pathname === "/api/mods" && req.method === "GET") {
    json(res, 200, await getModManagement());
    return;
  }
  if (pathname === "/api/mods/search" && req.method === "POST") {
    json(res, 200, await searchMods(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/mods/install" && req.method === "POST") {
    json(res, 200, await installModFromUrl(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/mods/upload" && req.method === "POST") {
    json(res, 200, await installModFromUpload(await readUploadBody(req)));
    return;
  }
  if (pathname === "/api/mods/nexus/files" && req.method === "POST") {
    json(res, 200, await getNexusModFiles(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/mods/nexus/install" && req.method === "POST") {
    json(res, 200, await installModFromNexusFile(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/mods/delete" && req.method === "POST") {
    json(res, 200, await deleteInstalledMod(await readJsonBody(req)));
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
  if (pathname === "/api/saves/config" && req.method === "GET") {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const saveName = url.searchParams.get("saveName") || "";
    json(res, 200, await readSaveConfigFromVolume({ saveName }));
    return;
  }
  if (pathname === "/api/saves/config" && req.method === "POST") {
    json(res, 200, await writeSaveConfigToVolume(await readJsonBody(req)));
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
    json(res, 200, await deleteBackups(await readJsonBody(req)));
    return;
  }
  if (pathname === "/api/logs" && req.method === "GET") {
    json(res, 200, await latestLogs());
    return;
  }

  json(res, 404, { error: "Not found." });

  };
}

module.exports = { createApiHandler };
