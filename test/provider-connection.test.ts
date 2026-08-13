import assert from "node:assert/strict";
import test from "node:test";

import { verifyProviderConnection } from "../src/provider-connection.js";

test("verifies credentials with an explicit non-generating models request", async () => {
  let observedUrl = "";
  let observedAuthorization = "";
  let observedMethod = "";
  const result = await verifyProviderConnection(
    { id: "openai", baseUrl: "https://provider.example/v1" },
    { OPENAI_API_KEY: "fixture-openai-secret" },
    (async (input, init) => {
      observedUrl = String(input);
      observedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      observedMethod = init?.method ?? "";
      return new Response(null, { status: 200 });
    }) as typeof fetch,
  );

  assert.deepEqual(result, { providerId: "openai", verified: true });
  assert.equal(observedUrl, "https://provider.example/v1/models");
  assert.equal(observedAuthorization, "Bearer fixture-openai-secret");
  assert.equal(observedMethod, "GET");
});

test("bounds connection failures without returning provider response bodies", async () => {
  await assert.rejects(
    verifyProviderConnection(
      { id: "deepseek" },
      { DEEPSEEK_API_KEY: "fixture-deepseek-secret" },
      (async () => new Response("secret echoed by remote", { status: 401 })) as typeof fetch,
    ),
    (error: unknown) => {
      assert.match(String(error), /DeepSeek connection check failed \(HTTP 401\)/);
      assert.doesNotMatch(String(error), /secret echoed|fixture-deepseek-secret/);
      return true;
    },
  );
});
