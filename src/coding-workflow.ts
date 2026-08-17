import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { AgentLoopExecutor } from "./agent-loop.js";
import type { ArtifactRecord, ArtifactRegistry } from "./artifacts.js";
import { JsonArtifactRegistry } from "./artifacts.js";
import { JsonCalculationRegistry } from "./calculations.js";
import type { AgentTaskCheckpoint } from "./checkpoint-store.js";
import {
  CodingCheckpointStore,
  type CodingResumeInspection,
} from "./coding-checkpoint-store.js";
import { CodingWorkflowPlanner, type CodingPlan } from "./coding-planner.js";
import { CodingSandboxApprovalPolicy, createCodingTools } from "./coding-tools.js";
import {
  summarizeRunFailure,
  type AgentDefinition,
  type RunDefinition,
  type RunSummary,
  type TaskExecutionContext,
  type TaskExecutor,
} from "./domain.js";
import type { EventStore } from "./event-store.js";
import { ExecutionCoordinator } from "./execution-coordinator.js";
import { createPlatformExecutionHost, type ExecutionHost } from "./execution-host.js";
import type { RunExtensionSelection } from "./extension-config.js";
import {
  extensionPlannerContext,
  prepareRunExtensions,
  type PreparedRunExtensions,
} from "./extension-runtime.js";
import {
  GitWorktreeManager,
  type GitWorktreeHandle,
} from "./git-worktree-manager.js";
import {
  IntegrationManager,
  integrationProposalEventData,
  loadPreparedIntegrationProposal,
  type IntegrationPatchInput,
  type IntegrationProposal,
  type IntegrationConflictResolver,
} from "./integration-manager.js";
import { AuditedModelClient } from "./model-runtime.js";
import type { ModelProvider } from "./provider.js";
import type { ProcessSharedCapacity } from "./process-shared-provider.js";
import {
  ensurePrivateDirectory,
  hardenPrivateFileIfPresent,
  writePrivateFileAtomic,
} from "./private-storage.js";
import type { OAuthRedirectHandler } from "./mcp-oauth.js";
import {
  PlanReviewEndedError,
  type PlanReviewHandler,
} from "./plan-review.js";
import {
  MultiAgentScheduler,
  type SchedulerResumeState,
  type SchedulerResumeTask,
} from "./scheduler.js";
import { ToolRegistry, ToolRuntime, type TrustProfile } from "./tool-runtime.js";
import { buildWorkspaceManifest } from "./workspace-manifest.js";
import { createWorkspaceTools } from "./workspace-tools.js";
import type { ToolApprovalHandler } from "./tool-approval.js";

export interface CodingWorkflowOptions {
  provider: ModelProvider;
  eventStore: EventStore;
  repoRoot: string;
  artifactRoot: string;
  artifactRegistry?: ArtifactRegistry;
  executionCoordinator?: ExecutionCoordinator;
  globalConcurrency?: number;
  maxWorkerTasks?: number;
  onTextDelta?: (taskId: string, delta: string) => void;
  recoveryOf?: string;
  runtimeOwner?: "desktop" | "cli" | "core";
  checkpointRoot?: string;
  onCheckpoint?: (checkpoint: AgentTaskCheckpoint) => void | Promise<void>;
  extensions?: RunExtensionSelection;
  providerId?: string;
  extensionApprovalHandler?: ToolApprovalHandler;
  executionHost?: ExecutionHost;
  processTaskCapacity?: ProcessSharedCapacity;
  oauthRedirectHandler?: OAuthRedirectHandler;
  trustProfile?: TrustProfile;
  planReview?: PlanReviewHandler;
}

export interface CodingWorkflowResult {
  summary: RunSummary;
  artifacts: readonly ArtifactRecord[];
  worktrees: readonly GitWorktreeHandle[];
  integration?: IntegrationProposal;
}

export class CodingWorkflow {
  readonly #options: CodingWorkflowOptions;

  constructor(options: CodingWorkflowOptions) {
    this.#options = options;
  }

  async run(runId: string, goal: string, signal?: AbortSignal): Promise<CodingWorkflowResult> {
    return this.#execute(runId, goal, false, signal);
  }

  async resume(runId: string, goal: string, signal?: AbortSignal): Promise<CodingWorkflowResult> {
    return this.#execute(runId, goal, true, signal);
  }

