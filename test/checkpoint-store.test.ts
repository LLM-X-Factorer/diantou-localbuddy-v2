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

test("stops an Agent Loop after three Artifact Gate rejections", async () => {
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
    async execute() { throw new Error("Artifact Gate feedback: cite the calculation ID"); },
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
    /Artifact Gate rejected 3 write attempts/,
  );
  assert.equal(modelCalls, 3);
  assert.equal(
    (await eventStore.list("run-gate-budget")).filter((event) => event.type === "tool.failed").length,
    3,
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
