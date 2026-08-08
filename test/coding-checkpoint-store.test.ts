import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";

import { JsonArtifactRegistry, type ArtifactRecord } from "../src/artifacts.js";
import { CodingCheckpointStore } from "../src/coding-checkpoint-store.js";
import type { CodingPlan } from "../src/coding-planner.js";
import type { AgentDefinition } from "../src/domain.js";
import { GitWorktreeManager } from "../src/git-worktree-manager.js";

const execFileAsync = promisify(execFile);
const plan: CodingPlan = {
  tasks: [{
    id: "change-greeting",
    title: "Change greeting",
    instructions: "Change the greeting.",
    ownedPaths: ["src/greet.js"],
  }],
  integration: {
    instructions: "Summarize the patch.",
    fileName: "coding-summary.md",
    verificationCommands: ["git_diff_check"],
  },
};

test("accepts only Coding Task results whose worktree diff and patch Artifact still match", async (context) => {
  const fixture = await createFixture(context, "coding-checkpoint-result-");
  const runId = "run-code-result";
  const runRoot = join(fixture.root, ".localbuddy", "runs", runId);
  const checkpointRoot = join(runRoot, "checkpoint");
  const artifactRoot = join(runRoot, "artifacts");
  const store = new CodingCheckpointStore(checkpointRoot);
  const worktreeManager = new GitWorktreeManager();
  const baseline = (await worktreeManager.validatePrimary(fixture.root)).headSha;
  await store.initialize({
    runId,
    repoRoot: fixture.root,
    goal: "Change greeting",
    baselineHead: baseline,
    plan,
  });
  const restored = await worktreeManager.restoreOrCreate(
    fixture.root,
    runId,
    "change-greeting",
    baseline,
  );
  assert.equal(restored.restored, false);
  await store.recordWorktree(restored.handle);
  await writeFile(
    join(restored.handle.worktreePath, "src/greet.js"),
    'export const greeting = "recovered";\n',
    "utf8",
  );
  const diff = await worktreeManager.captureDiff(restored.handle);
  const patchPath = join(artifactRoot, "patches", "change-greeting.patch");
  await mkdir(dirname(patchPath), { recursive: true });
  await writeFile(patchPath, diff.patch, "utf8");
  const patch: ArtifactRecord = {
    runId,
    taskId: "change-greeting",
    agentId: "code-worker-1",
    relativePath: "patches/change-greeting.patch",
    absolutePath: patchPath,
    mediaType: "text/x-diff",
    bytes: Buffer.byteLength(diff.patch),
    sha256: createHash("sha256").update(diff.patch).digest("hex"),
  };
  await new JsonArtifactRegistry(join(checkpointRoot, "artifacts.json")).add(patch);
  await store.saveTask({
    runId,
    taskId: "change-greeting",
    agentId: "code-worker-1",
    contractSha256: "a".repeat(64),
    phase: "succeeded",
    turn: 1,
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "user" },
      { role: "assistant", content: "done" },
    ],
    output: "done",
  });
  await store.saveTaskResult({
    kind: "worker",
    runId,
    taskId: "change-greeting",
    agentId: "code-worker-1",
    output: { patchArtifact: patch.relativePath },
    worktree: restored.handle,
    patch,
    worktreeStatus: diff.status,
  });

  const available = await store.inspectResume({
    runId,
    repoRoot: fixture.root,
    goal: "Change greeting",
  });
  assert.equal(available.available, true);
  assert.equal(available.completedTasks, 1);
  assert.equal(available.resumableTasks, 1);

  await writeFile(
    join(restored.handle.worktreePath, "src/greet.js"),
    'export const greeting = "drifted after checkpoint";\n',
    "utf8",
  );
  const drifted = await store.inspectResume({
    runId,
    repoRoot: fixture.root,
    goal: "Change greeting",
  });
  assert.equal(drifted.available, false);
  assert.match(drifted.reason ?? "", /worktree diff changed/);
});

test("blocks a Coding checkpoint with an ambiguous isolated write receipt", async (context) => {
  const fixture = await createFixture(context, "coding-checkpoint-ambiguous-");
  const runId = "run-code-ambiguous";
  const checkpointRoot = join(fixture.root, ".localbuddy", "runs", runId, "checkpoint");
  const store = new CodingCheckpointStore(checkpointRoot);
  const worktreeManager = new GitWorktreeManager();
  const baseline = (await worktreeManager.validatePrimary(fixture.root)).headSha;
  await store.initialize({
    runId,
    repoRoot: fixture.root,
    goal: "Change greeting",
    baselineHead: baseline,
    plan,
  });
  const worktree = (await worktreeManager.restoreOrCreate(
    fixture.root,
    runId,
    "change-greeting",
    baseline,
  )).handle;
  await store.recordWorktree(worktree);
  const toolCall = {
    id: "ambiguous-edit",
    name: "replace_text",
    arguments: JSON.stringify({
      path: "src/greet.js",
      oldText: "original",
      newText: "changed",
    }),
  };
  await store.saveTask({
    runId,
    taskId: "change-greeting",
    agentId: "code-worker-1",
    contractSha256: "b".repeat(64),
    phase: "tool_inflight",
    turn: 0,
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "user" },
      { role: "assistant", content: null, toolCalls: [toolCall] },
    ],
    pendingToolCalls: [toolCall],
    nextToolIndex: 0,
  });
  await store.toolJournal().start(toolCall, {
    runId,
    taskId: "change-greeting",
    agent: codeAgent(),
  }, "write");

  const inspection = await store.inspectResume({
    runId,
    repoRoot: fixture.root,
    goal: "Change greeting",
  });
  assert.equal(inspection.available, false);
  assert.match(inspection.reason ?? "", /ambiguous write tool call/);
});

async function createFixture(context: TestContext, prefix: string): Promise<{ root: string }> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "LocalBuddy Test"]);
  await git(root, ["config", "user.email", "localbuddy@example.invalid"]);
  await mkdir(join(root, "src"));
  await writeFile(join(root, ".gitignore"), ".localbuddy/\n", "utf8");
  await writeFile(join(root, "src/greet.js"), 'export const greeting = "original";\n', "utf8");
  await git(root, ["add", ".gitignore", "src/greet.js"]);
  await git(root, ["commit", "-m", "initial checkpoint fixture"]);
  return { root };
}

function codeAgent(): AgentDefinition {
  return {
    id: "code-worker-1",
    role: "code-worker",
    instructions: "Edit only the isolated worktree.",
    capabilities: ["code"],
    maxParallelTasks: 1,
  };
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout;
}
