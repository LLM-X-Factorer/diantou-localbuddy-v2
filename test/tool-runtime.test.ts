import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InMemoryArtifactRegistry } from "../src/artifacts.js";
import { InMemoryCalculationRegistry } from "../src/calculations.js";
import { buildDocxArtifact } from "../src/docx-artifact.js";
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
  const calculationRegistry = new InMemoryCalculationRegistry();
  const runtime = new ToolRuntime(
    new ToolRegistry(await createWorkspaceTools({
      workspaceRoot: directory,
      artifactRoot,
      artifactRegistry,
      calculationRegistry,
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
  assert.match(unregisteredCalculation.content, /derived numeric calculation lacks/);

  await calculationRegistry.add({
    id: "calc-unused",
    runId: "run",
    taskId: "worker-note",
    agentId: "worker-1",
    toolName: "compare_ratios",
    operation: "1/2 compared with 1/3",
    inputs: {
      leftNumerator: "1",
      leftDenominator: "2",
      rightNumerator: "1",
      rightDenominator: "3",
    },
    outputs: {
      leftDecimal: "0.5",
      rightDecimal: "0.3333333333333333333333333333333333333333",
      relation: "left_is_higher",
      exactComparison: "1*3 compared with 1*2",
    },
  });

  const sourceDatesAndUrls = await runtime.execute(
    {
      id: "write-sources",
      name: "write_artifact",
      arguments: JSON.stringify({
        fileName: "sources.md",
        content: [
          "- Date: 2021-05-28",
          "- Slash date: 2021/05/28",
          "- URL: https://www.news.cn/politics/leaders/2021-05/28/c_1127505377.htm",
          "- Encoded URL: https://example.test/a%20b/2021/05/report.html",
          "- Bare source URL: news.cn/politics/leaders/2023-03/02/c_1129409678.htm",
          "- Policy source fact: 全社会研发经费投入年均增长7%以上。",
          "- Evidence set: selected snapshots source-2/3/4/5/6/7/8.",
          "- Numbered files: 01/02号资料已经纳入本次任务。",
        ].join("\n"),
        calculationIds: ["calc-unused"],
      }),
    },
    { runId: "run", taskId: "integrate", agent: integrator },
    ["write_artifact"],
  );
  assert.equal(sourceDatesAndUrls.isError, false);

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
  assert.equal((await artifactRegistry.list("run")).length, 2);
  assert.ok((await eventStore.list("run")).some((event) => event.type === "artifact.created"));
});

test("research file tools are absent without sources and stay inside explicitly selected sources", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "localbuddy-research-tools-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const sourceDirectory = join(directory, "selected-sources");
  await mkdir(sourceDirectory);
  await writeFile(join(sourceDirectory, "policy-note.md"), "selected evidence", "utf8");
  await writeFile(join(sourceDirectory, "large-policy-note.txt"), "policy evidence\n".repeat(4_000), "utf8");
  await writeFile(join(sourceDirectory, "parent.docx"), buildDocxArtifact({
    version: 1,
    title: "Verified parent",
    sections: [{
      heading: "Evidence",
      blocks: [{ type: "paragraph", text: "semiconductor revision evidence" }],
    }],
  }));
  const separatelySelectedFile = join(directory, "separate-note.md");
  await writeFile(separatelySelectedFile, "separate selected evidence", "utf8");
  await writeFile(join(directory, "outside.md"), "must stay unavailable", "utf8");
  const eventStore = new InMemoryEventStore();
  const registries = () => ({
    artifactRegistry: new InMemoryArtifactRegistry(),
    calculationRegistry: new InMemoryCalculationRegistry(),
  });

  const noSourceRegistry = new ToolRegistry(await createWorkspaceTools({
    sourcePaths: [],
    artifactRoot: join(directory, "artifacts-empty"),
    ...registries(),
    eventStore,
  }));
  assert.equal(noSourceRegistry.get("search_files"), undefined);
  assert.equal(noSourceRegistry.get("search_source_text"), undefined);
  assert.equal(noSourceRegistry.get("read_file"), undefined);

  const runtime = new ToolRuntime(
    new ToolRegistry(await createWorkspaceTools({
      sourcePaths: [sourceDirectory, separatelySelectedFile],
      sourceIdsByTask: new Map([["scoped-task", new Set(["source-1"])]]),
      artifactRoot: join(directory, "artifacts-selected"),
      ...registries(),
      eventStore,
    })),
    new RoleBasedApprovalPolicy(),
    eventStore,
  );
  const search = await runtime.execute(
    { id: "search", name: "search_files", arguments: '{"query":"policy"}' },
    { runId: "run", taskId: "search", agent: worker },
    ["search_files"],
  );
  assert.equal(search.isError, false);
  assert.match(search.content, /source-1\/policy-note\.md/);

  const read = await runtime.execute(
    { id: "read", name: "read_file", arguments: '{"path":"source-1/policy-note.md"}' },
    { runId: "run", taskId: "read", agent: worker },
    ["read_file"],
  );
  assert.equal(read.isError, false);
  assert.match(read.content, /selected evidence/);
  assert.match(read.content, /"sha256":"[a-f0-9]{64}"/);

  const largeRead = await runtime.execute(
    { id: "read-large", name: "read_file", arguments: '{"path":"source-1/large-policy-note.txt"}' },
    { runId: "run", taskId: "scoped-task", agent: worker },
    ["read_file"],
  );
  assert.equal(largeRead.isError, false);
  assert.match(largeRead.content, /"truncated":true/);
  assert.match(largeRead.content, /use search_source_text/);
  assert.ok(largeRead.content.length < 20_000);

  const excerptSearch = await runtime.execute(
    {
      id: "search-text",
      name: "search_source_text",
      arguments: JSON.stringify({
        path: "source-1/policy-note.md",
        queries: ["selected", "missing"],
        contextLines: 0,
      }),
    },
    { runId: "run", taskId: "search-text", agent: worker },
    ["search_source_text"],
  );
  assert.equal(excerptSearch.isError, false);
  assert.match(excerptSearch.content, /"path":"source-1\/policy-note\.md"/);
  assert.match(excerptSearch.content, /"line":1/);
  assert.match(excerptSearch.content, /selected evidence/);
  assert.match(excerptSearch.content, /"sha256":"[a-f0-9]{64}"/);

  const docxExcerptSearch = await runtime.execute(
    {
      id: "search-docx-text",
      name: "search_source_text",
      arguments: JSON.stringify({
        path: "source-1/parent.docx",
        queries: ["semiconductor"],
        contextLines: 0,
      }),
    },
    { runId: "run", taskId: "search-docx-text", agent: worker },
    ["search_source_text"],
  );
  assert.equal(docxExcerptSearch.isError, false);
  assert.match(docxExcerptSearch.content, /semiconductor revision evidence/u);

  const implicitDirectorySearch = await runtime.execute(
    {
      id: "search-directory-text",
      name: "search_source_text",
      arguments: JSON.stringify({ path: "source-1", queries: ["evidence"] }),
    },
    { runId: "run", taskId: "search-directory-text", agent: worker },
    ["search_source_text"],
  );
  assert.equal(implicitDirectorySearch.isError, true);
  assert.match(implicitDirectorySearch.content, /select a file below it/);

  const crossTaskScopeRead = await runtime.execute(
    { id: "cross-scope", name: "read_file", arguments: '{"path":"source-2"}' },
    { runId: "run", taskId: "scoped-task", agent: worker },
    ["read_file"],
  );
  assert.equal(crossTaskScopeRead.isError, true);
  assert.match(crossTaskScopeRead.content, /unknown research source: source-2/);

  const escape = await runtime.execute(
    { id: "escape", name: "read_file", arguments: '{"path":"source-1/../outside.md"}' },
    { runId: "run", taskId: "escape", agent: worker },
    ["read_file"],
  );
  assert.equal(escape.isError, true);
  assert.match(escape.content, /unsafe segments/);
});
