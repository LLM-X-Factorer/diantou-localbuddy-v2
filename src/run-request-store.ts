import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import type { DesktopRunMode, StartDesktopRunRequest } from "./desktop-contract.js";
import {
  normalizeArtifactRevision,
  type ArtifactRevisionContract,
} from "./artifact-revision.js";
import { normalizeRunExtensions, type RunExtensionSelection } from "./extension-config.js";
import {
  compileGoalContract,
  normalizeGoalContract,
  type GoalContract,
} from "./goal-contract.js";
import { normalizeProviderSelection, type ProviderSelection } from "./provider-config.js";
import { canonicalResearchSourcePaths } from "./research-sources.js";
import { normalizeTrustProfile, type TrustProfile } from "./tool-runtime.js";
import { assertPrivateFileIfPresent, writePrivateJsonAtomic } from "./private-storage.js";

export interface PersistedRunRequest {
  version: 6;
  runId: string;
  workspace: string;
  goalContract: GoalContract;
  /** Compiled execution text. For v1-v4 loads this preserves the legacy checkpoint identity. */
  executionGoal: string;
  planReview: "required" | "skipped";
  concurrency: number;
  mode: DesktopRunMode;
  sourcePaths: readonly string[];
  sourceContract: "explicit" | "legacy-workspace";
  createdAt: string;
  runtimeOwner: "desktop" | "cli";
  recoveryOf?: string;
  provider: ProviderSelection;
  trustProfile: TrustProfile;
  extensions: RunExtensionSelection;
  artifactRevision?: ArtifactRevisionContract;
}

