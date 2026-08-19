import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const executable = resolve(process.argv[2] ?? defaultExecutable());
const evidenceRoot = resolve(
  process.argv[3] ?? join(".localbuddy", "extension-catalog-smoke", process.platform),
);
const screenshot = join(evidenceRoot, "method-and-connection-picker.png");
const isolatedRoot = await mkdtemp(join(tmpdir(), "localbuddy-extension-catalog-"));
const emptyPath = join(isolatedRoot, "empty-path");
const userData = join(isolatedRoot, "user-data");
const keychainRoot = join(isolatedRoot, "mock-keychain");
const workspace = join(isolatedRoot, "workspace");
const skillRoot = join(workspace, ".localbuddy", "skills", "evidence-review");

await Promise.all([
  mkdir(emptyPath, { recursive: true }),
  mkdir(userData, { recursive: true }),
  mkdir(keychainRoot, { recursive: true }),
  mkdir(skillRoot, { recursive: true }),
  mkdir(dirname(screenshot), { recursive: true }),
]);
await writeFile(join(skillRoot, "SKILL.md"), [
  "---",
  "version: 1",
  "id: evidence-review",
  "title: 证据检查",
  "description: 在汇总前检查每项结论是否有明确来源。",
  "appliesTo: research",
  "---",
  "Check every claim against an explicitly selected source.",
  "",
].join("\n"), "utf8");
await writeFile(join(workspace, ".localbuddy", "mcp.json"), `${JSON.stringify({
  version: 1,
  servers: [{
    id: "research-tools",
    title: "研究资料库",
    description: "查找已经接入的研究资料，并把来源带回当前任务。",
    transport: "streamable-http",
    url: "https://mcp.example.com/tools",
    oauth: { scopes: ["mcp:read"] },
    readOnlyTools: ["search"],
  }],
}, null, 2)}\n`, "utf8");

try {
  await runApp(executable, [`--user-data-dir=${userData}`], cleanEnvironment());
  const diagnostics = JSON.parse(await readFile(`${screenshot}.json`, "utf8"));
  assert.equal(diagnostics.url, "localbuddy://app/index.html");
  assert.equal(diagnostics.title, "LocalBuddy V2");
  assert.equal(diagnostics.requestedView, "extensions");
  assert.equal(diagnostics.dialogVisible, true);
  assert.match(diagnostics.methodHeading, /按固定方法完成/);
  assert.match(diagnostics.connectionHeading, /使用其他服务或本机工具/);
  assert.equal(diagnostics.methodCount, 1);
  assert.equal(diagnostics.connectionCount, 1);
  assert.equal(diagnostics.initiallySelected, 0);
  assert.equal(diagnostics.selectedAfterClick, 2);
  assert.equal(diagnostics.technicalHiddenByDefault, true);
  assert.equal(diagnostics.technicalBoundaryVisible, true);
  assert.equal(diagnostics.primaryCopyUsesOutcomes, true);
  assert.equal(diagnostics.justInTimeApprovalVisible, true);
  assert.equal(diagnostics.selectedChipsVisible, true);
  assert.match(diagnostics.extensionToggleText, /方法与连接\s*2/);
  assert.ok((await stat(screenshot)).size > 10_000);

  process.stdout.write(`${JSON.stringify({
    executable,
    platform: process.platform,
    isolatedWorkspace: true,
    isolatedUserData: true,
    realMcpConnectionAttempted: false,
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

function cleanEnvironment() {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => {
    const normalized = name.toUpperCase();
    return normalized !== "PATH"
      && normalized !== "DEEPSEEK_API_KEY"
      && normalized !== "OPENAI_API_KEY"
      && normalized !== "LOCALBUDDY_DEFAULT_WORKSPACE";
  }));
  return {
    ...environment,
    PATH: emptyPath,
    LOCALBUDDY_DEFAULT_WORKSPACE: workspace,
    LOCALBUDDY_SCREENSHOT_PATH: screenshot,
    LOCALBUDDY_SMOKE_VIEW: "extensions",
    LOCALBUDDY_TEST_KEYCHAIN_ROOT: keychainRoot,
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
      reject(new Error(`extension catalog smoke timed out; stdout=${stdout}; stderr=${stderr}`));
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
