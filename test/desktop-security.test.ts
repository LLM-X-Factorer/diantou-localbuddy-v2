import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("desktop runtime uses the privileged local protocol and Electron isolation controls", async () => {
  const main = await readFile("desktop/main.ts", "utf8");
  const html = await readFile("desktop/renderer/index.html", "utf8");
  const renderer = await readFile("desktop/renderer/src/App.tsx", "utf8");

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
  assert.match(main, /storeProviderApiKey\(parsed\.providerId, parsed\.apiKey\)/);
  assert.match(main, /deleteProviderApiKey\(providerId\)/);
  assert.match(main, /probeProviderConnection/);
  assert.match(main, /确认从系统安全存储中删除/);
  assert.match(renderer, /type="password"/);
  assert.doesNotMatch(renderer, /localStorage|sessionStorage/);
  assert.match(main, /const result = await dialog\.showSaveDialog\(options\)/);
  assert.doesNotMatch(main, /showSaveDialog\(mainWindow/);
  assert.match(main, /runManager\.loadArtifactPreview/);
  assert.match(main, /runManager\.resolveArtifactPath/);
  assert.match(main, /createTutorialWorkspace/);
  assert.match(main, /inspectProviderCredential\("deepseek"\)/);
  assert.match(main, /inspectProviderCredential\("openai"\)/);
  assert.match(renderer, /Provider 是真实运行的必要条件，不属于 Skills、MCP 或 Browser 扩展/);
  assert.match(renderer, /!selectedProviderCredential\.available/);
  assert.match(renderer, /保存只验证本机安全写入，不会自动联网/);
  assert.match(renderer, /点击“验证连接”会把凭据发送到上方显示的 Provider \/ Base URL/);
  assert.match(renderer, /没有发起模型生成或产生模型 token/);
  assert.match(renderer, /provider-settings-error/);
  assert.match(main, /requestedWorkspace === undefined\s*\? ""/);
  assert.match(main, /providerDialogVisible/);
  assert.match(main, /verifyDisabled/);
  assert.match(main, /startDisabled/);
  assert.match(main, /electron-squirrel-startup/);
  assert.match(main, /requireForSquirrel/);
  assert.doesNotMatch(main, /recentWorkspaces\[0\]\s*\?\? app\.getPath\("documents"\)/);
  assert.match(renderer, /我不会在这里调用模型、读取文件或启动任务/);
  assert.match(renderer, /只有点击“开始任务”后才会调用 Provider/);
  assert.match(main, /确认创建一个反向 Git commit 吗/);
  assert.match(main, /原提交会保留在历史中/);
});

test("Forge package is ASAR-only and declares every Electron 43 fuse", async () => {
  const config = await readFile("forge.config.cjs", "utf8");
  const makeDmg = await readFile("scripts/make-dmg.mjs", "utf8");
  const verifyMacPackage = await readFile("scripts/verify-macos-package.mjs", "utf8");
  const verifyCleanFirstLaunch = await readFile("scripts/verify-clean-first-launch.mjs", "utf8");
  const verifyWindowsInstaller = await readFile("scripts/verify-windows-installer-first-launch.ps1", "utf8");

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
  assert.match(config, /localbuddy-icon\.icns/);
  assert.match(config, /localbuddy-icon\.ico/);
  assert.match(config, /localbuddy-icon\.png/);
  assert.match(config, /icon: brandIcon/);
  assert.match(config, /setupIcon: windowsBrandIcon/);
  assert.match(config, /icon: linuxBrandIcon/);
  assert.match(makeDmg, /readFile\(resolve\("package\.json"\)/);
  assert.match(makeDmg, /`LocalBuddy-\$\{packageVersion\}-arm64\.dmg`/);
  assert.doesNotMatch(makeDmg, /LocalBuddy-\d+\.\d+\.\d+-arm64\.dmg/);
  assert.match(verifyMacPackage, /`\.localbuddy\/forge-out\/make\/LocalBuddy-\$\{packageVersion\}-arm64\.dmg`/);
  assert.match(verifyMacPackage, /CFBundleShortVersionString/);
  assert.doesNotMatch(verifyMacPackage, /LocalBuddy-\d+\.\d+\.\d+-arm64\.dmg/);
  assert.match(verifyCleanFirstLaunch, /DEEPSEEK_API_KEY/);
  assert.match(verifyCleanFirstLaunch, /OPENAI_API_KEY/);
  assert.match(verifyCleanFirstLaunch, /credentialCommandPath: "empty"/);
  assert.match(verifyCleanFirstLaunch, /providerChoices/);
  assert.match(verifyCleanFirstLaunch, /verifyDisabled/);
  assert.match(verifyCleanFirstLaunch, /startDisabled/);
  assert.match(verifyWindowsInstaller, /LocalBuddy-\$version-Setup\.exe/);
  assert.match(verifyWindowsInstaller, /--silent/);
  assert.match(verifyWindowsInstaller, /app-\$version\/LocalBuddy\.exe/);
  assert.match(verifyWindowsInstaller, /Refusing to overwrite an existing LocalBuddy installation or user profile/);
  assert.match(verifyWindowsInstaller, /pnpm verify:first-run-package/);
  assert.match(verifyWindowsInstaller, /--uninstall/);
});

test("Renderer uses the shared LocalBuddy brand icon instead of a text placeholder", async () => {
  const renderer = await readFile("desktop/renderer/src/App.tsx", "utf8");
  const styles = await readFile("desktop/renderer/src/styles.css", "utf8");

  assert.match(renderer, /assets\/brand\/localbuddy-icon\.png/);
  assert.match(renderer, /<img src=\{localBuddyIcon\} alt="" \/>/);
  assert.doesNotMatch(renderer, /<span className="brand-mark">LB<\/span>/);
  assert.match(styles, /\.brand-mark img/);
});

test("Renderer composer is a compact input plus wrapping control toolbar", async () => {
  const renderer = await readFile("desktop/renderer/src/App.tsx", "utf8");
  const styles = await readFile("desktop/renderer/src/styles.css", "utf8");

  assert.match(renderer, /className="control-label">Provider<\/span>/);
  assert.match(renderer, /aria-expanded=\{extensionsOpen\}/);
  assert.match(renderer, /providerCredentialCompactLabel/);
  assert.match(styles, /\.composer textarea \{[^}]*height: 46px/);
  assert.match(styles, /\.composer-actions \{ display: grid; grid-template-columns: minmax\(0,1fr\) auto/);
  assert.match(styles, /\.composer-options \{ display: flex; flex-wrap: wrap/);
  assert.match(styles, /\.control-label \{ position: absolute; width: 1px; height: 1px/);
  assert.match(styles, /\.extensions-toggle \{[^}]*min-height: 32px/);
  assert.doesNotMatch(styles, /\.composer-actions \{[^}]*repeat\(16/);
});

test("brand assets provide native macOS, Windows, and Linux icon formats", async () => {
  const [png, icns, ico] = await Promise.all([
    readFile("assets/brand/localbuddy-icon.png"),
    readFile("assets/brand/localbuddy-icon.icns"),
    readFile("assets/brand/localbuddy-icon.ico"),
  ]);

  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(icns.subarray(0, 4).toString("ascii"), "icns");
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 7);
});
