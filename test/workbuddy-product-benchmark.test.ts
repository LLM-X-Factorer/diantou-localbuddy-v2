import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { JsonlEventStore } from "../src/event-store.js";
import { RunRequestStore } from "../src/run-request-store.js";

type Materialization = {
  copy?: Array<{ source: string; target: string }>;
  generatedFileManifest?: string;
};

type BenchmarkCase = {
  id: string;
  turns: string[];
  requiredArtifacts: string[];
  deterministicChecks: string[];
  materialization: Materialization;
};

type BenchmarkManifest = {
  schemaVersion: number;
  scoreWeights: Record<string, number>;
  hardGates: string[];
  cases: BenchmarkCase[];
};

const manifestPath = resolve("benchmarks/workbuddy-core/manifest.json");

async function loadManifest(): Promise<BenchmarkManifest> {
  return JSON.parse(await readFile(manifestPath, "utf8")) as BenchmarkManifest;
}

test("WorkBuddy product benchmark has six complete, uniquely identified cases", async () => {
  const manifest = await loadManifest();
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.cases.length, 6);
  assert.deepEqual(
    manifest.cases.map((entry) => entry.id),
    ["WB-01", "WB-02", "WB-03", "WB-04", "WB-05", "WB-06"],
  );
  assert.equal(new Set(manifest.cases.map((entry) => entry.id)).size, 6);
  assert.equal(Object.values(manifest.scoreWeights).reduce((sum, weight) => sum + weight, 0), 100);
  assert.equal(manifest.hardGates.length, 6);
  for (const benchmarkCase of manifest.cases) {
    assert.ok(benchmarkCase.turns.length >= 1);
    assert.ok(benchmarkCase.requiredArtifacts.length >= 2);
    assert.ok(benchmarkCase.deterministicChecks.length >= 4);
  }
});

test("all benchmark fixture references exist inside the repository", async () => {
  const manifest = await loadManifest();
  for (const benchmarkCase of manifest.cases) {
    if (benchmarkCase.materialization.generatedFileManifest) {
      await access(resolve(benchmarkCase.materialization.generatedFileManifest));
    }
    for (const entry of benchmarkCase.materialization.copy ?? []) {
      const source = resolve(entry.source);
      const repositoryRelativeSource = relative(process.cwd(), source);
      assert.notEqual(repositoryRelativeSource, "..");
      assert.ok(!repositoryRelativeSource.startsWith(`..${sep}`));
      assert.ok(!isAbsolute(repositoryRelativeSource));
      await access(source);
    }
  }
});

test("WB-01 materialization creates 30 files and refuses overwrite", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-product-benchmark-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const target = join(root, "wb01");
  const script = resolve("scripts/materialize-workbuddy-benchmark.mjs");

  const first = spawnSync(process.execPath, [script, "WB-01", target], { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  assert.equal((await readdir(join(target, "input"))).length, 30);
  const renameMap = JSON.parse(await readFile(join(target, "expected-rename-map.json"), "utf8")) as {
    files: Array<{ originalName: string; expectedName: string }>;
  };
  assert.equal(renameMap.files.length, 30);
  assert.equal(new Set(renameMap.files.map((entry) => entry.originalName)).size, 30);
  assert.equal(new Set(renameMap.files.map((entry) => entry.expectedName)).size, 30);
  for (const entry of renameMap.files) {
    assert.match(entry.expectedName, /^\d{4}-\d{2}-\d{2}_[^_]+_[^/\\]+\.(md|txt)$/u);
  }
  await access(join(target, "BENCHMARK-CASE.json"));

  const second = spawnSync(process.execPath, [script, "WB-01", target], { encoding: "utf8" });
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /target already exists/);
  assert.equal((await readdir(join(target, "input"))).length, 30);
});

