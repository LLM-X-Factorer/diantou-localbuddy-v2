import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { RecentWorkspaceStore } from "../src/recent-workspaces.js";

test("persists a bounded most-recent-first workspace list with private permissions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-recent-workspaces-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const filePath = join(root, "preferences", "recent-workspaces.json");
  const store = new RecentWorkspaceStore(filePath, 3);

  await store.remember(join(root, "one"));
  await store.remember(join(root, "two"));
  await store.remember(join(root, "one"));
  await store.remember(join(root, "three"));
  await store.remember(join(root, "four"));

  assert.deepEqual(
    (await store.list()).map((item) => basename(item)),
    ["four", "three", "one"],
  );
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), await store.list());
  if (process.platform !== "win32") assert.equal((await stat(filePath)).mode & 0o777, 0o600);
});
