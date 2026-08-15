import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createArtifactRevision } from "../src/artifact-revision.js";
import { RunRequestStore } from "../src/run-request-store.js";

test("persists and validates a replayable Run Request", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-run-request-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const runRoot = join(workspace, ".localbuddy", "runs", "run-request-test");
  const store = new RunRequestStore(() => new Date("2026-08-08T10:00:00.000Z"));

  const saved = await store.save(runRoot, {
    runId: "run-request-test",
    workspace,
    goal: "Verify persisted recovery input",
    goalConstraints: ["Do not modify the primary checkout"],
    verificationCriteria: ["The replay input remains byte-stable"],
    concurrency: 2,
    mode: "code",
    recoveryOf: "run-source",
    provider: { id: "openai", model: "gpt-5-mini" },
    trustProfile: "strict",
    extensions: {
      skillIds: ["browser-evidence"],
      mcpServerIds: ["local-tools"],
      browser: { allowedOrigins: ["https://example.com"] },
    },
  });
  const loaded = await store.load(runRoot, workspace, "run-request-test");

  assert.deepEqual(loaded, saved);
  assert.equal(loaded.createdAt, "2026-08-08T10:00:00.000Z");
  assert.equal(loaded.recoveryOf, "run-source");
  assert.equal(loaded.version, 6);
  assert.equal(loaded.planReview, "skipped");
  assert.deepEqual(loaded.goalContract, {
    version: 1,
    revision: 1,
    outcome: "Verify persisted recovery input",
    constraints: ["Do not modify the primary checkout"],
    verificationCriteria: ["The replay input remains byte-stable"],
  });
  assert.match(loaded.executionGoal, /Verification criteria:/);
  assert.deepEqual(loaded.sourcePaths, []);
  assert.equal(loaded.trustProfile, "strict");
  assert.equal(loaded.provider.id, "openai");
  assert.deepEqual(loaded.extensions.skillIds, ["browser-evidence"]);
  const persistedJson = await readFile(join(runRoot, "run-request.json"), "utf8");
  assert.match(persistedJson, /Verify persisted recovery input/);
  assert.doesNotMatch(persistedJson, /"goal":/);
});

test("migrates a v2 Run Request to balanced trust without rewriting history", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-run-request-v2-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const runRoot = join(workspace, ".localbuddy", "runs", "run-v2");
  await mkdir(runRoot, { recursive: true });
  await writeFile(join(runRoot, "run-request.json"), `${JSON.stringify({
    version: 2,
    runId: "run-v2",
    workspace,
    goal: "Legacy replay input",
    concurrency: 2,
    mode: "research",
    createdAt: "2026-08-08T10:00:00.000Z",
    runtimeOwner: "desktop",
    provider: { id: "deepseek" },
    extensions: {},
  }, null, 2)}\n`, "utf8");

  const loaded = await new RunRequestStore().load(runRoot, workspace, "run-v2");
  assert.equal(loaded.version, 6);
  assert.equal(loaded.executionGoal, "Legacy replay input");
  assert.equal(loaded.goalContract.outcome, "Legacy replay input");
  assert.equal(loaded.planReview, "skipped");
  assert.equal(loaded.trustProfile, "balanced");
  assert.deepEqual(loaded.sourcePaths, []);
  assert.equal(loaded.sourceContract, "legacy-workspace");
  assert.match(await readFile(join(runRoot, "run-request.json"), "utf8"), /"version": 2/);
});

test("persists Artifact revision identity and reads it without reopening unrelated sources", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-request-artifact-revision-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const runRoot = join(workspace, ".localbuddy", "runs", "run-revision");
  const sourcePath = join(runRoot, "revision-source", "parent-artifact.md");
  await mkdir(join(runRoot, "revision-source"), { recursive: true });
  await writeFile(sourcePath, "verified parent\n", "utf8");
  const artifactRevision = createArtifactRevision({
    parentRunId: "run-parent",
    parentFileName: "result.md",
    parentSha256: "a".repeat(64),
    reason: "Add owners and deadlines.",
  });
  const store = new RunRequestStore();
  await store.save(runRoot, {
    runId: "run-revision",
    workspace,
    goal: "Revise the verified parent Artifact",
    concurrency: 1,
    mode: "research",
    sourcePaths: [sourcePath],
    artifactRevision,
  });

  const loaded = await store.load(runRoot, workspace, "run-revision");
  assert.deepEqual(loaded.artifactRevision, artifactRevision);
  await rm(sourcePath);
  assert.deepEqual(
    await store.loadArtifactRevision(runRoot, "run-revision"),
    artifactRevision,
  );

  const unsupported = JSON.parse(
    await readFile(join(runRoot, "run-request.json"), "utf8"),
  ) as Record<string, unknown>;
  unsupported.version = 7;
  await writeFile(
    join(runRoot, "run-request.json"),
    `${JSON.stringify(unsupported, null, 2)}\n`,
    "utf8",
  );
  await assert.rejects(
    store.loadArtifactRevision(runRoot, "run-revision"),
    /unsupported Artifact revision version/,
  );
});

test("rejects a persisted request selected through a different workspace", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-request-workspace-"));
  const otherWorkspace = await mkdtemp(join(tmpdir(), "localbuddy-request-other-"));
  context.after(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(otherWorkspace, { recursive: true, force: true });
  });
  const runRoot = join(workspace, ".localbuddy", "runs", "run-workspace-test");
  const store = new RunRequestStore();
  await store.save(runRoot, {
    runId: "run-workspace-test",
    workspace,
    goal: "Keep workspace identity bound",
    concurrency: 1,
  });

  await assert.rejects(
    store.load(runRoot, otherWorkspace, "run-workspace-test"),
    /workspace does not match/,
  );
});
