#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { CodingWorkflow } from "./coding-workflow.js";
import type { RunExtensionSelection } from "./extension-config.js";
import { JsonlEventStore } from "./event-store.js";
import { HeadlessWorkflow } from "./headless-workflow.js";
import { IntegrationManager, type IntegrationProposal } from "./integration-manager.js";
import type { ProviderSelection } from "./provider-config.js";
import { createConfiguredProvider } from "./provider-factory.js";
import { ProcessSharedCapacity } from "./process-shared-provider.js";
import { RunRequestStore } from "./run-request-store.js";
import { WorkspaceProcessLockManager } from "./workspace-process-lock.js";
import { normalizeTrustProfile, type TrustProfile } from "./tool-runtime.js";

interface CliOptions {
  goal?: string;
  workspace: string;
  runId: string;
  resume: boolean;
  concurrency: number;
  stream: boolean;
  mode: "research" | "code";
  apply: boolean;
  commitMessage?: string;
  provider: ProviderSelection;
  extensions: RunExtensionSelection;
  trustProfile: TrustProfile;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const lease = await new WorkspaceProcessLockManager().acquire(options.workspace, "cli-run");
  try {
    await execute(options);
  } finally {
    await lease.release();
  }
}

async function execute(options: CliOptions): Promise<void> {
  const runRoot = resolve(options.workspace, ".localbuddy", "runs", options.runId);
  const artifactRoot = resolve(runRoot, "artifacts");
  await mkdir(artifactRoot, { recursive: true });
  const eventStore = new JsonlEventStore(resolve(runRoot, "events.jsonl"));
  const requestStore = new RunRequestStore();
  const persisted = options.resume
    ? await requestStore.load(runRoot, options.workspace, options.runId)
    : await requestStore.save(runRoot, {
        runId: options.runId,
        workspace: options.workspace,
        goal: requireGoal(options.goal),
        concurrency: options.concurrency,
        mode: options.mode,
        runtimeOwner: "cli",
        provider: options.provider,
        extensions: options.extensions,
        trustProfile: options.trustProfile,
      });
  if (options.resume) {
    if (persisted.runtimeOwner !== "cli") {
      throw new Error("CLI checkpoint resume is limited to CLI-owned Runs");
    }
    const events = await eventStore.list(options.runId);
    if (events.some((event) => ["run.succeeded", "run.failed", "run.cancelled"].includes(event.type))) {
      throw new Error("CLI checkpoint resume requires a nonterminal interrupted Run");
    }
  }
  if (options.apply && persisted.mode !== "code") {
    throw new Error("--apply is available only for a persisted code Run");
  }
  const provider = await createConfiguredProvider(persisted.provider);
  const processTaskCapacity = process.env.LOCALBUDDY_SHARED_COORDINATION === "0"
    ? undefined
    : new ProcessSharedCapacity({
        namespace: "tasks",
        stateRoot: process.env.LOCALBUDDY_COORDINATION_ROOT,
        limit: environmentInteger("LOCALBUDDY_GLOBAL_TASK_CONCURRENCY", 3),
      });
  const onTextDelta = options.stream
    ? (taskId: string, delta: string) => process.stdout.write(`[${taskId}] ${delta}`)
    : undefined;
  const execution = persisted.mode === "code"
    ? await new CodingWorkflow({
        provider,
        eventStore,
        repoRoot: options.workspace,
        artifactRoot,
        globalConcurrency: persisted.concurrency,
        onTextDelta,
        runtimeOwner: "cli",
        providerId: persisted.provider.id,
        extensions: persisted.extensions,
        trustProfile: persisted.trustProfile,
        processTaskCapacity,
      })[options.resume ? "resume" : "run"](options.runId, persisted.goal).then((result) => ({
        result,
        integration: result.integration,
        worktrees: result.worktrees.map((worktree) => ({
          path: worktree.worktreePath,
          taskId: worktree.taskId,
          headSha: worktree.headSha,
        })),
      }))
    : await new HeadlessWorkflow({
        provider,
        eventStore,
        workspaceRoot: options.workspace,
        sourcePaths: persisted.sourcePaths,
        artifactRoot,
        globalConcurrency: persisted.concurrency,
        onTextDelta,
        runtimeOwner: "cli",
        providerId: persisted.provider.id,
        extensions: persisted.extensions,
        trustProfile: persisted.trustProfile,
        processTaskCapacity,
      })[options.resume ? "resume" : "run"](options.runId, persisted.goal).then((result) => ({
        result,
        integration: undefined as IntegrationProposal | undefined,
        worktrees: [],
      }));
  const result = execution.result;
  let integration = execution.integration;
  if (options.apply) {
    if (integration?.status !== "awaiting_approval") {
      throw new Error(`integration is not ready for approval: ${integration?.status ?? "missing"}`);
    }
    integration = await new IntegrationManager({ eventStore }).approve({
      proposalPath: integration.proposalPath,
      expectedRepoRoot: options.workspace,
      commitMessage: options.commitMessage,
      approvalSource: "cli",
    });
  }
  if (options.stream) {
    process.stdout.write("\n");
  }
  process.stdout.write(`${JSON.stringify({
    runId: result.summary.runId,
    status: result.summary.status,
    tasks: [...result.summary.tasks.values()].map((record) => ({
      id: record.definition.id,
      status: record.status,
      agentId: record.agentId,
    })),
    artifacts: result.artifacts.map((artifact) => ({
      path: artifact.absolutePath,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
    })),
    worktrees: execution.worktrees,
    integration: integration === undefined ? undefined : {
      status: integration.status,
      proposalPath: integration.proposalPath,
      combinedPatch: integration.combinedPatch,
      changedPaths: integration.changedPaths,
      checks: integration.checks.map((check) => check.command),
      commitSha: integration.commitSha,
      revertCommitSha: integration.revertCommitSha,
      rolledBack: integration.rolledBack,
      error: integration.error,
    },
    eventLog: resolve(runRoot, "events.jsonl"),
    provider: persisted.provider.id,
    extensions: persisted.extensions,
    trustProfile: persisted.trustProfile,
    resumed: options.resume,
  }, null, 2)}\n`);

  if (
    result.summary.status !== "succeeded"
    || integration?.status === "preflight_failed"
    || integration?.status === "failed"
    || integration?.status === "recovery_required"
  ) {
    process.exitCode = 1;
  }
}

