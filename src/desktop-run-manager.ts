import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, resolve, sep } from "node:path";

import type {
  ApproveDesktopIntegrationRequest,
  DesktopArtifactActionRequest,
  DesktopArtifactPreviewView,
  DesktopRunActionRequest,
  DesktopRunView,
  RevertDesktopIntegrationRequest,
  ResolveDesktopToolApprovalRequest,
  StartDesktopRunRequest,
} from "./desktop-contract.js";
import { JsonArtifactRegistry, type ArtifactRecord } from "./artifacts.js";
import { CodingWorkflow } from "./coding-workflow.js";
import { CodingCheckpointStore } from "./coding-checkpoint-store.js";
import { ResearchCheckpointStore } from "./checkpoint-store.js";
import type { EventStore, PendingRuntimeEvent, RuntimeEvent } from "./event-store.js";
import { JsonlEventStore } from "./event-store.js";
import { ExecutionCoordinator } from "./execution-coordinator.js";
import { HeadlessWorkflow } from "./headless-workflow.js";
import { IntegrationManager, readVerifiedIntegrationPatch } from "./integration-manager.js";
import type { ModelProvider } from "./provider.js";
import type { ProcessSharedCapacity } from "./process-shared-provider.js";
import type { OAuthRedirectHandler } from "./mcp-oauth.js";
import { normalizeRunExtensions } from "./extension-config.js";
import { normalizeProviderSelection, type ProviderSelection } from "./provider-config.js";
import { loadWorkspaceRunHistory, projectRun } from "./run-projection.js";
import {
  RunRequestStore,
  type PersistedRunRequest,
  validateRunId,
} from "./run-request-store.js";
import { WorktreeLifecycleManager } from "./worktree-lifecycle.js";
import { buildWorkspaceSnapshot } from "./workspace-manifest.js";
import {
  WorkspaceProcessLockManager,
  type WorkspaceProcessLease,
} from "./workspace-process-lock.js";
import {
  InteractiveToolApprovalBroker,
  type PendingToolApproval,
} from "./tool-approval.js";
import { normalizeTrustProfile } from "./tool-runtime.js";

export interface DesktopRunManagerOptions {
  createProvider(selection: ProviderSelection): Promise<ModelProvider>;
  maxActiveRuns?: number;
  globalConcurrency?: number;
  processTaskCapacity?: ProcessSharedCapacity;
  oauthRedirectHandler?: OAuthRedirectHandler;
}

interface ActiveRun {
  abortController: AbortController;
  events: RuntimeEvent[];
  execution: Promise<void>;
  view: DesktopRunView;
  approvalBroker?: InteractiveToolApprovalBroker;
  processLease: WorkspaceProcessLease;
}

interface DesktopResumeInspection {
  available: boolean;
  completedTasks: number;
  resumableTasks: number;
  reason?: string;
}

const MAX_ARTIFACT_PREVIEW_BYTES = 200_000;
const PREVIEWABLE_ARTIFACT_EXTENSIONS = new Set([".md", ".json", ".txt", ".patch", ".diff"]);

export class DesktopRunManager {
  readonly #createProvider: (selection: ProviderSelection) => Promise<ModelProvider>;
  readonly #maxActiveRuns: number;
  readonly #executionCoordinator: ExecutionCoordinator;
  readonly #requestStore = new RunRequestStore();
  readonly #processTaskCapacity?: ProcessSharedCapacity;
  readonly #workspaceLocks = new WorkspaceProcessLockManager();
  readonly #oauthRedirectHandler?: OAuthRedirectHandler;
  readonly #active = new Map<string, ActiveRun>();
  readonly #launching = new Set<string>();
  readonly #listeners = new Set<(run: DesktopRunView) => void>();

  constructor(options: DesktopRunManagerOptions) {
    this.#createProvider = options.createProvider;
    this.#maxActiveRuns = options.maxActiveRuns ?? 2;
    this.#executionCoordinator = new ExecutionCoordinator(options.globalConcurrency ?? 3);
    this.#processTaskCapacity = options.processTaskCapacity;
    this.#oauthRedirectHandler = options.oauthRedirectHandler;
  }

