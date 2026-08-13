import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";

import { InMemoryEventStore } from "../src/event-store.js";
import { createPlatformExecutionHost } from "../src/execution-host.js";
import { connectMcpServers } from "../src/mcp-client.js";

test("Windows local process execution fails closed without an isolation host", {
  skip: process.platform !== "win32" ? "Windows-only platform contract" : false,
}, () => {
  assert.throws(
    () => createPlatformExecutionHost({
      eventStore: new InMemoryEventStore(),
      temporaryRoot: tmpdir(),
    }),
    /Local process execution is disabled on Windows/,
  );
});

test("Windows stdio MCP fails closed before spawning an unisolated process", {
  skip: process.platform !== "win32" ? "Windows-only platform contract" : false,
}, async () => {
  await assert.rejects(
    connectMcpServers([{
      id: "windows-fail-closed",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      cwd: tmpdir(),
      env: {},
      workspaceAccess: "read",
      networkAccess: false,
      readOnlyTools: [],
    }]),
    /disabled because no supported Windows isolation host is configured/,
  );
});
