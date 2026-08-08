import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { buildWorkspaceSnapshot } from "../src/workspace-manifest.js";

const plan = {
  tasks: [{ id: "read-note", title: "Read note", instructions: "Read notes.md." }],
  integration: { instructions: "Write a grounded result.", fileName: "result.md" },
} as const;

test("validates workspace-bound checkpoints and detects workspace drift", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-checkpoint-store-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "notes.md"), "stable evidence\n", "utf8");
  const store = new ResearchCheckpointStore(join(workspace, ".localbuddy", "checkpoint"));
  const snapshot = await buildWorkspaceSnapshot(workspace);
  await store.initialize({
    runId: "run-checkpoint",
    workspace,
    goal: "Read the note",
    snapshot,
    plan,
  });

  const available = await store.inspectResume({
    runId: "run-checkpoint",
    workspace,
    goal: "Read the note",
    snapshot: await buildWorkspaceSnapshot(workspace),
  });
  assert.equal(available.available, true);
  assert.equal(available.resumableTasks, 2);

  await writeFile(join(workspace, "notes.md"), "changed evidence\n", "utf8");
  const drifted = await store.inspectResume({
    runId: "run-checkpoint",
    workspace,
    goal: "Read the note",
    snapshot: await buildWorkspaceSnapshot(workspace),
  });
  assert.equal(drifted.available, false);
  assert.match(drifted.reason ?? "", /workspace contents changed/);
});

test("blocks an ambiguous write receipt and preserves append-only task messages", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-checkpoint-write-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "notes.md"), "evidence\n", "utf8");
  const store = new ResearchCheckpointStore(join(workspace, ".localbuddy", "checkpoint"));
  const snapshot = await buildWorkspaceSnapshot(workspace);
  await store.initialize({
    runId: "run-write-ambiguity",
    workspace,
    goal: "Read the note",
    snapshot,
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
    snapshot: await buildWorkspaceSnapshot(workspace),
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
  await writeFile(join(workspace, "notes.md"), "checkpoint evidence\n", "utf8");
  const checkpointStore = new ResearchCheckpointStore(join(workspace, ".localbuddy", "checkpoint"));
  await checkpointStore.initialize({
    runId: "run-agent-resume",
    workspace,
    goal: "Read evidence",
    snapshot: await buildWorkspaceSnapshot(workspace),
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
