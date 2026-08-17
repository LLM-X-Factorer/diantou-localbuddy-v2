import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { ArtifactRecord, ArtifactRegistry } from "./artifacts.js";
import {
  runCheckCommand,
  type CheckCommand,
  type CheckCommandResult,
} from "./coding-tools.js";
import type { EventStore } from "./event-store.js";
import { ExecutionCoordinator } from "./execution-coordinator.js";
import { createPlatformExecutionHost, type ExecutionHost } from "./execution-host.js";
import { GitWorktreeManager } from "./git-worktree-manager.js";
import {
  assertPrivateFileIfPresent,
  ensurePrivateDirectory,
  hardenPrivateFileIfPresent,
  writePrivateFileAtomic,
  writePrivateJsonAtomic,
} from "./private-storage.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT = 10 * 1024 * 1024;
const MAX_INLINE_DIFF_CHARACTERS = 400_000;

export type IntegrationStatus =
  | "preflight_failed"
  | "awaiting_approval"
  | "applying"
  | "applied"
  | "committed"
  | "reverted"
  | "revert_committed"
  | "failed"
  | "recovery_required";

export interface IntegrationPatchInput {
  taskId: string;
  absolutePath: string;
  sha256: string;
}

export interface IntegrationProposal {
  version: 1;
  runId: string;
  repoRoot: string;
  baselineHead: string;
  status: IntegrationStatus;
  createdAt: string;
  updatedAt: string;
  proposalPath: string;
  previewWorktree?: string;
  patches: readonly IntegrationPatchInput[];
  combinedPatch?: {
    absolutePath: string;
    relativePath: string;
    sha256: string;
    bytes: number;
  };
  changedPaths: readonly string[];
  checks: readonly CheckCommandResult[];
  approvalIntent?: {
    source: "desktop" | "cli" | "test";
    commit: boolean;
    commitMessage?: string;
  };
  approvedAt?: string;
  appliedAt?: string;
  committedAt?: string;
  commitSha?: string;
  revertCommitSha?: string;
  revertedAt?: string;
  rolledBack?: boolean;
  error?: string;
}

export interface PrepareIntegrationInput {
  runId: string;
  repoRoot: string;
  artifactRoot: string;
  patches: readonly IntegrationPatchInput[];
  verificationCommands: readonly CheckCommand[];
  artifactRegistry: ArtifactRegistry;
  previewTaskId?: string;
  signal?: AbortSignal;
  conflictResolver?: IntegrationConflictResolver;
}

export interface IntegrationConflictResolutionInput {
  runId: string;
  taskId: string;
  repoRoot: string;
  worktreePath: string;
  patch: IntegrationPatchInput;
  conflictPaths: readonly string[];
  signal?: AbortSignal;
}

export interface IntegrationConflictResolver {
  resolve(input: IntegrationConflictResolutionInput): Promise<void>;
}

export interface ApproveIntegrationInput {
  proposalPath: string;
  expectedRepoRoot: string;
  commitMessage?: string;
  approvalSource: "desktop" | "cli" | "test";
  signal?: AbortSignal;
}

export interface RevertIntegrationInput {
  proposalPath: string;
  expectedRepoRoot: string;
  approvalSource: "desktop" | "cli" | "test";
  signal?: AbortSignal;
}

export interface IntegrationManagerOptions {
  eventStore: EventStore;
  executionCoordinator?: ExecutionCoordinator;
  clock?: () => Date;
  executionHost?: ExecutionHost;
}

export class IntegrationManager {
  readonly #eventStore: EventStore;
  readonly #coordinator: ExecutionCoordinator;
  readonly #clock: () => Date;
  readonly #executionHost?: ExecutionHost;
  readonly #worktreeManager = new GitWorktreeManager();

  constructor(options: IntegrationManagerOptions) {
    this.#eventStore = options.eventStore;
    this.#coordinator = options.executionCoordinator ?? new ExecutionCoordinator(3);
    this.#clock = options.clock ?? (() => new Date());
    this.#executionHost = options.executionHost;
  }

