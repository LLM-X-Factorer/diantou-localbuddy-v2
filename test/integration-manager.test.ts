import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";

import { InMemoryArtifactRegistry } from "../src/artifacts.js";
import { InMemoryEventStore } from "../src/event-store.js";
import { GitWorktreeManager } from "../src/git-worktree-manager.js";
import {
  IntegrationManager,
  type IntegrationPatchInput,
} from "../src/integration-manager.js";

const execFileAsync = promisify(execFile);

test("preflights combined patches, applies only after approval, and safely reverts", async (context) => {
  const fixture = await createFixture(context);
  const patches = await Promise.all([
    createPatch(fixture, "change-a", "src/a.js", 'export const a = "new-a";\n'),
    createPatch(fixture, "change-b", "src/b.js", 'export const b = "new-b";\n'),
  ]);
  const eventStore = new InMemoryEventStore();
  const manager = new IntegrationManager({ eventStore });
  const proposal = await manager.prepare({
    runId: "integration-apply-revert",
    repoRoot: fixture.root,
    artifactRoot: fixture.artifactRoot,
    patches,
    verificationCommands: ["git_diff_check", "node_test"],
    artifactRegistry: fixture.artifactRegistry,
  });

  assert.equal(proposal.status, "awaiting_approval", proposal.error ?? "preflight failed");
  assert.deepEqual(proposal.changedPaths, ["src/a.js", "src/b.js"]);
  assert.deepEqual(proposal.checks.map((check) => check.command), ["git_diff_check", "node_test"]);
  assert.equal(await readFile(join(fixture.root, "src/a.js"), "utf8"), fixture.originalA);
  assert.equal((await git(fixture.root, ["status", "--porcelain=v1"])).trim(), "");

  const applied = await manager.approve({
    proposalPath: proposal.proposalPath,
    expectedRepoRoot: fixture.root,
    approvalSource: "test",
  });
  assert.equal(applied.status, "applied");
  assert.equal(await readFile(join(fixture.root, "src/a.js"), "utf8"), 'export const a = "new-a";\n');
  assert.equal(await readFile(join(fixture.root, "src/b.js"), "utf8"), 'export const b = "new-b";\n');

  const reverted = await manager.revert({
    proposalPath: proposal.proposalPath,
    expectedRepoRoot: fixture.root,
    approvalSource: "test",
  });
  assert.equal(reverted.status, "reverted");
  assert.equal(await readFile(join(fixture.root, "src/a.js"), "utf8"), fixture.originalA);
  assert.equal((await git(fixture.root, ["status", "--porcelain=v1"])).trim(), "");
  const events = await eventStore.list("integration-apply-revert");
  assert.ok(events.some((event) => event.type === "integration.awaiting_approval"));
  assert.ok(events.some((event) => event.type === "integration.approved"));
  assert.ok(events.some((event) => event.type === "integration.applied"));
  assert.ok(events.some((event) => event.type === "integration.reverted"));
});

test("creates an explicit commit after approval", async (context) => {
  const fixture = await createFixture(context);
  const baseline = (await git(fixture.root, ["rev-parse", "HEAD"])).trim();
  const patch = await createPatch(
    fixture,
    "commit-a",
    "src/a.js",
    'export const a = "committed-a";\n',
  );
  const eventStore = new InMemoryEventStore();
  const manager = new IntegrationManager({ eventStore });
  const proposal = await manager.prepare({
    runId: "integration-commit",
    repoRoot: fixture.root,
    artifactRoot: fixture.artifactRoot,
    patches: [patch],
    verificationCommands: ["git_diff_check"],
    artifactRegistry: fixture.artifactRegistry,
  });
  const committed = await manager.approve({
    proposalPath: proposal.proposalPath,
    expectedRepoRoot: fixture.root,
    commitMessage: "Apply approved LocalBuddy patch",
    approvalSource: "test",
  });

  assert.equal(committed.status, "committed");
  assert.notEqual(committed.commitSha, baseline);
  assert.equal((await git(fixture.root, ["status", "--porcelain=v1"])).trim(), "");
  assert.equal((await git(fixture.root, ["log", "-1", "--pretty=%s"])).trim(), "Apply approved LocalBuddy patch");

  const reverted = await manager.revert({
    proposalPath: committed.proposalPath,
    expectedRepoRoot: fixture.root,
    approvalSource: "test",
  });
  assert.equal(reverted.status, "revert_committed");
  assert.ok(reverted.revertCommitSha);
  assert.equal((await git(fixture.root, ["rev-parse", "HEAD^"])).trim(), committed.commitSha);
  assert.equal(await readFile(join(fixture.root, "src/a.js"), "utf8"), fixture.originalA);
  assert.equal((await git(fixture.root, ["status", "--porcelain=v1"])).trim(), "");
  assert.ok((await eventStore.list("integration-commit")).some(
    (event) => event.type === "integration.revert_committed",
  ));
});

