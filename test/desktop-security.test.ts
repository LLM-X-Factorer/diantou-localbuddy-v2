import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop runtime uses the privileged local protocol and Electron isolation controls", async () => {
  const main = await readFile("desktop/main.ts", "utf8");
  const html = await readFile("desktop/renderer/index.html", "utf8");

  assert.match(main, /protocol\.registerSchemesAsPrivileged/);
  assert.match(main, /app\.enableSandbox\(\)/);
  assert.match(main, /const rendererUrl = "localbuddy:\/\/app\/index\.html"/);
  assert.match(main, /protocol\.handle\("localbuddy"/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
  assert.match(main, /will-attach-webview/);
  assert.doesNotMatch(main, /\.loadFile\(/);
  assert.doesNotMatch(html, /unsafe-inline/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
});

test("Forge package is ASAR-only and declares every Electron 43 fuse", async () => {
  const config = await readFile("forge.config.cjs", "utf8");

  assert.match(config, /asar: true/);
  assert.match(config, /strictlyRequireAllFuses: true/);
  for (const fuse of [
    "RunAsNode",
    "EnableCookieEncryption",
    "EnableNodeOptionsEnvironmentVariable",
    "EnableNodeCliInspectArguments",
    "EnableEmbeddedAsarIntegrityValidation",
    "OnlyLoadAppFromAsar",
    "LoadBrowserProcessSpecificV8Snapshot",
    "GrantFileProtocolExtraPrivileges",
    "WasmTrapHandlers",
  ]) {
    assert.match(config, new RegExp(`FuseV1Options\\.${fuse}`));
  }
  assert.match(config, /identity: "-"/);
  assert.match(config, /hardenedRuntime: false/);
});
