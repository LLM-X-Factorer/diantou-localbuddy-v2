import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { InMemoryArtifactRegistry } from "../src/artifacts.js";
import { DesktopRunManager } from "../src/desktop-run-manager.js";
import type { DesktopRunView } from "../src/desktop-contract.js";
import type {
  ChatMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamOptions,
} from "../src/provider.js";
import { JsonlEventStore, type RuntimeEvent } from "../src/event-store.js";
import { GitWorktreeManager } from "../src/git-worktree-manager.js";
import { IntegrationManager } from "../src/integration-manager.js";
import { RunRequestStore } from "../src/run-request-store.js";

const execFileAsync = promisify(execFile);

test("runs a workflow, publishes projections, and recovers it from history", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-manager-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "notes.md"), "verified local note", "utf8");
  const manager = new DesktopRunManager({
    async createProvider() {
      return new DesktopWorkflowProvider();
    },
  });
  const updates: DesktopRunView[] = [];
  const terminal = new Promise<DesktopRunView>((resolvePromise) => {
    manager.subscribe((run) => {
      updates.push(run);
      if (run.status === "succeeded") {
        resolvePromise(run);
      }
    });
  });

  const initial = await manager.start({
    workspace,
    goal: "Create a short grounded note",
    concurrency: 2,
  });
  assert.equal(initial.status, "starting");
  const completed = await terminal;

  assert.equal(completed.tasks.length, 2);
  assert.equal(completed.artifacts[0]?.fileName, "result.md");
  assert.equal(
    await readFile(completed.artifacts[0]?.absolutePath ?? "", "utf8"),
    "# Result\n\nverified local note\n",
  );
  assert.ok(updates.some((run) => run.status === "planning"));
  assert.ok(updates.some((run) => run.status === "running"));

  const recovered = await manager.list(workspace);
  assert.equal(recovered[0]?.runId, initial.runId);
  assert.equal(recovered[0]?.status, "succeeded");
  assert.equal(recovered[0]?.trustProfile, "balanced");
  const diagnostics = await manager.buildDiagnostics({ workspace, runId: initial.runId }, "0.9.0-test");
  const diagnosticJson = JSON.stringify(diagnostics);
  assert.equal(diagnostics.appVersion, "0.9.0-test");
  assert.doesNotMatch(diagnosticJson, /Create a short grounded note/);
  assert.equal(diagnosticJson.includes(workspace), false);
  assert.match(diagnosticJson, /"goals":"omitted"/);
  const preview = await manager.loadArtifactPreview({
    workspace,
    runId: initial.runId,
    fileName: "result.md",
  });
  assert.equal(preview.text, "# Result\n\nverified local note\n");
  assert.equal(preview.truncated, false);
  assert.equal(await manager.resolveArtifactPath({
    workspace,
    runId: initial.runId,
    fileName: "result.md",
  }), completed.artifacts[0]?.absolutePath);
  await writeFile(completed.artifacts[0]?.absolutePath ?? "", "tampered\n", "utf8");
  await assert.rejects(
    manager.loadArtifactPreview({ workspace, runId: initial.runId, fileName: "result.md" }),
    /no longer matches its registered size and SHA-256/,
  );
});

test("cancels an active desktop run through the shared abort signal", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-cancel-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "notes.md"), "wait", "utf8");
  const manager = new DesktopRunManager({
    async createProvider() {
      return new CancellableProvider();
    },
  });
  let runId = "";
  const running = new Promise<void>((resolvePromise) => {
    manager.subscribe((run) => {
      if (run.tasks.some((task) => task.status === "running")) {
        resolvePromise();
      }
    });
  });
  const terminal = new Promise<DesktopRunView>((resolvePromise) => {
    manager.subscribe((run) => {
      if (run.status === "cancelled") {
        resolvePromise(run);
      }
    });
  });

  runId = (await manager.start({ workspace, goal: "Wait for cancellation", concurrency: 1 })).runId;
  await running;
  manager.cancel(runId);
  const cancelled = await terminal;

  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.tasks.some((task) => task.status === "cancelled"));
});

