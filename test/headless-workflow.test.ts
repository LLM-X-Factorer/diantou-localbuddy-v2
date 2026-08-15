import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InMemoryEventStore } from "../src/event-store.js";
import { isIndependentArtifactReviewRequest } from "../src/artifact-reviewer.js";
import { ensureResearchSourceCoverage, HeadlessWorkflow } from "../src/headless-workflow.js";
import { DOCX_MEDIA_TYPE, inspectDocxArtifact } from "../src/docx-artifact.js";
import { parsePlan, WorkflowPlanner } from "../src/planner.js";
import { AuditedModelClient } from "../src/model-runtime.js";
import type { ChatMessage, ModelProvider, ModelRequest, ModelResponse } from "../src/provider.js";

test("Artifact revisions inherit the verified parent filename when the planner omits it", () => {
  const response = JSON.stringify({
    tasks: [{ id: "revise", title: "Revise", instructions: "Continue the same document." }],
    integration: { instructions: "Deliver the revision." },
  });
  assert.equal(parsePlan(response, 3, "parent.docx").integration.fileName, "parent.docx");
  assert.throws(() => parsePlan(response, 3), /integration\.fileName must be a non-empty string/u);
});

test("shares a selected source manifest with every worker that needs provenance", () => {
  const plan = ensureResearchSourceCoverage({
    tasks: [
      {
        id: "national",
        title: "National plan",
        instructions: "Read source-2.",
        sourceIds: ["source-2"],
      },
      {
        id: "provincial",
        title: "Provincial plan",
        instructions: "Read source-3.",
        sourceIds: ["source-3"],
      },
    ],
    integration: { instructions: "Integrate with original URLs.", fileName: "report.docx" },
  }, [
    { id: "source-1", path: "/selected/00-source-manifest.txt", name: "00-source-manifest.txt", kind: "file" },
    { id: "source-2", path: "/selected/national.txt", name: "national.txt", kind: "file" },
    { id: "source-3", path: "/selected/provincial.txt", name: "provincial.txt", kind: "file" },
  ]);

  assert.deepEqual(plan.tasks.map((task) => task.sourceIds), [
    ["source-2", "source-1"],
    ["source-3", "source-1"],
  ]);
  assert.ok(plan.tasks.every((task) => task.instructions.includes("shared source metadata")));
});

test("repairs one malformed Orchestrator JSON response before failing the Run", async () => {
  const eventStore = new InMemoryEventStore();
  let calls = 0;
  let repairPrompt = "";
  const planner = new WorkflowPlanner(new AuditedModelClient({
    async complete(request) {
      calls += 1;
      if (calls === 1) {
        return response(JSON.stringify({
          tasks: [{ id: "read-source", title: "Read source", instructions: "Read source-1." }],
          integration: { instructions: "Integrate." },
        }));
      }
      repairPrompt = request.messages.at(-1)?.content ?? "";
      return response(JSON.stringify({
        tasks: [{ id: "read-source", title: "Read source", instructions: "Read source-1." }],
        integration: { instructions: "Integrate.", fileName: "report.docx" },
      }));
    },
  }, eventStore), eventStore);

  const plan = await planner.plan(
    "run-plan-repair",
    "Create report.docx",
    ["source-1: policy.txt (file)"],
  );
  assert.equal(plan.integration.fileName, "report.docx");
  assert.equal(calls, 2);
  assert.match(repairPrompt, /integration\.fileName must be a non-empty string/u);
  assert.equal(
    (await eventStore.list("run-plan-repair")).find((event) => event.type === "plan.created")
      ?.data?.repairAttempts,
    1,
  );
});