test("every remaining benchmark case materializes into a fresh workspace", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-product-benchmark-all-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const script = resolve("scripts/materialize-workbuddy-benchmark.mjs");

  for (const caseId of ["WB-02", "WB-03", "WB-04", "WB-05", "WB-06"]) {
    const target = join(root, caseId);
    const result = spawnSync(process.execPath, [script, caseId, target], { encoding: "utf8" });
    assert.equal(result.status, 0, `${caseId}: ${result.stderr}`);
    await access(join(target, "BENCHMARK-CASE.json"));
  }

  await access(join(root, "WB-02", "input", "meeting-notes.md"));
  await access(join(root, "WB-03", "input", "metrics.csv"));
  await access(join(root, "WB-04", "input", "source-index.md"));
  await access(join(root, "WB-05", "index.html"));
  await access(join(root, "WB-06", "input", "jobs.json"));
});

test("exports a sanitized benchmark trace outside the disposable workspace", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "localbuddy-product-benchmark-trace-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const runId = "run-benchmark-trace";
  const runRoot = join(workspace, ".localbuddy", "runs", runId);
  await mkdir(workspace);
  await new RunRequestStore(() => new Date("2026-08-15T10:00:00.000Z")).save(runRoot, {
    runId,
    workspace,
    goal: "PRIVATE_BENCHMARK_GOAL",
    verificationCriteria: ["PRIVATE_VERIFICATION_CRITERION"],
    concurrency: 1,
    mode: "research",
    sourcePaths: [],
  });
  const events = new JsonlEventStore(join(runRoot, "events.jsonl"), () => new Date("2026-08-15T10:00:01.000Z"));
  await events.append({ type: "run.started", runId, data: { mode: "research", providerId: "deepseek" } });
  await events.append({ type: "plan.created", runId });
  await events.append({ type: "task.queued", runId, taskId: "integrate", data: { title: "Integrate" } });
  await events.append({ type: "task.started", runId, taskId: "integrate", agentId: "integrator" });
  await events.append({
    type: "artifact.review_completed",
    runId,
    taskId: "integrate",
    agentId: "artifact-reviewer",
    data: { verdict: "revise", findingCount: 2, sha256: "a".repeat(64) },
  });
  await events.append({
    type: "tool.failed",
    runId,
    taskId: "integrate",
    data: { toolName: "write_docx_artifact", error: "PRIVATE_TOOL_FAILURE_DETAIL" },
  });
  await events.append({ type: "task.failed", runId, taskId: "integrate", data: { error: "PRIVATE_TASK_ERROR" } });
  await events.append({ type: "run.failed", runId, data: { error: "PRIVATE_RUN_ERROR" } });

  const target = join(root, "retained", "wb02-trace.json");
  const script = resolve("scripts/export-workbuddy-trace.mjs");
  const exported = spawnSync(process.execPath, [script, "WB-02", workspace, runId, target], { encoding: "utf8" });
  assert.equal(exported.status, 0, exported.stderr);
  const content = await readFile(target, "utf8");
  const trace = JSON.parse(content) as {
    schemaVersion: number;
    caseId: string;
    diagnostics: {
      workspace: { name: string };
      artifactReview?: { status: string; revisionRequests: number };
      failureSummary: { toolFailureCounts: Record<string, number> };
    };
  };
  assert.equal(trace.schemaVersion, 1);
  assert.equal(trace.caseId, "WB-02");
  assert.equal(trace.diagnostics.workspace.name, "omitted");
  assert.equal(trace.diagnostics.artifactReview?.status, "revision_requested");
  assert.equal(trace.diagnostics.artifactReview?.revisionRequests, 1);
  assert.equal(trace.diagnostics.failureSummary.toolFailureCounts.write_docx_artifact, 1);
  assert.equal(content.includes("PRIVATE_"), false);
  assert.equal(content.includes(workspace), false);
  if (process.platform !== "win32") assert.equal((await stat(target)).mode & 0o777, 0o600);

  const overwrite = spawnSync(process.execPath, [script, "WB-02", workspace, runId, target], { encoding: "utf8" });
  assert.notEqual(overwrite.status, 0);
  assert.match(overwrite.stderr, /target already exists/u);
  const unsafeTarget = join(workspace, "trace.json");
  const unsafe = spawnSync(process.execPath, [script, "WB-02", workspace, runId, unsafeTarget], { encoding: "utf8" });
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /outside the disposable benchmark workspace/u);
  if (process.platform !== "win32") {
    const alias = join(root, "workspace-alias");
    await symlink(workspace, alias, "dir");
    const symlinkEscape = spawnSync(
      process.execPath,
      [script, "WB-02", workspace, runId, join(alias, "trace.json")],
      { encoding: "utf8" },
    );
    assert.notEqual(symlinkEscape.status, 0);
    assert.match(symlinkEscape.stderr, /outside the disposable benchmark workspace/u);
  }
});

