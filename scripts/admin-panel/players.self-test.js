"use strict";

const assert = require("node:assert/strict");
const {
  buildPlayerManagement,
  createPlayerService,
  hasFarmhandList,
} = require("./players");

async function main() {
  assert.equal(hasFarmhandList(null), false);
  assert.equal(hasFarmhandList({ farmhands: [] }), false);
  assert.equal(hasFarmhandList({ farmhands: [{ id: "1" }] }), true);

  const fallbackOnly = buildPlayerManagement(null, null, null, [], {
    fallbackSaveName: "Farm_123",
    fallbackFarmhands: [
      { id: "101", name: "Alice", isCustomized: true },
    ],
  });
  assert.equal(fallbackOnly.apiAvailable, false);
  assert.equal(fallbackOnly.farmhandSource, "save");
  assert.equal(fallbackOnly.farmhandSourceSave, "Farm_123");
  assert.deepEqual(fallbackOnly.farmhands.map((farmhand) => farmhand.name), ["Alice"]);
  assert.equal(fallbackOnly.capabilities.deleteFarmhand, false);

  const apiPreferred = buildPlayerManagement(
    { players: [{ id: "202", name: "Bob" }] },
    { farmhands: [{ id: "202", name: "Bob", isCustomized: true }] },
    null,
    [],
    {
      fallbackSaveName: "Farm_123",
      fallbackFarmhands: [{ id: "101", name: "Alice", isCustomized: true }],
    },
  );
  assert.equal(apiPreferred.farmhandSource, "api");
  assert.deepEqual(apiPreferred.farmhands.map((farmhand) => farmhand.name), ["Bob"]);
  assert.equal(apiPreferred.farmhands[0].isOnline, true);
  assert.equal(apiPreferred.capabilities.deleteFarmhand, true);

  let fallbackCalls = 0;
  const service = createPlayerService({
    serverApiJson: async () => null,
    serverApiRequest: async () => ({}),
    apiError: (_status, message) => new Error(message),
    readFallbackFarmhands: async () => {
      fallbackCalls += 1;
      return {
        saveName: "Farm_123",
        farmhands: [{ id: "101", name: "Alice", isCustomized: true }],
      };
    },
  });
  const fromService = await service.getPlayerManagement();
  assert.equal(fallbackCalls, 1);
  assert.equal(fromService.farmhandSource, "save");
  assert.equal(fromService.farmhands[0].name, "Alice");

  console.log("players.self-test ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
