import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, resolve, sep } from "node:path";

import type {
  ApproveDesktopIntegrationRequest,
  DesktopArtifactActionRequest,
  DesktopArtifactPreviewView,
  DesktopArtifactRevisionDiffView,
  DesktopArtifactThreadVersionView,
  DesktopArtifactThreadView,
  DesktopCheckpointView,
  DesktopRunActionRequest,
  DesktopRunView,
  RevertDesktopIntegrationRequest,
  ResolveDesktopPlanReviewRequest,
  ResolveDesktopToolApprovalRequest,
  StartDesktopRunRequest,
} from "./desktop-contract.js";
import {
  createArtifactRevision,
  artifactThreadId,
  normalizeArtifactContinuation,
  normalizeArtifactRevision,
  type ArtifactContinuationRequest,
  type ArtifactRevisionContract,
} from "./artifact-revision.js";
import { createArtifactTextDiff } from "./artifact-text-diff.js";
import {
  MAX_ARTIFACT_REVIEW_CHARACTERS,
  type ArtifactReviewCandidate,
} from "./artifact-reviewer.js";
import { JsonArtifactRegistry, type ArtifactRecord } from "./artifacts.js";
import { DOCX_MEDIA_TYPE, inspectDocxArtifact } from "./docx-artifact.js";
import { CodingWorkflow } from "./coding-workflow.js";
import { CodingCheckpointStore } from "./coding-checkpoint-store.js";
import { ResearchCheckpointStore } from "./checkpoint-store.js";
import type { EventStore, PendingRuntimeEvent, RuntimeEvent } from "./event-store.js";
import { JsonlEventStore } from "./event-store.js";
import { ExecutionCoordinator } from "./execution-coordinator.js";
import { HeadlessWorkflow } from "./headless-workflow.js";
import {
  goalContractCharacterCount,
  normalizeGoalContract,
} from "./goal-contract.js";
import { IntegrationManager, readVerifiedIntegrationPatch } from "./integration-manager.js";
import type { ModelProvider } from "./provider.js";
import type { ProcessSharedCapacity } from "./process-shared-provider.js";
import {
  ensurePrivateDirectory,
  ensurePrivateRunRoot,
  assertPrivateFileIfPresent,
  hardenPrivateRunStorage,
  writePrivateFileAtomic,
} from "./private-storage.js";
import type { OAuthRedirectHandler } from "./mcp-oauth.js";
import { normalizeRunExtensions } from "./extension-config.js";
import { normalizeProviderSelection, type ProviderSelection } from "./provider-config.js";
import { loadWorkspaceRunHistory, projectRun } from "./run-projection.js";
import { canonicalResearchSourcePaths } from "./research-sources.js";
import {
  RunRequestStore,
  type PersistedRunRequest,
  validateRunId,
} from "./run-request-store.js";
import { WorktreeLifecycleManager } from "./worktree-lifecycle.js";
import {
  WorkspaceProcessLockManager,
  type WorkspaceProcessLease,
} from "./workspace-process-lock.js";
import {
  InteractiveToolApprovalBroker,
  type PendingToolApproval,
} from "./tool-approval.js";
import { normalizeTrustProfile } from "./tool-runtime.js";
import {
  InteractivePlanReviewBroker,
  PlanReviewStore,
  type PlanReviewRecord,
} from "./plan-review.js";

export interface DesktopRunManagerOptions {
  createProvider(selection: ProviderSelection): Promise<ModelProvider>;
  maxActiveRuns?: number;
  globalConcurrency?: number;
  processTaskCapacity?: ProcessSharedCapacity;
  oauthRedirectHandler?: OAuthRedirectHandler;
  requirePlanReview?: boolean;
}

interface ActiveRun {
  abortController: AbortController;
  events: RuntimeEvent[];
  execution: Promise<void>;
  view: DesktopRunView;
  approvalBroker?: InteractiveToolApprovalBroker;
  planReviewBroker?: InteractivePlanReviewBroker;
  processLease: WorkspaceProcessLease;
}

interface DesktopResumeInspection {
  available: boolean;
  completedTasks: number;
  resumableTasks: number;
  reason?: string;
}

interface PreparedArtifactRevision {
  contract: ArtifactRevisionContract;
  content: Buffer;
  parentAbsolutePath: string;
  verifiedParentArtifact?: ArtifactReviewCandidate;
}

const MAX_ARTIFACT_PREVIEW_BYTES = 200_000;
const MAX_ARTIFACT_THREAD_VERSIONS = 200;
const MAX_ARTIFACTS_PER_THREAD_VERSION = 20;
const TEXT_ARTIFACT_EXTENSIONS = new Set([".md", ".json", ".txt", ".patch", ".diff"]);
const TERMINAL_RUN_STATUSES = new Set<DesktopRunView["status"]>([
  "succeeded",
  "failed",
  "cancelled",
]);

export class DesktopRunManager {
  readonly #createProvider: (selection: ProviderSelection) => Promise<ModelProvider>;
  readonly #maxActiveRuns: number;
  readonly #executionCoordinator: ExecutionCoordinator;
  readonly #requestStore = new RunRequestStore();
  readonly #processTaskCapacity?: ProcessSharedCapacity;
  readonly #workspaceLocks = new WorkspaceProcessLockManager();
  readonly #oauthRedirectHandler?: OAuthRedirectHandler;
  readonly #requirePlanReview: boolean;
  readonly #active = new Map<string, ActiveRun>();
  readonly #launching = new Set<string>();
  readonly #listeners = new Set<(run: DesktopRunView) => void>();
  #mutatingIntegrations = 0;

