import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "localbuddy-m4-fixture", version: "1.0.0" });

server.registerTool("echo", {
  description: "Return fixture evidence without side effects.",
  inputSchema: { text: z.string().max(1_000) },
}, async ({ text }) => ({ content: [{ type: "text", text: `fixture:${text}` }] }));

server.registerTool("record", {
  description: "Represent an externally effectful fixture action.",
  inputSchema: { value: z.string().max(1_000) },
}, async ({ value }) => ({ content: [{ type: "text", text: `recorded:${value}` }] }));

await server.connect(new StdioServerTransport());
