import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";

import type { EventStore, RuntimeEvent } from "./event-store.js";
import { ExecutionCoordinator } from "./execution-coordinator.js";
import { validateRunId } from "./run-request-store.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT = 10 * 1024 * 1024;
const PROTECTED_INTEGRATION_EVENTS = new Set([
  "integration.awaiting_approval",
  "integration.approved",
  "integration.applying",
  "integration.applied",
  "integration.recovery_required",
]);
const RELEASED_INTEGRATION_EVENTS = new Set([
  "integration.preflight_failed",
  "integration.committed",
  "integration.reverted",
  "integration.revert_committed",
  "integration.failed",
]);

export interface WorktreeCleanupResult {
  removed: readonly string[];
  alreadyMissing: readonly string[];
}

export interface WorktreeLifecycleOptions {
  eventStore: EventStore;
  executionCoordinator?: ExecutionCoordinator;
}

/** Removes only worktrees that both the append-only log and Git identify as belonging to a Run. */
export class WorktreeLifecycleManager {
  readonly #eventStore: EventStore;
  readonly #coordinator: ExecutionCoordinator;

  constructor(options: WorktreeLifecycleOptions) {
    this.#eventStore = options.eventStore;
    this.#coordinator = options.executionCoordinator ?? new ExecutionCoordinator(3);
  }

  async cleanup(repoRootInput: string, runId: string): Promise<WorktreeCleanupResult> {
    validateRunId(runId);
    const repoRoot = await realpath(repoRootInput);
    const events = await this.#eventStore.list(runId);
    if (events.length === 0) {
      throw new Error(`Run history does not exist: ${runId}`);
    }
    if (!hasTerminalRunState(events)) {
      throw new Error("worktrees cannot be cleaned while the Run is nonterminal");
    }
    if (isWorktreeCleanupProtected(events)) {
      throw new Error("worktrees are protected by an unresolved integration proposal");
    }

    const retained = retainedWorktrees(events);
    if (retained.length === 0) {
      return { removed: [], alreadyMissing: [] };
    }
    const release = await acquireCoordinator(
      this.#coordinator,
      `${runId}:worktree-cleanup`,
      repoRoot,
    );
    const removed: string[] = [];
    const alreadyMissing: string[] = [];
    try {
      const registeredWithGit = new Set(
        parseGitWorktreePaths(await git(repoRoot, ["worktree", "list", "--porcelain", "-z"]))
          .map((path) => resolve(path)),
      );
      const allowedRoot = resolve(repoRoot, ".localbuddy", "worktrees");
      for (const worktree of retained) {
        const candidate = resolve(worktree.path);
        assertInside(allowedRoot, candidate);
        if (!registeredWithGit.has(candidate)) {
          if (await pathExists(candidate)) {
            throw new Error(`refusing to delete a directory Git does not identify as a worktree: ${candidate}`);
          }
          alreadyMissing.push(candidate);
          await this.#eventStore.append({
            type: "workspace.removed",
            runId,
            taskId: worktree.taskId,
            data: { worktreePath: candidate, alreadyMissing: true },
          });
          continue;
        }
        await git(repoRoot, ["worktree", "remove", "--force", candidate]);
        removed.push(candidate);
        registeredWithGit.delete(candidate);
        await this.#eventStore.append({
          type: "workspace.removed",
          runId,
          taskId: worktree.taskId,
          data: { worktreePath: candidate, alreadyMissing: false },
        });
      }
      await git(repoRoot, ["worktree", "prune"]);
      return { removed, alreadyMissing };
    } finally {
      release();
    }
  }
}

function hasTerminalRunState(events: readonly RuntimeEvent[]): boolean {
  const lifecycle = events.toReversed().find((event) =>
    event.type === "run.started"
    || event.type === "run.resumed"
    || event.type === "run.succeeded"
    || event.type === "run.failed"
    || event.type === "run.cancelled"
    || event.type === "run.interrupted",
  );
  return lifecycle?.type === "run.succeeded"
    || lifecycle?.type === "run.failed"
    || lifecycle?.type === "run.cancelled"
    || lifecycle?.type === "run.interrupted";
}

export function isWorktreeCleanupProtected(events: readonly RuntimeEvent[]): boolean {
  let protectedState = false;
  for (const event of events) {
    if (PROTECTED_INTEGRATION_EVENTS.has(event.type)) {
      protectedState = true;
    } else if (RELEASED_INTEGRATION_EVENTS.has(event.type)) {
      protectedState = false;
    }
  }
  return protectedState;
}

function retainedWorktrees(
  events: readonly RuntimeEvent[],
): readonly { taskId: string; path: string }[] {
  const worktrees = new Map<string, { taskId: string; path: string; retained: boolean }>();
  for (const event of events) {
    const path = typeof event.data?.worktreePath === "string" ? event.data.worktreePath : undefined;
    if (path === undefined) {
      continue;
    }
    if (event.type === "workspace.created") {
      worktrees.set(path, { taskId: event.taskId ?? "unknown", path, retained: true });
    } else if (event.type === "workspace.removed") {
      const current = worktrees.get(path);
      if (current !== undefined) {
        current.retained = false;
      }
    }
  }
  return [...worktrees.values()].filter((worktree) => worktree.retained);
}

function parseGitWorktreePaths(output: string): readonly string[] {
  return output
    .split("\0")
    .filter((field) => field.startsWith("worktree "))
    .map((field) => field.slice("worktree ".length));
}

async function acquireCoordinator(
  coordinator: ExecutionCoordinator,
  taskKey: string,
  repoRoot: string,
): Promise<() => void> {
  const workspace = { resourceId: repoRoot, access: "write" as const };
  while (true) {
    const version = coordinator.version;
    if (coordinator.canAcquire(taskKey, workspace)) {
      return coordinator.acquire(taskKey, workspace);
    }
    await coordinator.waitForChange(version);
  }
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT,
    env: {
      PATH: process.env.PATH,
      LANG: process.env.LANG ?? "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL,
      TMPDIR: process.env.TMPDIR,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return stdout;
}

function assertInside(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === "" || pathFromRoot.startsWith("..") || pathFromRoot.includes("../")) {
    throw new Error("worktree path escapes the LocalBuddy worktree root");
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