test("allows two active runs and rejects a third", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-multi-run-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "notes.md"), "wait", "utf8");
  const manager = new DesktopRunManager({
    async createProvider() {
      return new CancellableProvider();
    },
  });
  const runningIds = new Set<string>();
  const bothRunning = new Promise<void>((resolvePromise) => {
    manager.subscribe((run) => {
      if (run.tasks.some((task) => task.status === "running")) {
        runningIds.add(run.runId);
      }
      if (runningIds.size === 2) {
        resolvePromise();
      }
    });
  });

  const first = await manager.start({ workspace, goal: "First run", concurrency: 2 });
  const second = await manager.start({ workspace, goal: "Second run", concurrency: 2 });
  await bothRunning;
  await assert.rejects(
    manager.start({ workspace, goal: "Third run", concurrency: 1 }),
    /At most 2 runs/,
  );

  manager.cancel(first.runId);
  manager.cancel(second.runId);
  await manager.waitForIdle();
});

test("applies and reverts a persisted proposal through DesktopRunManager", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-integration-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await desktopGit(workspace, ["init", "-b", "main"]);
  await desktopGit(workspace, ["config", "user.name", "LocalBuddy Test"]);
  await desktopGit(workspace, ["config", "user.email", "localbuddy@example.invalid"]);
  await writeFile(join(workspace, ".gitignore"), ".localbuddy/\n", "utf8");
  await writeFile(join(workspace, "app.txt"), "before\n", "utf8");
  await desktopGit(workspace, ["add", ".gitignore", "app.txt"]);
  await desktopGit(workspace, ["commit", "-m", "initial desktop integration"]);

  const runId = "run-desktop-integration";
  const artifactRoot = join(workspace, ".localbuddy", "runs", runId, "artifacts");
  await mkdir(join(artifactRoot, "patches"), { recursive: true });
  const worktreeManager = new GitWorktreeManager();
  const worktree = await worktreeManager.create(workspace, runId, "change-app");
  await writeFile(join(worktree.worktreePath, "app.txt"), "after\n", "utf8");
  const diff = await worktreeManager.captureDiff(worktree);
  const patchPath = join(artifactRoot, "patches", "change-app.patch");
  await writeFile(patchPath, diff.patch, "utf8");
  const eventStore = new JsonlEventStore(
    join(workspace, ".localbuddy", "runs", runId, "events.jsonl"),
  );
  await eventStore.append({ type: "run.started", runId, data: { mode: "code" } });
  await eventStore.append({ type: "run.succeeded", runId });
  await new IntegrationManager({ eventStore }).prepare({
    runId,
    repoRoot: workspace,
    artifactRoot,
    patches: [{
      taskId: "change-app",
      absolutePath: patchPath,
      sha256: createHash("sha256").update(diff.patch).digest("hex"),
    }],
    verificationCommands: ["git_diff_check"],
    artifactRegistry: new InMemoryArtifactRegistry(),
  });

  const manager = new DesktopRunManager({
    async createProvider() {
      return new DesktopWorkflowProvider();
    },
  });
  const applied = await manager.approveIntegration({ workspace, runId });
  assert.equal(applied.integration?.status, "applied");
  assert.equal(await readFile(join(workspace, "app.txt"), "utf8"), "after\n");

  const reverted = await manager.revertIntegration({ workspace, runId });
  assert.equal(reverted.integration?.status, "reverted");
  assert.equal(await readFile(join(workspace, "app.txt"), "utf8"), "before\n");
});