export type SaveRunRequestInput = Omit<StartDesktopRunRequest, "artifactContinuation"> & {
  runId: string;
  workspace: string;
  recoveryOf?: string;
  runtimeOwner?: "desktop" | "cli";
  planReview?: "required" | "skipped";
  artifactRevision?: ArtifactRevisionContract;
};

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
    const mode = input.mode ?? "research";
    const sourcePaths = mode === "research"
      ? await canonicalResearchSourcePaths(input.sourcePaths ?? [])
      : [];
    const goalContract = normalizeGoalContract({
      outcome: input.goal,
      constraints: input.goalConstraints,
      verificationCriteria: input.verificationCriteria,
    });
    const artifactRevision = input.artifactRevision === undefined
      ? undefined
      : normalizeArtifactRevision(input.artifactRevision);
    const stored = {
      version: 6 as const,
      runId: input.runId,
      workspace,
      goalContract,
      planReview: input.planReview ?? "skipped",
      concurrency: input.concurrency,
      mode,
      sourcePaths,
      sourceContract: "explicit" as const,
      createdAt: this.#clock().toISOString(),
      runtimeOwner: input.runtimeOwner ?? "desktop",
      recoveryOf: input.recoveryOf,
      provider: normalizeProviderSelection(input.provider),
      trustProfile: normalizeTrustProfile(input.trustProfile),
      extensions: normalizeRunExtensions(input.extensions),
      artifactRevision,
    };
    const requestPath = resolve(runRoot, "run-request.json");
    await writePrivateJsonAtomic(requestPath, stored);
    return { ...stored, executionGoal: compileGoalContract(goalContract) };
  }

  async load(
    runRoot: string,
    expectedWorkspace: string,
    expectedRunId: string,
  ): Promise<PersistedRunRequest> {
    validateRunId(expectedRunId);
    const requestPath = resolve(runRoot, "run-request.json");
    await assertPrivateFileIfPresent(requestPath);
    const raw = JSON.parse(await readFile(requestPath, "utf8")) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("persisted Run Request must be an object");
    }
    const request = raw as Record<string, unknown>;
    if (
      (request.version !== 1
        && request.version !== 2
        && request.version !== 3
        && request.version !== 4
        && request.version !== 5
        && request.version !== 6)
      || request.runId !== expectedRunId
      || typeof request.workspace !== "string"
      || typeof request.concurrency !== "number"
      || (request.mode !== "research" && request.mode !== "code")
      || typeof request.createdAt !== "string"
      || Number.isNaN(Date.parse(request.createdAt))
      || (request.runtimeOwner !== "desktop" && request.runtimeOwner !== "cli")
      || (request.recoveryOf !== undefined && typeof request.recoveryOf !== "string")
      || ((request.version === 2
        || request.version === 3
        || request.version === 4
        || request.version === 5
        || request.version === 6)
        && (request.provider === undefined || request.extensions === undefined))
      || ((request.version === 3
        || request.version === 4
        || request.version === 5
        || request.version === 6)
        && request.trustProfile === undefined)
      || (request.version < 5 && typeof request.goal !== "string")
      || (request.version === 4
        && (request.trustProfile === undefined
          || !Array.isArray(request.sourcePaths)
          || !request.sourcePaths.every((item) => typeof item === "string")
          || request.sourceContract !== "explicit"))
      || ((request.version === 5 || request.version === 6)
        && (request.goalContract === undefined
          || (request.planReview !== "required" && request.planReview !== "skipped")
          || !Array.isArray(request.sourcePaths)
          || !request.sourcePaths.every((item) => typeof item === "string")
          || request.sourceContract !== "explicit"))
    ) {
      throw new Error("persisted Run Request has an invalid contract");
    }
    const provider = normalizeProviderSelection(
      request.version === 1 ? undefined : request.provider as ProviderSelection | undefined,
    );
    const extensions = normalizeRunExtensions(
      request.version === 1 ? undefined : request.extensions as RunExtensionSelection | undefined,
    );
    const trustProfile = normalizeTrustProfile(request.version >= 3 ? request.trustProfile : undefined);
    const sourcePaths = request.version >= 4 && request.mode === "research"
      ? await canonicalResearchSourcePaths(request.sourcePaths as string[])
      : [];
    const sourceContract = request.version >= 4 || request.mode === "code"
      ? "explicit" as const
      : "legacy-workspace" as const;
    const goalContract = request.version >= 5
      ? normalizeGoalContract(request.goalContract as GoalContract)
      : normalizeGoalContract({ outcome: request.goal as string });
    const executionGoal = request.version >= 5
      ? compileGoalContract(goalContract)
      : request.goal as string;
    const artifactRevision = request.version === 6 && request.artifactRevision !== undefined
      ? normalizeArtifactRevision(request.artifactRevision as ArtifactRevisionContract)
      : undefined;
    validateRequest({
      workspace: request.workspace,
      goal: goalContract.outcome,
      goalConstraints: goalContract.constraints,
      verificationCriteria: goalContract.verificationCriteria,
      concurrency: request.concurrency,
      mode: request.mode,
      provider,
      extensions,
      trustProfile,
      sourcePaths,
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
      version: 6,
      runId: request.runId,
      workspace,
      goalContract,
      executionGoal,
      planReview: request.version >= 5 && request.planReview === "required" ? "required" : "skipped",
      concurrency: request.concurrency,
      mode: request.mode,
      sourcePaths,
      sourceContract,
      createdAt: request.createdAt,
      runtimeOwner: request.runtimeOwner,
      recoveryOf: request.recoveryOf,
      provider,
      trustProfile,
      extensions,
      artifactRevision,
    } as PersistedRunRequest;
  }

  async loadArtifactRevision(
    runRoot: string,
    expectedRunId: string,
  ): Promise<ArtifactRevisionContract | undefined> {
    validateRunId(expectedRunId);
    const requestPath = resolve(runRoot, "run-request.json");
    await assertPrivateFileIfPresent(requestPath);
    const raw = JSON.parse(await readFile(requestPath, "utf8")) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("persisted Run Request must be an object");
    }
    const request = raw as Record<string, unknown>;
    if (request.runId !== expectedRunId || typeof request.version !== "number") {
      throw new Error("persisted Run Request has an invalid Artifact revision identity");
    }
    if (request.version < 6) return undefined;
    if (request.version !== 6) {
      throw new Error("persisted Run Request has an unsupported Artifact revision version");
    }
    if (request.artifactRevision === undefined) return undefined;
    return normalizeArtifactRevision(request.artifactRevision as ArtifactRevisionContract);
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
  normalizeGoalContract({
    outcome: request.goal,
    constraints: request.goalConstraints,
    verificationCriteria: request.verificationCriteria,
  });
  if (!Number.isInteger(request.concurrency) || request.concurrency < 1 || request.concurrency > 8) {
    throw new Error("Persisted concurrency must be an integer between 1 and 8");
  }
  if (request.mode !== undefined && request.mode !== "research" && request.mode !== "code") {
    throw new Error("Mode must be research or code");
  }
  normalizeProviderSelection(request.provider);
  normalizeTrustProfile(request.trustProfile);
  normalizeRunExtensions(request.extensions);
  if (request.sourcePaths !== undefined) {
    if (request.sourcePaths.length > 50
      || !request.sourcePaths.every((item) => typeof item === "string" && item.trim().length > 0)) {
      throw new Error("Research sources must contain at most 50 non-empty paths");
    }
  }
}
