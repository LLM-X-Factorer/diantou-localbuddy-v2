import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ResearchCheckpointStore } from "../src/checkpoint-store.js";
import type { DesktopRunStatus, DesktopRunView } from "../src/desktop-contract.js";
import { DesktopRunManager } from "../src/desktop-run-manager.js";
import { JsonlEventStore } from "../src/event-store.js";
import { PlanReviewStore, type ReviewablePlan } from "../src/plan-review.js";
import type {
  ChatMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../src/provider.js";
import { RunRequestStore } from "../src/run-request-store.js";

test("Desktop rejects a Goal Contract without a completion criterion", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-goal-contract-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  let providerCreated = false;
  const manager = new DesktopRunManager({
    requirePlanReview: true,
    async createProvider() {
      providerCreated = true;
      return new PlanGateProvider();
    },
  });

  await assert.rejects(manager.start({
    workspace,
    goal: "Produce a report",
    concurrency: 1,
  }), /requires at least one verification criterion/u);
  assert.equal(providerCreated, false);
});

test("Desktop does not start a Worker until the exact plan is approved", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-plan-approve-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const sourcePath = join(workspace, "policy.md");
  await writeFile(sourcePath, "official policy evidence", "utf8");
  const provider = new PlanGateProvider();
  const manager = new DesktopRunManager({
    requirePlanReview: true,
    async createProvider() { return provider; },
  });
  const awaiting = waitForStatus(manager, "awaiting_plan_approval");
  const terminal = waitForStatus(manager, "succeeded");

  const started = await manager.start({
    workspace,
    goal: "Produce a grounded policy report",
    goalConstraints: ["Use only explicitly selected evidence"],
    verificationCriteria: ["Every conclusion is traceable to evidence"],
    sourcePaths: [sourcePath],
    concurrency: 2,
    mode: "research",
  });
  const pending = await awaiting;
  assert.equal(pending.runId, started.runId);
  assert.equal(provider.calls, 1, "only the Orchestrator planning call may run before approval");
  assert.equal(pending.planReview?.status, "pending");
  assert.equal(pending.planReview?.goalContract.verificationCriteria[0], "Every conclusion is traceable to evidence");
  assert.equal(pending.planReview?.scope.sourceCount, 1);
  assert.equal(pending.tasks.length, 2);
  assert.ok(pending.tasks.every((task) => task.status === "queued"));
  assert.equal(pending.artifacts.length, 0);

  const eventStore = new JsonlEventStore(join(
    workspace,
    ".localbuddy",
    "runs",
    started.runId,
    "events.jsonl",
  ));
  const beforeApproval = await eventStore.list(started.runId);
  assert.equal(beforeApproval.some((event) => event.type === "task.started"), false);
  assert.equal(beforeApproval.some((event) => event.type === "workspace.created"), false);

  await manager.resolvePlanReview({ workspace, runId: started.runId, decision: "approve" });
  const completed = await terminal;
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.planReview?.status, "approved");
  assert.equal(await readFile(completed.artifacts[0]?.absolutePath ?? "", "utf8"), "# Result\n\nofficial policy evidence\n");

  const events = await eventStore.list(started.runId);
  const reviewIndex = events.findIndex((event) => event.type === "plan.review_requested");
  const approvalIndex = events.findIndex((event) => event.type === "plan.approved");
  const workerIndex = events.findIndex((event) => event.type === "task.started");
  assert.ok(reviewIndex >= 0 && reviewIndex < approvalIndex && approvalIndex < workerIndex);
  assert.equal((await new PlanReviewStore(join(
    workspace,
    ".localbuddy",
    "runs",
    started.runId,
    "plan-review.json",
  )).load()).status, "approved");
});

test("rejecting a Desktop plan ends the Run without any Worker call", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-plan-reject-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const sourcePath = join(workspace, "policy.md");
  await writeFile(sourcePath, "official policy evidence", "utf8");
  const provider = new PlanGateProvider();
  const manager = new DesktopRunManager({
    requirePlanReview: true,
    async createProvider() { return provider; },
  });
  const awaiting = waitForStatus(manager, "awaiting_plan_approval");
  const cancelled = waitForStatus(manager, "cancelled");
  const started = await manager.start({
    workspace,
    goal: "Produce a grounded policy report",
    verificationCriteria: ["Every conclusion is traceable to evidence"],
    sourcePaths: [sourcePath],
    concurrency: 1,
  });
  await awaiting;

  await manager.resolvePlanReview({ workspace, runId: started.runId, decision: "reject" });
  const completed = await cancelled;
  assert.equal(completed.planReview?.status, "rejected");
  assert.ok(completed.tasks.every((task) => task.status === "cancelled"));
  assert.equal(provider.calls, 1);
  const events = await new JsonlEventStore(join(
    workspace,
    ".localbuddy",
    "runs",
    started.runId,
    "events.jsonl",
  )).list(started.runId);
  assert.equal(events.some((event) => event.type === "task.started"), false);
  assert.equal(events.at(-1)?.type, "run.cancelled");
});

