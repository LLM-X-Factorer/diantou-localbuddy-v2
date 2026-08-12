import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  InMemoryCalculationRegistry,
  JsonCalculationRegistry,
  type CalculationRecord,
  type CalculationRegistry,
} from "../src/calculations.js";

const original: CalculationRecord = {
  id: "calc-shared",
  runId: "run-1",
  taskId: "worker-task",
  agentId: "worker-1",
  toolName: "compare_ratios",
  operation: "150/120 compared with 1/1",
  inputs: {
    leftNumerator: "150",
    leftDenominator: "120",
    rightNumerator: "1",
    rightDenominator: "1",
  },
  outputs: {
    leftDecimal: "1.25",
    rightDecimal: "1",
    relation: "left_is_higher",
    exactComparison: "5*1 compared with 1*4",
  },
};

test("calculation registries reuse identical evidence across tasks and agents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "localbuddy-calculations-"));
  try {
    for (const registry of registries(join(directory, "calculations.json"))) {
      await registry.add(original);
      await registry.add({
        ...original,
        taskId: "integrator-task",
        agentId: "integrator",
      });

      assert.deepEqual(await registry.list("run-1"), [original]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("calculation registries reject conflicting evidence for one deterministic id", async () => {
  const directory = await mkdtemp(join(tmpdir(), "localbuddy-calculation-conflict-"));
  try {
    for (const registry of registries(join(directory, "calculations.json"))) {
      await registry.add(original);
      await assert.rejects(
        registry.add({
          ...original,
          taskId: "integrator-task",
          agentId: "integrator",
          outputs: { ...original.outputs, leftDecimal: "1.24" },
        }),
        /calculation registry conflict for calc-shared/,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function registries(filePath: string): readonly CalculationRegistry[] {
  return [new InMemoryCalculationRegistry(), new JsonCalculationRegistry(filePath)];
}
