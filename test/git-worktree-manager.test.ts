import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";

import { CodingSandboxApprovalPolicy, createCodingTools } from "../src/coding-tools.js";
import type { AgentDefinition } from "../src/domain.js";
import { InMemoryEventStore } from "../src/event-store.js";
import { SeatbeltExecutionHost } from "../src/execution-host.js";
import { GitWorktreeManager } from "../src/git-worktree-manager.js";
import { ToolRegistry, ToolRuntime } from "../src/tool-runtime.js";

const execFileAsync = promisify(execFile);
const codeWorker: AgentDefinition = {
  id: "code-worker-1",
  role: "code-worker",
  instructions: "Edit only the isolated worktree.",
  capabilities: ["code"],
  maxParallelTasks: 1,
};

test("edits a detached worktree and captures a patch without touching the primary checkout", async (context) => {
  const fixture = await createGitFixture(context);
  const manager = new GitWorktreeManager();
  const handle = await manager.create(fixture.root, "run-one", "change-greeting");
  const eventStore = new InMemoryEventStore();
  const executionHost = new SeatbeltExecutionHost({
    eventStore,
    temporaryRoot: join(fixture.root, ".localbuddy", "test-execution"),
  });
  const runtime = new ToolRuntime(
    new ToolRegistry(await createCodingTools(handle.worktreePath, ["src/greet.js"], {
      host: executionHost,
      readRoots: [fixture.root],
    })),
    new CodingSandboxApprovalPolicy(),
    eventStore,
  );

  const replacement = await runtime.execute(
    {
      id: "replace-1",
      name: "replace_text",
      arguments: JSON.stringify({
        path: "src/greet.js",
        oldText: 'return "hello";',
        newText: 'return "hello local buddy";',
      }),
    },
    { runId: "run-one", taskId: "change-greeting", agent: codeWorker },
    ["replace_text", "run_check"],
  );
  assert.equal(replacement.isError, false);

  const check = await runtime.execute(
    { id: "check-1", name: "run_check", arguments: '{"command":"git_diff_check"}' },
    { runId: "run-one", taskId: "change-greeting", agent: codeWorker },
    ["replace_text", "run_check"],
  );
  assert.equal(check.isError, false);

  const diff = await manager.captureDiff(handle);
  assert.equal(diff.clean, false);
  assert.match(diff.status, /src\/greet\.js/);
  assert.match(diff.patch, /hello local buddy/);
  assert.equal(await readFile(join(fixture.root, "src/greet.js"), "utf8"), fixture.original);
  assert.equal((await git(fixture.root, ["status", "--porcelain=v1"])).trim(), "");
  assert.ok((await eventStore.list("run-one")).some((event) => event.type === "tool.approved"));
});

test("rejects dirty baselines and path escapes", async (context) => {
  const fixture = await createGitFixture(context);
  await writeFile(join(fixture.root, "src/greet.js"), 'export function greet() { return "dirty"; }\n');
  await assert.rejects(
    new GitWorktreeManager().create(fixture.root, "run-dirty", "edit"),
    /clean primary worktree/,
  );

  await writeFile(join(fixture.root, "src/greet.js"), fixture.original);
  const handle = await new GitWorktreeManager().create(fixture.root, "run-safe", "edit");
  const outside = join(fixture.root, "outside.txt");
  await writeFile(outside, "outside", "utf8");
  await symlink(outside, join(handle.worktreePath, "linked.txt"));
  const runtime = new ToolRuntime(
    new ToolRegistry(await createCodingTools(handle.worktreePath, ["src/greet.js", "linked.txt"])),
    new CodingSandboxApprovalPolicy(),
    new InMemoryEventStore(),
  );
  const escaped = await runtime.execute(
    {
      id: "escape-1",
      name: "replace_text",
      arguments: JSON.stringify({ path: "../outside.txt", oldText: "outside", newText: "changed" }),
    },
    { runId: "run-safe", taskId: "edit", agent: codeWorker },
    ["replace_text"],
  );
  const ownershipEscape = await runtime.execute(
    {
      id: "escape-3",
      name: "replace_text",
      arguments: JSON.stringify({
        path: "src/../outside.txt",
        oldText: "outside",
        newText: "changed",
      }),
    },
    { runId: "run-safe", taskId: "edit", agent: codeWorker },
    ["replace_text"],
  );
  const linked = await runtime.execute(
    {
      id: "escape-2",
      name: "replace_text",
      arguments: JSON.stringify({ path: "linked.txt", oldText: "outside", newText: "changed" }),
    },
    { runId: "run-safe", taskId: "edit", agent: codeWorker },
    ["replace_text"],
  );
  assert.equal(escaped.isError, true);
  assert.equal(linked.isError, true);
  assert.equal(ownershipEscape.isError, true);
  assert.equal(await readFile(outside, "utf8"), "outside");
});

async function createGitFixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-git-fixture-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "LocalBuddy Test"]);
  await git(root, ["config", "user.email", "localbuddy@example.invalid"]);
  await mkdir(join(root, "src"));
  const original = 'export function greet() {\n  return "hello";\n}\n';
  await writeFile(join(root, ".gitignore"), ".localbuddy/\n", "utf8");
  await writeFile(join(root, "src/greet.js"), original, "utf8");
  await git(root, ["add", ".gitignore", "src/greet.js"]);
  await git(root, ["commit", "-m", "initial fixture"]);
  return { root, original };
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout;
}
