import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const executable = resolve(process.argv[2] ?? defaultExecutable());
const evidenceRoot = resolve(
  process.argv[3] ?? join(".localbuddy", "first-run-smoke", process.platform),
);
const screenshot = join(evidenceRoot, "clean-first-launch.png");
const isolatedRoot = await mkdtemp(join(tmpdir(), "localbuddy-clean-first-launch-"));
const emptyPath = join(isolatedRoot, "empty-path");
const userData = join(isolatedRoot, "user-data");
await Promise.all([
  mkdir(emptyPath, { recursive: true }),
  mkdir(userData, { recursive: true }),
  mkdir(dirname(screenshot), { recursive: true }),
]);

try {
  await runApp(executable, [`--user-data-dir=${userData}`], cleanEnvironment(emptyPath, screenshot));
  const diagnostics = JSON.parse(await readFile(`${screenshot}.json`, "utf8"));

  assert.equal(diagnostics.url, "localbuddy://app/index.html");
  assert.equal(diagnostics.title, "LocalBuddy V2");
  assert.equal(diagnostics.api, "object");
  assert.equal(diagnostics.rootChildren, 1);
  assert.ok(diagnostics.bodyCharacters > 100);
  assert.equal(diagnostics.guideVisible, true);
  assert.equal(diagnostics.goalContractVisible, true);
  assert.equal(diagnostics.goalFieldCount, 3);
  assert.equal(diagnostics.planReviewGuideVisible, true);
  assert.equal(diagnostics.storageDisclosureVisible, true);
  assert.equal(diagnostics.storageDetailsVisible, true);
  assert.match(diagnostics.startButtonText, /生成计划/);
  assert.match(diagnostics.buildIdentity, /^(DEV|CANARY|BETA|STABLE)\s+v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)? · [a-f0-9]{7,40}(?:\+dirty)?$/);
  assert.equal(diagnostics.providerDialogVisible, true);
  assert.match(diagnostics.providerEntry, /DeepSeek/);
  assert.match(diagnostics.providerEntry, /未配置/);
  assert.equal(diagnostics.providerChoices.length, 2);
  assert.ok(diagnostics.providerChoices.some((choice) => /DeepSeek/.test(choice) && /尚未保存 API Key/.test(choice)));
  assert.ok(diagnostics.providerChoices.some((choice) => /OpenAI/.test(choice) && /尚未保存 API Key/.test(choice)));
  assert.match(diagnostics.providerSummary, /DeepSeek/);
  assert.match(diagnostics.providerSummary, /未配置/);
  assert.equal(diagnostics.verifyDisabled, true);
  assert.equal(diagnostics.startDisabled, true);
  assert.ok((await stat(screenshot)).size > 10_000);

  process.stdout.write(`${JSON.stringify({
    executable,
    platform: process.platform,
    credentialEnvironment: "cleared",
    credentialCommandPath: "empty",
    isolatedUserData: true,
    screenshot,
    diagnostics,
  }, null, 2)}\n`);
} finally {
  await rm(isolatedRoot, { recursive: true, force: true });
}

function defaultExecutable() {
  if (process.platform === "win32") {
    return join(".localbuddy", "forge-out", "LocalBuddy-win32-x64", "LocalBuddy.exe");
  }
  if (process.platform === "darwin") {
    return join(
      ".localbuddy",
      "forge-out",
      `LocalBuddy-darwin-${process.arch}`,
      "LocalBuddy.app",
      "Contents",
      "MacOS",
      "LocalBuddy",
    );
  }
  return join(".localbuddy", "forge-out", `LocalBuddy-linux-${process.arch}`, "localbuddy-v2");
}

function cleanEnvironment(emptyExecutablePath, screenshotPath) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => {
    const normalized = name.toUpperCase();
    return normalized !== "PATH"
      && normalized !== "DEEPSEEK_API_KEY"
      && normalized !== "OPENAI_API_KEY"
      && normalized !== "LOCALBUDDY_DEFAULT_WORKSPACE";
  }));
  return {
    ...environment,
    PATH: emptyExecutablePath,
    LOCALBUDDY_SCREENSHOT_PATH: screenshotPath,
    LOCALBUDDY_SHARED_COORDINATION: "0",
  };
}

async function runApp(command, args, env) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`clean first-launch smoke timed out; stdout=${stdout}; stderr=${stderr}`));
    }, 30_000);
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString("utf8")).slice(-20_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-20_000); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else reject(new Error(`packaged app exited with ${String(code ?? signal)}; stdout=${stdout}; stderr=${stderr}`));
    });
  });
}
