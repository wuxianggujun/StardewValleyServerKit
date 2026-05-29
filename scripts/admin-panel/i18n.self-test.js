"use strict";

const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { PAGE } = require("./page");
const { I18N } = require("./i18n");

async function main() {
  const pageSource = await fsp.readFile(path.join(__dirname, "page.js"), "utf8");
  const keys = new Set();
  for (const pattern of [
    /data-i18n(?:-[a-z]+)?="([^"]+)"/g,
    /(?<![A-Za-z0-9_$])t\("([^"]+)"/g,
  ]) {
    const text = pattern.source.includes("data-i18n") ? PAGE : pageSource;
    let match;
    while ((match = pattern.exec(text))) keys.add(match[1]);
  }

  assert.ok(keys.size > 100);
  for (const key of keys) {
    assert.ok(Object.hasOwn(I18N["zh-CN"], key), "Missing zh-CN i18n key: " + key);
    assert.ok(Object.hasOwn(I18N.en, key), "Missing en i18n key: " + key);
  }

  assert.doesNotMatch(pageSource, /[\p{Script=Han}]/u);
  assert.doesNotMatch(PAGE, /id="refreshBtn"/);
  assert.doesNotMatch(PAGE, /querySelector\("#refreshBtn"\)/);
  console.log("i18n.self-test ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
