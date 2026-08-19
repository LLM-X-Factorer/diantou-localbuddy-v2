import type { EventStore } from "./event-store.js";
import { AuditedModelClient } from "./model-runtime.js";
import type { CheckCommand } from "./coding-tools.js";

export interface PlannedCodingTask {
  id: string;
  title: string;
  instructions: string;
  ownedPaths: readonly string[];
}

export interface CodingPlan {
  tasks: readonly PlannedCodingTask[];
  integration: {
    instructions: string;
    fileName: string;
    verificationCommands: readonly CheckCommand[];
  };
}

export class CodingWorkflowPlanner {
  readonly #modelClient: AuditedModelClient;
  readonly #eventStore: EventStore;
  readonly #maxWorkerTasks: number;

  constructor(modelClient: AuditedModelClient, eventStore: EventStore, maxWorkerTasks = 3) {
    this.#modelClient = modelClient;
    this.#eventStore = eventStore;
    this.#maxWorkerTasks = maxWorkerTasks;
  }

  async plan(
    runId: string,
    goal: string,
    workspaceManifest: readonly string[],
    signal?: AbortSignal,
    extensionContext = "No optional extensions are enabled.",
  ): Promise<CodingPlan> {
    const response = await this.#modelClient.complete(
      { runId, taskId: "orchestrate", agentId: "orchestrator" },
      {
        messages: [
          {
            role: "system",
            content: [
              "You are the LocalBuddy coding orchestrator.",
              `Split the goal into 1-${this.#maxWorkerTasks} independent coding tasks that may run in parallel.`,
              "Each task runs in a separate detached Git worktree created from the same HEAD.",
              "Assign disjoint ownedPaths. A path may be a file or a directory ending in /. Never assign .git or .localbuddy.",
              "Prefer the smallest safe patch. Workers may read the repository but may write only their ownedPaths.",
              "Workers may use only the explicitly enabled extension tools described below; extension tools cannot expand file ownership.",
              extensionContext,
              "Do not plan a merge or claim changes will reach the primary checkout.",
              "Return JSON only with this exact shape:",
              '{"tasks":[{"id":"kebab-case","title":"...","instructions":"...","ownedPaths":["src/file.ts"]}],"integration":{"instructions":"summarize patches, checks, and unresolved conflicts without claiming merge","fileName":"coding-summary.md","verificationCommands":["git_diff_check","pnpm_test"]}}',
              "verificationCommands may contain only git_diff_check, git_status, pnpm_test, pnpm_typecheck, or node_test. Always include git_diff_check.",
            ].join("\n"),
          },
          {
            role: "user",
            content: `Goal:\n${goal}\n\nRepository paths:\n${workspaceManifest.join("\n")}`,
          },
        ],
        responseFormat: "json_object",
        temperature: 0.1,
        maxTokens: 2_500,
      },
      { signal },
    );
    if (response.content === null) {
      throw new Error("Coding orchestrator returned no plan content");
    }
    const plan = parseCodingPlan(response.content, this.#maxWorkerTasks);
    await this.#eventStore.append({
      type: "plan.created",
      runId,
      taskId: "orchestrate",
      agentId: "orchestrator",
      data: { taskCount: plan.tasks.length, mode: "code" },
    });
    return plan;
  }
}

export function parseCodingPlan(content: string, maxWorkerTasks: number): CodingPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw new Error("Coding orchestrator returned invalid JSON", { cause: error });
  }
  const root = expectObject(raw, "plan");
  if (!Array.isArray(root.tasks) || root.tasks.length < 1 || root.tasks.length > maxWorkerTasks) {
    throw new Error(`Coding plan must contain between 1 and ${maxWorkerTasks} tasks`);
  }
  const ids = new Set<string>();
  const claimedPaths: string[] = [];
  const tasks = root.tasks.map((value, index) => {
    const task = expectObject(value, `tasks[${index}]`);
    const id = expectString(task.id, `tasks[${index}].id`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id)) {
      throw new Error(`Coding task id must be unique kebab-case: ${id}`);
    }
    ids.add(id);
    if (!Array.isArray(task.ownedPaths) || task.ownedPaths.length === 0) {
      throw new Error(`tasks[${index}].ownedPaths must be a non-empty array`);
    }
    const ownedPaths = task.ownedPaths.map((path, pathIndex) =>
      normalizeOwnedPath(expectString(path, `tasks[${index}].ownedPaths[${pathIndex}]`)),
    );
    for (const path of ownedPaths) {
      if (claimedPaths.some((claimed) => pathsOverlap(claimed, path))) {
        throw new Error(`Coding tasks have overlapping owned paths: ${path}`);
      }
      claimedPaths.push(path);
    }
    return {
      id,
      title: expectString(task.title, `tasks[${index}].title`),
      instructions: expectString(task.instructions, `tasks[${index}].instructions`),
      ownedPaths,
    };
  });
  const integration = expectObject(root.integration, "integration");
  const fileName = expectString(integration.fileName, "integration.fileName");
  if (!/^[\p{L}\p{N}._-]+\.md$/u.test(fileName)) {
    throw new Error("Coding integration fileName must be a simple .md filename");
  }
  const verificationCommands = parseVerificationCommands(integration.verificationCommands);
  return {
    tasks,
    integration: {
      instructions: expectString(integration.instructions, "integration.instructions"),
      fileName,
      verificationCommands,
    },
  };
}

function parseVerificationCommands(value: unknown): CheckCommand[] {
  if (value === undefined) {
    return ["git_diff_check"];
  }
  const allowed = new Set<CheckCommand>([
    "git_diff_check",
    "git_status",
    "pnpm_test",
    "pnpm_typecheck",
    "node_test",
  ]);
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) {
    throw new Error("integration.verificationCommands must contain between 1 and 4 commands");
  }
  const commands = value.map((command) => {
    if (typeof command !== "string" || !allowed.has(command as CheckCommand)) {
      throw new Error(`Unsupported integration verification command: ${String(command)}`);
    }
    return command as CheckCommand;
  });
  if (!commands.includes("git_diff_check")) {
    throw new Error("integration.verificationCommands must include git_diff_check");
  }
  return [...new Set(commands)];
}

function normalizeOwnedPath(path: string): string {
  const keepsDirectoryMarker = path.endsWith("/");
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/");
  const bare = normalized.replace(/\/$/, "");
  if (
    bare.length === 0
    || bare.startsWith("/")
    || bare.split("/").some((segment) => segment === ".." || segment === ".")
    || bare === ".git"
    || bare.startsWith(".git/")
    || bare === ".localbuddy"
    || bare.startsWith(".localbuddy/")
    || bare === ".localbuddy-internal"
    || bare.startsWith(".localbuddy-internal/")
  ) {
    throw new Error(`Unsafe owned path: ${path}`);
  }
  return keepsDirectoryMarker ? `${bare}/` : bare;
}

function pathsOverlap(left: string, right: string): boolean {
  const leftBare = left.replace(/\/$/, "");
  const rightBare = right.replace(/\/$/, "");
  return leftBare === rightBare
    || (left.endsWith("/") && rightBare.startsWith(`${leftBare}/`))
    || (right.endsWith("/") && leftBare.startsWith(`${rightBare}/`));
}

function expectObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}