test("reconciles an interrupted Integration apply while rebuilding Desktop history", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-apply-reconcile-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await desktopGit(workspace, ["init", "-b", "main"]);
  await desktopGit(workspace, ["config", "user.name", "LocalBuddy Test"]);
  await desktopGit(workspace, ["config", "user.email", "localbuddy@example.invalid"]);
  await writeFile(join(workspace, ".gitignore"), ".localbuddy/\n", "utf8");
  await writeFile(join(workspace, "app.txt"), "before\n", "utf8");
  await desktopGit(workspace, ["add", ".gitignore", "app.txt"]);
  await desktopGit(workspace, ["commit", "-m", "initial apply recovery fixture"]);
  const runId = "run-desktop-apply-reconcile";
  const runRoot = join(workspace, ".localbuddy", "runs", runId);
  const artifactRoot = join(runRoot, "artifacts");
  await mkdir(join(artifactRoot, "patches"), { recursive: true });
  const worktree = await new GitWorktreeManager().create(workspace, runId, "change-app");
  await writeFile(join(worktree.worktreePath, "app.txt"), "after\n", "utf8");
  const diff = await new GitWorktreeManager().captureDiff(worktree);
  const patchPath = join(artifactRoot, "patches", "change-app.patch");
  await writeFile(patchPath, diff.patch, "utf8");
  const eventStore = new JsonlEventStore(join(runRoot, "events.jsonl"));
  await eventStore.append({ type: "run.started", runId, data: { mode: "code" } });
  await eventStore.append({ type: "run.succeeded", runId });
  const proposal = await new IntegrationManager({ eventStore }).prepare({
    runId,
    repoRoot: workspace,
    artifactRoot,
    patches: [{
      taskId: "change-app",
      absolutePath: patchPath,
      sha256: createHash("sha256").update(diff.patch).digest("hex"),
    }],
    verificationCommands: ["git_diff_check"],
    artifactRegistry: new InMemoryArtifactRegistry(),
  });
  const applying = JSON.parse(await readFile(proposal.proposalPath, "utf8")) as Record<string, unknown>;
  applying.status = "applying";
  applying.approvalIntent = { source: "desktop", commit: false };
  await writeFile(proposal.proposalPath, `${JSON.stringify(applying, null, 2)}\n`, "utf8");
  await desktopGit(workspace, ["apply", proposal.combinedPatch?.absolutePath ?? ""]);

  const manager = new DesktopRunManager({
    async createProvider() {
      return new DesktopWorkflowProvider();
    },
  });
  const recovered = (await manager.list(workspace)).find((run) => run.runId === runId);
  assert.equal(recovered?.integration?.status, "applied");
  assert.equal(await readFile(join(workspace, "app.txt"), "utf8"), "after\n");
  assert.ok((await eventStore.list(runId)).some((event) =>
    event.type === "integration.applied" && event.data?.reconciled === true));
});

test("marks a nonterminal persisted Run interrupted once and replays it as a new Run", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-recovery-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "notes.md"), "verified local note", "utf8");
  const sourceRunId = "run-interrupted-source";
  const runRoot = join(workspace, ".localbuddy", "runs", sourceRunId);
  await new RunRequestStore(() => new Date("2026-08-08T09:00:00.000Z")).save(runRoot, {
    runId: sourceRunId,
    workspace,
    goal: "Create a short grounded note",
    concurrency: 2,
    mode: "research",
  });
  const sourceStore = new JsonlEventStore(join(runRoot, "events.jsonl"));
  await sourceStore.append({ type: "run.started", runId: sourceRunId, data: { mode: "research" } });
  await sourceStore.append({ type: "task.queued", runId: sourceRunId, taskId: "read-note", data: { title: "Read local note" } });
  await sourceStore.append({ type: "task.started", runId: sourceRunId, taskId: "read-note", agentId: "worker-1" });
  const manager = new DesktopRunManager({
    async createProvider() {
      return new DesktopWorkflowProvider();
    },
  });

  const firstHistory = await manager.list(workspace);
  const interrupted = firstHistory.find((run) => run.runId === sourceRunId);
  assert.equal(interrupted?.status, "interrupted");
  assert.equal(interrupted?.tasks[0]?.status, "interrupted");
  const eventCount = interrupted?.eventCount;
  assert.equal((await manager.list(workspace)).find((run) => run.runId === sourceRunId)?.eventCount, eventCount);

  const terminal = new Promise<DesktopRunView>((resolvePromise) => {
    manager.subscribe((run) => {
      if (run.recoveryOf === sourceRunId && run.status === "succeeded") {
        resolvePromise(run);
      }
    });
  });
  const replay = await manager.restartRun({ workspace, runId: sourceRunId });
  assert.notEqual(replay.runId, sourceRunId);
  assert.equal(replay.recoveryOf, sourceRunId);
  const completed = await terminal;
  assert.equal(completed.status, "succeeded");
  const history = await manager.list(workspace);
  assert.equal(history.find((run) => run.runId === sourceRunId)?.restartedAs, replay.runId);
  await assert.rejects(
    manager.restartRun({ workspace, runId: sourceRunId }),
    /already replayed/,
  );
});

test("does not claim a nonterminal CLI-owned Run was interrupted by Desktop", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-cli-owner-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const runId = "run-cli-owned";
  const runRoot = join(workspace, ".localbuddy", "runs", runId);
  await new RunRequestStore().save(runRoot, {
    runId,
    workspace,
    goal: "CLI process owns this request",
    concurrency: 1,
    runtimeOwner: "cli",
  });
  const store = new JsonlEventStore(join(runRoot, "events.jsonl"));
  await store.append({ type: "run.started", runId, data: { runtimeOwner: "cli" } });
  const manager = new DesktopRunManager({
    async createProvider() {
      return new DesktopWorkflowProvider();
    },
  });

  const history = await manager.list(workspace);
  assert.equal(history[0]?.status, "planning");
  assert.equal(history[0]?.runtimeOwner, "cli");
  assert.equal((await store.list(runId)).length, 1);
});