  async prepare(input: PrepareIntegrationInput): Promise<IntegrationProposal> {
    if (input.patches.length === 0) {
      throw new Error("integration preflight requires at least one patch");
    }
    const artifactRoot = await realpath(input.artifactRoot);
    const previewTaskId = normalizePreviewTaskId(input.previewTaskId);
    const validated = await this.#worktreeManager.validatePrimary(input.repoRoot);
    const proposalPath = resolve(dirname(artifactRoot), "integration-proposal.json");
    const now = this.#now();
    let proposal: IntegrationProposal = {
      version: 1,
      runId: input.runId,
      repoRoot: validated.repoRoot,
      baselineHead: validated.headSha,
      status: "preflight_failed",
      createdAt: now,
      updatedAt: now,
      proposalPath,
      patches: input.patches.map((patch) => ({ ...patch })),
      changedPaths: [],
      checks: [],
    };
    await this.#eventStore.append({
      type: "integration.preflight_started",
      runId: input.runId,
      data: { patchCount: input.patches.length },
    });

    const release = await acquireCoordinator(
      this.#coordinator,
      `${input.runId}:integration-preflight`,
      {
        resourceId: validated.repoRoot,
        access: "write",
        isolationKey: `${input.runId}:integration-preview`,
      },
      input.signal,
    );
    try {
      const preview = await this.#worktreeManager.create(
        validated.repoRoot,
        input.runId,
        previewTaskId,
      );
      proposal = { ...proposal, previewWorktree: preview.worktreePath };
      await this.#eventStore.append({
        type: "workspace.created",
        runId: input.runId,
        taskId: previewTaskId,
        data: { worktreePath: preview.worktreePath, headSha: preview.headSha },
      });

      let conflictAttempt = 0;
      for (const patch of input.patches) {
        const patchPath = await validatePatchArtifact(artifactRoot, patch);
        try {
          await git(preview.worktreePath, [
            "apply",
            "--check",
            "--index",
            "--whitespace=error-all",
            patchPath,
          ]);
          await git(preview.worktreePath, [
            "apply",
            "--index",
            "--whitespace=error-all",
            patchPath,
          ]);
        } catch (error) {
          if (input.conflictResolver === undefined) throw error;
          conflictAttempt += 1;
          await this.#eventStore.append({
            type: "integration.conflict_resolution_started",
            runId: input.runId,
            taskId: previewTaskId,
            data: { patchTaskId: patch.taskId, attempt: conflictAttempt },
          });
          await git(preview.worktreePath, [
            "apply",
            "--3way",
            "--index",
            "--whitespace=error-all",
            patchPath,
          ]).catch(() => undefined);
          const conflictPaths = await unmergedPaths(preview.worktreePath);
          if (conflictPaths.length === 0) {
            throw new Error(`patch ${patch.taskId} failed without materializing resolvable conflicts`, {
              cause: error,
            });
          }
          await input.conflictResolver.resolve({
            runId: input.runId,
            taskId: `merge-conflict-${conflictAttempt}`,
            repoRoot: validated.repoRoot,
            worktreePath: preview.worktreePath,
            patch,
            conflictPaths,
            signal: input.signal,
          });
          await git(preview.worktreePath, ["diff", "--check", "--", ...conflictPaths]);
          await git(preview.worktreePath, ["add", "--", ...conflictPaths]);
          const remaining = await unmergedPaths(preview.worktreePath);
          if (remaining.length > 0) {
            throw new Error(`Merge Agent left unresolved paths: ${remaining.join(", ")}`);
          }
          await this.#eventStore.append({
            type: "integration.conflict_resolution_completed",
            runId: input.runId,
            taskId: previewTaskId,
            data: { patchTaskId: patch.taskId, conflictPaths, attempt: conflictAttempt },
          });
        }
      }

      await git(preview.worktreePath, ["restore", "--staged", "--", "."]);

      const checks: CheckCommandResult[] = [];
      const executionHost = this.#executionHost ?? defaultIntegrationExecutionHost(
        this.#eventStore,
        resolve(dirname(artifactRoot), "execution-tmp"),
      );
      for (const command of uniqueChecks(input.verificationCommands)) {
        checks.push(await runCheckCommand(
          preview.worktreePath,
          command,
          executionHost,
          {
            runId: input.runId,
            taskId: previewTaskId,
            agent: {
              id: "integration-controller",
              role: "integrator",
              instructions: "Controller-owned integration preflight.",
              capabilities: ["integrate"],
              maxParallelTasks: 1,
            },
            signal: input.signal,
          },
          [validated.repoRoot],
        ));
      }
      const diff = await this.#worktreeManager.captureDiff(preview);
      if (diff.clean || diff.patch.trim().length === 0) {
        throw new Error("integration preview produced an empty combined patch");
      }
      const changedPaths = await diffPaths(preview.worktreePath);
      if (changedPaths.length === 0) {
        throw new Error("integration preview has no changed paths");
      }
      const combinedPatch = await writeCombinedPatch({
        runId: input.runId,
        artifactRoot,
        patch: diff.patch,
        artifactRegistry: input.artifactRegistry,
        eventStore: this.#eventStore,
      });
      proposal = {
        ...proposal,
        status: "awaiting_approval",
        updatedAt: this.#now(),
        combinedPatch,
        changedPaths,
        checks,
      };
      await saveProposal(proposal);
      await this.#eventStore.append({
        type: "integration.awaiting_approval",
        runId: input.runId,
        data: integrationProposalEventData(proposal),
      });
      return proposal;
    } catch (error) {
      proposal = {
        ...proposal,
        status: "preflight_failed",
        updatedAt: this.#now(),
        error: toErrorMessage(error),
      };
      await saveProposal(proposal);
      await this.#eventStore.append({
        type: "integration.preflight_failed",
        runId: input.runId,
        data: { error: proposal.error },
      });
      return proposal;
    } finally {
      release();
    }
  }

  async approve(input: ApproveIntegrationInput): Promise<IntegrationProposal> {
    const expectedRoot = await realpath(input.expectedRepoRoot);
    let proposal = await loadProposal(input.proposalPath, expectedRoot);
    if (proposal.status !== "awaiting_approval" || proposal.combinedPatch === undefined) {
      throw new Error(`integration proposal is not awaiting approval: ${proposal.status}`);
    }
    const approvedCombinedPatch = proposal.combinedPatch;
    const commitMessage = normalizeCommitMessage(input.commitMessage);
    const release = await acquireCoordinator(
      this.#coordinator,
      `${proposal.runId}:integration-apply`,
      { resourceId: expectedRoot, access: "write" },
      input.signal,
    );
    let patchApplied = false;
    let staged = false;
    try {
      proposal = {
        ...proposal,
        status: "applying",
        approvedAt: this.#now(),
        updatedAt: this.#now(),
        approvalIntent: {
          source: input.approvalSource,
          commit: commitMessage !== undefined,
          commitMessage,
        },
        error: undefined,
      };
      await saveProposal(proposal);
      await this.#eventStore.append({
        type: "integration.approved",
        runId: proposal.runId,
        data: { approvalSource: input.approvalSource, commit: commitMessage !== undefined },
      });
      await this.#eventStore.append({ type: "integration.applying", runId: proposal.runId });

      const validated = await this.#worktreeManager.validatePrimary(expectedRoot);
      if (validated.headSha !== proposal.baselineHead) {
        throw new Error(
          `primary HEAD changed after preflight: expected ${proposal.baselineHead}, got ${validated.headSha}`,
        );
      }
      const patchPath = await validateCombinedPatch(proposal);
      const applyArgs = commitMessage === undefined
        ? ["apply", "--check", "--whitespace=error-all", patchPath]
        : ["apply", "--check", "--index", "--whitespace=error-all", patchPath];
      await git(expectedRoot, applyArgs);
      await git(expectedRoot, applyArgs.filter((argument) => argument !== "--check"));
      patchApplied = true;

      if (commitMessage !== undefined) {
        staged = true;
        await git(expectedRoot, ["diff", "--cached", "--check", "--", ...proposal.changedPaths]);
        await git(expectedRoot, [
          "commit",
          "--no-verify",
          "--no-gpg-sign",
          "-m",
          commitMessage,
          "--",
          ...proposal.changedPaths,
        ]);
        const commitSha = (await git(expectedRoot, ["rev-parse", "HEAD"])).trim();
        proposal = {
          ...proposal,
          status: "committed",
          appliedAt: this.#now(),
          committedAt: this.#now(),
          updatedAt: this.#now(),
          commitSha,
        };
        await saveProposal(proposal);
        await this.#eventStore.append({
          type: "integration.committed",
          runId: proposal.runId,
          data: { commitSha, changedPaths: proposal.changedPaths },
        });
        return proposal;
      }

      await git(expectedRoot, ["add", "--intent-to-add", "--all", "--", ...proposal.changedPaths]);
      const appliedPatch = await workingTreePatch(expectedRoot);
      if (sha256(appliedPatch) !== approvedCombinedPatch.sha256) {
        throw new Error("applied working-tree diff does not match the approved combined patch");
      }
      proposal = {
        ...proposal,
        status: "applied",
        appliedAt: this.#now(),
        updatedAt: this.#now(),
      };
      await saveProposal(proposal);
      await this.#eventStore.append({
        type: "integration.applied",
        runId: proposal.runId,
        data: { changedPaths: proposal.changedPaths, committed: false },
      });
      return proposal;
    } catch (error) {
      const originalError = toErrorMessage(error);
      let rolledBack = false;
      let rollbackError: string | undefined;
      if (patchApplied) {
        try {
          if (staged) {
            await git(expectedRoot, [
              "restore",
              "--source=HEAD",
              "--staged",
              "--worktree",
              "--",
              ...proposal.changedPaths,
            ]);
          } else if (proposal.combinedPatch !== undefined) {
            await git(expectedRoot, [
              "apply",
              "--reverse",
              "--check",
              proposal.combinedPatch.absolutePath,
            ]);
            await git(expectedRoot, [
              "apply",
              "--reverse",
              proposal.combinedPatch.absolutePath,
            ]);
            await git(expectedRoot, [
              "restore",
              "--staged",
              "--",
              ...proposal.changedPaths,
            ]).catch(() => undefined);
          }
          rolledBack = (await primaryStatus(expectedRoot)).length === 0;
        } catch (rollbackCause) {
          rollbackError = toErrorMessage(rollbackCause);
        }
      }
      proposal = {
        ...proposal,
        status: patchApplied && !rolledBack ? "recovery_required" : "failed",
        updatedAt: this.#now(),
        rolledBack,
        error: rollbackError === undefined
          ? originalError
          : `${originalError}; rollback failed: ${rollbackError}`,
      };
      await saveProposal(proposal);
      await this.#eventStore.append({
        type: proposal.status === "recovery_required"
          ? "integration.recovery_required"
          : "integration.failed",
        runId: proposal.runId,
        data: { error: proposal.error, rolledBack },
      });
      return proposal;
    } finally {
      release();
    }
  }

  async revert(input: RevertIntegrationInput): Promise<IntegrationProposal> {
    const expectedRoot = await realpath(input.expectedRepoRoot);
    let proposal = await loadProposal(input.proposalPath, expectedRoot);
    if (proposal.status === "committed") {
      return this.#revertCommitted(proposal, expectedRoot, input);
    }
    if (proposal.status !== "applied" || proposal.combinedPatch === undefined) {
      throw new Error(`only an applied or committed proposal can be reverted: ${proposal.status}`);
    }
    const release = await acquireCoordinator(
      this.#coordinator,
      `${proposal.runId}:integration-revert`,
      { resourceId: expectedRoot, access: "write" },
      input.signal,
    );
    try {
      const currentHead = (await git(expectedRoot, ["rev-parse", "HEAD"])).trim();
      if (currentHead !== proposal.baselineHead) {
        throw new Error("primary HEAD changed after integration apply; automatic revert is unsafe");
      }
      const currentPatch = await workingTreePatch(expectedRoot);
      if (sha256(currentPatch) !== proposal.combinedPatch.sha256) {
        throw new Error("primary working-tree diff changed after apply; automatic revert is unsafe");
      }
      await git(expectedRoot, [
        "apply",
        "--reverse",
        "--check",
        proposal.combinedPatch.absolutePath,
      ]);
      await git(expectedRoot, ["apply", "--reverse", proposal.combinedPatch.absolutePath]);
      await git(expectedRoot, [
        "restore",
        "--staged",
        "--",
        ...proposal.changedPaths,
      ]).catch(() => undefined);
      if ((await primaryStatus(expectedRoot)).length > 0) {
        throw new Error("primary worktree is not clean after reverse apply");
      }
      proposal = {
        ...proposal,
        status: "reverted",
        revertedAt: this.#now(),
        updatedAt: this.#now(),
      };
      await saveProposal(proposal);
      await this.#eventStore.append({
        type: "integration.reverted",
        runId: proposal.runId,
        data: { approvalSource: input.approvalSource },
      });
      return proposal;
    } finally {
      release();
    }
  }

  async #revertCommitted(
    initialProposal: IntegrationProposal,
    expectedRoot: string,
    input: RevertIntegrationInput,
  ): Promise<IntegrationProposal> {
    let proposal = initialProposal;
    if (proposal.commitSha === undefined || proposal.combinedPatch === undefined) {
      throw new Error("committed integration proposal is missing its commit contract");
    }
    const commitSha = proposal.commitSha;
    const release = await acquireCoordinator(
      this.#coordinator,
      `${proposal.runId}:integration-revert-commit`,
      { resourceId: expectedRoot, access: "write" },
      input.signal,
    );
    let revertStarted = false;
    let createdRevertSha: string | undefined;
    try {
      const validated = await this.#worktreeManager.validatePrimary(expectedRoot);
      await git(expectedRoot, ["merge-base", "--is-ancestor", commitSha, validated.headSha]);
      const parents = (await git(expectedRoot, ["rev-list", "--parents", "-n", "1", commitSha]))
        .trim()
        .split(/\s+/);
      if (parents.length !== 2 || parents[1] !== proposal.baselineHead) {
        throw new Error("recorded integration commit is not the single-child commit of the approved baseline");
      }
      const committedPatch = await git(expectedRoot, [
        "diff",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-textconv",
        proposal.baselineHead,
        commitSha,
        "--",
        ...proposal.changedPaths,
      ]);
      if (sha256(committedPatch) !== proposal.combinedPatch.sha256) {
        throw new Error("recorded integration commit no longer matches the approved combined patch");
      }
      revertStarted = true;
      await git(expectedRoot, [
        "-c",
        "core.hooksPath=/dev/null",
        "revert",
        "--no-commit",
        commitSha,
      ]);
      const stagedPaths = await cachedDiffPaths(expectedRoot);
      if (
        stagedPaths.length !== proposal.changedPaths.length
        || !stagedPaths.every((path, index) => path === [...proposal.changedPaths].toSorted()[index])
      ) {
        throw new Error("revert commit would change paths outside the approved integration");
      }
      await git(expectedRoot, ["diff", "--cached", "--check", "--", ...proposal.changedPaths]);
      await git(expectedRoot, [
        "commit",
        "--no-verify",
        "--no-gpg-sign",
        "-m",
        `Revert LocalBuddy integration ${commitSha.slice(0, 12)}`,
        "--",
        ...proposal.changedPaths,
      ]);
      const revertCommitSha = (await git(expectedRoot, ["rev-parse", "HEAD"])).trim();
      createdRevertSha = revertCommitSha;
      if ((await primaryStatus(expectedRoot)).length > 0) {
        throw new Error("primary worktree is not clean after creating the revert commit");
      }
      proposal = {
        ...proposal,
        status: "revert_committed",
        revertCommitSha,
        revertedAt: this.#now(),
        updatedAt: this.#now(),
        error: undefined,
      };
      await saveProposal(proposal);
      await this.#eventStore.append({
        type: "integration.revert_committed",
        runId: proposal.runId,
        data: {
          approvalSource: input.approvalSource,
          originalCommitSha: commitSha,
          revertCommitSha,
          changedPaths: proposal.changedPaths,
        },
      });
      return proposal;
    } catch (error) {
      if (revertStarted && createdRevertSha === undefined) {
        await git(expectedRoot, ["revert", "--abort"]).catch(async () => {
          await git(expectedRoot, [
            "restore",
            "--source=HEAD",
            "--staged",
            "--worktree",
            "--",
            ...proposal.changedPaths,
          ]);
        });
      }
      const message = toErrorMessage(error);
      if (createdRevertSha !== undefined) {
        proposal = {
          ...proposal,
          status: "recovery_required",
          revertCommitSha: createdRevertSha,
          revertedAt: this.#now(),
          updatedAt: this.#now(),
          error: `revert commit was created but durable bookkeeping failed: ${message}`,
        };
        await saveProposal(proposal).catch(() => undefined);
        await this.#eventStore.append({
          type: "integration.recovery_required",
          runId: proposal.runId,
          data: {
            error: proposal.error,
            originalCommitSha: commitSha,
            revertCommitSha: createdRevertSha,
          },
        }).catch(() => undefined);
        return proposal;
      }
      await this.#eventStore.append({
        type: "integration.revert_failed",
        runId: proposal.runId,
        data: { error: message, originalCommitSha: commitSha },
      });
      throw new Error(`committed integration revert failed: ${message}`, { cause: error });
    } finally {
      release();
    }
  }

  async reconcileApplying(input: {
    proposalPath: string;
    expectedRepoRoot: string;
  }): Promise<IntegrationProposal> {
    const expectedRoot = await realpath(input.expectedRepoRoot);
    let proposal = await loadProposal(input.proposalPath, expectedRoot);
    if (proposal.status !== "applying") {
      return proposal;
    }
    const intent = proposal.approvalIntent;
    if (intent === undefined || proposal.combinedPatch === undefined) {
      return this.#markRecoveryRequired(
        proposal,
        "integration apply was interrupted without a complete approval intent",
      );
    }
    await validateCombinedPatch(proposal);
    const currentHead = (await git(expectedRoot, ["rev-parse", "HEAD"])).trim();
    const status = await primaryStatus(expectedRoot);

    if (!intent.commit && currentHead === proposal.baselineHead) {
      if (status.length === 0) {
        proposal = {
          ...proposal,
          status: "failed",
          rolledBack: true,
          updatedAt: this.#now(),
          error: "integration approval was interrupted before the patch was applied",
        };
        await saveProposal(proposal);
        await this.#eventStore.append({
          type: "integration.failed",
          runId: proposal.runId,
          data: { error: proposal.error, rolledBack: true, reconciled: true },
        });
        return proposal;
      }
      if (!statusMatchesChangedPaths(status, proposal.changedPaths)) {
        return this.#markRecoveryRequired(
          proposal,
          "primary worktree contains paths outside the approved patch after interrupted apply",
        );
      }
      await git(expectedRoot, ["add", "--intent-to-add", "--all", "--", ...proposal.changedPaths]);
      const appliedPatch = await workingTreePatch(expectedRoot);
      if (sha256(appliedPatch) === proposal.combinedPatch.sha256) {
        proposal = {
          ...proposal,
          status: "applied",
          appliedAt: this.#now(),
          updatedAt: this.#now(),
          error: undefined,
        };
        await saveProposal(proposal);
        await this.#eventStore.append({
          type: "integration.applied",
          runId: proposal.runId,
          data: { changedPaths: proposal.changedPaths, committed: false, reconciled: true },
        });
        return proposal;
      }
      await git(expectedRoot, ["restore", "--staged", "--", ...proposal.changedPaths])
        .catch(() => undefined);
      return this.#markRecoveryRequired(
        proposal,
        "primary worktree does not exactly match the approved patch after interrupted apply",
      );
    }

    if (intent.commit && currentHead !== proposal.baselineHead && status.length === 0) {
      const parentHead = (await git(expectedRoot, ["rev-parse", `${currentHead}^`])).trim();
      const committedPatch = await git(expectedRoot, [
        "diff",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-textconv",
        proposal.baselineHead,
        currentHead,
        "--",
        ".",
      ]);
      if (parentHead === proposal.baselineHead && sha256(committedPatch) === proposal.combinedPatch.sha256) {
        proposal = {
          ...proposal,
          status: "committed",
          appliedAt: this.#now(),
          committedAt: this.#now(),
          updatedAt: this.#now(),
          commitSha: currentHead,
          error: undefined,
        };
        await saveProposal(proposal);
        await this.#eventStore.append({
          type: "integration.committed",
          runId: proposal.runId,
          data: { commitSha: currentHead, changedPaths: proposal.changedPaths, reconciled: true },
        });
        return proposal;
      }
    }

    if (intent.commit && currentHead === proposal.baselineHead && status.length === 0) {
      proposal = {
        ...proposal,
        status: "failed",
        rolledBack: true,
        updatedAt: this.#now(),
        error: "integration approval was interrupted before the patch or commit was applied",
      };
      await saveProposal(proposal);
      await this.#eventStore.append({
        type: "integration.failed",
        runId: proposal.runId,
        data: { error: proposal.error, rolledBack: true, reconciled: true },
      });
      return proposal;
    }

    return this.#markRecoveryRequired(
      proposal,
      "primary repository is in an ambiguous state after interrupted integration apply",
    );
  }

  async #markRecoveryRequired(
    proposal: IntegrationProposal,
    error: string,
  ): Promise<IntegrationProposal> {
    const next: IntegrationProposal = {
      ...proposal,
      status: "recovery_required",
      updatedAt: this.#now(),
      error,
    };
    await saveProposal(next);
    await this.#eventStore.append({
      type: "integration.recovery_required",
      runId: next.runId,
      data: { error, reconciled: true },
    });
    return next;
  }

  #now(): string {
    return this.#clock().toISOString();
  }
}