  constructor(options: DesktopRunManagerOptions) {
    this.#createProvider = options.createProvider;
    this.#maxActiveRuns = options.maxActiveRuns ?? 2;
    this.#executionCoordinator = new ExecutionCoordinator(options.globalConcurrency ?? 3);
    this.#processTaskCapacity = options.processTaskCapacity;
    this.#oauthRedirectHandler = options.oauthRedirectHandler;
    this.#requirePlanReview = options.requirePlanReview ?? false;
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
      const runRoot = await ensurePrivateRunRoot(workspace, request.runId);
      await hardenPrivateRunStorage(runRoot);
      const eventStore = new JsonlEventStore(resolve(runRoot, "events.jsonl"));
      const events = await eventStore.list(request.runId);
      const source = projectRun(request.runId, workspace, events);
      if (source.status !== "interrupted" && source.status !== "failed") {
        throw new Error(`only interrupted or failed Runs can be replayed: ${source.status}`);
      }
      if (source.restartedAs !== undefined) {
        throw new Error(`Run was already replayed as ${source.restartedAs}`);
      }
      const persisted = await this.#requestStore.load(runRoot, workspace, request.runId);
      if (persisted.mode === "research" && persisted.sourceContract === "legacy-workspace") {
        throw new Error(
          "this legacy Research Run used the project directory as implicit evidence; start a new Run and explicitly add the required sources",
        );
      }
      return await this.#start(
        {
          workspace,
          goal: persisted.goalContract.outcome,
          goalConstraints: persisted.goalContract.constraints,
          verificationCriteria: persisted.goalContract.verificationCriteria,
          concurrency: persisted.concurrency,
          mode: persisted.mode,
          sourcePaths: persisted.artifactRevision === undefined
            ? persisted.sourcePaths
            : persisted.sourcePaths.filter((sourcePath) =>
                sourcePath !== resolve(runRoot, persisted.artifactRevision?.sourceRelativePath ?? "")
              ),
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
        persisted.planReview,
        persisted.artifactRevision,
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
      const runRoot = await ensurePrivateRunRoot(workspace, request.runId);
      await hardenPrivateRunStorage(runRoot);
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
        const reason = inspection.reason ?? "checkpoint is not safely resumable";
        const blocked = await persistentStore.append({
          type: "checkpoint.resume_blocked",
          runId: request.runId,
          data: {
            reason,
            completedTasks: inspection.completedTasks,
            resumableTasks: inspection.resumableTasks,
          },
        });
        events.push(blocked);
        const blockedView = projectRun(request.runId, workspace, events);
        this.#launching.delete(request.runId);
        await lease.release();
        this.#emit(blockedView);
        throw new Error(reason);
      }
      const eventStore = new NotifyingEventStore(persistentStore, (event) => {
        events.push(event);
        const active = this.#active.get(request.runId);
        if (active === undefined) {
          return;
        }
        active.view = decorateRun(
          projectRun(request.runId, workspace, events, active.view.status),
          active.approvalBroker?.list(),
          active.planReviewBroker?.current,
        );
        if (!TERMINAL_RUN_STATUSES.has(active.view.status)) {
          this.#emit(active.view);
        }
      });
      const abortController = new AbortController();
      const initialView = await this.#withPersistentRunState({ ...source, status: "starting" });
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
      const planReviewBroker = persisted.planReview === "required"
        ? this.#createPlanReviewBroker(request.runId, runRoot, persisted, eventStore)
        : undefined;
      placeholder.planReviewBroker = planReviewBroker;
      this.#launching.delete(request.runId);
      this.#emit(initialView);

      try {
        const provider = await this.#createProvider(persisted.provider);
        const verifiedParentArtifact = await this.#loadVerifiedRevisionParent(
          runRoot,
          persisted,
        );
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
              planReview: planReviewBroker?.review.bind(planReviewBroker),
            })
          : new HeadlessWorkflow({
              provider,
              eventStore,
              workspaceRoot: workspace,
              sourcePaths: persisted.sourcePaths,
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
              planReview: planReviewBroker?.review.bind(planReviewBroker),
              requiredArtifactFileName: persisted.artifactRevision?.parentFileName,
              verifiedParentArtifact,
            });
        placeholder.execution = workflow
          .resume(request.runId, persisted.executionGoal, abortController.signal)
          .then(() => undefined)
          .catch(() => undefined)
          .finally(async () => {
            await lease.release();
            const current = this.#active.get(request.runId);
            if (current !== undefined) {
              current.view = await this.#withRecoveryInspection(current.view);
              this.#active.delete(request.runId);
              this.#emit(current.view);
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
        const current = this.#active.get(request.runId);
        if (current !== undefined) {
          current.view = await this.#withRecoveryInspection(current.view);
        }
        await lease.release();
        if (current !== undefined) {
          this.#active.delete(request.runId);
          this.#emit(current.view);
        }
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
      const runRoot = await ensurePrivateRunRoot(workspace, request.runId);
      await hardenPrivateRunStorage(runRoot);
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
    planReviewPolicy: PersistedRunRequest["planReview"] = this.#requirePlanReview
      ? "required"
      : "skipped",
    replayArtifactRevision?: ArtifactRevisionContract,
  ): Promise<DesktopRunView> {
    validateStartRequest(request);
    if (planReviewPolicy === "required"
      && normalizeGoalContract({
        outcome: request.goal,
        constraints: request.goalConstraints,
        verificationCriteria: request.verificationCriteria,
      }).verificationCriteria.length === 0) {
      throw new Error("Desktop Goal Contract requires at least one verification criterion");
    }
    if (this.#active.size + this.#launching.size >= this.#maxActiveRuns) {
      throw new Error(`At most ${this.#maxActiveRuns} runs can be active at once.`);
    }

    const runId = `run-${randomUUID()}`;
    this.#launching.add(runId);
    let workspace: string;
    let lease: WorkspaceProcessLease;
    try {
      workspace = await realpath(request.workspace);
      lease = await this.#workspaceLocks.acquire(workspace, "desktop-run");
    } catch (error) {
      this.#launching.delete(runId);
      throw error;
    }
    let preparedArtifactRevision: PreparedArtifactRevision | undefined;
    try {
      preparedArtifactRevision = replayArtifactRevision === undefined
        ? request.artifactContinuation === undefined
          ? undefined
          : await this.#prepareArtifactRevision(workspace, request.artifactContinuation)
        : await this.#prepareArtifactRevision(workspace, replayArtifactRevision, replayArtifactRevision);
    } catch (error) {
      this.#launching.delete(runId);
      await lease.release();
      throw error;
    }
    const runRoot = await ensurePrivateRunRoot(workspace, runId);
    await hardenPrivateRunStorage(runRoot);
    const artifactRoot = resolve(runRoot, "artifacts");
    let persisted: PersistedRunRequest;
    let revisionEvent: RuntimeEvent | undefined;
    try {
      await ensurePrivateDirectory(artifactRoot);
      let revisionSourcePath: string | undefined;
      let requestedSourcePaths = request.sourcePaths ?? [];
      if (preparedArtifactRevision !== undefined) {
        requestedSourcePaths = (await canonicalResearchSourcePaths(requestedSourcePaths))
          .filter((sourcePath) => sourcePath !== preparedArtifactRevision.parentAbsolutePath);
        revisionSourcePath = resolve(
          runRoot,
          preparedArtifactRevision.contract.sourceRelativePath,
        );
        await ensurePrivateDirectory(dirname(revisionSourcePath));
        await writePrivateFileAtomic(revisionSourcePath, preparedArtifactRevision.content);
      }
      persisted = await this.#requestStore.save(runRoot, {
        ...request,
        sourcePaths: revisionSourcePath === undefined
          ? request.sourcePaths
          : [revisionSourcePath, ...requestedSourcePaths],
        workspace,
        runId,
        recoveryOf,
        runtimeOwner: "desktop",
        planReview: planReviewPolicy,
        artifactRevision: preparedArtifactRevision?.contract,
      });
      if (persisted.artifactRevision !== undefined) {
        revisionEvent = await new JsonlEventStore(resolve(runRoot, "events.jsonl")).append({
          type: "artifact.revision_linked",
          runId,
          data: {
            version: persisted.artifactRevision.version,
            threadId: persisted.artifactRevision.threadId,
            revision: persisted.artifactRevision.revision,
            parentRunId: persisted.artifactRevision.parentRunId,
            parentFileName: persisted.artifactRevision.parentFileName,
            parentSha256: persisted.artifactRevision.parentSha256,
            reason: persisted.artifactRevision.reason,
          },
        });
      }
      await onPersisted?.(runId);
    } catch (error) {
      this.#launching.delete(runId);
      await lease.release();
      throw error;
    }
    const events: RuntimeEvent[] = revisionEvent === undefined ? [] : [revisionEvent];
    const persistentStore = new JsonlEventStore(resolve(runRoot, "events.jsonl"));
    const eventStore = new NotifyingEventStore(persistentStore, (event) => {
      events.push(event);
      const active = this.#active.get(runId);
      if (active === undefined) {
        return;
      }
      active.view = decorateRun(
        projectRun(runId, workspace, events, active.view.status),
        active.approvalBroker?.list(),
        active.planReviewBroker?.current,
      );
      if (!TERMINAL_RUN_STATUSES.has(active.view.status)) {
        this.#emit(active.view);
      }
    });
    const abortController = new AbortController();
    const initialView: DesktopRunView = {
      ...projectRun(runId, workspace, [], "starting"),
      mode: request.mode ?? "research",
      runtimeOwner: "desktop",
      recoveryOf,
      providerId: persisted.provider.id,
      trustProfile: persisted.trustProfile,
      artifactRevision: persisted.artifactRevision,
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
    const planReviewBroker = persisted.planReview === "required"
      ? this.#createPlanReviewBroker(runId, runRoot, persisted, eventStore)
      : undefined;
    placeholder.planReviewBroker = planReviewBroker;
    this.#launching.delete(runId);
    this.#emit(initialView);

    try {
      const provider = await this.#createProvider(persisted.provider);
      const mode = persisted.mode;
      const workflow = mode === "code"
        ? new CodingWorkflow({
            provider,
            eventStore,
            repoRoot: workspace,
            artifactRoot,
            globalConcurrency: persisted.concurrency,
            executionCoordinator: this.#executionCoordinator,
            recoveryOf,
            runtimeOwner: "desktop",
            providerId: persisted.provider.id,
            trustProfile: persisted.trustProfile,
            extensions: persisted.extensions,
            extensionApprovalHandler: approvalBroker,
            processTaskCapacity: this.#processTaskCapacity,
            oauthRedirectHandler: this.#oauthRedirectHandler,
            planReview: planReviewBroker?.review.bind(planReviewBroker),
          })
        : new HeadlessWorkflow({
            provider,
            eventStore,
            workspaceRoot: workspace,
            sourcePaths: persisted.sourcePaths,
            artifactRoot,
            globalConcurrency: persisted.concurrency,
            executionCoordinator: this.#executionCoordinator,
            recoveryOf,
            runtimeOwner: "desktop",
            providerId: persisted.provider.id,
            trustProfile: persisted.trustProfile,
            extensions: persisted.extensions,
            extensionApprovalHandler: approvalBroker,
            processTaskCapacity: this.#processTaskCapacity,
            oauthRedirectHandler: this.#oauthRedirectHandler,
            planReview: planReviewBroker?.review.bind(planReviewBroker),
            requiredArtifactFileName: persisted.artifactRevision?.parentFileName,
            verifiedParentArtifact: preparedArtifactRevision?.verifiedParentArtifact,
          });
      placeholder.execution = workflow
        .run(
          runId,
          persisted.executionGoal,
          abortController.signal,
        )
        .then(() => undefined)
        .catch(() => undefined)
        .finally(async () => {
          await lease.release();
          const current = this.#active.get(runId);
          if (current !== undefined) {
            current.view = await this.#withRecoveryInspection(current.view);
            this.#active.delete(runId);
            this.#emit(current.view);
          }
        });
      return initialView;
    } catch (error) {
      await eventStore.append({
        type: "run.started",
        runId,
        data: {
          mode: persisted.mode,
          recoveryOf,
          runtimeOwner: "desktop",
          providerId: persisted.provider.id,
          trustProfile: persisted.trustProfile,
        },
      });
      await eventStore.append({
        type: "run.failed",
        runId,
        data: { error: error instanceof Error ? error.message : String(error) },
      });
      const current = this.#active.get(runId);
      if (current !== undefined) {
        current.view = await this.#withRecoveryInspection(current.view);
      }
      await lease.release();
      if (current !== undefined) {
        this.#active.delete(runId);
        this.#emit(current.view);
      }
      throw error;
    }
  }

  async cancel(runId: string): Promise<void> {
    const active = this.#active.get(runId);
    if (active === undefined) {
      throw new Error(`Run is not active: ${runId}`);
    }
    active.view = { ...active.view, status: "cancelling" };
    this.#emit(active.view);
    try {
      await active.planReviewBroker?.cancel();
    } finally {
      active.abortController.abort();
    }
  }

  async resolvePlanReview(
    request: ResolveDesktopPlanReviewRequest,
  ): Promise<DesktopRunView> {
    validateRunId(request.runId);
    const workspace = await realpath(request.workspace);
    const active = this.#active.get(request.runId);
    if (
      active === undefined
      || active.view.workspace !== workspace
      || active.planReviewBroker === undefined
      || active.view.status !== "awaiting_plan_approval"
    ) {
      throw new Error(`Run has no live Plan Review decision: ${request.runId}`);
    }
    await active.planReviewBroker.resolve(request.decision);
    return active.view;
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
    const extension = extname(record.relativePath).toLowerCase();
    if (extension === ".docx") {
      const inspection = inspectDocxArtifact(content);
      return {
        fileName: record.relativePath,
        sha256: record.sha256,
        bytes: content.length,
        format: "docx",
        text: inspection.text,
        truncated: false,
        document: {
          title: inspection.title,
          paragraphs: inspection.paragraphCount,
          sections: inspection.sectionCount,
          tables: inspection.tableCount,
          tableRows: inspection.tableRowCount,
        },
      };
    }
    if (!TEXT_ARTIFACT_EXTENSIONS.has(extension)) {
      throw new Error("This artifact type cannot be previewed as text");
    }
    const truncated = content.length > MAX_ARTIFACT_PREVIEW_BYTES;
    return {
      fileName: record.relativePath,
      sha256: record.sha256,
      bytes: content.length,
      format: "text",
      text: content.subarray(0, MAX_ARTIFACT_PREVIEW_BYTES).toString("utf8"),
      truncated,
    };
  }

  async loadArtifactThread(
    request: DesktopArtifactActionRequest,
  ): Promise<DesktopArtifactThreadView> {
    const selectedArtifact = await this.#readVerifiedArtifact(request);
    const workspace = await realpath(request.workspace);
    const runs = await this.list(workspace);
    const selectedRun = runs.find((run) => run.runId === request.runId);
    if (selectedRun === undefined) throw new Error(`Run history does not exist: ${request.runId}`);

    const childThreads = selectedRun.artifactRevision === undefined
      ? new Set(runs
          .filter((run) => run.artifactRevision?.parentRunId === request.runId
            && run.artifactRevision.parentFileName === selectedArtifact.record.relativePath
            && run.artifactRevision.parentSha256 === selectedArtifact.record.sha256)
          .map((run) => run.artifactRevision?.threadId)
          .filter((threadId): threadId is string => threadId !== undefined))
      : new Set<string>();
    if (childThreads.size > 1) {
      throw new Error("Artifact history contains conflicting Thread identities");
    }
    const threadId = selectedRun.artifactRevision?.threadId
      ?? childThreads.values().next().value
      ?? artifactThreadId({
        parentRunId: request.runId,
        parentFileName: selectedArtifact.record.relativePath,
        parentSha256: selectedArtifact.record.sha256,
        reason: "standalone Artifact identity",
      });
    const threadRuns = runs.filter((run) => run.artifactRevision?.threadId === threadId);
    if (threadRuns.length > MAX_ARTIFACT_THREAD_VERSIONS) {
      throw new Error(`Artifact Thread exceeds the ${MAX_ARTIFACT_THREAD_VERSIONS}-version display limit`);
    }
    const threadRunIds = new Set(threadRuns.map((run) => run.runId));
    const rootReferences = threadRuns
      .filter((run) => !threadRunIds.has(run.artifactRevision?.parentRunId ?? ""))
      .map((run) => ({
        revision: Math.max(1, (run.artifactRevision?.revision ?? 2) - 1),
        runId: run.artifactRevision?.parentRunId ?? "",
        fileName: run.artifactRevision?.parentFileName ?? "",
        sha256: run.artifactRevision?.parentSha256 ?? "",
      }));
    if (threadRuns.length === 0) {
      rootReferences.push({
        revision: 1,
        runId: request.runId,
        fileName: selectedArtifact.record.relativePath,
        sha256: selectedArtifact.record.sha256,
      });
    }
    const uniqueRoots = [...new Map(rootReferences.map((root) => [
      `${root.revision}:${root.runId}:${root.fileName}:${root.sha256}`,
      root,
    ])).values()];

    const rootVersions = await Promise.all(uniqueRoots.map(async (root) => {
      const rootRun = runs.find((run) => run.runId === root.runId);
      let artifact: DesktopArtifactThreadVersionView["artifacts"][number];
      try {
        const verified = await this.#readVerifiedArtifact({
          workspace,
          runId: root.runId,
          fileName: root.fileName,
        });
        artifact = verified.record.sha256 === root.sha256
          ? {
              fileName: root.fileName,
              sha256: root.sha256,
              bytes: verified.record.bytes,
              verification: "verified",
            }
          : { fileName: root.fileName, sha256: root.sha256, verification: "unavailable" };
      } catch {
        artifact = { fileName: root.fileName, sha256: root.sha256, verification: "unavailable" };
      }
      return {
        revision: root.revision,
        runId: root.runId,
        runStatus: rootRun?.status ?? "failed",
        title: rootRun === undefined ? root.fileName : artifactThreadRunTitle(rootRun),
        startedAt: rootRun?.startedAt,
        artifacts: [artifact],
      } satisfies DesktopArtifactThreadVersionView;
    }));
    const revisionVersions = await Promise.all(threadRuns.map(async (run) => {
      if (run.artifacts.length > MAX_ARTIFACTS_PER_THREAD_VERSION) {
        throw new Error(
          `Artifact version ${run.runId} exceeds the ${MAX_ARTIFACTS_PER_THREAD_VERSION}-artifact display limit`,
        );
      }
      const artifacts = await Promise.all(run.artifacts.map(async (artifact) => {
        try {
          const verified = await this.#readVerifiedArtifact({
            workspace,
            runId: run.runId,
            fileName: artifact.fileName,
          });
          return {
            fileName: artifact.fileName,
            sha256: verified.record.sha256,
            bytes: verified.record.bytes,
            verification: "verified" as const,
          };
        } catch {
          return {
            fileName: artifact.fileName,
            sha256: artifact.sha256,
            bytes: artifact.bytes,
            verification: "unavailable" as const,
          };
        }
      }));
      return {
        revision: run.artifactRevision?.revision ?? 1,
        runId: run.runId,
        runStatus: run.status,
        title: artifactThreadRunTitle(run),
        startedAt: run.startedAt,
        reason: run.artifactRevision?.reason,
        parentRunId: run.artifactRevision?.parentRunId,
        parentFileName: run.artifactRevision?.parentFileName,
        artifacts,
      } satisfies DesktopArtifactThreadVersionView;
    }));
    return {
      version: 1,
      threadId,
      selectedRunId: request.runId,
      selectedFileName: selectedArtifact.record.relativePath,
      versions: [...rootVersions, ...revisionVersions].toSorted((left, right) =>
        left.revision - right.revision
          || (left.startedAt ?? "").localeCompare(right.startedAt ?? "")
          || left.runId.localeCompare(right.runId)),
    };
  }

  async loadArtifactRevisionDiff(
    request: DesktopArtifactActionRequest,
  ): Promise<DesktopArtifactRevisionDiffView> {
    const workspace = await realpath(request.workspace);
    const runRoot = resolve(workspace, ".localbuddy", "runs", request.runId);
    const revision = await this.#requestStore.loadArtifactRevision(runRoot, request.runId);
    if (revision === undefined) throw new Error("This Artifact is not part of a revision Run");
    const current = await this.#readVerifiedArtifact({ ...request, workspace });
    const parent = await this.#readVerifiedArtifact({
      workspace,
      runId: revision.parentRunId,
      fileName: revision.parentFileName,
    });
    if (parent.record.sha256 !== revision.parentSha256) {
      throw new Error("Artifact revision parent SHA-256 no longer matches its Thread identity");
    }
    const currentExtension = extname(current.record.relativePath).toLowerCase();
    const parentExtension = extname(parent.record.relativePath).toLowerCase();
    const docxComparison = currentExtension === ".docx" && parentExtension === ".docx";
    const textComparison = TEXT_ARTIFACT_EXTENSIONS.has(currentExtension)
      && TEXT_ARTIFACT_EXTENSIONS.has(parentExtension);
    if (!docxComparison && !textComparison) {
      throw new Error("Artifact revision diff requires two text artifacts or two supported DOCX artifacts");
    }
    const parentRevision = await this.#requestStore.loadArtifactRevision(
      resolve(workspace, ".localbuddy", "runs", revision.parentRunId),
      revision.parentRunId,
    );
    const parentRevisionNumber = parentRevision?.revision ?? 1;
    if (
      (parentRevision === undefined && revision.revision !== 2)
      || (parentRevision !== undefined
        && (parentRevision.threadId !== revision.threadId
          || parentRevision.revision + 1 !== revision.revision))
    ) {
      throw new Error("Artifact revision parent has a conflicting Thread lineage");
    }
    const diff = docxComparison
      ? createArtifactTextDiff(
          Buffer.from(inspectDocxArtifact(parent.content).text, "utf8"),
          Buffer.from(inspectDocxArtifact(current.content).text, "utf8"),
        )
      : createArtifactTextDiff(parent.content, current.content);
    return {
      version: 1,
      comparisonKind: docxComparison ? "docx-structure" : "text",
      threadId: revision.threadId,
      parent: {
        runId: revision.parentRunId,
        fileName: revision.parentFileName,
        sha256: revision.parentSha256,
        revision: parentRevisionNumber,
      },
      current: {
        runId: request.runId,
        fileName: current.record.relativePath,
        sha256: current.record.sha256,
        revision: revision.revision,
      },
      ...diff,
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
    const view = await this.#withRecoveryInspection(
      projectRun(request.runId, workspace, events),
    );
    const eventCounts: Record<string, number> = {};
    const toolFailureCounts: Record<string, number> = {};
    for (const event of events) {
      eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
      if (event.type === "tool.failed") {
        const toolName = typeof event.data?.toolName === "string"
          ? event.data.toolName.slice(0, 100)
          : "unknown";
        toolFailureCounts[toolName] = (toolFailureCounts[toolName] ?? 0) + 1;
      }
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
        goalCharacters: goalContractCharacterCount(persisted.goalContract),
        artifactRevision: persisted.artifactRevision === undefined ? undefined : {
          threadId: persisted.artifactRevision.threadId,
          revision: persisted.artifactRevision.revision,
          parentRunId: persisted.artifactRevision.parentRunId,
          parentSha256: persisted.artifactRevision.parentSha256,
          reason: "omitted",
          parentFileName: "omitted",
        },
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
      artifactReview: view.artifactReview,
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
      failureSummary: {
        failedTaskIds: view.tasks.filter((task) => task.status === "failed").map((task) => task.id),
        blockedTaskIds: view.tasks.filter((task) => task.status === "blocked").map((task) => task.id),
        toolFailureCounts,
        terminalError: "omitted",
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
    await assertPrivateFileIfPresent(actualPath);
    const content = await readFile(actualPath);
    const sha256 = createHash("sha256").update(content).digest("hex");
    if (content.length !== record.bytes || sha256 !== record.sha256) {
      throw new Error("artifact content no longer matches its registered size and SHA-256");
    }
    return { record: { ...record, absolutePath: actualPath }, content };
  }

  async #prepareArtifactRevision(
    workspace: string,
    input: ArtifactContinuationRequest,
    expectedContract?: ArtifactRevisionContract,
  ): Promise<PreparedArtifactRevision> {
    const continuation = normalizeArtifactContinuation(input);
    const { record, content } = await this.#readVerifiedArtifact({
      workspace,
      runId: continuation.parentRunId,
      fileName: continuation.parentFileName,
    });
    if (record.sha256 !== continuation.parentSha256) {
      throw new Error("Artifact revision parent SHA-256 no longer matches the selected Artifact");
    }
    const parentRunRoot = resolve(
      workspace,
      ".localbuddy",
      "runs",
      continuation.parentRunId,
    );
    const parentRevision = await this.#requestStore.loadArtifactRevision(
      parentRunRoot,
      continuation.parentRunId,
    );
    const derived = createArtifactRevision(continuation, parentRevision);
    if (expectedContract !== undefined) {
      const expected = normalizeArtifactRevision(expectedContract);
      if (JSON.stringify(derived) !== JSON.stringify(expected)) {
        throw new Error("Artifact revision contract no longer matches its parent lineage");
      }
    }
    return {
      contract: derived,
      content,
      parentAbsolutePath: record.absolutePath,
      verifiedParentArtifact: artifactReviewCandidate(record, content),
    };
  }

  async #loadVerifiedRevisionParent(
    runRoot: string,
    request: PersistedRunRequest,
  ): Promise<ArtifactReviewCandidate | undefined> {
    const revision = request.artifactRevision;
    if (revision === undefined || !revision.parentFileName.toLowerCase().endsWith(".docx")) {
      return undefined;
    }
    const sourcePath = resolve(runRoot, revision.sourceRelativePath);
    await assertPrivateFileIfPresent(sourcePath);
    const content = await readFile(sourcePath);
    const sha256 = createHash("sha256").update(content).digest("hex");
    if (sha256 !== revision.parentSha256) {
      throw new Error("Artifact revision source no longer matches the verified parent SHA-256");
    }
    return artifactReviewCandidate({
      runId: revision.parentRunId,
      taskId: "integrate",
      agentId: "integrator",
      relativePath: revision.parentFileName,
      absolutePath: sourcePath,
      mediaType: DOCX_MEDIA_TYPE,
      bytes: content.length,
      sha256,
    }, content);
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
    return Promise.all(
      [...active, ...persisted.filter((run) => !activeIds.has(run.runId))]
        .map((run) => this.#withPersistentRunState(run)),
    );
  }

  async waitForIdle(): Promise<void> {
    await Promise.all([...this.#active.values()].map((active) => active.execution));
  }

  isIdle(): boolean {
    return this.#active.size === 0
      && this.#launching.size === 0
      && this.#mutatingIntegrations === 0;
  }

  async #mutateIntegration(
    workspaceInput: string,
    runId: string,
    operation: (manager: IntegrationManager, proposalPath: string) => Promise<void>,
  ): Promise<DesktopRunView> {
    this.#mutatingIntegrations += 1;
    try {
      validateRunId(runId);
      const workspace = await realpath(workspaceInput);
      const lease = await this.#workspaceLocks.acquire(workspace, "desktop-integration");
      try {
        const runRoot = await ensurePrivateRunRoot(workspace, runId);
        await hardenPrivateRunStorage(runRoot);
        const persistentStore = new JsonlEventStore(resolve(runRoot, "events.jsonl"));
        const events = [...await persistentStore.list(runId)];
        if (events.length === 0) {
          throw new Error(`Run history does not exist: ${runId}`);
        }
        const eventStore = new NotifyingEventStore(persistentStore, (event) => {
          events.push(event);
          const view = projectRun(runId, workspace, events);
          const active = this.#active.get(runId);
          const decorated = decorateRun(
            view,
            active?.approvalBroker?.list(),
            active?.planReviewBroker?.current,
          );
          if (active !== undefined) {
            active.events = events;
            active.view = decorated;
          }
          this.#emit(decorated);
        });
        await operation(
          new IntegrationManager({
            eventStore,
            executionCoordinator: this.#executionCoordinator,
          }),
          resolve(runRoot, "integration-proposal.json"),
        );
        return await this.#withPersistentRunState(projectRun(runId, workspace, events));
      } finally {
        await lease.release();
      }
    } finally {
      this.#mutatingIntegrations -= 1;
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
      const runRoot = await ensurePrivateDirectory(resolve(runsRoot, entry.name));
      await hardenPrivateRunStorage(runRoot);
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
          replayAvailable: persisted !== undefined
            && !(persisted.mode === "research" && persisted.sourceContract === "legacy-workspace"),
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
          goal: request.executionGoal,
        });
      }
      return await new ResearchCheckpointStore(resolve(runRoot, "checkpoint")).inspectResume({
        runId,
        workspace,
        goal: request.executionGoal,
        sourcePaths: request.sourcePaths,
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

  async #withRecoveryInspection(
    view: DesktopRunView,
  ): Promise<DesktopRunView> {
    if (view.status !== "failed" && view.status !== "interrupted") return view;
    const runRoot = resolve(view.workspace, ".localbuddy", "runs", view.runId);
    let inspection: DesktopResumeInspection;
    try {
      const persisted = await this.#requestStore.load(runRoot, view.workspace, view.runId);
      inspection = await this.#inspectCheckpoint(
        runRoot,
        view.workspace,
        view.runId,
        persisted,
      );
    } catch (error) {
      inspection = {
        available: false,
        completedTasks: 0,
        resumableTasks: 0,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    const checkpoint: DesktopCheckpointView = inspection.available
      ? {
          status: "available",
          completedTasks: inspection.completedTasks,
          resumableTasks: inspection.resumableTasks,
        }
      : {
          status: "blocked",
          completedTasks: inspection.completedTasks,
          resumableTasks: inspection.resumableTasks,
          reason: inspection.reason ?? "No safe checkpoint is available",
        };
    return { ...view, checkpoint };
  }

  async #withPersistentRunState(view: DesktopRunView): Promise<DesktopRunView> {
    const inspected = await this.#withRecoveryInspection(view);
    if (inspected.planReview !== undefined) return inspected;
    try {
      const record = await new PlanReviewStore(resolve(
        inspected.workspace,
        ".localbuddy",
        "runs",
        inspected.runId,
        "plan-review.json",
      )).load();
      return decorateRun(inspected, inspected.pendingApprovals, record);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return inspected;
      return {
        ...inspected,
        error: inspected.error
          ?? `Unable to read Plan Review state: ${error instanceof Error ? error.message : String(error)}`,
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
      const runRoot = await ensurePrivateDirectory(resolve(runsRoot, entry.name));
      await hardenPrivateRunStorage(runRoot);
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
        active.view = decorateRun(active.view, pending, active.planReviewBroker?.current);
        this.#emit(active.view);
      },
    });
  }

  #createPlanReviewBroker(
    runId: string,
    runRoot: string,
    request: PersistedRunRequest,
    eventStore: EventStore,
  ): InteractivePlanReviewBroker {
    const extensionCount = (request.extensions.skillIds?.length ?? 0)
      + (request.extensions.mcpServerIds?.length ?? 0)
      + (request.extensions.browser === undefined ? 0 : 1);
    return new InteractivePlanReviewBroker({
      runId,
      goalContract: request.goalContract,
      scope: {
        sourceCount: request.sourcePaths.length,
        trustProfile: request.trustProfile,
        extensionCount,
      },
      scopeIdentity: {
        mode: request.mode,
        sourcePaths: request.sourcePaths,
        provider: request.provider,
        trustProfile: request.trustProfile,
        extensions: request.extensions,
      },
      store: new PlanReviewStore(resolve(runRoot, "plan-review.json")),
      eventStore,
      onChange: (record) => {
        const active = this.#active.get(runId);
        if (active === undefined) return;
        active.view = decorateRun(active.view, active.approvalBroker?.list(), record);
        this.#emit(active.view);
      },
    });
  }
}

