import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { JsonArtifactRegistry, type ArtifactRecord } from "./artifacts.js";
import type {
  AgentCheckpointStore,
  AgentTaskCheckpoint,
  SaveAgentTaskCheckpointInput,
  TaskRecoveryInspection,
} from "./checkpoint-store.js";
import { ResearchCheckpointStore } from "./checkpoint-store.js";
import { parseCodingPlan, type CodingPlan } from "./coding-planner.js";
import { GitWorktreeManager, type GitWorktreeHandle } from "./git-worktree-manager.js";
import { assertPrivateFileIfPresent, writePrivateJsonAtomic } from "./private-storage.js";
import type { ToolExecutionJournal } from "./tool-runtime.js";

const MAX_CHECKPOINT_BYTES = 10 * 1024 * 1024;

export interface CodingRunCheckpoint {
  version: 1;
  mode: "code";
  runId: string;
  repoRoot: string;
  goalSha256: string;
  baselineHead: string;
  plan: CodingPlan;
  worktrees: readonly GitWorktreeHandle[];
  preflightAttempt: number;
  createdAt: string;
  updatedAt: string;
}

export interface CodingWorkerResultCheckpoint {
  version: 1;
  kind: "worker";
  runId: string;
  taskId: string;
  agentId: string;
  output: unknown;
  worktree: GitWorktreeHandle;
  patch: ArtifactRecord;
  worktreeStatus: string;
  updatedAt: string;
}

export interface CodingIntegratorResultCheckpoint {
  version: 1;
  kind: "integrator";
  runId: string;
  taskId: "integrate";
  agentId: string;
  output: unknown;
  artifactRelativePath: string;
  updatedAt: string;
}

export type CodingTaskResultCheckpoint =
  | CodingWorkerResultCheckpoint
  | CodingIntegratorResultCheckpoint;

export type SaveCodingTaskResultInput =
  | Omit<CodingWorkerResultCheckpoint, "version" | "updatedAt">
  | Omit<CodingIntegratorResultCheckpoint, "version" | "updatedAt">;

export interface CodingResumeInspection {
  available: boolean;
  completedTasks: number;
  resumableTasks: number;
  reason?: string;
  manifest?: CodingRunCheckpoint;
}

export class CodingCheckpointStore implements AgentCheckpointStore {
  readonly #checkpointRoot: string;
  readonly #clock: () => Date;
  readonly #agentStore: ResearchCheckpointStore;
  readonly #worktreeManager = new GitWorktreeManager();

  constructor(checkpointRoot: string, clock: () => Date = () => new Date()) {
    this.#checkpointRoot = resolve(checkpointRoot);
    this.#clock = clock;
    this.#agentStore = new ResearchCheckpointStore(this.#checkpointRoot, clock);
  }

  get root(): string {
    return this.#checkpointRoot;
  }

