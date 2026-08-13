export const DESKTOP_CHANNELS = {
  bootstrap: "localbuddy:bootstrap",
  selectWorkspace: "localbuddy:select-workspace",
  inspectWorkspace: "localbuddy:inspect-workspace",
  createTutorialWorkspace: "localbuddy:create-tutorial-workspace",
  updateOnboarding: "localbuddy:update-onboarding",
  storeProviderCredential: "localbuddy:store-provider-credential",
  deleteProviderCredential: "localbuddy:delete-provider-credential",
  verifyProviderConnection: "localbuddy:verify-provider-connection",
  listRuns: "localbuddy:list-runs",
  startRun: "localbuddy:start-run",
  cancelRun: "localbuddy:cancel-run",
  resumeRun: "localbuddy:resume-run",
  restartRun: "localbuddy:restart-run",
  cleanupWorktrees: "localbuddy:cleanup-worktrees",
  approveIntegration: "localbuddy:approve-integration",
  revertIntegration: "localbuddy:revert-integration",
  loadIntegrationDiff: "localbuddy:load-integration-diff",
  loadArtifactPreview: "localbuddy:load-artifact-preview",
  exportDiagnostics: "localbuddy:export-diagnostics",
  resolveToolApproval: "localbuddy:resolve-tool-approval",
  openArtifact: "localbuddy:open-artifact",
  runUpdated: "localbuddy:run-updated",
} as const;

export type DesktopRunStatus =
  | "starting"
  | "planning"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelling"
  | "cancelled"
  | "interrupted";

export type DesktopRunMode = "research" | "code";
export type DesktopTrustProfile = "strict" | "balanced" | "automation";

export type DesktopIntegrationStatus =
  | "preflighting"
  | "preflight_failed"
  | "awaiting_approval"
  | "applying"
  | "applied"
  | "committed"
  | "reverted"
  | "revert_committed"
  | "failed"
  | "recovery_required";

export interface DesktopIntegrationView {
  status: DesktopIntegrationStatus;
  proposalPath?: string;
  combinedPatchPath?: string;
  combinedPatchSha256?: string;
  previewWorktree?: string;
  changedPaths: readonly string[];
  checkCommands: readonly string[];
  commitSha?: string;
  revertCommitSha?: string;
  rolledBack?: boolean;
  error?: string;
}

export interface DesktopTaskView {
  id: string;
  title: string;
  status: "queued" | "running" | "succeeded" | "failed" | "blocked" | "cancelled" | "interrupted";
  agentId?: string;
  error?: string;
}

export interface DesktopArtifactView {
  fileName: string;
  absolutePath: string;
  bytes?: number;
  sha256?: string;
}

export interface DesktopEventView {
  sequence: number;
  timestamp: string;
  type: string;
  taskId?: string;
  agentId?: string;
  detail?: string;
}

export interface DesktopWorktreeView {
  taskId: string;
  path: string;
  status: "retained" | "removed";
}

export interface DesktopCheckpointView {
  status: "available" | "blocked" | "resuming";
  completedTasks: number;
  resumableTasks: number;
  reason?: string;
}

export interface DesktopToolApprovalView {
  id: string;
  runId: string;
  taskId: string;
  agentId: string;
  toolName: string;
  toolDescription: string;
  argumentsPreview: string;
  argumentsSha256: string;
  requestedAt: string;
  expiresAt: string;
}

export interface DesktopRunView {
  runId: string;
  mode: DesktopRunMode;
  runtimeOwner?: "desktop" | "cli" | "core";
  workspace: string;
  status: DesktopRunStatus;
  startedAt?: string;
  completedAt?: string;
  tasks: readonly DesktopTaskView[];
  artifacts: readonly DesktopArtifactView[];
  recentEvents: readonly DesktopEventView[];
  eventCount: number;
  worktrees: readonly DesktopWorktreeView[];
  checkpoint?: DesktopCheckpointView;
  integration?: DesktopIntegrationView;
  recoveryOf?: string;
  restartedAs?: string;
  error?: string;
  providerId?: string;
  trustProfile?: DesktopTrustProfile;
  extensions?: {
    skillIds: readonly string[];
    mcpServerIds: readonly string[];
    browserOrigins: readonly string[];
    browserActionsAllowed: boolean;
    mcpWritesAllowed: boolean;
  };
  pendingApprovals: readonly DesktopToolApprovalView[];
  metrics: DesktopRunMetricsView;
}

export type DesktopFailureStage =
  | "extensions"
  | "planning"
  | "task"
  | "artifact_gate"
  | "integration"
  | "runtime";

export interface DesktopRunMetricsView {
  durationMs?: number;
  modelCalls: number;
  totalTokens: number;
  modelFailures: number;
  toolFailures: number;
  artifactGateRetries: number;
  failureStage?: DesktopFailureStage;
}

export interface DesktopBootstrap {
  workspace: string;
  runs: readonly DesktopRunView[];
  recentWorkspaces: readonly string[];
  providerAvailability: DesktopProviderAvailability;
  workspaceReadiness: DesktopWorkspaceReadiness;
  onboarding: DesktopOnboardingState;
}