  async #execute(
    runId: string,
    goal: string,
    resume: boolean,
    signal?: AbortSignal,
  ): Promise<CodingWorkflowResult> {
    const eventStore = this.#options.eventStore;
    let lifecycleStarted = false;
    const worktrees: GitWorktreeHandle[] = [];
    let extensions: PreparedRunExtensions | undefined;

    try {
      if (!resume) {
        await eventStore.append({
          type: "run.started",
          runId,
          data: {
            mode: "code",
            recoveryOf: this.#options.recoveryOf,
            runtimeOwner: this.#options.runtimeOwner ?? "core",
            providerId: this.#options.providerId ?? "unknown",
            trustProfile: this.#options.trustProfile ?? "balanced",
          },
        });
        lifecycleStarted = true;
      }
      const repoRoot = await realpath(this.#options.repoRoot);
      const artifactRootInput = resolve(this.#options.artifactRoot);
      await ensurePrivateDirectory(artifactRootInput);
      const artifactRoot = await realpath(artifactRootInput);
      const checkpointRoot = resolve(
        this.#options.checkpointRoot ?? resolve(dirname(artifactRoot), "checkpoint"),
      );
      const checkpointStore = new CodingCheckpointStore(checkpointRoot);
      const executionHost = this.#options.executionHost ?? createExecutionHost(
        eventStore,
        resolve(checkpointRoot, "execution-tmp"),
      );
      const artifactRegistry = this.#options.artifactRegistry
        ?? new JsonArtifactRegistry(resolve(checkpointRoot, "artifacts.json"));
      const executionCoordinator = this.#options.executionCoordinator
        ?? new ExecutionCoordinator(this.#options.globalConcurrency ?? 3);
      const calculationRegistry = new JsonCalculationRegistry(
        resolve(checkpointRoot, "calculations.json"),
      );
      extensions = await prepareRunExtensions({
        workspace: repoRoot,
        checkpointRoot,
        selection: this.#options.extensions,
        approvalHandler: this.#options.extensionApprovalHandler,
        oauthRedirectHandler: this.#options.oauthRedirectHandler,
        trustProfile: this.#options.trustProfile,
      });
      if (!resume && hasEnabledExtensions(extensions)) {
        await eventStore.append({ type: "extensions.loaded", runId, data: { ...extensions.metadata } });
      }
      const modelClient = new AuditedModelClient(this.#options.provider, eventStore);
      const worktreeManager = new GitWorktreeManager();
      let plan: CodingPlan;
      let baselineHead: string;
      let resumeInspection: CodingResumeInspection | undefined;
      if (resume) {
        const inspection = await checkpointStore.inspectResume({ runId, repoRoot, goal });
        if (!inspection.available || inspection.manifest === undefined) {
          throw new CodingResumeBlockedError(inspection.reason ?? "Coding checkpoint is unavailable");
        }
        resumeInspection = inspection;
        plan = inspection.manifest.plan;
        baselineHead = inspection.manifest.baselineHead;
      } else {
        const primary = await worktreeManager.validatePrimary(repoRoot);
        baselineHead = primary.headSha;
        const planner = new CodingWorkflowPlanner(
          modelClient,
          eventStore,
          this.#options.maxWorkerTasks ?? 3,
        );
        plan = await planner.plan(
          runId,
          goal,
          await buildWorkspaceManifest(repoRoot),
          signal,
          extensionPlannerContext(extensions),
        );
        await checkpointStore.initialize({ runId, repoRoot, goal, baselineHead, plan });
        await eventStore.append({
          type: "checkpoint.created",
          runId,
          data: { mode: "code", baselineHead },
        });
      }
      await this.#options.planReview?.({
        mode: "code",
        tasks: plan.tasks.map((task) => ({ ...task })),
        integration: {
          ...plan.integration,
          verificationCommands: plan.integration.verificationCommands,
        },
      }, signal);
      for (const task of plan.tasks) {
        const restored = await worktreeManager.restoreOrCreate(
          repoRoot,
          runId,
          task.id,
          baselineHead,
        );
        const handle = restored.handle;
        worktrees.push(handle);
        await checkpointStore.recordWorktree(handle);
        await eventStore.append({
          type: "workspace.created",
          runId,
          taskId: task.id,
          data: {
            worktreePath: handle.worktreePath,
            headSha: handle.headSha,
            restored: restored.restored,
          },
        });
      }

      const workerExecutors = new Map<string, AgentLoopExecutor>();
      for (const task of plan.tasks) {
        const handle = requireHandle(worktrees, task.id);
        const workspaceTools = await createWorkspaceTools({
          workspaceRoot: handle.worktreePath,
          artifactRoot,
          artifactRegistry,
          calculationRegistry,
          eventStore,
        });
        const tools = [
          ...workspaceTools,
          ...await createCodingTools(handle.worktreePath, task.ownedPaths, {
            host: executionHost,
            readRoots: [repoRoot],
          }),
          ...(extensions?.tools ?? []),
        ];
        workerExecutors.set(task.id, new AgentLoopExecutor({
          modelClient,
          toolRuntime: new ToolRuntime(
            new ToolRegistry(tools),
            extensions?.approvalPolicy(new CodingSandboxApprovalPolicy({
              profile: this.#options.trustProfile,
              approvalHandler: this.#options.extensionApprovalHandler,
            })) ?? new CodingSandboxApprovalPolicy({
              profile: this.#options.trustProfile,
              approvalHandler: this.#options.extensionApprovalHandler,
            }),
            eventStore,
            checkpointStore.toolJournal(),
          ),
          onTextDelta: this.#options.onTextDelta,
          maxTurns: 12,
          checkpointStore,
          onCheckpoint: this.#options.onCheckpoint,
        }));
      }
      const integrationTools = await createWorkspaceTools({
        workspaceRoot: repoRoot,
        artifactRoot,
        artifactRegistry,
        calculationRegistry,
        eventStore,
      });
      const integrationExecutor = new AgentLoopExecutor({
        modelClient,
        toolRuntime: new ToolRuntime(
          new ToolRegistry([...integrationTools, ...(extensions?.tools ?? [])]),
          extensions?.approvalPolicy(new CodingSandboxApprovalPolicy({
            profile: this.#options.trustProfile,
            approvalHandler: this.#options.extensionApprovalHandler,
          })) ?? new CodingSandboxApprovalPolicy({
            profile: this.#options.trustProfile,
            approvalHandler: this.#options.extensionApprovalHandler,
          }),
          eventStore,
          checkpointStore.toolJournal(),
        ),
        onTextDelta: this.#options.onTextDelta,
        checkpointStore,
        onCheckpoint: this.#options.onCheckpoint,
      });
      const executor = new CodingTaskExecutor({
        workerExecutors,
        integrationExecutor,
        worktreeManager,
        worktrees,
        artifactRoot,
        artifactRegistry,
        eventStore,
        checkpointStore,
        integrationFileName: plan.integration.fileName,
        ownedPathsByTask: new Map(plan.tasks.map((task) => [task.id, task.ownedPaths])),
      });
      const scheduler = new MultiAgentScheduler({
        eventStore,
        globalConcurrency: this.#options.globalConcurrency ?? 3,
        executionCoordinator,
        manageRunLifecycle: false,
        processCapacity: this.#options.processTaskCapacity,
      });
      const definition = compileCodingPlan(
        runId,
        goal,
        repoRoot,
        artifactRoot,
        plan,
        worktrees,
        extensions,
      );
      let resumeState: SchedulerResumeState | undefined;
      if (resume) {
        const restoredResults = new Map(
          (await checkpointStore.listTaskResults()).map((result) => [result.taskId, result]),
        );
        const tasks = new Map<string, SchedulerResumeTask>();
        for (const task of definition.tasks) {
          const agent = definition.agents.find((candidate) => candidate.id === task.agentId);
          if (agent === undefined) {
            throw new Error(`Coding checkpoint Task has no fixed Agent: ${task.id}`);
          }
          const agentCheckpoint = await executor.validateAgentCheckpoint(runId, task, agent);
          const result = restoredResults.get(task.id);
          if (result !== undefined) {
            if (result.agentId !== agent.id || agentCheckpoint?.phase !== "succeeded") {
              throw new Error(`completed Coding Task contract changed for ${task.id}`);
            }
            tasks.set(task.id, { status: "succeeded", agentId: agent.id, output: result.output });
          } else {
            tasks.set(task.id, { status: "queued", agentId: agent.id });
          }
        }
        resumeState = { tasks };
        await eventStore.append({
          type: "run.resumed",
          runId,
          data: {
            mode: "code",
            completedTasks: resumeInspection?.completedTasks ?? 0,
            resumableTasks: resumeInspection?.resumableTasks ?? 0,
          },
        });
        lifecycleStarted = true;
        if (extensions !== undefined && hasEnabledExtensions(extensions)) {
          await eventStore.append({ type: "extensions.loaded", runId, data: { ...extensions.metadata } });
        }
      }
      const summary = await scheduler.run(definition, executor, signal, resumeState);
      let integration: IntegrationProposal | undefined;
      if (summary.status === "succeeded") {
        const patchArtifacts = (await artifactRegistry.list(runId)).filter(
          (artifact) => artifact.mediaType === "text/x-diff" && artifact.taskId !== "integration-preview",
        );
        const patches: IntegrationPatchInput[] = patchArtifacts.map((artifact) => ({
          taskId: artifact.taskId,
          absolutePath: artifact.absolutePath,
          sha256: artifact.sha256,
        }));
        const proposalPath = resolve(dirname(artifactRoot), "integration-proposal.json");
        integration = await loadPreparedIfPresent({
          proposalPath,
          expectedRepoRoot: repoRoot,
          runId,
          baselineHead,
          patches,
          verificationCommands: plan.integration.verificationCommands,
        });
        if (integration !== undefined) {
          await eventStore.append({
            type: "checkpoint.restored",
            runId,
            taskId: "integration-preview",
            data: { status: integration.status },
          });
          await eventStore.append({
            type: integration.status === "awaiting_approval"
              ? "integration.awaiting_approval"
              : "integration.preflight_failed",
            runId,
            data: integration.status === "awaiting_approval"
              ? { ...integrationProposalEventData(integration), restored: true }
              : { error: integration.error, restored: true },
          });
        } else {
          const attempt = await checkpointStore.beginPreflightAttempt();
          integration = await new IntegrationManager({
            eventStore,
            executionCoordinator,
            executionHost,
          }).prepare({
            runId,
            repoRoot,
            artifactRoot,
            patches,
            verificationCommands: plan.integration.verificationCommands,
            artifactRegistry,
            previewTaskId: attempt === 1 ? "integration-preview" : `integration-preview-${attempt}`,
            signal,
            conflictResolver: createMergeConflictResolver({
              modelClient,
              eventStore,
              executionHost,
              artifactRoot,
              artifactRegistry,
              calculationRegistry,
              trustProfile: this.#options.trustProfile,
              approvalHandler: this.#options.extensionApprovalHandler,
            }),
          });
        }
      }
      const failure = summarizeRunFailure(summary);
      await eventStore.append({
        type: summary.status === "succeeded"
          ? "run.succeeded"
          : summary.status === "cancelled"
            ? "run.cancelled"
            : "run.failed",
        runId,
        data: failure === undefined ? undefined : { error: failure },
      });
      return {
        summary,
        artifacts: await artifactRegistry.list(runId),
        worktrees,
        integration,
      };
    } catch (error) {
      if (lifecycleStarted) {
        await eventStore.append({
          type: signal?.aborted === true || error instanceof PlanReviewEndedError
            ? "run.cancelled"
            : "run.failed",
          runId,
          data: { error: error instanceof Error ? error.message : String(error) },
        });
      } else if (resume && error instanceof PlanReviewEndedError) {
        await eventStore.append({
          type: "run.cancelled",
          runId,
          data: { error: error.message, mode: "code" },
        });
      } else if (resume) {
        await eventStore.append({
          type: "checkpoint.resume_blocked",
          runId,
          data: { reason: error instanceof Error ? error.message : String(error), mode: "code" },
        });
      }
      throw error;
    } finally {
      if (extensions !== undefined) {
        try {
          await extensions.close();
        } catch (error) {
          if (lifecycleStarted) {
            await eventStore.append({
              type: "extensions.close_failed",
              runId,
              data: { error: error instanceof Error ? error.message : String(error) },
            }).catch(() => undefined);
          }
        }
      }
    }
  }
}

