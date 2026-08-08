import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, join } from "node:path";
import { promisify } from "node:util";

import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const appPath = resolve(
  process.argv[2] ?? ".localbuddy/forge-out/LocalBuddy-darwin-arm64/LocalBuddy.app",
);
const executable = join(appPath, "Contents", "MacOS", "LocalBuddy");
const resources = join(appPath, "Contents", "Resources");
const browserRoot = join(resources, "ms-playwright");
const verificationRoot = resolve(".localbuddy", "package-verification");
const screenshot = join(verificationRoot, "desktop.png");
await mkdir(verificationRoot, { recursive: true });

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
assert.ok((await stat(screenshot)).size > 10_000);

process.stdout.write(`${JSON.stringify({
  appPath,
  codeSignature: "valid-ad-hoc",
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
