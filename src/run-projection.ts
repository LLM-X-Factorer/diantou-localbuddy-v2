import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  DesktopArtifactRevisionView,
  DesktopArtifactReviewView,
  DesktopArtifactView,
  DesktopCheckpointView,
  DesktopEventView,
  DesktopIntegrationView,
  DesktopRunMetricsView,
  DesktopRunStoryStageView,
  DesktopRunStoryStatus,
  DesktopRunStoryView,
  DesktopRunStatus,
  DesktopRunTimelineSpanView,
  DesktopRunView,
  DesktopTaskView,
  DesktopWorktreeView,
} from "./desktop-contract.js";
import { JsonlEventStore, type RuntimeEvent } from "./event-store.js";

export function projectRun(
  runId: string,
  workspace: string,
  events: readonly RuntimeEvent[],
  fallbackStatus: DesktopRunStatus = "starting",
): DesktopRunView {
  const tasks = new Map<string, DesktopTaskView>();
  const artifacts = new Map<string, DesktopArtifactView>();
  const worktrees = new Map<string, DesktopWorktreeView>();
  let status = fallbackStatus;
  let mode: DesktopRunView["mode"] = "research";
  let runtimeOwner: DesktopRunView["runtimeOwner"];
  let startedAt: string | undefined;
  let completedAt: string | undefined;
  let error: string | undefined;
  let integration: DesktopIntegrationView | undefined;
  let recoveryOf: string | undefined;
  let restartedAs: string | undefined;
  let checkpoint: DesktopCheckpointView | undefined;
  let providerId: string | undefined;
  let trustProfile: DesktopRunView["trustProfile"];
  let extensions: DesktopRunView["extensions"];
  let artifactRevision: DesktopArtifactRevisionView | undefined;
  let artifactReview: DesktopArtifactReviewView | undefined;

  for (const event of events) {
    if (event.type === "run.started") {
      status = "planning";
      mode = event.data?.mode === "code" ? "code" : "research";
      runtimeOwner = getRuntimeOwner(event.data?.runtimeOwner);
      startedAt = event.timestamp;
      recoveryOf = getString(event.data?.recoveryOf);
      providerId = getString(event.data?.providerId);
      trustProfile = getTrustProfile(event.data?.trustProfile);
    } else if (event.type === "run.resumed") {
      status = "running";
      completedAt = undefined;
      error = undefined;
      checkpoint = {
        status: "resuming",
        completedTasks: getNumber(event.data?.completedTasks) ?? 0,
        resumableTasks: getNumber(event.data?.resumableTasks) ?? 0,
      };
    } else if (event.type === "plan.created") {
      status = "running";
    } else if (event.type === "plan.review_requested") {
      status = "awaiting_plan_approval";
    } else if (event.type === "plan.approved") {
      status = "running";
    } else if (event.type === "plan.rejected") {
      status = "cancelling";
    } else if (event.type === "run.succeeded") {
      status = "succeeded";
      completedAt = event.timestamp;
    } else if (event.type === "run.failed") {
      status = "failed";
      completedAt = event.timestamp;
      error = getString(event.data?.error);
    } else if (event.type === "run.cancelled") {
      status = "cancelled";
      completedAt = event.timestamp;
    } else if (event.type === "checkpoint.resume_blocked") {
      checkpoint = {
        status: "blocked",
        completedTasks: getNumber(event.data?.completedTasks) ?? 0,
        resumableTasks: getNumber(event.data?.resumableTasks) ?? 0,
        reason: getString(event.data?.reason) ?? "No safe checkpoint is available",
      };
    } else if (event.type === "run.interrupted") {
      status = "interrupted";
      mode = event.data?.mode === "code" ? "code" : mode;
      runtimeOwner ??= getRuntimeOwner(event.data?.runtimeOwner);
      startedAt ??= getString(event.data?.createdAt) ?? event.timestamp;
      completedAt = event.timestamp;
      error = getString(event.data?.reason) ?? "Run was interrupted before reaching a terminal state";
      checkpoint = event.data?.resumeAvailable === true
        ? {
            status: "available",
            completedTasks: getNumber(event.data?.checkpointCompletedTasks) ?? 0,
            resumableTasks: getNumber(event.data?.checkpointResumableTasks) ?? 0,
          }
        : {
            status: "blocked",
            completedTasks: getNumber(event.data?.checkpointCompletedTasks) ?? 0,
            resumableTasks: getNumber(event.data?.checkpointResumableTasks) ?? 0,
            reason: getString(event.data?.resumeBlockedReason) ?? "No safe checkpoint is available",
          };
    } else if (event.type === "run.restarted") {
      restartedAs = getString(event.data?.newRunId);
    } else if (event.type === "extensions.loaded") {
      extensions = {
        skillIds: getStringArray(event.data?.skillIds),
        mcpServerIds: getStringArray(event.data?.mcpServerIds),
        browserOrigins: getStringArray(event.data?.browserOrigins),
        browserActionsAllowed: event.data?.browserActionsAllowed === true,
        mcpWritesAllowed: event.data?.mcpWritesAllowed === true,
      };
    } else if (event.type === "artifact.revision_linked") {
      const threadId = getString(event.data?.threadId);
      const revision = getNumber(event.data?.revision);
      const parentRunId = getString(event.data?.parentRunId);
      const parentFileName = getString(event.data?.parentFileName);
      const parentSha256 = getString(event.data?.parentSha256);
      const reason = getString(event.data?.reason);
      if (
        event.data?.version === 1
        && threadId !== undefined
        && /^thread-[a-f0-9]{24}$/.test(threadId)
        && revision !== undefined
        && Number.isInteger(revision)
        && revision >= 2
        && parentRunId !== undefined
        && parentFileName !== undefined
        && parentSha256 !== undefined
        && /^[a-f0-9]{64}$/.test(parentSha256)
        && reason !== undefined
      ) {
        artifactRevision = {
          version: 1,
          threadId,
          revision,
          parentRunId,
          parentFileName,
          parentSha256,
          reason,
        };
      }
    } else if (event.type === "artifact.review_requested") {
      artifactReview = {
        status: "reviewing",
        attempts: (artifactReview?.attempts ?? 0) + 1,
        revisionRequests: artifactReview?.revisionRequests ?? 0,
        findingCount: 0,
        candidateSha256: getString(event.data?.sha256),
      };
    } else if (event.type === "artifact.review_completed") {
      const revisionRequested = event.data?.verdict === "revise";
      artifactReview = {
        status: revisionRequested ? "revision_requested" : "accepted",
        attempts: artifactReview?.attempts ?? 1,
        revisionRequests: (artifactReview?.revisionRequests ?? 0) + (revisionRequested ? 1 : 0),
        findingCount: getNumber(event.data?.findingCount) ?? 0,
        candidateSha256: getString(event.data?.sha256),
      };
    } else if (event.type === "artifact.review_failed") {
      artifactReview = {
        status: "failed",
        attempts: artifactReview?.attempts ?? 1,
        revisionRequests: artifactReview?.revisionRequests ?? 0,
        findingCount: 0,
        candidateSha256: getString(event.data?.sha256),
      };
    }

    if (event.taskId !== undefined && event.type.startsWith("task.")) {
      const current = tasks.get(event.taskId) ?? {
        id: event.taskId,
        title: getString(event.data?.title) ?? event.taskId,
        status: "queued",
      };
      if (event.type === "task.queued") {
        current.status = "queued";
        current.title = getString(event.data?.title) ?? current.title;
      } else if (event.type === "task.started") {
        current.status = "running";
        current.agentId = event.agentId;
        current.error = undefined;
      } else if (event.type === "task.succeeded") {
        current.status = "succeeded";
        current.agentId = event.agentId ?? current.agentId;
      } else if (event.type === "task.failed") {
        current.status = "failed";
        current.agentId = event.agentId ?? current.agentId;
        current.error = getString(event.data?.error);
      } else if (event.type === "task.blocked") {
        current.status = "blocked";
      } else if (event.type === "task.cancelled") {
        current.status = "cancelled";
      }
      tasks.set(event.taskId, current);
    }

    if (event.taskId !== undefined && event.type === "checkpoint.restored") {
      const current = tasks.get(event.taskId) ?? {
        id: event.taskId,
        title: getString(event.data?.title) ?? event.taskId,
        status: "queued",
      };
      current.status = event.data?.status === "succeeded" ? "succeeded" : "queued";
      current.agentId = event.agentId ?? current.agentId;
      current.error = undefined;
      tasks.set(event.taskId, current);
    }

    if (event.type.startsWith("integration.")) {
      integration = projectIntegrationEvent(event, integration);
    }

    if (event.type === "workspace.created") {
      const worktreePath = getString(event.data?.worktreePath);
      if (worktreePath !== undefined) {
        worktrees.set(worktreePath, {
          taskId: event.taskId ?? "unknown",
          path: worktreePath,
          status: "retained",
        });
      }
    } else if (event.type === "workspace.removed") {
      const worktreePath = getString(event.data?.worktreePath);
      if (worktreePath !== undefined) {
        const current = worktrees.get(worktreePath);
        worktrees.set(worktreePath, {
          taskId: event.taskId ?? current?.taskId ?? "unknown",
          path: worktreePath,
          status: "removed",
        });
      }
    }

    if (event.type === "artifact.created") {
      const fileName = getString(event.data?.fileName);
      if (fileName !== undefined) {
        artifacts.set(fileName, {
          fileName,
          absolutePath: resolve(workspace, ".localbuddy", "runs", runId, "artifacts", fileName),
          bytes: getNumber(event.data?.bytes),
          sha256: getString(event.data?.sha256),
        });
      }
    }
  }

  if (status === "interrupted") {
    for (const task of tasks.values()) {
      if (task.status === "queued" || task.status === "running") {
        task.status = "interrupted";
      }
    }
  }

  const metrics = projectMetrics(events, status, startedAt, completedAt, tasks, integration, error);

  return {
    runId,
    mode,
    runtimeOwner,
    workspace,
    status,
    startedAt,
    completedAt,
    tasks: [...tasks.values()],
    artifacts: [...artifacts.values()],
    artifactReview,
    artifactRevision,
    recentEvents: events.slice(-14).map(toEventView),
    eventCount: events.length,
    story: projectRunStory(events, tasks, status, artifactReview),
    worktrees: [...worktrees.values()],
    checkpoint,
    integration,
    recoveryOf,
    restartedAs,
    error,
    providerId,
    trustProfile,
    extensions,
    pendingApprovals: [],
    metrics,
  };
}

