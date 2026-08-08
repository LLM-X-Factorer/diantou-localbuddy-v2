import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, parse as parsePath, resolve } from "node:path";

import type { EventStore } from "./event-store.js";
import type { ToolContext } from "./tool-runtime.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 100_000;
const MAX_EXECUTION_TIMEOUT_MS = 15 * 60_000;
const MAX_EXECUTION_OUTPUT = 2 * 1024 * 1024;
const TERMINATE_GRACE_MS = 250;

export type ExecutionIsolation = "seatbelt" | "container";

export interface ExecutionRequest {
  command: string;
  args?: readonly string[];
  cwd: string;
  readRoots: readonly string[];
  writableRoots: readonly string[];
  network?: "deny" | "allow";
  environment?: Readonly<Record<string, string | undefined>>;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ExecutionResult {
  executionId: string;
  isolation: ExecutionIsolation;
  exitCode: number;
  signal?: NodeJS.Signals;
  stdout: string;
  stderr: string;
  durationMs: number;
  outputTruncated: boolean;
}

export interface ExecutionHost {
  readonly isolation: ExecutionIsolation;
  run(request: ExecutionRequest, context: ToolContext): Promise<ExecutionResult>;
}

export interface ConstrainedLaunch {
  command: string;
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  isolation: ExecutionIsolation;
}

export interface SeatbeltLaunchRequest {
  command: string;
  args?: readonly string[];
  cwd: string;
  readRoots: readonly string[];
  writableRoots: readonly string[];
  temporaryRoot: string;
  network?: "deny" | "allow";
  environment?: Readonly<Record<string, string | undefined>>;
  sandboxExecutable?: string;
}

export interface ContainerLaunchRequest extends Omit<SeatbeltLaunchRequest, "sandboxExecutable"> {
  image: string;
  containerExecutable?: string;
  containerName?: string;
}

/**
 * Runs model-triggered local commands through a fail-closed OS boundary.
 * It never invokes a shell and never falls back to an unconstrained process.
 */
export class SeatbeltExecutionHost implements ExecutionHost {
  readonly isolation = "seatbelt" as const;
  readonly #eventStore: EventStore;
  readonly #temporaryRoot: string;
  readonly #sandboxExecutable: string;

  constructor(options: {
    eventStore: EventStore;
    temporaryRoot: string;
    sandboxExecutable?: string;
  }) {
    if (process.platform !== "darwin") {
      throw new Error("Seatbelt execution is available only on macOS");
    }
    this.#eventStore = options.eventStore;
    this.#temporaryRoot = resolve(options.temporaryRoot);
    this.#sandboxExecutable = options.sandboxExecutable ?? "/usr/bin/sandbox-exec";
  }

  async run(request: ExecutionRequest, context: ToolContext): Promise<ExecutionResult> {
    const executionId = `execution-${randomUUID()}`;
    const startedAt = Date.now();
    const timeoutMs = normalizeLimit(
      request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      1_000,
      MAX_EXECUTION_TIMEOUT_MS,
      "execution timeout",
    );
    const maxOutputBytes = normalizeLimit(
      request.maxOutputBytes ?? DEFAULT_OUTPUT_LIMIT,
      1_024,
      MAX_EXECUTION_OUTPUT,
      "execution output limit",
    );
    const args = normalizeArguments(request.args ?? []);
    const argsSha256 = createHash("sha256")
      .update(JSON.stringify({ command: request.command, args }))
      .digest("hex");

    await this.#eventStore.append({
      type: "execution.started",
      runId: context.runId,
      taskId: context.taskId,
      agentId: context.agent.id,
      data: {
        executionId,
        isolation: this.isolation,
        command: safeCommandLabel(request.command),
        argsSha256,
        network: request.network ?? "deny",
        timeoutMs,
      },
    });

