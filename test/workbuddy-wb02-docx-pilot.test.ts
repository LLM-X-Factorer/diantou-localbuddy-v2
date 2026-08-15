import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import type { DesktopRunView } from "../src/desktop-contract.js";
import { isIndependentArtifactReviewRequest } from "../src/artifact-reviewer.js";
import { DesktopRunManager } from "../src/desktop-run-manager.js";
import type { DocxArtifactSpec } from "../src/docx-artifact.js";
import type { ChatMessage, ModelProvider, ModelRequest, ModelResponse } from "../src/provider.js";
import {
  wb02DocxVersionOne,
  wb02DocxVersionTwo,
  wb02ExecutiveSummary,
  wb02InitialExecutiveSummary,
} from "./fixtures/wb02-docx-spec.js";

interface Wb02Oracle {
  decisions: readonly { evidence: string }[];
  actions: readonly { owner: string; dueDate: string; deliverable: string }[];
  risks: readonly { evidence: string }[];
  budget: {
    limitCny: number;
    softwareAndDeploymentCny: number;
    trainingAndSupportMaximumCny: number;
    riskReserveCny: number;
    riskReserveApproval: string;
  };
  revision: { executiveSummaryMaximumChineseCharacters: number };
}

const caseRoot = resolve("benchmarks/workbuddy-core/cases/WB-02-document-revision");

