import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { ChatMessage, ProviderToolCall } from "./provider.js";
import { parsePlan, type HeadlessPlan } from "./planner.js";
import {
  hashResearchSourceReference,
  resolveResearchSources,
} from "./research-sources.js";
import type {
  ToolContext,
  ToolExecutionJournal,
  ToolExecutionResult,
  ToolJournalState,
  ToolRisk,
} from "./tool-runtime.js";

const MAX_CHECKPOINT_BYTES = 10 * 1024 * 1024;

export interface ResearchRunCheckpoint {
  version: 2;
  runId: string;
  mode: "research";
  workspace: string;
  goalSha256: string;
  sourcePaths: readonly string[];
  plan: HeadlessPlan;
  createdAt: string;
  updatedAt: string;
}

export type AgentCheckpointPhase =
  | "ready_for_model"
  | "model_inflight"
  | "tool_inflight"
  | "succeeded";

export interface AgentTaskCheckpoint {
  version: 1;
  runId: string;
  taskId: string;
  agentId: string;
  contractSha256: string;
  phase: AgentCheckpointPhase;
  turn: number;
  messages: readonly ChatMessage[];
  pendingToolCalls?: readonly ProviderToolCall[];
  nextToolIndex?: number;
  output?: unknown;
  updatedAt: string;
}

export interface SaveAgentTaskCheckpointInput {
  runId: string;
  taskId: string;
  agentId: string;
  contractSha256: string;
  phase: AgentCheckpointPhase;
  turn: number;
  messages: readonly ChatMessage[];
  pendingToolCalls?: readonly ProviderToolCall[];
  nextToolIndex?: number;
  output?: unknown;
}

export interface ResumeInspection {
  available: boolean;
  completedTasks: number;
  resumableTasks: number;
  reason?: string;
  manifest?: ResearchRunCheckpoint;
}

export interface TaskRecoveryInspection {
  available: boolean;
  completedTasks: number;
  resumableTasks: number;
  reason?: string;
}

export interface AgentCheckpointStore {
  saveTask(input: SaveAgentTaskCheckpointInput): Promise<AgentTaskCheckpoint>;
  loadTask(taskId: string): Promise<AgentTaskCheckpoint | undefined>;
  listTasks(): Promise<readonly AgentTaskCheckpoint[]>;
  toolJournal(): ToolExecutionJournal;
}

interface ToolReceipt {
  version: 1;
  runId: string;
  taskId: string;
  agentId: string;
  toolCallId: string;
  toolName: string;
  argumentsSha256: string;
  risk: ToolRisk;
  status: "started" | "completed";
  startedAt: string;
  completedAt?: string;
  result?: ToolExecutionResult;
}

export class ResearchCheckpointStore implements AgentCheckpointStore {
  readonly #checkpointRoot: string;
  readonly #clock: () => Date;

  constructor(checkpointRoot: string, clock: () => Date = () => new Date()) {
    this.#checkpointRoot = resolve(checkpointRoot);
    this.#clock = clock;
  }

  get root(): string {
    return this.#checkpointRoot;
  }

