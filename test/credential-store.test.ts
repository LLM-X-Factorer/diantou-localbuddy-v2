import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteProviderApiKey,
  inspectProviderCredential,
  resolveProviderApiKey,
  storeProviderApiKey,
} from "../src/credential-store.js";
import type { SecureJsonStore } from "../src/secure-json-store.js";

class MemoryCredentialStore implements SecureJsonStore {
  readonly values = new Map<string, unknown>();

  async load(account: string): Promise<unknown | undefined> {
    return this.values.get(account);
  }

  async save(account: string, value: unknown): Promise<void> {
    this.values.set(account, value);
  }

  async delete(account: string): Promise<void> {
    this.values.delete(account);
  }
}

test("reports credential source without returning secret bytes", async () => {
  const store = new MemoryCredentialStore();
  assert.deepEqual(
    await inspectProviderCredential("deepseek", {}, store),
    { available: false, source: "none" },
  );

  await storeProviderApiKey("deepseek", "  stored-secret-value  ", store);
  assert.deepEqual(
    await inspectProviderCredential("deepseek", {}, store),
    { available: true, source: "system" },
  );
  assert.equal(await resolveProviderApiKey("deepseek", {}, store), "stored-secret-value");

  assert.deepEqual(
    await inspectProviderCredential("deepseek", { DEEPSEEK_API_KEY: "environment-secret" }, store),
    { available: true, source: "environment" },
  );
  assert.equal(
    await resolveProviderApiKey("deepseek", { DEEPSEEK_API_KEY: "environment-secret" }, store),
    "environment-secret",
  );
});

test("replaces and deletes only the selected provider credential", async () => {
  const deepseek = new MemoryCredentialStore();
  const openai = new MemoryCredentialStore();
  await storeProviderApiKey("deepseek", "first-secret-value", deepseek);
  await storeProviderApiKey("deepseek", "replacement-value", deepseek);
  await storeProviderApiKey("openai", "openai-secret-value", openai);

  assert.equal(await resolveProviderApiKey("deepseek", {}, deepseek), "replacement-value");
  await deleteProviderApiKey("deepseek", deepseek);
  assert.deepEqual(
    await inspectProviderCredential("deepseek", {}, deepseek),
    { available: false, source: "none" },
  );
  assert.equal(await resolveProviderApiKey("openai", {}, openai), "openai-secret-value");
});
