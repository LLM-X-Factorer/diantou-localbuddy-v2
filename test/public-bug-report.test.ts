import assert from "node:assert/strict";
import test from "node:test";

import type { DesktopBuildIdentity } from "../src/build-identity.js";
import type { DesktopBugReportRequest, DesktopRunView } from "../src/desktop-contract.js";
import {
  buildPublicBugReport,
  findDuplicatePublicBugReport,
  isAllowedPublicBugReportUrl,
  PUBLIC_BUG_REPORT_URL_LIMIT,
  sanitizePublicBugReportText,
} from "../src/public-bug-report.js";

const build: DesktopBuildIdentity = {
  version: "0.12.4",
  channel: "canary",
  sha: "b5aa1f9b5aa1f9b5aa1f9b5aa1f9b5aa1f9b5aa1",
  dirty: false,
  packaged: true,
};

function sensitiveRun(): DesktopRunView {
  return {
    runId: "run-private-123",
    mode: "research",
    runtimeOwner: "desktop",
    workspace: "/Users/alice/Clients/semiconductor-secret",
    status: "failed",
    startedAt: "2026-08-17T01:00:00.000Z",
    completedAt: "2026-08-17T01:01:00.000Z",
    tasks: [
      {
        id: "private-task-id",
        title: "Read confidential strategy.docx",
        status: "failed",
        agentId: "private-agent-id",
        error: "Workspace snapshot exceeded the safe checkpoint entry limit at /Users/alice/Clients/semiconductor-secret",
      },
      { id: "task-ok", title: "Secret task", status: "succeeded" },
    ],
    artifacts: [{
      fileName: "semiconductor-secret.docx",
      absolutePath: "/Users/alice/Clients/semiconductor-secret/semiconductor-secret.docx",
      bytes: 1234,
      sha256: "artifact-private-sha",
    }],
    artifactReview: {
      status: "revision_requested",
      attempts: 2,
      revisionRequests: 1,
      findingCount: 3,
      candidateSha256: "candidate-private-sha",
    },
    recentEvents: [
      {
        sequence: 140,
        timestamp: "2026-08-17T01:00:59.000Z",
        type: "task.failed",
        taskId: "private-task-id",
        agentId: "private-agent-id",
        detail: "sk-private123456 in /Users/alice/Clients/semiconductor-secret",
      },
      {
        sequence: 141,
        timestamp: "2026-08-17T01:01:00.000Z",
        type: "runtime.failed",
        detail: "raw private failure",
      },
    ],
    eventCount: 141,
    worktrees: [{ taskId: "private-task-id", path: "/Users/alice/private-worktree", status: "retained" }],
    checkpoint: { status: "blocked", completedTasks: 1, resumableTasks: 1, reason: "private reason" },
    integration: {
      status: "preflight_failed",
      combinedPatchSha256: "patch-private-sha",
      changedPaths: ["private/customer.ts"],
      checkCommands: ["upload-private-data --token secret"],
      commitSha: "commit-private-sha",
      error: "private integration error",
    },
    recoveryOf: "private-parent-run",
    error: "Error invoking remote method: workspace snapshot exceeded the safe checkpoint entry limit",
    providerId: "private-provider",
    trustProfile: "balanced",
    extensions: {
      skillIds: ["private-skill"],
      mcpServerIds: ["private-mcp"],
      browserOrigins: ["https://private.example.test"],
      browserActionsAllowed: false,
      mcpWritesAllowed: false,
    },
    pendingApprovals: [],
    metrics: {
      durationMs: 60_000,
      modelCalls: 23,
      totalTokens: 580_000,
      modelFailures: 1,
      toolFailures: 0,
      artifactGateRetries: 0,
      failureStage: "task",
    },
  };
}

function request(overrides: Partial<DesktopBugReportRequest> = {}): DesktopBugReportRequest {
  return {
    workspace: "/Users/alice/Clients/semiconductor-secret",
    runId: "run-private-123",
    actual: "The run failed near /Users/alice/Clients/semiconductor-secret with sk-private123456.",
    expected: "It should finish without contacting @private-team.",
    reproduction: "Use api_key=private-token and retry as alice@example.com.",
    ...overrides,
  };
}

test("builds a controlled public report without local run, task, artifact, or credential data", () => {
  const report = buildPublicBugReport({
    run: sensitiveRun(),
    request: request(),
    build,
    platform: "darwin",
    arch: "arm64",
  });
  const serialized = JSON.stringify(report);

  assert.match(serialized, /checkpoint_entry_limit/);
  assert.match(serialized, /task\.failed.*runtime\.failed/);
  assert.match(serialized, /v0\.12\.4/);
  assert.match(serialized, /darwin.*arm64/);
  assert.match(serialized, /\[redacted secret\]/);
  assert.match(serialized, /\[redacted local path\]/);
  assert.doesNotMatch(serialized, /run-private-123|private-task-id|private-agent-id/);
  assert.doesNotMatch(serialized, /semiconductor-secret|strategy\.docx|artifact-private-sha|candidate-private-sha/);
  assert.doesNotMatch(serialized, /upload-private-data|commit-private-sha|patch-private-sha/);
  assert.doesNotMatch(serialized, /private-provider|private-skill|private-mcp|private\.example/);
  assert.doesNotMatch(serialized, /raw private failure|private integration error|private-parent-run/);
  assert.doesNotMatch(serialized, /private123456|private-token|alice@example\.com/);
  assert.ok(report.issueUrl.length <= PUBLIC_BUG_REPORT_URL_LIMIT);
  assert.ok(isAllowedPublicBugReportUrl(report.issueUrl, "new"));
});