function createExecutionHost(eventStore: EventStore, temporaryRoot: string): ExecutionHost {
  return createPlatformExecutionHost({ eventStore, temporaryRoot, environment: process.env });
}

function createMergeConflictResolver(input: {
  modelClient: AuditedModelClient;
  eventStore: EventStore;
  executionHost: ExecutionHost;
  artifactRoot: string;
  artifactRegistry: ArtifactRegistry;
  calculationRegistry: JsonCalculationRegistry;
  trustProfile?: TrustProfile;
  approvalHandler?: ToolApprovalHandler;
}): IntegrationConflictResolver {
  return {
    async resolve(conflict) {
      const workspaceTools = await createWorkspaceTools({
        workspaceRoot: conflict.worktreePath,
        artifactRoot: input.artifactRoot,
        artifactRegistry: input.artifactRegistry,
        calculationRegistry: input.calculationRegistry,
        eventStore: input.eventStore,
      });
      const codingTools = await createCodingTools(
        conflict.worktreePath,
        conflict.conflictPaths,
        { host: input.executionHost, readRoots: [conflict.repoRoot] },
      );
      const agent: AgentDefinition = {
        id: `merge-agent-${conflict.taskId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`,
        role: "merge-agent",
        instructions: [
          "You are the LocalBuddy Merge Agent in an isolated integration-preview worktree.",
          "Read every conflicted file and remove all Git conflict markers.",
          "Preserve the compatible intent of both patches; do not edit any path outside Conflict paths.",
          "Use replace_text only. Never claim the resolution is approved or applied to the primary workspace.",
        ].join("\n"),
        capabilities: ["merge"],
        maxParallelTasks: 1,
      };
      const task = {
        id: conflict.taskId,
        title: `Resolve patch conflict from ${conflict.patch.taskId}`,
        input: {
          instructions: [
            `Patch task: ${conflict.patch.taskId}`,
            `Conflict paths: ${conflict.conflictPaths.join(", ")}`,
            "Inspect each path, resolve the conflict markers with the smallest coherent combined edit, then return a concise explanation.",
          ].join("\n\n"),
          availableTools: ["list_files", "read_file", "replace_text"],
        },
        agentId: agent.id,
        requiredCapabilities: ["merge"],
        workspace: {
          resourceId: conflict.repoRoot,
          access: "write" as const,
          isolationKey: conflict.worktreePath,
        },
      };
      await input.eventStore.append({
        type: "task.started",
        runId: conflict.runId,
        taskId: task.id,
        agentId: agent.id,
        data: { mergeConflict: true, conflictPaths: conflict.conflictPaths },
      });
      try {
        await new AgentLoopExecutor({
          modelClient: input.modelClient,
          toolRuntime: new ToolRuntime(
            new ToolRegistry([...workspaceTools, ...codingTools]),
            new CodingSandboxApprovalPolicy({
              profile: input.trustProfile,
              approvalHandler: input.approvalHandler,
            }),
            input.eventStore,
          ),
          maxTurns: 12,
        }).execute({
          runId: conflict.runId,
          task,
          agent,
          dependencyOutputs: new Map(),
          signal: conflict.signal,
        });
        await input.eventStore.append({
          type: "task.succeeded",
          runId: conflict.runId,
          taskId: task.id,
          agentId: agent.id,
          data: { mergeConflict: true },
        });
      } catch (error) {
        await input.eventStore.append({
          type: "task.failed",
          runId: conflict.runId,
          taskId: task.id,
          agentId: agent.id,
          data: {
            mergeConflict: true,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
    },
  };
}

class CodingResumeBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodingResumeBlockedError";
  }
}

interface CodingTaskExecutorOptions {
  workerExecutors: ReadonlyMap<string, AgentLoopExecutor>;
  integrationExecutor: AgentLoopExecutor;
  worktreeManager: GitWorktreeManager;
  worktrees: readonly GitWorktreeHandle[];
  artifactRoot: string;
  artifactRegistry: ArtifactRegistry;
  eventStore: EventStore;
  checkpointStore: CodingCheckpointStore;
  integrationFileName: string;
  ownedPathsByTask: ReadonlyMap<string, readonly string[]>;
}

class CodingTaskExecutor implements TaskExecutor {
  readonly #options: CodingTaskExecutorOptions;

  constructor(options: CodingTaskExecutorOptions) {
    this.#options = options;
  }

  async execute(context: TaskExecutionContext): Promise<unknown> {
    if (context.task.id === "integrate") {
      const output = await this.#options.integrationExecutor.execute(context);
      await this.#options.checkpointStore.saveTaskResult({
        kind: "integrator",
        runId: context.runId,
        taskId: "integrate",
        agentId: context.agent.id,
        output,
        artifactRelativePath: this.#options.integrationFileName,
      });
      return output;
    }
    const executor = this.#options.workerExecutors.get(context.task.id);
    if (executor === undefined) {
      throw new Error(`Missing coding executor for ${context.task.id}`);
    }
    const workerSummary = await executor.execute(context);
    const handle = requireHandle(this.#options.worktrees, context.task.id);
    const diff = await this.#options.worktreeManager.captureDiff(handle);
    if (diff.clean || diff.patch.trim().length === 0) {
      throw new Error(`Coding task ${context.task.id} completed without producing a patch`);
    }
    const ownedPaths = this.#options.ownedPathsByTask.get(context.task.id);
    if (ownedPaths === undefined) throw new Error(`Coding task ownership is missing: ${context.task.id}`);
    assertChangedPathsOwned(context.task.id, diff.changedPaths, ownedPaths);
    const patchArtifact = await writePatchArtifact({
      runId: context.runId,
      taskId: context.task.id,
      agentId: context.agent.id,
      patch: diff.patch,
      artifactRoot: this.#options.artifactRoot,
      artifactRegistry: this.#options.artifactRegistry,
      eventStore: this.#options.eventStore,
    });
    await this.#options.eventStore.append({
      type: "workspace.diff_captured",
      runId: context.runId,
      taskId: context.task.id,
      agentId: context.agent.id,
      data: { fileName: patchArtifact.relativePath, status: diff.status },
    });
    const output = {
      workerSummary,
      baselineHead: handle.headSha,
      patchArtifact: patchArtifact.relativePath,
      worktreePath: handle.worktreePath,
      status: diff.status,
      mergedIntoPrimary: false,
    };
    await this.#options.checkpointStore.saveTaskResult({
      kind: "worker",
      runId: context.runId,
      taskId: context.task.id,
      agentId: context.agent.id,
      output,
      worktree: handle,
      patch: patchArtifact,
      worktreeStatus: diff.status,
    });
    return output;
  }

  validateAgentCheckpoint(
    runId: string,
    task: TaskExecutionContext["task"],
    agent: TaskExecutionContext["agent"],
  ): Promise<AgentTaskCheckpoint | undefined> {
    const executor = task.id === "integrate"
      ? this.#options.integrationExecutor
      : this.#options.workerExecutors.get(task.id);
    if (executor === undefined) {
      throw new Error(`Missing Coding Agent executor for ${task.id}`);
    }
    return executor.validateCheckpoint(runId, task, agent);
  }
}

