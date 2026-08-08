export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ProviderToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: readonly ProviderToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };

export interface ProviderToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelRequest {
  messages: readonly ChatMessage[];
  tools?: readonly ProviderToolDefinition[];
  responseFormat?: "text" | "json_object";
  temperature?: number;
  maxTokens?: number;
}

export interface ModelUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ModelResponse {
  model: string;
  content: string | null;
  reasoningContent?: string | null;
  toolCalls: readonly ProviderToolCall[];
  finishReason: string;
  usage?: ModelUsage;
}

export interface ModelStreamOptions {
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
}

export interface ModelProvider {
  complete(request: ModelRequest, options?: ModelStreamOptions): Promise<ModelResponse>;
}
