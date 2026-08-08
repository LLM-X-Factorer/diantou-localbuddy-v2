import assert from "node:assert/strict";
import test from "node:test";

import { DeepSeekProvider } from "../src/deepseek-provider.js";

test("assembles streamed DeepSeek content, tool calls, and usage", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const sse = [
    'data: {"model":"deepseek-v4-flash","choices":[{"delta":{"content":"checking "},"finish_reason":null}]}',
    'data: {"model":"deepseek-v4-flash","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_","arguments":"{\\"path\\":\\""}}]},"finish_reason":null}]}',
    'data: {"model":"deepseek-v4-flash","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"notes.md\\"}"}}]},"finish_reason":"tool_calls"}]}',
    'data: {"model":"deepseek-v4-flash","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
    "data: [DONE]",
    "",
  ].join("\n");
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    fetch: (async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch,
  });
  let streamed = "";

  const response = await provider.complete(
    {
      messages: [{ role: "user", content: "read notes" }],
      tools: [{
        name: "read_file",
        description: "read a file",
        parameters: { type: "object" },
      }],
    },
    { onTextDelta: (delta) => { streamed += delta; } },
  );

  assert.equal(streamed, "checking ");
  assert.equal(response.finishReason, "tool_calls");
  assert.deepEqual(response.toolCalls, [
    { id: "call_1", name: "read_file", arguments: '{"path":"notes.md"}' },
  ]);
  assert.equal(response.usage?.totalTokens, 15);
  assert.equal(capturedBody?.stream, true);
  assert.deepEqual(capturedBody?.stream_options, { include_usage: true });
});

test("does not include response bodies beyond the provider error bound", async () => {
  const provider = new DeepSeekProvider({
    apiKey: "test-key",
    fetch: (async () => new Response("x".repeat(2_000), { status: 401 })) as typeof fetch,
  });
  await assert.rejects(
    provider.complete({ messages: [{ role: "user", content: "hello" }] }),
    (error: unknown) => error instanceof Error && error.message.length < 1_100,
  );
});