test("plans parallel workers and integrates their grounded outputs into an artifact", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "localbuddy-workflow-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "metrics.csv"), "leads,128\norders,8\n", "utf8");
  await writeFile(join(directory, "notes.md"), "ROI remains unknown.\n", "utf8");
  const artifactRoot = join(directory, ".localbuddy", "runs", "run-e2e", "artifacts");
  await mkdir(artifactRoot, { recursive: true });
  const eventStore = new InMemoryEventStore();
  const goal = "Create a grounded weekly report from local evidence";
  const workflow = new HeadlessWorkflow({
    provider: new DeterministicWorkflowProvider(),
    eventStore,
    workspaceRoot: directory,
    sourcePaths: [join(directory, "metrics.csv"), join(directory, "notes.md")],
    artifactRoot,
    globalConcurrency: 3,
  });

  const result = await workflow.run("run-e2e", goal);

  assert.equal(result.summary.status, "succeeded");
  assert.equal(result.summary.tasks.get("analyze-metrics")?.status, "succeeded");
  assert.equal(result.summary.tasks.get("analyze-notes")?.status, "succeeded");
  assert.equal(result.summary.tasks.get("integrate")?.status, "succeeded");
  assert.equal(result.artifacts.length, 1);
  const content = await readFile(result.artifacts[0]?.absolutePath ?? "", "utf8");
  assert.match(content, /128 leads/);
  assert.match(content, /ROI remains unknown/);
  assert.match(content, /0\.359375 is lower than 0\.375/);

  const events = await eventStore.list("run-e2e");
  assert.ok(events.some((event) => event.type === "plan.created"));
  assert.ok(events.some((event) => event.type === "artifact.created"));
  assert.equal(JSON.stringify(events).includes(goal), false);
  const workerStarts = events.filter(
    (event) => event.type === "task.started" && event.taskId !== "integrate",
  );
  assert.equal(workerStarts.length, 2);
  assert.deepEqual(new Set(workerStarts.map((event) => event.agentId)), new Set(["worker-1", "worker-2"]));
});

test("records a failed lifecycle when workspace setup fails before planning", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "localbuddy-workflow-setup-failure-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const eventStore = new InMemoryEventStore();
  let modelCalls = 0;
  const workflow = new HeadlessWorkflow({
    provider: {
      async complete() {
        modelCalls += 1;
        throw new Error("model must not be called");
      },
    },
    eventStore,
    workspaceRoot: join(directory, "missing-workspace"),
    artifactRoot: join(directory, "artifacts"),
  });

  await assert.rejects(workflow.run("run-setup-failure", "Inspect the workspace"), /ENOENT/);
  const events = await eventStore.list("run-setup-failure");

  assert.equal(modelCalls, 0);
  assert.deepEqual(events.map((event) => event.type), ["run.started", "run.failed"]);
});

test("propagates the failed task reason into the terminal Run event", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "localbuddy-workflow-task-failure-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const eventStore = new InMemoryEventStore();
  const workflow = new HeadlessWorkflow({
    provider: {
      async complete(request) {
        if (request.responseFormat === "json_object") {
          return response(JSON.stringify({
            tasks: [{ id: "inspect", title: "Inspect", instructions: "Inspect the evidence." }],
            integration: { instructions: "Write the report.", fileName: "report.md" },
          }));
        }
        throw new Error("fixture worker failure");
      },
    },
    eventStore,
    workspaceRoot: directory,
    sourcePaths: [],
    artifactRoot: join(directory, "artifacts"),
    globalConcurrency: 1,
  });

  const result = await workflow.run("run-task-failure", "Write a verified report");
  const events = await eventStore.list("run-task-failure");
  const terminal = events.at(-1);

  assert.equal(result.summary.status, "failed");
  assert.equal(terminal?.type, "run.failed");
  assert.match(String(terminal?.data?.error), /Task inspect failed: fixture worker failure/u);
});

test("does not expose project paths or local read tools when no research sources are selected", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "localbuddy-workflow-no-sources-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "private-project-note.md"), "must not enter model context", "utf8");
  const provider = new NoLocalSourcesProvider();
  const runRoot = join(directory, ".localbuddy", "runs", "run-no-sources");
  const result = await new HeadlessWorkflow({
    provider,
    eventStore: new InMemoryEventStore(),
    workspaceRoot: directory,
    sourcePaths: [],
    artifactRoot: join(runRoot, "artifacts"),
    checkpointRoot: join(runRoot, "checkpoint"),
    globalConcurrency: 1,
  }).run("run-no-sources", "State the evidence gap in no-sources.md");

  assert.equal(result.summary.status, "succeeded");
  assert.equal(provider.plannerSawPrivatePath, false);
  assert.equal(provider.workerHadReadTool, false);
});

