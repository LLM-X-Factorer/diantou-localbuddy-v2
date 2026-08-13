import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { connectMcpServers } from "../src/mcp-client.js";

test("discovers and calls allowlisted MCP stdio tools with conservative risk", {
  skip: process.platform === "win32" ? "Windows stdio MCP requires a supported isolation host" : false,
}, async () => {
  const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "mcp-stdio-server.js");
  const bridge = await connectMcpServers([{
    id: "fixture",
    command: process.execPath,
    args: [fixture],
    cwd: dirname(fixture),
    env: {},
    workspaceAccess: "read",
    networkAccess: false,
    readOnlyTools: ["echo"],
  }]);
  try {
    assert.equal(bridge.tools.length, 2);
    const echo = bridge.tools.find((tool) => tool.description.includes("remote tool echo"));
    const record = bridge.tools.find((tool) => tool.description.includes("remote tool record"));
    assert.equal(echo?.risk, "read");
    assert.equal(record?.risk, "execute");
    assert.ok((echo?.name.length ?? 100) <= 64);
    const output = await echo?.execute(echo.parse({ text: "verified" }), {
      runId: "run-mcp-test",
      taskId: "mcp-task",
      agent: {
        id: "worker-1",
        role: "worker",
        instructions: "test",
        capabilities: ["worker"],
        maxParallelTasks: 1,
      },
    });
    assert.match(JSON.stringify(output), /fixture:verified/);
  } finally {
    await bridge.close();
  }
});

test("reports bounded sanitized MCP child stderr when the handshake fails", {
  skip: process.platform === "win32" ? "Windows stdio MCP requires a supported isolation host" : false,
}, async () => {
  const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "mcp-stdio-failure.js");
  await assert.rejects(
    connectMcpServers([{
      id: "broken-fixture",
      command: process.execPath,
      args: [fixture],
      cwd: dirname(fixture),
      env: {},
      workspaceAccess: "read",
      networkAccess: false,
      readOnlyTools: [],
    }]),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /MCP server broken-fixture failed to connect/);
      assert.match(message, /Child stderr:/);
      assert.match(message, /stderr sha256:[a-f0-9]{12}/);
      assert.match(message, /\[redacted\]/);
      assert.doesNotMatch(message, /super-secret-token|Bearer-hidden|\/Users\/private/);
      assert.ok(message.length < 2_000);
      return true;
    },
  );
});

test("discovers and calls authenticated Streamable HTTP MCP tools", async (context) => {
  const expectedAuthorization = "Bearer fixture-http-token";
  let authorizedRequests = 0;
  const httpServer = createServer(async (request, response) => {
    if (request.url !== "/mcp" || request.headers.authorization !== expectedAuthorization) {
      response.writeHead(401, { "www-authenticate": "Bearer" });
      response.end("unauthorized");
      return;
    }
    authorizedRequests += 1;
    const server = new McpServer({ name: "localbuddy-http-fixture", version: "1.0.0" });
    server.registerTool("remote-echo", {
      description: "Return HTTP fixture evidence.",
      inputSchema: { text: z.string().max(1_000) },
    }, async ({ text }) => ({ content: [{ type: "text", text: `http-fixture:${text}` }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(request, response);
  });
  await new Promise<void>((resolvePromise) => httpServer.listen(0, "127.0.0.1", resolvePromise));
  context.after(() => new Promise<void>((resolvePromise) => httpServer.close(() => resolvePromise())));
  const address = httpServer.address();
  if (address === null || typeof address === "string") throw new Error("HTTP MCP fixture has no address");

  const bridge = await connectMcpServers([{
    id: "remote",
    transport: "streamable-http",
    url: `http://127.0.0.1:${address.port}/mcp`,
    bearerTokenEnv: "LOCALBUDDY_HTTP_MCP_TOKEN",
    readOnlyTools: ["remote-echo"],
  }], { LOCALBUDDY_HTTP_MCP_TOKEN: "fixture-http-token" });
  try {
    const echo = bridge.tools.find((tool) => tool.description.includes("remote tool remote-echo"));
    assert.equal(echo?.risk, "read");
    const output = await echo?.execute(echo.parse({ text: "verified" }), {
      runId: "run-http-mcp",
      taskId: "http-mcp-task",
      agent: {
        id: "worker-1",
        role: "worker",
        instructions: "test",
        capabilities: ["worker"],
        maxParallelTasks: 1,
      },
    });
    assert.match(JSON.stringify(output), /http-fixture:verified/);
    assert.ok(authorizedRequests >= 3);
  } finally {
    await bridge.close();
  }
});
