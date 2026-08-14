import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  DesktopArtifactView,
  DesktopCheckpointView,
  DesktopEventView,
  DesktopIntegrationView,
  DesktopRunMetricsView,
  DesktopRunStatus,
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
    recentEvents: events.slice(-14).map(toEventView),
    eventCount: events.length,
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
      if (event.data?.toolName === "write_artifact") artifactGateRetries += 1;
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
  const toolFailure = event.type === "tool.failed" && toolName === "write_artifact"
    ? getString(event.data?.error)?.slice(0, 240)
    : undefined;
  return {
    sequence: event.sequence,
    timestamp: event.timestamp,
    type: event.type,
    taskId: event.taskId,
    agentId: event.agentId,
    detail: (toolFailure === undefined ? toolName : `${toolName} · ${toolFailure}`)
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
