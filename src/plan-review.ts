import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { EventStore } from "./event-store.js";
import { normalizeGoalContract, type GoalContract } from "./goal-contract.js";
import { assertPrivateFileIfPresent, writePrivateJsonAtomic } from "./private-storage.js";

const MAX_PLAN_REVIEW_BYTES = 1024 * 1024;

export interface ReviewablePlanTask {
  id: string;
  title: string;
  instructions: string;
  ownedPaths: readonly string[];
}

export interface ReviewablePlan {
  mode: "research" | "code";
  tasks: readonly ReviewablePlanTask[];
  integration: {
    instructions: string;
    fileName: string;
    verificationCommands: readonly string[];
  };
}

export interface PlanReviewScopeSummary {
  sourceCount: number;
  trustProfile: "strict" | "balanced" | "automation";
  extensionCount: number;
}

export type PlanReviewStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface PlanReviewRecord {
  version: 1;
  runId: string;
  goalContract: GoalContract;
  plan: ReviewablePlan;
  scope: PlanReviewScopeSummary;
  scopeSha256: string;
  approvalSha256: string;
  status: PlanReviewStatus;
  requestedAt: string;
  resolvedAt?: string;
  decisionSource?: "desktop" | "runtime-cancel";
}

export type PlanReviewHandler = (
  plan: ReviewablePlan,
  signal?: AbortSignal,
) => Promise<void>;

interface PreparePlanReviewInput {
  runId: string;
  goalContract: GoalContract;
  plan: ReviewablePlan;
  scope: PlanReviewScopeSummary;
  scopeIdentity: unknown;
}

export class PlanReviewStore {
  readonly #filePath: string;
  readonly #clock: () => Date;

  constructor(filePath: string, clock: () => Date = () => new Date()) {
    this.#filePath = resolve(filePath);
    this.#clock = clock;
  }

  async prepare(input: PreparePlanReviewInput): Promise<{
    record: PlanReviewRecord;
    created: boolean;
  }> {
    const goalContract = normalizeGoalContract(input.goalContract);
    const plan = normalizeReviewablePlan(input.plan);
    const scope = normalizeScope(input.scope);
    const scopeSha256 = sha256(JSON.stringify(input.scopeIdentity));
    const approvalSha256 = approvalDigest(goalContract, plan, scopeSha256);
    try {
      const existing = await this.load();
      if (
        existing.runId !== input.runId
        || existing.approvalSha256 !== approvalSha256
        || existing.scopeSha256 !== scopeSha256
      ) {
        throw new Error("persisted Plan Review does not match the current Goal, scope, or plan");
      }
      return { record: existing, created: false };
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) throw error;
    }
    const record: PlanReviewRecord = {
      version: 1,
      runId: input.runId,
      goalContract,
      plan,
      scope,
      scopeSha256,
      approvalSha256,
      status: "pending",
      requestedAt: this.#clock().toISOString(),
    };
    await writeJsonAtomic(this.#filePath, record);
    return { record, created: true };
  }