const MAX_TIMELINE_SPANS = 160;

function projectRunStory(
  events: readonly RuntimeEvent[],
  tasks: ReadonlyMap<string, DesktopTaskView>,
  runStatus: DesktopRunStatus,
  artifactReview: DesktopArtifactReviewView | undefined,
): DesktopRunStoryView {
  const stages: DesktopRunStoryStageView[] = [];
  const runStarted = events.find((event) => event.type === "run.started");
  const planCreated = events.find((event) => event.type === "plan.created");
  const planReviewRequested = events.find((event) => event.type === "plan.review_requested");
  const planApproved = events.find((event) => event.type === "plan.approved");
  const planRejected = events.find((event) => event.type === "plan.rejected");

  stages.push(stageView({
    id: "prepare",
    label: "理解任务并准备计划",
    status: planCreated !== undefined
      ? "succeeded"
      : terminalStoryStatus(runStatus) ?? "running",
    startedAt: runStarted?.timestamp,
    completedAt: planCreated?.timestamp,
  }));

  if (planReviewRequested !== undefined) {
    stages.push(stageView({
      id: "plan-review",
      label: "确认执行计划",
      status: planApproved !== undefined
        ? "succeeded"
        : planRejected !== undefined
        ? "failed"
        : "waiting",
      startedAt: planReviewRequested.timestamp,
      completedAt: planApproved?.timestamp ?? planRejected?.timestamp,
    }));
  }

  for (const task of tasks.values()) {
    const started = events.find((event) => event.taskId === task.id && event.type === "task.started");
    const completed = events.findLast((event) => event.taskId === task.id && [
      "task.succeeded",
      "task.failed",
      "task.blocked",
      "task.cancelled",
    ].includes(event.type));
    stages.push(stageView({
      id: `task:${task.id}`,
      label: userFacingTaskTitle(task),
      status: taskStoryStatus(task.status),
      startedAt: started?.timestamp,
      completedAt: completed?.timestamp,
    }));
  }

  const reviewStarted = events.find((event) => event.type === "artifact.review_requested");
  const reviewCompleted = events.findLast((event) =>
    event.type === "artifact.review_completed" || event.type === "artifact.review_failed");
  if (reviewStarted !== undefined || artifactReview !== undefined) {
    stages.push(stageView({
      id: "artifact-review",
      label: "检查最终结果",
      status: artifactReview === undefined || artifactReview.status === "reviewing"
        ? "running"
        : artifactReview.status === "accepted"
        ? "succeeded"
        : artifactReview.status === "revision_requested"
        ? "running"
        : "failed",
      startedAt: reviewStarted?.timestamp,
      completedAt: artifactReview?.status === "accepted" || artifactReview?.status === "failed"
        ? reviewCompleted?.timestamp
        : undefined,
    }));
  }

  const terminalEvent = events.findLast((event) => [
    "run.succeeded",
    "run.failed",
    "run.cancelled",
    "run.interrupted",
  ].includes(event.type));
  stages.push(stageView({
    id: "complete",
    label: "结果准备完成",
    status: runStatus === "succeeded"
      ? "succeeded"
      : runStatus === "failed"
      ? "failed"
      : runStatus === "cancelled" || runStatus === "interrupted"
      ? "interrupted"
      : "queued",
    startedAt: terminalEvent?.timestamp,
    completedAt: terminalEvent?.timestamp,
  }));

  const timeline = projectTimeline(events, tasks, runStatus);
  const omittedTimelineSpans = Math.max(0, timeline.length - MAX_TIMELINE_SPANS);
  const boundedTimeline = omittedTimelineSpans === 0
    ? timeline
    : [...timeline.slice(0, 32), ...timeline.slice(-(MAX_TIMELINE_SPANS - 32))];
  return { stages, timeline: boundedTimeline, omittedTimelineSpans };
}

