import assert from "node:assert/strict";
import test from "node:test";

import {
  IndependentArtifactReviewer,
  parseArtifactReviewDecision,
} from "../src/artifact-reviewer.js";
import { InMemoryEventStore } from "../src/event-store.js";
import { AuditedModelClient } from "../src/model-runtime.js";
import type { AgentDefinition } from "../src/domain.js";

test("parses a bounded Artifact Reviewer verdict and rejects contradictory contracts", () => {
  assert.deepEqual(parseArtifactReviewDecision(JSON.stringify({
    verdict: "accept",
    summary: "All explicit requirements are met.",
    findings: [],
  })), {
    verdict: "accept",
    summary: "All explicit requirements are met.",
    findings: [],
  });
  assert.throws(
    () => parseArtifactReviewDecision("not json"),
    /invalid JSON/u,
  );
  assert.throws(
    () => parseArtifactReviewDecision(JSON.stringify({
      verdict: "accept",
      summary: "Contradictory",
      findings: [{ priority: "high", requirement: "A", problem: "B", fix: "C" }],
    })),
    /accepted Artifact review cannot contain findings/u,
  );
  assert.throws(
    () => parseArtifactReviewDecision(JSON.stringify({
      verdict: "revise",
      summary: "No actionable finding",
      findings: [],
    })),
    /must contain at least one finding/u,
  );
});

test("fails closed before a Provider call when a candidate exceeds the semantic review bound", async () => {
  const eventStore = new InMemoryEventStore();
  let providerCalls = 0;
  const reviewer = new IndependentArtifactReviewer({
    modelClient: new AuditedModelClient({
      async complete() {
        providerCalls += 1;
        throw new Error("provider must not be called");
      },
    }, eventStore),
    eventStore,
    goalContract: "Create a bounded document.",
  });
  const agent: AgentDefinition = {
    id: "integrator",
    role: "integrator",
    instructions: "Integrate.",
    capabilities: ["integrate"],
    maxParallelTasks: 1,
  };

  await assert.rejects(reviewer.review({
    fileName: "oversized.docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    text: "x".repeat(80_001),
    bytes: 81_000,
    sha256: "a".repeat(64),
  }, {
    runId: "run-review-limit",
    taskId: "integrate",
    agent,
    dependencyOutputs: new Map([["worker", "bounded evidence"]]),
  }), /80000-character semantic review limit/u);

  assert.equal(providerCalls, 0);
  assert.deepEqual(
    (await eventStore.list("run-review-limit")).map((event) => event.type),
    ["artifact.review_requested", "artifact.review_failed"],
  );
});

test("fails closed before a Provider call when a verified parent exceeds the review bound", async () => {
  const eventStore = new InMemoryEventStore();
  let providerCalls = 0;
  const reviewer = new IndependentArtifactReviewer({
    modelClient: new AuditedModelClient({
      async complete() {
        providerCalls += 1;
        throw new Error("provider must not be called");
      },
    }, eventStore),
    eventStore,
    goalContract: "Revise the bounded parent.",
    verifiedParent: {
      fileName: "parent.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      text: "p".repeat(80_001),
      bytes: 100_000,
      sha256: "e".repeat(64),
    },
  });

  await assert.rejects(reviewer.review({
    fileName: "parent.docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    text: "bounded candidate",
    bytes: 2_000,
    sha256: "f".repeat(64),
  }, {
    runId: "run-review-parent-limit",
    taskId: "integrate",
    agent: {
      id: "integrator",
      role: "integrator",
      instructions: "Integrate.",
      capabilities: ["integrate"],
      maxParallelTasks: 1,
    },
    dependencyOutputs: new Map(),
  }), /verified parent exceeds the 80000-character semantic review limit/u);
  assert.equal(providerCalls, 0);
});

