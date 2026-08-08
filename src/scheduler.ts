import type {
  AgentDefinition,
  AgentId,
  RunDefinition,
  RunStatus,
  RunSummary,
  TaskDefinition,
  TaskExecutor,
  TaskId,
  TaskRecord,
  TaskStatus,
} from "./domain.js";
import type { EventStore, RuntimeEventType } from "./event-store.js";
import { ExecutionCoordinator } from "./execution-coordinator.js";
import type { ProcessSharedCapacity } from "./process-shared-provider.js";

export interface SchedulerOptions {
  globalConcurrency?: number;
  executionCoordinator?: ExecutionCoordinator;
  eventStore: EventStore;
  manageRunLifecycle?: boolean;
  processCapacity?: ProcessSharedCapacity;
}

export interface SchedulerResumeTask {
  status: "queued" | "succeeded";
  agentId?: AgentId;
  output?: unknown;
}

export interface SchedulerResumeState {
  tasks: ReadonlyMap<TaskId, SchedulerResumeTask>;
}

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>([
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
]);

export class MultiAgentScheduler {
  readonly #runConcurrency: number;
  readonly #executionCoordinator: ExecutionCoordinator;
  readonly #eventStore: EventStore;
  readonly #manageRunLifecycle: boolean;
  readonly #processCapacity?: ProcessSharedCapacity;

  constructor(options: SchedulerOptions) {
    const globalConcurrency = options.globalConcurrency ?? 3;
    if (!Number.isInteger(globalConcurrency) || globalConcurrency < 1) {
      throw new Error("globalConcurrency must be a positive integer");
    }
    this.#runConcurrency = globalConcurrency;
    this.#executionCoordinator = options.executionCoordinator
      ?? new ExecutionCoordinator(globalConcurrency);
    this.#eventStore = options.eventStore;
    this.#manageRunLifecycle = options.manageRunLifecycle ?? true;
    this.#processCapacity = options.processCapacity;
  }

