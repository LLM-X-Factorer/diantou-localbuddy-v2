import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { InMemoryArtifactRegistry, JsonArtifactRegistry } from "../src/artifacts.js";
import { isIndependentArtifactReviewRequest } from "../src/artifact-reviewer.js";
import { ResearchCheckpointStore } from "../src/checkpoint-store.js";
import { DesktopRunManager } from "../src/desktop-run-manager.js";
import type { DesktopRunView } from "../src/desktop-contract.js";
import { inspectDocxArtifact, type DocxArtifactSpec } from "../src/docx-artifact.js";
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

const desktopDocxV1: DocxArtifactSpec = {
  version: 1,
  title: "CRM 内部试点会议纪要",
  subtitle: "华东区试点执行版",
  sections: [{
    heading: "行动项",
    blocks: [{
      type: "table",
      columns: ["负责人", "截止日期", "交付物"],
      rows: [["李闻", "2026-08-12", "冻结试点功能清单"]],
    }],
  }],
};

const desktopDocxV2: DocxArtifactSpec = {
  ...desktopDocxV1,
  revisionNote: "新增执行摘要，并补充待确认的预算复核责任。",
  sections: [
    {
      heading: "执行摘要",
      blocks: [{ type: "paragraph", text: "第一周只开放线索录入和周报导出，不开放自动外呼。" }],
    },
    {
      heading: "行动项",
      blocks: [{
        type: "table",
        columns: ["负责人", "截止日期", "交付物"],
        rows: [
          ["李闻", "2026-08-12", "冻结试点功能清单"],
          ["孙至", "待确认", "预算发生变化时负责复核"],
        ],
      }],
    },
  ],
};

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
    sourcePaths: [join(workspace, "notes.md")],
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

test("previews, re-reads, and structurally diffs an editable DOCX revision", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-docx-revision-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "meeting-notes.md"), "李闻在 2026-08-12 前冻结试点功能清单。", "utf8");
  let providerStarts = 0;
  const manager = new DesktopRunManager({
    async createProvider() {
      providerStarts += 1;
      return new DesktopDocxProvider(
        providerStarts === 1 ? desktopDocxV1 : desktopDocxV2,
        providerStarts > 1,
      );
    },
  });

  const parentTerminal = waitForDesktopRun(manager, (run) =>
    run.status === "succeeded" && run.artifactRevision === undefined);
  await manager.start({
    workspace,
    sourcePaths: [join(workspace, "meeting-notes.md")],
    goal: "生成可编辑的 crm-pilot.docx",
    concurrency: 1,
  });
  const parent = await parentTerminal;
  const parentArtifact = parent.artifacts[0];
  assert.equal(parentArtifact?.fileName, "crm-pilot.docx");
  const parentPreview = await manager.loadArtifactPreview({
    workspace,
    runId: parent.runId,
    fileName: parentArtifact?.fileName ?? "",
  });
  assert.equal(parentPreview.format, "docx");
  assert.equal(parentPreview.document?.tables, 1);
  assert.equal(parentPreview.document?.tableRows, 1);
  assert.match(parentPreview.text, /李闻\t2026-08-12\t冻结试点功能清单/u);

  const revisionTerminal = waitForDesktopRun(manager, (run) =>
    run.status === "succeeded" && run.artifactRevision?.revision === 2);
  await manager.start({
    workspace,
    goal: "新增执行摘要，并补充孙至的待确认预算复核责任",
    concurrency: 1,
    mode: "research",
    artifactContinuation: {
      parentRunId: parent.runId,
      parentFileName: parentArtifact?.fileName ?? "",
      parentSha256: parentArtifact?.sha256 ?? "",
      reason: "新增执行摘要，并补充孙至的待确认预算复核责任",
    },
  });
  const revision = await revisionTerminal;
  const revisionArtifact = revision.artifacts[0];
  assert.equal(revisionArtifact?.fileName, "crm-pilot.docx");
  const persisted = await new RunRequestStore().load(
    join(workspace, ".localbuddy", "runs", revision.runId),
    workspace,
    revision.runId,
  );
  assert.equal(persisted.sourcePaths[0]?.endsWith("parent-artifact.docx"), true);
  const sourceInspection = inspectDocxArtifact(await readFile(persisted.sourcePaths[0] ?? ""));
  assert.match(sourceInspection.text, /李闻\t2026-08-12\t冻结试点功能清单/u);

  const revisionPreview = await manager.loadArtifactPreview({
    workspace,
    runId: revision.runId,
    fileName: revisionArtifact?.fileName ?? "",
  });
  assert.equal(revisionPreview.format, "docx");
  assert.equal(revisionPreview.document?.tableRows, 2);
  const diff = await manager.loadArtifactRevisionDiff({
    workspace,
    runId: revision.runId,
    fileName: revisionArtifact?.fileName ?? "",
  });
  assert.equal(diff.comparisonKind, "docx-structure");
  assert.equal(diff.parent.revision, 1);
  assert.equal(diff.current.revision, 2);
  assert.ok(diff.lines.some((line) => line.kind === "added" && line.text === "## 本轮修改说明"));
  assert.ok(diff.lines.some((line) => line.kind === "added" && line.text.includes("孙至\t待确认")));
  const thread = await manager.loadArtifactThread({
    workspace,
    runId: revision.runId,
    fileName: revisionArtifact?.fileName ?? "",
  });
  assert.deepEqual(thread.versions.map((version) => version.revision), [1, 2]);
  assert.ok(thread.versions.every((version) =>
    version.artifacts.every((artifact) => artifact.verification === "verified")));
});

