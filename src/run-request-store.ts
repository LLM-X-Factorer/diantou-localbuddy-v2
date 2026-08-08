import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { DesktopRunMode, StartDesktopRunRequest } from "./desktop-contract.js";
import { normalizeRunExtensions, type RunExtensionSelection } from "./extension-config.js";
import { normalizeProviderSelection, type ProviderSelection } from "./provider-config.js";

export interface PersistedRunRequest {
  version: 2;
  runId: string;
  workspace: string;
  goal: string;
  concurrency: number;
  mode: DesktopRunMode;
  createdAt: string;
  runtimeOwner: "desktop" | "cli";
  recoveryOf?: string;
  provider: ProviderSelection;
  extensions: RunExtensionSelection;
}

export interface SaveRunRequestInput extends StartDesktopRunRequest {
  runId: string;
  workspace: string;
  recoveryOf?: string;
  runtimeOwner?: "desktop" | "cli";
}

export class RunRequestStore {
  readonly #clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.#clock = clock;
  }

  async save(runRoot: string, input: SaveRunRequestInput): Promise<PersistedRunRequest> {
    validateRunId(input.runId);
    validateRequest(input);
    if (input.recoveryOf !== undefined) {
      validateRunId(input.recoveryOf);
    }
    const workspace = await realpath(input.workspace);
    const request: PersistedRunRequest = {
      version: 2,
      runId: input.runId,
      workspace,
      goal: input.goal,
      concurrency: input.concurrency,
      mode: input.mode ?? "research",
      createdAt: this.#clock().toISOString(),
      runtimeOwner: input.runtimeOwner ?? "desktop",
      recoveryOf: input.recoveryOf,
      provider: normalizeProviderSelection(input.provider),
      extensions: normalizeRunExtensions(input.extensions),
    };
    const requestPath = resolve(runRoot, "run-request.json");
    const temporaryPath = `${requestPath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(dirname(requestPath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(request, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, requestPath);
    return request;
  }

  async load(
    runRoot: string,
    expectedWorkspace: string,
    expectedRunId: string,
  ): Promise<PersistedRunRequest> {
    validateRunId(expectedRunId);
    const requestPath = resolve(runRoot, "run-request.json");
    const raw = JSON.parse(await readFile(requestPath, "utf8")) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("persisted Run Request must be an object");
    }
    const request = raw as Record<string, unknown>;
    if (
      (request.version !== 1 && request.version !== 2)
      || request.runId !== expectedRunId
      || typeof request.workspace !== "string"
      || typeof request.goal !== "string"
      || typeof request.concurrency !== "number"
      || (request.mode !== "research" && request.mode !== "code")
      || typeof request.createdAt !== "string"
      || Number.isNaN(Date.parse(request.createdAt))
      || (request.runtimeOwner !== "desktop" && request.runtimeOwner !== "cli")
      || (request.recoveryOf !== undefined && typeof request.recoveryOf !== "string")
      || (request.version === 2 && (request.provider === undefined || request.extensions === undefined))
    ) {
      throw new Error("persisted Run Request has an invalid contract");
    }
    const provider = normalizeProviderSelection(
      request.version === 1 ? undefined : request.provider as ProviderSelection | undefined,
    );
    const extensions = normalizeRunExtensions(
      request.version === 1 ? undefined : request.extensions as RunExtensionSelection | undefined,
    );
    validateRequest({
      workspace: request.workspace,
      goal: request.goal,
      concurrency: request.concurrency,
      mode: request.mode,
      provider,
      extensions,
    });
    if (request.recoveryOf !== undefined) {
      validateRunId(request.recoveryOf);
    }
    const [workspace, canonicalExpectedWorkspace] = await Promise.all([
      realpath(request.workspace),
      realpath(expectedWorkspace),
    ]);
    if (workspace !== canonicalExpectedWorkspace) {
      throw new Error("persisted Run Request workspace does not match the selected workspace");
    }
    return {
      version: 2,
      runId: request.runId,
      workspace,
      goal: request.goal,
      concurrency: request.concurrency,
      mode: request.mode,
      createdAt: request.createdAt,
      runtimeOwner: request.runtimeOwner,
      recoveryOf: request.recoveryOf,
      provider,
      extensions,
    } as PersistedRunRequest;
  }
}

export function validateRunId(runId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
    throw new Error("Run id contains unsafe characters");
  }
}

function validateRequest(request: StartDesktopRunRequest): void {
  if (request.workspace.trim().length === 0) {
    throw new Error("Workspace is required");
  }
  if (request.goal.trim().length === 0 || request.goal.length > 20_000) {
    throw new Error("Goal must contain between 1 and 20,000 characters");
  }
  if (!Number.isInteger(request.concurrency) || request.concurrency < 1 || request.concurrency > 8) {
    throw new Error("Persisted concurrency must be an integer between 1 and 8");
  }
  if (request.mode !== undefined && request.mode !== "research" && request.mode !== "code") {
    throw new Error("Mode must be research or code");
  }
  normalizeProviderSelection(request.provider);
  normalizeRunExtensions(request.extensions);
}