function normalizePreviewTaskId(value?: string): string {
  const taskId = value ?? "integration-preview";
  if (!/^integration-preview(?:-[1-9][0-9]*)?$/.test(taskId)) {
    throw new Error(`invalid integration preview Task id: ${taskId}`);
  }
  return taskId;
}

export async function loadIntegrationProposal(
  proposalPath: string,
  expectedRepoRoot: string,
): Promise<IntegrationProposal> {
  return loadProposal(proposalPath, await realpath(expectedRepoRoot));
}

export async function readVerifiedIntegrationPatch(input: {
  proposalPath: string;
  expectedRepoRoot: string;
  expectedRunId: string;
}): Promise<{ sha256: string; bytes: number; text: string; truncated: boolean }> {
  const proposal = await loadProposal(input.proposalPath, await realpath(input.expectedRepoRoot));
  if (proposal.runId !== input.expectedRunId) {
    throw new Error("integration proposal Run identity does not match the requested Run");
  }
  const path = await validateCombinedPatch(proposal);
  await assertPrivateFileIfPresent(path);
  const content = await readFile(path);
  const text = content.toString("utf8");
  return {
    sha256: proposal.combinedPatch!.sha256,
    bytes: content.byteLength,
    text: text.slice(0, MAX_INLINE_DIFF_CHARACTERS),
    truncated: text.length > MAX_INLINE_DIFF_CHARACTERS,
  };
}

