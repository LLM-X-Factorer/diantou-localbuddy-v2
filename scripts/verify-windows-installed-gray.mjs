import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { chromium } from "playwright";

import { startWindowsGrayMockProvider } from "./windows-gray-mock-provider.mjs";

const FIXTURE_KEY = "localbuddy-windows-gray-fixture-key";
const executable = resolve(process.argv[2] ?? "");
const evidenceRoot = resolve(
  process.argv[3] ?? join(".localbuddy", "windows-gray", "installed"),
);
const faultMatrix = process.env.LOCALBUDDY_GRAY_FAULT_MATRIX === "1";
const soakCycles = boundedInteger(process.env.LOCALBUDDY_GRAY_SOAK_CYCLES, 2, 0, 20);
const temporaryRoot = await mkdtemp(join(tmpdir(), "localbuddy-windows-gray-"));
const userData = join(temporaryRoot, "user data");
const workspace = join(temporaryRoot, "Windows 灰度 工作区");
const summaryPath = join(evidenceRoot, "windows-gray-summary.json");
const successScreenshot = join(evidenceRoot, "installed-run-succeeded.png");
const restartScreenshot = join(evidenceRoot, "restart-history-and-cancel.png");

await Promise.all([
  mkdir(userData, { recursive: true }),
  mkdir(workspace, { recursive: true }),
  mkdir(evidenceRoot, { recursive: true }),
]);
await writeFile(
  join(workspace, "evidence.txt"),
  "The local Windows gray fixture confirms an installed-app research run.\n",
  "utf8",
);
assert.ok((await stat(executable)).isFile(), `Installed executable is missing: ${executable}`);

const credentialStore = await import("../dist/src/credential-store.js");
const existingCredential = await credentialStore.inspectProviderCredential("openai", {});
if (existingCredential.available) {
  throw new Error("Refusing to overwrite an existing OpenAI system credential");
}

const mockProvider = await startWindowsGrayMockProvider(FIXTURE_KEY);
let credentialStored = false;
let activeApp;

