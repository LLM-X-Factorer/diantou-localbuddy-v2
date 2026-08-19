import { randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";

import type { ExecutionHost } from "./execution-host.js";
import { UnifiedApprovalPolicy } from "./tool-runtime.js";
import type {
  ApprovalDecision,
  ApprovalPolicy,
  ToolContext,
  ToolDefinition,
  TrustProfile,
  UnifiedApprovalHandler,
} from "./tool-runtime.js";

const MAX_EDIT_BYTES = 500_000;
const MAX_COMMAND_OUTPUT = 100_000;

export type CheckCommand =
  | "git_diff_check"
  | "git_status"
  | "pnpm_test"
  | "pnpm_typecheck"
  | "node_test";

export interface CheckCommandResult {
  command: CheckCommand;
  stdout: string;
  stderr: string;
  exitCode: 0;
}

export async function createCodingTools(
  worktreeRoot: string,
  ownedPaths: readonly string[],
  execution?: {
    host: ExecutionHost;
    readRoots: readonly string[];
  },
): Promise<readonly ToolDefinition[]> {
  const root = await realpath(worktreeRoot);
  if (ownedPaths.length === 0) {
    throw new Error("coding tools require at least one owned path");
  }
  const normalizedOwnedPaths = ownedPaths.map(normalizeOwnedPath);
  return [
    createReplaceTextTool(root, normalizedOwnedPaths),
    createFileTool(root, normalizedOwnedPaths),
    createRunCheckTool(root, execution),
  ];
}

export class CodingSandboxApprovalPolicy implements ApprovalPolicy {
  readonly #policy: UnifiedApprovalPolicy;

  constructor(options: {
    profile?: TrustProfile;
    approvalHandler?: UnifiedApprovalHandler;
  } = {}) {
    this.#policy = new UnifiedApprovalPolicy({
      profile: options.profile ?? "balanced",
      approvalHandler: options.approvalHandler,
    });
  }

  authorize(
    tool: ToolDefinition,
    context: ToolContext,
    toolCall?: Parameters<ApprovalPolicy["authorize"]>[2],
  ): Promise<ApprovalDecision> {
    return this.#policy.authorize(tool, context, toolCall);
  }
}

function createReplaceTextTool(root: string, ownedPaths: readonly string[]): ToolDefinition<{
  path: string;
  oldText: string;
  newText: string;
}> {
  return {
    name: "replace_text",
    description: "Replace one exact text occurrence in an existing UTF-8 file in the isolated worktree.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
      },
      required: ["path", "oldText", "newText"],
      additionalProperties: false,
    },
    risk: "write",
    permission: "worktree.write",
    parse(input) {
      const record = expectObject(input);
      const oldText = expectString(record.oldText, "oldText", false);
      if (oldText.length === 0) {
        throw new Error("oldText cannot be empty");
      }
      return {
        path: expectString(record.path, "path"),
        oldText,
        newText: expectString(record.newText, "newText", false),
      };
    },
    async execute(input) {
      assertOwnedPath(input.path, ownedPaths);
      const filePath = await resolveExistingFile(root, input.path);
      const metadata = await stat(filePath);
      if (metadata.size > MAX_EDIT_BYTES) {
        throw new Error(`file exceeds ${MAX_EDIT_BYTES} byte edit limit`);
      }
      const content = await readFile(filePath, "utf8");
      const first = content.indexOf(input.oldText);
      if (first < 0) {
        throw new Error("oldText was not found");
      }
      if (content.indexOf(input.oldText, first + input.oldText.length) >= 0) {
        throw new Error("oldText must match exactly once");
      }
      const updated = `${content.slice(0, first)}${input.newText}${content.slice(first + input.oldText.length)}`;
      if (Buffer.byteLength(updated) > MAX_EDIT_BYTES) {
        throw new Error(`updated file exceeds ${MAX_EDIT_BYTES} byte edit limit`);
      }
      const temporaryPath = resolve(dirname(filePath), `.localbuddy-edit-${process.pid}-${randomUUID()}`);
      await writeFile(temporaryPath, updated, { encoding: "utf8", flag: "wx", mode: metadata.mode });
      await rename(temporaryPath, filePath);
      return { path: relative(root, filePath), replacements: 1, bytes: Buffer.byteLength(updated) };
    },
  };
}

function createFileTool(
  root: string,
  ownedPaths: readonly string[],
): ToolDefinition<{ path: string; content: string }> {
  return {
    name: "create_file",
    description: "Create a new UTF-8 file in the isolated worktree. Existing files are never overwritten.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
    risk: "write",
    permission: "worktree.write",
    parse(input) {
      const record = expectObject(input);
      const content = expectString(record.content, "content", false);
      if (Buffer.byteLength(content) > MAX_EDIT_BYTES) {
        throw new Error(`content exceeds ${MAX_EDIT_BYTES} byte edit limit`);
      }
      return { path: expectString(record.path, "path"), content };
    },
    async execute(input) {
      assertOwnedPath(input.path, ownedPaths);
      const filePath = resolveCandidate(root, input.path);
      const canonicalParent = await realpath(dirname(filePath));
      assertInside(root, canonicalParent);
      await writeFile(filePath, input.content, { encoding: "utf8", flag: "wx" });
      return { path: relative(root, filePath), bytes: Buffer.byteLength(input.content) };
    },
  };
}

