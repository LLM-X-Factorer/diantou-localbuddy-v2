export type RunId = string;
export type TaskId = string;
export type AgentId = string;

export type WorkspaceAccess = "none" | "read" | "write";

export interface WorkspaceRequest {
  /** Stable identity of the logical workspace, normally its canonical path. */
  resourceId: string;
  access: WorkspaceAccess;
  /** Different isolation keys represent independent worktrees or copies. */
  isolationKey?: string;
}

export interface AgentDefinition {
  id: AgentId;
  role: string;
  instructions: string;
  capabilities: readonly string[];
  maxParallelTasks: number;
}

export interface TaskDefinition<Input = unknown> {
  id: TaskId;
  title: string;
  input: Input;
  dependsOn?: readonly TaskId[];
  agentId?: AgentId;
  requiredCapabilities?: readonly string[];
  workspace?: WorkspaceRequest;
}

export interface RunDefinition {
  id: RunId;
  goal: string;
  agents: readonly AgentDefinition[];
  tasks: readonly TaskDefinition[];
}

export type TaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled";

export type RunStatus = "succeeded" | "failed" | "cancelled";

export interface TaskExecutionContext {
  runId: RunId;
  task: TaskDefinition;
  agent: AgentDefinition;
  dependencyOutputs: ReadonlyMap<TaskId, unknown>;
  signal?: AbortSignal;
}

export interface TaskExecutor {
  execute(context: TaskExecutionContext): Promise<unknown>;
}

export interface TaskRecord {
  definition: TaskDefinition;
  status: TaskStatus;
  agentId?: AgentId;
  output?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface RunSummary {
  runId: RunId;
  status: RunStatus;
  tasks: ReadonlyMap<TaskId, TaskRecord>;
}
