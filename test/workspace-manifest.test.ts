import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildWorkspaceManifest } from "../src/workspace-manifest.js";

test("builds only the bounded filename hint used by Coding planning", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-coding-manifest-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await Promise.all([
    mkdir(join(workspace, ".git")),
    mkdir(join(workspace, ".localbuddy")),
    mkdir(join(workspace, ".localbuddy-internal")),
    mkdir(join(workspace, "node_modules")),
  ]);
  await Promise.all([
    writeFile(join(workspace, ".git", "ignored"), "git", "utf8"),
    writeFile(join(workspace, ".localbuddy", "ignored"), "runtime", "utf8"),
    writeFile(join(workspace, ".localbuddy-internal", "ignored-internal"), "runtime", "utf8"),
    writeFile(join(workspace, "node_modules", "ignored"), "dependency", "utf8"),
    ...Array.from({ length: 105 }, (_, index) =>
      writeFile(join(workspace, `file-${String(index).padStart(3, "0")}.txt`), "x", "utf8")),
  ]);

  const manifest = await buildWorkspaceManifest(workspace);
  assert.equal(manifest.length, 100);
  assert.equal(manifest.some((path) => path.includes("ignored")), false);
});

test("coding filename hints ignore symbolic links", {
  skip: process.platform === "win32" ? "Windows symlink creation requires host-specific privileges" : false,
}, async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-coding-manifest-symlink-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "visible.txt"), "visible", "utf8");
  await symlink("visible.txt", join(workspace, "ignored-link"));

  assert.deepEqual(await buildWorkspaceManifest(workspace), ["visible.txt"]);
});