  async load(): Promise<PlanReviewRecord> {
    await assertPrivateFileIfPresent(this.#filePath);
    const bytes = await readFile(this.#filePath);
    if (bytes.length > MAX_PLAN_REVIEW_BYTES) {
      throw new Error("Plan Review record exceeds the safe size limit");
    }
    return parsePlanReviewRecord(JSON.parse(bytes.toString("utf8")) as unknown);
  }

  async resolve(
    runId: string,
    approvalSha256: string,
    status: Exclude<PlanReviewStatus, "pending">,
    decisionSource: PlanReviewRecord["decisionSource"],
  ): Promise<PlanReviewRecord> {
    const current = await this.load();
    if (current.runId !== runId || current.approvalSha256 !== approvalSha256) {
      throw new Error("Plan Review decision does not match the pending contract");
    }
    if (current.status !== "pending") {
      if (current.status === status) return current;
      throw new Error(`Plan Review was already resolved as ${current.status}`);
    }
    const next: PlanReviewRecord = {
      ...current,
      status,
      resolvedAt: this.#clock().toISOString(),
      decisionSource,
    };
    await writeJsonAtomic(this.#filePath, next);
    return next;
  }
}

interface InteractivePlanReviewBrokerOptions extends Omit<PreparePlanReviewInput, "plan"> {
  store: PlanReviewStore;
  eventStore: EventStore;
  onChange?: (record: PlanReviewRecord) => void;
}

export class InteractivePlanReviewBroker {
  readonly #options: InteractivePlanReviewBrokerOptions;
  #current?: PlanReviewRecord;
  #waiter?: {
    resolve(): void;
    reject(error: Error): void;
  };

  constructor(options: InteractivePlanReviewBrokerOptions) {
    this.#options = options;
  }

  get current(): PlanReviewRecord | undefined {
    return this.#current;
  }

  async review(plan: ReviewablePlan, signal?: AbortSignal): Promise<void> {
    if (this.#waiter !== undefined) {
      throw new Error("A Plan Review decision is already pending");
    }
    const prepared = await this.#options.store.prepare({ ...this.#options, plan });
    this.#current = prepared.record;
    this.#options.onChange?.(prepared.record);
    if (prepared.record.status === "approved") {
      await this.#ensureResolutionAudited(prepared.record);
      return;
    }
    if (prepared.record.status !== "pending") {
      await this.#ensureResolutionAudited(prepared.record);
      throw new PlanReviewEndedError(prepared.record.status);
    }

    let removeAbortListener: () => void = () => undefined;
    const decision = new Promise<void>((resolvePromise, rejectPromise) => {
      const onAbort = () => rejectPromise(new PlanReviewEndedError("cancelled"));
      if (signal?.aborted === true) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => signal?.removeEventListener("abort", onAbort);
      this.#waiter = {
        resolve: resolvePromise,
        reject: rejectPromise,
      };
    });
    await this.#options.eventStore.append({
      type: "plan.review_requested",
      runId: this.#options.runId,
      taskId: "orchestrate",
      agentId: "orchestrator",
      data: {
        approvalSha256: prepared.record.approvalSha256,
        taskCount: prepared.record.plan.tasks.length,
        mode: prepared.record.plan.mode,
        restored: !prepared.created,
      },
    });
    try {
      await decision;
    } finally {
      removeAbortListener();
      this.#waiter = undefined;
    }
  }

  async resolve(decision: "approve" | "reject"): Promise<PlanReviewRecord> {
    const current = this.#current ?? await this.#options.store.load();
    if (current.status !== "pending" || this.#waiter === undefined) {
      throw new Error("Run has no live Plan Review decision");
    }
    const status = decision === "approve" ? "approved" : "rejected";
    const resolved = await this.#options.store.resolve(
      current.runId,
      current.approvalSha256,
      status,
      "desktop",
    );
    await this.#ensureResolutionAudited(resolved);
    this.#current = resolved;
    this.#options.onChange?.(resolved);
    if (decision === "approve") this.#waiter.resolve();
    else this.#waiter.reject(new PlanReviewEndedError("rejected"));
    return resolved;
  }

  async cancel(): Promise<void> {
    const current = this.#current;
    if (current?.status !== "pending" || this.#waiter === undefined) return;
    const resolved = await this.#options.store.resolve(
      current.runId,
      current.approvalSha256,
      "cancelled",
      "runtime-cancel",
    );
    await this.#ensureResolutionAudited(resolved);
    this.#current = resolved;
    this.#options.onChange?.(resolved);
    this.#waiter.reject(new PlanReviewEndedError("cancelled"));
  }

  async #ensureResolutionAudited(record: PlanReviewRecord): Promise<void> {
    if (record.status === "pending") return;
    const type = record.status === "approved" ? "plan.approved" : "plan.rejected";
    const existing = (await this.#options.eventStore.list(record.runId)).some((event) =>
      event.type === type
      && event.data?.approvalSha256 === record.approvalSha256,
    );
    if (existing) return;
    await this.#options.eventStore.append({
      type,
      runId: record.runId,
      taskId: "orchestrate",
      agentId: "orchestrator",
      data: {
        approvalSha256: record.approvalSha256,
        source: record.decisionSource,
        status: record.status,
      },
    });
  }
}

export class PlanReviewEndedError extends Error {
  readonly status: Exclude<PlanReviewStatus, "pending">;

  constructor(status: Exclude<PlanReviewStatus, "pending">) {
    super(status === "rejected" ? "Plan was rejected by the user" : "Plan Review was cancelled");
    this.name = "PlanReviewEndedError";
    this.status = status;
  }
}