test("WB-02 deterministic LocalBuddy pilot creates, revises, grades, and recovers DOCX", async (context) => {
  const oracle = JSON.parse(await readFile(join(caseRoot, "expected-facts.json"), "utf8")) as Wb02Oracle;
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-wb02-docx-pilot-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  let providerStarts = 0;
  const manager = new DesktopRunManager({
    async createProvider() {
      providerStarts += 1;
      return new Wb02DocxProvider(
        providerStarts === 1 ? wb02DocxVersionOne : wb02DocxVersionTwo,
        providerStarts > 1,
      );
    },
  });

  const parentTerminal = waitForRun(manager, (run) => run.status === "succeeded" && run.artifactRevision === undefined);
  await manager.start({
    workspace,
    sourcePaths: [join(caseRoot, "meeting-notes.md"), join(caseRoot, "budget-notes.md")],
    goal: "根据两份已选择资料生成可编辑的 wb02-crm-pilot.docx，整理决定、行动项和预算。",
    concurrency: 1,
  });
  const parent = await parentTerminal;
  const parentArtifact = parent.artifacts[0];
  assert.equal(parentArtifact?.fileName, "wb02-crm-pilot.docx");

  const revisionTerminal = waitForRun(manager, (run) =>
    run.status === "succeeded" && run.artifactRevision?.revision === 2);
  await manager.start({
    workspace,
    goal: "增加不超过 120 个中文字符的执行摘要和修订说明，其他事实不漂移。",
    concurrency: 1,
    mode: "research",
    artifactContinuation: {
      parentRunId: parent.runId,
      parentFileName: parentArtifact?.fileName ?? "",
      parentSha256: parentArtifact?.sha256 ?? "",
      reason: "增加执行摘要和修订说明",
    },
  });
  const revision = await revisionTerminal;
  const revisionArtifact = revision.artifacts[0];
  const preview = await manager.loadArtifactPreview({
    workspace,
    runId: revision.runId,
    fileName: revisionArtifact?.fileName ?? "",
  });
  assert.equal(preview.format, "docx");
  assert.equal(preview.document?.tables, 2);
  assert.equal(preview.document?.tableRows, 10);
  for (const decision of oracle.decisions) assert.match(preview.text, new RegExp(escapeRegex(decision.evidence), "u"));
  for (const action of oracle.actions) {
    assert.match(
      preview.text,
      new RegExp(`${escapeRegex(action.owner)}\\t${escapeRegex(action.dueDate)}\\t${escapeRegex(action.deliverable)}`, "u"),
    );
  }
  for (const risk of oracle.risks) assert.match(preview.text, new RegExp(escapeRegex(risk.evidence), "u"));
  for (const amount of [
    oracle.budget.limitCny,
    oracle.budget.softwareAndDeploymentCny,
    oracle.budget.trainingAndSupportMaximumCny,
    oracle.budget.riskReserveCny,
  ]) assert.match(preview.text, new RegExp(String(amount), "u"));
  assert.match(preview.text, new RegExp(escapeRegex(oracle.budget.riskReserveApproval), "u"));
  assert.ok([...wb02ExecutiveSummary].length <= oracle.revision.executiveSummaryMaximumChineseCharacters);
  assert.match(preview.text, /## 风险与边界/u);
  assert.match(preview.text, /## 本轮修改说明/u);
  assert.ok(preview.text.endsWith(wb02DocxVersionTwo.revisionNote ?? ""));

  const parentPreview = await manager.loadArtifactPreview({
    workspace,
    runId: parent.runId,
    fileName: parentArtifact?.fileName ?? "",
  });
  assert.equal(parentPreview.format, "docx");
  assert.match(parentPreview.text, /## 执行摘要/u);
  assert.match(parentPreview.text, new RegExp(escapeRegex(wb02InitialExecutiveSummary), "u"));
  assert.ok([...wb02InitialExecutiveSummary].length > oracle.revision.executiveSummaryMaximumChineseCharacters);
  assert.doesNotMatch(parentPreview.text, /## 本轮修改说明/u);
  const thread = await manager.loadArtifactThread({
    workspace,
    runId: revision.runId,
    fileName: revisionArtifact?.fileName ?? "",
  });
  assert.deepEqual(thread.versions.map((version) => version.revision), [1, 2]);
  const diff = await manager.loadArtifactRevisionDiff({
    workspace,
    runId: revision.runId,
    fileName: revisionArtifact?.fileName ?? "",
  });
  assert.equal(diff.comparisonKind, "docx-structure");
  assert.ok(diff.lines.some((line) => line.kind === "removed" && line.text === wb02InitialExecutiveSummary));
  assert.ok(diff.lines.some((line) => line.kind === "added" && line.text === wb02ExecutiveSummary));
  assert.ok(diff.lines.some((line) => line.kind === "added" && line.text === "## 本轮修改说明"));
});

class Wb02DocxProvider implements ModelProvider {
  constructor(
    readonly document: DocxArtifactSpec,
    readonly expectsDocxSource: boolean,
  ) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (isIndependentArtifactReviewRequest(request)) {
      return response(JSON.stringify({ verdict: "accept", summary: "WB-02 requirements are met.", findings: [] }));
    }
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{ id: "read-evidence", title: "Read evidence", instructions: "Read every selected source." }],
        integration: {
          instructions: "Create the requested editable Word document.",
          fileName: this.expectsDocxSource ? "planner-forgot-parent-format.md" : "wb02-crm-pilot.docx",
        },
      }));
    }
    const prompt = lastUserMessage(request.messages);
    const toolMessages = request.messages.filter(
      (message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool",
    );
    const ids = new Set(toolMessages.map((message) => message.toolCallId));
    if (prompt.includes("Task ID: read-evidence")) {
      if (!ids.has("read-source-1")) return toolResponse("read-source-1", "read_file", { path: "source-1" });
      if (!this.expectsDocxSource && !ids.has("read-source-2")) {
        return toolResponse("read-source-2", "read_file", { path: "source-2" });
      }
      const joined = toolMessages.map((message) => message.content).join("\n");
      if (this.expectsDocxSource) assert.match(joined, /"format":"docx"/u);
      assert.match(joined, /李闻/u);
      assert.match(joined, /120000|120,000/u);
      return response("All selected evidence was read and preserved with its source identity.");
    }
    if (prompt.includes("Task ID: integrate")) {
      assert.match(prompt, /Overall Goal Contract:/u);
      if (this.expectsDocxSource) {
        assert.match(prompt, /This is a revision of the verified parent Artifact wb02-crm-pilot\.docx/u);
        assert.match(prompt, /120 个中文字符的执行摘要/u);
      }
      return ids.has("write-wb02-docx")
        ? response("WB-02 DOCX written and registered.")
        : toolResponse("write-wb02-docx", "write_docx_artifact", {
            fileName: "wb02-crm-pilot.docx",
            document: this.document,
            calculationIds: [],
          });
    }
    throw new Error(`Unexpected WB-02 request: ${prompt}`);
  }
}

function waitForRun(
  manager: DesktopRunManager,
  predicate: (run: DesktopRunView) => boolean,
): Promise<DesktopRunView> {
  return new Promise((resolvePromise) => {
    const unsubscribe = manager.subscribe((run) => {
      if (!predicate(run)) return;
      unsubscribe();
      resolvePromise(run);
    });
  });
}

function response(content: string): ModelResponse {
  return { model: "wb02-deterministic", content, toolCalls: [], finishReason: "stop" };
}

function toolResponse(id: string, name: string, input: unknown): ModelResponse {
  return {
    model: "wb02-deterministic",
    content: null,
    toolCalls: [{ id, name, arguments: JSON.stringify(input) }],
    finishReason: "tool_calls",
  };
}

function lastUserMessage(messages: readonly ChatMessage[]): string {
  const message = messages.toReversed().find((candidate) => candidate.role === "user");
  if (message === undefined || message.role !== "user") throw new Error("Missing user message");
  return message.content;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
