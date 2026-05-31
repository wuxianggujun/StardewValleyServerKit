"use strict";

function cleanText(value, maxLength, fallback = "") {
  const next = String(value || "").trim();
  if (!next) return fallback;
  return next.slice(0, maxLength);
}

function validatePlayerName(value) {
  const raw = String(value || "");
  if (/[\r\n]/.test(raw)) throw new Error("玩家名称无效。");
  const name = raw.trim();
  if (!name || name.length > 64) throw new Error("玩家名称无效。");
  return name;
}

function normalizeApiPlayers(response) {
  if (!response || !Array.isArray(response.players)) return [];
  return response.players
    .map((player) => ({
      id: player.id == null ? "" : String(player.id),
      name: cleanText(player.name, 64, "Unknown"),
      isOnline: player.isOnline !== false,
    }))
    .filter((player) => player.name);
}

function normalizeFarmhands(response, onlinePlayers) {
  if (!response || !Array.isArray(response.farmhands)) return [];
  const onlineIds = new Set(onlinePlayers.map((player) => player.id).filter(Boolean));
  const onlineNames = new Set(onlinePlayers.map((player) => player.name.toLowerCase()));
  return response.farmhands
    .map((farmhand) => {
      const id = farmhand.id == null ? "" : String(farmhand.id);
      const name = cleanText(farmhand.name, 64, "");
      return {
        id,
        name,
        isCustomized: Boolean(farmhand.isCustomized),
        isOnline: (id && onlineIds.has(id)) || (name && onlineNames.has(name.toLowerCase())),
      };
    })
    .filter((farmhand) => farmhand.id || farmhand.name);
}

function normalizeAuthStatus(response) {
  if (!response) return null;
  return {
    enabled: Boolean(response.enabled),
    authenticatedCount: Number(response.authenticatedCount || 0),
    pendingCount: Number(response.pendingCount || 0),
    timeoutSeconds: Number(response.timeoutSeconds || 0),
    maxAttempts: Number(response.maxAttempts || 0),
  };
}

function buildPlayerManagement(apiPlayers, apiFarmhands, apiAuth, recentPlayers = [], options = {}) {
  const onlinePlayers = normalizeApiPlayers(apiPlayers);
  const apiFarmhandList = normalizeFarmhands(apiFarmhands, onlinePlayers);
  const fallbackFarmhandList = normalizeFarmhands({ farmhands: options.fallbackFarmhands || [] }, onlinePlayers);
  const farmhands = apiFarmhandList.length ? apiFarmhandList : fallbackFarmhandList;
  const farmhandSource = apiFarmhandList.length ? "api" : (fallbackFarmhandList.length ? "save" : "none");
  const apiAvailable = Boolean(apiPlayers || apiFarmhands || apiAuth);
  return {
    apiAvailable,
    onlinePlayers,
    farmhands,
    farmhandSource,
    farmhandSourceSave: farmhandSource === "save" ? (options.fallbackSaveName || "") : "",
    recentPlayers,
    auth: normalizeAuthStatus(apiAuth),
    capabilities: {
      grantAdmin: Boolean(apiPlayers),
      deleteFarmhand: farmhandSource === "api" && Boolean(apiFarmhands),
      kick: false,
      ban: false,
    },
    unsupportedMessage:
      "当前 sdvd/server 镜像没有暴露 HTTP 踢出/封禁接口；只能由游戏内管理员使用 !kick / !ban，或升级到支持该 API 的服务端镜像。",
  };
}

function ensureApiSuccess(response, actionLabel, apiError) {
  if (response && response.success === false) {
    throw apiError(400, response.error || response.message || `${actionLabel} failed.`);
  }
  return response || {};
}

function hasFarmhandList(response) {
  return Array.isArray(response?.farmhands) && response.farmhands.length > 0;
}

function createPlayerService({ serverApiJson, serverApiRequest, apiError, readFallbackFarmhands }) {
  return {
    async getPlayerManagement(recentPlayers = []) {
      const [apiPlayers, apiFarmhands, apiAuth] = await Promise.all([
        serverApiJson("/players").catch(() => null),
        serverApiJson("/farmhands").catch(() => null),
        serverApiJson("/auth").catch(() => null),
      ]);
      const fallback = !hasFarmhandList(apiFarmhands) && readFallbackFarmhands
        ? await readFallbackFarmhands().catch(() => null)
        : null;
      return buildPlayerManagement(apiPlayers, apiFarmhands, apiAuth, recentPlayers, {
        fallbackFarmhands: fallback?.farmhands || [],
        fallbackSaveName: fallback?.saveName || "",
      });
    },

    async grantAdminRole(payload) {
      const name = validatePlayerName(payload.name);
      const response = await serverApiRequest("POST", `/roles/admin?name=${encodeURIComponent(name)}`);
      const result = ensureApiSuccess(response, "Grant admin", apiError);
      return {
        name,
        playerId: result.playerId == null ? "" : String(result.playerId),
        message: result.message || `已授予管理员：${name}`,
      };
    },

    async deleteFarmhand(payload) {
      const name = validatePlayerName(payload.name);
      const response = await serverApiRequest("DELETE", `/farmhands?name=${encodeURIComponent(name)}`);
      const result = ensureApiSuccess(response, "Delete farmhand", apiError);
      return {
        name,
        message: result.message || `已删除离线角色：${name}`,
      };
    },

    unsupportedKickBan(action) {
      throw apiError(
        501,
        `当前 sdvd/server 镜像未暴露 HTTP ${action} 接口；面板不会伪装执行成功。请在游戏内由管理员使用 !kick / !ban，或升级到支持该 API 的服务端镜像。`,
      );
    },
  };
}

module.exports = {
  validatePlayerName,
  normalizeApiPlayers,
  normalizeFarmhands,
  normalizeAuthStatus,
  hasFarmhandList,
  buildPlayerManagement,
  createPlayerService,
};
