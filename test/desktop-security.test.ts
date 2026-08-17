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
  assert.match(main, /runManager\.loadArtifactThread/);
  assert.match(main, /runManager\.loadArtifactRevisionDiff/);
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
  assert.match(main, /!element\.innerText\.includes\('unknown'\)/);
  assert.match(main, /electron-squirrel-startup/);
  assert.match(main, /requireForSquirrel/);
  assert.match(main, /LOCALBUDDY_UPDATE_FEED_URL/);
  assert.match(main, /runManager\.isIdle\(\)/);
  assert.match(await readFile("src/desktop-run-manager.ts", "utf8"), /#mutatingIntegrations === 0/);
  assert.match(main, /重启并更新 LocalBuddy/);
  assert.match(main, /https:\/\/github\.com\/LLM-X-Factorer\/diantou-localbuddy-v2\/releases\/latest/);
  assert.match(renderer, /build-identity/);
  assert.match(renderer, /检查更新/);
  assert.match(renderer, /update-download-progress/);
  assert.match(renderer, /已等待/);
  assert.match(renderer, /打开官方下载页/);
  assert.doesNotMatch(main, /recentWorkspaces\[0\]\s*\?\? app\.getPath\("documents"\)/);
  assert.match(renderer, /我不会在这里调用模型、读取文件或启动任务/);
  assert.match(renderer, /点击“生成计划”才会调用 Provider，Worker 仍需你批准计划后才开始/);
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
  assert.match(config, /\.github\|assets\|desktop\|docs\|fixtures\|scripts\|src\|test/);
  assert.match(config, /CHANGELOG\\\.md/);
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
  assert.match(verifyWindowsInstaller, /Setup did not install exactly one versioned LocalBuddy\.exe/);
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
  assert.match(renderer, /aria-controls="goal-contract-fields"/);
  assert.match(renderer, /className="goal-contract-summary"/);
  assert.match(renderer, /结果已填写/);
  assert.match(renderer, /aria-controls="storage-disclosure-details"/);
  assert.match(renderer, /存储与隐私/);
  assert.match(renderer, /不会自动迁移或删除旧 Run/);
  assert.match(renderer, /Windows 继承所选位置的账号 ACL/);
  assert.match(styles, /\.goal-contract-summary \{ display: grid;/);
  assert.match(styles, /\.storage-disclosure \{/);
});

test("Renderer separates explicit research sources from recovery and confirms paid replay", async () => {
  const renderer = await readFile("desktop/renderer/src/App.tsx", "utf8");

  assert.match(renderer, /只读取你明确添加的资料/);
  assert.match(renderer, /不会扫描上面的运行位置/);
  assert.match(renderer, /selectResearchSources/);
  assert.doesNotMatch(renderer, /当前工作区可扫描条目超过/);
  assert.doesNotMatch(renderer, /当前工作区可扫描文件总大小超过/);
  assert.match(renderer, /selectedRun\.error && <small>\{toMessage\(selectedRun\.error\)\}<\/small>/);
  assert.match(renderer, /本次任务已经读取过的资料已被移动或删除/);
  assert.match(renderer, /selectedRun\.checkpoint\?\.status === "available"/);
  assert.match(renderer, /正在复核 checkpoint 和本次真正读取过的资料/);
  assert.match(renderer, /当前 checkpoint 不可安全重试/);
  assert.match(renderer, /window\.confirm\(/);
  assert.match(renderer, /会重新调用 Provider，并可能产生新的模型费用/);
  assert.match(renderer, /message\.replace\(\/\^Error invoking remote method/);
});

test("Renderer exposes Goal Contract fields and a Worker-blocking Plan Review decision", async () => {
  const renderer = await readFile("desktop/renderer/src/App.tsx", "utf8");
  const main = await readFile("desktop/main.ts", "utf8");

  assert.match(renderer, /GOAL CONTRACT/);
  assert.match(renderer, /完成标准/);
  assert.match(renderer, /生成计划/);
  assert.match(renderer, /Worker 和代码工作树尚未启动/);
  assert.match(renderer, /批准，开始 Worker/);
  assert.match(renderer, /resolvePlanReview/);
  assert.match(main, /requirePlanReview: true/);
});

test("Renderer starts verified Artifact revisions without embedding preview text in the Goal", async () => {
  const renderer = await readFile("desktop/renderer/src/App.tsx", "utf8");
  const main = await readFile("desktop/main.ts", "utf8");

  assert.match(renderer, /artifactContinuation/);
  assert.match(renderer, /只读资料快照/);
  assert.match(renderer, /查看上一版/);
  assert.match(renderer, /父产物身份和 SHA-256 可追溯/);
  assert.doesNotMatch(renderer, /artifactPreview\.text\.slice/);
  assert.doesNotMatch(renderer, /setGoal\(`修订 \$\{artifactPreview\.fileName\}/);
  assert.match(renderer, /请写清这次要怎样修改 \$\{artifactContinuation\.parentFileName\}/);
  assert.match(renderer, /setGoal\(""\);\r?\n    setSourcePaths\(\[\]\);/);
  assert.match(renderer, /版本历史/);
  assert.match(renderer, /只读取已登记 Artifact，不扫描工作区/);
  assert.match(renderer, /与上一版比较/);
  assert.match(renderer, /同版 \$\{sameRevisionCount\} 个分支\/尝试/);
  assert.match(renderer, /校验不可用/);
  assert.match(main, /parseArtifactContinuation/);
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
