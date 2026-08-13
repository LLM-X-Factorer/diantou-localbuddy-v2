import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DesktopRunManager } from "../src/desktop-run-manager.js";
import type { DesktopRunView } from "../src/desktop-contract.js";
import { JsonlEventStore } from "../src/event-store.js";
import type { ChatMessage, ModelProvider, ModelRequest, ModelResponse } from "../src/provider.js";

test("pauses an effectful Desktop extension call until the user approves that exact call", {
  skip: process.platform === "win32" ? "Windows stdio extensions require a supported isolation host" : false,
}, async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-desktop-approval-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await mkdir(join(workspace, ".localbuddy"), { recursive: true });
  const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "mcp-stdio-server.js");
  await writeFile(join(workspace, ".localbuddy", "mcp.json"), `${JSON.stringify({
    version: 1,
    servers: [{
      id: "fixture",
      command: process.execPath,
      args: [fixture],
      readOnlyTools: ["echo"],
    }],
  })}\n`, "utf8");
  const manager = new DesktopRunManager({
    createProvider: async () => new ApprovalWorkflowProvider(),
    globalConcurrency: 1,
  });
  const views: DesktopRunView[] = [];
  manager.subscribe((view) => { views.push(view); });
  const started = await manager.start({
    workspace,
    goal: "Record one explicitly approved fixture action and write approval-report.md",
    concurrency: 1,
    mode: "research",
    provider: { id: "deepseek" },
    extensions: { mcpServerIds: ["fixture"], allowMcpWrites: true },
  });

  await waitFor(() => views.at(-1)?.pendingApprovals.length === 1);
  const approval = views.at(-1)?.pendingApprovals[0];
  assert.ok(approval);
  assert.match(approval.toolName, /^mcp_fixture_record/);
  assert.match(approval.argumentsPreview, /approved-desktop-action/);
  const before = await manager.list(workspace);
  assert.equal(before[0]?.status, "running");
  assert.equal(before[0]?.recentEvents.some((event) => event.type === "tool.completed"), false);

  await manager.resolveToolApproval({
    workspace,
    runId: started.runId,
    approvalId: approval.id,
    decision: "approve",
  });
  await manager.waitForIdle();

  const completed = (await manager.list(workspace)).find((run) => run.runId === started.runId);
  assert.equal(completed?.status, "succeeded");
  assert.equal(completed?.pendingApprovals.length, 0);
  const events = await new JsonlEventStore(
    join(workspace, ".localbuddy", "runs", started.runId, "events.jsonl"),
  ).list(started.runId);
  assert.ok(events.some((event) => event.type === "approval.resolved"));
  assert.ok(events.some(
    (event) => event.type === "tool.completed" && String(event.data?.toolName).startsWith("mcp_fixture_record"),
  ));
});

class ApprovalWorkflowProvider implements ModelProvider {
  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{ id: "record-action", title: "Record approved action", instructions: "Call the MCP record tool once." }],
        integration: { instructions: "Write the exact approved action result.", fileName: "approval-report.md" },
      }));
    }
    const prompt = lastUserMessage(request.messages);
    const toolMessages = request.messages.filter(
      (message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool",
    );
    if (prompt.includes("Task ID: record-action")) {
      if (!toolMessages.some((message) => message.toolCallId === "record-once")) {
        const tool = request.tools?.find((candidate) => candidate.name.startsWith("mcp_fixture_record"));
        if (tool === undefined) throw new Error("MCP record tool is unavailable");
        return toolResponse("record-once", tool.name, { value: "approved-desktop-action" });
      }
      return response("The approved MCP action returned recorded:approved-desktop-action.");
    }
    if (prompt.includes("Task ID: integrate")) {
      if (!toolMessages.some((message) => message.toolCallId === "write-report")) {
        return toolResponse("write-report", "write_artifact", {
          fileName: "approval-report.md",
          content: "# Approval result\n\nrecorded:approved-desktop-action\n",
          calculationIds: [],
        });
      }
      return response("Saved the approval report.");
    }
    throw new Error(`Unexpected approval workflow prompt: ${prompt}`);
  }
}

function lastUserMessage(messages: readonly ChatMessage[]): string {
  const message = messages.toReversed().find((candidate) => candidate.role === "user");
  if (message === undefined || message.role !== "user") throw new Error("Missing user message");
  return message.content;
}

function response(content: string): ModelResponse {
  return { model: "approval-fixture", content, toolCalls: [], finishReason: "stop" };
}

function toolResponse(id: string, name: string, input: unknown): ModelResponse {
  return {
    model: "approval-fixture",
    content: null,
    toolCalls: [{ id, name, arguments: JSON.stringify(input) }],
    finishReason: "tool_calls",
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error("Condition was not met before timeout");
}
