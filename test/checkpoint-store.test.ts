import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentLoopExecutor } from "../src/agent-loop.js";
import { ResearchCheckpointStore } from "../src/checkpoint-store.js";
import type { AgentDefinition, TaskDefinition } from "../src/domain.js";
import { InMemoryEventStore } from "../src/event-store.js";
import { AuditedModelClient } from "../src/model-runtime.js";
import type { ChatMessage, ModelProvider, ModelRequest, ModelResponse } from "../src/provider.js";
import {
  RoleBasedApprovalPolicy,
  ToolRegistry,
  ToolRuntime,
  type ToolDefinition,
} from "../src/tool-runtime.js";

const plan = {
  tasks: [{ id: "read-note", title: "Read note", instructions: "Read notes.md." }],
  integration: { instructions: "Write a grounded result.", fileName: "result.md" },
} as const;

test("ignores unrelated workspace drift but blocks changes to a file actually read", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-checkpoint-store-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const notesPath = join(workspace, "notes.md");
  const originalContent = "stable evidence\n";
  await writeFile(notesPath, originalContent, "utf8");
  const store = new ResearchCheckpointStore(join(workspace, ".localbuddy", "checkpoint"));
  await store.initialize({
    runId: "run-checkpoint",
    workspace,
    goal: "Read the note",
    sourcePaths: [notesPath],
    plan,
  });
  const agent = makeAgent();
  const toolCall = { id: "read-note-call", name: "read_file", arguments: '{"path":"source-1"}' };
  const toolContext = { runId: "run-checkpoint", taskId: "read-note", agent };
  const journal = store.toolJournal();
  await journal.start(toolCall, toolContext, "read");
  await journal.complete(toolCall, toolContext, "read", {
    toolCallId: toolCall.id,
    isError: false,
    content: JSON.stringify({
      path: "source-1",
      sha256: createHash("sha256").update(originalContent).digest("hex"),
      bytes: Buffer.byteLength(originalContent),
      content: originalContent,
    }),
  });

  const available = await store.inspectResume({
    runId: "run-checkpoint",
    workspace,
    goal: "Read the note",
    sourcePaths: [notesPath],
  });
  assert.equal(available.available, true);
  assert.equal(available.resumableTasks, 2);

  await writeFile(join(workspace, "unrelated.tmp"), "unrelated change\n", "utf8");
  assert.equal((await store.inspectResume({
    runId: "run-checkpoint",
    workspace,
    goal: "Read the note",
    sourcePaths: [notesPath],
  })).available, true);

  await writeFile(notesPath, "changed evidence\n", "utf8");
  const drifted = await store.inspectResume({
    runId: "run-checkpoint",
    workspace,
    goal: "Read the note",
    sourcePaths: [notesPath],
  });
  assert.equal(drifted.available, false);
  assert.match(drifted.reason ?? "", /local source read by this Run changed/);
});

test("does not inspect or hash a large unrelated workspace file", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-checkpoint-byte-limit-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const largeFile = join(workspace, "large-sparse.bin");
  await writeFile(largeFile, "", "utf8");
  await truncate(largeFile, 600 * 1024 * 1024);
  const notesPath = join(workspace, "notes.md");
  await writeFile(notesPath, "selected evidence", "utf8");
  const store = new ResearchCheckpointStore(join(workspace, ".localbuddy", "checkpoint"));
  const manifest = await store.initialize({
    runId: "run-byte-limit",
    workspace,
    goal: "Inspect the workspace",
    sourcePaths: [notesPath],
    plan,
  });

  const inspection = await store.inspectResume({
    runId: "run-byte-limit",
    workspace,
    goal: "Inspect the workspace",
    sourcePaths: [notesPath],
  });

  assert.deepEqual(manifest.sourcePaths, [await realpath(notesPath)]);
  assert.equal(inspection.available, true);
});

