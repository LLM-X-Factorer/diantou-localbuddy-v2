import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { JsonlEventStore, type RuntimeEvent } from "../src/event-store.js";
import { loadWorkspaceRunHistory, projectRun } from "../src/run-projection.js";

test("projects task, artifact, and recent event state", () => {
  const workspace = "/tmp/localbuddy-projection";
  const events: RuntimeEvent[] = [
    event(1, "run.started"),
    event(2, "plan.created", { taskId: "orchestrate" }),
    event(3, "task.queued", { taskId: "read", data: { title: "Read evidence" } }),
    event(4, "task.started", { taskId: "read", agentId: "worker-1" }),
    event(5, "task.succeeded", { taskId: "read", agentId: "worker-1" }),
    event(6, "artifact.created", {
      taskId: "integrate",
      agentId: "integrator",
      data: { fileName: "report.md", bytes: 42, sha256: "abc" },
    }),
    event(7, "run.succeeded"),
  ];

  const view = projectRun("run-1", workspace, events);

  assert.equal(view.status, "succeeded");
  assert.equal(view.tasks[0]?.title, "Read evidence");
  assert.equal(view.tasks[0]?.agentId, "worker-1");
  assert.equal(view.artifacts[0]?.absolutePath, resolve(workspace, ".localbuddy/runs/run-1/artifacts/report.md"));
  assert.equal(view.eventCount, 7);
});

test("projects the persisted provider and M4 extension selection", () => {
  const events: RuntimeEvent[] = [
    event(1, "run.started", {
      data: { mode: "research", providerId: "openai", trustProfile: "automation" },
    }),
    event(2, "extensions.loaded", {
      data: {
        skillIds: ["research-evidence"],
        mcpServerIds: ["filesystem"],
        browserOrigins: ["https://example.com"],
        browserActionsAllowed: false,
        mcpWritesAllowed: true,
      },
    }),
  ];

  const view = projectRun("run-m4", "/tmp/localbuddy-m4-projection", events);
  assert.equal(view.providerId, "openai");
  assert.equal(view.trustProfile, "automation");
  assert.deepEqual(view.extensions, {
    skillIds: ["research-evidence"],
    mcpServerIds: ["filesystem"],
    browserOrigins: ["https://example.com"],
    browserActionsAllowed: false,
    mcpWritesAllowed: true,
  });
});

test("rebuilds desktop history from a persisted JSONL event log", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-history-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const store = new JsonlEventStore(
    resolve(workspace, ".localbuddy", "runs", "run-persisted", "events.jsonl"),
    () => new Date("2026-08-07T10:00:00.000Z"),
  );
  await store.append({ type: "run.started", runId: "run-persisted" });
  await store.append({ type: "run.succeeded", runId: "run-persisted" });

  const history = await loadWorkspaceRunHistory(workspace);

  assert.equal(history.length, 1);
  assert.equal(history[0]?.runId, "run-persisted");
  assert.equal(history[0]?.status, "succeeded");
});

test("projects a persistent integration approval lifecycle", () => {
  const workspace = "/tmp/localbuddy-integration-projection";
  const events: RuntimeEvent[] = [
    event(1, "run.started", { data: { mode: "code" } }),
    event(2, "run.succeeded"),
    event(3, "integration.preflight_started"),
    event(4, "integration.awaiting_approval", {
      data: {
        proposalPath: `${workspace}/.localbuddy/runs/run-1/integration-proposal.json`,
        combinedPatchPath: `${workspace}/.localbuddy/runs/run-1/artifacts/integration/combined.patch`,
        combinedPatchSha256: "a".repeat(64),
        previewWorktree: `${workspace}/.localbuddy/worktrees/preview`,
        changedPaths: ["src/a.ts", "src/b.ts"],
        checkCommands: ["git_diff_check", "pnpm_test"],
      },
    }),
    event(5, "integration.approved"),
    event(6, "integration.committed", {
      data: { commitSha: "b".repeat(40), changedPaths: ["src/a.ts", "src/b.ts"] },
    }),
  ];

  const view = projectRun("run-1", workspace, events);
  assert.equal(view.mode, "code");
  assert.equal(view.integration?.status, "committed");
  assert.deepEqual(view.integration?.checkCommands, ["git_diff_check", "pnpm_test"]);
  assert.equal(view.integration?.commitSha, "b".repeat(40));
});

test("projects interruption, replay linkage, and worktree lifecycle without rewriting history", () => {
  const workspace = "/tmp/localbuddy-recovery-projection";
  const worktreePath = `${workspace}/.localbuddy/worktrees/run/task`;
  const events: RuntimeEvent[] = [
    event(1, "run.started", { data: { mode: "code" } }),
    event(2, "task.queued", { taskId: "edit", data: { title: "Edit file" } }),
    event(3, "task.started", { taskId: "edit", agentId: "code-worker-1" }),
    event(4, "workspace.created", { taskId: "edit", data: { worktreePath } }),
    event(5, "run.interrupted", { data: { reason: "runtime restarted", mode: "code" } }),
    event(6, "run.restarted", { data: { newRunId: "run-2" } }),
    event(7, "workspace.removed", { taskId: "edit", data: { worktreePath } }),
  ];

  const view = projectRun("run-1", workspace, events);
  assert.equal(view.status, "interrupted");
  assert.equal(view.tasks[0]?.status, "interrupted");
  assert.equal(view.restartedAs, "run-2");
  assert.equal(view.worktrees[0]?.status, "removed");
  assert.equal(view.eventCount, 7);
});

test("projects a safe checkpoint resume on the original research Run", () => {
  const workspace = "/tmp/localbuddy-checkpoint-projection";
  const events: RuntimeEvent[] = [
    event(1, "run.started", { data: { mode: "research" } }),
    event(2, "task.queued", { taskId: "read", data: { title: "Read evidence" } }),
    event(3, "task.started", { taskId: "read", agentId: "worker-1" }),
    event(4, "run.interrupted", {
      data: {
        reason: "runtime restarted",
        mode: "research",
        resumeAvailable: true,
        checkpointCompletedTasks: 0,
        checkpointResumableTasks: 2,
      },
    }),
    event(5, "run.resumed", {
      data: { mode: "research", completedTasks: 0, resumableTasks: 2 },
    }),
    event(6, "checkpoint.restored", {
      taskId: "read",
      agentId: "worker-1",
      data: { status: "queued" },
    }),
    event(7, "task.started", { taskId: "read", agentId: "worker-1" }),
    event(8, "task.succeeded", { taskId: "read", agentId: "worker-1" }),
    event(9, "run.succeeded"),
  ];

  const interrupted = projectRun("run-1", workspace, events.slice(0, 4));
  assert.equal(interrupted.status, "interrupted");
  assert.equal(interrupted.checkpoint?.status, "available");
  assert.equal(interrupted.checkpoint?.resumableTasks, 2);

  const view = projectRun("run-1", workspace, events);
  assert.equal(view.status, "succeeded");
  assert.equal(view.checkpoint?.status, "resuming");
  assert.equal(view.tasks[0]?.status, "succeeded");
  assert.equal(view.restartedAs, undefined);
  assert.equal(view.eventCount, 9);
});

function event(
  sequence: number,
  type: RuntimeEvent["type"],
  extra: Partial<RuntimeEvent> = {},
): RuntimeEvent {
  return {
    sequence,
    timestamp: `2026-08-07T10:00:${String(sequence).padStart(2, "0")}.000Z`,
    type,
    runId: "run-1",
    ...extra,
  };
}
