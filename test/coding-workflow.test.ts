import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parseCodingPlan } from "../src/coding-planner.js";
import { CodingWorkflow } from "../src/coding-workflow.js";
import { InMemoryEventStore } from "../src/event-store.js";
import type {
  ChatMessage,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../src/provider.js";

const execFileAsync = promisify(execFile);

test("runs an isolated coding workflow, saves a patch, and leaves the primary checkout unchanged", {
  skip: process.platform === "win32" ? "Windows Coding requires a supported isolation host" : false,
}, async (context) => {
  const fixture = await createGitFixture(context);
  const eventStore = new InMemoryEventStore();
  const artifactRoot = join(fixture.root, ".localbuddy", "runs", "run-code", "artifacts");
  const result = await new CodingWorkflow({
    provider: new CodingWorkflowProvider(),
    eventStore,
    repoRoot: fixture.root,
    artifactRoot,
    globalConcurrency: 2,
  }).run("run-code", "Change the greeting in src/greet.js");

  assert.equal(result.summary.status, "succeeded");
  assert.equal(result.integration?.status, "awaiting_approval");
  assert.equal(result.worktrees.length, 1);
  assert.equal(await readFile(join(fixture.root, "src/greet.js"), "utf8"), fixture.original);
  assert.match(
    await readFile(join(result.worktrees[0]?.worktreePath ?? "", "src/greet.js"), "utf8"),
    /hello local buddy/,
  );
  const patch = result.artifacts.find((artifact) => artifact.relativePath.endsWith(".patch"));
  const summary = result.artifacts.find((artifact) => artifact.relativePath === "coding-summary.md");
  const combined = result.artifacts.find(
    (artifact) => artifact.relativePath === "integration/combined.patch",
  );
  assert.ok(patch);
  assert.ok(summary);
  assert.ok(combined);
  assert.match(await readFile(patch.absolutePath, "utf8"), /hello local buddy/);
  assert.match(await readFile(summary.absolutePath, "utf8"), /Primary checkout: unchanged/);
  assert.equal((await git(fixture.root, ["status", "--porcelain=v1"])).trim(), "");
  const events = await eventStore.list("run-code");
  assert.ok(events.some((event) => event.type === "workspace.created"));
  assert.ok(events.some((event) => event.type === "workspace.diff_captured"));
});

test("makes selected Skills and MCP tools available inside an isolated coding workflow", {
  skip: process.platform === "win32" ? "Windows stdio extensions require a supported isolation host" : false,
}, async (context) => {
  const fixture = await createGitFixture(context);
  const skillDirectory = join(fixture.root, ".localbuddy", "skills", "m4-code");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), [
    "---",
    "version: 1",
    "id: m4-code",
    "title: M4 Code",
    "description: Require MCP evidence before editing.",
    "appliesTo: code",
    "allowedTools: []",
    "---",
    "M4_CODE_SKILL_SENTINEL: call the fixture MCP echo tool before editing.",
    "",
  ].join("\n"), "utf8");
  const mcpFixture = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "mcp-stdio-server.js",
  );
  await writeFile(join(fixture.root, ".localbuddy", "mcp.json"), `${JSON.stringify({
    version: 1,
    servers: [{
      id: "fixture",
      command: process.execPath,
      args: [mcpFixture],
      readOnlyTools: ["echo"],
    }],
  })}\n`, "utf8");
  const eventStore = new InMemoryEventStore();
  const provider = new M4CodingWorkflowProvider();
  const result = await new CodingWorkflow({
    provider,
    providerId: "fixture-provider",
    eventStore,
    repoRoot: fixture.root,
    artifactRoot: join(fixture.root, ".localbuddy", "runs", "run-code-m4", "artifacts"),
    globalConcurrency: 1,
    extensions: { skillIds: ["m4-code"], mcpServerIds: ["fixture"] },
  }).run("run-code-m4", "Change the greeting after checking MCP evidence");

  assert.equal(result.summary.status, "succeeded");
  assert.equal(result.integration?.status, "awaiting_approval");
  assert.equal(provider.sawSkillSentinel, true);
  assert.match(
    await readFile(join(result.worktrees[0]?.worktreePath ?? "", "src/greet.js"), "utf8"),
    /hello from MCP/,
  );
  assert.equal(await readFile(join(fixture.root, "src/greet.js"), "utf8"), fixture.original);
  const events = await eventStore.list("run-code-m4");
  assert.ok(events.some((event) => event.type === "extensions.loaded"));
  assert.ok(events.some(
    (event) => event.type === "tool.completed" && String(event.data?.toolName).startsWith("mcp_fixture_echo"),
  ));
});

test("rejects overlapping or unsafe coding ownership", () => {
  assert.throws(
    () => parseCodingPlan(JSON.stringify({
      tasks: [
        { id: "a", title: "A", instructions: "A", ownedPaths: ["src/"] },
        { id: "b", title: "B", instructions: "B", ownedPaths: ["src/file.ts"] },
      ],
      integration: { instructions: "summarize", fileName: "summary.md" },
    }), 3),
    /overlapping owned paths/,
  );
  assert.throws(
    () => parseCodingPlan(JSON.stringify({
      tasks: [{ id: "a", title: "A", instructions: "A", ownedPaths: [".git/config"] }],
      integration: { instructions: "summarize", fileName: "summary.md" },
    }), 3),
    /Unsafe owned path/,
  );
});