test("benchmark documentation names every case and does not claim observed WorkBuddy results", async () => {
  const document = await readFile("docs/WORKBUDDY-PRODUCT-BENCHMARK-2026-08-15.md", "utf8");
  for (const id of ["WB-01", "WB-02", "WB-03", "WB-04", "WB-05", "WB-06"]) {
    assert.match(document, new RegExp(id));
  }
  assert.match(document, /WorkBuddy 黑盒实跑未开始/);
  assert.match(document, /不能宣称“产品能力已对标 WorkBuddy”/);
});

test("WB-02 has a source-grounded oracle and an honest mixed provider stability record", async () => {
  const caseRoot = resolve("benchmarks/workbuddy-core/cases/WB-02-document-revision");
  const [meetingNotes, budgetNotes, expected, readiness] = await Promise.all([
    readFile(join(caseRoot, "meeting-notes.md"), "utf8"),
    readFile(join(caseRoot, "budget-notes.md"), "utf8"),
    readFile(join(caseRoot, "expected-facts.json"), "utf8").then((value) => JSON.parse(value) as {
      caseId: string;
      decisions: Array<{ evidence: string }>;
      actions: Array<{ owner: string; dueDate: string; deliverable: string }>;
      risks: Array<{ evidence: string }>;
      budget: Record<string, string | number>;
      revision: { requiredFormat: string; executiveSummaryMaximumChineseCharacters: number };
    }),
    readFile(join(caseRoot, "READINESS.md"), "utf8"),
  ]);

  assert.equal(expected.caseId, "WB-02");
  assert.equal(expected.decisions.length, 4);
  assert.equal(expected.actions.length, 6);
  assert.equal(expected.risks.length, 4);
  for (const decision of expected.decisions) assert.match(meetingNotes, new RegExp(decision.evidence));
  for (const action of expected.actions) {
    assert.match(`${meetingNotes}\n${budgetNotes}`, new RegExp(action.owner));
    assert.match(`${meetingNotes}\n${budgetNotes}`, new RegExp(action.deliverable));
    if (action.dueDate !== "待确认") {
      const [, month, day] = action.dueDate.split("-");
      assert.match(meetingNotes, new RegExp(`${Number(month)} 月 ${Number(day)} 日`));
    }
  }
  for (const risk of expected.risks) assert.match(`${meetingNotes}\n${budgetNotes}`, new RegExp(risk.evidence));
  assert.equal(expected.budget.limitCny, 120000);
  assert.equal(expected.revision.requiredFormat, "docx");
  assert.equal(expected.revision.executiveSummaryMaximumChineseCharacters, 120);
  assert.match(readiness, /状态：`provider-stability-not-passed`/);
  assert.match(readiness, /确定性产品 pilot 已通过/);
  assert.match(readiness, /2 次接受、1 次失败、1 次因 grader 缺陷无法定论/);
  assert.match(readiness, /连续独立通过三次/);
  assert.doesNotMatch(readiness, /状态：`passed`|对标完成/);
});
