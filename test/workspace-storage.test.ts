import assert from "node:assert/strict";
import test from "node:test";

import { assessWorkspaceStorage } from "../src/workspace-storage.js";

test("classifies ordinary local storage without pretending credentials live in the workspace", () => {
  const assessment = assessWorkspaceStorage("/Users/example/project", {}, "darwin");
  assert.equal(assessment.risk, "local_workspace");
  assert.deepEqual(assessment.warnings, []);
  assert.equal(assessment.credentialLocation, "system_vault");
  assert.match(assessment.runStoreRoot, /\.localbuddy[/\\]runs$/);
});

test("warns for recognized cloud-synchronized paths", () => {
  const assessment = assessWorkspaceStorage("/Users/example/Library/CloudStorage/OneDrive/project", {}, "darwin");
  assert.equal(assessment.risk, "review_required");
  assert.deepEqual(assessment.warnings, ["cloud_sync"]);
});

test("warns for Windows UNC and configured sync roots without requiring a Windows host", () => {
  const network = assessWorkspaceStorage("\\\\server\\team\\project", {}, "win32");
  assert.deepEqual(network.warnings, ["network_workspace"]);
  const synced = assessWorkspaceStorage("C:\\Users\\demo\\OneDrive - Team\\project", {
    OneDriveCommercial: "C:\\Users\\demo\\OneDrive - Team",
  }, "win32");
  assert.deepEqual(synced.warnings, ["cloud_sync"]);
});
