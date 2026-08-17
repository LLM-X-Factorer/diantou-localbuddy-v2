import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  assert.match(upgradeVerification, /--checkForUpdate/);
  assert.match(upgradeVerification, /--download/);
  assert.match(upgradeVerification, /Squirrel \$Phase exceeded the \$\{TimeoutSeconds\}s diagnostic timeout/);
  assert.match(upgradeVerification, /squirrel-package-state\.json/);
  assert.match(upgradeVerification, /ConvertTo-SanitizedDiagnosticText/);
  const githubCliRetry = await readFile(resolve(repository, "scripts", "invoke-github-cli-with-retry.ps1"), "utf8");
  assert.match(githubCliRetry, /MaximumAttempts = 5/);
  assert.match(githubCliRetry, /Start-Sleep -Seconds \$delaySeconds/);
  assert.doesNotMatch(githubCliRetry, /GH_TOKEN/);
  const workflow = await readFile(resolve(repository, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(workflow, /windows-2025/);
  assert.match(workflow, /macos-15/);
  assert.match(workflow, /pnpm check/);
  assert.match(workflow, /playwright install --only-shell chromium/);
  assert.match(workflow, /Install Windows Setup and verify clean first launch without Provider credentials/);
  assert.match(workflow, /pnpm verify:first-run-windows-installer/);
  assert.match(workflow, /prepare-windows-canary-version\.mjs/);
  assert.match(workflow, /LOCALBUDDY_UPGRADE_BASE_TAG/);
  assert.match(workflow, /invoke-github-cli-with-retry\.ps1/);
  assert.match(workflow, /localbuddy-windows-canary-feed/);
  assert.match(workflow, /if: always\(\) && github\.event_name == 'push'/);
  assert.match(workflow, /verify-windows-installer-upgrade\.ps1/);
  assert.match(workflow, /Windows install and in-place upgrade/);
  assert.match(workflow, /\.localbuddy\/first-run-smoke\/win32-installer\/\*\*/);
  assert.ok((workflow.match(/include-hidden-files: true/g) ?? []).length >= 2);
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
  assert.doesNotMatch(workflow, /publish-release:/);
  assert.doesNotMatch(workflow, /actions\/download-artifact/);
  assert.match(workflow, /needs: \[windows-release\]/);
  assert.match(workflow, /pnpm make:win/);
  assert.doesNotMatch(workflow, /pnpm make:linux/);
  assert.equal((workflow.match(/pnpm audit --prod --audit-level high/g) ?? []).length, 1);
  assert.match(workflow, /SHA256SUMS-windows\.txt/);
  assert.doesNotMatch(workflow, /SHA256SUMS-linux\.txt/);
  assert.match(workflow, /Verify and publish Windows-first GitHub Release from verified Windows bytes/);
  assert.match(workflow, /node scripts\/publish-windows-release\.mjs/);
  assert.match(workflow, /invoke-github-cli-with-retry\.ps1/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /pnpm verify:windows-gray-installer/);
  assert.match(workflow, /verify-windows-installer-upgrade\.ps1/);
  assert.match(workflow, /\.nupkg/);
  assert.match(workflow, /RELEASES/);
  assert.match(workflow, /localbuddy-windows-gray-evidence/);
  assert.match(workflow, /online-update-smoke/);
  assert.match(workflow, /github\.event\.repository\.private == false/);
  assert.match(workflow, /https:\/\/github\.com\/\$env:GITHUB_REPOSITORY\/releases\/latest\/download/);
  assert.match(workflow, /Upgrade previous stable through the first-party GitHub Release feed/);
  assert.match(workflow, /localbuddy-windows-online-update-evidence/);
  assert.ok((workflow.match(/include-hidden-files: true/g) ?? []).length >= 3);
  assert.doesNotMatch(workflow, /update\.electronjs\.org/);
  assert.doesNotMatch(workflow, /grep -Fq "LocalBuddy-\$\{package_version\}-full\.nupkg"/);
  const onlineSmoke = await readFile(resolve(repository, ".github", "workflows", "windows-online-update-smoke.yml"), "utf8");
  assert.match(onlineSmoke, /workflow_dispatch:/);
  assert.match(onlineSmoke, /windows-2025/);
  assert.match(onlineSmoke, /"release", "list"/);
  assert.match(onlineSmoke, /invoke-github-cli-with-retry\.ps1/);
  assert.doesNotMatch(onlineSmoke, /gh api "repos\/\$env:GITHUB_REPOSITORY\/releases/);
  assert.match(onlineSmoke, /releases\/latest\/download/);
  assert.match(onlineSmoke, /verify-windows-installer-upgrade\.ps1/);
  assert.match(onlineSmoke, /timeout-minutes: 45/);
  assert.match(onlineSmoke, /include-hidden-files: true/);
  const publishScript = await readFile(resolve(repository, "scripts", "publish-windows-release.mjs"), "utf8");
  assert.match(publishScript, /--prerelease/);
  assert.match(publishScript, /Checksum mismatch/);
  assert.match(publishScript, /shell: false/);
  assert.match(publishScript, /GITHUB_MAX_ATTEMPTS = 5/);
});

test("current product-truth documents stay aligned with the released package", async () => {
  const packageJson = JSON.parse(await readFile(resolve(repository, "package.json"), "utf8")) as {
    version: string;
  };
  const release = `v${packageJson.version}`;
  const releasePattern = new RegExp(release.replaceAll(".", "\\."));
  const [readme, quickstart, dogfood, roadmap, productDefinition, portfolioDecision, sprint] = await Promise.all([
    readFile(resolve(repository, "README.md"), "utf8"),
    readFile(resolve(repository, "docs", "QUICKSTART.md"), "utf8"),
    readFile(resolve(repository, "docs", "DOGFOOD.md"), "utf8"),
    readFile(resolve(repository, "docs", "ROADMAP.md"), "utf8"),
    readFile(resolve(repository, "docs", "PRODUCT-DEFINITION-V2.md"), "utf8"),
    readFile(resolve(repository, "docs", "PRODUCT-PORTFOLIO-DECISION-2026-08-15.md"), "utf8"),
    readFile(resolve(repository, "docs", "M13-PRODUCT-TRUTH-SPRINT.md"), "utf8"),
  ]);

  for (const document of [readme, quickstart, dogfood, roadmap]) {
    assert.match(document, releasePattern);
  }
  assert.ok(quickstart.includes("[`" + release + "` Release]"));
  assert.match(dogfood, /M13 Product Truth Sprint/);
  assert.match(roadmap, /M13 · Product Truth Sprint — active/);
  assert.match(productDefinition, /M13 Product Truth Sprint/);
  assert.match(portfolioDecision, /转入 M13 产品事实验证/);
  assert.match(sprint, /判断 Research Desk 应该 `advance`、`pause` 还是 `stop`/);
  assert.doesNotMatch(productDefinition, /M12\.1-M12\.4 是未发布/);
  assert.doesNotMatch(portfolioDecision, /未发布的 M12\.1-M12\.4/);

  for (const fileName of ["M12.1-SPEC.md", "M12.2-SPEC.md", "M12.3-SPEC.md", "M12.4-SPEC.md"]) {
    const specification = await readFile(resolve(repository, "docs", fileName), "utf8");
    assert.match(specification, /已随公开但未签名的 `v0\.12\.4` Engineering Alpha 发布/);
  }
});

test("verifies Windows Release bytes without an Actions artifact handoff", async () => {
  const workingDirectory = await mkdtemp(resolve(tmpdir(), "localbuddy-release-publish-"));
  const assetsDirectory = resolve(workingDirectory, "release-assets");
  const script = resolve(repository, "scripts", "publish-windows-release.mjs");
  const assets = new Map([
    ["LocalBuddy-0.12.3-Setup.exe", "setup"],
    ["LocalBuddy-win32-x64-0.12.3.zip", "portable"],
    ["LocalBuddy-0.12.3-full.nupkg", "squirrel"],
    ["RELEASES", "metadata"],
  ]);
  try {
    await mkdir(assetsDirectory);
    await writeFile(resolve(workingDirectory, "package.json"), '{"version":"0.12.3"}\n', "utf8");
    for (const [name, contents] of assets) {
      await writeFile(resolve(assetsDirectory, name), contents, "utf8");
    }
    const checksums = [...assets]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, contents]) => `${createHash("sha256").update(contents).digest("hex")}  ${name}`)
      .join("\n");
    await writeFile(resolve(assetsDirectory, "SHA256SUMS-windows.txt"), `${checksums}\n`, "utf8");

    const verified = await execFileAsync(process.execPath, [script, "--verify-only"], {
      cwd: workingDirectory,
      env: { ...process.env, GITHUB_REF_NAME: "v0.12.3" },
    });
    assert.match(verified.stdout, /Verified 5 Windows release files for v0\.12\.3/);

    await writeFile(resolve(assetsDirectory, "RELEASES"), "tampered", "utf8");
    await assert.rejects(
      execFileAsync(process.execPath, [script, "--verify-only"], {
        cwd: workingDirectory,
        env: { ...process.env, GITHUB_REF_NAME: "v0.12.3" },
      }),
      /Checksum mismatch for RELEASES/,
    );
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
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