  async initialize(input: {
    runId: string;
    workspace: string;
    goal: string;
    sourcePaths: readonly string[];
    plan: HeadlessPlan;
  }): Promise<ResearchRunCheckpoint> {
    const workspace = await realpath(input.workspace);
    const sources = await resolveResearchSources(input.sourcePaths);
    const now = this.#clock().toISOString();
    const checkpoint: ResearchRunCheckpoint = {
      version: 2,
      runId: input.runId,
      mode: "research",
      workspace,
      goalSha256: sha256(input.goal),
      sourcePaths: sources.map((source) => source.path),
      plan: parsePlan(JSON.stringify(input.plan), 3),
      createdAt: now,
      updatedAt: now,
    };
    await writeJsonAtomic(this.#manifestPath(), checkpoint);
    return checkpoint;
  }

  async loadManifest(input: {
    runId: string;
    workspace: string;
    goal: string;
    sourcePaths: readonly string[];
  }): Promise<ResearchRunCheckpoint> {
    const raw = await readJson(this.#manifestPath());
    const checkpoint = parseRunCheckpoint(raw);
    if (checkpoint.runId !== input.runId) {
      throw new Error("checkpoint Run id does not match the requested Run");
    }
    const [workspace, expectedWorkspace] = await Promise.all([
      realpath(checkpoint.workspace),
      realpath(input.workspace),
    ]);
    if (workspace !== expectedWorkspace) {
      throw new Error("checkpoint workspace does not match the selected workspace");
    }
    if (checkpoint.goalSha256 !== sha256(input.goal)) {
      throw new Error("checkpoint goal does not match the persisted Run Request");
    }
    const currentSources = await resolveResearchSources(input.sourcePaths);
    if (JSON.stringify(checkpoint.sourcePaths) !== JSON.stringify(currentSources.map((source) => source.path))) {
      throw new Error("checkpoint research sources do not match the persisted Run Request");
    }
    return { ...checkpoint, workspace };
  }

  async saveTask(input: SaveAgentTaskCheckpointInput): Promise<AgentTaskCheckpoint> {
    const checkpoint: AgentTaskCheckpoint = {
      version: 1,
      ...input,
      messages: input.messages.map(cloneMessage),
      pendingToolCalls: input.pendingToolCalls?.map((call) => ({ ...call })),
      updatedAt: this.#clock().toISOString(),
    };
    validateTaskCheckpoint(checkpoint);
    const path = this.#taskPath(input.taskId);
    let previous: AgentTaskCheckpoint | undefined;
    try {
      previous = parseTaskCheckpoint(await readJson(path));
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) {
        throw error;
      }
    }
    if (previous !== undefined) {
      assertCompatibleTaskUpdate(previous, checkpoint);
    }
    await writeJsonAtomic(path, checkpoint);
    return checkpoint;
  }

  async loadTask(taskId: string): Promise<AgentTaskCheckpoint | undefined> {
    try {
      return parseTaskCheckpoint(await readJson(this.#taskPath(taskId)));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async listTasks(): Promise<readonly AgentTaskCheckpoint[]> {
    const directory = resolve(this.#checkpointRoot, "tasks");
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    return Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => parseTaskCheckpoint(await readJson(resolve(directory, entry.name)))),
    );
  }

  toolJournal(): ToolExecutionJournal {
    return new FileToolExecutionJournal(this.#checkpointRoot, this.#clock);
  }

  async inspectTaskRecovery(input: {
    runId: string;
    expectedTaskIds: readonly string[];
  }): Promise<TaskRecoveryInspection> {
    const checkpoints = await this.listTasks();
    const expectedIds = new Set(input.expectedTaskIds);
    if (checkpoints.some((checkpoint) => !expectedIds.has(checkpoint.taskId))) {
      return {
        available: false,
        completedTasks: 0,
        resumableTasks: expectedIds.size,
        reason: "checkpoint contains a task that is not present in the persisted plan",
      };
    }
    let completedTasks = 0;
    for (const checkpoint of checkpoints) {
      if (checkpoint.runId !== input.runId) {
        return {
          available: false,
          completedTasks,
          resumableTasks: expectedIds.size - completedTasks,
          reason: `task checkpoint belongs to another Run: ${checkpoint.taskId}`,
        };
      }
      if (checkpoint.phase === "succeeded") {
        completedTasks += 1;
        continue;
      }
      if (checkpoint.phase === "tool_inflight") {
        const calls = checkpoint.pendingToolCalls ?? [];
        const nextIndex = checkpoint.nextToolIndex ?? 0;
        const nextCall = calls[nextIndex];
        if (nextCall !== undefined) {
          const receipt = await readToolReceiptIfPresent(
            this.#checkpointRoot,
            checkpoint.taskId,
            nextCall.id,
          );
          if (
            receipt?.status === "started"
            && (receipt.risk === "write" || receipt.risk === "execute")
          ) {
            return {
              available: false,
              completedTasks,
              resumableTasks: expectedIds.size - completedTasks,
              reason: `ambiguous ${receipt.risk} tool call requires replay: ${receipt.toolName}`,
            };
          }
        }
      }
    }
    return {
      available: true,
      completedTasks,
      resumableTasks: expectedIds.size - completedTasks,
    };
  }

  async inspectResume(input: {
    runId: string;
    workspace: string;
    goal: string;
    sourcePaths: readonly string[];
  }): Promise<ResumeInspection> {
    let manifest: ResearchRunCheckpoint;
    try {
      manifest = await this.loadManifest(input);
    } catch (error) {
      return { available: false, completedTasks: 0, resumableTasks: 0, reason: toMessage(error) };
    }
    const evidenceDrift = await this.#inspectReadEvidence(manifest);
    if (evidenceDrift !== undefined) {
      return {
        available: false,
        completedTasks: 0,
        resumableTasks: 0,
        reason: evidenceDrift,
        manifest,
      };
    }
    const expectedIds = new Set([
      ...manifest.plan.tasks.map((task) => task.id),
      "integrate",
    ]);
    const taskInspection = await this.inspectTaskRecovery({
      runId: input.runId,
      expectedTaskIds: [...expectedIds],
    });
    return {
      ...taskInspection,
      manifest,
    };
  }

  async #inspectReadEvidence(manifest: ResearchRunCheckpoint): Promise<string | undefined> {
    const sources = await resolveResearchSources(manifest.sourcePaths);
    const receipts = await this.#listToolReceipts();
    for (const receipt of receipts) {
      if (receipt.toolName !== "read_file" || receipt.status !== "completed" || receipt.result?.isError !== false) {
        continue;
      }
      const evidence = parseReadEvidence(receipt.result.content);
      if (evidence === undefined) {
        return "checkpoint contains a completed local file read without verifiable evidence metadata";
      }
      try {
        const current = await hashResearchSourceReference(sources, evidence.path);
        if (current.sha256 !== evidence.sha256) {
          return `a local source read by this Run changed after the checkpoint: ${evidence.path}`;
        }
      } catch (error) {
        return `a local source read by this Run is no longer available: ${evidence.path} (${toMessage(error)})`;
      }
    }
    return undefined;
  }

  async #listToolReceipts(): Promise<readonly ToolReceipt[]> {
    const toolsRoot = resolve(this.#checkpointRoot, "tools");
    let taskDirectories;
    try {
      taskDirectories = await readdir(toolsRoot, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }
    const receipts: ToolReceipt[] = [];
    for (const taskDirectory of taskDirectories) {
      if (!taskDirectory.isDirectory()) continue;
      const directory = resolve(toolsRoot, taskDirectory.name);
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        receipts.push(parseToolReceipt(await readJson(resolve(directory, entry.name))));
      }
    }
    return receipts;
  }

  #manifestPath(): string {
    return resolve(this.#checkpointRoot, "manifest.json");
  }

  #taskPath(taskId: string): string {
    assertSafeId(taskId, "task id");
    return resolve(this.#checkpointRoot, "tasks", `${taskId}.json`);
  }
}

class FileToolExecutionJournal implements ToolExecutionJournal {
  readonly #checkpointRoot: string;
  readonly #clock: () => Date;

  constructor(checkpointRoot: string, clock: () => Date) {
    this.#checkpointRoot = checkpointRoot;
    this.#clock = clock;
  }

  async start(
    toolCall: ProviderToolCall,
    context: ToolContext,
    risk: ToolRisk,
  ): Promise<ToolJournalState> {
    const path = toolReceiptPath(this.#checkpointRoot, context.taskId, toolCall.id);
    const existing = await readToolReceiptIfPresent(
      this.#checkpointRoot,
      context.taskId,
      toolCall.id,
    );
    if (existing !== undefined) {
      assertToolReceiptMatches(existing, toolCall, context, risk);
      return { status: existing.status, result: existing.result };
    }
    const receipt: ToolReceipt = {
      version: 1,
      runId: context.runId,
      taskId: context.taskId,
      agentId: context.agent.id,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      argumentsSha256: sha256(toolCall.arguments),
      risk,
      status: "started",
      startedAt: this.#clock().toISOString(),
    };
    await writeJsonAtomic(path, receipt);
    return { status: "new" };
  }

  async complete(
    toolCall: ProviderToolCall,
    context: ToolContext,
    risk: ToolRisk,
    result: ToolExecutionResult,
  ): Promise<void> {
    const receipt = await readToolReceiptIfPresent(
      this.#checkpointRoot,
      context.taskId,
      toolCall.id,
    );
    if (receipt === undefined) {
      throw new Error(`tool journal has no started receipt for ${toolCall.id}`);
    }
    assertToolReceiptMatches(receipt, toolCall, context, risk);
    if (receipt.status === "completed") {
      if (JSON.stringify(receipt.result) !== JSON.stringify(result)) {
        throw new Error(`tool journal result conflict for ${toolCall.id}`);
      }
      return;
    }
    await writeJsonAtomic(
      toolReceiptPath(this.#checkpointRoot, context.taskId, toolCall.id),
      {
        ...receipt,
        status: "completed",
        completedAt: this.#clock().toISOString(),
        result,
      } satisfies ToolReceipt,
    );
  }
}

function parseRunCheckpoint(value: unknown): ResearchRunCheckpoint {
  const record = expectRecord(value, "research checkpoint");
  if (record.version === 1 && record.mode === "research") {
    throw new Error(
      "this legacy research checkpoint used a whole-workspace snapshot; start a new Run and explicitly add the required sources",
    );
  }
  if (
    record.version !== 2
    || record.mode !== "research"
    || typeof record.runId !== "string"
    || typeof record.workspace !== "string"
    || typeof record.goalSha256 !== "string"
    || !Array.isArray(record.sourcePaths)
    || !record.sourcePaths.every((item) => typeof item === "string")
    || typeof record.createdAt !== "string"
    || typeof record.updatedAt !== "string"
    || !/^[a-f0-9]{64}$/.test(record.goalSha256)
  ) {
    throw new Error("research checkpoint has an invalid contract");
  }
  return {
    ...record,
    plan: parsePlan(JSON.stringify(record.plan), 3),
  } as ResearchRunCheckpoint;
}

function parseReadEvidence(content: string): { path: string; sha256: string } | undefined {
  try {
    const record = expectRecord(JSON.parse(content) as unknown, "read_file result");
    if (typeof record.path === "string" && typeof record.sha256 === "string"
      && /^[a-f0-9]{64}$/.test(record.sha256)) {
      return { path: record.path, sha256: record.sha256 };
    }
  } catch {
    const prefix = content.match(/"path":("(?:\\.|[^"\\])*"),"sha256":"([a-f0-9]{64})"/u);
    if (prefix !== null) {
      try {
        return { path: JSON.parse(prefix[1]!) as string, sha256: prefix[2]! };
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function parseTaskCheckpoint(value: unknown): AgentTaskCheckpoint {
  const record = expectRecord(value, "task checkpoint");
  if (
    record.version !== 1
    || typeof record.runId !== "string"
    || typeof record.taskId !== "string"
    || typeof record.agentId !== "string"
    || typeof record.contractSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(record.contractSha256)
    || !isCheckpointPhase(record.phase)
    || typeof record.turn !== "number"
    || !Number.isInteger(record.turn)
    || record.turn < 0
    || !Array.isArray(record.messages)
    || typeof record.updatedAt !== "string"
  ) {
    throw new Error("task checkpoint has an invalid contract");
  }
  const checkpoint: AgentTaskCheckpoint = {
    version: 1,
    runId: record.runId,
    taskId: record.taskId,
    agentId: record.agentId,
    contractSha256: record.contractSha256,
    phase: record.phase,
    turn: record.turn,
    messages: record.messages.map(parseMessage),
    pendingToolCalls: record.pendingToolCalls === undefined
      ? undefined
      : parseToolCalls(record.pendingToolCalls),
    nextToolIndex: typeof record.nextToolIndex === "number" ? record.nextToolIndex : undefined,
    output: record.output,
    updatedAt: record.updatedAt,
  };
  validateTaskCheckpoint(checkpoint);
  return checkpoint;
}

function validateTaskCheckpoint(checkpoint: AgentTaskCheckpoint): void {
  assertSafeId(checkpoint.taskId, "task id");
  assertSafeId(checkpoint.agentId, "agent id");
  if (Buffer.byteLength(JSON.stringify(checkpoint)) > MAX_CHECKPOINT_BYTES) {
    throw new Error(`task checkpoint exceeds ${MAX_CHECKPOINT_BYTES} bytes`);
  }
  if (checkpoint.phase === "tool_inflight") {
    if (
      checkpoint.pendingToolCalls === undefined
      || checkpoint.pendingToolCalls.length === 0
      || checkpoint.nextToolIndex === undefined
      || !Number.isInteger(checkpoint.nextToolIndex)
      || checkpoint.nextToolIndex < 0
      || checkpoint.nextToolIndex > checkpoint.pendingToolCalls.length
    ) {
      throw new Error("tool_inflight checkpoint requires a valid pending tool cursor");
    }
  } else if (checkpoint.pendingToolCalls !== undefined || checkpoint.nextToolIndex !== undefined) {
    throw new Error(`${checkpoint.phase} checkpoint cannot contain pending tool calls`);
  }
  if (checkpoint.phase === "succeeded" && checkpoint.output === undefined) {
    throw new Error("succeeded checkpoint requires an output");
  }
}

function assertCompatibleTaskUpdate(
  previous: AgentTaskCheckpoint,
  next: AgentTaskCheckpoint,
): void {
  if (
    previous.runId !== next.runId
    || previous.taskId !== next.taskId
    || previous.agentId !== next.agentId
    || previous.contractSha256 !== next.contractSha256
  ) {
    throw new Error(`task checkpoint identity changed for ${next.taskId}`);
  }
  if (previous.phase === "succeeded" && next.phase !== "succeeded") {
    throw new Error(`succeeded task checkpoint cannot be reopened: ${next.taskId}`);
  }
  if (next.turn < previous.turn) {
    throw new Error(`task checkpoint turn moved backwards: ${next.taskId}`);
  }
  const previousMessages = JSON.stringify(previous.messages);
  const nextPrefix = JSON.stringify(next.messages.slice(0, previous.messages.length));
  if (previousMessages !== nextPrefix) {
    throw new Error(`task checkpoint message history was rewritten: ${next.taskId}`);
  }
}

async function readToolReceiptIfPresent(
  checkpointRoot: string,
  taskId: string,
  toolCallId: string,
): Promise<ToolReceipt | undefined> {
  try {
    return parseToolReceipt(await readJson(toolReceiptPath(checkpointRoot, taskId, toolCallId)));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function parseToolReceipt(value: unknown): ToolReceipt {
  const record = expectRecord(value, "tool receipt");
  if (
    record.version !== 1
    || typeof record.runId !== "string"
    || typeof record.taskId !== "string"
    || typeof record.agentId !== "string"
    || typeof record.toolCallId !== "string"
    || typeof record.toolName !== "string"
    || typeof record.argumentsSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(record.argumentsSha256)
    || !isToolRisk(record.risk)
    || (record.status !== "started" && record.status !== "completed")
    || typeof record.startedAt !== "string"
  ) {
    throw new Error("tool receipt has an invalid contract");
  }
  if (record.status === "completed") {
    if (typeof record.completedAt !== "string") {
      throw new Error("completed tool receipt requires completedAt");
    }
    parseToolResult(record.result);
  }
  return record as unknown as ToolReceipt;
}

function assertToolReceiptMatches(
  receipt: ToolReceipt,
  toolCall: ProviderToolCall,
  context: ToolContext,
  risk: ToolRisk,
): void {
  if (
    receipt.runId !== context.runId
    || receipt.taskId !== context.taskId
    || receipt.agentId !== context.agent.id
    || receipt.toolCallId !== toolCall.id
    || receipt.toolName !== toolCall.name
    || receipt.argumentsSha256 !== sha256(toolCall.arguments)
    || receipt.risk !== risk
  ) {
    throw new Error(`tool journal identity changed for ${toolCall.id}`);
  }
}

function toolReceiptPath(checkpointRoot: string, taskId: string, toolCallId: string): string {
  assertSafeId(taskId, "task id");
  return resolve(
    checkpointRoot,
    "tools",
    taskId,
    `${sha256(toolCallId)}.json`,
  );
}

function parseMessage(value: unknown): ChatMessage {
  const record = expectRecord(value, "chat message");
  if ((record.role === "system" || record.role === "user") && typeof record.content === "string") {
    return { role: record.role, content: record.content };
  }
  if (
    record.role === "assistant"
    && (typeof record.content === "string" || record.content === null)
  ) {
    return {
      role: "assistant",
      content: record.content,
      toolCalls: record.toolCalls === undefined ? undefined : parseToolCalls(record.toolCalls),
    };
  }
  if (
    record.role === "tool"
    && typeof record.content === "string"
    && typeof record.toolCallId === "string"
  ) {
    return { role: "tool", content: record.content, toolCallId: record.toolCallId };
  }
  throw new Error("chat message has an invalid contract");
}

function parseToolCalls(value: unknown): ProviderToolCall[] {
  if (!Array.isArray(value)) {
    throw new Error("tool calls must be an array");
  }
  return value.map((item) => {
    const call = expectRecord(item, "tool call");
    if (
      typeof call.id !== "string"
      || typeof call.name !== "string"
      || typeof call.arguments !== "string"
    ) {
      throw new Error("tool call has an invalid contract");
    }
    return { id: call.id, name: call.name, arguments: call.arguments };
  });
}

function parseToolResult(value: unknown): ToolExecutionResult {
  const result = expectRecord(value, "tool result");
  if (
    typeof result.toolCallId !== "string"
    || typeof result.content !== "string"
    || typeof result.isError !== "boolean"
  ) {
    throw new Error("tool result has an invalid contract");
  }
  return result as unknown as ToolExecutionResult;
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return parseMessage(JSON.parse(JSON.stringify(message)) as unknown);
}

function expectRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function isCheckpointPhase(value: unknown): value is AgentCheckpointPhase {
  return value === "ready_for_model"
    || value === "model_inflight"
    || value === "tool_inflight"
    || value === "succeeded";
}

function isToolRisk(value: unknown): value is ToolRisk {
  return value === "read" || value === "compute" || value === "write" || value === "execute";
}

function assertSafeId(value: string, name: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`${name} contains unsafe characters`);
  }
}

async function readJson(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, "utf8");
  if (Buffer.byteLength(content) > MAX_CHECKPOINT_BYTES) {
    throw new Error(`checkpoint file exceeds ${MAX_CHECKPOINT_BYTES} bytes`);
  }
  return JSON.parse(content) as unknown;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryPath, filePath);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