try {
  activeApp = await launchInstalledApp();
  const firstPage = activeApp.page;
  await assertCleanFirstLaunch(firstPage);
  credentialStored = true;
  await configureProvider(firstPage);
  if (faultMatrix) await verifyFaultMatrix(firstPage);
  await verifyProvider(firstPage, `${mockProvider.baseUrl}/v1`);
  const succeededRun = await startRunAndWait(firstPage, "WINDOWS_GRAY_SUCCESS", "succeeded");
  assert.ok(succeededRun.artifacts.some((artifact) => artifact.fileName === "windows-gray-report.md"));
  await firstPage.screenshot({ path: successScreenshot, fullPage: true });
  await assertRunFilesAreCredentialSafe(succeededRun.runId);
  await closeInstalledApp(activeApp);
  activeApp = undefined;

  activeApp = await launchInstalledApp();
  await assertPersistedState(activeApp.page, succeededRun.runId);
  await setProviderBaseUrl(activeApp.page, `${mockProvider.baseUrl}/v1`);
  const recoveryRun = await startRun(activeApp.page, "WINDOWS_GRAY_RECOVERY");
  await poll(
    () => mockProvider.state.recoveryInterruptions,
    (count) => count >= 1,
    30_000,
    "Recovery fixture did not reach an interruptible checkpoint",
  );
  await crashInstalledApp(activeApp);
  activeApp = undefined;

  activeApp = await launchInstalledApp();
  const interruptedRun = await poll(async () => {
    const runs = await listRuns(activeApp.page);
    return runs.find((candidate) => candidate.runId === recoveryRun.runId);
  }, (candidate) => candidate?.status === "interrupted", 20_000, "Run was not reconciled as interrupted");
  assert.equal(interruptedRun.checkpoint?.status, "available");
  await activeApp.page.evaluate(
    ({ selectedWorkspace, runId }) => globalThis.localbuddy.resumeRun({ workspace: selectedWorkspace, runId }),
    { selectedWorkspace: workspace, runId: recoveryRun.runId },
  );
  const recoveredRun = await poll(async () => {
    const runs = await listRuns(activeApp.page);
    return runs.find((candidate) => candidate.runId === recoveryRun.runId);
  }, (candidate) => candidate?.status === "succeeded", 60_000, "Interrupted Run did not resume from checkpoint");
  await assertRunFilesAreCredentialSafe(recoveredRun.runId);
  await waitForRendererActiveRuns(activeApp.page, 0);

  const cancelledRuns = await startConcurrentRunsAndCancel(activeApp.page);
  assert.ok(mockProvider.state.cancelledRequests >= 2);
  await activeApp.page.screenshot({ path: restartScreenshot, fullPage: true });
  for (const cancelledRun of cancelledRuns) await assertRunFilesAreCredentialSafe(cancelledRun.runId);
  await closeInstalledApp(activeApp);
  activeApp = undefined;

  for (let cycle = 0; cycle < soakCycles; cycle += 1) {
    activeApp = await launchInstalledApp();
    await assertPersistedState(activeApp.page, succeededRun.runId);
    await closeInstalledApp(activeApp);
    activeApp = undefined;
  }

  const summary = {
    schemaVersion: 1,
    platform: process.platform,
    architecture: process.arch,
    installedExecutable: basename(executable),
    fixtureProvider: "loopback-openai-compatible",
    credentialSource: "windows-credential-manager",
    faultMatrix,
    soakCycles,
    checks: {
      cleanFirstLaunch: "passed",
      credentialWriteAndReload: "passed",
      modelProbe: "passed",
      installedResearchRun: "passed",
      cancellation: "passed",
      twoActiveRuns: "passed",
      checkpointRecovery: "passed",
      restartHistory: "passed",
      credentialRedaction: "passed",
    },
    mockRequestCounts: {
      models: mockProvider.state.modelRequests,
      completions: mockProvider.state.completionRequests,
      cancelled: mockProvider.state.cancelledRequests,
      recoveryInterruptions: mockProvider.state.recoveryInterruptions,
    },
  };
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  if (activeApp !== undefined) await closeInstalledApp(activeApp).catch(() => undefined);
  let cleanupFailure;
  if (credentialStored) {
    try {
      await credentialStore.deleteProviderApiKey("openai");
      assert.equal((await credentialStore.inspectProviderCredential("openai", {})).available, false);
    } catch (error) {
      cleanupFailure = error;
    }
  }
  try {
    await mockProvider.close();
  } catch (error) {
    cleanupFailure ??= error;
  }
  await rm(temporaryRoot, { recursive: true, force: true });
  if (cleanupFailure !== undefined) throw cleanupFailure;
}

async function assertCleanFirstLaunch(page) {
  await page.locator(".provider-entry").waitFor({ state: "visible" });
  assert.equal(await page.locator(".start-button").isDisabled(), true);
  await page.locator(".provider-entry").click();
  const dialog = page.locator(".provider-settings-dialog");
  await dialog.waitFor({ state: "visible" });
  assert.match(await dialog.innerText(), /DeepSeek/);
  assert.match(await dialog.innerText(), /OpenAI/);
  assert.match(await dialog.innerText(), /尚未保存 API Key/);
}

async function configureProvider(page) {
  const dialog = page.locator(".provider-settings-dialog");
  await dialog.locator(".provider-choice-grid button").filter({ hasText: "OpenAI" }).click();
  await dialog.locator('input[type="password"]').fill(FIXTURE_KEY);
  await dialog.getByRole("button", { name: "安全保存" }).click();
  await waitForText(dialog.locator(".provider-settings-status"), /系统安全存储/);
  await waitForText(dialog.locator(".provider-credential-summary"), /系统凭据已配置/);
}

async function verifyFaultMatrix(page) {
  const cases = [
    ["unauthorized/v1", /HTTP 401/],
    ["rate-limited/v1", /HTTP 429/],
    ["server-error/v1", /HTTP 500/],
    ["disconnect/v1", /network request failed/],
    ["timeout/v1", /timed out/],
  ];
  for (const [path, expected] of cases) {
    await setProviderBaseUrlInOpenDialog(page, `${mockProvider.baseUrl}/${path}`);
    await page.locator(".verify-provider-button").click();
    await waitForText(page.locator(".provider-settings-error"), expected, 15_000);
  }
}

