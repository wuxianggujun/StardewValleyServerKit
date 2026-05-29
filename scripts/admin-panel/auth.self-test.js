"use strict";

const assert = require("node:assert/strict");
const { createApiHandler, __test: apiTest } = require("./api-routes");
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
  assert.doesNotMatch(writes[0].headers["Set-Cookie"], /Secure/);
  assert.match(
    apiTest.adminCookieHeader({
      headers: { host: "example.com", "x-forwarded-proto": "https" },
      socket: {},
    }, "sdv_admin_token", "test-token"),
    /Secure/,
  );
  assert.equal(
    apiTest.isSafeMutationRequest({
      method: "POST",
      headers: { host: "example.com", origin: "https://evil.example" },
      socket: {},
    }),
    false,
  );
  assert.equal(
    apiTest.isSafeMutationRequest({
      method: "POST",
      headers: { host: "example.com", origin: "http://example.com" },
      socket: {},
    }),
    true,
  );
  assert.equal(
    apiTest.isSafeMutationRequest({
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
      socket: {},
    }),
    false,
  );
  assert.doesNotMatch(PAGE, /URLSearchParams\(location\.search\)/);
  assert.doesNotMatch(PAGE, /params\.get\("token"\)/);

  assert.match(PAGE, /let activeAdminToken = "";/);
  assert.match(PAGE, /id="adminToolbar" class="toolbar hidden"/);
  assert.match(PAGE, /adminToolbar\.classList\.add\("hidden"\);/);
  assert.match(PAGE, /adminToolbar\.classList\.remove\("hidden"\);/);
  assert.match(PAGE, /headers\["X-Admin-Token"\] = activeAdminToken;/);
  assert.match(PAGE, /activeAdminToken = token;/);

  console.log("auth.self-test ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
