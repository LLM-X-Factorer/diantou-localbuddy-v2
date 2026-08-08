import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import type { AgentDefinition } from "../src/domain.js";
import { InMemoryEventStore } from "../src/event-store.js";
import { SeatbeltExecutionHost } from "../src/execution-host.js";

const agent: AgentDefinition = {
  id: "execution-test-agent",
  role: "code-worker",
  instructions: "Exercise the constrained host.",
  capabilities: ["code"],
  maxParallelTasks: 1,
};

test("Seatbelt permits the exact workspace, denies sibling reads and network, and audits hashes", {
  skip: process.platform !== "darwin" ? "Seatbelt is macOS-only" : false,
}, async (context) => {
  const fixture = await createFixture(context);
  const eventStore = new InMemoryEventStore();
  const host = new SeatbeltExecutionHost({
    eventStore,
    temporaryRoot: fixture.executionRoot,
  });
  const result = await host.run({
    command: process.execPath,
    args: [
      "-e",
      [
        'const fs = require("node:fs");',
        'const net = require("node:net");',
        'const workspace = process.argv[1];',
        'const privateFile = process.argv[2];',
        'const readable = fs.readFileSync(`${workspace}/input.txt`, "utf8");',
        'let privateDenied = false;',
        'try { fs.readFileSync(privateFile, "utf8"); } catch { privateDenied = true; }',
        'fs.writeFileSync(`${process.env.TMPDIR}/child.txt`, "bounded");',
        'const socket = net.connect({ host: "127.0.0.1", port: 9 });',
        'socket.once("connect", () => { console.log(JSON.stringify({ readable, privateDenied, networkDenied: false })); socket.destroy(); });',
        'socket.once("error", () => console.log(JSON.stringify({ readable, privateDenied, networkDenied: true })));',
      ].join("\n"),
      fixture.workspace,
      fixture.privateFile,
      "do-not-persist-this-argument",
    ],
    cwd: fixture.workspace,
    readRoots: [fixture.workspace],
    writableRoots: [],
    network: "deny",
    timeoutMs: 10_000,
  }, {
    runId: "execution-host-run",
    taskId: "execution-host-task",
    agent,
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    readable: "workspace-data",
    privateDenied: true,
    networkDenied: true,
  });
  const childPath = join(
    fixture.executionRoot,
    "execution-host-run",
    "execution-host-task",
    "child.txt",
  );
  assert.equal(await readFile(childPath, "utf8"), "bounded");
  const serializedEvents = JSON.stringify(await eventStore.list("execution-host-run"));
  assert.doesNotMatch(serializedEvents, /do-not-persist-this-argument/);
  assert.match(serializedEvents, /argsSha256/);
  assert.match(serializedEvents, /execution\.completed/);
});

test("Seatbelt cancels a timed out process and records a failed execution", {
  skip: process.platform !== "darwin" ? "Seatbelt is macOS-only" : false,
}, async (context) => {
  const fixture = await createFixture(context);
  const eventStore = new InMemoryEventStore();
  const host = new SeatbeltExecutionHost({ eventStore, temporaryRoot: fixture.executionRoot });
  await assert.rejects(host.run({
    command: process.execPath,
    args: ["-e", "setInterval(() => undefined, 1000)"],
    cwd: fixture.workspace,
    readRoots: [fixture.workspace],
    writableRoots: [],
    timeoutMs: 1_000,
  }, {
    runId: "execution-timeout-run",
    taskId: "execution-timeout-task",
    agent,
  }), /timed out/);
  const events = await eventStore.list("execution-timeout-run");
  assert.equal(events.at(-1)?.type, "execution.failed");
});

async function createFixture(context: TestContext): Promise<{
  workspace: string;
  privateFile: string;
  executionRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-execution-host-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const workspace = join(root, "workspace");
  const privateRoot = join(root, "private");
  const executionRoot = join(workspace, ".localbuddy", "execution-tmp");
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(privateRoot, { recursive: true }),
  ]);
  await writeFile(join(workspace, "input.txt"), "workspace-data", "utf8");
  const privateFile = join(privateRoot, "secret.txt");
  await writeFile(privateFile, "must-not-be-readable", "utf8");
  return { workspace, privateFile, executionRoot };
}
