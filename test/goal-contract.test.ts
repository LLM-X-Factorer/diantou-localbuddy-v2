import assert from "node:assert/strict";
import test from "node:test";

import {
  compileGoalContract,
  formatGoalContract,
  normalizeGoalContract,
} from "../src/goal-contract.js";

test("normalizes a bounded Goal Contract and compiles its execution text", () => {
  const contract = normalizeGoalContract({
    outcome: "  Produce a grounded policy brief.  ",
    constraints: ["Official sources only", "Official sources only", "No implicit folder scan"],
    verificationCriteria: ["Every claim has a source", "Inference is labelled"],
  });

  assert.deepEqual(contract, {
    version: 1,
    revision: 1,
    outcome: "Produce a grounded policy brief.",
    constraints: ["Official sources only", "No implicit folder scan"],
    verificationCriteria: ["Every claim has a source", "Inference is labelled"],
  });
  assert.match(formatGoalContract(contract), /^Outcome:\nProduce a grounded policy brief\./u);
  assert.match(compileGoalContract(contract), /Verification criteria:\n- Every claim has a source/u);
});

test("preserves the exact legacy execution goal when no structured fields were supplied", () => {
  const contract = normalizeGoalContract({ outcome: "  Keep this legacy prompt stable  " });
  assert.equal(compileGoalContract(contract), "Keep this legacy prompt stable");
});

test("rejects empty, oversized, and over-populated Goal Contracts", () => {
  assert.throws(() => normalizeGoalContract({ outcome: "   " }), /Goal outcome/u);
  assert.throws(
    () => normalizeGoalContract({ outcome: "x", constraints: ["x".repeat(1_001)] }),
    /between 1 and 1000 characters/u,
  );
  assert.throws(
    () => normalizeGoalContract({
      outcome: "x",
      verificationCriteria: Array.from({ length: 21 }, (_, index) => `criterion-${index}`),
    }),
    /at most 20 items/u,
  );
});