test("starts a verified Artifact revision, preserves lineage, and rejects a tampered parent", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-artifact-revision-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "notes.md"), "verified local note", "utf8");
  let providerStarts = 0;
  const manager = new DesktopRunManager({
    async createProvider() {
      providerStarts += 1;
      return new DesktopWorkflowProvider(providerStarts === 1
        ? "# Result\n\nverified local note\n"
        : "# Result\n\nverified local note\n\n## Executive summary\n\nReady for review.\n");
    },
  });

  const firstTerminal = new Promise<DesktopRunView>((resolvePromise) => {
    const unsubscribe = manager.subscribe((run) => {
      if (run.status === "succeeded" && run.artifactRevision === undefined) {
        unsubscribe();
        resolvePromise(run);
      }
    });
  });
  await manager.start({
    workspace,
    sourcePaths: [join(workspace, "notes.md")],
    goal: "Create a revision source",
    concurrency: 1,
  });
  const parent = await firstTerminal;
  const parentArtifact = parent.artifacts[0];
  assert.ok(parentArtifact?.sha256);

  const revisionTerminal = new Promise<DesktopRunView>((resolvePromise) => {
    const unsubscribe = manager.subscribe((run) => {
      if (run.status === "succeeded" && run.artifactRevision?.revision === 2) {
        unsubscribe();
        resolvePromise(run);
      }
    });
  });
  const revisionInitial = await manager.start({
    workspace,
    goal: "Add an executive summary to the parent result",
    verificationCriteria: ["The parent Artifact remains traceable"],
    concurrency: 1,
    mode: "research",
    artifactContinuation: {
      parentRunId: parent.runId,
      parentFileName: parentArtifact.fileName,
      parentSha256: parentArtifact.sha256,
      reason: "Add an executive summary to the parent result",
    },
  });
  assert.equal(revisionInitial.artifactRevision?.revision, 2);
  const revision = await revisionTerminal;
  assert.equal(revision.artifactRevision?.parentRunId, parent.runId);
  assert.equal(revision.artifactRevision?.parentFileName, parentArtifact.fileName);
  assert.match(revision.artifactRevision?.threadId ?? "", /^thread-[a-f0-9]{24}$/);

  const revisionRunRoot = join(workspace, ".localbuddy", "runs", revision.runId);
  const persisted = await new RunRequestStore().load(revisionRunRoot, workspace, revision.runId);
  assert.equal(persisted.version, 6);
  assert.equal(persisted.artifactRevision?.revision, 2);
  assert.equal(persisted.sourcePaths.length, 1);
  assert.equal(
    await readFile(persisted.sourcePaths[0] ?? "", "utf8"),
    "# Result\n\nverified local note\n",
  );
  const revisionEvents = await new JsonlEventStore(join(revisionRunRoot, "events.jsonl"))
    .list(revision.runId);
  assert.ok(revisionEvents.some((event) => event.type === "artifact.revision_linked"));
  const revisionArtifact = revision.artifacts[0];
  assert.ok(revisionArtifact?.sha256);
  const thread = await manager.loadArtifactThread({
    workspace,
    runId: revision.runId,
    fileName: revisionArtifact.fileName,
  });
  assert.equal(thread.threadId, revision.artifactRevision?.threadId);
  assert.deepEqual(thread.versions.map((version) => version.revision), [1, 2]);
  assert.ok(thread.versions.every((version) =>
    version.artifacts.every((artifact) => artifact.verification === "verified")));
  const diff = await manager.loadArtifactRevisionDiff({
    workspace,
    runId: revision.runId,
    fileName: revisionArtifact.fileName,
  });
  assert.equal(diff.parent.revision, 1);
  assert.equal(diff.current.revision, 2);
  assert.equal(diff.removedLines, 0);
  assert.ok(diff.addedLines >= 2);
  assert.ok(diff.lines.some((line) => line.kind === "added" && line.text === "## Executive summary"));

  const recovered = await new DesktopRunManager({
    async createProvider() {
      return new DesktopWorkflowProvider();
    },
  }).list(workspace);
  assert.equal(
    recovered.find((run) => run.runId === revision.runId)?.artifactRevision?.threadId,
    revision.artifactRevision?.threadId,
  );

  await writeFile(parentArtifact.absolutePath, "tampered parent\n", "utf8");
  const degradedThread = await manager.loadArtifactThread({
    workspace,
    runId: revision.runId,
    fileName: revisionArtifact.fileName,
  });
  assert.equal(degradedThread.versions[0]?.artifacts[0]?.verification, "unavailable");
  await assert.rejects(
    manager.loadArtifactRevisionDiff({
      workspace,
      runId: revision.runId,
      fileName: revisionArtifact.fileName,
    }),
    /no longer matches its registered size and SHA-256/,
  );
  let providerCalls = 0;
  const tamperManager = new DesktopRunManager({
    async createProvider() {
      providerCalls += 1;
      return new DesktopWorkflowProvider();
    },
  });
  await assert.rejects(
    tamperManager.start({
      workspace,
      goal: "This revision must not start",
      concurrency: 1,
      mode: "research",
      artifactContinuation: {
        parentRunId: parent.runId,
        parentFileName: parentArtifact.fileName,
        parentSha256: parentArtifact.sha256,
        reason: "Attempt to revise a changed parent",
      },
    }),
    /no longer matches its registered size and SHA-256/,
  );
  assert.equal(providerCalls, 0);
});

