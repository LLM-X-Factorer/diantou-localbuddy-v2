import { createHash, randomUUID } from "node:crypto";

import type { EventStore } from "./event-store.js";
import type { ProviderToolCall } from "./provider.js";
import type {
  ApprovalDecision,
  ToolContext,
  ToolDefinition,
} from "./tool-runtime.js";

const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60_000;
const MAX_ARGUMENT_PREVIEW = 4_000;
const SENSITIVE_KEY = /(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|passwd|secret|cookie|credential)/iu;

export interface ToolApprovalInput {
  tool: ToolDefinition;
  context: ToolContext;
  toolCall: ProviderToolCall;
}

export interface ToolApprovalHandler {
  request(input: ToolApprovalInput): Promise<ApprovalDecision>;
}

export interface PendingToolApproval {
  id: string;
  runId: string;
  taskId: string;
  agentId: string;
  toolName: string;
  toolDescription: string;
  argumentsPreview: string;
  argumentsSha256: string;
  requestedAt: string;
  expiresAt: string;
}

export type ToolApprovalResolution = "approve" | "deny";

interface PendingEntry {
  request: PendingToolApproval;
  finish(decision: ApprovalDecision): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortListener?: () => void;
  resolving: boolean;
}

export class InteractiveToolApprovalBroker implements ToolApprovalHandler {
  readonly #eventStore: EventStore;
  readonly #onChange?: (pending: readonly PendingToolApproval[]) => void;
  readonly #timeoutMs: number;
  readonly #clock: () => Date;
  readonly #pending = new Map<string, PendingEntry>();

  constructor(options: {
    eventStore: EventStore;
    onChange?: (pending: readonly PendingToolApproval[]) => void;
    timeoutMs?: number;
    clock?: () => Date;
  }) {
    this.#eventStore = options.eventStore;
    this.#onChange = options.onChange;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
    this.#clock = options.clock ?? (() => new Date());
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1_000 || this.#timeoutMs > 30 * 60_000) {
      throw new Error("approval timeout must be between 1 second and 30 minutes");
    }
  }

  list(): readonly PendingToolApproval[] {
    return [...this.#pending.values()].map((entry) => ({ ...entry.request }));
  }

  async request(input: ToolApprovalInput): Promise<ApprovalDecision> {
    const now = this.#clock();
    const id = `approval-${randomUUID()}`;
    const argumentsSha256 = createHash("sha256").update(input.toolCall.arguments).digest("hex");
    const request: PendingToolApproval = {
      id,
      runId: input.context.runId,
      taskId: input.context.taskId,
      agentId: input.context.agent.id,
      toolName: input.tool.name,
      toolDescription: input.tool.description.slice(0, 1_000),
      argumentsPreview: approvalArgumentsPreview(input.tool.name, input.toolCall.arguments),
      argumentsSha256,
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.#timeoutMs).toISOString(),
    };
    await this.#eventStore.append({
      type: "approval.requested",
      runId: request.runId,
      taskId: request.taskId,
      agentId: request.agentId,
      data: {
        approvalId: request.id,
        toolName: request.toolName,
        argumentsSha256,
        expiresAt: request.expiresAt,
      },
    });

    return new Promise<ApprovalDecision>((resolvePromise) => {
      const timer = setTimeout(() => {
        void this.#settle(id, "deny", "interactive approval timed out");
      }, this.#timeoutMs);
      const entry: PendingEntry = {
        request,
        finish: resolvePromise,
        timer,
        signal: input.context.signal,
        resolving: false,
      };
      if (input.context.signal !== undefined) {
        entry.abortListener = () => {
          void this.#settle(id, "deny", "Run was cancelled while approval was pending");
        };
        input.context.signal.addEventListener("abort", entry.abortListener, { once: true });
      }
      this.#pending.set(id, entry);
      this.#notify();
    });
  }

  resolve(id: string, resolution: ToolApprovalResolution): Promise<void> {
    if (resolution !== "approve" && resolution !== "deny") {
      throw new Error("approval resolution must be approve or deny");
    }
    return this.#settle(
      id,
      resolution,
      resolution === "approve" ? "approved once by the local user" : "denied by the local user",
    );
  }

  async denyAll(reason: string): Promise<void> {
    await Promise.all(this.list().map((request) => this.#settle(request.id, "deny", reason)));
  }

  async #settle(
    id: string,
    resolution: ToolApprovalResolution,
    reason: string,
  ): Promise<void> {
    const entry = this.#pending.get(id);
    if (entry === undefined) throw new Error(`tool approval is not pending: ${id}`);
    if (entry.resolving) throw new Error(`tool approval is already resolving: ${id}`);
    entry.resolving = true;
    try {
      await this.#eventStore.append({
        type: "approval.resolved",
        runId: entry.request.runId,
        taskId: entry.request.taskId,
        agentId: entry.request.agentId,
        data: {
          approvalId: id,
          toolName: entry.request.toolName,
          decision: resolution,
          reason,
        },
      });
      clearTimeout(entry.timer);
      if (entry.signal !== undefined && entry.abortListener !== undefined) {
        entry.signal.removeEventListener("abort", entry.abortListener);
      }
      this.#pending.delete(id);
      this.#notify();
      entry.finish({ allowed: resolution === "approve", reason });
    } catch (error) {
      entry.resolving = false;
      throw error;
    }
  }

  #notify(): void {
    this.#onChange?.(this.list());
  }
}

export function approvalArgumentsPreview(toolName: string, rawArguments: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments) as unknown;
  } catch {
    return "[invalid JSON arguments hidden]";
  }
  const redacted = redactValue(parsed, toolName === "browser_fill");
  const serialized = JSON.stringify(redacted, null, 2);
  return serialized.length <= MAX_ARGUMENT_PREVIEW
    ? serialized
    : `${serialized.slice(0, MAX_ARGUMENT_PREVIEW)}\n[arguments preview truncated]`;
}

function redactValue(value: unknown, redactBrowserValue: boolean, key = "", depth = 0): unknown {
  if (SENSITIVE_KEY.test(key) || (redactBrowserValue && key === "value")) {
    return "[redacted]";
  }
  if (depth >= 8) return "[depth limit]";
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => redactValue(item, redactBrowserValue, "", depth + 1));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 100)
      .map(([childKey, childValue]) => [
        childKey,
        redactValue(childValue, redactBrowserValue, childKey, depth + 1),
      ]));
  }
  return value;
}