function decorateRun(
  view: DesktopRunView,
  pending: readonly PendingToolApproval[] | undefined,
  planReview?: PlanReviewRecord,
): DesktopRunView {
  const review = planReview ?? view.planReview;
  const plannedStatus = view.status === "cancelled" || review?.status === "rejected" || review?.status === "cancelled"
    ? "cancelled" as const
    : "queued" as const;
  const plannedTasks = review === undefined ? [] : [
    ...review.plan.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: plannedStatus,
    })),
    {
      id: "integrate",
      title: "Integrate worker results",
      status: plannedStatus,
    },
  ];
  const projectedById = new Map(view.tasks.map((task) => [task.id, task]));
  const tasks = [
    ...plannedTasks.map((task) => projectedById.get(task.id) ?? task),
    ...view.tasks.filter((task) => !plannedTasks.some((planned) => planned.id === task.id)),
  ];
  return {
    ...view,
    tasks,
    pendingApprovals: pending ?? [],
    planReview: planReview === undefined ? view.planReview : {
      status: planReview.status,
      approvalSha256: planReview.approvalSha256,
      goalContract: planReview.goalContract,
      plan: planReview.plan,
      scope: planReview.scope,
      requestedAt: planReview.requestedAt,
      resolvedAt: planReview.resolvedAt,
    },
  };
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

