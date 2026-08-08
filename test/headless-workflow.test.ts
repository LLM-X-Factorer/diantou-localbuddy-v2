import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { InMemoryEventStore } from "../src/event-store.js";
import { HeadlessWorkflow } from "../src/headless-workflow.js";
import type { ChatMessage, ModelProvider, ModelRequest, ModelResponse } from "../src/provider.js";

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
        return toolResponse("metrics-read", "read_file", { path: "metrics.csv" });
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
        : toolResponse("notes-read", "read_file", { path: "notes.md" });
    }
    if (prompt.includes("Task ID: integrate")) {
      assert.match(prompt, /128 leads/);
      assert.match(prompt, /ROI remains unknown/);
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
