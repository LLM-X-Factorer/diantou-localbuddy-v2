import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactThreadId,
  createArtifactRevision,
  normalizeArtifactRevision,
} from "../src/artifact-revision.js";

const sha256 = "a".repeat(64);

test("creates a stable Artifact thread and increments append-only revisions", () => {
  const second = createArtifactRevision({
    parentRunId: "run-parent",
    parentFileName: "reports/result.md",
    parentSha256: sha256,
    reason: "Add a shorter executive summary.",
  });
  const third = createArtifactRevision({
    parentRunId: "run-second",
    parentFileName: "result-v2.md",
    parentSha256: "b".repeat(64),
    reason: "Add owners and due dates.",
  }, second);

  assert.equal(second.revision, 2);
  assert.equal(third.revision, 3);
  assert.equal(second.threadId, third.threadId);
  assert.equal(second.sourceRelativePath, "revision-source/parent-artifact.md");
  assert.equal(
    second.threadId,
    artifactThreadId({
      parentRunId: "run-parent",
      parentFileName: "reports/result.md",
      parentSha256: sha256,
      reason: "A different reason does not change source identity.",
    }),
  );
});

test("rejects unsafe or mutable-looking Artifact revision identities", () => {
  assert.throws(
    () => createArtifactRevision({
      parentRunId: "run-parent",
      parentFileName: "../result.md",
      parentSha256: sha256,
      reason: "Revise it.",
    }),
    /unsafe segments/,
  );
  assert.throws(
    () => normalizeArtifactRevision({
      version: 1,
      threadId: "thread-not-a-digest",
      revision: 2,
      parentRunId: "run-parent",
      parentFileName: "result.md",
      parentSha256: sha256,
      reason: "Revise it.",
      sourceRelativePath: "revision-source/parent-artifact.md",
    }),
    /thread id/,
  );
});