function artifactThreadRunTitle(run: DesktopRunView): string {
  return run.tasks.find((task) => task.id !== "integrate")?.title
    ?? run.tasks[0]?.title
    ?? run.runId;
}

function artifactReviewCandidate(
  record: ArtifactRecord,
  content: Buffer,
): ArtifactReviewCandidate | undefined {
  if (!record.relativePath.toLowerCase().endsWith(".docx")) return undefined;
  const inspection = inspectDocxArtifact(content);
  if (inspection.text.length > MAX_ARTIFACT_REVIEW_CHARACTERS) {
    throw new Error(
      `Artifact revision parent exceeds the ${MAX_ARTIFACT_REVIEW_CHARACTERS}-character semantic review limit`,
    );
  }
  return {
    fileName: record.relativePath,
    mediaType: DOCX_MEDIA_TYPE,
    text: inspection.text,
    bytes: content.length,
    sha256: record.sha256,
    structure: {
      paragraphCount: inspection.paragraphCount,
      sectionCount: inspection.sectionCount,
      tableCount: inspection.tableCount,
      tableRowCount: inspection.tableRowCount,
    },
  };
}

function validateStartRequest(request: StartDesktopRunRequest): void {
  if (request.workspace.trim().length === 0) {
    throw new Error("Workspace is required");
  }
  normalizeGoalContract({
    outcome: request.goal,
    constraints: request.goalConstraints,
    verificationCriteria: request.verificationCriteria,
  });
  if (!Number.isInteger(request.concurrency) || request.concurrency < 1 || request.concurrency > 3) {
    throw new Error("Concurrency must be an integer between 1 and 3");
  }
  if (request.mode !== undefined && request.mode !== "research" && request.mode !== "code") {
    throw new Error("Mode must be research or code");
  }
  normalizeProviderSelection(request.provider);
  normalizeTrustProfile(request.trustProfile);
  normalizeRunExtensions(request.extensions);
  if (request.sourcePaths !== undefined) {
    if (request.sourcePaths.length > 50
      || !request.sourcePaths.every((path) => typeof path === "string" && path.trim().length > 0)) {
      throw new Error("Research sources must contain at most 50 non-empty paths");
    }
  }
  if (request.artifactContinuation !== undefined) {
    normalizeArtifactContinuation(request.artifactContinuation);
    if ((request.mode ?? "research") !== "research") {
      throw new Error("Artifact revision currently requires Research mode");
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