test("resumes the same research Run from a child-process checkpoint after a hard exit", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-checkpoint-resume-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "notes.md"), "verified local note", "utf8");
  const runId = "run-hard-exit-resume";
  const goal = "Create a short grounded note";
  const runRoot = join(workspace, ".localbuddy", "runs", runId);
  await new RunRequestStore().save(runRoot, {
    runId,
    workspace,
    goal,
    concurrency: 1,
    mode: "research",
    runtimeOwner: "desktop",
  });
  const fixturePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "checkpoint-crash-worker.js",
  );
  try {
    await execFileAsync(process.execPath, [fixturePath, workspace, runId, goal], {
      encoding: "utf8",
    });
    assert.fail("checkpoint fixture should exit before terminal Run events");
  } catch (error) {
    assert.equal((error as { code?: number }).code, 73);
  }

  const manager = new DesktopRunManager({
    async createProvider() {
      return new DesktopWorkflowProvider();
    },
  });
  const interrupted = (await manager.list(workspace)).find((run) => run.runId === runId);
  assert.equal(interrupted?.status, "interrupted");
  assert.equal(interrupted?.checkpoint?.status, "available");
  assert.equal(interrupted?.checkpoint?.completedTasks, 0);

  const terminal = new Promise<DesktopRunView>((resolvePromise) => {
    manager.subscribe((run) => {
      if (run.runId === runId && run.status === "succeeded") {
        resolvePromise(run);
      }
    });
  });
  const resumed = await manager.resumeRun({ workspace, runId });
  assert.equal(resumed.runId, runId);
  const completed = await terminal;
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.artifacts[0]?.fileName, "result.md");
  const events = await new JsonlEventStore(join(runRoot, "events.jsonl")).list(runId);
  assert.equal(events.filter((event) =>
    event.type === "tool.completed" && event.data?.toolCallId === "read-note-tool").length, 1);
  assert.equal(events.filter((event) =>
    event.type === "tool.reused" && event.data?.toolCallId === "read-note-tool").length, 1);
  assert.ok(events.some((event) => event.type === "run.resumed"));
  assert.equal(events.some((event) => event.type === "run.restarted"), false);
});

test("retries unfinished Tasks on a failed Run from its safe checkpoint", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-failed-retry-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "notes.md"), "verified local note", "utf8");
  const runId = "run-failed-checkpoint-retry";
  const goal = "Create a short grounded note";
  const runRoot = join(workspace, ".localbuddy", "runs", runId);
  await new RunRequestStore().save(runRoot, {
    runId,
    workspace,
    goal,
    concurrency: 1,
    mode: "research",
    runtimeOwner: "desktop",
  });
  const fixturePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "checkpoint-crash-worker.js",
  );
  await assert.rejects(
    execFileAsync(process.execPath, [fixturePath, workspace, runId, goal], { encoding: "utf8" }),
  );
  const store = new JsonlEventStore(join(runRoot, "events.jsonl"));
  await store.append({
    type: "run.failed",
    runId,
    data: { error: "provider connection dropped after a safe tool checkpoint" },
  });

  const manager = new DesktopRunManager({
    async createProvider() { return new DesktopWorkflowProvider(); },
  });
  assert.equal((await manager.list(workspace)).find((run) => run.runId === runId)?.status, "failed");
  const terminal = new Promise<DesktopRunView>((resolvePromise) => {
    manager.subscribe((run) => {
      if (run.runId === runId && run.status === "succeeded") resolvePromise(run);
    });
  });
  const retrying = await manager.resumeRun({ workspace, runId });
  assert.equal(retrying.runId, runId);
  const completed = await terminal;
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.tasks.find((task) => task.id === "read-note")?.error, undefined);
  const events = await store.list(runId);
  assert.ok(events.some((event) => event.type === "run.resumed"));
  assert.equal(events.filter((event) =>
    event.type === "tool.completed" && event.data?.toolCallId === "read-note-tool").length, 1);
});