async function verifyProvider(page, baseUrl) {
  await setProviderBaseUrlInOpenDialog(page, baseUrl);
  await page.locator(".verify-provider-button").click();
  await waitForText(page.locator(".provider-settings-status"), /连接验证通过/);
  await page.locator(".provider-settings-dialog").getByRole("button", { name: "完成" }).click();
  await page.locator(".provider-settings-dialog").waitFor({ state: "hidden" });
}

async function setProviderBaseUrl(page, baseUrl) {
  await page.locator(".provider-entry").click();
  await page.locator(".provider-settings-dialog").waitFor({ state: "visible" });
  await page.locator(".provider-choice-grid button").filter({ hasText: "OpenAI" }).click();
  await setProviderBaseUrlInOpenDialog(page, baseUrl);
  await page.locator(".provider-settings-dialog").getByRole("button", { name: "完成" }).click();
}

async function setProviderBaseUrlInOpenDialog(page, baseUrl) {
  const details = page.locator(".provider-advanced-settings");
  if (!await details.evaluate((element) => element.open)) {
    await details.locator("summary").click();
  }
  await details.locator("label").filter({ hasText: "Base URL" }).locator("input").fill(baseUrl);
}

async function startRunAndWait(page, goal, expectedStatus) {
  const run = await startRun(page, goal);
  if (expectedStatus === "cancelled") {
    await page.locator(".cancel-button").waitFor({ state: "visible" });
    await page.locator(".cancel-button").click();
  }
  return poll(async () => {
    const runs = await listRuns(page);
    return runs.find((candidate) => candidate.runId === run.runId);
  }, (candidate) => candidate?.status === expectedStatus, 60_000, `Run did not reach ${expectedStatus}`);
}

async function startRun(page, goal) {
  const priorRuns = await listRuns(page);
  await page.locator(".composer textarea").fill(goal);
  await page.getByLabel("Run 并发").selectOption("1");
  await poll(
    () => page.locator(".start-button").isEnabled(),
    (enabled) => enabled,
    10_000,
    "Start button did not become enabled after the task was filled",
  );
  await page.locator(".start-button").click();
  return poll(async () => {
    const runs = await listRuns(page);
    return runs.find((candidate) => !priorRuns.some((prior) => prior.runId === candidate.runId));
  }, (candidate) => candidate !== undefined, 20_000, "new Run was not created");
}

async function startConcurrentRunsAndCancel(page) {
  const first = await startRun(page, "WINDOWS_GRAY_CANCEL_ONE");
  await poll(
    () => listRuns(page),
    (runs) => runs.some((run) => run.runId === first.runId && ["planning", "running"].includes(run.status)),
    20_000,
    "First concurrent Run did not become active",
  );
  await waitForRendererActiveRuns(page, 1);
  const second = await startRun(page, "WINDOWS_GRAY_CANCEL_TWO");
  await poll(
    () => listRuns(page),
    (runs) => [first.runId, second.runId].every((runId) =>
      runs.some((run) => run.runId === runId && ["starting", "planning", "running"].includes(run.status))),
    20_000,
    "Two installed-app Runs were not active together",
  );
  await page.evaluate(
    (runIds) => Promise.all(runIds.map((runId) => globalThis.localbuddy.cancelRun(runId))),
    [first.runId, second.runId],
  );
  return Promise.all([first.runId, second.runId].map((runId) => poll(async () => {
    const runs = await listRuns(page);
    return runs.find((candidate) => candidate.runId === runId);
  }, (candidate) => candidate?.status === "cancelled", 30_000, `Run ${runId} was not cancelled`)));
}

async function waitForRendererActiveRuns(page, expected) {
  await waitForText(
    page.locator(".global-capacity"),
    new RegExp(`活跃\\s+${expected}/2`),
    10_000,
  );
}