  subscribe(listener: (run: DesktopRunView) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async start(request: StartDesktopRunRequest): Promise<DesktopRunView> {
    return this.#start(request);
  }

  async restartRun(request: DesktopRunActionRequest): Promise<DesktopRunView> {
    validateRunId(request.runId);
    const workspace = await realpath(request.workspace);
    const lease = await this.#workspaceLocks.acquire(workspace, "desktop-restart");
    try {
      await this.#reconcileInterrupted(workspace);
      const runRoot = resolve(workspace, ".localbuddy", "runs", request.runId);
      const eventStore = new JsonlEventStore(resolve(runRoot, "events.jsonl"));
      const events = await eventStore.list(request.runId);
      const source = projectRun(request.runId, workspace, events);
      if (source.status !== "interrupted") {
        throw new Error(`only interrupted Runs can be replayed: ${source.status}`);
      }
      if (source.restartedAs !== undefined) {
        throw new Error(`interrupted Run was already replayed as ${source.restartedAs}`);
      }
      const persisted = await this.#requestStore.load(runRoot, workspace, request.runId);
      return await this.#start(
        {
          workspace,
          goal: persisted.goal,
          concurrency: persisted.concurrency,
          mode: persisted.mode,
          provider: persisted.provider,
          trustProfile: persisted.trustProfile,
          extensions: persisted.extensions,
        },
        request.runId,
        async (newRunId) => {
          await eventStore.append({
            type: "run.restarted",
            runId: request.runId,
            data: { newRunId, semantics: "replay-from-original-request" },
          });
          this.#emit(projectRun(request.runId, workspace, await eventStore.list(request.runId)));
        },
      );
    } finally {
      await lease.release();
    }
  }

