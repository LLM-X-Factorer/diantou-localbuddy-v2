import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  InMemoryEventStore,
  type PendingRuntimeEvent,
  type RuntimeEvent,
} from "../src/event-store.js";
import { normalizeGoalContract } from "../src/goal-contract.js";
import {
  InteractivePlanReviewBroker,
  PlanReviewStore,
  type ReviewablePlan,
} from "../src/plan-review.js";

const PLAN: ReviewablePlan = {
  mode: "research",
  tasks: [{
    id: "policy-evidence",
    title: "Collect policy evidence",
    instructions: "Use only the explicitly selected files.",
    ownedPaths: [],
  }],
  integration: {
    instructions: "Write a grounded report and label inference.",
    fileName: "report.md",
    verificationCommands: [],
  },
};

test("persists an exact Plan Review approval and audits the decision", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-plan-review-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const eventStore = new InMemoryEventStore();
  const store = new PlanReviewStore(join(root, "plan-review.json"));
  const broker = new InteractivePlanReviewBroker({
    runId: "run-plan-review",
    goalContract: normalizeGoalContract({
      outcome: "Produce a grounded report",
      constraints: ["No implicit folder scan"],
      verificationCriteria: ["Every claim is sourced"],
    }),
    scope: { sourceCount: 2, trustProfile: "balanced", extensionCount: 0 },
    scopeIdentity: { sourcePaths: ["source-a", "source-b"], provider: "fixture" },
    store,
    eventStore,
  });

  const waiting = broker.review(PLAN);
  await waitUntil(() => broker.current?.status === "pending");
  await waitUntil(async () => (await eventStore.list()).some((event) => event.type === "plan.review_requested"));
  const approvalSha256 = broker.current?.approvalSha256;
  assert.equal(approvalSha256?.length, 64);
  await broker.resolve("approve");
  await waiting;

  const persisted = await store.load();
  assert.equal(persisted.status, "approved");
  assert.equal(persisted.approvalSha256, approvalSha256);
  assert.deepEqual((await eventStore.list()).map((event) => event.type), [
    "plan.review_requested",
    "plan.approved",
  ]);

  await assert.rejects(
    broker.review({
      ...PLAN,
      integration: { ...PLAN.integration, fileName: "silently-changed.md" },
    }),
    /does not match the current Goal, scope, or plan/u,
  );
});

test("rejecting a Plan Review ends the waiter without running it", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-plan-reject-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const eventStore = new InMemoryEventStore();
  const store = new PlanReviewStore(join(root, "plan-review.json"));
  const broker = new InteractivePlanReviewBroker({
    runId: "run-plan-reject",
    goalContract: normalizeGoalContract({ outcome: "Reject unsafe scope" }),
    scope: { sourceCount: 0, trustProfile: "strict", extensionCount: 0 },
    scopeIdentity: { sourcePaths: [] },
    store,
    eventStore,
  });

  const waiting = broker.review(PLAN);
  await waitUntil(() => broker.current?.status === "pending");
  const rejected = assert.rejects(waiting, /rejected by the user/u);
  await broker.resolve("reject");
  await rejected;
  assert.equal((await store.load()).status, "rejected");
  assert.ok((await eventStore.list()).some((event) => event.type === "plan.rejected"));
});

test("retries the audit event without losing a persisted approval", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-plan-audit-retry-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const eventStore = new FailOnceApprovalEventStore();
  const store = new PlanReviewStore(join(root, "plan-review.json"));
  const broker = createBroker("run-plan-audit-retry", store, eventStore);

  const waiting = broker.review(PLAN);
  await waitUntil(() => broker.current?.status === "pending");
  await assert.rejects(broker.resolve("approve"), /injected approval audit failure/u);
  assert.equal((await store.load()).status, "approved");
  assert.equal((await eventStore.list()).some((event) => event.type === "plan.approved"), false);

  await broker.resolve("approve");
  await waiting;
  assert.equal(broker.current?.status, "approved");
  assert.equal((await eventStore.list()).filter((event) => event.type === "plan.approved").length, 1);
});

test("repairs a missing resolution audit when an approved review is restored", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-plan-audit-restore-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const eventStore = new InMemoryEventStore();
  const store = new PlanReviewStore(join(root, "plan-review.json"));
  const prepared = await store.prepare({
    runId: "run-plan-audit-restore",
    goalContract: normalizeGoalContract({ outcome: "Restore an exact approved plan" }),
    plan: PLAN,
    scope: { sourceCount: 0, trustProfile: "strict", extensionCount: 0 },
    scopeIdentity: { sourcePaths: [] },
  });
  await store.resolve(
    prepared.record.runId,
    prepared.record.approvalSha256,
    "approved",
    "desktop",
  );

  await createBroker(prepared.record.runId, store, eventStore).review(PLAN);
  const approvals = (await eventStore.list()).filter((event) => event.type === "plan.approved");
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0]?.data?.approvalSha256, prepared.record.approvalSha256);
});

function createBroker(
  runId: string,
  store: PlanReviewStore,
  eventStore: InMemoryEventStore,
): InteractivePlanReviewBroker {
  return new InteractivePlanReviewBroker({
    runId,
    goalContract: normalizeGoalContract({ outcome: "Restore an exact approved plan" }),
    scope: { sourceCount: 0, trustProfile: "strict", extensionCount: 0 },
    scopeIdentity: { sourcePaths: [] },
    store,
    eventStore,
  });
}

class FailOnceApprovalEventStore extends InMemoryEventStore {
  #shouldFail = true;

  override async append(event: PendingRuntimeEvent): Promise<RuntimeEvent> {
    if (event.type === "plan.approved" && this.#shouldFail) {
      this.#shouldFail = false;
      throw new Error("injected approval audit failure");
    }
    return super.append(event);
  }
}

async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Plan Review state");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
}
