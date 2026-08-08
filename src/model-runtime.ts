import type { AgentId, RunId, TaskId } from "./domain.js";
import type { EventStore } from "./event-store.js";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamOptions,
} from "./provider.js";

export interface ModelActor {
  runId: RunId;
  taskId: TaskId;
  agentId: AgentId;
}

export class AuditedModelClient {
  readonly #provider: ModelProvider;
  readonly #eventStore: EventStore;

  constructor(provider: ModelProvider, eventStore: EventStore) {
    this.#provider = provider;
    this.#eventStore = eventStore;
  }

  async complete(
    actor: ModelActor,
    request: ModelRequest,
    options?: ModelStreamOptions,
  ): Promise<ModelResponse> {
    await this.#eventStore.append({
      type: "model.requested",
      runId: actor.runId,
      taskId: actor.taskId,
      agentId: actor.agentId,
      data: {
        messageCount: request.messages.length,
        toolCount: request.tools?.length ?? 0,
      },
    });

    try {
      const response = await this.#provider.complete(request, options);
      await this.#eventStore.append({
        type: "model.completed",
        runId: actor.runId,
        taskId: actor.taskId,
        agentId: actor.agentId,
        data: {
          model: response.model,
          finishReason: response.finishReason,
          toolCallCount: response.toolCalls.length,
          totalTokens: response.usage?.totalTokens,
        },
      });
      return response;
    } catch (error) {
      await this.#eventStore.append({
        type: "model.failed",
        runId: actor.runId,
        taskId: actor.taskId,
        agentId: actor.agentId,
        data: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }
}
