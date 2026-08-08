import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { prepareRunExtensions } from "../src/extension-runtime.js";
import { RoleBasedApprovalPolicy } from "../src/tool-runtime.js";

test("requires explicit Run authorization for effectful MCP and browser tools", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-extension-policy-"));
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
  const checkpointRoot = join(workspace, ".localbuddy", "runs", "run-policy", "checkpoint");
  const deniedRuntime = await prepareRunExtensions({
    workspace,
    checkpointRoot,
    selection: { mcpServerIds: ["fixture"], browser: { allowedOrigins: ["https://example.com"] } },
  });
  try {
    const contextValue = {
      runId: "run-policy",
      taskId: "task-policy",
      agent: {
        id: "worker-1",
        role: "worker",
        instructions: "test",
        capabilities: ["worker"],
        maxParallelTasks: 1,
      },
    } as const;
    const policy = deniedRuntime.approvalPolicy(new RoleBasedApprovalPolicy());
    const readTool = deniedRuntime.tools.find((tool) => tool.risk === "read");
    const executeTool = deniedRuntime.tools.find((tool) => tool.name.startsWith("mcp_") && tool.risk === "execute");
    const browserClick = deniedRuntime.tools.find((tool) => tool.name === "browser_click");
    assert.equal((await policy.authorize(readTool!, contextValue)).allowed, true);
    assert.equal((await policy.authorize(executeTool!, contextValue)).allowed, false);
    assert.equal((await policy.authorize(browserClick!, contextValue)).allowed, false);
  } finally {
    await deniedRuntime.close();
  }

  const allowedRuntime = await prepareRunExtensions({
    workspace,
    checkpointRoot,
    selection: {
      mcpServerIds: ["fixture"],
      allowMcpWrites: true,
      browser: { allowedOrigins: ["https://example.com"], allowActions: true },
    },
  });
  try {
    const contextValue = {
      runId: "run-policy",
      taskId: "task-policy",
      agent: {
        id: "worker-1",
        role: "worker",
        instructions: "test",
        capabilities: ["worker"],
        maxParallelTasks: 1,
      },
    } as const;
    const policy = allowedRuntime.approvalPolicy(new RoleBasedApprovalPolicy());
    assert.equal((await policy.authorize(
      allowedRuntime.tools.find((tool) => tool.name.startsWith("mcp_") && tool.risk === "execute")!,
      contextValue,
    )).allowed, true);
    assert.equal((await policy.authorize(
      allowedRuntime.tools.find((tool) => tool.name === "browser_click")!,
      contextValue,
    )).allowed, true);
  } finally {
    await allowedRuntime.close();
  }
});