test("treats bounded source-text search results as read evidence during resume", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-checkpoint-search-evidence-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const notesPath = join(workspace, "policy.txt");
  const originalContent = "第一行\n集成电路产业证据\n第三行\n";
  await writeFile(notesPath, originalContent, "utf8");
  const store = new ResearchCheckpointStore(join(workspace, ".localbuddy", "checkpoint"));
  await store.initialize({
    runId: "run-search-evidence",
    workspace,
    goal: "Search the policy",
    sourcePaths: [notesPath],
    plan,
  });
  const agent = makeAgent();
  const toolCall = {
    id: "search-policy-call",
    name: "search_source_text",
    arguments: '{"path":"source-1","queries":["集成电路"]}',
  };
  const toolContext = { runId: "run-search-evidence", taskId: "read-note", agent };
  const journal = store.toolJournal();
  await journal.start(toolCall, toolContext, "read");
  await journal.complete(toolCall, toolContext, "read", {
    toolCallId: toolCall.id,
    isError: false,
    content: JSON.stringify({
      path: "source-1",
      sha256: createHash("sha256").update(originalContent).digest("hex"),
      bytes: Buffer.byteLength(originalContent),
      matches: [{ line: 2, excerpt: "2: 集成电路产业证据" }],
    }),
  });

  assert.equal((await store.inspectResume({
    runId: "run-search-evidence",
    workspace,
    goal: "Search the policy",
    sourcePaths: [notesPath],
  })).available, true);

  await writeFile(notesPath, "第一行\n证据发生变化\n第三行\n", "utf8");
  const drifted = await store.inspectResume({
    runId: "run-search-evidence",
    workspace,
    goal: "Search the policy",
    sourcePaths: [notesPath],
  });
  assert.equal(drifted.available, false);
  assert.match(drifted.reason ?? "", /local source read by this Run changed/);
});

test("blocks an ambiguous write receipt and preserves append-only task messages", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-checkpoint-write-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const notesPath = join(workspace, "notes.md");
  await writeFile(notesPath, "evidence\n", "utf8");
  const store = new ResearchCheckpointStore(join(workspace, ".localbuddy", "checkpoint"));
  await store.initialize({
    runId: "run-write-ambiguity",
    workspace,
    goal: "Read the note",
    sourcePaths: [notesPath],
    plan,
  });
  const messages: ChatMessage[] = [
    { role: "system", content: "system" },
    { role: "user", content: "user" },
    {
      role: "assistant",
      content: null,
      toolCalls: [{ id: "write-call", name: "write_artifact", arguments: "{}" }],
    },
  ];
  await store.saveTask({
    runId: "run-write-ambiguity",
    taskId: "read-note",
    agentId: "worker-1",
    contractSha256: "a".repeat(64),
    phase: "tool_inflight",
    turn: 0,
    messages,
    pendingToolCalls: [{ id: "write-call", name: "write_artifact", arguments: "{}" }],
    nextToolIndex: 0,
  });
  const agent = makeAgent();
  const contextValue = {
    runId: "run-write-ambiguity",
    taskId: "read-note",
    agent,
  };
  const journal = store.toolJournal();
  assert.equal(
    (await journal.start(
      { id: "write-call", name: "write_artifact", arguments: "{}" },
      contextValue,
      "write",
    )).status,
    "new",
  );
  const blocked = await store.inspectResume({
    runId: "run-write-ambiguity",
    workspace,
    goal: "Read the note",
    sourcePaths: [notesPath],
  });
  assert.equal(blocked.available, false);
  assert.match(blocked.reason ?? "", /ambiguous write tool call/);

  await assert.rejects(
    store.saveTask({
      runId: "run-write-ambiguity",
      taskId: "read-note",
      agentId: "worker-1",
      contractSha256: "a".repeat(64),
      phase: "model_inflight",
      turn: 1,
      messages: [{ role: "system", content: "rewritten" }],
    }),
    /message history was rewritten/,
  );
});