test("plans and writes a structurally verified editable DOCX artifact", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "localbuddy-docx-workflow-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, "meeting-notes.md");
  await writeFile(sourcePath, "负责人：李闻\n截止日期：2026-08-12\n交付物：冻结试点功能清单\n", "utf8");
  const artifactRoot = join(directory, ".localbuddy", "runs", "run-docx", "artifacts");
  const result = await new HeadlessWorkflow({
    provider: new DeterministicDocxProvider(),
    eventStore: new InMemoryEventStore(),
    workspaceRoot: directory,
    sourcePaths: [sourcePath],
    artifactRoot,
    globalConcurrency: 1,
  }).run("run-docx", "根据已选择资料生成可编辑的 pilot.docx");

  assert.equal(result.summary.status, "succeeded");
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0]?.mediaType, DOCX_MEDIA_TYPE);
  assert.equal(result.artifacts[0]?.relativePath, "pilot.docx");
  const inspection = inspectDocxArtifact(await readFile(result.artifacts[0]?.absolutePath ?? ""));
  assert.equal(inspection.title, "CRM 内部试点会议纪要");
  assert.match(inspection.text, /李闻\t2026-08-12\t冻结试点功能清单/u);
});

test("an independent Reviewer sends a rejected DOCX candidate back for bounded revision", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "localbuddy-docx-review-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, "evidence.md");
  await writeFile(sourcePath, "交付要求：必须说明风险。\n", "utf8");
  const eventStore = new InMemoryEventStore();
  const result = await new HeadlessWorkflow({
    provider: new ReviewRevisionProvider(false),
    eventStore,
    workspaceRoot: directory,
    sourcePaths: [sourcePath],
    artifactRoot: join(directory, "artifacts"),
    globalConcurrency: 1,
  }).run("run-review-revision", "生成 review.docx，并明确说明风险。");

  assert.equal(result.summary.status, "succeeded");
  assert.equal(result.artifacts.length, 1);
  const inspection = inspectDocxArtifact(await readFile(result.artifacts[0]?.absolutePath ?? ""));
  assert.match(inspection.text, /## 风险/u);
  const events = await eventStore.list("run-review-revision");
  assert.equal(events.filter((event) => event.type === "artifact.review_requested").length, 2);
  assert.deepEqual(
    events.filter((event) => event.type === "artifact.review_completed")
      .map((event) => event.data?.verdict),
    ["revise", "accept"],
  );
  assert.equal(events.filter((event) => event.type === "artifact.created").length, 1);
  assert.match(
    String(events.find((event) => event.type === "tool.failed")?.data?.error),
    /requested revision with 1 finding/u,
  );
  assert.equal(JSON.stringify(events).includes("PRIVATE_REVIEW_DETAIL"), false);
});

test("stops after three independent Reviewer rejections without publishing a DOCX", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "localbuddy-docx-review-budget-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const eventStore = new InMemoryEventStore();
  const provider = new ReviewRevisionProvider(true);
  const workflow = new HeadlessWorkflow({
    provider,
    eventStore,
    workspaceRoot: directory,
    sourcePaths: [],
    artifactRoot: join(directory, "artifacts"),
    globalConcurrency: 1,
  });
  const result = await workflow.run("run-review-budget", "生成 review.docx，并明确说明风险。");

  assert.equal(result.summary.status, "failed");
  assert.equal(result.artifacts.length, 0);
  const events = await eventStore.list("run-review-budget");
  assert.equal(events.filter((event) => event.type === "artifact.review_requested").length, 3);
  assert.equal(events.filter((event) => event.type === "artifact.review_completed").length, 3);
  assert.equal(events.filter((event) => event.type === "tool.failed").length, 3);
  assert.match(String(events.at(-1)?.data?.error), /rejected 3 candidates/u);
  assert.equal(JSON.stringify(events).includes("PRIVATE_REVIEW_DETAIL"), false);

  const resumed = await workflow.resume("run-review-budget", "生成 review.docx，并明确说明风险。");
  assert.equal(resumed.summary.status, "failed");
  assert.equal(resumed.artifacts.length, 0);
  assert.equal(provider.reviewCalls, 3);
  assert.ok((await eventStore.list("run-review-budget")).some((event) => event.type === "run.resumed"));
});