test("a pending Plan Review survives a Desktop restart and can resume", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-plan-resume-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const sourcePath = join(workspace, "policy.md");
  await writeFile(sourcePath, "official policy evidence", "utf8");
  const runId = "run-pending-plan-recovery";
  const runRoot = join(workspace, ".localbuddy", "runs", runId);
  const request = await new RunRequestStore().save(runRoot, {
    runId,
    workspace,
    goal: "Produce a grounded policy report",
    goalConstraints: ["Use only explicitly selected evidence"],
    verificationCriteria: ["Every conclusion is traceable to evidence"],
    sourcePaths: [sourcePath],
    concurrency: 1,
    mode: "research",
    runtimeOwner: "desktop",
    planReview: "required",
  });
  const checkpointPlan = {
    tasks: [{ id: "read-policy", title: "Read policy", instructions: "Read the selected policy evidence." }],
    integration: { instructions: "Write a grounded result.", fileName: "result.md" },
  };
  await new ResearchCheckpointStore(join(runRoot, "checkpoint")).initialize({
    runId,
    workspace,
    goal: request.executionGoal,
    sourcePaths: request.sourcePaths,
    plan: checkpointPlan,
  });
  const reviewPlan: ReviewablePlan = {
    mode: "research",
    tasks: checkpointPlan.tasks.map((task) => ({ ...task, ownedPaths: [] })),
    integration: { ...checkpointPlan.integration, verificationCommands: [] },
  };
  await new PlanReviewStore(join(runRoot, "plan-review.json")).prepare({
    runId,
    goalContract: request.goalContract,
    plan: reviewPlan,
    scope: { sourceCount: 1, trustProfile: request.trustProfile, extensionCount: 0 },
    scopeIdentity: {
      mode: request.mode,
      sourcePaths: request.sourcePaths,
      provider: request.provider,
      trustProfile: request.trustProfile,
      extensions: request.extensions,
    },
  });
  const store = new JsonlEventStore(join(runRoot, "events.jsonl"));
  await store.append({ type: "run.started", runId, data: { mode: "research", runtimeOwner: "desktop" } });
  await store.append({ type: "plan.created", runId, taskId: "orchestrate", agentId: "orchestrator" });
  await store.append({ type: "checkpoint.created", runId, data: { mode: "research" } });
  await store.append({ type: "plan.review_requested", runId, taskId: "orchestrate", agentId: "orchestrator" });

  const provider = new PlanGateProvider();
  const manager = new DesktopRunManager({
    requirePlanReview: true,
    async createProvider() { return provider; },
  });
  const interrupted = (await manager.list(workspace)).find((run) => run.runId === runId);
  assert.equal(interrupted?.status, "interrupted");
  assert.equal(interrupted?.planReview?.status, "pending");
  assert.equal(interrupted?.checkpoint?.status, "available");

  const awaiting = waitForStatus(manager, "awaiting_plan_approval", runId);
  const terminal = waitForStatus(manager, "succeeded", runId);
  await manager.resumeRun({ workspace, runId });
  const restored = await awaiting;
  assert.equal(restored.planReview?.status, "pending");
  assert.equal(provider.calls, 0, "resume must restore the persisted plan instead of replanning");
  await manager.resolvePlanReview({ workspace, runId, decision: "approve" });
  assert.equal((await terminal).status, "succeeded");
  assert.equal((await new PlanReviewStore(join(runRoot, "plan-review.json")).load()).status, "approved");
});

class PlanGateProvider implements ModelProvider {
  calls = 0;

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.calls += 1;
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{ id: "read-policy", title: "Read policy", instructions: "Read the selected policy evidence." }],
        integration: { instructions: "Write a grounded result.", fileName: "result.md" },
      }));
    }
    const prompt = lastUserMessage(request.messages);
    const toolIds = new Set(request.messages
      .filter((message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool")
      .map((message) => message.toolCallId));
    if (prompt.includes("Task ID: read-policy")) {
      return toolIds.has("read-policy-tool")
        ? response("official policy evidence")
        : toolResponse("read-policy-tool", "read_file", { path: "source-1" });
    }
    if (prompt.includes("Task ID: integrate")) {
      return toolIds.has("write-result-tool")
        ? response("done")
        : toolResponse("write-result-tool", "write_artifact", {
            fileName: "result.md",
            content: "# Result\n\nofficial policy evidence\n",
            calculationIds: [],
          });
    }
    throw new Error(`Unexpected prompt: ${prompt}`);
  }
}

function waitForStatus(
  manager: DesktopRunManager,
  status: DesktopRunStatus,
  runId?: string,
): Promise<DesktopRunView> {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      unsubscribe();
      rejectPromise(new Error(`Timed out waiting for ${status}`));
    }, 5_000);
    const unsubscribe = manager.subscribe((run) => {
      if (run.status !== status || (runId !== undefined && run.runId !== runId)) return;
      clearTimeout(timer);
      unsubscribe();
      resolvePromise(run);
    });
  });
}

function response(content: string): ModelResponse {
  return { model: "plan-gate-test", content, toolCalls: [], finishReason: "stop" };
}

function toolResponse(id: string, name: string, input: unknown): ModelResponse {
  return {
    model: "plan-gate-test",
    content: null,
    toolCalls: [{ id, name, arguments: JSON.stringify(input) }],
    finishReason: "tool_calls",
  };
}

function lastUserMessage(messages: readonly ChatMessage[]): string {
  const message = messages.toReversed().find((candidate) => candidate.role === "user");
  if (message === undefined || message.role !== "user") throw new Error("Missing user message");
  return message.content;
}
