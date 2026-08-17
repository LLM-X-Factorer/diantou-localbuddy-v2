import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { ensurePrivateDirectory } from "./private-storage.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT = 10 * 1024 * 1024;

export interface GitWorktreeHandle {
  repoRoot: string;
  worktreePath: string;
  headSha: string;
  runId: string;
  taskId: string;
}

export interface GitWorktreeDiff {
  patch: string;
  status: string;
  changedPaths: readonly string[];
  clean: boolean;
}

export interface RestoredGitWorktree {
  handle: GitWorktreeHandle;
  restored: boolean;
}

/** Creates detached, inspectable worktrees without changing the primary checkout. */
export class GitWorktreeManager {
  async validatePrimary(repoRoot: string): Promise<{ repoRoot: string; headSha: string }> {
    const canonicalRoot = await realpath(repoRoot);
    const topLevel = await git(canonicalRoot, ["rev-parse", "--show-toplevel"]);
    const canonicalTopLevel = await realpath(topLevel.trim());
    if (canonicalTopLevel !== canonicalRoot) {
      throw new Error(`workspace must be the Git repository root: ${canonicalTopLevel}`);
    }

    const status = await git(canonicalRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
    if (status.trim().length > 0) {
      if (status.split("\n").filter(Boolean).every((line) => line.includes(".localbuddy/"))) {
        throw new Error(
          "coding sandbox requires .localbuddy/ to be ignored by Git before a Run starts",
        );
      }
      throw new Error(
        "coding sandbox requires a clean primary worktree so every patch has an unambiguous HEAD baseline",
      );
    }
    const headSha = (await git(canonicalRoot, ["rev-parse", "--verify", "HEAD"])).trim();
    return { repoRoot: canonicalRoot, headSha };
  }

  async create(repoRoot: string, runId: string, taskId: string): Promise<GitWorktreeHandle> {
    const validated = await this.validatePrimary(repoRoot);
    const canonicalRoot = validated.repoRoot;
    const headSha = validated.headSha;
    const worktreePath = buildWorktreePath(canonicalRoot, runId, taskId);
    assertInside(canonicalRoot, worktreePath);
    if (await pathExists(worktreePath)) {
      throw new Error(`coding worktree already exists: ${worktreePath}`);
    }
    await ensurePrivateDirectory(resolve(canonicalRoot, ".localbuddy"));
    await ensurePrivateDirectory(resolve(canonicalRoot, ".localbuddy", "worktrees"));
    await ensurePrivateDirectory(dirname(worktreePath));
    await git(canonicalRoot, ["worktree", "add", "--detach", worktreePath, headSha]);
    const canonicalWorktree = await realpath(worktreePath);
    await ensurePrivateDirectory(canonicalWorktree);

    return {
      repoRoot: canonicalRoot,
      worktreePath: canonicalWorktree,
      headSha,
      runId,
      taskId,
    };
  }

  async inspectExpected(
    repoRoot: string,
    runId: string,
    taskId: string,
    expectedHead: string,
  ): Promise<GitWorktreeHandle | undefined> {
    const validated = await this.validatePrimary(repoRoot);
    if (validated.headSha !== expectedHead) {
      throw new Error(
        `primary HEAD changed after Coding checkpoint: expected ${expectedHead}, got ${validated.headSha}`,
      );
    }
    const expectedPath = buildWorktreePath(validated.repoRoot, runId, taskId);
    const registered = parseWorktreeRegistry(
      await git(validated.repoRoot, ["worktree", "list", "--porcelain", "-z"]),
    );
    const registryHead = registered.get(expectedPath);
    const exists = await pathExists(expectedPath);
    if (!exists) {
      if (registryHead !== undefined) {
        throw new Error(`Git still registers a missing Coding worktree: ${expectedPath}`);
      }
      return undefined;
    }
    const canonicalWorktree = await realpath(expectedPath);
    if (canonicalWorktree !== expectedPath || registryHead === undefined) {
      throw new Error(`Coding worktree is not registered at its expected path: ${expectedPath}`);
    }
    const actualHead = (await git(canonicalWorktree, ["rev-parse", "HEAD"])).trim();
    if (registryHead !== expectedHead || actualHead !== expectedHead) {
      throw new Error(
        `Coding worktree HEAD changed for ${taskId}: expected ${expectedHead}, got ${actualHead}`,
      );
    }
    return {
      repoRoot: validated.repoRoot,
      worktreePath: canonicalWorktree,
      headSha: actualHead,
      runId,
      taskId,
    };
  }

  async restoreOrCreate(
    repoRoot: string,
    runId: string,
    taskId: string,
    expectedHead: string,
  ): Promise<RestoredGitWorktree> {
    const existing = await this.inspectExpected(repoRoot, runId, taskId, expectedHead);
    if (existing !== undefined) {
      return { handle: existing, restored: true };
    }
    const handle = await this.create(repoRoot, runId, taskId);
    if (handle.headSha !== expectedHead) {
      throw new Error(
        `Coding worktree baseline changed during creation: expected ${expectedHead}, got ${handle.headSha}`,
      );
    }
    return { handle, restored: false };
  }

  async captureDiff(handle: GitWorktreeHandle): Promise<GitWorktreeDiff> {
    const canonicalWorktree = await realpath(handle.worktreePath);
    if (canonicalWorktree !== handle.worktreePath) {
      throw new Error("coding worktree path changed after creation");
    }
    await git(canonicalWorktree, ["add", "--intent-to-add", "--all", "--", "."]);
    await git(canonicalWorktree, ["diff", "--check", "--", "."]);
    const [patch, status, changedPathOutput] = await Promise.all([
      git(canonicalWorktree, [
        "diff",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-textconv",
        "--",
        ".",
      ]),
      git(canonicalWorktree, ["status", "--short", "--untracked-files=all"]),
      git(canonicalWorktree, ["diff", "--name-only", "-z", "--", "."]),
    ]);
    const changedPaths = changedPathOutput.split("\0").filter(Boolean);
    return { patch, status, changedPaths, clean: status.trim().length === 0 };
  }
}

function buildWorktreePath(repoRoot: string, runId: string, taskId: string): string {
  const runSegment = safeSegment(runId);
  const taskSegment = safeSegment(taskId);
  const worktreePath = resolve(
    repoRoot,
    ".localbuddy",
    "worktrees",
    `${runSegment}-${shortHash(runId)}`,
    `${taskSegment}-${shortHash(taskId)}`,
  );
  assertInside(repoRoot, worktreePath);
  return worktreePath;
}

function parseWorktreeRegistry(output: string): ReadonlyMap<string, string> {
  const worktrees = new Map<string, string>();
  let currentPath: string | undefined;
  for (const field of output.split("\0")) {
    if (field.startsWith("worktree ")) {
      currentPath = resolve(field.slice("worktree ".length));
    } else if (field.startsWith("HEAD ") && currentPath !== undefined) {
      worktrees.set(currentPath, field.slice("HEAD ".length));
    }
  }
  return worktrees;
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT,
    env: safeCommandEnvironment(),
  });
  return stdout;
}

function safeCommandEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL,
    TMPDIR: process.env.TMPDIR,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function safeSegment(value: string): string {
  const segment = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (segment.length === 0) {
    throw new Error("run and task identifiers must contain a safe path character");
  }
  return segment.slice(0, 48);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function assertInside(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === "" || pathFromRoot.startsWith("..") || pathFromRoot.includes("../")) {
    throw new Error("worktree path escapes the repository root");
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