export async function loadPreparedIntegrationProposal(input: {
  proposalPath: string;
  expectedRepoRoot: string;
  runId: string;
  baselineHead: string;
  patches: readonly IntegrationPatchInput[];
  verificationCommands: readonly CheckCommand[];
}): Promise<IntegrationProposal> {
  const expectedRoot = await realpath(input.expectedRepoRoot);
  const proposal = await loadProposal(input.proposalPath, expectedRoot);
  if (proposal.runId !== input.runId || proposal.baselineHead !== input.baselineHead) {
    throw new Error("prepared Integration Proposal identity changed after checkpoint");
  }
  if (proposal.status !== "awaiting_approval" && proposal.status !== "preflight_failed") {
    throw new Error(`prepared Integration Proposal has unsafe status: ${proposal.status}`);
  }
  if (JSON.stringify(proposal.patches) !== JSON.stringify(input.patches)) {
    throw new Error("prepared Integration Proposal patch inventory changed");
  }
  const validated = await new GitWorktreeManager().validatePrimary(expectedRoot);
  if (validated.headSha !== input.baselineHead) {
    throw new Error("primary HEAD changed after Integration preflight");
  }
  const artifactRoot = resolve(dirname(proposal.proposalPath), "artifacts");
  for (const patch of proposal.patches) {
    await validatePatchArtifact(artifactRoot, patch);
  }
  if (proposal.status === "awaiting_approval") {
    await validateCombinedPatch(proposal);
    const expectedChecks = uniqueChecks(input.verificationCommands);
    if (JSON.stringify(proposal.checks.map((check) => check.command)) !== JSON.stringify(expectedChecks)) {
      throw new Error("prepared Integration Proposal verification commands changed");
    }
  }
  return proposal;
}

