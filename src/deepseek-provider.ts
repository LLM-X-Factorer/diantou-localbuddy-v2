import type {
  ChatMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamOptions,
  ModelUsage,
  ProviderToolCall,
} from "./provider.js";

export interface DeepSeekProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  thinking?: "enabled" | "disabled";
  fetch?: typeof fetch;
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class DeepSeekProvider implements ModelProvider {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #thinking: "enabled" | "disabled";
  readonly #fetch: typeof fetch;

  constructor(options: DeepSeekProviderOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new Error("DeepSeek API key cannot be empty");
    }
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.#model = options.model ?? "deepseek-v4-flash";
    this.#thinking = options.thinking ?? "disabled";
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async complete(
    request: ModelRequest,
    options: ModelStreamOptions = {},
  ): Promise<ModelResponse> {
    const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.#model,
        messages: request.messages.map(toApiMessage),
        ...(request.tools === undefined || request.tools.length === 0
          ? {}
          : {
              tools: request.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
              tool_choice: "auto",
            }),
        ...(request.responseFormat === undefined
          ? {}
          : { response_format: { type: request.responseFormat } }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        thinking: { type: this.#thinking },
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 1_000);
      throw new Error(`DeepSeek request failed (${response.status}): ${body}`);
    }
    if (response.body === null) {
      throw new Error("DeepSeek returned an empty streaming body");
    }

    return readCompletionStream(response.body, this.#model, options.onTextDelta);
  }
}

function toApiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      ...(message.toolCalls === undefined
        ? {}
        : {
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function",
              function: { name: toolCall.name, arguments: toolCall.arguments },
            })),
          }),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId,
    };
  }
  return message;
}

async function readCompletionStream(
  body: ReadableStream<Uint8Array>,
  fallbackModel: string,
  onTextDelta?: (delta: string) => void,
): Promise<ModelResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoningContent = "";
  let model = fallbackModel;
  let finishReason = "stop";
  let usage: ModelUsage | undefined;
  const toolCalls = new Map<number, AccumulatedToolCall>();

  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return;
    }
    const data = trimmed.slice(5).trim();
    if (data.length === 0 || data === "[DONE]") {
      return;
    }

    const chunk = JSON.parse(data) as DeepSeekStreamChunk;
    model = chunk.model ?? model;
    if (chunk.usage !== null && chunk.usage !== undefined) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
      };
    }
    for (const choice of chunk.choices ?? []) {
      if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
        finishReason = choice.finish_reason;
      }
      const delta = choice.delta;
      if (delta.content !== null && delta.content !== undefined) {
        content += delta.content;
        onTextDelta?.(delta.content);
      }
      if (delta.reasoning_content !== null && delta.reasoning_content !== undefined) {
        reasoningContent += delta.reasoning_content;
      }
      for (const toolCall of delta.tool_calls ?? []) {
        const current = toolCalls.get(toolCall.index) ?? {
          id: "",
          name: "",
          arguments: "",
        };
        current.id += toolCall.id ?? "";
        current.name += toolCall.function?.name ?? "";
        current.arguments += toolCall.function?.arguments ?? "";
        toolCalls.set(toolCall.index, current);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      consumeLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    consumeLine(buffer);
  }

  return {
    model,
    content: content.length === 0 ? null : content,
    reasoningContent: reasoningContent.length === 0 ? null : reasoningContent,
    toolCalls: [...toolCalls.entries()]
      .toSorted(([left], [right]) => left - right)
      .map(([, toolCall]) => validateToolCall(toolCall)),
    finishReason,
    usage,
  };
}

function validateToolCall(toolCall: AccumulatedToolCall): ProviderToolCall {
  if (toolCall.id.length === 0 || toolCall.name.length === 0) {
    throw new Error("DeepSeek returned an incomplete tool call");
  }
  return toolCall;
}

interface DeepSeekStreamChunk {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    delta: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}

