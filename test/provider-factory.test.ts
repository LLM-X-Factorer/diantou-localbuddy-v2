import assert from "node:assert/strict";
import test from "node:test";

import { DeepSeekProvider } from "../src/deepseek-provider.js";
import { OpenAIProvider } from "../src/openai-provider.js";
import { normalizeProviderSelection } from "../src/provider-config.js";
import { createConfiguredProvider } from "../src/provider-factory.js";

test("creates the selected Provider from environment credentials without touching Keychain", async () => {
  const openai = await createConfiguredProvider(
    { id: "openai", model: "fixture-openai" },
    { OPENAI_API_KEY: "fixture-openai-key" },
  );
  const deepseek = await createConfiguredProvider(
    { id: "deepseek", model: "fixture-deepseek" },
    { DEEPSEEK_API_KEY: "fixture-deepseek-key" },
  );

  assert.ok(openai instanceof OpenAIProvider);
  assert.ok(deepseek instanceof DeepSeekProvider);
});

test("rejects unsafe Provider base URLs before resolving credentials", () => {
  assert.throws(
    () => normalizeProviderSelection({ id: "openai", baseUrl: "http://api.example.com/v1" }),
    /HTTPS or loopback HTTP/,
  );
  assert.throws(
    () => normalizeProviderSelection({ id: "deepseek", baseUrl: "https://user:secret@example.com" }),
    /cannot contain credentials/,
  );
  assert.equal(
    normalizeProviderSelection({ id: "openai", baseUrl: "http://127.0.0.1:8080/v1/" }).baseUrl,
    "http://127.0.0.1:8080/v1",
  );
});
