import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { JsonlEventStore } from "../src/event-store.js";
import { RunRequestStore } from "../src/run-request-store.js";

const execFileAsync = promisify(execFile);

test("CLI --resume-run loads the persisted contract and enters same-Run checkpoint recovery", async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), "localbuddy-cli-resume-"));
  context.after(async () => rm(workspace, { recursive: true, force: true }));
  const runId = "cli-resume-fixture";
  const runRoot = join(workspace, ".localbuddy", "runs", runId);
  await new RunRequestStore().save(runRoot, {
    runId,
    workspace,
    goal: "Resume the persisted CLI request",
    concurrency: 2,
    mode: "research",
    runtimeOwner: "cli",
    provider: { id: "deepseek", baseUrl: "http://127.0.0.1:9" },
    extensions: {},
  });
  const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");
  await assert.rejects(execFileAsync(process.execPath, [
    cliPath,
    "--workspace",
    workspace,
    "--resume-run",
    runId,
    "--mode",
    "code",
  ], { encoding: "utf8" }), (error: unknown) => {
    const failure = error as Error & { stderr?: string };
    assert.match(failure.stderr ?? failure.message, /reuses the persisted mode/);
    return true;
  });
  await assert.rejects(execFileAsync(process.execPath, [
    cliPath,
    "--workspace",
    workspace,
    "--resume-run",
    runId,
  ], {
    encoding: "utf8",
    env: { ...process.env, DEEPSEEK_API_KEY: "fixture-key", LOCALBUDDY_SHARED_COORDINATION: "0" },
  }), (error: unknown) => {
    const failure = error as Error & { stderr?: string };
    assert.match(failure.stderr ?? failure.message, /checkpoint|manifest/i);
    return true;
  });
  const events = await new JsonlEventStore(join(runRoot, "events.jsonl")).list(runId);
  assert.equal(events.at(-1)?.type, "checkpoint.resume_blocked");
});