  async resumeRun(request: DesktopRunActionRequest): Promise<DesktopRunView> {
    validateRunId(request.runId);
    const workspace = await realpath(request.workspace);
    const lease = await this.#workspaceLocks.acquire(workspace, "desktop-resume");
    try {
      await this.#reconcileInterrupted(workspace);
      if (this.#active.has(request.runId) || this.#launching.has(request.runId)) {
        throw new Error(`Run is already active: ${request.runId}`);
      }
      if (this.#active.size + this.#launching.size >= this.#maxActiveRuns) {
        throw new Error(`At most ${this.#maxActiveRuns} runs can be active at once.`);
      }
      this.#launching.add(request.runId);
      const runRoot = resolve(workspace, ".localbuddy", "runs", request.runId);
      const persistentStore = new JsonlEventStore(resolve(runRoot, "events.jsonl"));
      const events = [...await persistentStore.list(request.runId)];
      const source = projectRun(request.runId, workspace, events);
      if (source.status !== "interrupted" && source.status !== "failed") {
        throw new Error(`only interrupted or failed Runs can resume from checkpoint: ${source.status}`);
      }
      if (source.restartedAs !== undefined) {
        throw new Error(`Run was already replayed as ${source.restartedAs}`);
      }
      const persisted = await this.#requestStore.load(runRoot, workspace, request.runId);
      const inspection = await this.#inspectCheckpoint(
        runRoot,
        workspace,
        request.runId,
        persisted,
      );
      if (!inspection.available) {
        throw new Error(inspection.reason ?? "checkpoint is not safely resumable");
      }
      const eventStore = new NotifyingEventStore(persistentStore, (event) => {
        events.push(event);
        const active = this.#active.get(request.runId);
        if (active === undefined) {
          return;
        }
        active.view = withPendingApprovals(
          projectRun(request.runId, workspace, events, active.view.status),
          active.approvalBroker?.list(),
        );
        this.#emit(active.view);
      });
      const abortController = new AbortController();
      const initialView: DesktopRunView = { ...source, status: "starting" };
      const placeholder: ActiveRun = {
        abortController,
        events,
        execution: Promise.resolve(),
        view: initialView,
        processLease: lease,
      };
      this.#active.set(request.runId, placeholder);
      const approvalBroker = this.#createApprovalBroker(request.runId, eventStore);
      placeholder.approvalBroker = approvalBroker;
      this.#launching.delete(request.runId);
      this.#emit(initialView);

      try {
        const provider = await this.#createProvider(persisted.provider);
        const workflow = persisted.mode === "code"
          ? new CodingWorkflow({
              provider,
              eventStore,
              repoRoot: workspace,
              artifactRoot: resolve(runRoot, "artifacts"),
              checkpointRoot: resolve(runRoot, "checkpoint"),
              globalConcurrency: persisted.concurrency,
              executionCoordinator: this.#executionCoordinator,
              runtimeOwner: "desktop",
              providerId: persisted.provider.id,
              trustProfile: persisted.trustProfile,
              extensions: persisted.extensions,
              extensionApprovalHandler: approvalBroker,
              processTaskCapacity: this.#processTaskCapacity,
              oauthRedirectHandler: this.#oauthRedirectHandler,
            })
          : new HeadlessWorkflow({
              provider,
              eventStore,
              workspaceRoot: workspace,
              artifactRoot: resolve(runRoot, "artifacts"),
              checkpointRoot: resolve(runRoot, "checkpoint"),
              globalConcurrency: persisted.concurrency,
              executionCoordinator: this.#executionCoordinator,
              runtimeOwner: "desktop",
              providerId: persisted.provider.id,
              trustProfile: persisted.trustProfile,
              extensions: persisted.extensions,
              extensionApprovalHandler: approvalBroker,
              processTaskCapacity: this.#processTaskCapacity,
              oauthRedirectHandler: this.#oauthRedirectHandler,
            });
        placeholder.execution = workflow
          .resume(request.runId, persisted.goal, abortController.signal)
          .then(() => undefined)
          .catch(() => undefined)
          .finally(async () => {
            await lease.release();
            const current = this.#active.get(request.runId);
            if (current !== undefined) {
              this.#emit(current.view);
              this.#active.delete(request.runId);
            }
          });
        return initialView;
      } catch (error) {
        await eventStore.append({
          type: "run.resumed",
          runId: request.runId,
          data: {
            mode: persisted.mode,
            completedTasks: inspection.completedTasks,
            resumableTasks: inspection.resumableTasks,
          },
        });
        await eventStore.append({
          type: "run.failed",
          runId: request.runId,
          data: { error: error instanceof Error ? error.message : String(error) },
        });
        this.#active.delete(request.runId);
        await lease.release();
        throw error;
      }
    } catch (error) {
      this.#launching.delete(request.runId);
      await lease.release();
      throw error;
    }
  }

  async cleanupWorktrees(request: DesktopRunActionRequest): Promise<DesktopRunView> {
    validateRunId(request.runId);
    if (this.#active.has(request.runId)) {
      throw new Error(`worktrees cannot be cleaned while Run is active: ${request.runId}`);
    }
    const workspace = await realpath(request.workspace);
    const lease = await this.#workspaceLocks.acquire(workspace, "desktop-cleanup");
    try {
      const runRoot = resolve(workspace, ".localbuddy", "runs", request.runId);
      const persistentStore = new JsonlEventStore(resolve(runRoot, "events.jsonl"));
      const events = [...await persistentStore.list(request.runId)];
      const eventStore = new NotifyingEventStore(persistentStore, (event) => {
        events.push(event);
        this.#emit(projectRun(request.runId, workspace, events));
      });
      await new WorktreeLifecycleManager({
        eventStore,
        executionCoordinator: this.#executionCoordinator,
      }).cleanup(workspace, request.runId);
      return projectRun(request.runId, workspace, events);
    } finally {
      await lease.release();
    }
  }

  async #start(
    request: StartDesktopRunRequest,
    recoveryOf?: string,
    onPersisted?: (runId: string) => Promise<void>,
  ): Promise<DesktopRunView> {
    validateStartRequest(request);
    if (this.#active.size + this.#launching.size >= this.#maxActiveRuns) {
      throw new Error(`At most ${this.#maxActiveRuns} runs can be active at once.`);
    }

    const workspace = await realpath(request.workspace);
    const lease = await this.#workspaceLocks.acquire(workspace, "desktop-run");
    const runId = `run-${randomUUID()}`;
    this.#launching.add(runId);
    const runRoot = resolve(workspace, ".localbuddy", "runs", runId);
    const artifactRoot = resolve(runRoot, "artifacts");
    try {
      await mkdir(artifactRoot, { recursive: true });
      await this.#requestStore.save(runRoot, {
        ...request,
        workspace,
        runId,
        recoveryOf,
        runtimeOwner: "desktop",
      });
      await onPersisted?.(runId);
    } catch (error) {
      this.#launching.delete(runId);
      await lease.release();
      throw error;
    }
    const events: RuntimeEvent[] = [];
    const persistentStore = new JsonlEventStore(resolve(runRoot, "events.jsonl"));
    const eventStore = new NotifyingEventStore(persistentStore, (event) => {
      events.push(event);
      const active = this.#active.get(runId);
      if (active === undefined) {
        return;
      }
      active.view = withPendingApprovals(
        projectRun(runId, workspace, events, active.view.status),
        active.approvalBroker?.list(),
      );
      this.#emit(active.view);
    });
    const abortController = new AbortController();
    const initialView: DesktopRunView = {
      ...projectRun(runId, workspace, [], "starting"),
      mode: request.mode ?? "research",
      runtimeOwner: "desktop",
      recoveryOf,
      providerId: normalizeProviderSelection(request.provider).id,
      trustProfile: normalizeTrustProfile(request.trustProfile),
    };
    const placeholder: ActiveRun = {
      abortController,
      events,
      execution: Promise.resolve(),
      view: initialView,
      processLease: lease,
    };
    this.#active.set(runId, placeholder);
    const approvalBroker = this.#createApprovalBroker(runId, eventStore);
    placeholder.approvalBroker = approvalBroker;
    this.#launching.delete(runId);
    this.#emit(initialView);

    try {
      const providerSelection = normalizeProviderSelection(request.provider);
      const provider = await this.#createProvider(providerSelection);
      const mode = request.mode ?? "research";
      const workflow = mode === "code"
        ? new CodingWorkflow({
            provider,
            eventStore,
            repoRoot: workspace,
            artifactRoot,
            globalConcurrency: request.concurrency,
            executionCoordinator: this.#executionCoordinator,
            recoveryOf,
            runtimeOwner: "desktop",
            providerId: providerSelection.id,
            trustProfile: normalizeTrustProfile(request.trustProfile),
            extensions: request.extensions,
            extensionApprovalHandler: approvalBroker,
            processTaskCapacity: this.#processTaskCapacity,
            oauthRedirectHandler: this.#oauthRedirectHandler,
          })
        : new HeadlessWorkflow({
            provider,
            eventStore,
            workspaceRoot: workspace,
            artifactRoot,
            globalConcurrency: request.concurrency,
            executionCoordinator: this.#executionCoordinator,
            recoveryOf,
            runtimeOwner: "desktop",
            providerId: providerSelection.id,
            trustProfile: normalizeTrustProfile(request.trustProfile),
            extensions: request.extensions,
            extensionApprovalHandler: approvalBroker,
            processTaskCapacity: this.#processTaskCapacity,
            oauthRedirectHandler: this.#oauthRedirectHandler,
          });
      placeholder.execution = workflow
        .run(runId, request.goal, abortController.signal)
        .then(() => undefined)
        .catch(() => undefined)
        .finally(async () => {
          await lease.release();
          const current = this.#active.get(runId);
          if (current !== undefined) {
            this.#emit(current.view);
            this.#active.delete(runId);
          }
        });
      return initialView;
    } catch (error) {
      await eventStore.append({
        type: "run.started",
        runId,
        data: {
          mode: request.mode ?? "research",
          recoveryOf,
          runtimeOwner: "desktop",
          providerId: normalizeProviderSelection(request.provider).id,
          trustProfile: normalizeTrustProfile(request.trustProfile),
        },
      });
      await eventStore.append({
        type: "run.failed",
        runId,
        data: { error: error instanceof Error ? error.message : String(error) },
      });
      this.#active.delete(runId);
      await lease.release();
      throw error;
    }
  }

  cancel(runId: string): void {
    const active = this.#active.get(runId);
    if (active === undefined) {
      throw new Error(`Run is not active: ${runId}`);
    }
    active.view = { ...active.view, status: "cancelling" };
    this.#emit(active.view);
    active.abortController.abort();
  }

  async resolveToolApproval(
    request: ResolveDesktopToolApprovalRequest,
  ): Promise<DesktopRunView> {
    validateRunId(request.runId);
    const workspace = await realpath(request.workspace);
    const active = this.#active.get(request.runId);
    if (active === undefined || active.view.workspace !== workspace || active.approvalBroker === undefined) {
      throw new Error(`Run has no live approval queue: ${request.runId}`);
    }
    await active.approvalBroker.resolve(request.approvalId, request.decision);
    return active.view;
  }

  async approveIntegration(
    request: ApproveDesktopIntegrationRequest,
  ): Promise<DesktopRunView> {
    return this.#mutateIntegration(request.workspace, request.runId, async (manager, proposalPath) => {
      await manager.approve({
        proposalPath,
        expectedRepoRoot: request.workspace,
        commitMessage: request.commitMessage,
        approvalSource: "desktop",
      });
    });
  }

  async revertIntegration(
    request: RevertDesktopIntegrationRequest,
  ): Promise<DesktopRunView> {
    return this.#mutateIntegration(request.workspace, request.runId, async (manager, proposalPath) => {
      await manager.revert({
        proposalPath,
        expectedRepoRoot: request.workspace,
        approvalSource: "desktop",
      });
    });
  }

  async loadIntegrationDiff(request: DesktopRunActionRequest) {
    validateRunId(request.runId);
    const workspace = await realpath(request.workspace);
    const runRoot = resolve(workspace, ".localbuddy", "runs", request.runId);
    return readVerifiedIntegrationPatch({
      proposalPath: resolve(runRoot, "integration-proposal.json"),
      expectedRepoRoot: workspace,
      expectedRunId: request.runId,
    });
  }

  async loadArtifactPreview(
    request: DesktopArtifactActionRequest,
  ): Promise<DesktopArtifactPreviewView> {
    const { record, content } = await this.#readVerifiedArtifact(request);
    if (!PREVIEWABLE_ARTIFACT_EXTENSIONS.has(extname(record.relativePath).toLowerCase())) {
      throw new Error("This artifact type cannot be previewed as text");
    }
    const truncated = content.length > MAX_ARTIFACT_PREVIEW_BYTES;
    return {
      fileName: record.relativePath,
      sha256: record.sha256,
      bytes: content.length,
      text: content.subarray(0, MAX_ARTIFACT_PREVIEW_BYTES).toString("utf8"),
      truncated,
    };
  }

  async resolveArtifactPath(request: DesktopArtifactActionRequest): Promise<string> {
    return (await this.#readVerifiedArtifact(request)).record.absolutePath;
  }

  async buildDiagnostics(
    request: DesktopRunActionRequest,
    appVersion: string,
  ): Promise<Record<string, unknown>> {
    validateRunId(request.runId);
    const workspace = await realpath(request.workspace);
    const runRoot = resolve(workspace, ".localbuddy", "runs", request.runId);
    const [persisted, events] = await Promise.all([
      this.#requestStore.load(runRoot, workspace, request.runId),
      new JsonlEventStore(resolve(runRoot, "events.jsonl")).list(request.runId),
    ]);
    const view = projectRun(request.runId, workspace, events);
    const eventCounts: Record<string, number> = {};
    for (const event of events) {
      eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
    }
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      appVersion,
      redaction: {
        goals: "omitted",
        modelContent: "omitted",
        toolArguments: "omitted",
        credentials: "never_loaded",
        absolutePaths: "fingerprinted_or_omitted",
      },
      workspace: {
        name: basename(workspace),
        sha256: createHash("sha256").update(workspace).digest("hex"),
      },
      run: {
        runId: request.runId,
        mode: persisted.mode,
        status: view.status,
        runtimeOwner: persisted.runtimeOwner,
        providerId: persisted.provider.id,
        trustProfile: persisted.trustProfile,
        concurrency: persisted.concurrency,
        createdAt: persisted.createdAt,
        startedAt: view.startedAt,
        completedAt: view.completedAt,
        recoveryOf: persisted.recoveryOf,
        goalCharacters: persisted.goal.length,
        metrics: view.metrics,
      },
      extensions: {
        skillCount: persisted.extensions.skillIds?.length ?? 0,
        mcpServerCount: persisted.extensions.mcpServerIds?.length ?? 0,
        browserOriginCount: persisted.extensions.browser?.allowedOrigins.length ?? 0,
        browserActionsAllowed: persisted.extensions.browser?.allowActions === true,
        mcpWritesAllowed: persisted.extensions.allowMcpWrites === true,
      },
      tasks: view.tasks.map((task) => ({
        id: task.id,
        status: task.status,
        agentId: task.agentId,
      })),
      artifacts: view.artifacts.map((artifact) => ({
        fileName: artifact.fileName,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
      })),
      integration: view.integration === undefined ? undefined : {
        status: view.integration.status,
        changedPathCount: view.integration.changedPaths.length,
        checkCommands: view.integration.checkCommands,
        combinedPatchSha256: view.integration.combinedPatchSha256,
        commitSha: view.integration.commitSha,
        revertCommitSha: view.integration.revertCommitSha,
        rolledBack: view.integration.rolledBack,
      },
      checkpoint: view.checkpoint === undefined ? undefined : {
        status: view.checkpoint.status,
        completedTasks: view.checkpoint.completedTasks,
        resumableTasks: view.checkpoint.resumableTasks,
      },
      worktrees: {
        total: view.worktrees.length,
        retained: view.worktrees.filter((item) => item.status === "retained").length,
      },
      eventCounts,
      eventCount: events.length,
    };
  }

  async #readVerifiedArtifact(
    request: DesktopArtifactActionRequest,
  ): Promise<{ record: ArtifactRecord; content: Buffer }> {
    validateRunId(request.runId);
    if (
      request.fileName.length === 0
      || request.fileName.includes("\0")
      || isAbsolute(request.fileName)
    ) {
      throw new Error("artifact fileName must be a relative path");
    }
    const workspace = await realpath(request.workspace);
    const runRoot = resolve(workspace, ".localbuddy", "runs", request.runId);
    const artifactRoot = await realpath(resolve(runRoot, "artifacts"));
    const expectedPath = resolve(artifactRoot, request.fileName);
    if (expectedPath !== artifactRoot && !expectedPath.startsWith(`${artifactRoot}${sep}`)) {
      throw new Error("artifact path escapes the registered artifact root");
    }
    const records = await new JsonArtifactRegistry(
      resolve(runRoot, "checkpoint", "artifacts.json"),
    ).list(request.runId);
    const record = records.find((candidate) => candidate.relativePath === request.fileName);
    if (record === undefined) throw new Error("artifact is not present in the Run registry");
    const [actualPath, registeredPath] = await Promise.all([
      realpath(expectedPath),
      realpath(record.absolutePath),
    ]);
    if (actualPath !== registeredPath || !actualPath.startsWith(`${artifactRoot}${sep}`)) {
      throw new Error("artifact registry path no longer matches the Run artifact root");
    }
    const metadata = await stat(actualPath);
    if (!metadata.isFile()) throw new Error("registered artifact is not a regular file");
    const content = await readFile(actualPath);
    const sha256 = createHash("sha256").update(content).digest("hex");
    if (content.length !== record.bytes || sha256 !== record.sha256) {
      throw new Error("artifact content no longer matches its registered size and SHA-256");
    }
    return { record: { ...record, absolutePath: actualPath }, content };
  }

  async list(workspace: string): Promise<readonly DesktopRunView[]> {
    const canonicalWorkspace = await realpath(workspace);
    const lease = await this.#workspaceLocks.tryAcquire(canonicalWorkspace, "desktop-reconcile");
    if (lease !== undefined) {
      try {
        await this.#reconcileInterrupted(canonicalWorkspace);
        await this.#reconcileApplyingIntegrations(canonicalWorkspace);
      } finally {
        await lease.release();
      }
    }
    const persisted = await loadWorkspaceRunHistory(canonicalWorkspace);
    const active = [...this.#active.values()]
      .map((run) => run.view)
      .filter((run) => run.workspace === canonicalWorkspace);
    const activeIds = new Set(active.map((run) => run.runId));
    return [...active, ...persisted.filter((run) => !activeIds.has(run.runId))];
  }

  async waitForIdle(): Promise<void> {
    await Promise.all([...this.#active.values()].map((active) => active.execution));
  }

  async #mutateIntegration(
    workspaceInput: string,
    runId: string,
    operation: (manager: IntegrationManager, proposalPath: string) => Promise<void>,
  ): Promise<DesktopRunView> {
    validateRunId(runId);
    const workspace = await realpath(workspaceInput);
    const lease = await this.#workspaceLocks.acquire(workspace, "desktop-integration");
    try {
      const runRoot = resolve(workspace, ".localbuddy", "runs", runId);
      const persistentStore = new JsonlEventStore(resolve(runRoot, "events.jsonl"));
      const events = [...await persistentStore.list(runId)];
      if (events.length === 0) {
        throw new Error(`Run history does not exist: ${runId}`);
      }
      const eventStore = new NotifyingEventStore(persistentStore, (event) => {
        events.push(event);
        const view = projectRun(runId, workspace, events);
        const active = this.#active.get(runId);
        if (active !== undefined) {
          active.events = events;
          active.view = view;
        }
        this.#emit(view);
      });
      await operation(
        new IntegrationManager({
          eventStore,
          executionCoordinator: this.#executionCoordinator,
        }),
        resolve(runRoot, "integration-proposal.json"),
      );
      return projectRun(runId, workspace, events);
    } finally {
      await lease.release();
    }
  }

  async #reconcileInterrupted(workspace: string): Promise<void> {
    const runsRoot = resolve(workspace, ".localbuddy", "runs");
    let entries;
    try {
      entries = await readdir(runsRoot, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || this.#active.has(entry.name) || this.#launching.has(entry.name)) {
        continue;
      }
      try {
        validateRunId(entry.name);
      } catch {
        continue;
      }
      const runRoot = resolve(runsRoot, entry.name);
      const eventStore = new JsonlEventStore(resolve(runRoot, "events.jsonl"));
      const events = await eventStore.list(entry.name);
      if (hasTerminalRunState(events)) {
        continue;
      }
      let persisted: PersistedRunRequest | undefined;
      try {
        persisted = await this.#requestStore.load(runRoot, workspace, entry.name);
      } catch (error) {
        if (events.length === 0 && isNodeError(error) && error.code === "ENOENT") {
          continue;
        }
      }
      if (persisted?.runtimeOwner !== "desktop") {
        continue;
      }
      const started = events.find((event) => event.type === "run.started");
      const checkpointInspection = await this.#inspectCheckpoint(
        runRoot,
        workspace,
        entry.name,
        persisted,
      );
      await eventStore.append({
        type: "run.interrupted",
        runId: entry.name,
        data: {
          reason: "LocalBuddy restarted before the Run reached a terminal state",
          mode: persisted?.mode ?? (started?.data?.mode === "code" ? "code" : "research"),
          createdAt: persisted?.createdAt ?? started?.timestamp,
          replayAvailable: persisted !== undefined,
          runtimeOwner: "desktop",
          resumeAvailable: checkpointInspection.available,
          checkpointCompletedTasks: checkpointInspection.completedTasks,
          checkpointResumableTasks: checkpointInspection.resumableTasks,
          resumeBlockedReason: checkpointInspection.reason,
        },
      });
    }
  }

  async #inspectCheckpoint(
    runRoot: string,
    workspace: string,
    runId: string,
    request: PersistedRunRequest,
  ): Promise<DesktopResumeInspection> {
    try {
      if (request.mode === "code") {
        return await new CodingCheckpointStore(resolve(runRoot, "checkpoint")).inspectResume({
          runId,
          repoRoot: workspace,
          goal: request.goal,
        });
      }
      return await new ResearchCheckpointStore(resolve(runRoot, "checkpoint")).inspectResume({
        runId,
        workspace,
        goal: request.goal,
        snapshot: await buildWorkspaceSnapshot(workspace),
      });
    } catch (error) {
      return {
        available: false,
        completedTasks: 0,
        resumableTasks: 0,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async #reconcileApplyingIntegrations(workspace: string): Promise<void> {
    const runsRoot = resolve(workspace, ".localbuddy", "runs");
    let entries;
    try {
      entries = await readdir(runsRoot, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || this.#active.has(entry.name) || this.#launching.has(entry.name)) {
        continue;
      }
      try {
        validateRunId(entry.name);
      } catch {
        continue;
      }
      const runRoot = resolve(runsRoot, entry.name);
      const eventStore = new JsonlEventStore(resolve(runRoot, "events.jsonl"));
      try {
        await new IntegrationManager({
          eventStore,
          executionCoordinator: this.#executionCoordinator,
        }).reconcileApplying({
          proposalPath: resolve(runRoot, "integration-proposal.json"),
          expectedRepoRoot: workspace,
        });
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        const events = await eventStore.list(entry.name);
        const alreadyRecorded = events.toReversed().some((event) =>
          event.type === "integration.recovery_required"
          && event.data?.error === message,
        );
        if (!alreadyRecorded) {
          await eventStore.append({
            type: "integration.recovery_required",
            runId: entry.name,
            data: { error: message, reconciled: true, proposalInvalid: true },
          });
        }
      }
    }
  }

  #emit(view: DesktopRunView): void {
    for (const listener of this.#listeners) {
      listener(view);
    }
  }

  #createApprovalBroker(
    runId: string,
    eventStore: EventStore,
  ): InteractiveToolApprovalBroker {
    return new InteractiveToolApprovalBroker({
      eventStore,
      onChange: (pending) => {
        const active = this.#active.get(runId);
        if (active === undefined) return;
        active.view = withPendingApprovals(active.view, pending);
        this.#emit(active.view);
      },
    });
  }
}

