const fs = require("node:fs");
const { chromium } = require("playwright");

function findChromeExecutable() {
  if (process.env.PLAYWRIGHT_CHROME_PATH) return process.env.PLAYWRIGHT_CHROME_PATH;

  const candidates = [
    process.env.ProgramFiles && `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env["ProgramFiles(x86)"] && `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env.ProgramFiles && `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    process.env["ProgramFiles(x86)"] && `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function readEnvValue(name) {
  const envText = fs.readFileSync(".env", "utf8");
  for (const line of envText.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    if (line.slice(0, index).trim() !== name) continue;
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

(async () => {
  const password = readEnvValue("VNC_PASSWORD");
  const executablePath = findChromeExecutable();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  await page.goto(
    "http://127.0.0.1:5800/?shared=true&resize=scale&path=websockify",
    { waitUntil: "domcontentloaded", timeout: 20000 },
  );
  await page.evaluate(() => {
    localStorage.removeItem("view_only");
    localStorage.setItem("view_clip", "false");
  });
  await page.waitForTimeout(2000);

  const passwordInput = page.locator("input[type=password]").first();
  if (await passwordInput.count()) {
    await passwordInput.fill(password);
    await page.keyboard.press("Enter");
  }

  await page.waitForTimeout(6000);
  const canvas = page.locator("canvas").first();
  await canvas.waitFor({ timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas bounding box");

  const state = await page.evaluate(() => ({
    href: location.href.replace(/password=[^&]*/g, "password=***"),
    status: document.querySelector("#noVNC_status")?.textContent?.trim() || "",
    active: document.activeElement
      ? {
          tag: document.activeElement.tagName,
          id: document.activeElement.id,
        }
      : null,
    viewOnly: localStorage.getItem("view_only"),
    selected: [...document.querySelectorAll(".noVNC_selected")].map((e) => e.id),
    canvasCount: document.querySelectorAll("canvas").length,
  }));

  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    globalThis.__sdvInputProbe = [];
    for (const eventName of ["keydown", "keyup", "mousedown", "mouseup", "click"]) {
      canvas.addEventListener(
        eventName,
        (event) => {
          globalThis.__sdvInputProbe.push({
            type: event.type,
            key: event.key,
            code: event.code,
            button: event.button,
            buttons: event.buttons,
            active: document.activeElement?.tagName,
          });
        },
        true,
      );
    }
  });

  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await page.keyboard.press("A");
  await page.keyboard.press("Enter");
  await page.mouse.click(box.x + Math.min(300, box.width - 10), box.y + Math.min(300, box.height - 10));
  await page.waitForTimeout(3000);

  const eventProbe = await page.evaluate(() => globalThis.__sdvInputProbe || []);

  await browser.close();
  console.log(JSON.stringify({ state, canvas: box, eventProbe, inputSent: ["mouse", "Escape", "A", "Enter"] }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