    try {
      const prepared = await this.#prepare(request, context, args);
      const result = await runPreparedProcess({
        ...prepared,
        executionId,
        timeoutMs,
        maxOutputBytes,
        signal: context.signal,
      });
      await this.#eventStore.append({
        type: result.exitCode === 0 ? "execution.completed" : "execution.failed",
        runId: context.runId,
        taskId: context.taskId,
        agentId: context.agent.id,
        data: {
          executionId,
          isolation: this.isolation,
          exitCode: result.exitCode,
          signal: result.signal,
          durationMs: result.durationMs,
          outputTruncated: result.outputTruncated,
        },
      });
      return result;
    } catch (error) {
      await this.#eventStore.append({
        type: "execution.failed",
        runId: context.runId,
        taskId: context.taskId,
        agentId: context.agent.id,
        data: {
          executionId,
          isolation: this.isolation,
          durationMs: Date.now() - startedAt,
          error: boundedError(error),
        },
      });
      throw error;
    }
  }

  async #prepare(
    request: ExecutionRequest,
    context: ToolContext,
    args: readonly string[],
  ): Promise<ConstrainedLaunch> {
    await access(this.#sandboxExecutable, constants.X_OK);
    const temporaryRoot = resolve(this.#temporaryRoot, safeSegment(context.runId), safeSegment(context.taskId));
    return prepareSeatbeltLaunch({
      ...request,
      args,
      temporaryRoot,
      sandboxExecutable: this.#sandboxExecutable,
    });
  }
}

export class ContainerExecutionHost implements ExecutionHost {
  readonly isolation = "container" as const;
  readonly #eventStore: EventStore;
  readonly #temporaryRoot: string;
  readonly #image: string;
  readonly #containerExecutable: string;

  constructor(options: {
    eventStore: EventStore;
    temporaryRoot: string;
    image: string;
    containerExecutable?: string;
  }) {
    if (process.platform !== "linux") {
      throw new Error("The built-in container ExecutionHost currently supports Linux hosts only");
    }
    validateContainerImage(options.image);
    this.#eventStore = options.eventStore;
    this.#temporaryRoot = resolve(options.temporaryRoot);
    this.#image = options.image;
    this.#containerExecutable = options.containerExecutable ?? "docker";
  }

  async run(request: ExecutionRequest, context: ToolContext): Promise<ExecutionResult> {
    const executionId = `execution-${randomUUID()}`;
    const containerName = `localbuddy-${randomUUID()}`;
    const timeoutMs = normalizeLimit(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, MAX_EXECUTION_TIMEOUT_MS, "execution timeout");
    const maxOutputBytes = normalizeLimit(request.maxOutputBytes ?? DEFAULT_OUTPUT_LIMIT, 1_024, MAX_EXECUTION_OUTPUT, "execution output limit");
    const args = normalizeArguments(request.args ?? []);
    const argsSha256 = createHash("sha256").update(JSON.stringify({ command: request.command, args })).digest("hex");
    await this.#eventStore.append({
      type: "execution.started", runId: context.runId, taskId: context.taskId, agentId: context.agent.id,
      data: { executionId, isolation: this.isolation, command: safeCommandLabel(request.command), argsSha256, network: request.network ?? "deny", timeoutMs },
    });
    const startedAt = Date.now();
    try {
      const temporaryRoot = resolve(this.#temporaryRoot, safeSegment(context.runId), safeSegment(context.taskId));
      const launch = await prepareContainerLaunch({
        ...request,
        args,
        temporaryRoot,
        image: this.#image,
        containerExecutable: this.#containerExecutable,
        containerName,
      });
      const result = await runPreparedProcess({ ...launch, executionId, timeoutMs, maxOutputBytes, signal: context.signal });
      await this.#eventStore.append({
        type: result.exitCode === 0 ? "execution.completed" : "execution.failed",
        runId: context.runId, taskId: context.taskId, agentId: context.agent.id,
        data: { executionId, isolation: this.isolation, exitCode: result.exitCode, signal: result.signal, durationMs: result.durationMs, outputTruncated: result.outputTruncated },
      });
      return result;
    } catch (error) {
      await this.#eventStore.append({
        type: "execution.failed", runId: context.runId, taskId: context.taskId, agentId: context.agent.id,
        data: { executionId, isolation: this.isolation, durationMs: Date.now() - startedAt, error: boundedError(error) },
      });
      throw error;
    } finally {
      await runCleanupProcess(this.#containerExecutable, ["rm", "--force", containerName]);
    }
  }
}