test("replays a failed Artifact revision from the same verified parent lineage", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-artifact-revision-replay-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const sourcePath = join(workspace, "notes.md");
  await writeFile(sourcePath, "verified replay source", "utf8");

  const parentManager = new DesktopRunManager({
    async createProvider() {
      return new DesktopWorkflowProvider();
    },
  });
  const parentTerminal = new Promise<DesktopRunView>((resolvePromise) => {
    const unsubscribe = parentManager.subscribe((run) => {
      if (run.status === "succeeded") {
        unsubscribe();
        resolvePromise(run);
      }
    });
  });
  await parentManager.start({
    workspace,
    sourcePaths: [sourcePath],
    goal: "Create the verified parent Artifact",
    concurrency: 1,
  });
  const parent = await parentTerminal;
  const parentArtifact = parent.artifacts[0];
  assert.ok(parentArtifact?.sha256);

  const failingManager = new DesktopRunManager({
    async createProvider() {
      return new FailingWorkflowProvider();
    },
  });
  const failedTerminal = new Promise<DesktopRunView>((resolvePromise) => {
    const unsubscribe = failingManager.subscribe((run) => {
      if (run.status === "failed" && run.artifactRevision !== undefined) {
        unsubscribe();
        resolvePromise(run);
      }
    });
  });
  await failingManager.start({
    workspace,
    goal: "Add accountable owners to the verified parent Artifact",
    concurrency: 1,
    mode: "research",
    artifactContinuation: {
      parentRunId: parent.runId,
      parentFileName: parentArtifact.fileName,
      parentSha256: parentArtifact.sha256,
      reason: "Add accountable owners to the verified parent Artifact",
    },
  });
  const failed = await failedTerminal;
  assert.equal(failed.artifactRevision?.revision, 2);

  const replayManager = new DesktopRunManager({
    async createProvider() {
      return new DesktopWorkflowProvider();
    },
  });
  const replayTerminal = new Promise<DesktopRunView>((resolvePromise) => {
    const unsubscribe = replayManager.subscribe((run) => {
      if (run.status === "succeeded" && run.recoveryOf === failed.runId) {
        unsubscribe();
        resolvePromise(run);
      }
    });
  });
  const replayInitial = await replayManager.restartRun({ workspace, runId: failed.runId });
  const replay = await replayTerminal;
  assert.equal(replayInitial.artifactRevision?.threadId, failed.artifactRevision?.threadId);
  assert.equal(replay.artifactRevision?.revision, 2);
  assert.equal(replay.artifactRevision?.parentRunId, parent.runId);
  const replayArtifact = replay.artifacts[0];
  assert.ok(replayArtifact?.sha256);
  const replayThread = await replayManager.loadArtifactThread({
    workspace,
    runId: replay.runId,
    fileName: replayArtifact.fileName,
  });
  assert.deepEqual(replayThread.versions.map((version) => version.revision), [1, 2, 2]);
  assert.equal(replayThread.versions.filter((version) => version.runStatus === "failed").length, 1);
  assert.equal(replayThread.versions.filter((version) => version.runStatus === "succeeded").length, 2);

  const failedRequest = await new RunRequestStore().load(
    join(workspace, ".localbuddy", "runs", failed.runId),
    workspace,
    failed.runId,
  );
  const replayRequest = await new RunRequestStore().load(
    join(workspace, ".localbuddy", "runs", replay.runId),
    workspace,
    replay.runId,
  );
  assert.notEqual(replayRequest.sourcePaths[0], failedRequest.sourcePaths[0]);
  assert.equal(
    await readFile(replayRequest.sourcePaths[0] ?? "", "utf8"),
    "# Result\n\nverified local note\n",
  );
});

