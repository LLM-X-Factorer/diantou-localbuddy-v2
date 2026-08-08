import type { AgentDefinition, RunId, TaskId } from "./domain.js";
import type { EventStore } from "./event-store.js";
import type { ProviderToolCall, ProviderToolDefinition } from "./provider.js";

export type ToolRisk = "read" | "compute" | "write" | "execute";
export type ToolPermission =
  | "workspace.read"
  | "deterministic.compute"
  | "artifact.write"
  | "worktree.write"
  | "process.execute"
  | "external.read"
  | "external.effect";

export type TrustProfile = "strict" | "balanced" | "automation";
export type TrustDisposition = "auto" | "prompt-once" | "prompt-always" | "deny";

export interface ToolContext {
  runId: RunId;
  taskId: TaskId;
  agent: AgentDefinition;
  signal?: AbortSignal;
}

export interface ToolDefinition<Input = unknown> extends ProviderToolDefinition {
  risk: ToolRisk;
  permission?: ToolPermission;
  parse(input: unknown): Input;
  execute(input: Input, context: ToolContext): Promise<unknown>;
}

export interface ApprovalDecision {
  allowed: boolean;
  reason: string;
}

export interface ApprovalPolicy {
  authorize(
    tool: ToolDefinition,
    context: ToolContext,
    toolCall?: ProviderToolCall,
  ): Promise<ApprovalDecision>;
}

export interface ToolExecutionResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

export interface ToolJournalState {
  status: "new" | "started" | "completed";
  result?: ToolExecutionResult;
}

export interface ToolExecutionJournal {
  start(
    toolCall: ProviderToolCall,
    context: ToolContext,
    risk: ToolRisk,
  ): Promise<ToolJournalState>;
  complete(
    toolCall: ProviderToolCall,
    context: ToolContext,
    risk: ToolRisk,
    result: ToolExecutionResult,
  ): Promise<void>;
}

export class UnsafeToolRecoveryError extends Error {
  constructor(toolName: string, toolCallId: string) {
    super(`cannot safely resume ambiguous ${toolName} tool call ${toolCallId}`);
    this.name = "UnsafeToolRecoveryError";
  }
}

export class RoleBasedApprovalPolicy implements ApprovalPolicy {
  readonly #policy: UnifiedApprovalPolicy;

  constructor(options: { approvalHandler?: UnifiedApprovalHandler } = {}) {
    this.#policy = new UnifiedApprovalPolicy({
      profile: "balanced",
      approvalHandler: options.approvalHandler,
    });
  }

  authorize(
    tool: ToolDefinition,
    context: ToolContext,
    toolCall?: ProviderToolCall,
  ): Promise<ApprovalDecision> {
    return this.#policy.authorize(tool, context, toolCall);
  }
}

export interface UnifiedApprovalHandler {
  request(input: {
    tool: ToolDefinition;
    context: ToolContext;
    toolCall: ProviderToolCall;
  }): Promise<ApprovalDecision>;
}

export class UnifiedApprovalPolicy implements ApprovalPolicy {
  readonly #profile: TrustProfile;
  readonly #approvalHandler?: UnifiedApprovalHandler;
  readonly #preauthorized: ReadonlySet<ToolPermission>;
  readonly #sessionGrants = new Set<string>();

  constructor(options: {
    profile?: TrustProfile;
    approvalHandler?: UnifiedApprovalHandler;
    preauthorized?: ReadonlySet<ToolPermission>;
  } = {}) {
    this.#profile = options.profile ?? "balanced";
    this.#approvalHandler = options.approvalHandler;
    this.#preauthorized = options.preauthorized ?? new Set();
  }

