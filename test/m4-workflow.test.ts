import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { InMemoryEventStore } from "../src/event-store.js";
import { HeadlessWorkflow } from "../src/headless-workflow.js";
import type {
  ChatMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../src/provider.js";

test("runs Skills, MCP, and browser through the audited Research workflow", {
  skip: process.platform === "win32" ? "This combined fixture includes a Windows-disabled stdio MCP server" : false,
}, async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-m4-workflow-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, "local.md"), "local fixture evidence\n", "utf8");
  const skillDirectory = join(workspace, ".localbuddy", "skills", "m4-evidence");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), [
    "---",
    "version: 1",
    "id: m4-evidence",
    "title: M4 Evidence",
    "description: Require browser and MCP evidence.",
    "appliesTo: research",
    "allowedTools:",
    "  - browser_navigate",
    "---",
    "M4_SKILL_SENTINEL: preserve browser title and MCP fixture text in the worker result.",
    "",
  ].join("\n"), "utf8");
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

  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>M4 Integrated Page</title><h1>browser integrated evidence</h1>");
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  context.after(() => new Promise<void>((resolvePromise) => server.close(() => resolvePromise())));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server has no TCP address");
  const origin = `http://127.0.0.1:${address.port}`;
  const eventStore = new InMemoryEventStore();
  const provider = new M4WorkflowProvider(origin);
  const runId = "run-m4-integrated";
  const runRoot = join(workspace, ".localbuddy", "runs", runId);
  const result = await new HeadlessWorkflow({
    provider,
    providerId: "fixture-provider",
    eventStore,
    workspaceRoot: workspace,
    artifactRoot: join(runRoot, "artifacts"),
    checkpointRoot: join(runRoot, "checkpoint"),
    globalConcurrency: 1,
    extensions: {
      skillIds: ["m4-evidence"],
      mcpServerIds: ["fixture"],
      browser: { allowedOrigins: [origin] },
    },
  }).run(runId, "Collect browser and MCP evidence into m4-report.md");

  assert.equal(result.summary.status, "succeeded");
  assert.equal(provider.sawSkillSentinel, true);
  assert.match(await readFile(join(runRoot, "artifacts", "m4-report.md"), "utf8"), /M4 Integrated Page/);
  const events = await eventStore.list(runId);
  assert.ok(events.some((event) => event.type === "extensions.loaded"));
  assert.ok(events.some((event) => event.type === "tool.completed" && event.data?.toolName === "browser_navigate"));
  assert.ok(events.some((event) => event.type === "tool.completed" && String(event.data?.toolName).startsWith("mcp_fixture_echo")));

  await writeFile(join(skillDirectory, "SKILL.md"), [
    "---",
    "version: 1",
    "id: m4-evidence",
    "title: M4 Evidence",
    "description: Changed instructions must invalidate an existing Task checkpoint.",
    "appliesTo: research",
    "allowedTools:",
    "  - browser_navigate",
    "---",
    "M4_SKILL_CHANGED_AFTER_RUN",
    "",
  ].join("\n"), "utf8");
  await assert.rejects(
    () => new HeadlessWorkflow({
      provider,
      providerId: "fixture-provider",
      eventStore,
      workspaceRoot: workspace,
      artifactRoot: join(runRoot, "artifacts"),
      checkpointRoot: join(runRoot, "checkpoint"),
      globalConcurrency: 1,
      extensions: {
        skillIds: ["m4-evidence"],
        mcpServerIds: ["fixture"],
        browser: { allowedOrigins: [origin] },
      },
    }).resume(runId, "Collect browser and MCP evidence into m4-report.md"),
    /checkpoint contract changed/,
  );
  const resumedEvents = await eventStore.list(runId);
  assert.ok(resumedEvents.some((event) => event.type === "checkpoint.resume_blocked"));
  assert.equal(resumedEvents.some((event) => event.type === "run.resumed"), false);
});

class M4WorkflowProvider implements ModelProvider {
  readonly #origin: string;
  sawSkillSentinel = false;

  constructor(origin: string) {
    this.#origin = origin;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{ id: "collect-extensions", title: "Collect extension evidence", instructions: "Use the enabled browser and MCP echo tool." }],
        integration: { instructions: "Write the exact browser title and MCP result.", fileName: "m4-report.md" },
      }));
    }
    const system = request.messages.find((message) => message.role === "system");
    if (system?.role === "system" && system.content.includes("M4_SKILL_SENTINEL")) {
      this.sawSkillSentinel = true;
    }
    const prompt = lastUserMessage(request.messages);
    const toolMessages = request.messages.filter((message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool");
    if (prompt.includes("Task ID: collect-extensions")) {
      if (!toolMessages.some((message) => message.toolCallId === "browser-call")) {
        return toolResponse("browser-call", "browser_navigate", { url: this.#origin });
      }
      if (!toolMessages.some((message) => message.toolCallId === "mcp-call")) {
        const mcpTool = request.tools?.find((tool) => tool.name.startsWith("mcp_fixture_echo"));
        if (mcpTool === undefined) throw new Error("MCP echo tool was not exposed");
        return toolResponse("mcp-call", mcpTool.name, { text: "integrated" });
      }
      return response("Browser title M4 Integrated Page; MCP returned fixture:integrated.");
    }
    if (prompt.includes("Task ID: integrate")) {
      if (!toolMessages.some((message) => message.toolCallId === "artifact-call")) {
        return toolResponse("artifact-call", "write_artifact", {
          fileName: "m4-report.md",
          content: "# M4 integrated evidence\n\nBrowser: M4 Integrated Page\n\nMCP: fixture:integrated\n",
          calculationIds: [],
        });
      }
      return response("Saved the M4 integrated report.");
    }
    throw new Error(`Unexpected M4 workflow prompt: ${prompt}`);
  }
}

function lastUserMessage(messages: readonly ChatMessage[]): string {
  const message = messages.toReversed().find((candidate) => candidate.role === "user");
  if (message === undefined || message.role !== "user") throw new Error("Missing user message");
  return message.content;
}

function response(content: string): ModelResponse {
  return { model: "m4-fixture", content, toolCalls: [], finishReason: "stop" };
}

function toolResponse(id: string, name: string, input: unknown): ModelResponse {
  return {
    model: "m4-fixture",
    content: null,
    toolCalls: [{ id, name, arguments: JSON.stringify(input) }],
    finishReason: "tool_calls",
  };
}
