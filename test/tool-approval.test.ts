import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryEventStore } from "../src/event-store.js";
import {
  approvalArgumentsPreview,
  InteractiveToolApprovalBroker,
} from "../src/tool-approval.js";
import type { ToolApprovalInput } from "../src/tool-approval.js";

test("queues one exact effectful tool call and records the user's one-shot decision", async () => {
  const eventStore = new InMemoryEventStore();
  const broker = new InteractiveToolApprovalBroker({ eventStore });
  const decisionPromise = broker.request(approvalInput({ value: "publish" }));
  await waitFor(() => broker.list().length === 1);
  const pending = broker.list()[0];
  assert.equal(pending?.toolName, "mcp_fixture_record");
  assert.match(pending?.argumentsPreview ?? "", /publish/);
  assert.match(pending?.argumentsSha256 ?? "", /^[a-f0-9]{64}$/);

  await broker.resolve(pending!.id, "approve");
  assert.deepEqual(await decisionPromise, {
    allowed: true,
    reason: "approved once by the local user",
  });
  assert.equal(broker.list().length, 0);
  const events = await eventStore.list("run-approval");
  assert.deepEqual(events.map((event) => event.type), ["approval.requested", "approval.resolved"]);
  assert.equal(events[1]?.data?.decision, "approve");
  assert.equal(events[0]?.data?.argumentsPreview, undefined);
});

test("denies a pending approval when the Run is cancelled", async () => {
  const eventStore = new InMemoryEventStore();
  const controller = new AbortController();
  const broker = new InteractiveToolApprovalBroker({ eventStore });
  const decisionPromise = broker.request(approvalInput({ value: "external-write" }, controller.signal));
  await waitFor(() => broker.list().length === 1);
  controller.abort();

  assert.deepEqual(await decisionPromise, {
    allowed: false,
    reason: "Run was cancelled while approval was pending",
  });
  assert.equal(broker.list().length, 0);
});

test("redacts credentials and browser field values from approval previews", () => {
  assert.doesNotMatch(
    approvalArgumentsPreview("mcp_remote_write", JSON.stringify({ apiKey: "secret-value", nested: { password: "hidden" } })),
    /secret-value|hidden/,
  );
  assert.deepEqual(
    JSON.parse(approvalArgumentsPreview("browser_fill", JSON.stringify({ label: "Password", value: "hunter2" }))),
    { label: "Password", value: "[redacted]" },
  );
});

function approvalInput(argumentsValue: unknown, signal?: AbortSignal): ToolApprovalInput {
  return {
    tool: {
      name: "mcp_fixture_record",
      description: "Represent an external write.",
      parameters: { type: "object" },
      risk: "execute",
      permission: "external.effect",
      parse: (value) => value,
      execute: async () => undefined,
    },
    context: {
      runId: "run-approval",
      taskId: "task-approval",
      signal,
      agent: {
        id: "worker-1",
        role: "worker",
        instructions: "test",
        capabilities: ["worker"],
        maxParallelTasks: 1,
      },
    },
    toolCall: {
      id: "tool-call-1",
      name: "mcp_fixture_record",
      arguments: JSON.stringify(argumentsValue),
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
  throw new Error("Condition was not met before timeout");
}
