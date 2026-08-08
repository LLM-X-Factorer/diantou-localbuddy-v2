import assert from "node:assert/strict";
import test from "node:test";

import { OpenAIProvider } from "../src/openai-provider.js";

test("assembles streamed OpenAI content, tool calls, usage, and standard request fields", async () => {
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> | undefined;
  const sse = [
    'data: {"model":"gpt-5-mini","choices":[{"delta":{"content":"checking "},"finish_reason":null}]}',
    'data: {"model":"gpt-5-mini","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_","arguments":"{\\"path\\":\\""}}]},"finish_reason":null}]}',
    'data: {"model":"gpt-5-mini","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"notes.md\\"}"}}]},"finish_reason":"tool_calls"}]}',
    'data: {"model":"gpt-5-mini","choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}',
    "data: [DONE]",
    "",
  ].join("\n");
  const provider = new OpenAIProvider({
    apiKey: "test-openai-key",
    model: "gpt-5-mini",
    fetch: (async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch,
  });
  let streamed = "";
  const response = await provider.complete({
    messages: [{ role: "user", content: "read notes" }],
    tools: [{ name: "read_file", description: "read", parameters: { type: "object" } }],
    maxTokens: 800,
  }, { onTextDelta: (delta) => { streamed += delta; } });

  assert.equal(capturedUrl, "https://api.openai.com/v1/chat/completions");
  assert.equal(streamed, "checking ");
  assert.equal(response.usage?.totalTokens, 18);
  assert.deepEqual(response.toolCalls, [
    { id: "call_1", name: "read_file", arguments: '{"path":"notes.md"}' },
  ]);
  assert.equal(capturedBody?.max_completion_tokens, 800);
  assert.equal(capturedBody?.thinking, undefined);
});

test("bounds OpenAI error response bodies", async () => {
  const provider = new OpenAIProvider({
    apiKey: "test-openai-key",
    fetch: (async () => new Response("x".repeat(2_000), { status: 401 })) as typeof fetch,
  });
  await assert.rejects(
    provider.complete({ messages: [{ role: "user", content: "hello" }] }),
    (error: unknown) => error instanceof Error && error.message.length < 1_100,
  );
});