function parseArguments(args: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  let stream = false;
  let apply = false;
  let allowBrowserActions = false;
  let allowMcpWrites = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--stream") {
      stream = true;
      continue;
    }
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--allow-browser-actions") {
      allowBrowserActions = true;
      continue;
    }
    if (argument === "--allow-mcp-writes") {
      allowMcpWrites = true;
      continue;
    }
    if (!argument?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument ?? ""}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    values.set(argument.slice(2), value);
    index += 1;
  }

  const resumeRunId = values.get("resume-run");
  const goal = values.get("goal");
  if (resumeRunId === undefined && (goal === undefined || goal.trim().length === 0)) {
    throw new Error("--goal is required for a new Run");
  }
  if (resumeRunId !== undefined && goal !== undefined) {
    throw new Error("--resume-run reuses the persisted goal; do not pass --goal");
  }
  const concurrency = Number.parseInt(values.get("concurrency") ?? "3", 10);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("--concurrency must be an integer between 1 and 8");
  }
  if (resumeRunId !== undefined && values.has("run-id")) {
    throw new Error("--resume-run and --run-id are mutually exclusive");
  }
  if (resumeRunId !== undefined) {
    const persistedOnlyOptions = [
      "concurrency",
      "mode",
      "provider",
      "model",
      "base-url",
      "trust-profile",
      "skill",
      "mcp-server",
      "browser-origin",
    ].filter((name) => values.has(name));
    if (persistedOnlyOptions.length > 0 || allowBrowserActions || allowMcpWrites) {
      throw new Error(
        "--resume-run reuses the persisted mode, concurrency, provider, and extensions; do not override them",
      );
    }
  }
  const runId = resumeRunId ?? values.get("run-id") ?? `run-${randomUUID()}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
    throw new Error("--run-id may contain only letters, numbers, underscores, and hyphens");
  }
  const mode = values.get("mode") ?? "research";
  if (mode !== "research" && mode !== "code") {
    throw new Error("--mode must be research or code");
  }
  const commitMessage = values.get("commit-message");
  const providerId = values.get("provider") ?? process.env.LOCALBUDDY_PROVIDER ?? "deepseek";
  if (providerId !== "deepseek" && providerId !== "openai") {
    throw new Error("--provider must be deepseek or openai");
  }
  const trustProfile = normalizeTrustProfile(values.get("trust-profile"));
  const browserOrigins = splitCsv(values.get("browser-origin"));
  if (allowBrowserActions && browserOrigins.length === 0) {
    throw new Error("--allow-browser-actions requires --browser-origin");
  }
  if (apply && resumeRunId === undefined && mode !== "code") {
    throw new Error("--apply is available only with --mode code");
  }
  if (commitMessage !== undefined && !apply) {
    throw new Error("--commit-message requires --apply");
  }
  return {
    goal,
    workspace: resolve(values.get("workspace") ?? process.cwd()),
    runId,
    resume: resumeRunId !== undefined,
    concurrency,
    stream,
    mode,
    apply,
    commitMessage,
    provider: {
      id: providerId,
      model: values.get("model"),
      baseUrl: values.get("base-url"),
    },
    trustProfile,
    extensions: {
      skillIds: splitCsv(values.get("skill")),
      mcpServerIds: splitCsv(values.get("mcp-server")),
      allowMcpWrites,
      browser: browserOrigins.length === 0
        ? undefined
        : { allowedOrigins: browserOrigins, allowActions: allowBrowserActions },
    },
  };
}

function requireGoal(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error("a new Run requires a goal");
  }
  return value;
}

function environmentInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  return Number.parseInt(value, 10);
}

function splitCsv(value: string | undefined): string[] {
  return value === undefined
    ? []
    : [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`LocalBuddy failed: ${message}\n`);
  process.exitCode = 1;
});
