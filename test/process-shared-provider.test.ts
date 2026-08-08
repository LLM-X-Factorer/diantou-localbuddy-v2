import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ModelProvider, ModelResponse } from "../src/provider.js";
import { ProcessSharedProvider } from "../src/process-shared-provider.js";

const request = { messages: [{ role: "user" as const, content: "test" }] };

test("shares Provider capacity across independent wrapper instances", async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), "localbuddy-provider-capacity-"));
  context.after(async () => rm(stateRoot, { recursive: true, force: true }));
  let releaseFirst: (() => void) | undefined;
  let entered = 0;
  const firstProvider = provider(async () => {
    entered += 1;
    await new Promise<void>((resolvePromise) => { releaseFirst = resolvePromise; });
    return response(3);
  });
  const secondProvider = provider(async () => {
    entered += 1;
    return response(4);
  });
  const first = new ProcessSharedProvider({
    provider: firstProvider,
    providerId: "fixture",
    stateRoot,
    maxConcurrentRequests: 1,
  });
  const second = new ProcessSharedProvider({
    provider: secondProvider,
    providerId: "fixture",
    stateRoot,
    maxConcurrentRequests: 1,
  });
  const firstCall = first.complete(request);
  await waitFor(() => releaseFirst !== undefined);
  const secondCall = second.complete(request);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  assert.equal(entered, 1);
  releaseFirst?.();
  await Promise.all([firstCall, secondCall]);
  assert.equal(entered, 2);
});

test("persists a daily token ledger and blocks calls after the configured budget", async (context) => {
  const stateRoot = await mkdtemp(join(tmpdir(), "localbuddy-provider-budget-"));
  context.after(async () => rm(stateRoot, { recursive: true, force: true }));
  let calls = 0;
  const coordinated = new ProcessSharedProvider({
    provider: provider(async () => {
      calls += 1;
      return response(10);
    }),
    providerId: "fixture",
    stateRoot,
    maxConcurrentRequests: 2,
    dailyTokenBudget: 10,
  });
  await coordinated.complete(request);
  await assert.rejects(coordinated.complete(request), /token budget is exhausted/);
  assert.equal(calls, 1);
});

function provider(complete: ModelProvider["complete"]): ModelProvider {
  return { complete };
}

function response(totalTokens: number): ModelResponse {
  return {
    model: "fixture",
    content: "ok",
    toolCalls: [],
    finishReason: "stop",
    usage: { totalTokens },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error("condition was not reached");
}