test("keeps the duplicate signature stable across versions and user wording", () => {
  const run = sensitiveRun();
  const first = buildPublicBugReport({ run, request: request(), build, platform: "darwin", arch: "arm64" });
  const second = buildPublicBugReport({
    run: { ...run, startedAt: "2027-01-01T00:00:00.000Z" },
    request: request({ actual: "Different public wording", expected: "Different", reproduction: "Different steps" }),
    build: { ...build, version: "0.13.0", sha: "abcdef1" },
    platform: "darwin",
    arch: "arm64",
  });
  assert.equal(first.signature, second.signature);
  assert.notEqual(first.previewSha256, second.previewSha256);
  assert.notEqual(first.title, second.title);
});

test("sanitizes credential URLs, tokens, user paths, email, mentions, and HTML", () => {
  const result = sanitizePublicBugReportText(
    "https://alice:password@example.com x=1 Bearer abcdefghijk token=very-private /home/alice/a C:\\Users\\alice\\private <b>@ops</b> a@b.example",
  );
  assert.doesNotMatch(result.value, /alice:password|abcdefghijk|very-private|\/home\/alice|C:\\Users\\alice|@ops|<b>|a@b\.example/);
  assert.match(result.value, /redacted credential URL|redacted/);
  assert.ok(result.redactions.length >= 5);
});

test("keeps maximum UI field sizes below the conservative GitHub URL cap", () => {
  const report = buildPublicBugReport({
    run: sensitiveRun(),
    request: request({
      actual: "现".repeat(180),
      expected: "预".repeat(160),
      reproduction: "步".repeat(280),
    }),
    build,
    platform: "win32",
    arch: "x64",
  });
  assert.ok(report.issueUrl.length <= PUBLIC_BUG_REPORT_URL_LIMIT, `URL length ${report.issueUrl.length}`);
});

test("only accepts exact HTTPS issue targets in the public LocalBuddy repository", () => {
  const report = buildPublicBugReport({ run: sensitiveRun(), request: request(), build, platform: "darwin", arch: "arm64" });
  assert.ok(isAllowedPublicBugReportUrl(report.issueUrl, "new"));
  assert.ok(isAllowedPublicBugReportUrl("https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/42", "existing"));
  for (const value of [
    "http://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/42",
    "https://github.com/other/repo/issues/42",
    "https://evil.example/LLM-X-Factorer/diantou-localbuddy-v2/issues/42",
    "https://user:secret@github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/42",
    "https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/42?next=evil",
    "javascript:alert(1)",
  ]) {
    assert.equal(isAllowedPublicBugReportUrl(value, "existing"), false, value);
  }
});

test("finds same-signature open issues without sending credentials", async () => {
  const signature = "localbuddy-signature:v1:abcdef";
  let requestedUrl = "";
  let requestedHeaders = new Headers();
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify([
      {
        number: 9,
        title: "Matching bug",
        body: `Trace\n${signature}`,
        html_url: "https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/9",
      },
    ]), { status: 200 });
  };
  const result = await findDuplicatePublicBugReport(signature, fetcher);
  assert.deepEqual(result, {
    status: "found",
    issueNumber: 9,
    title: "Matching bug",
    url: "https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/9",
  });
  assert.match(requestedUrl, /^https:\/\/api\.github\.com\/repos\/LLM-X-Factorer\/diantou-localbuddy-v2\/issues/);
  assert.equal(requestedHeaders.has("authorization"), false);
});

test("duplicate lookup ignores pull requests and fails open when GitHub is unavailable", async () => {
  const signature = "localbuddy-signature:v1:abcdef";
  const pullRequestFetcher: typeof fetch = async () => new Response(JSON.stringify([{
    number: 10,
    title: "PR",
    body: signature,
    html_url: "https://github.com/LLM-X-Factorer/diantou-localbuddy-v2/issues/10",
    pull_request: {},
  }]), { status: 200 });
  assert.deepEqual(await findDuplicatePublicBugReport(signature, pullRequestFetcher), { status: "none" });

  const unavailableFetcher: typeof fetch = async () => new Response("rate limited", { status: 403 });
  assert.deepEqual(await findDuplicatePublicBugReport(signature, unavailableFetcher), { status: "unavailable" });

  const throwingFetcher: typeof fetch = async () => { throw new Error("offline"); };
  assert.deepEqual(await findDuplicatePublicBugReport(signature, throwingFetcher), { status: "unavailable" });
});