test("continues an Agent Loop after a completed tool-result checkpoint without repeating the tool", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-agent-checkpoint-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const notesPath = join(workspace, "notes.md");
  await writeFile(notesPath, "checkpoint evidence\n", "utf8");
  const checkpointStore = new ResearchCheckpointStore(join(workspace, ".localbuddy", "checkpoint"));
  await checkpointStore.initialize({
    runId: "run-agent-resume",
    workspace,
    goal: "Read evidence",
    sourcePaths: [notesPath],
    plan,
  });
  const eventStore = new InMemoryEventStore();
  let toolExecutions = 0;
  const tool: ToolDefinition<Record<string, never>> = {
    name: "read_once",
    description: "Read deterministic evidence once.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    risk: "read",
    permission: "workspace.read",
    parse() { return {}; },
    async execute() {
      toolExecutions += 1;
      return { content: "checkpoint evidence" };
    },
  };
  const task = makeTask();
  const agent = makeAgent();
  const first = new AgentLoopExecutor({
    modelClient: new (await import("../src/model-runtime.js")).AuditedModelClient(
      new ResumeProvider(),
      eventStore,
    ),
    toolRuntime: new ToolRuntime(
      new ToolRegistry([tool]),
      new RoleBasedApprovalPolicy(),
      eventStore,
      checkpointStore.toolJournal(),
    ),
    checkpointStore,
    onCheckpoint(checkpoint) {
      if (checkpoint.phase === "tool_inflight" && checkpoint.nextToolIndex === 1) {
        throw new Error("simulated process interruption after safe checkpoint");
      }
    },
  });
  await assert.rejects(
    first.execute({ runId: "run-agent-resume", task, agent, dependencyOutputs: new Map() }),
    /simulated process interruption/,
  );

  const second = new AgentLoopExecutor({
    modelClient: new (await import("../src/model-runtime.js")).AuditedModelClient(
      new ResumeProvider(),
      eventStore,
    ),
    toolRuntime: new ToolRuntime(
      new ToolRegistry([tool]),
      new RoleBasedApprovalPolicy(),
      eventStore,
      checkpointStore.toolJournal(),
    ),
    checkpointStore,
  });
  const output = await second.execute({
    runId: "run-agent-resume",
    task,
    agent,
    dependencyOutputs: new Map(),
  });
  assert.equal(output, "grounded result from checkpoint evidence");
  assert.equal(toolExecutions, 1);
  assert.equal((await checkpointStore.loadTask("read-note"))?.phase, "succeeded");
});

test("grants a bounded continuation budget when a user resumes an exhausted Agent Loop", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-agent-turn-budget-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const notesPath = join(workspace, "notes.md");
  await writeFile(notesPath, "checkpoint evidence\n", "utf8");
  const checkpointStore = new ResearchCheckpointStore(join(workspace, ".localbuddy", "checkpoint"));
  await checkpointStore.initialize({
    runId: "run-turn-budget",
    workspace,
    goal: "Read evidence",
    sourcePaths: [notesPath],
    plan,
  });
  const eventStore = new InMemoryEventStore();
  let toolExecutions = 0;
  const tool: ToolDefinition<Record<string, never>> = {
    name: "read_once",
    description: "Read deterministic evidence once.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    risk: "read",
    permission: "workspace.read",
    parse() { return {}; },
    async execute() {
      toolExecutions += 1;
      return { content: "checkpoint evidence" };
    },
  };
  const createExecutor = () => new AgentLoopExecutor({
    modelClient: new AuditedModelClient(new ResumeProvider(), eventStore),
    toolRuntime: new ToolRuntime(
      new ToolRegistry([tool]),
      new RoleBasedApprovalPolicy(),
      eventStore,
      checkpointStore.toolJournal(),
    ),
    checkpointStore,
    maxTurns: 1,
  });
  const task = makeTask();
  const agent = makeAgent();

  await assert.rejects(
    createExecutor().execute({
      runId: "run-turn-budget",
      task,
      agent,
      dependencyOutputs: new Map(),
    }),
    /exceeded 1 model turns/,
  );
  assert.equal((await checkpointStore.loadTask("read-note"))?.turn, 1);

  const output = await createExecutor().execute({
    runId: "run-turn-budget",
    task,
    agent,
    dependencyOutputs: new Map(),
  });
  assert.equal(output, "grounded result from checkpoint evidence");
  assert.equal(toolExecutions, 1);
  assert.equal((await checkpointStore.loadTask("read-note"))?.turn, 2);
});

