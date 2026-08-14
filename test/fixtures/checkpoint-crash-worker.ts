import { join } from "node:path";

import type { EventStore, PendingRuntimeEvent, RuntimeEvent } from "../../src/event-store.js";
import { JsonlEventStore } from "../../src/event-store.js";
import { HeadlessWorkflow } from "../../src/headless-workflow.js";
import type {
  ChatMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../../src/provider.js";

const [workspace, runId, goal] = process.argv.slice(2);
if (workspace === undefined || runId === undefined || goal === undefined) {
  throw new Error("workspace, runId, and goal are required");
}

class CrashFixtureProvider implements ModelProvider {
  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{ id: "read-note", title: "Read local note", instructions: "Read notes.md." }],
        integration: { instructions: "Write a concise result.", fileName: "result.md" },
      }));
    }
    const toolIds = new Set(
      request.messages
        .filter((message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool")
        .map((message) => message.toolCallId),
    );
    if (!toolIds.has("read-note-tool")) {
      return {
        model: "checkpoint-crash-fixture",
        content: null,
        toolCalls: [{
          id: "read-note-tool",
          name: "read_file",
          arguments: JSON.stringify({ path: "source-1" }),
        }],
        finishReason: "tool_calls",
      };
    }
    return response("fixture should exit before this response");
  }
}

function response(content: string): ModelResponse {
  return {
    model: "checkpoint-crash-fixture",
    content,
    toolCalls: [],
    finishReason: "stop",
  };
}

const runRoot = join(workspace, ".localbuddy", "runs", runId);
const persistentStore = new JsonlEventStore(join(runRoot, "events.jsonl"));
const eventStore: EventStore = {
  async append(event: PendingRuntimeEvent): Promise<RuntimeEvent> {
    const stored = await persistentStore.append(event);
    if (
      stored.type === "tool.completed"
      && stored.taskId === "read-note"
      && stored.data?.toolCallId === "read-note-tool"
    ) {
      process.exit(73);
    }
    return stored;
  },
  list(run?: string) {
    return persistentStore.list(run);
  },
};
const workflow = new HeadlessWorkflow({
  provider: new CrashFixtureProvider(),
  eventStore,
  workspaceRoot: workspace,
  sourcePaths: [join(workspace, "notes.md")],
  artifactRoot: join(runRoot, "artifacts"),
  checkpointRoot: join(runRoot, "checkpoint"),
  globalConcurrency: 1,
  runtimeOwner: "desktop",
});

await workflow.run(runId, goal);
throw new Error("checkpoint crash fixture unexpectedly completed");