async function assertPersistedState(page, succeededRunId) {
  await page.locator(".provider-entry").waitFor({ state: "visible" });
  await poll(
    () => listRuns(page),
    (runs) => runs.some((run) => run.runId === succeededRunId && run.status === "succeeded"),
    20_000,
    "succeeded Run history did not survive restart",
  );
  await page.locator(".provider-entry").click();
  await page.locator(".provider-choice-grid button").filter({ hasText: "OpenAI" }).click();
  await waitForText(page.locator(".provider-credential-summary"), /系统凭据已配置/);
  await page.locator(".provider-settings-dialog").getByRole("button", { name: "完成" }).click();
}

async function assertRunFilesAreCredentialSafe(runId) {
  const runRoot = join(workspace, ".localbuddy", "runs", runId);
  const [events, request] = await Promise.all([
    readFile(join(runRoot, "events.jsonl"), "utf8"),
    readFile(join(runRoot, "run-request.json"), "utf8"),
  ]);
  assert.equal(events.includes(FIXTURE_KEY), false);
  assert.equal(request.includes(FIXTURE_KEY), false);
}

function listRuns(page) {
  return page.evaluate((selectedWorkspace) => globalThis.localbuddy.listRuns(selectedWorkspace), workspace);
}

async function launchInstalledApp() {
  const port = await reserveLoopbackPort();
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => {
    const normalized = name.toUpperCase();
    return normalized !== "DEEPSEEK_API_KEY"
      && normalized !== "OPENAI_API_KEY"
      && normalized !== "LOCALBUDDY_SCREENSHOT_PATH";
  }));
  const child = spawn(executable, [
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--remote-allow-origins=http://127.0.0.1:${port}`,
  ], {
    env: {
      ...environment,
      LOCALBUDDY_DEFAULT_WORKSPACE: workspace,
      LOCALBUDDY_SHARED_COORDINATION: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString("utf8")).slice(-20_000); });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-20_000); });
  child.once("error", (error) => { stderr = `${stderr}\n${error.message}`.slice(-20_000); });

  try {
    await poll(
      async () => fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.ok).catch(() => false),
      (ready) => ready === true,
      30_000,
      "Electron debugging endpoint did not start",
    );
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = await poll(
      async () => browser.contexts().flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith("localbuddy://")),
      (candidate) => candidate !== undefined,
      20_000,
      "LocalBuddy renderer did not appear",
    );
    return { browser, child, page, stderr: () => stderr, stdout: () => stdout };
  } catch (error) {
    await terminateProcess(child);
    throw new Error(`${error instanceof Error ? error.message : String(error)}; stdout=${stdout}; stderr=${stderr}`);
  }
}

async function closeInstalledApp(active) {
  await active.page.close({ runBeforeUnload: true }).catch(() => undefined);
  await active.browser.close().catch(() => undefined);
  await waitForExit(active.child, 10_000).catch(async () => {
    await terminateProcess(active.child);
  });
  if (active.child.exitCode !== null && active.child.exitCode !== 0) {
    throw new Error(`Installed app exited with ${active.child.exitCode}; stdout=${active.stdout()}; stderr=${active.stderr()}`);
  }
}

async function crashInstalledApp(active) {
  await terminateProcess(active.child);
  await active.browser.close().catch(() => undefined);
}

async function terminateProcess(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    await new Promise((resolvePromise) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("exit", resolvePromise);
      killer.once("error", resolvePromise);
    });
  } else {
    child.kill("SIGKILL");
  }
  await waitForExit(child, 10_000).catch(() => undefined);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error("Installed app did not exit"));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolvePromise();
    };
    child.once("exit", onExit);
  });
}

function reserveLoopbackPort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a loopback port"));
        return;
      }
      server.close((error) => error === undefined ? resolvePromise(address.port) : reject(error));
    });
  });
}

async function waitForText(locator, pattern, timeoutMs = 10_000) {
  await poll(
    () => locator.textContent().catch(() => ""),
    (text) => pattern.test(text ?? ""),
    timeoutMs,
    `Text did not match ${pattern}`,
  );
}

async function poll(producer, predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await producer();
    if (predicate(value)) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`${message}; lastValue=${JSON.stringify(value)}`);
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value.length === 0) return fallback;
  if (!/^\d+$/.test(value)) throw new Error("Windows gray soak cycles must be an integer");
  const parsed = Number.parseInt(value, 10);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`Windows gray soak cycles must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}