async function acquireCoordinator(
  coordinator: ExecutionCoordinator,
  taskKey: string,
  workspace: { resourceId: string; access: "write"; isolationKey?: string },
  signal?: AbortSignal,
): Promise<() => void> {
  while (true) {
    if (signal?.aborted === true) {
      throw new Error("integration operation was cancelled");
    }
    const version = coordinator.version;
    if (coordinator.canAcquire(taskKey, workspace)) {
      return coordinator.acquire(taskKey, workspace);
    }
    await coordinator.waitForChange(version, signal);
  }
}

async function validatePatchArtifact(
  artifactRoot: string,
  patch: IntegrationPatchInput,
): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(patch.sha256)) {
    throw new Error(`invalid patch hash for ${patch.taskId}`);
  }
  const path = await realpath(patch.absolutePath);
  assertInside(artifactRoot, path);
  await assertPrivateFileIfPresent(path);
  const content = await readFile(path);
  if (sha256(content) !== patch.sha256) {
    throw new Error(`patch hash mismatch for ${patch.taskId}`);
  }
  return path;
}

async function validateCombinedPatch(proposal: IntegrationProposal): Promise<string> {
  if (proposal.combinedPatch === undefined) {
    throw new Error("integration proposal has no combined patch");
  }
  const runRoot = dirname(proposal.proposalPath);
  const artifactRoot = resolve(runRoot, "artifacts");
  const path = await realpath(proposal.combinedPatch.absolutePath);
  assertInside(artifactRoot, path);
  const metadata = await stat(path);
  if (metadata.size !== proposal.combinedPatch.bytes) {
    throw new Error("combined patch byte count mismatch");
  }
  if (metadata.size > MAX_GIT_OUTPUT) {
    throw new Error(`combined patch exceeds ${MAX_GIT_OUTPUT} byte limit`);
  }
  await assertPrivateFileIfPresent(path);
  const content = await readFile(path);
  if (sha256(content) !== proposal.combinedPatch.sha256) {
    throw new Error("combined patch hash mismatch");
  }
  return path;
}

