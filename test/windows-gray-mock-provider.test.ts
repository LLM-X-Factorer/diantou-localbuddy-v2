import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureModule = await import(pathToFileURL(
  resolve(repository, "scripts", "windows-gray-mock-provider.mjs"),
).href) as {
  startWindowsGrayMockProvider(apiKey: string): Promise<{
    baseUrl: string;
    state: { modelRequests: number; completionRequests: number };
    close(): Promise<void>;
  }>;
};

test("Windows gray Provider fixture is loopback-only and supports deterministic failures", async (context) => {
  const apiKey = "localbuddy-public-fixture-key";
  const provider = await fixtureModule.startWindowsGrayMockProvider(apiKey);
  context.after(() => provider.close());
  assert.match(provider.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

  const unauthorized = await fetch(`${provider.baseUrl}/unauthorized/v1/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert.equal(unauthorized.status, 401);
  const rateLimited = await fetch(`${provider.baseUrl}/rate-limited/v1/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert.equal(rateLimited.status, 429);
  const unavailable = await fetch(`${provider.baseUrl}/server-error/v1/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert.equal(unavailable.status, 500);

  const models = await fetch(`${provider.baseUrl}/v1/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  assert.equal(models.status, 200);
  assert.match(await models.text(), /localbuddy-windows-gray/);
});

test("Windows gray Provider fixture streams a valid OpenAI-compatible plan", async (context) => {
  const apiKey = "localbuddy-public-fixture-key";
  const provider = await fixtureModule.startWindowsGrayMockProvider(apiKey);
  context.after(() => provider.close());
  const response = await fetch(`${provider.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: "Plan the fixture Run" }],
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /inspect-fixture/);
  assert.match(body, /windows-gray-report\.md/);
  assert.match(body, /data: \[DONE\]/);
  assert.equal(provider.state.completionRequests, 1);
});