export function createPlatformExecutionHost(options: {
  eventStore: EventStore;
  temporaryRoot: string;
  environment?: NodeJS.ProcessEnv;
}): ExecutionHost {
  if (process.platform === "darwin") return new SeatbeltExecutionHost(options);
  if (process.platform === "linux") {
    const image = options.environment?.LOCALBUDDY_EXECUTION_IMAGE;
    if (image === undefined || image.length === 0) {
      throw new Error("LOCALBUDDY_EXECUTION_IMAGE is required for isolated process execution on Linux");
    }
    return new ContainerExecutionHost({
      ...options,
      image,
      containerExecutable: options.environment?.LOCALBUDDY_CONTAINER_EXECUTABLE,
    });
  }
  throw new Error("Local process execution is disabled on Windows until a supported isolation host is configured");
}

export async function prepareSeatbeltLaunch(
  request: SeatbeltLaunchRequest,
): Promise<ConstrainedLaunch> {
  if (process.platform !== "darwin") {
    throw new Error("Seatbelt launch wrapping is available only on macOS");
  }
  const sandboxExecutable = request.sandboxExecutable ?? "/usr/bin/sandbox-exec";
  await access(sandboxExecutable, constants.X_OK);
  const args = normalizeArguments(request.args ?? []);
  const command = await resolveExecutable(request.command, request.environment?.PATH);
  const cwd = await realpath(request.cwd);
  await mkdir(request.temporaryRoot, { recursive: true, mode: 0o700 });
  const canonicalTemporaryRoot = await realpath(request.temporaryRoot);
  const readRoots = await canonicalRoots([
    cwd,
    command,
    ...request.readRoots,
    ...systemReadRoots(),
  ]);
  const writableRoots = await canonicalRoots([
    canonicalTemporaryRoot,
    ...request.writableRoots,
  ]);
  const profile = seatbeltProfile({
    readRoots,
    writableRoots,
    network: request.network ?? "deny",
  });
  return {
    command: sandboxExecutable,
    args: ["-p", profile, command, ...args],
    cwd,
    environment: buildExecutionEnvironment(request.environment, canonicalTemporaryRoot),
    isolation: "seatbelt",
  };
}

export async function prepareContainerLaunch(request: ContainerLaunchRequest): Promise<ConstrainedLaunch> {
  if (process.platform !== "linux") throw new Error("container launch wrapping is available only on Linux hosts");
  validateContainerImage(request.image);
  const executable = request.containerExecutable ?? "docker";
  const cwd = await realpath(request.cwd);
  await mkdir(request.temporaryRoot, { recursive: true, mode: 0o700 });
  const temporaryRoot = await realpath(request.temporaryRoot);
  const readRoots = await canonicalRoots([cwd, ...request.readRoots]);
  const writableRoots = await canonicalRoots([temporaryRoot, ...request.writableRoots]);
  const environment = buildExecutionEnvironment(request.environment, temporaryRoot);
  delete environment.PATH;
  const writableSet = new Set(writableRoots);
  const readOnlyRoots = readRoots.filter((root) => !writableSet.has(root));
  const user = typeof process.getuid === "function" && typeof process.getgid === "function"
    ? [`--user=${process.getuid()}:${process.getgid()}`]
    : [];
  const args = [
    "run", "--rm", "--init", "--pull=never",
    ...(request.containerName === undefined ? [] : ["--name", request.containerName]),
    "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
    "--pids-limit=256", "--memory=2g", "--cpus=2",
    ...user,
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
    `--network=${request.network === "allow" ? "bridge" : "none"}`,
    "--workdir", cwd,
    ...readOnlyRoots.flatMap((root) => ["--mount", containerMount(root, true)]),
    ...writableRoots.flatMap((root) => ["--mount", containerMount(root, false)]),
    ...Object.entries(environment).flatMap(([name, value]) => value === undefined ? [] : ["--env", `${name}=${value}`]),
    request.image,
    request.command,
    ...normalizeArguments(request.args ?? []),
  ];
  return { command: executable, args, cwd, environment: { PATH: process.env.PATH }, isolation: "container" };
}