  async authorize(
    tool: ToolDefinition,
    context: ToolContext,
    toolCall?: ProviderToolCall,
  ): Promise<ApprovalDecision> {
    const permission = tool.permission;
    if (permission === undefined) {
      return { allowed: false, reason: `tool ${tool.name} has no unified permission classification` };
    }
    const roleDecision = enforceRoleBoundary(permission, tool, context);
    if (!roleDecision.allowed) return roleDecision;
    if (this.#preauthorized.has(permission)) {
      return { allowed: true, reason: `Run request preauthorized ${permission}` };
    }
    const disposition = trustDisposition(this.#profile, permission);
    if (disposition === "auto") {
      return { allowed: true, reason: `${this.#profile} trust policy allows ${permission}` };
    }
    if (disposition === "deny") {
      return { allowed: false, reason: `${this.#profile} trust policy denies ${permission}` };
    }
    const grantKey = `${context.runId}:${permission}:${tool.name}`;
    if (disposition === "prompt-once" && this.#sessionGrants.has(grantKey)) {
      return { allowed: true, reason: `local user already approved ${permission} for this Run tool` };
    }
    if (this.#approvalHandler === undefined || toolCall === undefined) {
      return {
        allowed: false,
        reason: `${permission} requires an exact interactive approval in the ${this.#profile} policy`,
      };
    }
    const decision = await this.#approvalHandler.request({ tool, context, toolCall });
    if (decision.allowed && disposition === "prompt-once") this.#sessionGrants.add(grantKey);
    return decision;
  }
}

export function trustDisposition(
  profile: TrustProfile,
  permission: ToolPermission,
): TrustDisposition {
  const profiles: Record<TrustProfile, Record<ToolPermission, TrustDisposition>> = {
    strict: {
      "workspace.read": "auto",
      "deterministic.compute": "auto",
      "artifact.write": "prompt-once",
      "worktree.write": "prompt-once",
      "process.execute": "prompt-always",
      "external.read": "prompt-once",
      "external.effect": "prompt-always",
    },
    balanced: {
      "workspace.read": "auto",
      "deterministic.compute": "auto",
      "artifact.write": "auto",
      "worktree.write": "auto",
      "process.execute": "auto",
      "external.read": "auto",
      "external.effect": "prompt-always",
    },
    automation: {
      "workspace.read": "auto",
      "deterministic.compute": "auto",
      "artifact.write": "auto",
      "worktree.write": "auto",
      "process.execute": "auto",
      "external.read": "auto",
      "external.effect": "deny",
    },
  };
  return profiles[profile][permission];
}

function enforceRoleBoundary(
  permission: ToolPermission,
  tool: ToolDefinition,
  context: ToolContext,
): ApprovalDecision {
  if (permission === "artifact.write") {
    return context.agent.role === "integrator" && tool.name === "write_artifact"
      ? { allowed: true, reason: "integrator owns the registered artifact directory" }
      : { allowed: false, reason: `${context.agent.role} is not allowed to write final artifacts` };
  }
  if (permission === "worktree.write") {
    return ["code-worker", "merge-agent"].includes(context.agent.role)
      && ["replace_text", "create_file"].includes(tool.name)
      ? { allowed: true, reason: "code-worker writes remain inside owned worktree paths" }
      : { allowed: false, reason: `${context.agent.role} is not allowed to mutate an isolated worktree` };
  }
  if (permission === "process.execute") {
    return ["code-worker", "merge-agent"].includes(context.agent.role) && tool.name === "run_check"
      ? { allowed: true, reason: "code-worker may run fixed checks through the constrained ExecutionHost" }
      : { allowed: false, reason: `${context.agent.role} is not allowed to start local processes` };
  }
  return { allowed: true, reason: `${permission} passed its role boundary` };
}

export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();

  constructor(tools: readonly ToolDefinition[]) {
    for (const tool of tools) {
      if (this.#tools.has(tool.name)) {
        throw new Error(`Duplicate tool name: ${tool.name}`);
      }
      this.#tools.set(tool.name, tool);
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.#tools.get(name);
  }

  providerDefinitions(allowedNames: readonly string[]): ProviderToolDefinition[] {
    return allowedNames.map((name) => {
      const tool = this.#tools.get(name);
      if (tool === undefined) {
        throw new Error(`Unknown allowed tool: ${name}`);
      }
      return {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      };
    });
  }
}

export class ToolRuntime {
  readonly #registry: ToolRegistry;
  readonly #approvalPolicy: ApprovalPolicy;
  readonly #eventStore: EventStore;
  readonly #journal?: ToolExecutionJournal;