  async run(
    definition: RunDefinition,
    executor: TaskExecutor,
    signal?: AbortSignal,
    resumeState?: SchedulerResumeState,
  ): Promise<RunSummary> {
    validateRun(definition);
    validateResumeState(definition, resumeState);

    const records = new Map<TaskId, TaskRecord>();
    const agentLoad = new Map<AgentId, number>(
      definition.agents.map((agent) => [agent.id, 0]),
    );
    const running = new Map<TaskId, Promise<void>>();

    if (this.#manageRunLifecycle) {
      await this.#eventStore.append({ type: "run.started", runId: definition.id });
    }
    for (const task of definition.tasks) {
      const resumed = resumeState?.tasks.get(task.id);
      if (resumed?.status === "succeeded") {
        records.set(task.id, {
          definition: task,
          status: "succeeded",
          agentId: resumed.agentId,
          output: resumed.output,
        });
        await this.#eventStore.append({
          type: "checkpoint.restored",
          runId: definition.id,
          taskId: task.id,
          agentId: resumed.agentId,
          data: { status: "succeeded", title: task.title },
        });
      } else {
        records.set(task.id, {
          definition: task,
          status: "queued",
          agentId: resumed?.agentId,
        });
        await this.#eventStore.append({
          type: resumeState === undefined ? "task.queued" : "checkpoint.restored",
          runId: definition.id,
          taskId: task.id,
          data: resumeState === undefined
            ? { title: task.title }
            : { status: "queued", title: task.title },
        });
      }
    }

    while (!allTasksTerminal(records)) {
      const coordinatorVersion = this.#executionCoordinator.version;
      if (signal?.aborted === true) {
        await cancelQueuedTasks(definition.id, records, this.#eventStore);
      } else {
        await blockTasksWithFailedDependencies(
          definition.id,
          records,
          this.#eventStore,
        );

        for (const task of definition.tasks) {
          if (running.size >= this.#runConcurrency) {
            break;
          }
          const record = getRecord(records, task.id);
          if (record.status !== "queued" || !dependenciesSucceeded(task, records)) {
            continue;
          }

          const agent = selectAgent(
            record.agentId === undefined ? task : { ...task, agentId: record.agentId },
            definition.agents,
            agentLoad,
          );
          const taskKey = `${definition.id}:${task.id}`;
          if (
            agent === undefined
            || !this.#executionCoordinator.canAcquire(taskKey, task.workspace)
          ) {
            continue;
          }

          const releaseSlot = this.#executionCoordinator.acquire(taskKey, task.workspace);
          agentLoad.set(agent.id, getAgentLoad(agentLoad, agent.id) + 1);
          const execution = this.#executeTask(
            definition.id,
            record,
            records,
            agent,
            executor,
            signal,
          ).finally(() => {
            releaseSlot();
            agentLoad.set(agent.id, getAgentLoad(agentLoad, agent.id) - 1);
            running.delete(task.id);
          });
          running.set(task.id, execution);
        }
      }

      if (running.size === 0) {
        const queued = [...records.values()].filter((record) => record.status === "queued");
        if (queued.length > 0) {
          if (this.#executionCoordinator.activeCount > 0) {
            await this.#executionCoordinator.waitForChange(coordinatorVersion, signal);
            continue;
          }
          throw new Error(
            `Scheduler deadlock: queued tasks cannot be scheduled (${queued
              .map((record) => record.definition.id)
              .join(", ")})`,
          );
        }
        break;
      }

      await Promise.race(running.values());
    }

    const status = deriveRunStatus(records, signal);
    if (this.#manageRunLifecycle) {
      await this.#eventStore.append({ type: runEventFor(status), runId: definition.id });
    }
    return { runId: definition.id, status, tasks: records };
  }

  async #executeTask(
    runId: string,
    record: TaskRecord,
    records: ReadonlyMap<TaskId, TaskRecord>,
    agent: AgentDefinition,
    executor: TaskExecutor,
    signal?: AbortSignal,
  ): Promise<void> {
    let releaseProcessCapacity: (() => Promise<void>) | undefined;
    try {
      releaseProcessCapacity = await this.#processCapacity?.acquire(signal);
      record.status = "running";
      record.agentId = agent.id;
      const started = await this.#eventStore.append({
        type: "task.started",
        runId,
        taskId: record.definition.id,
        agentId: agent.id,
      });
      record.startedAt = started.timestamp;
      record.output = await executor.execute({
        runId,
        task: record.definition,
        agent,
        dependencyOutputs: new Map(
          (record.definition.dependsOn ?? []).map((dependency) => {
            const dependencyRecord = getRecord(records, dependency);
            return [dependency, dependencyRecord.output] as const;
          }),
        ),
        signal,
      });
      record.status = "succeeded";
      const completed = await this.#eventStore.append({
        type: "task.succeeded",
        runId,
        taskId: record.definition.id,
        agentId: agent.id,
      });
      record.completedAt = completed.timestamp;
    } catch (error) {
      record.status = signal?.aborted === true ? "cancelled" : "failed";
      record.error = toErrorMessage(error);
      const completed = await this.#eventStore.append({
        type: record.status === "cancelled" ? "task.cancelled" : "task.failed",
        runId,
        taskId: record.definition.id,
        agentId: agent.id,
        data: { error: record.error },
      });
      record.completedAt = completed.timestamp;
    } finally {
      await releaseProcessCapacity?.();
    }
  }
}

function validateResumeState(
  definition: RunDefinition,
  resumeState?: SchedulerResumeState,
): void {
  if (resumeState === undefined) {
    return;
  }
  const taskIds = new Set(definition.tasks.map((task) => task.id));
  for (const [taskId, task] of resumeState.tasks) {
    if (!taskIds.has(taskId)) {
      throw new Error(`resume state contains unknown task: ${taskId}`);
    }
    if (task.status === "succeeded" && task.output === undefined) {
      throw new Error(`succeeded resume task has no output: ${taskId}`);
    }
  }
}

function validateRun(definition: RunDefinition): void {
  if (definition.id.trim().length === 0) {
    throw new Error("Run id cannot be empty");
  }
  if (definition.agents.length === 0) {
    throw new Error("A run requires at least one agent");
  }

  const agents = new Map<AgentId, AgentDefinition>();
  for (const agent of definition.agents) {
    if (agents.has(agent.id)) {
      throw new Error(`Duplicate agent id: ${agent.id}`);
    }
    if (!Number.isInteger(agent.maxParallelTasks) || agent.maxParallelTasks < 1) {
      throw new Error(`Agent ${agent.id} has invalid maxParallelTasks`);
    }
    agents.set(agent.id, agent);
  }

  const tasks = new Map<TaskId, TaskDefinition>();
  for (const task of definition.tasks) {
    if (tasks.has(task.id)) {
      throw new Error(`Duplicate task id: ${task.id}`);
    }
    tasks.set(task.id, task);
  }

  for (const task of definition.tasks) {
    for (const dependency of task.dependsOn ?? []) {
      if (!tasks.has(dependency)) {
        throw new Error(`Task ${task.id} depends on missing task ${dependency}`);
      }
    }
    const candidates = task.agentId === undefined
      ? definition.agents
      : [agents.get(task.agentId)].filter(isDefined);
    if (candidates.length === 0 || !candidates.some((agent) => agentMatches(task, agent))) {
      throw new Error(`Task ${task.id} has no compatible agent`);
    }
  }

  assertAcyclic(definition.tasks, tasks);
}

