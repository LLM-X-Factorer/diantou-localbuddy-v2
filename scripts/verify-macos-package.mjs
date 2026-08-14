import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, resolve, join } from "node:path";
import { promisify } from "node:util";

import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const packageMetadata = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const packageVersion = packageMetadata.version;
assert.match(packageVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const appPath = resolve(
  process.argv[2] ?? ".localbuddy/forge-out/LocalBuddy-darwin-arm64/LocalBuddy.app",
);
const dmgPath = resolve(
  process.argv[3] ?? `.localbuddy/forge-out/make/LocalBuddy-${packageVersion}-arm64.dmg`,
);
const executable = join(appPath, "Contents", "MacOS", "LocalBuddy");
const resources = join(appPath, "Contents", "Resources");
const browserRoot = join(resources, "ms-playwright");
const verificationRoot = resolve(".localbuddy", "package-verification");
const screenshot = join(verificationRoot, "desktop.png");
await mkdir(verificationRoot, { recursive: true });

const { stdout: bundleVersion } = await execFileAsync("/usr/libexec/PlistBuddy", [
  "-c", "Print :CFBundleShortVersionString", join(appPath, "Contents", "Info.plist"),
]);
assert.equal(bundleVersion.trim(), packageVersion);
await execFileAsync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
const { stdout: fuseOutput } = await execFileAsync(
  "pnpm",
  ["exec", "electron-fuses", "read", "--app", appPath],
);
for (const expected of [
  "RunAsNode is Disabled",
  "EnableCookieEncryption is Enabled",
  "EnableNodeOptionsEnvironmentVariable is Disabled",
  "EnableNodeCliInspectArguments is Disabled",
  "EnableEmbeddedAsarIntegrityValidation is Enabled",
  "OnlyLoadAppFromAsar is Enabled",
  "GrantFileProtocolExtraPrivileges is Disabled",
  "WasmTrapHandlers is Enabled",
]) {
  assert.match(fuseOutput, new RegExp(expected));
}

const stagedBrowsers = await readdir(browserRoot);
assert.ok(stagedBrowsers.some((entry) => entry.startsWith("chromium_headless_shell-")));
assert.ok(stagedBrowsers.some((entry) => entry.startsWith("ffmpeg-")));

const server = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end("<!doctype html><title>LocalBuddy browser smoke</title><h1>packaged browser ready</h1>");
});
await new Promise((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolvePromise);
});
try {
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserRoot;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    assert.equal(await page.title(), "LocalBuddy browser smoke");
    assert.equal(await page.locator("h1").innerText(), "packaged browser ready");
  } finally {
    await browser.close();
  }
} finally {
  await new Promise((resolvePromise, reject) => server.close((error) => {
    if (error === undefined) resolvePromise();
    else reject(error);
  }));
}

await runApp(executable, {
  ...process.env,
  LOCALBUDDY_DEFAULT_WORKSPACE: process.cwd(),
  LOCALBUDDY_SCREENSHOT_PATH: screenshot,
});
const diagnostics = JSON.parse(await readFile(`${screenshot}.json`, "utf8"));
assert.equal(diagnostics.url, "localbuddy://app/index.html");
assert.equal(diagnostics.api, "object");
assert.equal(diagnostics.rootChildren, 1);
assert.ok(diagnostics.bodyCharacters > 100);
assert.equal(diagnostics.goalContractVisible, true);
assert.equal(diagnostics.goalFieldCount, 3);
assert.equal(diagnostics.planReviewGuideVisible, true);
assert.match(diagnostics.startButtonText, /生成计划/);
assert.ok((await stat(screenshot)).size > 10_000);

await execFileAsync("hdiutil", ["verify", dmgPath]);
const mountRoot = await mkdtemp(join(tmpdir(), "localbuddy-dmg-verify-"));
let mounted = false;
let mountedSymlinkCount = 0;
try {
  await execFileAsync("hdiutil", [
    "attach",
    "-readonly",
    "-nobrowse",
    "-mountpoint",
    mountRoot,
    dmgPath,
  ]);
  mounted = true;
  const mountedAppPath = join(mountRoot, "LocalBuddy.app");
  await execFileAsync("codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    mountedAppPath,
  ]);
  mountedSymlinkCount = await verifyRelativeSymlinks(mountedAppPath);
  assert.ok(mountedSymlinkCount > 0, "mounted app should contain framework symlinks");
} finally {
  if (mounted) {
    await execFileAsync("hdiutil", ["detach", mountRoot]);
  }
  await rm(mountRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  appPath,
  dmgPath,
  packageVersion,
  codeSignature: "valid-ad-hoc",
  dmgIntegrity: "verified",
  mountedAppCodeSignature: "valid-ad-hoc",
  mountedSymlinkCount,
  fuses: "verified",
  packagedBrowser: "verified",
  renderer: diagnostics,
}, null, 2)}\n`);

async function runApp(command, env) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, [], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("packaged app smoke timed out"));
    }, 15_000);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else reject(new Error(`packaged app exited with ${code ?? signal}: ${stderr}`));
    });
  });
}

async function verifyRelativeSymlinks(root) {
  let count = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await readlink(entryPath);
      assert.equal(
        isAbsolute(target),
        false,
        `packaged symlink must remain relative: ${entryPath} -> ${target}`,
      );
      count += 1;
    } else if (entry.isDirectory()) {
      count += await verifyRelativeSymlinks(entryPath);
    }
  }
  return count;
}
