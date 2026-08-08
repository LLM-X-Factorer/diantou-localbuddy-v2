import { join } from "node:path";

import { CodingWorkflow } from "../../src/coding-workflow.js";
import type { EventStore, PendingRuntimeEvent, RuntimeEvent } from "../../src/event-store.js";
import { JsonlEventStore } from "../../src/event-store.js";
import type {
  ChatMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../../src/provider.js";

const [workspace, runId, goal, crashPoint] = process.argv.slice(2);
if (
  workspace === undefined
  || runId === undefined
  || goal === undefined
  || (crashPoint !== "edit" && crashPoint !== "preflight")
) {
  throw new Error("workspace, runId, goal, and edit|preflight crash point are required");
}

class CodingCrashProvider implements ModelProvider {
  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{
          id: "change-greeting",
          title: "Change greeting",
          instructions: "Change the greeting to hello recovered buddy.",
          ownedPaths: ["src/greet.js"],
        }],
        integration: {
          instructions: "Summarize the isolated recovered patch without claiming merge.",
          fileName: "coding-recovery.md",
          verificationCommands: ["git_diff_check"],
        },
      }));
    }
    const prompt = lastUserMessage(request.messages);
    const toolIds = new Set(request.messages
      .filter((message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool")
      .map((message) => message.toolCallId));
    if (prompt.includes("Task ID: change-greeting")) {
      if (!toolIds.has("code-read")) {
        return toolResponse("code-read", "read_file", { path: "src/greet.js" });
      }
      if (!toolIds.has("code-edit")) {
        return toolResponse("code-edit", "replace_text", {
          path: "src/greet.js",
          oldText: 'return "hello";',
          newText: 'return "hello recovered buddy";',
        });
      }
      if (!toolIds.has("code-check")) {
        return toolResponse("code-check", "run_check", { command: "git_diff_check" });
      }
      return response("Changed the isolated file and verified its diff.");
    }
    if (prompt.includes("Task ID: integrate")) {
      return toolIds.has("code-summary")
        ? response("Saved the recovered Coding summary.")
        : toolResponse("code-summary", "write_artifact", {
            fileName: "coding-recovery.md",
            content: "# Coding recovery\n\nPrimary checkout: unchanged.\n\nRecovered patch passed git_diff_check.\n",
            calculationIds: [],
          });
    }
    throw new Error(`Unexpected Coding checkpoint request: ${prompt}`);
  }
}

function response(content: string): ModelResponse {
  return { model: "coding-checkpoint-fixture", content, toolCalls: [], finishReason: "stop" };
}

function toolResponse(id: string, name: string, input: unknown): ModelResponse {
  return {
    model: "coding-checkpoint-fixture",
    content: null,
    toolCalls: [{ id, name, arguments: JSON.stringify(input) }],
    finishReason: "tool_calls",
  };
}

function lastUserMessage(messages: readonly ChatMessage[]): string {
  const message = messages.toReversed().find((candidate) => candidate.role === "user");
  if (message === undefined || message.role !== "user") {
    throw new Error("Missing Coding checkpoint user message");
  }
  return message.content;
}

const runRoot = join(workspace, ".localbuddy", "runs", runId);
const persistentStore = new JsonlEventStore(join(runRoot, "events.jsonl"));
const eventStore: EventStore = {
  async append(event: PendingRuntimeEvent): Promise<RuntimeEvent> {
    const stored = await persistentStore.append(event);
    if (
      (crashPoint === "edit"
        && stored.type === "tool.completed"
        && stored.data?.toolCallId === "code-edit")
      || (crashPoint === "preflight"
        && stored.type === "workspace.created"
        && stored.taskId === "integration-preview")
    ) {
      process.exit(73);
    }
    return stored;
  },
  list(targetRunId?: string) {
    return persistentStore.list(targetRunId);
  },
};

await new CodingWorkflow({
  provider: new CodingCrashProvider(),
  eventStore,
  repoRoot: workspace,
  artifactRoot: join(runRoot, "artifacts"),
  checkpointRoot: join(runRoot, "checkpoint"),
  globalConcurrency: 1,
  runtimeOwner: "desktop",
}).run(runId, goal);

throw new Error("Coding checkpoint crash fixture unexpectedly completed");
