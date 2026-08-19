import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public runtime treats the private downstream state directory as protected", async () => {
  const files = await Promise.all([
    "src/workspace-tools.ts",
    "src/workspace-manifest.ts",
    "src/research-sources.ts",
    "src/coding-tools.ts",
    "src/coding-planner.ts",
    "src/integration-manager.ts",
    "src/git-worktree-manager.ts",
  ].map((path) => readFile(path, "utf8")));

  for (const source of files) {
    assert.match(source, /\.localbuddy-internal/);
  }
});