function projectTimeline(
  events: readonly RuntimeEvent[],
  tasks: ReadonlyMap<string, DesktopTaskView>,
  runStatus: DesktopRunStatus,
): DesktopRunTimelineSpanView[] {
  const spans: DesktopRunTimelineSpanView[] = [];
  const taskSpans = new Map<string, DesktopRunTimelineSpanView>();
  const toolSpans = new Map<string, DesktopRunTimelineSpanView>();
  const approvalSpans = new Map<string, DesktopRunTimelineSpanView>();
  const modelQueues = new Map<string, DesktopRunTimelineSpanView[]>();
  const reviewQueue: DesktopRunTimelineSpanView[] = [];
  let planReviewSpan: DesktopRunTimelineSpanView | undefined;

  for (const event of events) {
    if (event.type === "task.started" && event.taskId !== undefined) {
      const task = tasks.get(event.taskId);
      const span: DesktopRunTimelineSpanView = {
        id: `task:${event.taskId}:${event.sequence}`,
        lane: "task",
        label: task === undefined ? "处理任务" : userFacingTaskTitle(task),
        status: "running",
        startedAt: event.timestamp,
        taskId: event.taskId,
      };
      taskSpans.set(event.taskId, span);
      spans.push(span);
    } else if (
      event.taskId !== undefined
      && ["task.succeeded", "task.failed", "task.blocked", "task.cancelled"].includes(event.type)
    ) {
      const span = taskSpans.get(event.taskId);
      if (span !== undefined) closeTimelineSpan(
        span,
        event.timestamp,
        event.type === "task.succeeded"
          ? "succeeded"
          : event.type === "task.cancelled"
          ? "interrupted"
          : "failed",
      );
    } else if (event.type === "model.requested") {
      const key = `${event.taskId ?? "run"}\u0000${event.agentId ?? "agent"}`;
      const span: DesktopRunTimelineSpanView = {
        id: `model:${event.sequence}`,
        lane: "model",
        label: "模型处理",
        status: "running",
        startedAt: event.timestamp,
        ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
      };
      const queue = modelQueues.get(key) ?? [];
      queue.push(span);
      modelQueues.set(key, queue);
      spans.push(span);
    } else if (event.type === "model.completed" || event.type === "model.failed") {
      const key = `${event.taskId ?? "run"}\u0000${event.agentId ?? "agent"}`;
      const span = modelQueues.get(key)?.find((candidate) => candidate.completedAt === undefined);
      if (span !== undefined) closeTimelineSpan(
        span,
        event.timestamp,
        event.type === "model.completed" ? "succeeded" : "failed",
      );
    } else if (event.type === "tool.requested") {
      const toolCallId = getString(event.data?.toolCallId) ?? `sequence-${event.sequence}`;
      const span: DesktopRunTimelineSpanView = {
        id: `tool:${toolCallId}:${event.sequence}`,
        lane: "tool",
        label: friendlyToolLabel(getString(event.data?.toolName)),
        status: "running",
        startedAt: event.timestamp,
        ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
      };
      toolSpans.set(toolCallId, span);
      spans.push(span);
    } else if (["tool.completed", "tool.reused", "tool.failed", "tool.denied"].includes(event.type)) {
      const toolCallId = getString(event.data?.toolCallId);
      const span = toolCallId === undefined ? undefined : toolSpans.get(toolCallId);
      if (span !== undefined) closeTimelineSpan(
        span,
        event.timestamp,
        event.type === "tool.completed" || event.type === "tool.reused"
          ? "succeeded"
          : event.type === "tool.denied"
          ? "denied"
          : "failed",
      );
    } else if (event.type === "approval.requested") {
      const approvalId = getString(event.data?.approvalId) ?? `sequence-${event.sequence}`;
      const span: DesktopRunTimelineSpanView = {
        id: `approval:${approvalId}:${event.sequence}`,
        lane: "approval",
        label: "等待你确认操作",
        status: "running",
        startedAt: event.timestamp,
        ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
      };
      approvalSpans.set(approvalId, span);
      spans.push(span);
    } else if (event.type === "approval.resolved") {
      const approvalId = getString(event.data?.approvalId);
      const span = approvalId === undefined ? undefined : approvalSpans.get(approvalId);
      if (span !== undefined) closeTimelineSpan(
        span,
        event.timestamp,
        event.data?.decision === "approve" ? "succeeded" : "denied",
      );
    } else if (event.type === "plan.review_requested") {
      planReviewSpan = {
        id: `review:plan:${event.sequence}`,
        lane: "approval",
        label: "等待你确认计划",
        status: "running",
        startedAt: event.timestamp,
      };
      spans.push(planReviewSpan);
    } else if (event.type === "plan.approved" || event.type === "plan.rejected") {
      if (planReviewSpan !== undefined) closeTimelineSpan(
        planReviewSpan,
        event.timestamp,
        event.type === "plan.approved" ? "succeeded" : "denied",
      );
    } else if (event.type === "artifact.review_requested") {
      const span: DesktopRunTimelineSpanView = {
        id: `review:artifact:${event.sequence}`,
        lane: "review",
        label: "检查最终结果",
        status: "running",
        startedAt: event.timestamp,
        ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
      };
      reviewQueue.push(span);
      spans.push(span);
    } else if (event.type === "artifact.review_completed" || event.type === "artifact.review_failed") {
      const span = reviewQueue.find((candidate) => candidate.completedAt === undefined);
      if (span !== undefined) closeTimelineSpan(
        span,
        event.timestamp,
        event.type === "artifact.review_failed" ? "failed" : "succeeded",
      );
    }
  }

  if (["succeeded", "failed", "cancelled", "interrupted"].includes(runStatus)) {
    const terminalTimestamp = events.at(-1)?.timestamp;
    if (terminalTimestamp !== undefined) {
      for (const span of spans) {
        if (span.completedAt === undefined) closeTimelineSpan(span, terminalTimestamp, "interrupted");
      }
    }
  }
  return spans.toSorted((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function stageView(input: Omit<DesktopRunStoryStageView, "durationMs">): DesktopRunStoryStageView {
  return {
    ...input,
    ...durationField(input.startedAt, input.completedAt),
  };
}

function closeTimelineSpan(
  span: DesktopRunTimelineSpanView,
  completedAt: string,
  status: DesktopRunTimelineSpanView["status"],
) {
  span.completedAt = completedAt;
  span.status = status;
  const durationMs = durationBetween(span.startedAt, completedAt);
  if (durationMs !== undefined) span.durationMs = durationMs;
}

function durationField(startedAt: string | undefined, completedAt: string | undefined) {
  const durationMs = durationBetween(startedAt, completedAt);
  return durationMs === undefined ? {} : { durationMs };
}

function durationBetween(startedAt: string | undefined, completedAt: string | undefined): number | undefined {
  if (startedAt === undefined || completedAt === undefined) return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : undefined;
}

function taskStoryStatus(status: DesktopTaskView["status"]): DesktopRunStoryStatus {
  if (status === "queued") return "queued";
  if (status === "running") return "running";
  if (status === "succeeded") return "succeeded";
  if (status === "interrupted" || status === "cancelled") return "interrupted";
  return "failed";
}

function terminalStoryStatus(status: DesktopRunStatus): DesktopRunStoryStatus | undefined {
  if (status === "failed") return "failed";
  if (status === "interrupted" || status === "cancelled") return "interrupted";
  if (status === "succeeded") return "succeeded";
  return undefined;
}

function userFacingTaskTitle(task: DesktopTaskView): string {
  if (
    task.id === "integrate"
    || task.agentId === "integrator"
    || /^integrate worker results$/iu.test(task.title)
  ) return "汇总并整理结果";
  return task.title.trim().length === 0 ? "处理任务" : task.title;
}

function friendlyToolLabel(toolName: string | undefined): string {
  if (toolName === undefined) return "使用工具";
  if (/^(?:read_|search_).*(?:source|file)|^(?:read_source_file|search_source_text)$/iu.test(toolName)) return "查找并读取资料";
  if (/write_(?:docx_)?artifact/iu.test(toolName)) return "生成结果文件";
  if (/browser|web_(?:search|fetch)/iu.test(toolName)) return "查找网页资料";
  if (/mcp|__/iu.test(toolName)) return "使用已连接的服务";
  if (/execute|command|shell|bash/iu.test(toolName)) return "运行本机检查";
  return toolName
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (value) => value.toUpperCase());
}

function projectMetrics(
  events: readonly RuntimeEvent[],
  status: DesktopRunStatus,
  startedAt: string | undefined,
  completedAt: string | undefined,
  tasks: ReadonlyMap<string, DesktopTaskView>,
  integration: DesktopIntegrationView | undefined,
  error: string | undefined,
): DesktopRunMetricsView {
  let modelCalls = 0;
  let totalTokens = 0;
  let modelFailures = 0;
  let toolFailures = 0;
  let artifactGateRetries = 0;
  for (const event of events) {
    if (event.type === "model.completed") {
      modelCalls += 1;
      totalTokens += getNumber(event.data?.totalTokens) ?? 0;
    } else if (event.type === "model.failed") {
      modelFailures += 1;
    } else if (event.type === "tool.failed") {
      toolFailures += 1;
      if (
        event.data?.toolName === "write_artifact"
        || event.data?.toolName === "write_docx_artifact"
      ) artifactGateRetries += 1;
    }
  }
  const startMs = startedAt === undefined ? undefined : Date.parse(startedAt);
  const endTimestamp = completedAt ?? events.at(-1)?.timestamp;
  const endMs = endTimestamp === undefined ? undefined : Date.parse(endTimestamp);
  const durationMs = startMs !== undefined
    && endMs !== undefined
    && Number.isFinite(startMs)
    && Number.isFinite(endMs)
    && endMs >= startMs
    ? endMs - startMs
    : undefined;
  let failureStage: DesktopRunMetricsView["failureStage"];
  if (status === "failed") {
    if (
      integration?.status === "preflight_failed"
      || integration?.status === "failed"
      || integration?.status === "recovery_required"
    ) {
      failureStage = "integration";
    } else if (artifactGateRetries > 0) {
      failureStage = "artifact_gate";
    } else if ([...tasks.values()].some((task) => task.status === "failed" || task.status === "blocked")) {
      failureStage = "task";
    } else if (!events.some((event) => event.type === "plan.created")) {
      failureStage = /\b(?:MCP|extension|skill|browser)\b/i.test(error ?? "")
        ? "extensions"
        : "planning";
    } else {
      failureStage = "runtime";
    }
  }
  return {
    durationMs,
    modelCalls,
    totalTokens,
    modelFailures,
    toolFailures,
    artifactGateRetries,
    failureStage,
  };
}

function getTrustProfile(value: unknown): DesktopRunView["trustProfile"] {
  return value === "strict" || value === "balanced" || value === "automation"
    ? value
    : undefined;
}

function projectIntegrationEvent(
  event: RuntimeEvent,
  current?: DesktopIntegrationView,
): DesktopIntegrationView {
  const base: DesktopIntegrationView = current ?? {
    status: "preflighting",
    changedPaths: [],
    checkCommands: [],
  };
  if (event.type === "integration.preflight_started") {
    return { ...base, status: "preflighting", error: undefined };
  }
  if (event.type === "integration.preflight_failed") {
    return { ...base, status: "preflight_failed", error: getString(event.data?.error) };
  }
  if (event.type === "integration.awaiting_approval") {
    return {
      ...base,
      status: "awaiting_approval",
      proposalPath: getString(event.data?.proposalPath),
      combinedPatchPath: getString(event.data?.combinedPatchPath),
      combinedPatchSha256: getString(event.data?.combinedPatchSha256),
      previewWorktree: getString(event.data?.previewWorktree),
      changedPaths: getStringArray(event.data?.changedPaths),
      checkCommands: getStringArray(event.data?.checkCommands),
      error: undefined,
    };
  }
  if (event.type === "integration.approved" || event.type === "integration.applying") {
    return { ...base, status: "applying", error: undefined };
  }
  if (event.type === "integration.applied") {
    return { ...base, status: "applied", changedPaths: getStringArray(event.data?.changedPaths) };
  }
  if (event.type === "integration.committed") {
    return {
      ...base,
      status: "committed",
      changedPaths: getStringArray(event.data?.changedPaths),
      commitSha: getString(event.data?.commitSha),
    };
  }
  if (event.type === "integration.reverted") {
    return { ...base, status: "reverted" };
  }
  if (event.type === "integration.revert_committed") {
    return {
      ...base,
      status: "revert_committed",
      revertCommitSha: getString(event.data?.revertCommitSha),
    };
  }
  if (event.type === "integration.failed") {
    return {
      ...base,
      status: "failed",
      error: getString(event.data?.error),
      rolledBack: event.data?.rolledBack === true,
    };
  }
  if (event.type === "integration.recovery_required") {
    return {
      ...base,
      status: "recovery_required",
      error: getString(event.data?.error),
      rolledBack: false,
    };
  }
  return base;
}

export async function loadWorkspaceRunHistory(
  workspace: string,
): Promise<readonly DesktopRunView[]> {
  const runsRoot = resolve(workspace, ".localbuddy", "runs");
  let entries;
  try {
    entries = await readdir(runsRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const runs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const store = new JsonlEventStore(resolve(runsRoot, entry.name, "events.jsonl"));
        try {
          return projectRun(entry.name, workspace, await store.list(entry.name));
        } catch (error) {
          return {
            ...projectRun(entry.name, workspace, [], "failed"),
            error: `Unable to read event history: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }),
  );
  return runs.toSorted((left, right) =>
    (right.startedAt ?? "").localeCompare(left.startedAt ?? ""),
  );
}

function toEventView(event: RuntimeEvent): DesktopEventView {
  const toolName = getString(event.data?.toolName);
  const toolFailure = event.type === "tool.failed"
    && (toolName === "write_artifact" || toolName === "write_docx_artifact")
    ? getString(event.data?.error)?.slice(0, 240)
    : undefined;
  const artifactReviewDetail = event.type === "artifact.review_completed"
    ? event.data?.verdict === "accept"
      ? "独立审核通过"
      : `退回修订 · ${getNumber(event.data?.findingCount) ?? 0} 项`
    : event.type === "artifact.review_requested"
      ? "正在核对目标、证据与最终产物"
      : event.type === "artifact.review_failed"
        ? "独立审核未能形成有效结论"
        : undefined;
  return {
    sequence: event.sequence,
    timestamp: event.timestamp,
    type: event.type,
    taskId: event.taskId,
    agentId: event.agentId,
    detail: artifactReviewDetail
      ?? (toolFailure === undefined ? toolName : `${toolName} · ${toolFailure}`)
      ?? (event.type === "extensions.loaded" ? getStringArray(event.data?.skillIds).join(", ") || "extensions" : undefined)
      ?? getString(event.data?.fileName)
      ?? getString(event.data?.commitSha)
      ?? getString(event.data?.newRunId)
      ?? getString(event.data?.worktreePath)
      ?? getString(event.data?.reason)
      ?? getString(event.data?.error),
  };
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getRuntimeOwner(value: unknown): DesktopRunView["runtimeOwner"] {
  return value === "desktop" || value === "cli" || value === "core" ? value : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