function containerMount(path: string, readOnly: boolean): string {
  if (path.includes(",") || path.includes("\0")) throw new Error("container mount path contains an unsupported character");
  return `type=bind,source=${path},target=${path}${readOnly ? ",readonly" : ""}`;
}

function validateContainerImage(image: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{2,300}$/.test(image) || image.endsWith(":")) {
    throw new Error("invalid pinned execution image reference");
  }
  if (!image.includes(":") && !image.includes("@sha256:")) {
    throw new Error("execution image must include an explicit tag or digest");
  }
}

function runCleanupProcess(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("error", () => { clearTimeout(timeout); resolvePromise(); });
    child.once("close", () => { clearTimeout(timeout); resolvePromise(); });
  });
}

function runPreparedProcess(input: ConstrainedLaunch & {
  executionId: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}): Promise<ExecutionResult> {
  if (input.signal?.aborted === true) {
    return Promise.reject(input.signal.reason ?? new Error("execution was cancelled before start"));
  }
  return new Promise<ExecutionResult>((resolvePromise, rejectPromise) => {
    const startedAt = Date.now();
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.environment,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let outputTruncated = false;
    let settled = false;
    let terminationReason: Error | undefined;

    const collect = (target: "stdout" | "stderr", chunk: Buffer | string) => {
      const current = target === "stdout" ? stdout : stderr;
      const next = Buffer.concat([current, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      const combinedBytes = next.length + (target === "stdout" ? stderr.length : stdout.length);
      if (combinedBytes > input.maxOutputBytes) {
        outputTruncated = true;
        const remaining = Math.max(0, input.maxOutputBytes - (target === "stdout" ? stderr.length : stdout.length));
        if (target === "stdout") stdout = next.subarray(0, remaining);
        else stderr = next.subarray(0, remaining);
        terminationReason = new Error(`execution output exceeded ${input.maxOutputBytes} bytes`);
        terminateProcessTree(child);
        return;
      }
      if (target === "stdout") stdout = next;
      else stderr = next;
    };
    child.stdout?.on("data", (chunk) => collect("stdout", chunk));
    child.stderr?.on("data", (chunk) => collect("stderr", chunk));

    const timeout = setTimeout(() => {
      terminationReason = new Error(`execution timed out after ${input.timeoutMs}ms`);
      terminateProcessTree(child);
    }, input.timeoutMs);
    const abortListener = () => {
      terminationReason = new Error("execution was cancelled");
      terminateProcessTree(child);
    };
    input.signal?.addEventListener("abort", abortListener, { once: true });

    const cleanup = () => {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortListener);
    };
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(error);
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (terminationReason !== undefined) {
        rejectPromise(terminationReason);
        return;
      }
      resolvePromise({
        executionId: input.executionId,
        isolation: input.isolation,
        exitCode: exitCode ?? 1,
        signal: signal ?? undefined,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        durationMs: Date.now() - startedAt,
        outputTruncated,
      });
    });
  });
}

function terminateProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    const forceTimer = setTimeout(() => {
      try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }, TERMINATE_GRACE_MS);
    forceTimer.unref();
    return;
  }
  child.kill("SIGTERM");
}

function seatbeltProfile(input: {
  readRoots: readonly string[];
  writableRoots: readonly string[];
  network: "deny" | "allow";
}): string {
  const explicitRoots = [...input.readRoots, ...input.writableRoots];
  const rules = [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow sysctl-read)",
    // dyld and several Apple command-line tools require reads whose concrete
    // system paths vary by OS build. Allow system reads, then carve out all
    // user/private mount roots before re-allowing the exact Run roots below.
    "(allow file-read*)",
    ...seatbeltPrivateRoots().map((root) => `(deny file-read* (subpath \"${escapeSeatbelt(root)}\"))`),
    ...pathAncestors(explicitRoots).map((root) =>
      `(allow file-read-metadata (literal \"${escapeSeatbelt(root)}\"))`),
    "(allow file-read* file-write* (literal \"/dev/null\"))",
    ...input.readRoots.map((root) => `(allow file-read* (subpath \"${escapeSeatbelt(root)}\"))`),
    ...input.writableRoots.map((root) => `(allow file-read* (subpath \"${escapeSeatbelt(root)}\"))`),
    ...input.writableRoots.map((root) => `(allow file-write* (subpath \"${escapeSeatbelt(root)}\"))`),
    ...(input.network === "allow" ? ["(allow network*)"] : []),
  ];
  return rules.join("\n");
}

