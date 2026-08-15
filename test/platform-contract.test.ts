import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const execFileAsync = promisify(execFile);

test("assigns Canary versions above the latest stable release", async () => {
  const script = resolve(repository, "scripts", "prepare-windows-canary-version.mjs");
  const scenarios = [
    { packageVersion: "0.12.2", stableTag: "v0.12.2", expected: "0.12.3-canary.38" },
    { packageVersion: "0.12.3", stableTag: "v0.12.2", expected: "0.12.3-canary.38" },
  ];

  for (const scenario of scenarios) {
    const workingDirectory = await mkdtemp(resolve(tmpdir(), "localbuddy-canary-version-"));
    try {
      await writeFile(
        resolve(workingDirectory, "package.json"),
        `${JSON.stringify({ version: scenario.packageVersion }, null, 2)}\n`,
        "utf8",
      );
      const result = await execFileAsync(process.execPath, [script, "38", scenario.stableTag], {
        cwd: workingDirectory,
      });
      const packageJson = JSON.parse(await readFile(resolve(workingDirectory, "package.json"), "utf8")) as {
        version: string;
      };
      assert.equal(result.stdout.trim(), scenario.expected);
      assert.equal(packageJson.version, scenario.expected);
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }
});

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
  assert.match(packageJson.scripts["verify:windows-upgrade-installer"] ?? "", /verify-windows-installer-upgrade\.ps1/);
  assert.match(packageJson.scripts["windows:canary"] ?? "", /sync-windows-canary\.ps1/);
  const forgeConfig = await readFile(resolve(repository, "forge.config.cjs"), "utf8");
  assert.match(forgeConfig, /LOCALBUDDY_BUILD_VERSION/);
  assert.match(forgeConfig, /appVersion: packageVersion/);
  assert.match(forgeConfig, /version: packageVersion/);
  assert.match(forgeConfig, /setupExe: `LocalBuddy-\$\{packageVersion\}-Setup\.exe`/);
  assert.match(forgeConfig, /depends: \["libsecret-tools"\]/);
  const canarySync = await readFile(resolve(repository, "scripts", "sync-windows-canary.ps1"), "utf8");
  assert.match(canarySync, /gh auth status/);
  assert.match(canarySync, /localbuddy-windows-canary/);
  assert.match(canarySync, /\$buildsRoot = Join-Path \$CanaryRoot "builds"/);
  assert.match(canarySync, /--user-data-dir=/);
  assert.match(canarySync, /current\.json/);
  assert.doesNotMatch(canarySync, /Remove-Item[^\n]*LocalBuddy-Canary[\\/]builds/);
  const upgradeVerification = await readFile(resolve(repository, "scripts", "verify-windows-installer-upgrade.ps1"), "utf8");
  assert.match(upgradeVerification, /Refusing to overwrite an existing LocalBuddy installation or user profile/);
  assert.match(upgradeVerification, /--update/);
  assert.match(upgradeVerification, /User profile marker was lost during the in-place update/);
  assert.match(upgradeVerification, /buildIdentity/);
  assert.match(upgradeVerification, /upgrade-summary\.json/);
  const workflow = await readFile(resolve(repository, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(workflow, /windows-2025/);
  assert.match(workflow, /macos-15/);
  assert.match(workflow, /pnpm check/);
  assert.match(workflow, /playwright install --only-shell chromium/);
  assert.match(workflow, /Install Windows Setup and verify clean first launch without Provider credentials/);
  assert.match(workflow, /pnpm verify:first-run-windows-installer/);
  assert.match(workflow, /prepare-windows-canary-version\.mjs/);
  assert.match(workflow, /LOCALBUDDY_UPGRADE_BASE_TAG/);
  assert.match(workflow, /localbuddy-windows-canary-feed/);
  assert.match(workflow, /if: always\(\) && github\.event_name == 'push'/);
  assert.match(workflow, /verify-windows-installer-upgrade\.ps1/);
  assert.match(workflow, /Windows install and in-place upgrade/);
  assert.match(workflow, /\.localbuddy\/first-run-smoke\/win32-installer\/\*\*/);
  assert.doesNotMatch(workflow, /make:linux/);

  const windowsGray = await readFile(resolve(repository, ".github", "workflows", "windows-gray.yml"), "utf8");
  assert.match(windowsGray, /windows-2025/);
  assert.match(windowsGray, /pnpm verify:windows-gray-installer/);
  assert.match(windowsGray, /playwright install --only-shell chromium/);
  assert.match(windowsGray, /LOCALBUDDY_GRAY_FAULT_MATRIX/);
  assert.match(windowsGray, /LOCALBUDDY_GRAY_SOAK_CYCLES/);
  assert.match(windowsGray, /github\.event_name != 'workflow_dispatch' \|\| inputs\.fault_matrix/);
  assert.match(windowsGray, /github\.event_name == 'workflow_dispatch' && inputs\.soak_cycles \|\| '5'/);
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
  assert.match(workflow, /verify-windows-installer-upgrade\.ps1/);
  assert.match(workflow, /\.nupkg/);
  assert.match(workflow, /RELEASES/);
  assert.match(workflow, /localbuddy-windows-gray-evidence/);
  assert.match(workflow, /--prerelease/);
  assert.match(workflow, /online-update-smoke/);
  assert.match(workflow, /update\.electronjs\.org/);
  assert.match(workflow, /github\.event\.repository\.private == false/);
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
