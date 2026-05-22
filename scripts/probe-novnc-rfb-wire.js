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
  const browser = await chromium.launch({
    executablePath: findChromeExecutable(),
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  await page.goto(
    `http://127.0.0.1:5800/?shared=true&resize=scale&path=websockify&password=${encodeURIComponent(password)}`,
    { waitUntil: "domcontentloaded", timeout: 20000 },
  );
  await page.waitForTimeout(8000);

  const result = await page.evaluate(async () => {
    const uiMod = await import("./app/ui.js?v=9d7b76637b");
    const rfbMod = await import("./core/rfb.js?v=9d7b76637b");
    const rfb = uiMod.default.rfb;
    const calls = [];

    const messages = rfbMod.default.messages;
    const originalKeyEvent = messages.keyEvent;
    const originalQemuKeyEvent = messages.QEMUExtendedKeyEvent;
    const originalPointerEvent = messages.pointerEvent;
    const originalExtendedPointerEvent = messages.extendedPointerEvent;

    messages.keyEvent = function patchedKeyEvent(sock, keysym, down) {
      calls.push({ type: "keyEvent", keysym, down });
      return originalKeyEvent.apply(this, arguments);
    };
    messages.QEMUExtendedKeyEvent = function patchedQemu(sock, keysym, down, keycode) {
      calls.push({ type: "qemuKeyEvent", keysym, down, keycode });
      return originalQemuKeyEvent.apply(this, arguments);
    };
    messages.pointerEvent = function patchedPointer(sock, x, y, mask) {
      calls.push({ type: "pointerEvent", x, y, mask });
      return originalPointerEvent.apply(this, arguments);
    };
    messages.extendedPointerEvent = function patchedExtendedPointer(sock, x, y, mask) {
      calls.push({ type: "extendedPointerEvent", x, y, mask });
      return originalExtendedPointerEvent.apply(this, arguments);
    };

    rfb.focus();
    rfb.sendKey(0xff1b, "Escape");
    rfb.sendKey(0x0061, "KeyA");
    rfb.sendKey(0xff0d, "Enter");
    rfb._sendMouse(960, 540, 0);
    rfb._sendMouse(960, 540, 1);
    rfb._sendMouse(960, 540, 0);

    return {
      state: rfb._rfbConnectionState,
      viewOnly: rfb.viewOnly,
      qemuExtKeyEventSupported: rfb._qemuExtKeyEventSupported,
      extendedPointerEventSupported: rfb._extendedPointerEventSupported,
      sockOpen: Boolean(rfb._sock?._websocket),
      calls,
      status: document.querySelector("#noVNC_status")?.textContent?.trim() || "",
    };
  });

  await page.waitForTimeout(1000);
  await browser.close();
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
