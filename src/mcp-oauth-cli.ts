#!/usr/bin/env node

import { realpath } from "node:fs/promises";

import { loadMcpConfig, resolveSelectedMcpServers } from "./extension-config.js";
import { LocalMcpOAuthProvider } from "./mcp-oauth.js";

const options = parse(process.argv.slice(2));
const workspace = await realpath(options.get("workspace") ?? process.cwd());
const serverId = options.get("server");
if (serverId === undefined) throw new Error("--server is required");
const [server] = resolveSelectedMcpServers(await loadMcpConfig(workspace), [serverId]);
if (server?.transport !== "streamable-http" || server.oauth === undefined) {
  throw new Error(`MCP server ${serverId} does not use OAuth`);
}
const provider = await LocalMcpOAuthProvider.create({
  server,
  environment: process.env,
  redirectHandler() { throw new Error("revocation must not start an authorization redirect"); },
});
try {
  await provider.revoke();
  process.stdout.write(`Revoked stored OAuth tokens for MCP server ${serverId}.\n`);
} finally {
  await provider.close();
}

function parse(args: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (name === undefined || !name.startsWith("--") || value === undefined) throw new Error("options must be --name value pairs");
    result.set(name.slice(2), value);
  }
  return result;
}