function assertAcyclic(
  definitions: readonly TaskDefinition[],
  tasks: ReadonlyMap<TaskId, TaskDefinition>,
): void {
  const visiting = new Set<TaskId>();
  const visited = new Set<TaskId>();

  const visit = (taskId: TaskId): void => {
    if (visiting.has(taskId)) {
      throw new Error(`Task graph contains a cycle at ${taskId}`);
    }
    if (visited.has(taskId)) {
      return;
    }
    visiting.add(taskId);
    const task = tasks.get(taskId);
    if (task === undefined) {
      throw new Error(`Task ${taskId} is missing`);
    }
    for (const dependency of task.dependsOn ?? []) {
      visit(dependency);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  };

  for (const task of definitions) {
    visit(task.id);
  }
}

function selectAgent(
  task: TaskDefinition,
  agents: readonly AgentDefinition[],
  agentLoad: ReadonlyMap<AgentId, number>,
): AgentDefinition | undefined {
  return agents
    .filter((agent) => task.agentId === undefined || task.agentId === agent.id)
    .filter((agent) => agentMatches(task, agent))
    .filter((agent) => getAgentLoad(agentLoad, agent.id) < agent.maxParallelTasks)
    .toSorted((left, right) => {
      const loadDifference =
        getAgentLoad(agentLoad, left.id) - getAgentLoad(agentLoad, right.id);
      return loadDifference === 0 ? left.id.localeCompare(right.id) : loadDifference;
    })[0];
}

function agentMatches(task: TaskDefinition, agent: AgentDefinition): boolean {
  return (task.requiredCapabilities ?? []).every((capability) =>
    agent.capabilities.includes(capability),
  );
}

function dependenciesSucceeded(
  task: TaskDefinition,
  records: ReadonlyMap<TaskId, TaskRecord>,
): boolean {
  return (task.dependsOn ?? []).every(
    (dependency) => getRecord(records, dependency).status === "succeeded",
  );
}

async function blockTasksWithFailedDependencies(
  runId: string,
  records: Map<TaskId, TaskRecord>,
  eventStore: EventStore,
): Promise<void> {
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records.values()) {
      if (record.status !== "queued") {
        continue;
      }
      const failedDependency = (record.definition.dependsOn ?? []).find((dependency) => {
        const status = getRecord(records, dependency).status;
        return status === "failed" || status === "blocked" || status === "cancelled";
      });
      if (failedDependency === undefined) {
        continue;
      }
      record.status = "blocked";
      record.error = `Dependency ${failedDependency} did not succeed`;
      const event = await eventStore.append({
        type: "task.blocked",
        runId,
        taskId: record.definition.id,
        data: { dependency: failedDependency },
      });
      record.completedAt = event.timestamp;
      changed = true;
    }
  }
}

async function cancelQueuedTasks(
  runId: string,
  records: Map<TaskId, TaskRecord>,
  eventStore: EventStore,
): Promise<void> {
  for (const record of records.values()) {
    if (record.status !== "queued") {
      continue;
    }
    record.status = "cancelled";
    const event = await eventStore.append({
      type: "task.cancelled",
      runId,
      taskId: record.definition.id,
    });
    record.completedAt = event.timestamp;
  }
}

function allTasksTerminal(records: ReadonlyMap<TaskId, TaskRecord>): boolean {
  return [...records.values()].every((record) => TERMINAL_TASK_STATUSES.has(record.status));
}

function deriveRunStatus(
  records: ReadonlyMap<TaskId, TaskRecord>,
  signal?: AbortSignal,
): RunStatus {
  if (signal?.aborted === true || [...records.values()].some((record) => record.status === "cancelled")) {
    return "cancelled";
  }
  if ([...records.values()].some((record) => record.status === "failed" || record.status === "blocked")) {
    return "failed";
  }
  return "succeeded";
}

function runEventFor(status: RunStatus): RuntimeEventType {
  if (status === "succeeded") {
    return "run.succeeded";
  }
  if (status === "cancelled") {
    return "run.cancelled";
  }
  return "run.failed";
}

function getRecord(records: ReadonlyMap<TaskId, TaskRecord>, taskId: TaskId): TaskRecord {
  const record = records.get(taskId);
  if (record === undefined) {
    throw new Error(`Unknown task record: ${taskId}`);
  }
  return record;
}

function getAgentLoad(load: ReadonlyMap<AgentId, number>, agentId: AgentId): number {
  return load.get(agentId) ?? 0;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
