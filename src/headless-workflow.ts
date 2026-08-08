import { mkdir, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { AgentLoopExecutor } from "./agent-loop.js";
import type { ArtifactRecord, ArtifactRegistry } from "./artifacts.js";
import { JsonArtifactRegistry } from "./artifacts.js";
import type { AgentTaskCheckpoint, ResumeInspection } from "./checkpoint-store.js";
import { ResearchCheckpointStore } from "./checkpoint-store.js";
import { JsonCalculationRegistry } from "./calculations.js";
import type { AgentDefinition, RunDefinition, RunSummary } from "./domain.js";
import type { EventStore } from "./event-store.js";
import type { ExecutionCoordinator } from "./execution-coordinator.js";
import type { RunExtensionSelection } from "./extension-config.js";
import {
  extensionPlannerContext,
  prepareRunExtensions,
  type PreparedRunExtensions,
} from "./extension-runtime.js";
import { AuditedModelClient } from "./model-runtime.js";
import { createNumericTools } from "./numeric-tools.js";
import type { ModelProvider } from "./provider.js";
import type { ProcessSharedCapacity } from "./process-shared-provider.js";
import type { OAuthRedirectHandler } from "./mcp-oauth.js";
import { WorkflowPlanner } from "./planner.js";
import {
  MultiAgentScheduler,
  type SchedulerResumeState,
  type SchedulerResumeTask,
} from "./scheduler.js";
import { RoleBasedApprovalPolicy, ToolRegistry, ToolRuntime } from "./tool-runtime.js";
import { createWorkspaceTools } from "./workspace-tools.js";
import { buildWorkspaceSnapshot } from "./workspace-manifest.js";
import type { ToolApprovalHandler } from "./tool-approval.js";

export interface HeadlessWorkflowOptions {
  provider: ModelProvider;
  eventStore: EventStore;
  workspaceRoot: string;
  artifactRoot: string;
  artifactRegistry?: ArtifactRegistry;
  globalConcurrency?: number;
  executionCoordinator?: ExecutionCoordinator;
  maxWorkerTasks?: number;
  onTextDelta?: (taskId: string, delta: string) => void;
  recoveryOf?: string;
  runtimeOwner?: "desktop" | "cli" | "core";
  checkpointRoot?: string;
  onCheckpoint?: (checkpoint: AgentTaskCheckpoint) => void | Promise<void>;
  extensions?: RunExtensionSelection;
  providerId?: string;
  extensionApprovalHandler?: ToolApprovalHandler;
  processTaskCapacity?: ProcessSharedCapacity;
  oauthRedirectHandler?: OAuthRedirectHandler;
}

export interface HeadlessWorkflowResult {
  summary: RunSummary;
  artifacts: readonly ArtifactRecord[];
}

export class HeadlessWorkflow {
  readonly #options: HeadlessWorkflowOptions;

  constructor(options: HeadlessWorkflowOptions) {
    this.#options = options;
  }

  async run(runId: string, goal: string, signal?: AbortSignal): Promise<HeadlessWorkflowResult> {
    return this.#execute(runId, goal, false, signal);
  }

  async resume(
    runId: string,
    goal: string,
    signal?: AbortSignal,
  ): Promise<HeadlessWorkflowResult> {
    return this.#execute(runId, goal, true, signal);
  }

  async #execute(
    runId: string,
    goal: string,
    resume: boolean,
    signal?: AbortSignal,
  ): Promise<HeadlessWorkflowResult> {
    const eventStore = this.#options.eventStore;
    let lifecycleStarted = false;
    let extensions: PreparedRunExtensions | undefined;

    try {
      const workspaceRoot = await realpath(this.#options.workspaceRoot);
      const artifactRootInput = resolve(this.#options.artifactRoot);
      await mkdir(artifactRootInput, { recursive: true });
      const artifactRoot = await realpath(artifactRootInput);
      const checkpointRoot = resolve(
        this.#options.checkpointRoot ?? resolve(dirname(artifactRoot), "checkpoint"),
      );
      const checkpointStore = new ResearchCheckpointStore(checkpointRoot);
      const snapshot = await buildWorkspaceSnapshot(workspaceRoot);
      const artifactRegistry = this.#options.artifactRegistry
        ?? new JsonArtifactRegistry(resolve(checkpointRoot, "artifacts.json"));
      const calculationRegistry = new JsonCalculationRegistry(
        resolve(checkpointRoot, "calculations.json"),
      );
      if (!resume) {
        await eventStore.append({
          type: "run.started",
          runId,
          data: {
            mode: "research",
            recoveryOf: this.#options.recoveryOf,
            runtimeOwner: this.#options.runtimeOwner ?? "core",
            providerId: this.#options.providerId ?? "unknown",
          },
        });
        lifecycleStarted = true;
      }
      extensions = await prepareRunExtensions({
        workspace: workspaceRoot,
        checkpointRoot,
        selection: this.#options.extensions,
        approvalHandler: this.#options.extensionApprovalHandler,
        oauthRedirectHandler: this.#options.oauthRedirectHandler,
      });
      if (!resume && hasEnabledExtensions(extensions)) {
        await eventStore.append({ type: "extensions.loaded", runId, data: { ...extensions.metadata } });
      }
      const modelClient = new AuditedModelClient(this.#options.provider, eventStore);
      let plan;
      let restoredCheckpoints: ReadonlyMap<string, AgentTaskCheckpoint> | undefined;
      let resumeInspection: ResumeInspection | undefined;
      if (resume) {
        const inspection = await checkpointStore.inspectResume({
          runId,
          workspace: workspaceRoot,
          goal,
          snapshot,
        });
        if (!inspection.available || inspection.manifest === undefined) {
          throw new ResumeBlockedError(inspection.reason ?? "checkpoint is unavailable");
        }
        resumeInspection = inspection;
        plan = inspection.manifest.plan;
        restoredCheckpoints = new Map(
          (await checkpointStore.listTasks()).map((checkpoint) => [checkpoint.taskId, checkpoint]),
        );
      } else {
        const planner = new WorkflowPlanner(
          modelClient,
          eventStore,
          this.#options.maxWorkerTasks ?? 3,
        );
        plan = await planner.plan(
          runId,
          goal,
          snapshot.manifest,
          signal,
          extensionPlannerContext(extensions),
        );
        await checkpointStore.initialize({
          runId,
          workspace: workspaceRoot,
          goal,
          snapshot,
          plan,
        });
        await eventStore.append({
          type: "checkpoint.created",
          runId,
          data: {
            mode: "research",
            workspaceSha256: snapshot.sha256,
            workspaceComplete: snapshot.complete,
          },
        });
      }
      const tools = await createWorkspaceTools({
        workspaceRoot,
        artifactRoot,
        artifactRegistry,
        calculationRegistry,
        eventStore,
      });
      const allTools = [
        ...tools,
        ...createNumericTools(calculationRegistry),
        ...(extensions?.tools ?? []),
      ];
      const toolRuntime = new ToolRuntime(
        new ToolRegistry(allTools),
        extensions?.approvalPolicy(new RoleBasedApprovalPolicy()) ?? new RoleBasedApprovalPolicy(),
        eventStore,
        checkpointStore.toolJournal(),
      );
      const executor = new AgentLoopExecutor({
        modelClient,
        toolRuntime,
        onTextDelta: this.#options.onTextDelta,
        checkpointStore,
        onCheckpoint: this.#options.onCheckpoint,
      });
      const definition = compilePlan(runId, goal, workspaceRoot, plan, extensions);
      let resumeState: SchedulerResumeState | undefined;
      if (restoredCheckpoints !== undefined) {
        const tasks = new Map<string, SchedulerResumeTask>();
        for (const task of definition.tasks) {
          const checkpoint = restoredCheckpoints.get(task.id);
          if (checkpoint === undefined) {
            tasks.set(task.id, { status: "queued" });
            continue;
          }
          const agent = definition.agents.find((candidate) => candidate.id === checkpoint.agentId);
          if (
            agent === undefined
            || (task.agentId !== undefined && task.agentId !== agent.id)
            || !(task.requiredCapabilities ?? []).every((capability) =>
              agent.capabilities.includes(capability))
          ) {
            throw new Error(`checkpoint agent is incompatible with task ${task.id}`);
          }
          const validated = await executor.validateCheckpoint(runId, task, agent);
          if (validated === undefined) {
            throw new Error(`task checkpoint disappeared during restore: ${task.id}`);
          }
          tasks.set(task.id, validated.phase === "succeeded"
            ? {
                status: "succeeded",
                agentId: validated.agentId,
                output: validated.output,
              }
            : {
                status: "queued",
                agentId: validated.agentId,
              });
        }
        resumeState = { tasks };
      }
      if (resume) {
        await eventStore.append({
          type: "run.resumed",
          runId,
          data: {
            mode: "research",
            completedTasks: resumeInspection?.completedTasks ?? 0,
            resumableTasks: resumeInspection?.resumableTasks ?? 0,
          },
        });
        lifecycleStarted = true;
        if (extensions !== undefined && hasEnabledExtensions(extensions)) {
          await eventStore.append({ type: "extensions.loaded", runId, data: { ...extensions.metadata } });
        }
      }
      const scheduler = new MultiAgentScheduler({
        eventStore,
        globalConcurrency: this.#options.globalConcurrency ?? 3,
        executionCoordinator: this.#options.executionCoordinator,
        manageRunLifecycle: false,
        processCapacity: this.#options.processTaskCapacity,
      });
      const summary = await scheduler.run(definition, executor, signal, resumeState);
      await eventStore.append({
        type: summary.status === "succeeded"
          ? "run.succeeded"
          : summary.status === "cancelled"
            ? "run.cancelled"
            : "run.failed",
        runId,
      });
      return { summary, artifacts: await artifactRegistry.list(runId) };
    } catch (error) {
      if (lifecycleStarted) {
        await eventStore.append({
          type: signal?.aborted === true ? "run.cancelled" : "run.failed",
          runId,
          data: { error: error instanceof Error ? error.message : String(error) },
        });
      } else if (resume) {
        await eventStore.append({
          type: "checkpoint.resume_blocked",
          runId,
          data: { reason: error instanceof Error ? error.message : String(error) },
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

class ResumeBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeBlockedError";
  }
}

function compilePlan(
  runId: string,
  goal: string,
  workspaceRoot: string,
  plan: Awaited<ReturnType<WorkflowPlanner["plan"]>>,
  extensions?: PreparedRunExtensions,
): RunDefinition {
  const skillInstructions = extensions?.systemInstructions("research") ?? "";
  const extensionTools = unique(extensions?.toolNames ?? []);
  const workers: AgentDefinition[] = Array.from(
    { length: Math.min(3, plan.tasks.length) },
    (_, index) => ({
      id: `worker-${index + 1}`,
      role: "worker",
      instructions: [
        "You are a local evidence worker. Read the supplied files and report grounded findings with file references.",
        skillInstructions,
      ].filter(Boolean).join("\n\n"),
      capabilities: ["worker"],
      maxParallelTasks: 1,
    }),
  );
  const integrator: AgentDefinition = {
    id: "integrator",
    role: "integrator",
    instructions: [
      "You integrate worker outputs into a truthful final artifact. Preserve disagreements and missing evidence.",
      skillInstructions,
    ].filter(Boolean).join("\n\n"),
    capabilities: ["integrate"],
    maxParallelTasks: 1,
  };
  const workerTasks = plan.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    input: {
      instructions: `${task.instructions}\n\nOverall goal: ${goal}`,
      availableTools: unique(["list_files", "read_file", "compare_ratios", ...extensionTools]),
    },
    requiredCapabilities: ["worker"],
    workspace: { resourceId: workspaceRoot, access: "read" as const },
  }));
  return {
    id: runId,
    goal,
    agents: [...workers, integrator],
    tasks: [
      ...workerTasks,
      {
        id: "integrate",
        title: "Integrate worker results",
        input: {
          instructions: [
            plan.integration.instructions,
            `Write the complete result with write_artifact using fileName ${plan.integration.fileName}.`,
            "After the tool succeeds, return a short completion summary.",
            "Every numeric claim must cite its [calculationId] on the same line.",
            "Pass every registered calculationId to write_artifact; the write is rejected if any calculation is missing or any numeric claim is unregistered.",
          ].join("\n"),
          availableTools: unique(["write_artifact", "compare_ratios", ...extensionTools]),
        },
        dependsOn: workerTasks.map((task) => task.id),
        agentId: "integrator",
        requiredCapabilities: ["integrate"],
        workspace: { resourceId: workspaceRoot, access: "write" },
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