test("rejects a V3 text diff when its parent revision identity is missing", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-artifact-diff-lineage-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const parentRunId = "run-missing-v2-lineage";
  const currentRunId = "run-v3-lineage";
  const parentRoot = join(workspace, ".localbuddy", "runs", parentRunId);
  const currentRoot = join(workspace, ".localbuddy", "runs", currentRunId);
  const parentPath = join(parentRoot, "artifacts", "parent.md");
  const currentPath = join(currentRoot, "artifacts", "current.md");
  const parentContent = "# Parent\n";
  const currentContent = "# Current\n";
  const parentSha256 = createHash("sha256").update(parentContent).digest("hex");
  const currentSha256 = createHash("sha256").update(currentContent).digest("hex");
  await mkdir(join(parentRoot, "artifacts"), { recursive: true });
  await mkdir(join(currentRoot, "artifacts"), { recursive: true });
  await writeFile(parentPath, parentContent, "utf8");
  await writeFile(currentPath, currentContent, "utf8");
  await new JsonArtifactRegistry(join(parentRoot, "checkpoint", "artifacts.json")).add({
    runId: parentRunId,
    taskId: "integrate",
    agentId: "integrator",
    relativePath: "parent.md",
    absolutePath: parentPath,
    mediaType: "text/markdown",
    bytes: Buffer.byteLength(parentContent),
    sha256: parentSha256,
  });
  await new JsonArtifactRegistry(join(currentRoot, "checkpoint", "artifacts.json")).add({
    runId: currentRunId,
    taskId: "integrate",
    agentId: "integrator",
    relativePath: "current.md",
    absolutePath: currentPath,
    mediaType: "text/markdown",
    bytes: Buffer.byteLength(currentContent),
    sha256: currentSha256,
  });
  const store = new RunRequestStore();
  await store.save(parentRoot, {
    runId: parentRunId,
    workspace,
    goal: "Persist a parent without revision lineage",
    concurrency: 1,
  });
  await store.save(currentRoot, {
    runId: currentRunId,
    workspace,
    goal: "Attempt an invalid V3 comparison",
    concurrency: 1,
    mode: "research",
    artifactRevision: {
      version: 1,
      threadId: "thread-1234567890abcdef12345678",
      revision: 3,
      parentRunId,
      parentFileName: "parent.md",
      parentSha256,
      reason: "Missing V2 lineage must fail closed",
      sourceRelativePath: "revision-source/parent-artifact.md",
    },
  });
  const manager = new DesktopRunManager({
    async createProvider() {
      throw new Error("Provider must not be created for a local diff");
    },
  });
  await assert.rejects(
    manager.loadArtifactRevisionDiff({
      workspace,
      runId: currentRunId,
      fileName: "current.md",
    }),
    /parent has a conflicting Thread lineage/,
  );
});