function withPendingApprovals(
  view: DesktopRunView,
  pending: readonly PendingToolApproval[] | undefined,
): DesktopRunView {
  return { ...view, pendingApprovals: pending ?? [] };
}

function hasTerminalRunState(events: readonly RuntimeEvent[]): boolean {
  const lifecycle = events.toReversed().find((event) =>
    event.type === "run.started"
    || event.type === "run.resumed"
    || event.type === "run.succeeded"
    || event.type === "run.failed"
    || event.type === "run.cancelled"
    || event.type === "run.interrupted",
  );
  return lifecycle?.type === "run.succeeded"
    || lifecycle?.type === "run.failed"
    || lifecycle?.type === "run.cancelled"
    || lifecycle?.type === "run.interrupted";
}

class NotifyingEventStore implements EventStore {
  readonly #inner: EventStore;
  readonly #listener: (event: RuntimeEvent) => void;

  constructor(inner: EventStore, listener: (event: RuntimeEvent) => void) {
    this.#inner = inner;
    this.#listener = listener;
  }

  async append(event: PendingRuntimeEvent): Promise<RuntimeEvent> {
    const stored = await this.#inner.append(event);
    this.#listener(stored);
    return stored;
  }

  list(runId?: string): Promise<readonly RuntimeEvent[]> {
    return this.#inner.list(runId);
  }
}

function validateStartRequest(request: StartDesktopRunRequest): void {
  if (request.workspace.trim().length === 0) {
    throw new Error("Workspace is required");
  }
  if (request.goal.trim().length === 0 || request.goal.length > 20_000) {
    throw new Error("Goal must contain between 1 and 20,000 characters");
  }
  if (!Number.isInteger(request.concurrency) || request.concurrency < 1 || request.concurrency > 3) {
    throw new Error("Concurrency must be an integer between 1 and 3");
  }
  if (request.mode !== undefined && request.mode !== "research" && request.mode !== "code") {
    throw new Error("Mode must be research or code");
  }
  normalizeProviderSelection(request.provider);
  normalizeTrustProfile(request.trustProfile);
  normalizeRunExtensions(request.extensions);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