test("applies and reverts a newly created file", async (context) => {
  const fixture = await createFixture(context);
  const patch = await createPatch(
    fixture,
    "create-file",
    "src/new-file.js",
    'export const created = true;\n',
  );
  const manager = new IntegrationManager({ eventStore: new InMemoryEventStore() });
  const proposal = await manager.prepare({
    runId: "integration-new-file",
    repoRoot: fixture.root,
    artifactRoot: fixture.artifactRoot,
    patches: [patch],
    verificationCommands: ["git_diff_check"],
    artifactRegistry: fixture.artifactRegistry,
  });
  const applied = await manager.approve({
    proposalPath: proposal.proposalPath,
    expectedRepoRoot: fixture.root,
    approvalSource: "test",
  });
  assert.equal(applied.status, "applied");
  assert.equal(
    await readFile(join(fixture.root, "src/new-file.js"), "utf8"),
    'export const created = true;\n',
  );

  const reverted = await manager.revert({
    proposalPath: proposal.proposalPath,
    expectedRepoRoot: fixture.root,
    approvalSource: "test",
  });
  assert.equal(reverted.status, "reverted");
  await assert.rejects(readFile(join(fixture.root, "src/new-file.js"), "utf8"), /ENOENT/);
  assert.equal((await git(fixture.root, ["status", "--porcelain=v1"])).trim(), "");
});

test("blocks conflicting patches during preflight without changing primary", async (context) => {
  const fixture = await createFixture(context);
  const patches = await Promise.all([
    createPatch(fixture, "conflict-a", "src/a.js", 'export const a = "first";\n'),
    createPatch(fixture, "conflict-b", "src/a.js", 'export const a = "second";\n'),
  ]);
  const eventStore = new InMemoryEventStore();
  const proposal = await new IntegrationManager({ eventStore }).prepare({
    runId: "integration-conflict",
    repoRoot: fixture.root,
    artifactRoot: fixture.artifactRoot,
    patches,
    verificationCommands: ["git_diff_check"],
    artifactRegistry: fixture.artifactRegistry,
  });

  assert.equal(proposal.status, "preflight_failed");
  assert.match(proposal.error ?? "", /git apply failed/);
  assert.equal(await readFile(join(fixture.root, "src/a.js"), "utf8"), fixture.originalA);
  assert.equal((await git(fixture.root, ["status", "--porcelain=v1"])).trim(), "");
});

test("materializes a three-way conflict for a Merge Agent and gates the resolved patch", async (context) => {
  const fixture = await createFixture(context);
  const patches = await Promise.all([
    createPatch(fixture, "merge-a", "src/a.js", 'export const a = "first";\n'),
    createPatch(fixture, "merge-b", "src/a.js", 'export const a = "second";\n'),
  ]);
  const eventStore = new InMemoryEventStore();
  let resolverCalls = 0;
  const manager = new IntegrationManager({ eventStore });
  const proposal = await manager.prepare({
    runId: "integration-merge-agent",
    repoRoot: fixture.root,
    artifactRoot: fixture.artifactRoot,
    patches,
    verificationCommands: ["git_diff_check"],
    artifactRegistry: fixture.artifactRegistry,
    conflictResolver: {
      async resolve(input) {
        resolverCalls += 1;
        assert.deepEqual(input.conflictPaths, ["src/a.js"]);
        assert.match(await readFile(join(input.worktreePath, "src/a.js"), "utf8"), /<<<<<<<|>>>>>>>/);
        await writeFile(
          join(input.worktreePath, "src/a.js"),
          'export const a = "first-and-second";\n',
          "utf8",
        );
      },
    },
  });

  assert.equal(resolverCalls, 1);
  assert.equal(proposal.status, "awaiting_approval", proposal.error ?? "resolution failed");
  assert.deepEqual(proposal.changedPaths, ["src/a.js"]);
  assert.equal(await readFile(join(fixture.root, "src/a.js"), "utf8"), fixture.originalA);
  const applied = await manager.approve({
    proposalPath: proposal.proposalPath,
    expectedRepoRoot: fixture.root,
    approvalSource: "test",
  });
  assert.equal(applied.status, "applied");
  assert.equal(
    await readFile(join(fixture.root, "src/a.js"), "utf8"),
    'export const a = "first-and-second";\n',
  );
  const events = await eventStore.list("integration-merge-agent");
  assert.ok(events.some((event) => event.type === "integration.conflict_resolution_started"));
  assert.ok(events.some((event) => event.type === "integration.conflict_resolution_completed"));
});

