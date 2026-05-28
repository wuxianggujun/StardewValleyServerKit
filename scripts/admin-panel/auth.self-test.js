"use strict";

const assert = require("node:assert/strict");
const { createApiHandler } = require("./api-routes");
const { PAGE } = require("./page");

async function main() {
  const writes = [];
  const res = {
    writeHead(status, headers) {
      writes.push({ status, headers });
    },
    end() {},
  };

  const handleApi = createApiHandler({
    ADMIN_COOKIE: "sdv_admin_token",
    readJsonBody: async () => ({ token: " test-token " }),
    readEnv: async () => ({ ADMIN_TOKEN: "test-token" }),
    isAuthorized: async () => false,
    json: () => {},
  });

  await handleApi({ method: "POST", url: "/api/auth", headers: {} }, res, "/api/auth");
  assert.equal(writes[0].status, 204);
  assert.match(writes[0].headers["Set-Cookie"], /sdv_admin_token=test-token/);
  assert.match(writes[0].headers["Set-Cookie"], /SameSite=Lax/);
  assert.match(writes[0].headers["Set-Cookie"], /HttpOnly/);

  assert.match(PAGE, /let activeAdminToken = "";/);
  assert.match(PAGE, /headers\["X-Admin-Token"\] = activeAdminToken;/);
  assert.match(PAGE, /activeAdminToken = token;/);
  assert.match(PAGE, /activeAdminToken = trimmedToken;/);

  console.log("auth.self-test ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
