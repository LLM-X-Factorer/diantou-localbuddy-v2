import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("declares Windows-first CI plus low-frequency Linux maintenance boundaries", async () => {
  const packageJson = JSON.parse(await readFile(resolve(repository, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.match(packageJson.scripts["make:linux"] ?? "", /--platform=linux/);
  assert.match(packageJson.scripts["make:win"] ?? "", /--platform=win32/);
  assert.equal(packageJson.devDependencies["@electron-forge/maker-deb"], "7.11.2");
  assert.equal(packageJson.devDependencies["@electron-forge/maker-squirrel"], "7.11.2");
  assert.equal(packageJson.dependencies["electron-squirrel-startup"], "1.0.1");
  assert.match(packageJson.scripts["verify:first-run-windows-installer"] ?? "", /verify-windows-installer-first-launch\.ps1/);
  assert.match(packageJson.scripts["verify:windows-gray-installer"] ?? "", /verify-windows-installer-gray\.ps1/);
  const forgeConfig = await readFile(resolve(repository, "forge.config.cjs"), "utf8");
  assert.match(forgeConfig, /const \{ version: packageVersion \} = require\("\.\/package\.json"\)/);
  assert.match(forgeConfig, /setupExe: `LocalBuddy-\$\{packageVersion\}-Setup\.exe`/);
  assert.match(forgeConfig, /depends: \["libsecret-tools"\]/);
  const workflow = await readFile(resolve(repository, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(workflow, /windows-2025/);
  assert.match(workflow, /macos-15/);
  assert.match(workflow, /pnpm check/);
  assert.match(workflow, /Install Windows Setup and verify clean first launch without Provider credentials/);
  assert.match(workflow, /pnpm verify:first-run-windows-installer/);
  assert.match(workflow, /\.localbuddy\/first-run-smoke\/win32-installer\/\*\*/);
  assert.doesNotMatch(workflow, /make:linux/);

  const windowsGray = await readFile(resolve(repository, ".github", "workflows", "windows-gray.yml"), "utf8");
  assert.match(windowsGray, /windows-2025/);
  assert.match(windowsGray, /pnpm verify:windows-gray-installer/);
  assert.match(windowsGray, /LOCALBUDDY_GRAY_FAULT_MATRIX/);
  assert.match(windowsGray, /LOCALBUDDY_GRAY_SOAK_CYCLES/);
  assert.match(windowsGray, /windows-gray/);
  assert.match(windowsGray, /schedule:/);
  assert.match(windowsGray, /workflow_dispatch:/);
  assert.doesNotMatch(windowsGray, /secrets\./);

  const linuxMaintenance = await readFile(resolve(repository, ".github", "workflows", "linux-maintenance.yml"), "utf8");
  assert.match(linuxMaintenance, /ubuntu-24\.04/);
  assert.match(linuxMaintenance, /make:linux/);
  assert.match(linuxMaintenance, /schedule:/);
  assert.match(linuxMaintenance, /workflow_dispatch:/);
  assert.doesNotMatch(linuxMaintenance, /pull_request:/);
});

test("tag releases publish Windows only after installed-app synthetic gray passes", async () => {
  const workflow = await readFile(resolve(repository, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /windows-release:/);
  assert.match(workflow, /publish-release:/);
  assert.match(workflow, /needs: \[windows-release\]/);
  assert.match(workflow, /pnpm make:win/);
  assert.doesNotMatch(workflow, /pnpm make:linux/);
  assert.equal((workflow.match(/pnpm audit --prod --audit-level high/g) ?? []).length, 1);
  assert.match(workflow, /SHA256SUMS-windows\.txt/);
  assert.doesNotMatch(workflow, /SHA256SUMS-linux\.txt/);
  assert.match(workflow, /expected_tag="v\$\{package_version\}"/);
  assert.match(workflow, /pnpm verify:windows-gray-installer/);
  assert.match(workflow, /localbuddy-windows-gray-evidence/);
  assert.match(workflow, /--prerelease/);
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