test("gives the Integrator the verified parent and revises a locally rejected truncation", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "localbuddy-docx-parent-retention-"));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  const parentText = `# Parent report\n\n## Original evidence\n${"grounded parent content ".repeat(80)}`;
  const provider = new ParentAwareRevisionProvider(parentText);
  const eventStore = new InMemoryEventStore();
  const result = await new HeadlessWorkflow({
    provider,
    eventStore,
    workspaceRoot: directory,
    sourcePaths: [],
    artifactRoot: join(directory, "artifacts"),
    globalConcurrency: 1,
    requiredArtifactFileName: "parent.docx",
    verifiedParentArtifact: {
      fileName: "parent.docx",
      mediaType: DOCX_MEDIA_TYPE,
      text: parentText,
      bytes: 12_000,
      sha256: "c".repeat(64),
      structure: { paragraphCount: 3, sectionCount: 1, tableCount: 0, tableRowCount: 0 },
    },
  }).run("run-parent-retention", "Add one revision note and preserve the parent report.");

  assert.equal(result.summary.status, "succeeded");
  assert.equal(provider.integratorSawVerifiedParent, true);
  assert.equal(provider.semanticReviewCalls, 1);
  const inspection = inspectDocxArtifact(await readFile(result.artifacts[0]?.absolutePath ?? ""));
  assert.match(inspection.text, /grounded parent content/u);
  assert.match(inspection.text, /## Revision note/u);
  const reviews = (await eventStore.list("run-parent-retention"))
    .filter((event) => event.type === "artifact.review_completed");
  assert.deepEqual(reviews.map((event) => event.data?.verdict), ["revise", "accept"]);
  assert.equal(reviews[0]?.data?.deterministicGate, "parent-retention");
});

class DeterministicWorkflowProvider implements ModelProvider {
  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [
          {
            id: "analyze-metrics",
            title: "Analyze metrics",
            instructions: "Read metrics.csv and report exact values.",
          },
          {
            id: "analyze-notes",
            title: "Analyze notes",
            instructions: "Read notes.md and report stated uncertainties.",
          },
        ],
        integration: {
          instructions: "Combine exact metrics and uncertainties into a Markdown report.",
          fileName: "weekly-report.md",
        },
      }));
    }

    const prompt = findLastUserMessage(request.messages);
    const toolResultIds = new Set(
      request.messages
        .filter((message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool")
        .map((message) => message.toolCallId),
    );
    if (prompt.includes("Task ID: analyze-metrics")) {
      if (!toolResultIds.has("metrics-read")) {
        return toolResponse("metrics-read", "read_file", { path: "source-1" });
      }
      if (!toolResultIds.has("metrics-ratio")) {
        return toolResponse("metrics-ratio", "compare_ratios", {
          leftNumerator: "46",
          leftDenominator: "128",
          rightNumerator: "39",
          rightDenominator: "104",
        });
      }
      const ratioResult = findToolResult(request.messages, "metrics-ratio");
      const calculationId = String((JSON.parse(ratioResult) as Record<string, unknown>).calculationId);
      return response(`metrics finding: 128 leads and 8 orders; 0.359375 is lower than 0.375 [${calculationId}]`);
    }
    if (prompt.includes("Task ID: analyze-notes")) {
      return toolResultIds.has("notes-read")
        ? response("notes finding: ROI remains unknown")
        : toolResponse("notes-read", "read_file", { path: "source-2" });
    }
    if (prompt.includes("Task ID: integrate")) {
      assert.match(prompt, /128 leads/);
      assert.match(prompt, /ROI remains unknown/);
      assert.match(prompt, /Preserve source provenance.*source titles, dates, and URLs/);
      const calculationIds = [...prompt.matchAll(/calc-[a-f0-9]{12}/g)].map((match) => match[0]);
      return toolResultIds.has("artifact-write")
        ? response("Artifact written and registered.")
        : toolResponse("artifact-write", "write_artifact", {
            fileName: "weekly-report.md",
            content: `# Weekly report\n\n- 128 leads\n- 8 orders\n- 0.359375 is lower than 0.375 [${calculationIds[0]}]\n- ROI remains unknown\n`,
            calculationIds,
          });
    }
    throw new Error(`Unexpected request: ${prompt}`);
  }
}