function pathAncestors(values: readonly string[]): string[] {
  const ancestors = new Set<string>();
  for (const value of values) {
    const root = parsePath(value).root;
    let current = value;
    while (current !== root) {
      current = dirname(current);
      ancestors.add(current);
    }
  }
  return [...ancestors];
}

function seatbeltPrivateRoots(): string[] {
  return [
    homedir(),
    "/Volumes",
    "/Network",
    "/private/tmp",
    "/private/var/folders",
    "/private/var/root",
  ];
}

async function canonicalRoots(values: readonly string[]): Promise<string[]> {
  const roots = new Set<string>();
  for (const value of values) {
    if (value.length === 0) continue;
    try {
      roots.add(await realpath(value));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return [...roots];
}

function systemReadRoots(): string[] {
  return [
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/Library/Apple",
    "/Library/Developer/CommandLineTools",
    "/private/etc",
    "/private/var/db/timezone",
    "/opt/homebrew",
    "/dev/null",
    "/dev/urandom",
  ];
}

async function resolveExecutable(command: string, pathValue?: string): Promise<string> {
  if (command.length === 0 || command.includes("\0") || /[\r\n]/.test(command)) {
    throw new Error("execution command must be a bounded single-line value");
  }
  const candidates = isAbsolute(command)
    ? [command]
    : (pathValue ?? process.env.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)
        .map((entry) => resolve(entry, command));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return await realpath(candidate);
    } catch (error) {
      if (isNodeError(error) && (error.code === "ENOENT" || error.code === "EACCES")) continue;
      throw error;
    }
  }
  throw new Error(`execution command is unavailable: ${safeCommandLabel(command)}`);
}

function buildExecutionEnvironment(
  values: Readonly<Record<string, string | undefined>> | undefined,
  temporaryRoot: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: values?.PATH ?? process.env.PATH,
    LANG: values?.LANG ?? process.env.LANG ?? "en_US.UTF-8",
    LC_ALL: values?.LC_ALL ?? process.env.LC_ALL,
    HOME: temporaryRoot,
    TMPDIR: temporaryRoot,
    XDG_CACHE_HOME: resolve(temporaryRoot, "cache"),
    XDG_CONFIG_HOME: resolve(temporaryRoot, "config"),
    COREPACK_HOME: resolve(temporaryRoot, "corepack"),
    CI: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    NO_COLOR: "1",
  };
  for (const [key, value] of Object.entries(values ?? {})) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error(`invalid execution environment name: ${key}`);
    if (value !== undefined) environment[key] = value;
  }
  environment.HOME = temporaryRoot;
  environment.TMPDIR = temporaryRoot;
  environment.XDG_CACHE_HOME = resolve(temporaryRoot, "cache");
  environment.XDG_CONFIG_HOME = resolve(temporaryRoot, "config");
  environment.COREPACK_HOME = resolve(temporaryRoot, "corepack");
  environment.CI = "1";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = "/dev/null";
  environment.GIT_TERMINAL_PROMPT = "0";
  return environment;
}

function normalizeArguments(values: readonly string[]): string[] {
  if (values.length > 128) throw new Error("execution argument count exceeds 128");
  return values.map((value, index) => {
    if (typeof value !== "string" || value.length > 16_000 || value.includes("\0")) {
      throw new Error(`execution argument ${index} is invalid`);
    }
    return value;
  });
}

function normalizeLimit(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function safeSegment(value: string): string {
  const segment = value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (segment.length === 0) throw new Error("execution context identifier is unsafe");
  return segment.slice(0, 80);
}

function safeCommandLabel(command: string): string {
  return command.split(/[\\/]/).at(-1)?.slice(0, 200) || "unknown";
}

function escapeSeatbelt(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2_000);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
