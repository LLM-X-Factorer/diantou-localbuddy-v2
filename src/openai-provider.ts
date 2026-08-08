import type {
  ChatMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelStreamOptions,
  ModelUsage,
  ProviderToolCall,
} from "./provider.js";

export interface OpenAIProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetch?: typeof fetch;
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class OpenAIProvider implements ModelProvider {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #fetch: typeof fetch;

  constructor(options: OpenAIProviderOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new Error("OpenAI API key cannot be empty");
    }
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.#model = options.model ?? "gpt-5-mini";
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
        ...(request.maxTokens === undefined ? {} : { max_completion_tokens: request.maxTokens }),
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 1_000);
      throw new Error(`OpenAI request failed (${response.status}): ${body}`);
    }
    if (response.body === null) {
      throw new Error("OpenAI returned an empty streaming body");
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
    return { role: "tool", content: message.content, tool_call_id: message.toolCallId };
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
  let model = fallbackModel;
  let finishReason = "stop";
  let usage: ModelUsage | undefined;
  const toolCalls = new Map<number, AccumulatedToolCall>();

  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (data.length === 0 || data === "[DONE]") return;
    const chunk = JSON.parse(data) as OpenAIStreamChunk;
    model = chunk.model ?? model;
    if (chunk.usage !== null && chunk.usage !== undefined) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
      };
    }
    for (const choice of chunk.choices ?? []) {
      finishReason = choice.finish_reason ?? finishReason;
      const delta = choice.delta;
      if (delta.content !== null && delta.content !== undefined) {
        content += delta.content;
        onTextDelta?.(delta.content);
      }
      for (const toolCall of delta.tool_calls ?? []) {
        const current = toolCalls.get(toolCall.index) ?? { id: "", name: "", arguments: "" };
        current.id += toolCall.id ?? "";
        current.name += toolCall.function?.name ?? "";
        current.arguments += toolCall.function?.arguments ?? "";
        toolCalls.set(toolCall.index, current);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      consumeLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim().length > 0) consumeLine(buffer);

  return {
    model,
    content: content.length === 0 ? null : content,
    toolCalls: [...toolCalls.entries()]
      .toSorted(([left], [right]) => left - right)
      .map(([, call]) => validateToolCall(call)),
    finishReason,
    usage,
  };
}

function validateToolCall(call: AccumulatedToolCall): ProviderToolCall {
  if (call.id.length === 0 || call.name.length === 0) {
    throw new Error("OpenAI returned an incomplete tool call");
  }
  return call;
}

interface OpenAIStreamChunk {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    delta: {
      content?: string | null;
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