class NoLocalSourcesProvider implements ModelProvider {
  plannerSawPrivatePath = false;
  workerHadReadTool = false;

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const serializedMessages = JSON.stringify(request.messages);
    if (request.responseFormat === "json_object") {
      this.plannerSawPrivatePath = serializedMessages.includes("private-project-note.md");
      assert.match(serializedMessages, /No local research sources were selected/);
      return response(JSON.stringify({
        tasks: [{ id: "identify-gap", title: "Identify evidence gap", instructions: "State the gap." }],
        integration: { instructions: "Write an honest result.", fileName: "no-sources.md" },
      }));
    }
    const prompt = findLastUserMessage(request.messages);
    if (prompt.includes("Task ID: identify-gap")) {
      this.workerHadReadTool = (request.tools ?? []).some((tool) =>
        tool.name === "read_file" || tool.name === "search_files");
      return response("No local evidence was selected.");
    }
    if (prompt.includes("Task ID: integrate")) {
      const wrote = request.messages.some((message) => message.role === "tool");
      return wrote
        ? response("done")
        : toolResponse("write-no-sources", "write_artifact", {
            fileName: "no-sources.md",
            content: "# Evidence gap\n\nNo local evidence was selected.\n",
            calculationIds: [],
          });
    }
    throw new Error(`Unexpected request: ${prompt}`);
  }
}

class DeterministicDocxProvider implements ModelProvider {
  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (isIndependentArtifactReviewRequest(request)) {
      return response(JSON.stringify({ verdict: "accept", summary: "All requirements are met.", findings: [] }));
    }
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{ id: "extract-actions", title: "Extract actions", instructions: "Read the selected meeting notes." }],
        integration: {
          instructions: "Create an editable Word meeting record with an action table.",
          fileName: "pilot.docx",
        },
      }));
    }
    const prompt = findLastUserMessage(request.messages);
    const toolResultIds = new Set(request.messages
      .filter((message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool")
      .map((message) => message.toolCallId));
    if (prompt.includes("Task ID: extract-actions")) {
      return toolResultIds.has("docx-source-read")
        ? response("meeting-notes.md: 李闻 owns 冻结试点功能清单 due 2026-08-12")
        : toolResponse("docx-source-read", "read_file", { path: "source-1" });
    }
    if (prompt.includes("Task ID: integrate")) {
      assert.deepEqual(request.tools?.map((tool) => tool.name).toSorted(), [
        "compare_ratios",
        "write_docx_artifact",
      ]);
      assert.match(JSON.stringify(request.tools), /"content"/u);
      assert.doesNotMatch(JSON.stringify(request.tools), /"document"/u);
      return toolResultIds.has("docx-artifact-write")
        ? response("Editable DOCX written and registered.")
        : toolResponse("docx-artifact-write", "write_docx_artifact", {
            fileName: "pilot.docx",
            content: [
              "# CRM 内部试点会议纪要",
              "",
              "## 行动项",
              "| 负责人 | 截止日期 | 交付物 |",
              "| --- | --- | --- |",
              "| 李闻 | 2026-08-12 | 冻结试点功能清单 |",
            ].join("\n"),
            calculationIds: [],
          });
    }
    throw new Error(`Unexpected request: ${prompt}`);
  }
}

class ReviewRevisionProvider implements ModelProvider {
  reviewCalls = 0;