export function normalizeReviewablePlan(input: ReviewablePlan): ReviewablePlan {
  if (input.mode !== "research" && input.mode !== "code") {
    throw new Error("Plan Review mode must be research or code");
  }
  if (!Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > 8) {
    throw new Error("Plan Review must contain between 1 and 8 tasks");
  }
  const ids = new Set<string>();
  const tasks = input.tasks.map((task, index) => {
    const id = requiredString(task.id, `Plan Review task ${index} id`, 120);
    if (ids.has(id)) throw new Error(`Duplicate Plan Review task id: ${id}`);
    ids.add(id);
    return {
      id,
      title: requiredString(task.title, `Plan Review task ${index} title`, 500),
      instructions: requiredString(task.instructions, `Plan Review task ${index} instructions`, 10_000),
      ownedPaths: normalizeStrings(task.ownedPaths, `Plan Review task ${index} ownedPaths`, 200),
    };
  });
  return {
    mode: input.mode,
    tasks,
    integration: {
      instructions: requiredString(
        input.integration.instructions,
        "Plan Review integration instructions",
        10_000,
      ),
      fileName: requiredString(input.integration.fileName, "Plan Review output file", 500),
      verificationCommands: normalizeStrings(
        input.integration.verificationCommands,
        "Plan Review verification commands",
        100,
      ),
    },
  };
}

function parsePlanReviewRecord(value: unknown): PlanReviewRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Plan Review record must be an object");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1
    || typeof record.runId !== "string"
    || (record.status !== "pending"
      && record.status !== "approved"
      && record.status !== "rejected"
      && record.status !== "cancelled")
    || typeof record.scopeSha256 !== "string"
    || typeof record.approvalSha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(record.scopeSha256)
    || !/^[a-f0-9]{64}$/u.test(record.approvalSha256)
    || typeof record.requestedAt !== "string"
    || Number.isNaN(Date.parse(record.requestedAt))
    || (record.resolvedAt !== undefined
      && (typeof record.resolvedAt !== "string" || Number.isNaN(Date.parse(record.resolvedAt))))
  ) {
    throw new Error("Plan Review record has an invalid contract");
  }
  const goalContract = normalizeGoalContract(record.goalContract as GoalContract);
  const plan = normalizeReviewablePlan(record.plan as ReviewablePlan);
  const scope = normalizeScope(record.scope as PlanReviewScopeSummary);
  if (record.approvalSha256 !== approvalDigest(goalContract, plan, record.scopeSha256)) {
    throw new Error("Plan Review approval digest does not match its contract");
  }
  if (record.status === "pending" && record.resolvedAt !== undefined) {
    throw new Error("Pending Plan Review cannot have a resolution timestamp");
  }
  if (record.status === "pending" && record.decisionSource !== undefined) {
    throw new Error("Pending Plan Review cannot have a decision source");
  }
  if (record.status !== "pending" && record.resolvedAt === undefined) {
    throw new Error("Resolved Plan Review must have a resolution timestamp");
  }
  if (record.status !== "pending"
    && record.decisionSource !== "desktop"
    && record.decisionSource !== "runtime-cancel") {
    throw new Error("Resolved Plan Review must record its decision source");
  }
  if (record.status === "cancelled" && record.decisionSource !== "runtime-cancel") {
    throw new Error("Cancelled Plan Review must record runtime cancellation");
  }
  if ((record.status === "approved" || record.status === "rejected")
    && record.decisionSource !== "desktop") {
    throw new Error("Desktop Plan Review decision must record the desktop source");
  }
  return {
    version: 1,
    runId: record.runId,
    goalContract,
    plan,
    scope,
    scopeSha256: record.scopeSha256,
    approvalSha256: record.approvalSha256,
    status: record.status,
    requestedAt: record.requestedAt,
    resolvedAt: record.resolvedAt as string | undefined,
    decisionSource: record.decisionSource === "desktop" || record.decisionSource === "runtime-cancel"
      ? record.decisionSource
      : undefined,
  };
}

function normalizeScope(scope: PlanReviewScopeSummary): PlanReviewScopeSummary {
  if (
    scope === null
    || typeof scope !== "object"
    || !Number.isInteger(scope.sourceCount)
    || scope.sourceCount < 0
    || (scope.trustProfile !== "strict"
      && scope.trustProfile !== "balanced"
      && scope.trustProfile !== "automation")
    || !Number.isInteger(scope.extensionCount)
    || scope.extensionCount < 0
  ) {
    throw new Error("Plan Review scope has an invalid contract");
  }
  return { ...scope };
}

function approvalDigest(
  goalContract: GoalContract,
  plan: ReviewablePlan,
  scopeSha256: string,
): string {
  return sha256(JSON.stringify({ goalContract, plan, scopeSha256 }));
}

function normalizeStrings(values: readonly string[], label: string, maximum: number): readonly string[] {
  if (!Array.isArray(values) || values.length > maximum) {
    throw new Error(`${label} must contain at most ${maximum} items`);
  }
  return values.map((value, index) => requiredString(value, `${label}[${index}]`, 2_000));
}

function requiredString(value: string, label: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`${label} must contain between 1 and ${maximum} characters`);
  }
  return value.trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writePrivateJsonAtomic(path, value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