test("resumes a Coding Run after an isolated write completed before its message cursor", async (context) => {
  const result = await runCodingCheckpointRecovery(context, "edit");
  assert.equal(result.interrupted.checkpoint?.completedTasks, 0);
  assert.equal(result.interrupted.checkpoint?.resumableTasks, 2);
  assert.equal(result.events.filter((event) =>
    event.type === "tool.completed" && event.data?.toolCallId === "code-edit").length, 1);
  assert.equal(result.events.filter((event) =>
    event.type === "tool.reused" && event.data?.toolCallId === "code-edit").length, 1);
});

test("restores completed Coding Tasks and retries preflight in a new preview worktree", async (context) => {
  const result = await runCodingCheckpointRecovery(context, "preflight");
  assert.equal(result.interrupted.checkpoint?.completedTasks, 2);
  assert.equal(result.interrupted.checkpoint?.resumableTasks, 0);
  assert.equal(result.events.filter((event) =>
    event.type === "checkpoint.restored" && event.data?.status === "succeeded").length, 2);
  assert.ok(result.events.some((event) =>
    event.type === "workspace.created" && event.taskId === "integration-preview-2"));
});

async function runCodingCheckpointRecovery(
  context: TestContext,
  crashPoint: "edit" | "preflight",
): Promise<{
  interrupted: DesktopRunView;
  completed: DesktopRunView;
  events: readonly RuntimeEvent[];
}> {
  const workspace = await mkdtemp(join(tmpdir(), `localbuddy-desktop-code-${crashPoint}-`));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await desktopGit(workspace, ["init", "-b", "main"]);
  await desktopGit(workspace, ["config", "user.name", "LocalBuddy Test"]);
  await desktopGit(workspace, ["config", "user.email", "localbuddy@example.invalid"]);
  await mkdir(join(workspace, "src"));
  await writeFile(join(workspace, ".gitignore"), ".localbuddy/\n", "utf8");
  await writeFile(join(workspace, "src/greet.js"), 'export function greet() {\n  return "hello";\n}\n', "utf8");
  await desktopGit(workspace, ["add", ".gitignore", "src/greet.js"]);
  await desktopGit(workspace, ["commit", "-m", "initial Coding checkpoint fixture"]);
  const runId = `run-code-checkpoint-${crashPoint}`;
  const goal = "Change the isolated greeting and prepare an approval proposal";
  const runRoot = join(workspace, ".localbuddy", "runs", runId);
  await new RunRequestStore().save(runRoot, {
    runId,
    workspace,
    goal,
    concurrency: 1,
    mode: "code",
    runtimeOwner: "desktop",
  });
  const fixturePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "coding-checkpoint-crash-worker.js",
  );
  try {
    await execFileAsync(process.execPath, [fixturePath, workspace, runId, goal, crashPoint], {
      encoding: "utf8",
    });
    assert.fail("Coding checkpoint fixture should exit before the Run terminal event");
  } catch (error) {
    assert.equal((error as { code?: number }).code, 73);
  }

  const manager = new DesktopRunManager({
    async createProvider() {
      return new CodingCheckpointProvider();
    },
  });
  const interrupted = (await manager.list(workspace)).find((run) => run.runId === runId);
  assert.equal(interrupted?.status, "interrupted");
  assert.equal(interrupted?.mode, "code");
  assert.equal(interrupted?.checkpoint?.status, "available");
  if (interrupted === undefined) {
    throw new Error("Coding interrupted Run was not projected");
  }
  const terminal = new Promise<DesktopRunView>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      void new JsonlEventStore(join(runRoot, "events.jsonl")).list(runId)
        .then((events) => reject(new Error(
          `Coding resume timed out: ${JSON.stringify(events.slice(-8).map((event) => ({
            type: event.type,
            taskId: event.taskId,
            data: event.data,
          })))}`,
        )))
        .catch(reject);
    }, 5_000);
    manager.subscribe((run) => {
      if (run.runId === runId && ["succeeded", "failed", "cancelled"].includes(run.status)) {
        clearTimeout(timer);
        resolvePromise(run);
      }
    });
  });
  const resumed = await manager.resumeRun({ workspace, runId });
  assert.equal(resumed.runId, runId);
  const completed = await terminal;
  assert.equal(completed.status, "succeeded", completed.error ?? "Coding resume did not succeed");
  assert.equal(completed.integration?.status, "awaiting_approval");
  assert.ok(completed.artifacts.some((artifact) => artifact.fileName === "patches/change-greeting.patch"));
  assert.ok(completed.artifacts.some((artifact) => artifact.fileName === "coding-recovery.md"));
  assert.equal(
    await readFile(join(workspace, "src/greet.js"), "utf8"),
    'export function greet() {\n  return "hello";\n}\n',
  );
  const events = await new JsonlEventStore(join(runRoot, "events.jsonl")).list(runId);
  assert.ok(events.some((event) => event.type === "run.resumed"));
  assert.equal(events.some((event) => event.type === "run.restarted"), false);
  return { interrupted, completed, events };
}