test("does not inspect an unreadable unrelated file before planning", {
  skip: process.platform === "win32" ? "Windows file ACLs do not use POSIX read bits" : false,
}, async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-snapshot-read-failure-"));
  const unreadable = join(workspace, "unreadable.txt");
  context.after(async () => {
    await chmod(unreadable, 0o600).catch(() => undefined);
    await rm(workspace, { recursive: true, force: true });
  });
  await writeFile(unreadable, "snapshot must fail before any model call", "utf8");
  await chmod(unreadable, 0o000);
  let modelCalls = 0;
  const manager = new DesktopRunManager({
    async createProvider() {
      return {
        async complete() {
          modelCalls += 1;
          throw new Error("model must not be called");
        },
      };
    },
  });

  const started = await manager.start({
    workspace,
    goal: "Inspect the workspace",
    concurrency: 1,
  });
  await manager.waitForIdle();
  const recovered = (await manager.list(workspace)).find((run) => run.runId === started.runId);
  const events = await new JsonlEventStore(
    join(workspace, ".localbuddy", "runs", started.runId, "events.jsonl"),
  ).list(started.runId);

  assert.equal(modelCalls, 1);
  assert.equal(recovered?.status, "failed");
  assert.ok(events.some((event) => event.type === "run.started"));
  assert.ok(events.some((event) => event.type === "run.failed"));
  assert.equal(events.some((event) => event.type === "run.interrupted"), false);
});

test("inspects failed research Runs without building a shared workspace snapshot", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-shared-snapshot-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const notesPath = join(workspace, "notes.md");
  await writeFile(notesPath, "stable evidence", "utf8");
  const goal = "Inspect stable evidence";
  for (const runId of ["run-shared-snapshot-one", "run-shared-snapshot-two"]) {
    const runRoot = join(workspace, ".localbuddy", "runs", runId);
    await new RunRequestStore().save(runRoot, {
      runId,
      workspace,
      goal,
      concurrency: 1,
      mode: "research",
      sourcePaths: [notesPath],
      runtimeOwner: "desktop",
    });
    await new ResearchCheckpointStore(join(runRoot, "checkpoint")).initialize({
      runId,
      workspace,
      goal,
      sourcePaths: [notesPath],
      plan: {
        tasks: [{ id: "read-note", title: "Read note", instructions: "Read notes.md." }],
        integration: { instructions: "Summarize evidence.", fileName: "result.md" },
      },
    });
    const eventStore = new JsonlEventStore(join(runRoot, "events.jsonl"));
    await eventStore.append({ type: "run.started", runId, data: { mode: "research" } });
    await eventStore.append({ type: "run.failed", runId, data: { error: "simulated failure" } });
  }
  const manager = new DesktopRunManager({
    async createProvider() { return new DesktopWorkflowProvider(); },
  });

  const history = await manager.list(workspace);

  assert.equal(history.filter((run) => run.status === "failed").length, 2);
  assert.ok(history.every((run) => run.checkpoint?.status === "available"));
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
  await manager.waitForIdle();

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

test("reserves Run capacity atomically across concurrent start requests", async (context) => {
  const firstWorkspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-capacity-first-"));
  const secondWorkspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-capacity-second-"));
  context.after(async () => {
    await Promise.all([
      rm(firstWorkspace, { recursive: true, force: true }),
      rm(secondWorkspace, { recursive: true, force: true }),
    ]);
  });
  await Promise.all([
    writeFile(join(firstWorkspace, "notes.md"), "wait", "utf8"),
    writeFile(join(secondWorkspace, "notes.md"), "wait", "utf8"),
  ]);
  const manager = new DesktopRunManager({
    maxActiveRuns: 1,
    async createProvider() { return new CancellableProvider(); },
  });

  const results = await Promise.allSettled([
    manager.start({ workspace: firstWorkspace, goal: "First", concurrency: 1 }),
    manager.start({ workspace: secondWorkspace, goal: "Second", concurrency: 1 }),
  ]);
  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<DesktopRunView> => result.status === "fulfilled",
  );
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  for (const result of fulfilled) manager.cancel(result.value.runId);
  await manager.waitForIdle();
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(String(rejected[0]?.reason), /At most 1 runs/);
});

