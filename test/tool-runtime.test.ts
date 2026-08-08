import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InMemoryArtifactRegistry } from "../src/artifacts.js";
import { InMemoryCalculationRegistry } from "../src/calculations.js";
import type { AgentDefinition } from "../src/domain.js";
import { InMemoryEventStore } from "../src/event-store.js";
import { RoleBasedApprovalPolicy, ToolRegistry, ToolRuntime } from "../src/tool-runtime.js";
import { createWorkspaceTools } from "../src/workspace-tools.js";

const worker: AgentDefinition = {
  id: "worker-1",
  role: "worker",
  instructions: "read",
  capabilities: ["worker"],
  maxParallelTasks: 1,
};

const integrator: AgentDefinition = {
  id: "integrator",
  role: "integrator",
  instructions: "integrate",
  capabilities: ["integrate"],
  maxParallelTasks: 1,
};

test("enforces workspace boundaries and role-based artifact writes", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "localbuddy-tools-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const artifactRoot = join(directory, ".localbuddy", "artifacts");
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(join(directory, "notes.md"), "local evidence", "utf8");
  const eventStore = new InMemoryEventStore();
  const artifactRegistry = new InMemoryArtifactRegistry();
  const runtime = new ToolRuntime(
    new ToolRegistry(await createWorkspaceTools({
      workspaceRoot: directory,
      artifactRoot,
      artifactRegistry,
      calculationRegistry: new InMemoryCalculationRegistry(),
      eventStore,
    })),
    new RoleBasedApprovalPolicy(),
    eventStore,
  );

  const readResult = await runtime.execute(
    { id: "read-1", name: "read_file", arguments: '{"path":"notes.md"}' },
    { runId: "run", taskId: "read", agent: worker },
    ["read_file"],
  );
  assert.equal(readResult.isError, false);
  assert.match(readResult.content, /local evidence/);

  const escapeResult = await runtime.execute(
    { id: "read-2", name: "read_file", arguments: '{"path":"../outside"}' },
    { runId: "run", taskId: "escape", agent: worker },
    ["read_file"],
  );
  assert.equal(escapeResult.isError, true);
  assert.match(escapeResult.content, /escapes the allowed root/);

  const deniedWrite = await runtime.execute(
    {
      id: "write-1",
      name: "write_artifact",
      arguments: '{"fileName":"report.md","content":"denied","calculationIds":[]}',
    },
    { runId: "run", taskId: "worker-write", agent: worker },
    ["write_artifact"],
  );
  assert.equal(deniedWrite.isError, true);
  assert.match(deniedWrite.content, /not allowed/);

  const unregisteredCalculation = await runtime.execute(
    {
      id: "write-unregistered",
      name: "write_artifact",
      arguments: JSON.stringify({
        fileName: "mental-math.md",
        content: "46/128 = 35.9%",
        calculationIds: [],
      }),
    },
    { runId: "run", taskId: "integrate", agent: integrator },
    ["write_artifact"],
  );
  assert.equal(unregisteredCalculation.isError, true);
  assert.match(unregisteredCalculation.content, /numeric claim lacks/);

  const allowedWrite = await runtime.execute(
    {
      id: "write-2",
      name: "write_artifact",
      arguments: '{"fileName":"report.md","content":"verified","calculationIds":[]}',
    },
    { runId: "run", taskId: "integrate", agent: integrator },
    ["write_artifact"],
  );
  assert.equal(allowedWrite.isError, false);
  assert.equal((await artifactRegistry.list("run")).length, 1);
  assert.ok((await eventStore.list("run")).some((event) => event.type === "artifact.created"));
});
