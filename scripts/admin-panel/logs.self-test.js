"use strict";

const assert = require("node:assert/strict");
const { __test } = require("../admin-panel");
const { createApiHandler } = require("./api-routes");
const { PAGE } = require("./page");

async function main() {
  const lines = Array.from({ length: 125 }, (_, index) => `2026-07-10T12:00:${String(index % 60).padStart(2, "0")}Z server | line-${index + 1}`);
  const latest = __test.paginateLogText(lines.join("\n"), { page: 1, pageSize: 50 });
  assert.equal(latest.page, 1);
  assert.equal(latest.pageSize, 50);
  assert.equal(latest.totalLines, 125);
  assert.equal(latest.totalPages, 3);
  assert.equal(latest.logs.split("\n")[0].endsWith("line-76"), true);
  assert.equal(latest.logs.split("\n").at(-1).endsWith("line-125"), true);
  assert.equal(latest.hasNewerPage, false);
  assert.equal(latest.hasOlderPage, true);

  const older = __test.paginateLogText(lines.join("\n"), { page: 2, pageSize: 50 });
  assert.equal(older.logs.split("\n")[0].endsWith("line-26"), true);
  assert.equal(older.logs.split("\n").at(-1).endsWith("line-75"), true);
  assert.equal(older.hasNewerPage, true);
  assert.equal(older.hasOlderPage, true);

  const oldest = __test.paginateLogText(lines.join("\n"), { page: 99, pageSize: 50 });
  assert.equal(oldest.page, 3);
  assert.equal(oldest.logs.split("\n")[0].endsWith("line-1"), true);
  assert.equal(oldest.logs.split("\n").at(-1).endsWith("line-25"), true);

  let receivedOptions = null;
  let responseBody = null;
  const handleApi = createApiHandler({
    ADMIN_COOKIE: "sdv_admin_token",
    readJsonBody: async () => ({}),
    readEnv: async () => ({}),
    isAuthorized: async () => true,
    json: (_res, status, body) => { responseBody = { status, body }; },
    latestLogs: async (options) => {
      receivedOptions = options;
      return { logs: "ok", page: 3 };
    },
  });
  await handleApi({
    method: "GET",
    url: "/api/logs?page=3&pageSize=500",
    headers: { host: "localhost:8088" },
    socket: {},
  }, {}, "/api/logs");
  assert.deepEqual(receivedOptions, { paginate: true, page: "3", pageSize: "500" });
  assert.deepEqual(responseBody, { status: 200, body: { logs: "ok", page: 3 } });

  assert.match(PAGE, /id="logPagination"/);
  assert.match(PAGE, /id="olderLogsBtn"/);
  const adminSource = await require("node:fs/promises").readFile(require("node:path").join(__dirname, "..", "admin-panel.js"), "utf8");
  assert.match(adminSource, /"--timestamps"/);
  console.log("logs.self-test ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
