import assert from "node:assert/strict";
import test from "node:test";

import type { AgentDefinition } from "../src/domain.js";
import type { ProviderToolCall } from "../src/provider.js";
import {
  UnifiedApprovalPolicy,
  trustDisposition,
  type ToolDefinition,
} from "../src/tool-runtime.js";

const codeWorker: AgentDefinition = {
  id: "code-worker-1",
  role: "code-worker",
  instructions: "test",
  capabilities: ["code"],
  maxParallelTasks: 1,
};

test("maps every permission in each trust profile without an implicit fallback", () => {
  assert.equal(trustDisposition("balanced", "workspace.read"), "auto");
  assert.equal(trustDisposition("balanced", "external.effect"), "prompt-always");
  assert.equal(trustDisposition("strict", "worktree.write"), "prompt-once");
  assert.equal(trustDisposition("strict", "process.execute"), "prompt-always");
  assert.equal(trustDisposition("automation", "external.effect"), "deny");
});

test("strict policy remembers only a prompt-once grant and prompts every process execution", async () => {
  let approvals = 0;
  const policy = new UnifiedApprovalPolicy({
    profile: "strict",
    approvalHandler: {
      async request() {
        approvals += 1;
        return { allowed: true, reason: "approved by test user" };
      },
    },
  });
  const write = tool("replace_text", "write", "worktree.write");
  const check = tool("run_check", "execute", "process.execute");
  const context = { runId: "trust-run", taskId: "trust-task", agent: codeWorker };
  const call: ProviderToolCall = { id: "call-one", name: write.name, arguments: "{}" };
  assert.equal((await policy.authorize(write, context, call)).allowed, true);
  assert.equal((await policy.authorize(write, context, { ...call, id: "call-two" })).allowed, true);
  assert.equal(approvals, 1);
  assert.equal((await policy.authorize(check, context, { ...call, id: "call-three", name: check.name })).allowed, true);
  assert.equal((await policy.authorize(check, context, { ...call, id: "call-four", name: check.name })).allowed, true);
  assert.equal(approvals, 3);
});

test("denies unclassified tools and cannot use approval to bypass role ownership", async () => {
  const policy = new UnifiedApprovalPolicy({
    profile: "strict",
    approvalHandler: {
      async request() {
        return { allowed: true, reason: "approval cannot expand role rights" };
      },
    },
  });
  const context = { runId: "trust-run", taskId: "trust-task", agent: codeWorker };
  const unclassified: ToolDefinition = {
    name: "unknown_write",
    description: "No permission metadata.",
    parameters: { type: "object" },
    risk: "write",
    parse: (value) => value,
    execute: async () => undefined,
  };
  assert.equal((await policy.authorize(unclassified, context)).allowed, false);
  const artifact = tool("write_artifact", "write", "artifact.write");
  assert.equal((await policy.authorize(
    artifact,
    context,
    { id: "artifact-call", name: artifact.name, arguments: "{}" },
  )).allowed, false);
});

test("automation denies external effects even when a Run tries to preauthorize them", async () => {
  const policy = new UnifiedApprovalPolicy({
    profile: "automation",
    preauthorized: new Set(["external.effect"]),
  });
  const externalEffect = tool("mcp__write", "execute", "external.effect");
  const decision = await policy.authorize(externalEffect, {
    runId: "automation-run",
    taskId: "automation-task",
    agent: codeWorker,
  }, { id: "effect-call", name: externalEffect.name, arguments: "{}" });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /automation trust policy denies/);
});

function tool(
  name: string,
  risk: "read" | "compute" | "write" | "execute",
  permission: NonNullable<ToolDefinition["permission"]>,
): ToolDefinition {
  return {
    name,
    description: "Trust policy fixture.",
    parameters: { type: "object" },
    risk,
    permission,
    parse: (value) => value,
    execute: async () => undefined,
  };
}