test("tells the semantic Reviewer that validated candidate bytes are intentionally pre-publication", async () => {
  const eventStore = new InMemoryEventStore();
  let systemPrompt = "";
  const reviewer = new IndependentArtifactReviewer({
    modelClient: new AuditedModelClient({
      async complete(request) {
        systemPrompt = request.messages.find((message) => message.role === "system")?.content ?? "";
        return {
          model: "review-contract-test",
          content: JSON.stringify({ verdict: "accept", summary: "Content satisfies the goal.", findings: [] }),
          toolCalls: [],
          finishReason: "stop",
        };
      },
    }, eventStore),
    eventStore,
    goalContract: "Create a valid DOCX.",
  });
  const agent: AgentDefinition = {
    id: "integrator",
    role: "integrator",
    instructions: "Integrate.",
    capabilities: ["integrate"],
    maxParallelTasks: 1,
  };

  assert.equal((await reviewer.review({
    fileName: "candidate.docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    text: "Grounded candidate text",
    bytes: 2_048,
    sha256: "b".repeat(64),
  }, {
    runId: "run-review-prepublication",
    taskId: "integrate",
    agent,
    dependencyOutputs: new Map([["worker", "grounded evidence"]]),
  })).verdict, "accept");
  assert.match(systemPrompt, /pre-publication semantic review/u);
  assert.match(systemPrompt, /Do not reject because the file is not yet on disk/u);
  assert.match(systemPrompt, /substitutes a navigation\/footer URL/u);
  assert.match(systemPrompt, /says a source was unselected/u);
  assert.match(systemPrompt, /pending-verification placeholder does not satisfy/u);
});

test("rejects a grossly truncated revision locally before asking the semantic Reviewer", async () => {
  const eventStore = new InMemoryEventStore();
  let providerCalls = 0;
  const parentText = `# Parent\n## Body\n${"parent evidence ".repeat(180)}`;
  const reviewer = new IndependentArtifactReviewer({
    modelClient: new AuditedModelClient({
      async complete() {
        providerCalls += 1;
        throw new Error("deterministic retention failures must not use the Provider");
      },
    }, eventStore),
    eventStore,
    goalContract: "Fix two narrow provenance statements and preserve the rest.",
    verifiedParent: {
      fileName: "report.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      text: parentText,
      bytes: 12_000,
      sha256: "a".repeat(64),
      structure: { paragraphCount: 40, sectionCount: 6, tableCount: 1, tableRowCount: 8 },
    },
  });
  const agent: AgentDefinition = {
    id: "integrator",
    role: "integrator",
    instructions: "Integrate.",
    capabilities: ["integrate"],
    maxParallelTasks: 1,
  };

  const decision = await reviewer.review({
    fileName: "report.docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    text: "# Parent\n## Body\nOnly the two corrected lines remain.",
    bytes: 5_000,
    sha256: "b".repeat(64),
    structure: { paragraphCount: 3, sectionCount: 1, tableCount: 0, tableRowCount: 0 },
  }, {
    runId: "run-review-parent-retention",
    taskId: "integrate",
    agent,
    dependencyOutputs: new Map(),
  });

  assert.equal(decision.verdict, "revise");
  assert.match(decision.findings[0]?.problem ?? "", /below the 50% gross-retention safety floor/u);
  assert.equal(providerCalls, 0);
  const events = await eventStore.list("run-review-parent-retention");
  assert.deepEqual(events.map((event) => event.type), [
    "artifact.review_requested",
    "artifact.review_completed",
  ]);
  assert.equal(events[1]?.data?.deterministicGate, "parent-retention");
});

test("rejects paragraph merging even when the revision keeps the same amount of text", async () => {
  const eventStore = new InMemoryEventStore();
  let providerCalls = 0;
  const text = `# Parent\n## Body\n${"same grounded text ".repeat(120)}`;
  const reviewer = new IndependentArtifactReviewer({
    modelClient: new AuditedModelClient({
      async complete() {
        providerCalls += 1;
        throw new Error("structural retention failures must not use the Provider");
      },
    }, eventStore),
    eventStore,
    goalContract: "Make a narrow edit without changing document structure.",
    verifiedParent: {
      fileName: "report.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      text,
      bytes: 10_000,
      sha256: "c".repeat(64),
      structure: { paragraphCount: 20, sectionCount: 3, tableCount: 1, tableRowCount: 4 },
    },
  });
  const decision = await reviewer.review({
    fileName: "report.docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    text,
    bytes: 9_900,
    sha256: "d".repeat(64),
    structure: { paragraphCount: 12, sectionCount: 3, tableCount: 1, tableRowCount: 4 },
  }, {
    runId: "run-review-paragraph-retention",
    taskId: "integrate",
    agent: {
      id: "integrator",
      role: "integrator",
      instructions: "Integrate.",
      capabilities: ["integrate"],
      maxParallelTasks: 1,
    },
    dependencyOutputs: new Map(),
  });

  assert.equal(decision.verdict, "revise");
  assert.match(decision.findings[0]?.requirement ?? "", /paragraph boundaries/u);
  assert.equal(providerCalls, 0);
});