export interface DesktopProviderAvailability {
  deepseek: DesktopProviderCredentialStatus;
  openai: DesktopProviderCredentialStatus;
}

export interface DesktopProviderCredentialStatus {
  available: boolean;
  source: "environment" | "system" | "none";
}

export interface DesktopWorkspaceReadiness {
  selected: boolean;
  isGitRepository: boolean;
  isTutorialWorkspace: boolean;
}

export interface DesktopOnboardingState {
  version: 1;
  guideSeen: boolean;
  contextHelpEnabled: boolean;
  tutorialWorkspace?: string;
}

export interface UpdateDesktopOnboardingRequest {
  guideSeen?: boolean;
  contextHelpEnabled?: boolean;
}

export interface DesktopTutorialWorkspaceResult {
  workspace: string;
  runs: readonly DesktopRunView[];
  recentWorkspaces: readonly string[];
  readiness: DesktopWorkspaceReadiness;
  onboarding: DesktopOnboardingState;
  created: boolean;
}

export interface StartDesktopRunRequest {
  workspace: string;
  goal: string;
  concurrency: number;
  mode?: DesktopRunMode;
  provider?: ProviderSelection;
  trustProfile?: DesktopTrustProfile;
  extensions?: RunExtensionSelection;
}

export interface StoreDesktopProviderCredentialRequest {
  providerId: "deepseek" | "openai";
  apiKey: string;
}

export interface StoreDesktopProviderCredentialResult {
  providerId: "deepseek" | "openai";
  stored: true;
  status: DesktopProviderCredentialStatus;
}

export interface DeleteDesktopProviderCredentialRequest {
  providerId: "deepseek" | "openai";
}

export interface DeleteDesktopProviderCredentialResult {
  providerId: "deepseek" | "openai";
  deleted: boolean;
  status: DesktopProviderCredentialStatus;
}

export interface VerifyDesktopProviderConnectionRequest {
  providerId: "deepseek" | "openai";
  baseUrl?: string;
}

export interface VerifyDesktopProviderConnectionResult {
  providerId: "deepseek" | "openai";
  verified: true;
}

export interface ApproveDesktopIntegrationRequest {
  workspace: string;
  runId: string;
  commitMessage?: string;
}

export interface RevertDesktopIntegrationRequest {
  workspace: string;
  runId: string;
}

export interface DesktopRunActionRequest {
  workspace: string;
  runId: string;
}

export interface DesktopIntegrationDiffView {
  sha256: string;
  bytes: number;
  text: string;
  truncated: boolean;
}

export interface DesktopArtifactActionRequest extends DesktopRunActionRequest {
  fileName: string;
}

export interface DesktopArtifactPreviewView {
  fileName: string;
  sha256: string;
  bytes: number;
  text: string;
  truncated: boolean;
}

export interface ResolveDesktopToolApprovalRequest extends DesktopRunActionRequest {
  approvalId: string;
  decision: "approve" | "deny";
}

export interface DesktopApi {
  bootstrap(): Promise<DesktopBootstrap>;
  selectWorkspace(): Promise<string | null>;
  inspectWorkspace(workspace: string): Promise<DesktopWorkspaceReadiness>;
  createTutorialWorkspace(): Promise<DesktopTutorialWorkspaceResult>;
  updateOnboarding(request: UpdateDesktopOnboardingRequest): Promise<DesktopOnboardingState>;
  storeProviderCredential(
    request: StoreDesktopProviderCredentialRequest,
  ): Promise<StoreDesktopProviderCredentialResult>;
  deleteProviderCredential(
    request: DeleteDesktopProviderCredentialRequest,
  ): Promise<DeleteDesktopProviderCredentialResult>;
  verifyProviderConnection(
    request: VerifyDesktopProviderConnectionRequest,
  ): Promise<VerifyDesktopProviderConnectionResult>;
  listRuns(workspace: string): Promise<readonly DesktopRunView[]>;
  startRun(request: StartDesktopRunRequest): Promise<DesktopRunView>;
  cancelRun(runId: string): Promise<void>;
  resumeRun(request: DesktopRunActionRequest): Promise<DesktopRunView>;
  restartRun(request: DesktopRunActionRequest): Promise<DesktopRunView>;
  cleanupWorktrees(request: DesktopRunActionRequest): Promise<DesktopRunView | null>;
  approveIntegration(request: ApproveDesktopIntegrationRequest): Promise<DesktopRunView | null>;
  revertIntegration(request: RevertDesktopIntegrationRequest): Promise<DesktopRunView | null>;
  loadIntegrationDiff(request: DesktopRunActionRequest): Promise<DesktopIntegrationDiffView>;
  loadArtifactPreview(request: DesktopArtifactActionRequest): Promise<DesktopArtifactPreviewView>;
  exportDiagnostics(request: DesktopRunActionRequest): Promise<string | null>;
  resolveToolApproval(request: ResolveDesktopToolApprovalRequest): Promise<DesktopRunView>;
  openArtifact(request: DesktopArtifactActionRequest): Promise<void>;
  onRunUpdate(listener: (run: DesktopRunView) => void): () => void;
}
import type { RunExtensionSelection } from "./extension-contract.js";
import type { ProviderSelection } from "./provider-config.js";