  constructor(readonly alwaysReject: boolean) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (isIndependentArtifactReviewRequest(request)) {
      this.reviewCalls += 1;
      const candidate = findLastUserMessage(request.messages);
      const hasRisk = candidate.includes("## 风险");
      return response(JSON.stringify(
        !this.alwaysReject && hasRisk
          ? { verdict: "accept", summary: "The risk requirement is present.", findings: [] }
          : {
              verdict: "revise",
              summary: "The explicit risk requirement is missing.",
              findings: [{
                priority: "high",
                requirement: "Explain risk",
                problem: "PRIVATE_REVIEW_DETAIL",
                fix: "Add a risk section grounded in worker evidence.",
              }],
            },
      ));
    }
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{ id: "read-evidence", title: "Read evidence", instructions: "Read the selected evidence if present." }],
        integration: { instructions: "Create the requested document.", fileName: "review.docx" },
      }));
    }
    const prompt = findLastUserMessage(request.messages);
    const toolMessages = request.messages.filter(
      (message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool",
    );
    if (prompt.includes("Task ID: read-evidence")) {
      const canRead = request.tools?.some((tool) => tool.name === "read_file") === true;
      if (canRead && !toolMessages.some((message) => message.toolCallId === "review-source")) {
        return toolResponse("review-source", "read_file", { path: "source-1" });
      }
      return response("Worker evidence says the document must explain risk.");
    }
    if (prompt.includes("Task ID: integrate")) {
      const writeAttempts = toolMessages.filter((message) =>
        message.content.startsWith("Tool error:") || message.content.includes('"fileName":"review.docx"')
      ).length;
      const includeRisk = !this.alwaysReject && writeAttempts > 0;
      if (toolMessages.some((message) => !message.content.startsWith("Tool error:"))) {
        return response("Reviewed DOCX written and registered.");
      }
      return toolResponse(`review-write-${writeAttempts + 1}`, "write_docx_artifact", {
        fileName: "review.docx",
        content: [
          "# Review test",
          "",
          `## ${includeRisk ? "风险" : "结论"}`,
          includeRisk ? "风险来自已选资料。" : "候选内容。",
        ].join("\n"),
        calculationIds: [],
      });
    }
    throw new Error(`Unexpected review request: ${prompt}`);
  }
}

class ParentAwareRevisionProvider implements ModelProvider {
  integratorSawVerifiedParent = false;
  semanticReviewCalls = 0;

  constructor(readonly parentText: string) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (isIndependentArtifactReviewRequest(request)) {
      this.semanticReviewCalls += 1;
      assert.match(findLastUserMessage(request.messages), /VERIFIED PARENT ARTIFACT TEXT/u);
      return response(JSON.stringify({
        verdict: "accept",
        summary: "The complete parent and requested revision are present.",
        findings: [],
      }));
    }
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{ id: "confirm-change", title: "Confirm change", instructions: "Confirm the requested revision." }],
        integration: { instructions: "Apply the change to the verified parent." },
      }));
    }
    const prompt = findLastUserMessage(request.messages);
    if (prompt.includes("Task ID: confirm-change")) {
      return response("Add one revision note; leave all other content unchanged.");
    }
    if (prompt.includes("Task ID: integrate")) {
      this.integratorSawVerifiedParent = prompt.includes(this.parentText);
      const failedWrites = request.messages.filter((message) =>
        message.role === "tool" && message.content.startsWith("Tool error:")
      ).length;
      return failedWrites === 0
        ? toolResponse("truncated-revision", "write_docx_artifact", {
            fileName: "parent.docx",
            content: "# Parent report\n\n## Revision note\nRequested change only.",
            calculationIds: [],
          })
        : toolResponse("preserved-revision", "write_docx_artifact", {
            fileName: "parent.docx",
            content: `${this.parentText}\n\n## Revision note\nRequested change only.`,
            calculationIds: [],
          });
    }
    throw new Error(`Unexpected parent-aware revision request: ${prompt}`);
  }
}

function response(content: string): ModelResponse {
  return {
    model: "deterministic-test",
    content,
    toolCalls: [],
    finishReason: "stop",
    usage: { totalTokens: 1 },
  };
}

function toolResponse(id: string, name: string, input: unknown): ModelResponse {
  return {
    model: "deterministic-test",
    content: null,
    toolCalls: [{ id, name, arguments: JSON.stringify(input) }],
    finishReason: "tool_calls",
    usage: { totalTokens: 1 },
  };
}

function findLastUserMessage(messages: readonly ChatMessage[]): string {
  const message = messages.toReversed().find((candidate) => candidate.role === "user");
  if (message === undefined || message.role !== "user") {
    throw new Error("Missing user message");
  }
  return message.content;
}

function findToolResult(messages: readonly ChatMessage[], toolCallId: string): string {
  const message = messages.find(
    (candidate): candidate is Extract<ChatMessage, { role: "tool" }> =>
      candidate.role === "tool" && candidate.toolCallId === toolCallId,
  );
  if (message === undefined) {
    throw new Error(`Missing tool result ${toolCallId}`);
  }
  return message.content;
}
