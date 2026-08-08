import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
    concurrency: 2,
    mode: "code",
    recoveryOf: "run-source",
    provider: { id: "openai", model: "gpt-5-mini" },
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
  assert.equal(loaded.version, 2);
  assert.equal(loaded.provider.id, "openai");
  assert.deepEqual(loaded.extensions.skillIds, ["browser-evidence"]);
  assert.match(await readFile(join(runRoot, "run-request.json"), "utf8"), /Verify persisted recovery input/);
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