function assertChangedPathsOwned(
  taskId: string,
  changedPaths: readonly string[],
  ownedPaths: readonly string[],
): void {
  const normalizedOwners = ownedPaths.map((path) => path.replaceAll("\\", "/").replace(/^\.\//, ""));
  const unauthorized = changedPaths.filter((path) => !normalizedOwners.some((owner) =>
    owner.endsWith("/") ? path.startsWith(owner) : path === owner));
  if (unauthorized.length > 0) {
    throw new Error(
      `Coding task ${taskId} changed paths outside its ownership: ${unauthorized.join(", ")}`,
    );
  }
}

function compileCodingPlan(
  runId: string,
  goal: string,
  repoRoot: string,
  artifactRoot: string,
  plan: CodingPlan,
  worktrees: readonly GitWorktreeHandle[],
  extensions?: PreparedRunExtensions,
): RunDefinition {
  const skillInstructions = extensions?.systemInstructions("code") ?? "";
  const extensionTools = unique(extensions?.toolNames ?? []);
  const workers: AgentDefinition[] = plan.tasks.map((task, index) => ({
    id: `code-worker-${index + 1}`,
    role: "code-worker",
    instructions: [
      "You are a LocalBuddy code worker operating inside a detached Git worktree.",
      "Read before editing. Make only the smallest change required by the task.",
      "Write only through replace_text or create_file and only inside the assigned owned paths.",
      "Run git_diff_check and the most relevant allowlisted project check before finishing.",
      "Never claim the patch was merged, committed, or applied to the primary checkout.",
      skillInstructions,
    ].join("\n"),
    capabilities: ["code"],
    maxParallelTasks: 1,
  }));
  const workerTasks = plan.tasks.map((task, index) => {
    const handle = requireHandle(worktrees, task.id);
    return {
      id: task.id,
      title: task.title,
      input: {
        instructions: [
          task.instructions,
          `Overall goal: ${goal}`,
          `Owned paths: ${task.ownedPaths.join(", ")}`,
          "Produce a non-empty patch. The controller will capture it after your final response.",
        ].join("\n\n"),
        availableTools: [
          "list_files",
          "read_file",
          "replace_text",
          "create_file",
          "run_check",
          ...extensionTools,
        ],
      },
      agentId: workers[index]?.id,
      requiredCapabilities: ["code"],
      workspace: {
        resourceId: repoRoot,
        access: "write" as const,
        isolationKey: handle.worktreePath,
      },
    };
  });
  return {
    id: runId,
    goal,
    agents: [
      ...workers,
      {
        id: "integrator",
        role: "integrator",
        instructions: [
          "You summarize isolated code-worker results truthfully.",
          "A saved patch is not a merged patch. Clearly state that the primary checkout is unchanged.",
          "Report each worktree, patch artifact, verification result, and unresolved risk.",
          skillInstructions,
        ].join("\n"),
        capabilities: ["integrate"],
        maxParallelTasks: 1,
      },
    ],
    tasks: [
      ...workerTasks,
      {
        id: "integrate",
        title: "Summarize isolated coding patches",
        input: {
          instructions: [
            plan.integration.instructions,
            `Write the complete summary using write_artifact with fileName ${plan.integration.fileName}.`,
            "Use calculationIds: []. Do not say any patch is merged or committed.",
            "After the tool succeeds, return a short completion summary.",
          ].join("\n"),
          availableTools: unique(["write_artifact", ...extensionTools]),
        },
        dependsOn: workerTasks.map((task) => task.id),
        agentId: "integrator",
        requiredCapabilities: ["integrate"],
        workspace: {
          resourceId: artifactRoot,
          access: "write" as const,
          isolationKey: runId,
        },
      },
    ],
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function hasEnabledExtensions(extensions: PreparedRunExtensions): boolean {
  return extensions.metadata.skillIds.length > 0
    || extensions.metadata.mcpServerIds.length > 0
    || extensions.metadata.browserOrigins.length > 0;
}

async function writePatchArtifact(input: {
  runId: string;
  taskId: string;
  agentId: string;
  patch: string;
  artifactRoot: string;
  artifactRegistry: ArtifactRegistry;
  eventStore: EventStore;
}): Promise<ArtifactRecord> {
  const relativePath = `patches/${input.taskId}.patch`;
  const outputPath = resolve(input.artifactRoot, relativePath);
  await ensurePrivateDirectory(dirname(outputPath));
  const patchSha256 = createHash("sha256").update(input.patch).digest("hex");
  try {
    await hardenPrivateFileIfPresent(outputPath);
    const existing = await readFile(outputPath, "utf8");
    if (createHash("sha256").update(existing).digest("hex") !== patchSha256) {
      throw new Error(`existing patch Artifact conflicts with recovered Task ${input.taskId}`);
    }
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) {
      throw error;
    }
    await writePrivateFileAtomic(outputPath, input.patch);
  }
  const record: ArtifactRecord = {
    runId: input.runId,
    taskId: input.taskId,
    agentId: input.agentId,
    relativePath,
    absolutePath: outputPath,
    mediaType: "text/x-diff",
    bytes: Buffer.byteLength(input.patch),
    sha256: patchSha256,
  };
  await input.artifactRegistry.add(record);
  await input.eventStore.append({
    type: "artifact.created",
    runId: input.runId,
    taskId: input.taskId,
    agentId: input.agentId,
    data: { fileName: relativePath, bytes: record.bytes, sha256: record.sha256 },
  });
  return record;
}

async function loadPreparedIfPresent(
  input: Parameters<typeof loadPreparedIntegrationProposal>[0],
): Promise<IntegrationProposal | undefined> {
  try {
    return await loadPreparedIntegrationProposal(input);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function requireHandle(
  worktrees: readonly GitWorktreeHandle[],
  taskId: string,
): GitWorktreeHandle {
  const handle = worktrees.find((candidate) => candidate.taskId === taskId);
  if (handle === undefined) {
    throw new Error(`Missing worktree for task ${taskId}`);
  }
  return handle;
}