test("applies and reverts a persisted proposal through DesktopRunManager", {
  skip: process.platform === "win32" ? "Windows Coding integration requires a supported isolation host" : false,
}, async (context) => {
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

test("reconciles an interrupted Integration apply while rebuilding Desktop history", {
  skip: process.platform === "win32" ? "Windows Coding integration requires a supported isolation host" : false,
}, async (context) => {
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
    sourcePaths: [join(workspace, "notes.md")],
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

test("does not replay a legacy Research request with implicit whole-workspace evidence", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-legacy-research-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const runId = "run-legacy-research";
  const runRoot = join(workspace, ".localbuddy", "runs", runId);
  await mkdir(runRoot, { recursive: true });
  await writeFile(join(runRoot, "run-request.json"), `${JSON.stringify({
    version: 2,
    runId,
    workspace,
    goal: "Legacy implicit workspace research",
    concurrency: 1,
    mode: "research",
    createdAt: "2026-08-08T10:00:00.000Z",
    runtimeOwner: "desktop",
    provider: { id: "deepseek" },
    extensions: {},
  }, null, 2)}\n`, "utf8");
  const store = new JsonlEventStore(join(runRoot, "events.jsonl"));
  await store.append({ type: "run.started", runId, data: { mode: "research" } });
  await store.append({ type: "run.failed", runId, data: { error: "legacy failure" } });
  const manager = new DesktopRunManager({
    async createProvider() { return new DesktopWorkflowProvider(); },
  });

  await assert.rejects(
    manager.restartRun({ workspace, runId }),
    /used the project directory as implicit evidence/,
  );
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
    sourcePaths: [join(workspace, "notes.md")],
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
    sourcePaths: [join(workspace, "notes.md")],
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
  const failed = (await manager.list(workspace)).find((run) => run.runId === runId);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.checkpoint?.status, "available");
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

test("resumes a failed research Run even when its run directory has over one thousand unrelated files", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-failed-replay-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const notesPath = join(workspace, "notes.md");
  await writeFile(notesPath, "verified local note", "utf8");
  const unrelatedDirectory = join(workspace, "unrelated-cache");
  await mkdir(unrelatedDirectory);
  await Promise.all(Array.from({ length: 1_050 }, (_, index) =>
    writeFile(join(unrelatedDirectory, `cache-${index}.tmp`), "x", "utf8")));
  const runId = "run-failed-large-workspace";
  const goal = "Create a short grounded note";
  const runRoot = join(workspace, ".localbuddy", "runs", runId);
  await new RunRequestStore().save(runRoot, {
    runId,
    workspace,
    goal,
    concurrency: 1,
    mode: "research",
    sourcePaths: [notesPath],
    runtimeOwner: "desktop",
  });
  await new ResearchCheckpointStore(join(runRoot, "checkpoint")).initialize({
    runId,
    workspace,
    goal,
    sourcePaths: [notesPath],
    plan: {
      tasks: [{ id: "read-note", title: "Read note", instructions: "Read notes.md." }],
      integration: { instructions: "Write a grounded result.", fileName: "result.md" },
    },
  });
  const store = new JsonlEventStore(join(runRoot, "events.jsonl"));
  await store.append({ type: "run.started", runId, data: { mode: "research", runtimeOwner: "desktop" } });
  await store.append({ type: "run.failed", runId, data: { error: "worker exceeded its turn budget" } });

  const manager = new DesktopRunManager({
    async createProvider() { return new DesktopWorkflowProvider(); },
  });
  const failed = (await manager.list(workspace)).find((run) => run.runId === runId);
  assert.equal(failed?.checkpoint?.status, "available");
  const diagnostics = await manager.buildDiagnostics({ workspace, runId }, "checkpoint-test");
  assert.equal((diagnostics.checkpoint as { status?: string } | undefined)?.status, "available");

  const terminal = new Promise<DesktopRunView>((resolvePromise) => {
    manager.subscribe((run) => {
      if (run.runId === runId && run.status === "succeeded") resolvePromise(run);
    });
  });
  const resumed = await manager.resumeRun({ workspace, runId });
  assert.equal(resumed.runId, runId);
  assert.equal((await terminal).status, "succeeded");
  await manager.waitForIdle();
});

test("resumes a Coding Run after an isolated write completed before its message cursor", {
  skip: process.platform === "win32" ? "Windows Coding requires a supported isolation host" : false,
}, async (context) => {
  const result = await runCodingCheckpointRecovery(context, "edit");
  assert.equal(result.interrupted.checkpoint?.completedTasks, 0);
  assert.equal(result.interrupted.checkpoint?.resumableTasks, 2);
  assert.equal(result.events.filter((event) =>
    event.type === "tool.completed" && event.data?.toolCallId === "code-edit").length, 1);
  assert.equal(result.events.filter((event) =>
    event.type === "tool.reused" && event.data?.toolCallId === "code-edit").length, 1);
});

test("restores completed Coding Tasks and retries preflight in a new preview worktree", {
  skip: process.platform === "win32" ? "Windows Coding requires a supported isolation host" : false,
}, async (context) => {
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
  constructor(
    readonly artifactContent = "# Result\n\nverified local note\n",
  ) {}

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
        : toolResponse("read-note-tool", "read_file", { path: "source-1" });
    }
    if (prompt.includes("Task ID: integrate")) {
      return toolIds.has("write-result-tool")
        ? response("done")
        : toolResponse("write-result-tool", "write_artifact", {
            fileName: "result.md",
            content: this.artifactContent,
            calculationIds: [],
          });
    }
    throw new Error(`Unexpected prompt: ${prompt}`);
  }
}

class DesktopDocxProvider implements ModelProvider {
  constructor(
    readonly document: DocxArtifactSpec,
    readonly expectsDocxSource: boolean,
  ) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (isIndependentArtifactReviewRequest(request)) {
      return response(JSON.stringify({ verdict: "accept", summary: "DOCX requirements are met.", findings: [] }));
    }
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{ id: "read-source", title: "Read selected source", instructions: "Read the selected source." }],
        integration: { instructions: "Write the requested editable Word document.", fileName: "crm-pilot.docx" },
      }));
    }
    const prompt = lastUserMessage(request.messages);
    const toolMessages = request.messages.filter(
      (message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool",
    );
    const toolIds = new Set(toolMessages.map((message) => message.toolCallId));
    if (prompt.includes("Task ID: read-source")) {
      if (!toolIds.has("docx-read-source")) {
        return toolResponse("docx-read-source", "read_file", { path: "source-1" });
      }
      const readResult = toolMessages.find((message) => message.toolCallId === "docx-read-source")?.content ?? "";
      if (this.expectsDocxSource) {
        assert.match(readResult, /"format":"docx"/u);
        assert.match(readResult, /李闻\\t2026-08-12\\t冻结试点功能清单/u);
      } else {
        assert.match(readResult, /2026-08-12/u);
      }
      return response("Selected source was read and grounded.");
    }
    if (prompt.includes("Task ID: integrate")) {
      assert.ok(request.tools?.some((tool) => tool.name === "write_docx_artifact"));
      assert.equal(request.tools?.some((tool) => tool.name === "write_artifact"), false);
      return toolIds.has("docx-write-result")
        ? response("Editable DOCX written and registered.")
        : toolResponse("docx-write-result", "write_docx_artifact", {
            fileName: "crm-pilot.docx",
            document: this.document,
            calculationIds: [],
          });
    }
    throw new Error(`Unexpected DOCX prompt: ${prompt}`);
  }
}

class FailingWorkflowProvider implements ModelProvider {
  async complete(_request: ModelRequest): Promise<ModelResponse> {
    throw new Error("intentional Artifact revision failure");
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

function waitForDesktopRun(
  manager: DesktopRunManager,
  predicate: (run: DesktopRunView) => boolean,
): Promise<DesktopRunView> {
  return new Promise((resolvePromise) => {
    const unsubscribe = manager.subscribe((run) => {
      if (!predicate(run)) return;
      unsubscribe();
      resolvePromise(run);
    });
  });
}

async function desktopGit(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout;
}
