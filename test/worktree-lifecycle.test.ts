import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";

import { InMemoryEventStore } from "../src/event-store.js";
import { GitWorktreeManager } from "../src/git-worktree-manager.js";
import { WorktreeLifecycleManager } from "../src/worktree-lifecycle.js";

const execFileAsync = promisify(execFile);

test("removes only registered Git worktrees while retaining Run artifacts", async (context) => {
  const root = await createRepo(context);
  const store = new InMemoryEventStore();
  const gitWorktrees = new GitWorktreeManager();
  const first = await gitWorktrees.create(root, "run-cleanup", "task-a");
  const second = await gitWorktrees.create(root, "run-cleanup", "task-b");
  await writeFile(join(first.worktreePath, "app.txt"), "dirty-a\n", "utf8");
  const artifactPath = join(root, ".localbuddy", "runs", "run-cleanup", "artifacts", "task.patch");
  await mkdir(join(root, ".localbuddy", "runs", "run-cleanup", "artifacts"), { recursive: true });
  await writeFile(artifactPath, "retained artifact\n", "utf8");
  await store.append({ type: "run.started", runId: "run-cleanup", data: { mode: "code" } });
  await store.append({ type: "workspace.created", runId: "run-cleanup", taskId: "task-a", data: { worktreePath: first.worktreePath } });
  await store.append({ type: "workspace.created", runId: "run-cleanup", taskId: "task-b", data: { worktreePath: second.worktreePath } });
  await store.append({ type: "run.succeeded", runId: "run-cleanup" });

  const result = await new WorktreeLifecycleManager({ eventStore: store }).cleanup(root, "run-cleanup");

  assert.deepEqual(new Set(result.removed), new Set([first.worktreePath, second.worktreePath]));
  await assert.rejects(access(first.worktreePath));
  await assert.rejects(access(second.worktreePath));
  assert.equal(await readFile(artifactPath, "utf8"), "retained artifact\n");
  const listed = await git(root, ["worktree", "list", "--porcelain"]);
  assert.equal(listed.match(/^worktree /gm)?.length, 1);
  assert.equal((await store.list("run-cleanup")).filter((event) => event.type === "workspace.removed").length, 2);
});

test("protects worktrees while integration is awaiting approval", async (context) => {
  const root = await createRepo(context);
  const store = new InMemoryEventStore();
  const handle = await new GitWorktreeManager().create(root, "run-protected", "task-a");
  await store.append({ type: "run.started", runId: "run-protected", data: { mode: "code" } });
  await store.append({ type: "workspace.created", runId: "run-protected", taskId: "task-a", data: { worktreePath: handle.worktreePath } });
  await store.append({ type: "integration.awaiting_approval", runId: "run-protected" });
  await store.append({ type: "run.succeeded", runId: "run-protected" });

  await assert.rejects(
    new WorktreeLifecycleManager({ eventStore: store }).cleanup(root, "run-protected"),
    /protected by an unresolved integration proposal/,
  );
  await access(handle.worktreePath);
});

async function createRepo(context: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-worktree-lifecycle-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "LocalBuddy Test"]);
  await git(root, ["config", "user.email", "localbuddy@example.invalid"]);
  await writeFile(join(root, ".gitignore"), ".localbuddy/\n", "utf8");
  await writeFile(join(root, "app.txt"), "baseline\n", "utf8");
  await git(root, ["add", ".gitignore", "app.txt"]);
  await git(root, ["commit", "-m", "initial"]);
  return root;
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout;
}