async function writeCombinedPatch(input: {
  runId: string;
  artifactRoot: string;
  patch: string;
  artifactRegistry: ArtifactRegistry;
  eventStore: EventStore;
}): Promise<NonNullable<IntegrationProposal["combinedPatch"]>> {
  const relativePath = "integration/combined.patch";
  const absolutePath = resolve(input.artifactRoot, relativePath);
  await ensurePrivateDirectory(dirname(absolutePath));
  const patchSha256 = sha256(input.patch);
  try {
    await hardenPrivateFileIfPresent(absolutePath);
    if (sha256(await readFile(absolutePath)) !== patchSha256) {
      throw new Error("existing combined patch conflicts with recovered Integration preflight");
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
    await writePrivateFileAtomic(absolutePath, input.patch);
  }
  const record: ArtifactRecord = {
    runId: input.runId,
    taskId: "integration-preview",
    agentId: "controller",
    relativePath,
    absolutePath,
    mediaType: "text/x-diff",
    bytes: Buffer.byteLength(input.patch),
    sha256: patchSha256,
  };
  await input.artifactRegistry.add(record);
  await input.eventStore.append({
    type: "artifact.created",
    runId: input.runId,
    taskId: record.taskId,
    agentId: record.agentId,
    data: { fileName: relativePath, bytes: record.bytes, sha256: record.sha256 },
  });
  return {
    absolutePath,
    relativePath,
    sha256: record.sha256,
    bytes: record.bytes,
  };
}

async function saveProposal(proposal: IntegrationProposal): Promise<void> {
  await writePrivateJsonAtomic(proposal.proposalPath, proposal);
}

async function loadProposal(
  proposalPath: string,
  expectedRepoRoot: string,
): Promise<IntegrationProposal> {
  const canonicalProposalPath = await realpath(proposalPath);
  const runRoot = dirname(canonicalProposalPath);
  assertInside(resolve(expectedRepoRoot, ".localbuddy", "runs"), runRoot);
  await assertPrivateFileIfPresent(canonicalProposalPath);
  const raw = JSON.parse(await readFile(canonicalProposalPath, "utf8")) as unknown;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("integration proposal must be an object");
  }
  const proposal = raw as IntegrationProposal;
  if (
    proposal.version !== 1
    || typeof proposal.runId !== "string"
    || typeof proposal.repoRoot !== "string"
    || typeof proposal.baselineHead !== "string"
    || !/^[a-f0-9]{40,64}$/.test(proposal.baselineHead)
    || !isIntegrationStatus(proposal.status)
    || typeof proposal.createdAt !== "string"
    || typeof proposal.updatedAt !== "string"
    || Number.isNaN(Date.parse(proposal.createdAt))
    || Number.isNaN(Date.parse(proposal.updatedAt))
    || typeof proposal.proposalPath !== "string"
    || !Array.isArray(proposal.patches)
    || !proposal.patches.every(isIntegrationPatchInput)
    || !Array.isArray(proposal.changedPaths)
    || !proposal.changedPaths.every((path) => typeof path === "string")
    || !Array.isArray(proposal.checks)
    || !proposal.checks.every(isCheckResult)
    || !isCombinedPatch(proposal.combinedPatch)
    || !isApprovalIntent(proposal.approvalIntent)
    || !isOptionalCommitSha(proposal.commitSha)
    || !isOptionalCommitSha(proposal.revertCommitSha)
    || ((proposal.status === "committed" || proposal.status === "revert_committed")
      && proposal.commitSha === undefined)
    || (proposal.status === "revert_committed" && proposal.revertCommitSha === undefined)
  ) {
    throw new Error("integration proposal has an invalid contract");
  }
  const canonicalRepoRoot = await realpath(proposal.repoRoot);
  if (canonicalRepoRoot !== expectedRepoRoot) {
    throw new Error("integration proposal repository does not match the requested workspace");
  }
  for (const path of proposal.changedPaths) {
    assertSafeChangedPath(path);
  }
  return { ...proposal, repoRoot: canonicalRepoRoot, proposalPath: canonicalProposalPath };
}

