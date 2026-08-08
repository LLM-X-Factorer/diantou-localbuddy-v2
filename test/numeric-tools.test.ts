import assert from "node:assert/strict";
import test from "node:test";

import type { AgentDefinition } from "../src/domain.js";
import { InMemoryCalculationRegistry } from "../src/calculations.js";
import { InMemoryEventStore } from "../src/event-store.js";
import { createNumericTools } from "../src/numeric-tools.js";
import { RoleBasedApprovalPolicy, ToolRegistry, ToolRuntime } from "../src/tool-runtime.js";

const worker: AgentDefinition = {
  id: "worker",
  role: "worker",
  instructions: "calculate only through tools",
  capabilities: ["worker"],
  maxParallelTasks: 1,
};

test("compares ratios with exact cross multiplication", async () => {
  const store = new InMemoryEventStore();
  const runtime = new ToolRuntime(
    new ToolRegistry(createNumericTools(new InMemoryCalculationRegistry())),
    new RoleBasedApprovalPolicy(),
    store,
  );
  const result = await runtime.execute(
    {
      id: "ratio-1",
      name: "compare_ratios",
      arguments: JSON.stringify({
        leftNumerator: "46",
        leftDenominator: "128",
        rightNumerator: "39",
        rightDenominator: "104",
      }),
    },
    { runId: "run", taskId: "metrics", agent: worker },
    ["compare_ratios"],
  );

  assert.equal(result.isError, false);
  const output = JSON.parse(result.content) as Record<string, unknown>;
  assert.equal(output.leftDecimal, "0.359375");
  assert.equal(output.rightDecimal, "0.375");
  assert.equal(output.relation, "left_is_lower");
  assert.equal(output.exactComparison, "23*8 compared with 3*64");
  assert.match(String(output.calculationId), /^calc-[a-f0-9]{12}$/);
});

test("rejects zero denominators without falling back to model arithmetic", async () => {
  const runtime = new ToolRuntime(
    new ToolRegistry(createNumericTools(new InMemoryCalculationRegistry())),
    new RoleBasedApprovalPolicy(),
    new InMemoryEventStore(),
  );
  const result = await runtime.execute(
    {
      id: "ratio-zero",
      name: "compare_ratios",
      arguments: JSON.stringify({
        leftNumerator: "1",
        leftDenominator: "0",
        rightNumerator: "1",
        rightDenominator: "2",
      }),
    },
    { runId: "run", taskId: "metrics", agent: worker },
    ["compare_ratios"],
  );
  assert.equal(result.isError, true);
  assert.match(result.content, /denominator cannot be zero/);
});