class CodingWorkflowProvider implements ModelProvider {
  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{
          id: "change-greeting",
          title: "Change greeting",
          instructions: "Change the return value to hello local buddy.",
          ownedPaths: ["src/greet.js"],
        }],
        integration: {
          instructions: "Summarize the saved patch and state that it is not merged.",
          fileName: "coding-summary.md",
        },
      }));
    }
    const prompt = lastUserMessage(request.messages);
    const toolIds = new Set(
      request.messages
        .filter((message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool")
        .map((message) => message.toolCallId),
    );
    if (prompt.includes("Task ID: change-greeting")) {
      if (!toolIds.has("read-1")) {
        return toolResponse("read-1", "read_file", { path: "src/greet.js" });
      }
      if (!toolIds.has("edit-1")) {
        return toolResponse("edit-1", "replace_text", {
          path: "src/greet.js",
          oldText: 'return "hello";',
          newText: 'return "hello local buddy";',
        });
      }
      if (!toolIds.has("check-1")) {
        return toolResponse("check-1", "run_check", { command: "git_diff_check" });
      }
      return response("Changed the owned file and git_diff_check passed. The patch is not merged.");
    }
    if (prompt.includes("Task ID: integrate")) {
      return toolIds.has("summary-1")
        ? response("Saved the isolated coding summary.")
        : toolResponse("summary-1", "write_artifact", {
            fileName: "coding-summary.md",
            content: "# Coding summary\n\nPrimary checkout: unchanged.\n\nThe isolated patch passed git_diff_check.\n",
            calculationIds: [],
          });
    }
    throw new Error(`Unexpected coding prompt: ${prompt}`);
  }
}

class M4CodingWorkflowProvider implements ModelProvider {
  sawSkillSentinel = false;

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (request.responseFormat === "json_object") {
      return response(JSON.stringify({
        tasks: [{
          id: "change-with-mcp",
          title: "Change greeting with MCP evidence",
          instructions: "Call MCP echo, then change the return value to hello from MCP.",
          ownedPaths: ["src/greet.js"],
        }],
        integration: {
          instructions: "Summarize the isolated patch and MCP evidence.",
          fileName: "coding-summary.md",
        },
      }));
    }
    const system = request.messages.find((message) => message.role === "system");
    if (system?.role === "system" && system.content.includes("M4_CODE_SKILL_SENTINEL")) {
      this.sawSkillSentinel = true;
    }
    const prompt = lastUserMessage(request.messages);
    const toolIds = new Set(
      request.messages
        .filter((message): message is Extract<ChatMessage, { role: "tool" }> => message.role === "tool")
        .map((message) => message.toolCallId),
    );
    if (prompt.includes("Task ID: change-with-mcp")) {
      if (!toolIds.has("mcp-code")) {
        const mcpTool = request.tools?.find((tool) => tool.name.startsWith("mcp_fixture_echo"));
        if (mcpTool === undefined) throw new Error("MCP echo tool was not exposed to Code Worker");
        return toolResponse("mcp-code", mcpTool.name, { text: "code-workflow" });
      }
      if (!toolIds.has("read-code")) {
        return toolResponse("read-code", "read_file", { path: "src/greet.js" });
      }
      if (!toolIds.has("edit-code")) {
        return toolResponse("edit-code", "replace_text", {
          path: "src/greet.js",
          oldText: 'return "hello";',
          newText: 'return "hello from MCP";',
        });
      }
      if (!toolIds.has("check-code")) {
        return toolResponse("check-code", "run_check", { command: "git_diff_check" });
      }
      return response("Used MCP evidence and produced the isolated greeting patch.");
    }
    if (prompt.includes("Task ID: integrate")) {
      return toolIds.has("summary-code")
        ? response("Saved the coding extension summary.")
        : toolResponse("summary-code", "write_artifact", {
            fileName: "coding-summary.md",
            content: "# Coding extension summary\n\nPrimary checkout: unchanged. MCP evidence was collected.\n",
            calculationIds: [],
          });
    }
    throw new Error(`Unexpected M4 coding prompt: ${prompt}`);
  }
}

async function createGitFixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-coding-workflow-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "LocalBuddy Test"]);
  await git(root, ["config", "user.email", "localbuddy@example.invalid"]);
  await mkdir(join(root, "src"));
  const original = 'export function greet() {\n  return "hello";\n}\n';
  await writeFile(join(root, ".gitignore"), ".localbuddy/\n", "utf8");
  await writeFile(join(root, "src/greet.js"), original, "utf8");
  await git(root, ["add", ".gitignore", "src/greet.js"]);
  await git(root, ["commit", "-m", "initial fixture"]);
  return { root, original };
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout;
}

function response(content: string): ModelResponse {
  return { model: "coding-test", content, toolCalls: [], finishReason: "stop" };
}

function toolResponse(id: string, name: string, input: unknown): ModelResponse {
  return {
    model: "coding-test",
    content: null,
    toolCalls: [{ id, name, arguments: JSON.stringify(input) }],
    finishReason: "tool_calls",
  };
}

function lastUserMessage(messages: readonly ChatMessage[]): string {
  const message = messages.toReversed().find((candidate) => candidate.role === "user");
  if (message === undefined || message.role !== "user") {
    throw new Error("Missing user message");
  }
  return message.content;
}