function isOptionalCommitSha(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value));
}

function isIntegrationStatus(value: unknown): value is IntegrationStatus {
  return [
    "preflight_failed",
    "awaiting_approval",
    "applying",
    "applied",
    "committed",
    "reverted",
    "revert_committed",
    "failed",
    "recovery_required",
  ].includes(String(value));
}

function isIntegrationPatchInput(value: unknown): value is IntegrationPatchInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const patch = value as Partial<IntegrationPatchInput>;
  return typeof patch.taskId === "string"
    && typeof patch.absolutePath === "string"
    && typeof patch.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(patch.sha256);
}

function isCheckResult(value: unknown): value is CheckCommandResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const check = value as Partial<CheckCommandResult>;
  return isCheckCommand(check.command)
    && typeof check.stdout === "string"
    && typeof check.stderr === "string"
    && check.exitCode === 0;
}

function isCheckCommand(value: unknown): value is CheckCommand {
  return ["git_diff_check", "git_status", "pnpm_test", "pnpm_typecheck", "node_test"]
    .includes(String(value));
}

function isCombinedPatch(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const patch = value as NonNullable<IntegrationProposal["combinedPatch"]>;
  return typeof patch.absolutePath === "string"
    && typeof patch.relativePath === "string"
    && typeof patch.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(patch.sha256)
    && typeof patch.bytes === "number"
    && Number.isInteger(patch.bytes)
    && patch.bytes >= 0;
}