test("stops an Agent Loop after three independent Artifact Reviewer revisions", async () => {
  let modelCalls = 0;
  const provider: ModelProvider = {
    async complete() {
      modelCalls += 1;
      return {
        model: "artifact-gate-test",
        content: null,
        toolCalls: [{
          id: `artifact-write-${modelCalls}`,
          name: "write_artifact",
          arguments: JSON.stringify({ fileName: "report.md", content: "invalid", calculationIds: [] }),
        }],
        finishReason: "tool_calls",
      };
    },
  };
  const eventStore = new InMemoryEventStore();
  const rejectingTool: ToolDefinition<Record<string, unknown>> = {
    name: "write_artifact",
    description: "Reject invalid artifact writes.",
    parameters: { type: "object" },
    risk: "write",
    permission: "artifact.write",
    parse(value) { return value as Record<string, unknown>; },
    async execute() {
      throw new Error("Independent Artifact Reviewer requested revision: cite the source");
    },
  };
  const executor = new AgentLoopExecutor({
    modelClient: new (await import("../src/model-runtime.js")).AuditedModelClient(provider, eventStore),
    toolRuntime: new ToolRuntime(
      new ToolRegistry([rejectingTool]),
      new RoleBasedApprovalPolicy(),
      eventStore,
    ),
    maxTurns: 8,
  });
  const agent: AgentDefinition = {
    id: "integrator",
    role: "integrator",
    instructions: "Integrate evidence.",
    capabilities: ["integrate"],
    maxParallelTasks: 1,
  };
  const task: TaskDefinition = {
    id: "integrate",
    title: "Integrate",
    input: { instructions: "Write the artifact.", availableTools: ["write_artifact"] },
    requiredCapabilities: ["integrate"],
  };

  await assert.rejects(
    executor.execute({ runId: "run-gate-budget", task, agent, dependencyOutputs: new Map() }),
    /Independent Artifact Reviewer rejected 3 candidates/,
  );
  assert.equal(modelCalls, 3);
  assert.equal(
    (await eventStore.list("run-gate-budget")).filter((event) => event.type === "tool.failed").length,
    3,
  );
});

test("lets an Integrator repair malformed Artifact arguments and completes on the final write", async () => {
  let modelCalls = 0;
  let integratorMaxTokens: number | undefined;
  const provider: ModelProvider = {
    async complete(request) {
      modelCalls += 1;
      integratorMaxTokens = request.maxTokens;
      const successfulWrite = request.messages.some((message) =>
        message.role === "tool"
        && message.toolCallId === "artifact-write-4"
        && !message.content.startsWith("Tool error:"));
      if (successfulWrite) return response("artifact complete");
      return {
        model: "artifact-format-repair-test",
        content: null,
        toolCalls: [{
          id: `artifact-write-${modelCalls}`,
          name: "write_artifact",
          arguments: JSON.stringify({ valid: modelCalls >= 4 }),
        }],
        finishReason: "tool_calls",
      };
    },
  };
  const eventStore = new InMemoryEventStore();
  const tool: ToolDefinition<{ valid: boolean }> = {
    name: "write_artifact",
    description: "Write a valid final artifact.",
    parameters: { type: "object" },
    risk: "write",
    permission: "artifact.write",
    parse(value) {
      const valid = (value as { valid?: unknown }).valid;
      if (valid !== true) throw new Error("malformed artifact arguments");
      return { valid };
    },
    async execute() { return { written: true }; },
  };
  const executor = new AgentLoopExecutor({
    modelClient: new AuditedModelClient(provider, eventStore),
    toolRuntime: new ToolRuntime(
      new ToolRegistry([tool]),
      new RoleBasedApprovalPolicy(),
      eventStore,
    ),
    maxTurns: 8,
  });
  const agent: AgentDefinition = {
    id: "integrator",
    role: "integrator",
    instructions: "Integrate evidence.",
    capabilities: ["integrate"],
    maxParallelTasks: 1,
  };
  const task: TaskDefinition = {
    id: "integrate",
    title: "Integrate",
    input: { instructions: "Write the artifact.", availableTools: ["write_artifact"] },
    requiredCapabilities: ["integrate"],
  };

  assert.equal(
    await executor.execute({ runId: "run-format-repair", task, agent, dependencyOutputs: new Map() }),
    "{\"written\":true}",
  );
  assert.equal(modelCalls, 4);
  assert.equal(integratorMaxTokens, 8_000);
  assert.equal(
    (await eventStore.list("run-format-repair")).filter((event) => event.type === "tool.failed").length,
    3,
  );
});