test("refuses approval after baseline drift and preserves the user change", async (context) => {
  const fixture = await createFixture(context);
  const patch = await createPatch(fixture, "drift-a", "src/a.js", 'export const a = "agent";\n');
  const manager = new IntegrationManager({ eventStore: new InMemoryEventStore() });
  const proposal = await manager.prepare({
    runId: "integration-drift",
    repoRoot: fixture.root,
    artifactRoot: fixture.artifactRoot,
    patches: [patch],
    verificationCommands: ["git_diff_check"],
    artifactRegistry: fixture.artifactRegistry,
  });
  await writeFile(join(fixture.root, "src/a.js"), 'export const a = "user-change";\n', "utf8");

  const refused = await manager.approve({
    proposalPath: proposal.proposalPath,
    expectedRepoRoot: fixture.root,
    approvalSource: "test",
  });
  assert.equal(refused.status, "failed");
  assert.equal(refused.rolledBack, false);
  assert.match(refused.error ?? "", /clean primary worktree/);
  assert.equal(
    await readFile(join(fixture.root, "src/a.js"), "utf8"),
    'export const a = "user-change";\n',
  );
});

test("rolls back an applied index patch when commit creation fails", async (context) => {
  const fixture = await createFixture(context);
  const patch = await createPatch(fixture, "rollback-a", "src/a.js", 'export const a = "rollback";\n');
  const manager = new IntegrationManager({ eventStore: new InMemoryEventStore() });
  const proposal = await manager.prepare({
    runId: "integration-rollback",
    repoRoot: fixture.root,
    artifactRoot: fixture.artifactRoot,
    patches: [patch],
    verificationCommands: ["git_diff_check"],
    artifactRegistry: fixture.artifactRegistry,
  });
  await git(fixture.root, ["config", "user.name", ""]);
  await git(fixture.root, ["config", "user.email", ""]);

  const failed = await manager.approve({
    proposalPath: proposal.proposalPath,
    expectedRepoRoot: fixture.root,
    commitMessage: "This commit must fail without an identity",
    approvalSource: "test",
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.rolledBack, true);
  assert.equal(await readFile(join(fixture.root, "src/a.js"), "utf8"), fixture.originalA);
  assert.equal((await git(fixture.root, ["status", "--porcelain=v1"])).trim(), "");
});

test("reconciles an interrupted uncommitted apply from the exact primary diff", async (context) => {
  const fixture = await createFixture(context);
  const patch = await createPatch(
    fixture,
    "reconcile-applied",
    "src/a.js",
    'export const a = "reconciled";\n',
  );
  const eventStore = new InMemoryEventStore();
  const manager = new IntegrationManager({ eventStore });
  const proposal = await manager.prepare({
    runId: "integration-reconcile-applied",
    repoRoot: fixture.root,
    artifactRoot: fixture.artifactRoot,
    patches: [patch],
    verificationCommands: ["git_diff_check"],
    artifactRegistry: fixture.artifactRegistry,
  });
  await setApplyingProposal(proposal.proposalPath, false);
  await git(fixture.root, ["apply", proposal.combinedPatch?.absolutePath ?? ""]);

  const reconciled = await manager.reconcileApplying({
    proposalPath: proposal.proposalPath,
    expectedRepoRoot: fixture.root,
  });
  assert.equal(reconciled.status, "applied");
  assert.equal(await readFile(join(fixture.root, "src/a.js"), "utf8"), 'export const a = "reconciled";\n');
  assert.ok((await eventStore.list(proposal.runId)).some((event) =>
    event.type === "integration.applied" && event.data?.reconciled === true));
});

test("reconciles an interrupted approved commit from its exact baseline diff", async (context) => {
  const fixture = await createFixture(context);
  const patch = await createPatch(
    fixture,
    "reconcile-commit",
    "src/a.js",
    'export const a = "reconciled-commit";\n',
  );
  const eventStore = new InMemoryEventStore();
  const manager = new IntegrationManager({ eventStore });
  const proposal = await manager.prepare({
    runId: "integration-reconcile-commit",
    repoRoot: fixture.root,
    artifactRoot: fixture.artifactRoot,
    patches: [patch],
    verificationCommands: ["git_diff_check"],
    artifactRegistry: fixture.artifactRegistry,
  });
  await setApplyingProposal(proposal.proposalPath, true);
  await git(fixture.root, ["apply", "--index", proposal.combinedPatch?.absolutePath ?? ""]);
  await git(fixture.root, ["commit", "--no-verify", "--no-gpg-sign", "-m", "Recovered approved commit"]);
  const commitSha = (await git(fixture.root, ["rev-parse", "HEAD"])).trim();

  const reconciled = await manager.reconcileApplying({
    proposalPath: proposal.proposalPath,
    expectedRepoRoot: fixture.root,
  });
  assert.equal(reconciled.status, "committed");
  assert.equal(reconciled.commitSha, commitSha);
  assert.ok((await eventStore.list(proposal.runId)).some((event) =>
    event.type === "integration.committed" && event.data?.reconciled === true));
});

test("requires manual recovery when interrupted apply contains an unapproved path", async (context) => {
  const fixture = await createFixture(context);
  const patch = await createPatch(
    fixture,
    "reconcile-extra-path",
    "src/a.js",
    'export const a = "approved-change";\n',
  );
  const manager = new IntegrationManager({ eventStore: new InMemoryEventStore() });
  const proposal = await manager.prepare({
    runId: "integration-reconcile-extra-path",
    repoRoot: fixture.root,
    artifactRoot: fixture.artifactRoot,
    patches: [patch],
    verificationCommands: ["git_diff_check"],
    artifactRegistry: fixture.artifactRegistry,
  });
  await setApplyingProposal(proposal.proposalPath, false);
  await git(fixture.root, ["apply", proposal.combinedPatch?.absolutePath ?? ""]);
  await writeFile(join(fixture.root, "unapproved.txt"), "user change\n", "utf8");

  const reconciled = await manager.reconcileApplying({
    proposalPath: proposal.proposalPath,
    expectedRepoRoot: fixture.root,
  });
  assert.equal(reconciled.status, "recovery_required");
  assert.match(reconciled.error ?? "", /outside the approved patch/);
  assert.equal(await readFile(join(fixture.root, "unapproved.txt"), "utf8"), "user change\n");
});

interface Fixture {
  root: string;
  artifactRoot: string;
  artifactRegistry: InMemoryArtifactRegistry;
  originalA: string;
}

async function createFixture(context: TestContext): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-integration-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "LocalBuddy Test"]);
  await git(root, ["config", "user.email", "localbuddy@example.invalid"]);
  await mkdir(join(root, "src"));
  await mkdir(join(root, "test"));
  const originalA = 'export const a = "old-a";\n';
  await writeFile(join(root, ".gitignore"), ".localbuddy/\n", "utf8");
  await writeFile(join(root, "src/a.js"), originalA, "utf8");
  await writeFile(join(root, "src/b.js"), 'export const b = "old-b";\n', "utf8");
  await writeFile(
    join(root, "test/combined.test.js"),
    [
      'import assert from "node:assert/strict";',
      'import test from "node:test";',
      'import { a } from "../src/a.js";',
      'import { b } from "../src/b.js";',
      'test("combined result", () => { assert.equal(a, "new-a"); assert.equal(b, "new-b"); });',
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(root, "package.json"), '{"type":"module"}\n', "utf8");
  await git(root, ["add", ".gitignore", "src", "test", "package.json"]);
  await git(root, ["commit", "-m", "initial integration fixture"]);
  const artifactRoot = join(root, ".localbuddy", "runs", "integration-run", "artifacts");
  await mkdir(join(artifactRoot, "patches"), { recursive: true });
  return { root, artifactRoot, artifactRegistry: new InMemoryArtifactRegistry(), originalA };
}

async function createPatch(
  fixture: Fixture,
  taskId: string,
  relativePath: string,
  content: string,
): Promise<IntegrationPatchInput> {
  const manager = new GitWorktreeManager();
  const handle = await manager.create(fixture.root, "patch-source", taskId);
  const targetPath = join(handle.worktreePath, relativePath);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
  const diff = await manager.captureDiff(handle);
  assert.equal(diff.clean, false);
  const absolutePath = join(fixture.artifactRoot, "patches", `${taskId}.patch`);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, diff.patch, "utf8");
  return { taskId, absolutePath, sha256: createHash("sha256").update(diff.patch).digest("hex") };
}

async function setApplyingProposal(proposalPath: string, commit: boolean): Promise<void> {
  const proposal = JSON.parse(await readFile(proposalPath, "utf8")) as Record<string, unknown>;
  proposal.status = "applying";
  proposal.approvalIntent = {
    source: "test",
    commit,
    ...(commit ? { commitMessage: "Recovered approved commit" } : {}),
  };
  await writeFile(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`, "utf8");
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
    return stdout;
  } catch (error) {
    const failure = error as Error & { code?: number };
    if (args.includes("--unset") && failure.code === 5) {
      return "";
    }
    throw error;
  }
}
