import type { EventStore } from "./event-store.js";
import { AuditedModelClient } from "./model-runtime.js";

export interface PlannedWorkerTask {
  id: string;
  title: string;
  instructions: string;
}

export interface HeadlessPlan {
  tasks: readonly PlannedWorkerTask[];
  integration: {
    instructions: string;
    fileName: string;
  };
}

export class WorkflowPlanner {
  readonly #modelClient: AuditedModelClient;
  readonly #eventStore: EventStore;
  readonly #maxWorkerTasks: number;

  constructor(
    modelClient: AuditedModelClient,
    eventStore: EventStore,
    maxWorkerTasks = 3,
  ) {
    this.#modelClient = modelClient;
    this.#eventStore = eventStore;
    this.#maxWorkerTasks = maxWorkerTasks;
  }

  async plan(
    runId: string,
    goal: string,
    researchSources: readonly string[],
    signal?: AbortSignal,
    extensionContext = "No optional extensions are enabled.",
    hasLocalSources = true,
  ): Promise<HeadlessPlan> {
    const response = await this.#modelClient.complete(
      { runId, taskId: "orchestrate", agentId: "orchestrator" },
      {
        messages: [
          {
            role: "system",
            content: [
              "You are the LocalBuddy task orchestrator.",
              `Split the goal into 1-${this.#maxWorkerTasks} independent read-only worker tasks that can run in parallel.`,
              hasLocalSources
                ? "Workers can search filenames and read files only within the explicitly selected local sources. The project directory itself is not evidence."
                : "No local sources were selected. Workers cannot search or read the project directory; they may use only the task description and explicitly enabled extensions.",
              "Workers can use a deterministic ratio comparison tool and only the explicitly enabled extensions described below.",
              extensionContext,
              "Workers cannot write workspace files. Extension tool policy may deny externally effectful actions.",
              "Any multi-step arithmetic or ratio comparison must be assigned to the deterministic tool, never mental arithmetic.",
              "Return JSON only with this exact shape:",
              '{"tasks":[{"id":"kebab-case","title":"...","instructions":"..."}],"integration":{"instructions":"...","fileName":"report.md"}}',
              "If the goal explicitly requests a safe simple .md output filename, preserve that exact filename in integration.fileName.",
              "The integration instructions must require a grounded synthesis of worker results.",
            ].join("\n"),
          },
          {
            role: "user",
            content: `Goal:\n${goal}\n\nExplicit local research sources:\n${researchSources.join("\n")}`,
          },
        ],
        responseFormat: "json_object",
        temperature: 0.1,
        maxTokens: 2_000,
      },
      { signal },
    );
    if (response.content === null) {
      throw new Error("Orchestrator returned no plan content");
    }
    const plan = parsePlan(response.content, this.#maxWorkerTasks);
    await this.#eventStore.append({
      type: "plan.created",
      runId,
      taskId: "orchestrate",
      agentId: "orchestrator",
      data: { taskCount: plan.tasks.length, outputFileName: plan.integration.fileName },
    });
    return plan;
  }
}

export function parsePlan(content: string, maxWorkerTasks: number): HeadlessPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw new Error("Orchestrator returned invalid JSON", { cause: error });
  }
  const root = expectObject(raw, "plan");
  if (!Array.isArray(root.tasks) || root.tasks.length < 1 || root.tasks.length > maxWorkerTasks) {
    throw new Error(`Plan must contain between 1 and ${maxWorkerTasks} worker tasks`);
  }
  const ids = new Set<string>();
  const tasks = root.tasks.map((item, index) => {
    const task = expectObject(item, `tasks[${index}]`);
    const id = expectString(task.id, `tasks[${index}].id`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error(`Task id must use kebab-case: ${id}`);
    }
    if (ids.has(id)) {
      throw new Error(`Duplicate planned task id: ${id}`);
    }
    ids.add(id);
    return {
      id,
      title: expectString(task.title, `tasks[${index}].title`),
      instructions: expectString(task.instructions, `tasks[${index}].instructions`),
    };
  });
  const integration = expectObject(root.integration, "integration");
  const fileName = expectString(integration.fileName, "integration.fileName");
  if (!/^[\p{L}\p{N}._-]+\.md$/u.test(fileName)) {
    throw new Error("Integration fileName must be a simple .md filename");
  }
  return {
    tasks,
    integration: {
      instructions: expectString(integration.instructions, "integration.instructions"),
      fileName,
    },
  };
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