test("does not require a no-value model summary after the final Artifact succeeds", async () => {
  let modelCalls = 0;
  const eventStore = new InMemoryEventStore();
  const executor = new AgentLoopExecutor({
    modelClient: new AuditedModelClient({
      async complete() {
        modelCalls += 1;
        if (modelCalls > 1) throw new Error("unexpected final summary call");
        return {
          model: "artifact-terminal-test",
          content: null,
          toolCalls: [{
            id: "artifact-terminal-write",
            name: "write_artifact",
            arguments: "{}",
          }],
          finishReason: "tool_calls",
        };
      },
    }, eventStore),
    toolRuntime: new ToolRuntime(
      new ToolRegistry([{
        name: "write_artifact",
        description: "Write final artifact.",
        parameters: { type: "object" },
        risk: "write",
        permission: "artifact.write",
        parse() { return {}; },
        async execute() {
          return { fileName: "report.md", bytes: 8, sha256: "a".repeat(64) };
        },
      }]),
      new RoleBasedApprovalPolicy(),
      eventStore,
    ),
    maxTurns: 1,
  });
  const agent: AgentDefinition = {
    id: "integrator",
    role: "integrator",
    instructions: "Integrate evidence.",
    capabilities: ["integrate"],
    maxParallelTasks: 1,
  };
  const task: TaskDefinition = {
    id: "integrate",
    title: "Integrate",
    input: { instructions: "Write the artifact.", availableTools: ["write_artifact"] },
    requiredCapabilities: ["integrate"],
  };

  const output = await executor.execute({
    runId: "run-artifact-terminal",
    task,
    agent,
    dependencyOutputs: new Map(),
  });
  assert.match(String(output), /"fileName":"report\.md"/);
  assert.equal(modelCalls, 1);
});

test("does not let an Integrator claim success without a successful final Artifact write", async () => {
  const eventStore = new InMemoryEventStore();
  const executor = new AgentLoopExecutor({
    modelClient: new (await import("../src/model-runtime.js")).AuditedModelClient({
      async complete() {
        return response("claimed completion without writing");
      },
    }, eventStore),
    toolRuntime: new ToolRuntime(
      new ToolRegistry([{
        name: "write_artifact",
        description: "Write final artifact.",
        parameters: { type: "object" },
        risk: "write",
        permission: "artifact.write",
        parse(value) { return value; },
        async execute() { return { written: true }; },
      }]),
      new RoleBasedApprovalPolicy(),
      eventStore,
    ),
  });
  const agent: AgentDefinition = {
    id: "integrator",
    role: "integrator",
    instructions: "Integrate evidence.",
    capabilities: ["integrate"],
    maxParallelTasks: 1,
  };
  const task: TaskDefinition = {
    id: "integrate",
    title: "Integrate",
    input: { instructions: "Write the artifact.", availableTools: ["write_artifact"] },
    requiredCapabilities: ["integrate"],
  };

  await assert.rejects(
    executor.execute({ runId: "run-artifact-postcondition", task, agent, dependencyOutputs: new Map() }),
    /before a final Artifact passed its write gate/u,
  );
});

class ResumeProvider implements ModelProvider {
  async complete(request: ModelRequest): Promise<ModelResponse> {
    const hasToolResult = request.messages.some(
      (message) => message.role === "tool" && message.toolCallId === "read-once-call",
    );
    return hasToolResult
      ? response("grounded result from checkpoint evidence")
      : {
          model: "checkpoint-test",
          content: null,
          toolCalls: [{ id: "read-once-call", name: "read_once", arguments: "{}" }],
          finishReason: "tool_calls",
        };
  }
}

function response(content: string): ModelResponse {
  return { model: "checkpoint-test", content, toolCalls: [], finishReason: "stop" };
}

function makeAgent(): AgentDefinition {
  return {
    id: "worker-1",
    role: "worker",
    instructions: "Read evidence.",
    capabilities: ["worker"],
    maxParallelTasks: 1,
  };
}

function makeTask(): TaskDefinition {
  return {
    id: "read-note",
    title: "Read note",
    input: { instructions: "Read once.", availableTools: ["read_once"] },
    requiredCapabilities: ["worker"],
  };
}
