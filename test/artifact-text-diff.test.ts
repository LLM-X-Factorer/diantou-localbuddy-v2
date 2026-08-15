import assert from "node:assert/strict";
import test from "node:test";

import { createArtifactTextDiff } from "../src/artifact-text-diff.js";

test("builds a line-numbered Artifact diff with bounded context", () => {
  const before = ["title", "one", "two", "three", "four", "five", "six", "owner: unknown", "end"].join("\n");
  const after = ["title", "one", "two", "three", "four", "five", "six", "owner: Li", "deadline: 2026-08-12", "end"].join("\n");
  const diff = createArtifactTextDiff(before, after);

  assert.equal(diff.addedLines, 2);
  assert.equal(diff.removedLines, 1);
  assert.ok(diff.lines.some((line) => line.kind === "removed" && line.text === "owner: unknown"));
  assert.ok(diff.lines.some((line) => line.kind === "added" && line.text === "owner: Li"));
  assert.ok(diff.lines.some((line) => line.kind === "context" && line.skippedLines === 1));
  assert.equal(diff.truncated, false);
});

test("returns an empty visual diff for byte-equivalent normalized text", () => {
  const diff = createArtifactTextDiff("one\r\ntwo\r\n", "one\ntwo\n");
  assert.equal(diff.addedLines, 0);
  assert.equal(diff.removedLines, 0);
  assert.deepEqual(diff.lines, []);
});

test("rejects oversized or line-dense Artifact diffs", () => {
  assert.throws(
    () => createArtifactTextDiff("a".repeat(200_001), "b"),
    /up to 200000 bytes/,
  );
  assert.throws(
    () => createArtifactTextDiff(`${"a\n".repeat(4_000)}a`, "b"),
    /up to 4000 lines/,
  );
});
