import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("declares native Linux and Windows packaging plus CI acceptance boundaries", async () => {
  const packageJson = JSON.parse(await readFile(resolve(repository, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.match(packageJson.scripts["make:linux"] ?? "", /--platform=linux/);
  assert.match(packageJson.scripts["make:win"] ?? "", /--platform=win32/);
  assert.equal(packageJson.devDependencies["@electron-forge/maker-deb"], "7.11.2");
  assert.equal(packageJson.devDependencies["@electron-forge/maker-squirrel"], "7.11.2");
  const forgeConfig = await readFile(resolve(repository, "forge.config.cjs"), "utf8");
  assert.match(forgeConfig, /const \{ version: packageVersion \} = require\("\.\/package\.json"\)/);
  assert.match(forgeConfig, /setupExe: `LocalBuddy-\$\{packageVersion\}-Setup\.exe`/);
  assert.match(forgeConfig, /depends: \["libsecret-tools"\]/);
  const workflow = await readFile(resolve(repository, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(workflow, /ubuntu-24\.04/);
  assert.match(workflow, /windows-2025/);
  assert.match(workflow, /macos-15/);
  assert.match(workflow, /Verify clean first launch without Provider credentials/);
  assert.match(workflow, /pnpm verify:first-run-package/);
});

test("tag releases synchronize native Windows and Linux assets before publication", async () => {
  const workflow = await readFile(resolve(repository, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /windows-release:/);
  assert.match(workflow, /linux-release:/);
  assert.match(workflow, /publish-release:/);
  assert.match(workflow, /needs: \[windows-release, linux-release\]/);
  assert.match(workflow, /pnpm make:win/);
  assert.match(workflow, /pnpm make:linux/);
  assert.equal((workflow.match(/pnpm audit --prod --audit-level high/g) ?? []).length, 2);
  assert.match(workflow, /SHA256SUMS-windows\.txt/);
  assert.match(workflow, /SHA256SUMS-linux\.txt/);
  assert.match(workflow, /expected_tag="v\$\{package_version\}"/);
  assert.match(workflow, /merge-multiple: true/);
  assert.match(workflow, /Verify clean first launch without Provider credentials/);
  assert.match(workflow, /localbuddy-clean-first-launch-windows/);
});

test("platform process execution has explicit Linux isolation and Windows fail-closed text", async () => {
  const executionHost = await readFile(resolve(repository, "src", "execution-host.ts"), "utf8");
  for (const expected of [
    "--pull=never",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=256",
    "--network=",
  ]) {
    assert.match(executionHost, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(executionHost, /Local process execution is disabled on Windows/);
  assert.doesNotMatch(executionHost, /fallback.*execFile|fallback.*spawn/i);
});