  constructor(
    registry: ToolRegistry,
    approvalPolicy: ApprovalPolicy,
    eventStore: EventStore,
    journal?: ToolExecutionJournal,
  ) {
    this.#registry = registry;
    this.#approvalPolicy = approvalPolicy;
    this.#eventStore = eventStore;
    this.#journal = journal;
  }

  definitions(allowedNames: readonly string[]): ProviderToolDefinition[] {
    return this.#registry.providerDefinitions(allowedNames);
  }

  async execute(
    toolCall: ProviderToolCall,
    context: ToolContext,
    allowedNames: readonly string[],
  ): Promise<ToolExecutionResult> {
    await this.#eventStore.append({
      type: "tool.requested",
      runId: context.runId,
      taskId: context.taskId,
      agentId: context.agent.id,
      data: { toolCallId: toolCall.id, toolName: toolCall.name },
    });

    const tool = this.#registry.get(toolCall.name);
    if (tool === undefined || !allowedNames.includes(toolCall.name)) {
      return this.#deny(toolCall, context, "tool is unknown or unavailable to this task");
    }

    const decision = await this.#approvalPolicy.authorize(tool, context, toolCall);
    if (!decision.allowed) {
      return this.#deny(toolCall, context, decision.reason);
    }
    await this.#eventStore.append({
      type: "tool.approved",
      runId: context.runId,
      taskId: context.taskId,
      agentId: context.agent.id,
      data: {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        permission: tool.permission,
        risk: tool.risk,
        reason: decision.reason,
      },
    });

    const journalState = await this.#journal?.start(toolCall, context, tool.risk);
    if (journalState?.status === "completed" && journalState.result !== undefined) {
      await this.#eventStore.append({
        type: "tool.reused",
        runId: context.runId,
        taskId: context.taskId,
        agentId: context.agent.id,
        data: { toolCallId: toolCall.id, toolName: toolCall.name },
      });
      return journalState.result;
    }
    if (
      journalState?.status === "started"
      && (tool.risk === "write" || tool.risk === "execute")
    ) {
      throw new UnsafeToolRecoveryError(tool.name, toolCall.id);
    }

    let result: ToolExecutionResult;
    let failureMessage: string | undefined;
    try {
      const rawInput = JSON.parse(toolCall.arguments) as unknown;
      const input = tool.parse(rawInput);
      const output = await tool.execute(input, context);
      const content = serializeToolOutput(output);
      result = { toolCallId: toolCall.id, content, isError: false };
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
      result = {
        toolCallId: toolCall.id,
        content: `Tool error: ${failureMessage}`,
        isError: true,
      };
    }
    await this.#journal?.complete(toolCall, context, tool.risk, result);
    if (failureMessage === undefined) {
      await this.#eventStore.append({
        type: "tool.completed",
        runId: context.runId,
        taskId: context.taskId,
        agentId: context.agent.id,
        data: { toolCallId: toolCall.id, toolName: toolCall.name },
      });
      return result;
    }
    await this.#eventStore.append({
      type: "tool.failed",
      runId: context.runId,
      taskId: context.taskId,
      agentId: context.agent.id,
      data: { toolCallId: toolCall.id, toolName: toolCall.name, error: failureMessage },
    });
    return result;
  }

  async #deny(
    toolCall: ProviderToolCall,
    context: ToolContext,
    reason: string,
  ): Promise<ToolExecutionResult> {
    await this.#eventStore.append({
      type: "tool.denied",
      runId: context.runId,
      taskId: context.taskId,
      agentId: context.agent.id,
      data: { toolCallId: toolCall.id, toolName: toolCall.name, reason },
    });
    return { toolCallId: toolCall.id, content: `Tool denied: ${reason}`, isError: true };
  }
}

function serializeToolOutput(output: unknown): string {
  const serialized = typeof output === "string" ? output : JSON.stringify(output);
  if (serialized.length > 100_000) {
    return `${serialized.slice(0, 100_000)}\n[tool output truncated]`;
  }
  return serialized;
}