function createRunCheckTool(
  root: string,
  execution?: { host: ExecutionHost; readRoots: readonly string[] },
): ToolDefinition<{ command: CheckCommand }> {
  return {
    name: "run_check",
    description: "Run one allowlisted, non-shell verification command inside the isolated worktree.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: ["git_diff_check", "git_status", "pnpm_test", "pnpm_typecheck", "node_test"],
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    risk: "execute",
    permission: "process.execute",
    parse(input) {
      const command = expectObject(input).command;
      if (!isCheckCommand(command)) {
        throw new Error("command is not in the verification allowlist");
      }
      return { command };
    },
    async execute(input, context) {
      if (execution === undefined) {
        throw new Error("run_check requires a configured constrained ExecutionHost");
      }
      return runCheckCommand(root, input.command, execution.host, context, execution.readRoots);
    },
  };
}

export async function runCheckCommand(
  worktreeRoot: string,
  checkCommand: CheckCommand,
  executionHost: ExecutionHost,
  context: ToolContext,
  readRoots: readonly string[] = [],
): Promise<CheckCommandResult> {
  const root = await realpath(worktreeRoot);
  const [command, args] = commandArguments(checkCommand);
  const result = await executionHost.run({
    command,
    args,
    cwd: root,
    readRoots: [root, ...readRoots],
    writableRoots: [root],
    network: "deny",
    maxOutputBytes: MAX_COMMAND_OUTPUT,
    timeoutMs: 120_000,
    environment: safeCommandEnvironment(),
  }, context);
  if (result.exitCode !== 0) {
    throw new Error(
      `check ${checkCommand} failed with exit code ${result.exitCode}: ${boundOutput(result.stderr || result.stdout)}`,
    );
  }
  return {
    command: checkCommand,
    stdout: boundOutput(result.stdout),
    stderr: boundOutput(result.stderr),
    exitCode: 0,
  };
}

function commandArguments(command: CheckCommand): [string, string[]] {
  switch (command) {
    case "git_diff_check": return ["git", ["diff", "--check", "--", "."]];
    case "git_status": return ["git", ["status", "--short", "--untracked-files=all"]];
    case "pnpm_test": return ["pnpm", ["test"]];
    case "pnpm_typecheck": return ["pnpm", ["typecheck"]];
    case "node_test": return ["node", ["--test"]];
  }
}

async function resolveExistingFile(root: string, inputPath: string): Promise<string> {
  const candidate = resolveCandidate(root, inputPath);
  if ((await lstat(candidate)).isSymbolicLink()) {
    throw new Error("symbolic links are not editable");
  }
  const canonical = await realpath(candidate);
  assertInside(root, canonical);
  if (!(await stat(canonical)).isFile()) {
    throw new Error("path must be a regular file");
  }
  return canonical;
}

function resolveCandidate(root: string, inputPath: string): string {
  if (inputPath.trim().length === 0 || isAbsolute(inputPath)) {
    throw new Error("path must be a non-empty relative path");
  }
  const candidate = resolve(root, inputPath);
  assertInside(root, candidate);
  return candidate;
}

function assertInside(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error("path escapes the isolated worktree");
  }
}

function assertOwnedPath(inputPath: string, ownedPaths: readonly string[]): void {
  const normalized = normalizeRelativePath(inputPath);
  const owned = ownedPaths.some((owner) => {
    if (owner.endsWith("/")) {
      return normalized.startsWith(owner);
    }
    return normalized === owner;
  });
  if (!owned) {
    throw new Error(`path is outside this task's owned paths: ${inputPath}`);
  }
}

function normalizeOwnedPath(path: string): string {
  const directory = path.endsWith("/");
  const normalized = normalizeRelativePath(path);
  if (
    normalized === ".git"
    || normalized.startsWith(".git/")
    || normalized === ".localbuddy"
    || normalized.startsWith(".localbuddy/")
    || normalized === ".localbuddy-internal"
    || normalized.startsWith(".localbuddy-internal/")
  ) {
    throw new Error(`unsafe coding owned path: ${path}`);
  }
  return directory ? `${normalized.replace(/\/$/, "")}/` : normalized;
}

function normalizeRelativePath(path: string): string {
  const portable = path.replaceAll("\\", "/");
  const normalized = posix.normalize(portable).replace(/^\.\//, "");
  if (
    normalized.length === 0
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.startsWith("/")
  ) {
    throw new Error(`unsafe relative path: ${path}`);
  }
  return normalized;
}

function safeCommandEnvironment(): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL,
    TMPDIR: process.env.TMPDIR,
    CI: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function boundOutput(output: string): string {
  return output.length <= MAX_COMMAND_OUTPUT
    ? output
    : `${output.slice(0, MAX_COMMAND_OUTPUT)}\n[command output truncated]`;
}

function isCheckCommand(value: unknown): value is CheckCommand {
  return ["git_diff_check", "git_status", "pnpm_test", "pnpm_typecheck", "node_test"].includes(
    String(value),
  );
}

function expectObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("tool input must be an object");
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, name: string, nonEmpty = true): string {
  if (typeof value !== "string" || (nonEmpty && value.trim().length === 0)) {
    throw new Error(`${name} must be ${nonEmpty ? "a non-empty string" : "a string"}`);
  }
  return value;
}
