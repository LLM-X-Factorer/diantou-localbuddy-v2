import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendPrivateUtf8,
  ensurePrivateRunRoot,
  hardenPrivateRunStorage,
  writePrivateJsonAtomic,
} from "../src/private-storage.js";

test("creates Run state privately and keeps atomic and append-only files private", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-private-storage-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const runRoot = await ensurePrivateRunRoot(workspace, "run-private");
  const requestPath = join(runRoot, "run-request.json");
  const eventPath = join(runRoot, "events.jsonl");
  await writePrivateJsonAtomic(requestPath, { version: 1 });
  await appendPrivateUtf8(eventPath, "{\"sequence\":1}\n");

  assert.equal(await readFile(eventPath, "utf8"), "{\"sequence\":1}\n");
  if (process.platform !== "win32") {
    for (const directory of [join(workspace, ".localbuddy"), join(workspace, ".localbuddy", "runs"), runRoot]) {
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
    }
    assert.equal((await stat(requestPath)).mode & 0o777, 0o600);
    assert.equal((await stat(eventPath)).mode & 0o777, 0o600);
  }
});

test("restricts legacy Run state without scanning outside the Run", { skip: process.platform === "win32" }, async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-private-legacy-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const runRoot = join(workspace, ".localbuddy", "runs", "run-legacy");
  const checkpoint = join(runRoot, "checkpoint", "tasks");
  await mkdir(checkpoint, { recursive: true, mode: 0o755 });
  const taskPath = join(checkpoint, "task.json");
  await writeFile(taskPath, "{}\n", { mode: 0o644 });
  await chmod(runRoot, 0o755);
  await chmod(checkpoint, 0o755);

  await hardenPrivateRunStorage(runRoot);

  assert.equal((await stat(runRoot)).mode & 0o777, 0o700);
  assert.equal((await stat(checkpoint)).mode & 0o777, 0o700);
  assert.equal((await stat(taskPath)).mode & 0o777, 0o600);
});

test("refuses symlinks in a managed private Run tree", { skip: process.platform === "win32" }, async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-private-symlink-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const runRoot = await ensurePrivateRunRoot(workspace, "run-symlink");
  const outside = join(workspace, "outside.json");
  await writeFile(outside, "{}\n", "utf8");
  await mkdir(join(runRoot, "checkpoint"));
  await symlink(outside, join(runRoot, "checkpoint", "browser-state.json"));

  await assert.rejects(hardenPrivateRunStorage(runRoot), /must not be a symbolic link/);
});
