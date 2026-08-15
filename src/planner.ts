import type { EventStore } from "./event-store.js";
import { AuditedModelClient } from "./model-runtime.js";
import type { ChatMessage } from "./provider.js";

export interface PlannedWorkerTask {
  id: string;
  title: string;
  instructions: string;
  sourceIds?: readonly string[];
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
    requiredArtifactFileName?: string,
  ): Promise<HeadlessPlan> {
    if (requiredArtifactFileName !== undefined) {
      validateIntegrationFileName(requiredArtifactFileName);
    }
    const messages: ChatMessage[] = [
          {
            role: "system",
            content: [
              "You are the LocalBuddy task orchestrator.",
              `Split the goal into 1-${this.#maxWorkerTasks} independent read-only worker tasks that can run in parallel.`,
              hasLocalSources
                ? "Workers can search filenames, search bounded text excerpts, and read files only within the explicitly selected local sources. The project directory itself is not evidence. Assign every listed source id to at least one worker for use or an explicit relevance check; do not silently omit selected sources."
                : "No local sources were selected. Workers cannot search or read the project directory; they may use only the task description and explicitly enabled extensions.",
              "Workers can use a deterministic ratio comparison tool and only the explicitly enabled extensions described below.",
              extensionContext,
              "Workers cannot write workspace files. Extension tool policy may deny externally effectful actions.",
              "Any multi-step arithmetic or ratio comparison must be assigned to the deterministic tool, never mental arithmetic.",
              "Return JSON only with this exact shape:",
              '{"tasks":[{"id":"kebab-case","title":"...","instructions":"...","sourceIds":["source-1"]}],"integration":{"instructions":"...","fileName":"report.md"}}',
              hasLocalSources
                ? "List every worker's sourceIds explicitly. Assign small cross-cutting manifests, source indexes, citation ledgers, or bibliographies to every worker that needs their titles, dates, publishers, or original URLs."
                : "Use an empty sourceIds array for every worker because no local sources were selected.",
              "Use a safe simple .docx integration.fileName only when the goal explicitly requests an editable Word/DOCX deliverable; otherwise use .md.",
              "If the goal explicitly requests a safe simple .md or .docx output filename, preserve that exact filename in integration.fileName.",
              requiredArtifactFileName === undefined
                ? "This is a new Artifact, so choose its format from the current goal."
                : `This Run revises a verified parent Artifact. integration.fileName must be exactly ${requiredArtifactFileName}; preserve the parent filename and format even when the current turn only says to continue modifying the same document.`,
              "The integration instructions must require a grounded synthesis of worker results.",
            ].join("\n"),
          },
          {
            role: "user",
            content: `Goal:\n${goal}\n\nExplicit local research sources:\n${researchSources.join("\n")}`,
          },
        ];
    let parsed: HeadlessPlan | undefined;
    let repairAttempts = 0;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.#modelClient.complete(
        { runId, taskId: "orchestrate", agentId: "orchestrator" },
        {
          messages,
          responseFormat: "json_object",
          temperature: 0.1,
          maxTokens: 2_000,
        },
        { signal },
      );
      try {
        if (response.content === null) {
          throw new Error("Orchestrator returned no plan content");
        }
        parsed = parsePlan(response.content, this.#maxWorkerTasks, requiredArtifactFileName);
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === 1) throw lastError;
        repairAttempts += 1;
        if (response.content !== null) {
          messages.push({ role: "assistant", content: response.content });
        }
        messages.push({
          role: "user",
          content: [
            `Your previous plan violated the required JSON contract: ${lastError.message.slice(0, 500)}`,
            "Return one corrected JSON object only. Preserve the same task meaning, include every required field, and do not add commentary.",
          ].join("\n"),
        });
      }
    }
    if (parsed === undefined) {
      throw lastError ?? new Error("Orchestrator did not produce a valid plan");
    }
    const plan = requiredArtifactFileName === undefined
      ? parsed
      : {
          ...parsed,
          integration: {
            instructions: [
              `Revise the verified parent Artifact and deliver the result as ${requiredArtifactFileName}. Preserve its file format and do not substitute Markdown.`,
              parsed.integration.instructions,
            ].join("\n"),
            fileName: requiredArtifactFileName,
          },
        };
    await this.#eventStore.append({
      type: "plan.created",
      runId,
      taskId: "orchestrate",
      agentId: "orchestrator",
      data: {
        taskCount: plan.tasks.length,
        outputFileName: plan.integration.fileName,
        repairAttempts,
      },
    });
    return plan;
  }
}

export function parsePlan(
  content: string,
  maxWorkerTasks: number,
  requiredArtifactFileName?: string,
): HeadlessPlan {
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
    const sourceIds = optionalSourceIds(task.sourceIds, `tasks[${index}].sourceIds`);
    return {
      id,
      title: expectString(task.title, `tasks[${index}].title`),
      instructions: expectString(task.instructions, `tasks[${index}].instructions`),
      ...(sourceIds === undefined ? {} : { sourceIds }),
    };
  });
  const integration = expectObject(root.integration, "integration");
  const fileName = requiredArtifactFileName
    ?? expectString(integration.fileName, "integration.fileName");
  validateIntegrationFileName(fileName);
  return {
    tasks,
    integration: {
      instructions: expectString(integration.instructions, "integration.instructions"),
      fileName,
    },
  };
}

function validateIntegrationFileName(fileName: string): void {
  if (!/^[\p{L}\p{N}._-]+\.(?:md|docx)$/iu.test(fileName)) {
    throw new Error("Integration fileName must be a simple .md or .docx filename");
  }
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

function optionalSourceIds(value: unknown, name: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  const sourceIds = value.map((item, index) => {
    const sourceId = expectString(item, `${name}[${index}]`);
    if (!/^source-\d+$/u.test(sourceId)) {
      throw new Error(`${name}[${index}] must be a logical source id`);
    }
    return sourceId;
  });
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error(`${name} cannot contain duplicate source ids`);
  }
  return sourceIds;
}