function isApprovalIntent(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const intent = value as NonNullable<IntegrationProposal["approvalIntent"]>;
  return (intent.source === "desktop" || intent.source === "cli" || intent.source === "test")
    && typeof intent.commit === "boolean"
    && (intent.commit
      ? typeof intent.commitMessage === "string" && intent.commitMessage.length > 0
      : intent.commitMessage === undefined);
}

export function integrationProposalEventData(proposal: IntegrationProposal): Record<string, unknown> {
  return {
    proposalPath: proposal.proposalPath,
    combinedPatchPath: proposal.combinedPatch?.absolutePath,
    combinedPatchSha256: proposal.combinedPatch?.sha256,
    previewWorktree: proposal.previewWorktree,
    changedPaths: proposal.changedPaths,
    checkCommands: proposal.checks.map((check) => check.command),
  };
}

function defaultIntegrationExecutionHost(
  eventStore: EventStore,
  temporaryRoot: string,
): ExecutionHost {
  return createPlatformExecutionHost({ eventStore, temporaryRoot, environment: process.env });
}

async function workingTreePatch(repoRoot: string): Promise<string> {
  return git(repoRoot, [
    "diff",
    "--binary",
    "--full-index",
    "--no-ext-diff",
    "--no-textconv",
    "--",
    ".",
  ]);
}

async function diffPaths(repoRoot: string): Promise<string[]> {
  const output = await git(repoRoot, ["diff", "--name-only", "-z", "--", "."]);
  return output.split("\0").filter(Boolean).map((path) => {
    assertSafeChangedPath(path);
    return path;
  });
}

async function cachedDiffPaths(repoRoot: string): Promise<string[]> {
  const output = await git(repoRoot, ["diff", "--cached", "--name-only", "-z", "--", "."]);
  return output.split("\0").filter(Boolean).map((path) => {
    assertSafeChangedPath(path);
    return path;
  }).toSorted();
}

async function unmergedPaths(repoRoot: string): Promise<string[]> {
  const output = await git(repoRoot, ["diff", "--name-only", "--diff-filter=U", "-z"]);
  return output.split("\0").filter(Boolean).map((path) => {
    assertSafeChangedPath(path);
    return path;
  }).toSorted();
}

async function primaryStatus(repoRoot: string): Promise<string> {
  return (await git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]))
    .split("\n")
    .filter((line) => line.length > 0 && !line.includes(".localbuddy/"))
    .join("\n");
}

function statusMatchesChangedPaths(
  status: string,
  changedPaths: readonly string[],
): boolean {
  const expected = new Set(changedPaths);
  const actual = new Set(status.split("\n").filter(Boolean).map((line) => {
    const path = line.slice(3);
    const renameTarget = path.includes(" -> ") ? path.slice(path.indexOf(" -> ") + 4) : path;
    return renameTarget;
  }));
  return actual.size === expected.size && [...actual].every((path) => expected.has(path));
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT,
      env: safeCommandEnvironment(),
    });
    return stdout;
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    throw new Error(`git ${args[0] ?? "command"} failed: ${failure.stderr?.trim() || failure.message}`, {
      cause: error,
    });
  }
}

function safeCommandEnvironment(): NodeJS.ProcessEnv {
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

function normalizeCommitMessage(value?: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const message = value.trim();
  if (message.length === 0 || message.length > 120 || /[\r\n\0]/.test(message)) {
    throw new Error("commit message must be a single line between 1 and 120 characters");
  }
  return message;
}

function uniqueChecks(commands: readonly CheckCommand[]): CheckCommand[] {
  const unique = [...new Set(commands)];
  if (!unique.includes("git_diff_check")) {
    unique.unshift("git_diff_check");
  }
  return unique;
}

function assertSafeChangedPath(path: string): void {
  if (
    path.length === 0
    || isAbsolute(path)
    || path === ".."
    || path.startsWith(`..${sep}`)
    || path.split(/[\\/]/).includes("..")
    || path === ".git"
    || path.startsWith(".git/")
    || path === ".localbuddy"
    || path.startsWith(".localbuddy/")
  ) {
    throw new Error(`unsafe integration path: ${path}`);
  }
}

function assertInside(root: string, target: string): void {
  const fromRoot = relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("integration path escapes its allowed root");
  }
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