  async initialize(input: {
    runId: string;
    repoRoot: string;
    goal: string;
    baselineHead: string;
    plan: CodingPlan;
  }): Promise<CodingRunCheckpoint> {
    const repoRoot = await realpath(input.repoRoot);
    const now = this.#clock().toISOString();
    const checkpoint: CodingRunCheckpoint = {
      version: 1,
      mode: "code",
      runId: input.runId,
      repoRoot,
      goalSha256: sha256(input.goal),
      baselineHead: expectGitSha(input.baselineHead),
      plan: parseCodingPlan(JSON.stringify(input.plan), 3),
      worktrees: [],
      preflightAttempt: 0,
      createdAt: now,
      updatedAt: now,
    };
    await writeJsonAtomic(this.#manifestPath(), checkpoint);
    return checkpoint;
  }

  async loadManifest(input: {
    runId: string;
    repoRoot: string;
    goal: string;
  }): Promise<CodingRunCheckpoint> {
    const manifest = parseManifest(await readJson(this.#manifestPath()));
    if (manifest.runId !== input.runId) {
      throw new Error("Coding checkpoint Run id does not match the requested Run");
    }
    const [repoRoot, expectedRoot] = await Promise.all([
      realpath(manifest.repoRoot),
      realpath(input.repoRoot),
    ]);
    if (repoRoot !== expectedRoot) {
      throw new Error("Coding checkpoint repository does not match the selected workspace");
    }
    if (manifest.goalSha256 !== sha256(input.goal)) {
      throw new Error("Coding checkpoint goal does not match the persisted Run Request");
    }
    return { ...manifest, repoRoot };
  }

  async recordWorktree(handle: GitWorktreeHandle): Promise<CodingRunCheckpoint> {
    const manifest = parseManifest(await readJson(this.#manifestPath()));
    assertHandleIdentity(handle, manifest);
    const existing = manifest.worktrees.find((candidate) => candidate.taskId === handle.taskId);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(handle)) {
        throw new Error(`Coding checkpoint worktree conflict for ${handle.taskId}`);
      }
      return manifest;
    }
    const next: CodingRunCheckpoint = {
      ...manifest,
      worktrees: [...manifest.worktrees, { ...handle }],
      updatedAt: this.#clock().toISOString(),
    };
    await writeJsonAtomic(this.#manifestPath(), next);
    return next;
  }

  async beginPreflightAttempt(): Promise<number> {
    const manifest = parseManifest(await readJson(this.#manifestPath()));
    const attempt = manifest.preflightAttempt + 1;
    await writeJsonAtomic(this.#manifestPath(), {
      ...manifest,
      preflightAttempt: attempt,
      updatedAt: this.#clock().toISOString(),
    } satisfies CodingRunCheckpoint);
    return attempt;
  }

  async saveTaskResult(
    input: SaveCodingTaskResultInput,
  ): Promise<CodingTaskResultCheckpoint> {
    const result = {
      version: 1,
      ...input,
      updatedAt: this.#clock().toISOString(),
    } as CodingTaskResultCheckpoint;
    validateTaskResult(result);
    const path = this.#resultPath(result.taskId);
    try {
      const previous = parseTaskResult(await readJson(path));
      if (stableResult(previous) !== stableResult(result)) {
        throw new Error(`Coding Task result conflict for ${result.taskId}`);
      }
      return previous;
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) {
        throw error;
      }
    }
    await writeJsonAtomic(path, result);
    return result;
  }

  async loadTaskResult(taskId: string): Promise<CodingTaskResultCheckpoint | undefined> {
    try {
      return parseTaskResult(await readJson(this.#resultPath(taskId)));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async listTaskResults(): Promise<readonly CodingTaskResultCheckpoint[]> {
    const directory = resolve(this.#checkpointRoot, "results");
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    return Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => parseTaskResult(await readJson(resolve(directory, entry.name)))));
  }

  saveTask(input: SaveAgentTaskCheckpointInput): Promise<AgentTaskCheckpoint> {
    return this.#agentStore.saveTask(input);
  }

  loadTask(taskId: string): Promise<AgentTaskCheckpoint | undefined> {
    return this.#agentStore.loadTask(taskId);
  }

  listTasks(): Promise<readonly AgentTaskCheckpoint[]> {
    return this.#agentStore.listTasks();
  }

  toolJournal(): ToolExecutionJournal {
    return this.#agentStore.toolJournal();
  }

  inspectTaskRecovery(input: {
    runId: string;
    expectedTaskIds: readonly string[];
  }): Promise<TaskRecoveryInspection> {
    return this.#agentStore.inspectTaskRecovery(input);
  }

  async inspectResume(input: {
    runId: string;
    repoRoot: string;
    goal: string;
  }): Promise<CodingResumeInspection> {
    let manifest: CodingRunCheckpoint | undefined;
    try {
      manifest = await this.loadManifest(input);
      const primary = await this.#worktreeManager.validatePrimary(manifest.repoRoot);
      if (primary.headSha !== manifest.baselineHead) {
        throw new Error(
          `primary HEAD changed after Coding checkpoint: expected ${manifest.baselineHead}, got ${primary.headSha}`,
        );
      }
      for (const task of manifest.plan.tasks) {
        const actual = await this.#worktreeManager.inspectExpected(
          manifest.repoRoot,
          manifest.runId,
          task.id,
          manifest.baselineHead,
        );
        const recorded = manifest.worktrees.find((handle) => handle.taskId === task.id);
        if (recorded !== undefined && actual === undefined) {
          throw new Error(`recorded Coding worktree is missing for ${task.id}`);
        }
        if (recorded !== undefined && actual !== undefined && JSON.stringify(recorded) !== JSON.stringify(actual)) {
          throw new Error(`Coding worktree identity changed for ${task.id}`);
        }
      }
      const expectedTaskIds = [...manifest.plan.tasks.map((task) => task.id), "integrate"];
      const taskSafety = await this.inspectTaskRecovery({
        runId: input.runId,
        expectedTaskIds,
      });
      if (!taskSafety.available) {
        throw new Error(taskSafety.reason ?? "Coding Agent checkpoint is unsafe");
      }
      const results = await this.listTaskResults();
      if (results.some((result) => !expectedTaskIds.includes(result.taskId))) {
        throw new Error("Coding checkpoint contains an unknown completed Task");
      }
      const artifactRegistry = new JsonArtifactRegistry(
        resolve(this.#checkpointRoot, "artifacts.json"),
      );
      const artifacts = await artifactRegistry.list(input.runId);
      for (const result of results) {
        if (result.runId !== input.runId) {
          throw new Error(`Coding Task result belongs to another Run: ${result.taskId}`);
        }
        if (result.kind === "worker") {
          await this.#validateWorkerResult(manifest, result, artifacts);
        } else {
          await validateIntegratorResult(
            manifest,
            result,
            artifacts,
            await realpath(resolve(dirname(this.#checkpointRoot), "artifacts")),
          );
        }
      }
      return {
        available: true,
        completedTasks: results.length,
        resumableTasks: expectedTaskIds.length - results.length,
        manifest,
      };
    } catch (error) {
      return {
        available: false,
        completedTasks: 0,
        resumableTasks: 0,
        reason: toMessage(error),
        manifest,
      };
    }
  }

  async #validateWorkerResult(
    manifest: CodingRunCheckpoint,
    result: CodingWorkerResultCheckpoint,
    artifacts: readonly ArtifactRecord[],
  ): Promise<void> {
    const task = manifest.plan.tasks.find((candidate) => candidate.id === result.taskId);
    if (task === undefined) {
      throw new Error(`Coding result has no planned worker Task: ${result.taskId}`);
    }
    assertHandleIdentity(result.worktree, manifest);
    const actualHandle = await this.#worktreeManager.inspectExpected(
      manifest.repoRoot,
      manifest.runId,
      result.taskId,
      manifest.baselineHead,
    );
    if (actualHandle === undefined || JSON.stringify(actualHandle) !== JSON.stringify(result.worktree)) {
      throw new Error(`Coding result worktree changed for ${result.taskId}`);
    }
    const diff = await this.#worktreeManager.captureDiff(actualHandle);
    const diffSha256 = sha256(diff.patch);
    if (diff.clean || diffSha256 !== result.patch.sha256 || diff.status !== result.worktreeStatus) {
      throw new Error(`Coding worktree diff changed after checkpoint for ${result.taskId}`);
    }
    const patchPath = await realpath(result.patch.absolutePath);
    const artifactRoot = await realpath(resolve(dirname(this.#checkpointRoot), "artifacts"));
    assertInside(artifactRoot, patchPath);
    await assertPrivateFileIfPresent(patchPath);
    if (sha256(await readFile(patchPath)) !== result.patch.sha256) {
      throw new Error(`Coding patch Artifact changed for ${result.taskId}`);
    }
    if (!artifacts.some((artifact) => stableArtifact(artifact) === stableArtifact(result.patch))) {
      throw new Error(`Coding patch Artifact is not registered for ${result.taskId}`);
    }
  }

  #manifestPath(): string {
    return resolve(this.#checkpointRoot, "manifest.json");
  }

  #resultPath(taskId: string): string {
    assertSafeId(taskId, "task id");
    return resolve(this.#checkpointRoot, "results", `${taskId}.json`);
  }
}

function parseManifest(value: unknown): CodingRunCheckpoint {
  const record = expectRecord(value, "Coding checkpoint");
  if (
    record.version !== 1
    || record.mode !== "code"
    || typeof record.runId !== "string"
    || typeof record.repoRoot !== "string"
    || typeof record.goalSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(record.goalSha256)
    || typeof record.baselineHead !== "string"
    || !/^[a-f0-9]{40,64}$/.test(record.baselineHead)
    || !Array.isArray(record.worktrees)
    || typeof record.preflightAttempt !== "number"
    || !Number.isInteger(record.preflightAttempt)
    || record.preflightAttempt < 0
    || typeof record.createdAt !== "string"
    || typeof record.updatedAt !== "string"
    || Number.isNaN(Date.parse(record.createdAt))
    || Number.isNaN(Date.parse(record.updatedAt))
  ) {
    throw new Error("Coding checkpoint has an invalid contract");
  }
  const manifest: CodingRunCheckpoint = {
    version: 1,
    mode: "code",
    runId: record.runId,
    repoRoot: record.repoRoot,
    goalSha256: record.goalSha256,
    baselineHead: record.baselineHead,
    plan: parseCodingPlan(JSON.stringify(record.plan), 3),
    worktrees: record.worktrees.map(parseHandle),
    preflightAttempt: record.preflightAttempt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  const expectedTaskIds = new Set(manifest.plan.tasks.map((task) => task.id));
  if (
    manifest.worktrees.some((handle) =>
      handle.runId !== manifest.runId
      || handle.repoRoot !== manifest.repoRoot
      || handle.headSha !== manifest.baselineHead
      || !expectedTaskIds.has(handle.taskId))
    || new Set(manifest.worktrees.map((handle) => handle.taskId)).size !== manifest.worktrees.length
  ) {
    throw new Error("Coding checkpoint has an invalid worktree inventory");
  }
  return manifest;
}

function parseHandle(value: unknown): GitWorktreeHandle {
  const record = expectRecord(value, "Coding worktree handle");
  if (
    typeof record.repoRoot !== "string"
    || typeof record.worktreePath !== "string"
    || typeof record.headSha !== "string"
    || !/^[a-f0-9]{40,64}$/.test(record.headSha)
    || typeof record.runId !== "string"
    || typeof record.taskId !== "string"
  ) {
    throw new Error("Coding worktree handle has an invalid contract");
  }
  return record as unknown as GitWorktreeHandle;
}

function parseTaskResult(value: unknown): CodingTaskResultCheckpoint {
  const record = expectRecord(value, "Coding Task result");
  if (
    record.version !== 1
    || (record.kind !== "worker" && record.kind !== "integrator")
    || typeof record.runId !== "string"
    || typeof record.taskId !== "string"
    || typeof record.agentId !== "string"
    || record.output === undefined
    || typeof record.updatedAt !== "string"
    || Number.isNaN(Date.parse(record.updatedAt))
  ) {
    throw new Error("Coding Task result has an invalid contract");
  }
  const result = record.kind === "worker"
    ? {
        version: 1 as const,
        kind: "worker" as const,
        runId: record.runId,
        taskId: record.taskId,
        agentId: record.agentId,
        output: record.output,
        worktree: parseHandle(record.worktree),
        patch: parseArtifact(record.patch),
        worktreeStatus: expectString(record.worktreeStatus, "worktree status"),
        updatedAt: record.updatedAt,
      }
    : {
        version: 1 as const,
        kind: "integrator" as const,
        runId: record.runId,
        taskId: "integrate" as const,
        agentId: record.agentId,
        output: record.output,
        artifactRelativePath: expectString(record.artifactRelativePath, "artifact path"),
        updatedAt: record.updatedAt,
      };
  validateTaskResult(result);
  return result;
}

function validateTaskResult(result: CodingTaskResultCheckpoint): void {
  assertSafeId(result.taskId, "task id");
  assertSafeId(result.agentId, "agent id");
  if (result.kind === "integrator" && result.taskId !== "integrate") {
    throw new Error("Coding integrator result must use the integrate Task id");
  }
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_CHECKPOINT_BYTES) {
    throw new Error(`Coding Task result exceeds ${MAX_CHECKPOINT_BYTES} bytes`);
  }
}

function parseArtifact(value: unknown): ArtifactRecord {
  const record = expectRecord(value, "Coding patch Artifact");
  if (
    typeof record.runId !== "string"
    || typeof record.taskId !== "string"
    || typeof record.agentId !== "string"
    || typeof record.relativePath !== "string"
    || typeof record.absolutePath !== "string"
    || typeof record.mediaType !== "string"
    || typeof record.bytes !== "number"
    || typeof record.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(record.sha256)
  ) {
    throw new Error("Coding patch Artifact has an invalid contract");
  }
  return record as unknown as ArtifactRecord;
}

async function validateIntegratorResult(
  manifest: CodingRunCheckpoint,
  result: CodingIntegratorResultCheckpoint,
  artifacts: readonly ArtifactRecord[],
  artifactRoot: string,
): Promise<void> {
  if (result.artifactRelativePath !== manifest.plan.integration.fileName) {
    throw new Error("Coding Integrator Artifact changed after checkpoint");
  }
  const artifact = artifacts.find((candidate) =>
    candidate.runId === result.runId
    && candidate.taskId === "integrate"
    && candidate.relativePath === result.artifactRelativePath);
  if (artifact === undefined) {
    throw new Error("Coding Integrator Artifact is not registered");
  }
  const artifactPath = await realpath(artifact.absolutePath);
  assertInside(artifactRoot, artifactPath);
  await assertPrivateFileIfPresent(artifactPath);
  const content = await readFile(artifactPath);
  if (content.byteLength !== artifact.bytes || sha256(content) !== artifact.sha256) {
    throw new Error("Coding Integrator Artifact changed after checkpoint");
  }
}

function assertHandleIdentity(handle: GitWorktreeHandle, manifest: CodingRunCheckpoint): void {
  if (
    handle.runId !== manifest.runId
    || handle.repoRoot !== manifest.repoRoot
    || handle.headSha !== manifest.baselineHead
    || !manifest.plan.tasks.some((task) => task.id === handle.taskId)
  ) {
    throw new Error(`Coding worktree identity conflict for ${handle.taskId}`);
  }
}

function stableResult(result: CodingTaskResultCheckpoint): string {
  const { updatedAt: _updatedAt, ...stable } = result;
  return JSON.stringify(stable);
}

function stableArtifact(artifact: ArtifactRecord): string {
  return JSON.stringify(artifact);
}

function expectRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function expectGitSha(value: string): string {
  if (!/^[a-f0-9]{40,64}$/.test(value)) {
    throw new Error("Coding checkpoint baseline HEAD is invalid");
  }
  return value;
}

function assertSafeId(value: string, name: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`${name} contains unsafe characters`);
  }
}

function assertInside(root: string, target: string): void {
  const fromRoot = relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("Coding checkpoint path escapes the Run Artifact root");
  }
}

async function readJson(filePath: string): Promise<unknown> {
  await assertPrivateFileIfPresent(filePath);
  const content = await readFile(filePath, "utf8");
  if (Buffer.byteLength(content) > MAX_CHECKPOINT_BYTES) {
    throw new Error(`checkpoint file exceeds ${MAX_CHECKPOINT_BYTES} bytes`);
  }
  return JSON.parse(content) as unknown;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writePrivateJsonAtomic(filePath, value);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
