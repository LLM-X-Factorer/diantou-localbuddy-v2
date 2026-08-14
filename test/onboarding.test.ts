import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ensureTutorialWorkspace,
  inspectWorkspaceReadiness,
  OnboardingStateStore,
} from "../src/onboarding.js";
import { GUIDE_TEMPLATES } from "../src/onboarding-content.js";

const LARGE_DIRECTORY_ENTRY_COUNT = 1_001;
const LARGE_SPARSE_FILE_BYTES = 64 * 1024 * 1024 + 1;

test("persists versioned onboarding preferences privately and fails safe on corrupt state", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-onboarding-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const filePath = join(root, "preferences", "onboarding.json");
  const store = new OnboardingStateStore(filePath);

  assert.deepEqual(await store.load(), {
    version: 1,
    guideSeen: false,
    contextHelpEnabled: true,
  });
  assert.deepEqual(await store.update({ guideSeen: true, contextHelpEnabled: false }), {
    version: 1,
    guideSeen: true,
    contextHelpEnabled: false,
  });
  if (process.platform !== "win32") assert.equal((await stat(filePath)).mode & 0o777, 0o600);

  await writeFile(filePath, "not-json\n", "utf8");
  assert.deepEqual(await store.load(), {
    version: 1,
    guideSeen: false,
    contextHelpEnabled: true,
  });
});

test("creates an explicit isolated tutorial workspace and never overwrites reused files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-tutorial-root-"));
  context.after(async () => rm(root, { recursive: true, force: true }));

  const first = await ensureTutorialWorkspace(root);
  assert.equal(first.created, true);
  assert.equal(first.files.length, 3);
  assert.match(await readFile(join(first.workspace, "project-brief.md"), "utf8"), /fictional/i);
  assert.deepEqual(await inspectWorkspaceReadiness(first.workspace), {
    selected: true,
    isGitRepository: false,
    isTutorialWorkspace: true,
  });
  if (process.platform !== "win32") {
    assert.equal((await stat(first.workspace)).mode & 0o777, 0o700);
    assert.equal((await stat(join(first.workspace, "project-brief.md"))).mode & 0o777, 0o600);
  }

  await writeFile(join(first.workspace, "project-brief.md"), "user kept this edit\n", "utf8");
  const reused = await ensureTutorialWorkspace(root, first.workspace);
  assert.equal(reused.created, false);
  assert.equal(reused.workspace, first.workspace);
  assert.equal(await readFile(join(first.workspace, "project-brief.md"), "utf8"), "user kept this edit\n");

  const outside = await mkdtemp(join(tmpdir(), "localbuddy-outside-tutorial-"));
  context.after(async () => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, ".localbuddy-tutorial.json"), JSON.stringify({ version: 1, kind: "first-trusted-run" }), "utf8");
  const replacement = await ensureTutorialWorkspace(root, outside);
  assert.equal(replacement.created, true);
  assert.notEqual(replacement.workspace, outside);
});

test("detects Git readiness without reading repository contents", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-guide-git-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await mkdir(join(workspace, ".git"));

  assert.deepEqual(await inspectWorkspaceReadiness(workspace), {
    selected: true,
    isGitRepository: true,
    isTutorialWorkspace: false,
  });
  assert.deepEqual(await inspectWorkspaceReadiness(""), {
    selected: false,
    isGitRepository: false,
    isTutorialWorkspace: false,
  });
});

test("does not enumerate a large workspace during readiness inspection", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-guide-oversized-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const paths = Array.from(
    { length: LARGE_DIRECTORY_ENTRY_COUNT },
    (_, index) => join(workspace, `entry-${String(index).padStart(4, "0")}`),
  );
  for (let index = 0; index < paths.length; index += 100) {
    await Promise.all(paths.slice(index, index + 100).map((path) => mkdir(path)));
  }

  assert.deepEqual(await inspectWorkspaceReadiness(workspace), {
    selected: true,
    isGitRepository: false,
    isTutorialWorkspace: false,
  });
});

test("does not measure file bytes during readiness inspection", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-guide-large-workspace-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const largeFile = join(workspace, "large-sparse.bin");
  await writeFile(largeFile, "", "utf8");
  await truncate(largeFile, LARGE_SPARSE_FILE_BYTES);

  assert.deepEqual(await inspectWorkspaceReadiness(workspace), {
    selected: true,
    isGitRepository: false,
    isTutorialWorkspace: false,
  });
});

test("guide templates are bounded drafts and preserve explicit human start", () => {
  assert.deepEqual(Object.keys(GUIDE_TEMPLATES).sort(), ["safe-code", "tutorial-research", "workspace-research"]);
  assert.equal(GUIDE_TEMPLATES["tutorial-research"].mode, "research");
  assert.equal(GUIDE_TEMPLATES["safe-code"].mode, "code");
  assert.match(GUIDE_TEMPLATES["safe-code"].goal, /等待我明确批准后再写回主工作区/);
  for (const template of Object.values(GUIDE_TEMPLATES)) {
    assert.equal(template.trustProfile, "balanced");
    assert.ok(template.goal.length < 1_000);
  }
});