class DesktopWorkflowProvider implements ModelProvider {
  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{ id: "read-note", title: "Read local note", instructions: "Read notes.md." }],
        integration: { instructions: "Write a concise result.", fileName: "result.md" },
      }));
    }
    const prompt = lastUserMessage(request.messages);
    const toolIds = new Set(
      request.messages
        .filter((message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool")
        .map((message) => message.toolCallId),
    );
    if (prompt.includes("Task ID: read-note")) {
      return toolIds.has("read-note-tool")
        ? response("verified local note")
        : toolResponse("read-note-tool", "read_file", { path: "notes.md" });
    }
    if (prompt.includes("Task ID: integrate")) {
      return toolIds.has("write-result-tool")
        ? response("done")
        : toolResponse("write-result-tool", "write_artifact", {
            fileName: "result.md",
            content: "# Result\n\nverified local note\n",
            calculationIds: [],
          });
    }
    throw new Error(`Unexpected prompt: ${prompt}`);
  }
}

class CodingCheckpointProvider implements ModelProvider {
  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{
          id: "change-greeting",
          title: "Change greeting",
          instructions: "Change the greeting to hello recovered buddy.",
          ownedPaths: ["src/greet.js"],
        }],
        integration: {
          instructions: "Summarize the isolated recovered patch without claiming merge.",
          fileName: "coding-recovery.md",
          verificationCommands: ["git_diff_check"],
        },
      }));
    }
    const prompt = lastUserMessage(request.messages);
    const toolIds = new Set(request.messages
      .filter((message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool")
      .map((message) => message.toolCallId));
    if (prompt.includes("Task ID: change-greeting")) {
      if (!toolIds.has("code-read")) {
        return toolResponse("code-read", "read_file", { path: "src/greet.js" });
      }
      if (!toolIds.has("code-edit")) {
        return toolResponse("code-edit", "replace_text", {
          path: "src/greet.js",
          oldText: 'return "hello";',
          newText: 'return "hello recovered buddy";',
        });
      }
      if (!toolIds.has("code-check")) {
        return toolResponse("code-check", "run_check", { command: "git_diff_check" });
      }
      return response("Changed the isolated file and verified its diff.");
    }
    if (prompt.includes("Task ID: integrate")) {
      return toolIds.has("code-summary")
        ? response("Saved the recovered Coding summary.")
        : toolResponse("code-summary", "write_artifact", {
            fileName: "coding-recovery.md",
            content: "# Coding recovery\n\nPrimary checkout: unchanged.\n\nRecovered patch passed git_diff_check.\n",
            calculationIds: [],
          });
    }
    throw new Error(`Unexpected Coding checkpoint prompt: ${prompt}`);
  }
}

class CancellableProvider implements ModelProvider {
  async complete(request: ModelRequest, options?: ModelStreamOptions): Promise<ModelResponse> {
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{ id: "wait", title: "Wait", instructions: "Wait." }],
        integration: { instructions: "Do not run.", fileName: "result.md" },
      }));
    }
    return new Promise((_resolve, reject) => {
      const rejectForAbort = () => reject(new Error("aborted"));
      if (options?.signal?.aborted === true) {
        rejectForAbort();
      } else {
        options?.signal?.addEventListener("abort", rejectForAbort, { once: true });
      }
    });
  }
}

function response(content: string): ModelResponse {
  return { model: "desktop-test", content, toolCalls: [], finishReason: "stop" };
}

function toolResponse(id: string, name: string, input: unknown): ModelResponse {
  return {
    model: "desktop-test",
    content: null,
    toolCalls: [{ id, name, arguments: JSON.stringify(input) }],
    finishReason: "tool_calls",
  };
}

function lastUserMessage(messages: readonly ChatMessage[]): string {
  const message = messages.toReversed().find((candidate) => candidate.role === "user");
  if (message === undefined || message.role !== "user") {
    throw new Error("Missing user message");
  }
  return message.content;
}

async function desktopGit(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout;
}
