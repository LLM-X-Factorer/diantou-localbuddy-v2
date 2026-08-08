import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentId, RunId, TaskId } from "./domain.js";

export type RuntimeEventType =
  | "run.started"
  | "run.resumed"
  | "run.interrupted"
  | "run.restarted"
  | "run.succeeded"
  | "run.failed"
  | "run.cancelled"
  | "plan.created"
  | "extensions.loaded"
  | "extensions.close_failed"
  | "task.queued"
  | "task.started"
  | "task.succeeded"
  | "task.failed"
  | "task.blocked"
  | "task.cancelled"
  | "model.requested"
  | "model.completed"
  | "model.failed"
  | "tool.requested"
  | "tool.approved"
  | "tool.denied"
  | "tool.completed"
  | "tool.reused"
  | "tool.failed"
  | "execution.started"
  | "execution.completed"
  | "execution.failed"
  | "approval.requested"
  | "approval.resolved"
  | "workspace.created"
  | "workspace.diff_captured"
  | "workspace.removed"
  | "checkpoint.created"
  | "checkpoint.restored"
  | "checkpoint.resume_blocked"
  | "integration.preflight_started"
  | "integration.preflight_failed"
  | "integration.conflict_resolution_started"
  | "integration.conflict_resolution_completed"
  | "integration.awaiting_approval"
  | "integration.approved"
  | "integration.applying"
  | "integration.applied"
  | "integration.committed"
  | "integration.reverted"
  | "integration.revert_committed"
  | "integration.revert_failed"
  | "integration.failed"
  | "integration.recovery_required"
  | "artifact.created";

export interface RuntimeEvent {
  sequence: number;
  timestamp: string;
  type: RuntimeEventType;
  runId: RunId;
  taskId?: TaskId;
  agentId?: AgentId;
  data?: Record<string, unknown>;
}

export type PendingRuntimeEvent = Omit<RuntimeEvent, "sequence" | "timestamp">;

export interface EventStore {
  append(event: PendingRuntimeEvent): Promise<RuntimeEvent>;
  list(runId?: RunId): Promise<readonly RuntimeEvent[]>;
}

type Clock = () => Date;

export class InMemoryEventStore implements EventStore {
  readonly #events: RuntimeEvent[] = [];
  readonly #clock: Clock;

  constructor(clock: Clock = () => new Date()) {
    this.#clock = clock;
  }

  async append(event: PendingRuntimeEvent): Promise<RuntimeEvent> {
    const stored: RuntimeEvent = {
      ...event,
      sequence: this.#events.length + 1,
      timestamp: this.#clock().toISOString(),
    };
    this.#events.push(stored);
    return stored;
  }

  async list(runId?: RunId): Promise<readonly RuntimeEvent[]> {
    return this.#events.filter((event) => runId === undefined || event.runId === runId);
  }
}

export class JsonlEventStore implements EventStore {
  readonly #filePath: string;
  readonly #clock: Clock;
  #sequence = 0;
  #initialized = false;
  #pending: Promise<void> = Promise.resolve();

  constructor(filePath: string, clock: Clock = () => new Date()) {
    this.#filePath = filePath;
    this.#clock = clock;
  }

  append(event: PendingRuntimeEvent): Promise<RuntimeEvent> {
    return this.#serialize(async () => {
      await this.#initialize();
      const stored: RuntimeEvent = {
        ...event,
        sequence: this.#sequence + 1,
        timestamp: this.#clock().toISOString(),
      };
      await appendFile(this.#filePath, `${JSON.stringify(stored)}\n`, "utf8");
      this.#sequence = stored.sequence;
      return stored;
    });
  }

  async list(runId?: RunId): Promise<readonly RuntimeEvent[]> {
    await this.#pending;
    await this.#initialize();

    let content: string;
    try {
      content = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const events = content
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line, index) => parseEvent(line, index + 1));
    return events.filter((event) => runId === undefined || event.runId === runId);
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation);
    this.#pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    await mkdir(dirname(this.#filePath), { recursive: true });
    try {
      const content = await readFile(this.#filePath, "utf8");
      const lines = content.split("\n").filter((line) => line.length > 0);
      const lastLine = lines.at(-1);
      this.#sequence = lastLine === undefined ? 0 : parseEvent(lastLine, lines.length).sequence;
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) {
        throw error;
      }
    }
    this.#initialized = true;
  }
}

function parseEvent(line: string, lineNumber: number): RuntimeEvent {
  try {
    return JSON.parse(line) as RuntimeEvent;
  } catch (error) {
    throw new Error(`Invalid event JSON at line ${lineNumber}`, { cause: error });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
