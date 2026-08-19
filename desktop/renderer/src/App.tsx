import { useEffect, useMemo, useRef, useState } from "react";

import localBuddyIcon from "../../../assets/brand/localbuddy-icon.png";

import type {
  DesktopOnboardingState,
  DesktopProviderAvailability,
  DesktopProviderCredentialStatus,
  DesktopRunMode,
  DesktopRunStatus,
  DesktopTrustProfile,
  DesktopRunView,
  DesktopIntegrationDiffView,
  DesktopArtifactPreviewView,
  DesktopArtifactRevisionDiffView,
  DesktopArtifactThreadView,
  DesktopWorkspaceReadiness,
  DesktopUpdateView,
  DesktopPublicBugReportPreview,
  WorkspaceExtensionCatalog,
} from "../../../src/desktop-contract";
import {
  GUIDE_TEMPLATES,
  type GuideTemplateId,
} from "../../../src/onboarding-content";

const ACTIVE_STATUSES = new Set<DesktopRunStatus>([
  "starting",
  "planning",
  "awaiting_plan_approval",
  "running",
  "cancelling",
]);

const EMPTY_PROVIDER_AVAILABILITY: DesktopProviderAvailability = {
  deepseek: { available: false, source: "none" },
  openai: { available: false, source: "none" },
};
const EMPTY_WORKSPACE_READINESS: DesktopWorkspaceReadiness = {
  selected: false,
  isGitRepository: false,
  isTutorialWorkspace: false,
  storage: {
    runStoreRoot: "",
    artifactLocation: "",
    credentialLocation: "system_vault",
    risk: "local_workspace",
    warnings: [],
  },
};
const DEFAULT_ONBOARDING: DesktopOnboardingState = {
  version: 1,
  guideSeen: false,
  contextHelpEnabled: true,
};
const DEFAULT_UPDATE: DesktopUpdateView = {
  supported: false,
  configured: false,
  status: "disabled",
  build: { version: "unknown", channel: "dev", sha: "unknown", dirty: true, packaged: false },
};
const EMPTY_EXTENSION_CATALOG: WorkspaceExtensionCatalog = {
  skillsConfigured: false,
  mcpConfigured: false,
  skills: [],
  mcpServers: [],
  issues: [],
};

interface ArtifactContinuationDraft {
  parentRunId: string;
  parentFileName: string;
  parentSha256: string;
  parentRevision: number;
  threadId?: string;
}

export function App() {
  const [workspace, setWorkspace] = useState("");
  const [recentWorkspaces, setRecentWorkspaces] = useState<readonly string[]>([]);
  const [runs, setRuns] = useState<readonly DesktopRunView[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [creatingTask, setCreatingTask] = useState(false);
  const [goal, setGoal] = useState("");
  const [goalConstraints, setGoalConstraints] = useState("");
  const [verificationCriteria, setVerificationCriteria] = useState("");
  const [goalContractExpanded, setGoalContractExpanded] = useState(false);
  const [storageDetailsExpanded, setStorageDetailsExpanded] = useState(false);
  const [sourcePaths, setSourcePaths] = useState<readonly string[]>([]);
  const [concurrency, setConcurrency] = useState(3);
  const [mode, setMode] = useState<DesktopRunMode>("research");
  const [providerId, setProviderId] = useState<"deepseek" | "openai">("deepseek");
  const providerSelectionChangedRef = useRef(false);
  const [providerModel, setProviderModel] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [credentialStatus, setCredentialStatus] = useState<string>();
  const [savingCredential, setSavingCredential] = useState(false);
  const [deletingCredential, setDeletingCredential] = useState(false);
  const [verifyingProvider, setVerifyingProvider] = useState(false);
  const [providerSettingsOpen, setProviderSettingsOpen] = useState(false);
  const [trustProfile, setTrustProfile] = useState<DesktopTrustProfile>("balanced");
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [skillIds, setSkillIds] = useState("");
  const [mcpServerIds, setMcpServerIds] = useState("");
  const [browserOrigins, setBrowserOrigins] = useState("");
  const [allowBrowserActions, setAllowBrowserActions] = useState(false);
  const [extensionCatalog, setExtensionCatalog] = useState<WorkspaceExtensionCatalog>(EMPTY_EXTENSION_CATALOG);
  const [loadingExtensionCatalog, setLoadingExtensionCatalog] = useState(false);
  const [extensionCatalogError, setExtensionCatalogError] = useState<string>();
  const [extensionCatalogVersion, setExtensionCatalogVersion] = useState(0);
  const [commitAfterApply, setCommitAfterApply] = useState(false);
  const [commitMessage, setCommitMessage] = useState("Apply approved LocalBuddy integration");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string>();
  const [resolvingPlanReview, setResolvingPlanReview] = useState(false);
  const [integrationDiff, setIntegrationDiff] = useState<DesktopIntegrationDiffView>();
  const [loadingIntegrationDiff, setLoadingIntegrationDiff] = useState(false);
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<string>();
  const [artifactOpenStatus, setArtifactOpenStatus] = useState<string>();
  const [openingArtifactName, setOpeningArtifactName] = useState<string>();
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [bugReportPreview, setBugReportPreview] = useState<DesktopPublicBugReportPreview>();
  const [bugReportError, setBugReportError] = useState<string>();
  const [bugReportStatus, setBugReportStatus] = useState<string>();
  const [preparingBugReport, setPreparingBugReport] = useState(false);
  const [savingBugReport, setSavingBugReport] = useState(false);
  const [openingBugReport, setOpeningBugReport] = useState(false);
  const [artifactPreview, setArtifactPreview] = useState<DesktopArtifactPreviewView>();
  const artifactPreviewRef = useRef<HTMLDivElement>(null);
  const [artifactThread, setArtifactThread] = useState<DesktopArtifactThreadView>();
  const [artifactRevisionDiff, setArtifactRevisionDiff] = useState<DesktopArtifactRevisionDiffView>();
  const [artifactContinuation, setArtifactContinuation] = useState<ArtifactContinuationDraft>();
  const [loadingArtifactName, setLoadingArtifactName] = useState<string>();
  const [loadingArtifactDiff, setLoadingArtifactDiff] = useState(false);
  const [guideVisible, setGuideVisible] = useState(true);
  const [firstRunSourceKind, setFirstRunSourceKind] = useState<"sample" | "own">("sample");
  const [onboarding, setOnboarding] = useState<DesktopOnboardingState>(DEFAULT_ONBOARDING);
  const [providerAvailability, setProviderAvailability] = useState<DesktopProviderAvailability>(EMPTY_PROVIDER_AVAILABILITY);
  const [workspaceReadiness, setWorkspaceReadiness] = useState<DesktopWorkspaceReadiness>(EMPTY_WORKSPACE_READINESS);
  const [creatingTutorial, setCreatingTutorial] = useState(false);
  const [guideStatus, setGuideStatus] = useState<string>();
  const [update, setUpdate] = useState<DesktopUpdateView>(DEFAULT_UPDATE);
  const [updating, setUpdating] = useState(false);
  const [updateNow, setUpdateNow] = useState(() => Date.now());
  const [runNow, setRunNow] = useState(() => Date.now());

  useEffect(() => {
    const unsubscribeRun = window.localbuddy.onRunUpdate((updated) => {
      setRuns((current) => upsertRun(current, updated));
      setSelectedRunId((current) => current ?? updated.runId);
    });
    const unsubscribeUpdate = window.localbuddy.onUpdateUpdate(setUpdate);
    window.localbuddy.bootstrap()
      .then((bootstrap) => {
        setWorkspace(bootstrap.workspace);
        setRecentWorkspaces(bootstrap.recentWorkspaces);
        setRuns(bootstrap.runs);
        setSelectedRunId(bootstrap.runs[0]?.runId);
        setProviderAvailability(bootstrap.providerAvailability);
        if (!providerSelectionChangedRef.current) {
          setProviderId(preferredProviderId(bootstrap.providerAvailability));
        }
        setWorkspaceReadiness(bootstrap.workspaceReadiness);
        setOnboarding(bootstrap.onboarding);
        setGuideVisible(!bootstrap.onboarding.guideSeen);
        setUpdate(bootstrap.update);
      })
      .catch((cause: unknown) => setError(toMessage(cause)))
      .finally(() => setLoading(false));
    return () => {
      unsubscribeRun();
      unsubscribeUpdate();
    };
  }, []);

  useEffect(() => {
    if (update.status !== "available") return;
    setUpdateNow(Date.now());
    const timer = window.setInterval(() => setUpdateNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [update.status, update.downloadStartedAt]);

  useEffect(() => {
    let current = true;
    if (workspace.length === 0) {
      setExtensionCatalog(EMPTY_EXTENSION_CATALOG);
      setExtensionCatalogError(undefined);
      return () => { current = false; };
    }
    setLoadingExtensionCatalog(true);
    setExtensionCatalogError(undefined);
    window.localbuddy.inspectWorkspaceExtensions(workspace)
      .then((catalog) => {
        if (current) {
          setExtensionCatalog(catalog);
          const availableSkills = new Set(catalog.skills.map((skill) => skill.id));
          const availableMcpServers = new Set(catalog.mcpServers
            .filter((server) => server.supportedOnCurrentPlatform)
            .map((server) => server.id));
          setSkillIds((selected) => csvValues(selected).filter((id) => availableSkills.has(id)).join(","));
          setMcpServerIds((selected) => csvValues(selected).filter((id) => availableMcpServers.has(id)).join(","));
        }
      })
      .catch((cause: unknown) => {
        if (current) {
          setExtensionCatalog(EMPTY_EXTENSION_CATALOG);
          setExtensionCatalogError(toMessage(cause));
        }
      })
      .finally(() => {
        if (current) setLoadingExtensionCatalog(false);
      });
    return () => { current = false; };
  }, [workspace, extensionCatalogVersion]);

  useEffect(() => {
    setIntegrationDiff(undefined);
    setDiagnosticsStatus(undefined);
    setBugReportOpen(false);
    setBugReportPreview(undefined);
    setBugReportError(undefined);
    setArtifactPreview(undefined);
    setArtifactThread(undefined);
    setArtifactRevisionDiff(undefined);
  }, [selectedRunId]);

  useEffect(() => {
    if (artifactPreview === undefined) return;
    const frame = window.requestAnimationFrame(() => {
      artifactPreviewRef.current?.scrollIntoView({ block: "start" });
      artifactPreviewRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [artifactPreview]);

  const selectedRun = useMemo(
    () => creatingTask ? undefined : runs.find((run) => run.runId === selectedRunId) ?? runs[0],
    [creatingTask, runs, selectedRunId],
  );
  const selectedCapabilities = useMemo(() => [
    ...csvValues(skillIds).map((id) => ({
      kind: "skill" as const,
      id,
      title: extensionCatalog.skills.find((entry) => entry.id === id)?.title ?? humanizeCapabilityId(id),
    })),
    ...csvValues(mcpServerIds).map((id) => ({
      kind: "connection" as const,
      id,
      title: extensionCatalog.mcpServers.find((entry) => entry.id === id)?.title ?? humanizeCapabilityId(id),
    })),
  ], [extensionCatalog, mcpServerIds, skillIds]);
  const selectedRunCapabilityLabels = useMemo(
    () => selectedRun === undefined ? [] : runCapabilityLabels(selectedRun, extensionCatalog),
    [extensionCatalog, selectedRun],
  );
  const activeRuns = runs.filter((run) => ACTIVE_STATUSES.has(run.status) && run.runtimeOwner !== "cli");
  const selectedProviderCredential = providerAvailability[providerId];
  const firstArtifact = selectedRun?.artifacts[0];
  const selectedActiveRun = selectedRun !== undefined && ACTIVE_STATUSES.has(selectedRun.status)
    ? selectedRun
    : undefined;
  const retainedWorktrees = selectedRun?.worktrees.filter((worktree) => worktree.status === "retained") ?? [];
  const cleanupProtected = isCleanupProtected(selectedRun);
  const selectedFailure = selectedRun?.status === "failed" ? explainRunFailure(selectedRun) : undefined;
  useEffect(() => {
    if (selectedActiveRun === undefined) return;
    setRunNow(Date.now());
    const timer = window.setInterval(() => setRunNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [selectedActiveRun?.runId, selectedActiveRun?.status]);

  function resetExtensionSelection() {
    setSkillIds("");
    setMcpServerIds("");
    setBrowserOrigins("");
    setAllowBrowserActions(false);
  }

  function selectSkillForRun(id: string, selected: boolean) {
    setSkillIds(updateCsvSelection(skillIds, id, selected));
  }

  function selectMcpForRun(id: string, selected: boolean) {
    setMcpServerIds(updateCsvSelection(mcpServerIds, id, selected));
  }

  function selectMode(nextMode: DesktopRunMode) {
    setMode(nextMode);
    setSkillIds((current) => csvValues(current)
      .filter((id) => {
        const skill = extensionCatalog.skills.find((entry) => entry.id === id);
        return skill !== undefined && skillAppliesToMode(skill.appliesTo, nextMode);
      })
      .join(","));
    if (nextMode !== "research") setArtifactContinuation(undefined);
  }

  function beginNewTask() {
    setCreatingTask(true);
    setGuideVisible(false);
    setGoal("");
    setGoalConstraints("");
    setVerificationCriteria("");
    setSourcePaths([]);
    setFirstRunSourceKind("sample");
    setArtifactOpenStatus(undefined);
    setArtifactContinuation(undefined);
    setGoalContractExpanded(false);
    setError(undefined);
  }

  async function chooseWorkspace() {
    setError(undefined);
    try {
      const selected = await window.localbuddy.selectWorkspace();
      if (selected === null) return;
      await activateWorkspace(selected);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function checkForUpdates() {
    setError(undefined);
    setUpdating(true);
    try {
      setUpdate(await window.localbuddy.checkForUpdates());
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setUpdating(false);
    }
  }

  async function quitAndInstallUpdate() {
    setError(undefined);
    setUpdating(true);
    try {
      setUpdate(await window.localbuddy.quitAndInstallUpdate());
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setUpdating(false);
    }
  }

  async function openLatestRelease() {
    setError(undefined);
    try {
      await window.localbuddy.openLatestRelease();
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function openRecentWorkspace(selected: string) {
    if (selected === workspace) return;
    setError(undefined);
    try {
      await activateWorkspace(selected);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function activateWorkspace(selected: string) {
    const [history, readiness] = await Promise.all([
      window.localbuddy.listRuns(selected),
      window.localbuddy.inspectWorkspace(selected),
    ]);
    setWorkspace(selected);
    setRuns(history);
    setSelectedRunId(history[0]?.runId);
    setCreatingTask(history.length === 0);
    setRecentWorkspaces((current) => promoteRecentWorkspace(current, selected));
    setWorkspaceReadiness(readiness);
    setGoal("");
    setGoalConstraints("");
    setVerificationCriteria("");
    setSourcePaths([]);
    setFirstRunSourceKind("sample");
    resetExtensionSelection();
    setArtifactContinuation(undefined);
    setStorageDetailsExpanded(false);
    setGuideStatus(guideVisible ? "运行位置已更换。编辑器和本次资料已经清空；请选择合适的模板。" : undefined);
  }

  async function openGuide() {
    setError(undefined);
    setGuideVisible(true);
    if (!onboarding.guideSeen) {
      try {
        setOnboarding(await window.localbuddy.updateOnboarding({ guideSeen: true }));
      } catch (cause) {
        setError(toMessage(cause));
      }
    }
  }

  async function closeGuide() {
    setError(undefined);
    try {
      setOnboarding(await window.localbuddy.updateOnboarding({ guideSeen: true }));
      setGuideVisible(false);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function createTutorialAndPrepare() {
    setError(undefined);
    setGuideStatus(undefined);
    setCreatingTutorial(true);
    try {
      const result = await window.localbuddy.createTutorialWorkspace();
      setWorkspace(result.workspace);
      setRuns(result.runs);
      setSelectedRunId(result.runs[0]?.runId);
      setRecentWorkspaces(result.recentWorkspaces);
      setWorkspaceReadiness(result.readiness);
      setStorageDetailsExpanded(false);
      setOnboarding(result.onboarding);
      setSourcePaths(result.files.map((fileName) => joinLocalPath(result.workspace, fileName)));
      setFirstRunSourceKind("sample");
      resetExtensionSelection();
      applyGuideTemplate("tutorial-research");
      const preparation = result.created
        ? "一份完全虚构的会议记录已经准备好。"
        : "已复用示例会议记录，没有覆盖任何文件。";
      setGuideStatus(selectedProviderCredential.available
        ? `${preparation}${providerLabel(providerId)} 已连接，下一步生成执行计划。`
        : `${preparation}任务尚未启动，下一步连接模型。`
      );
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setCreatingTutorial(false);
    }
  }

  async function chooseOwnMeetingRecord() {
    setError(undefined);
    setGuideStatus(undefined);
    setCreatingTutorial(true);
    try {
      const selected = await window.localbuddy.selectResearchSources("files");
      if (selected.length === 0) {
        setGuideStatus("还没有选择会议记录。任务没有启动，也没有读取任何文件。");
        return;
      }
      const selectedPath = selected[0];
      if (selected.length !== 1 || selectedPath === undefined || !isSupportedFirstRunMeetingRecord(selectedPath)) {
        setGuideStatus("第一次任务请只选择一份 TXT、Markdown 或 Word（DOCX）会议记录；任务没有启动。");
        return;
      }
      const result = await window.localbuddy.createTutorialWorkspace();
      setWorkspace(result.workspace);
      setRuns(result.runs);
      setSelectedRunId(result.runs[0]?.runId);
      setRecentWorkspaces(result.recentWorkspaces);
      setWorkspaceReadiness(result.readiness);
      setStorageDetailsExpanded(false);
      setOnboarding(result.onboarding);
      setSourcePaths([selectedPath]);
      setFirstRunSourceKind("own");
      resetExtensionSelection();
      applyGuideTemplate("tutorial-research");
      setGuideStatus(selectedProviderCredential.available
        ? `已选择一份会议记录。${providerLabel(providerId)} 已连接，下一步生成执行计划；确认前不会读取，也不会修改原文件。`
        : "已选择一份会议记录。下一步连接模型；生成并确认计划前不会读取，也不会修改原文件。"
      );
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setCreatingTutorial(false);
    }
  }

  async function chooseResearchSources(kind: "files" | "folders") {
    setError(undefined);
    try {
      const selected = await window.localbuddy.selectResearchSources(kind);
      setSourcePaths((current) => [...new Set([...current, ...selected])]);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  function applyGuideTemplate(templateId: GuideTemplateId) {
    const template = GUIDE_TEMPLATES[templateId];
    setMode(template.mode);
    setTrustProfile(template.trustProfile);
    setGoal(template.goal);
    setGoalConstraints(template.constraints.join("\n"));
    setVerificationCriteria(template.verificationCriteria.join("\n"));
    setArtifactContinuation(undefined);
    setGuideStatus("任务说明和完成标准已经准备好。生成执行计划后，仍需由你确认才会处理资料。");
  }

  function revealProviderSetup() {
    setError(undefined);
    setCredentialStatus(undefined);
    setProviderSettingsOpen(true);
  }

  function selectProvider(nextProviderId: "deepseek" | "openai") {
    providerSelectionChangedRef.current = true;
    if (nextProviderId !== providerId) {
      setProviderModel("");
      setProviderBaseUrl("");
      setProviderApiKey("");
      setError(undefined);
      setCredentialStatus(undefined);
    }
    setProviderId(nextProviderId);
  }

  async function startRun() {
    setError(undefined);
    if (!selectedProviderCredential.available) {
      setCredentialStatus(`请先为 ${providerLabel(providerId)} 配置 API Key；任务尚未启动。`);
      setProviderSettingsOpen(true);
      return;
    }
    try {
      const origins = csvValues(browserOrigins);
      const criteria = lineValues(verificationCriteria);
      const run = await window.localbuddy.startRun({
        workspace,
        goal,
        goalConstraints: lineValues(goalConstraints),
        verificationCriteria: criteria.length > 0
          ? criteria
          : [artifactContinuation === undefined
            ? "任务要求得到回应，并形成可以打开检查的结果文件"
            : "修改要求得到回应，并形成可以打开检查的新版本结果"],
        concurrency,
        mode,
        sourcePaths: mode === "research" ? sourcePaths : [],
        provider: {
          id: providerId,
          model: providerModel.trim() || undefined,
          baseUrl: providerBaseUrl.trim() || undefined,
        },
        trustProfile,
        extensions: {
          skillIds: csvValues(skillIds),
          mcpServerIds: csvValues(mcpServerIds),
          browser: origins.length === 0
            ? undefined
            : { allowedOrigins: origins, allowActions: allowBrowserActions },
        },
        artifactContinuation: artifactContinuation === undefined ? undefined : {
          parentRunId: artifactContinuation.parentRunId,
          parentFileName: artifactContinuation.parentFileName,
          parentSha256: artifactContinuation.parentSha256,
          reason: goal,
        },
      });
      setRuns((current) => upsertRun(current, run));
      setSelectedRunId(run.runId);
      setCreatingTask(false);
      setGoal("");
      setGoalConstraints("");
      setVerificationCriteria("");
      setSourcePaths([]);
      setArtifactContinuation(undefined);
      setGoalContractExpanded(false);
      setGuideVisible(false);
      setGuideStatus(undefined);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function resolveSelectedPlanReview(decision: "approve" | "reject") {
    if (selectedRun?.planReview?.status !== "pending") return;
    if (decision === "reject" && !window.confirm(
      "拒绝计划会结束这个 Run，但会保留 Goal、计划和审计记录。确认拒绝吗？",
    )) return;
    setError(undefined);
    setResolvingPlanReview(true);
    try {
      const updated = await window.localbuddy.resolvePlanReview({
        workspace,
        runId: selectedRun.runId,
        decision,
      });
      setRuns((current) => upsertRun(current, updated));
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setResolvingPlanReview(false);
    }
  }

  async function saveProviderCredential() {
    if (providerApiKey.trim().length === 0) return;
    setError(undefined);
    setCredentialStatus(undefined);
    setSavingCredential(true);
    try {
      const result = await window.localbuddy.storeProviderCredential({
        providerId,
        apiKey: providerApiKey,
      });
      setProviderApiKey("");
      setCredentialStatus(result.status.source === "environment"
        ? `${providerLabel(providerId)} 已安全保存到本机；当前运行仍优先使用环境变量。`
        : `${providerLabel(providerId)} 已安全保存到本机，输入框已经清空。`
      );
      setProviderAvailability((current) => ({ ...current, [providerId]: result.status }));
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setSavingCredential(false);
    }
  }

  async function deleteProviderCredential() {
    if (selectedProviderCredential.source !== "system") return;
    setError(undefined);
    setCredentialStatus(undefined);
    setDeletingCredential(true);
    try {
      const result = await window.localbuddy.deleteProviderCredential({ providerId });
      setProviderAvailability((current) => ({ ...current, [providerId]: result.status }));
      setCredentialStatus(result.deleted
        ? `${providerLabel(providerId)} 凭据已从系统安全存储删除。`
        : "已取消删除，凭据保持不变。"
      );
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setDeletingCredential(false);
    }
  }

  async function verifySelectedProviderConnection() {
    if (!selectedProviderCredential.available) return;
    setError(undefined);
    setCredentialStatus(undefined);
    setVerifyingProvider(true);
    try {
      await window.localbuddy.verifyProviderConnection({
        providerId,
        baseUrl: providerBaseUrl.trim() || undefined,
      });
      setCredentialStatus(`${providerLabel(providerId)} 连接验证通过；没有生成内容，也没有产生模型用量。`);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setVerifyingProvider(false);
    }
  }

  async function openProviderSetupPage() {
    setError(undefined);
    try {
      await window.localbuddy.openProviderSetup({ providerId });
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function cancelRun() {
    if (selectedActiveRun === undefined) return;
    setError(undefined);
    try {
      await window.localbuddy.cancelRun(selectedActiveRun.runId);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function restartRun() {
    if (
      selectedRun === undefined
      || (selectedRun.status !== "interrupted" && selectedRun.status !== "failed")
      || selectedRun.restartedAs !== undefined
    ) return;
    if (!window.confirm(
      "从头重新开始会保留原任务记录，但会再次连接模型服务，并可能产生新的模型费用。确认继续吗？",
    )) return;
    setError(undefined);
    try {
      const replay = await window.localbuddy.restartRun({ workspace, runId: selectedRun.runId });
      setRuns((current) => upsertRun(current, replay));
      setSelectedRunId(replay.runId);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function resumeRun() {
    if (
      selectedRun === undefined
      || (selectedRun.status !== "interrupted" && selectedRun.status !== "failed")
      || selectedRun.checkpoint?.status !== "available"
    ) return;
    setError(undefined);
    try {
      const resumed = await window.localbuddy.resumeRun({ workspace, runId: selectedRun.runId });
      setRuns((current) => upsertRun(current, resumed));
      setSelectedRunId(resumed.runId);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function loadArtifactPreview(fileName: string) {
    if (selectedRun === undefined) return;
    await openArtifactVersion(selectedRun.runId, fileName, false);
  }

  async function openArtifactVersion(runId: string, fileName: string, navigate = true) {
    setError(undefined);
    setArtifactOpenStatus(undefined);
    setLoadingArtifactName(fileName);
    setArtifactRevisionDiff(undefined);
    try {
      if (navigate) {
        setSelectedRunId(runId);
        await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 0));
      }
      const request = {
        workspace,
        runId,
        fileName,
      };
      const [preview, thread] = await Promise.all([
        window.localbuddy.loadArtifactPreview(request),
        window.localbuddy.loadArtifactThread(request),
      ]);
      setArtifactPreview(preview);
      setArtifactThread(thread);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setLoadingArtifactName(undefined);
    }
  }

  async function openArtifactExternally(fileName: string) {
    if (selectedRun === undefined) return;
    setError(undefined);
    setArtifactOpenStatus(undefined);
    setOpeningArtifactName(fileName);
    try {
      await window.localbuddy.openArtifact({ workspace, runId: selectedRun.runId, fileName });
      setArtifactOpenStatus(`${fileName} 已交给系统默认应用打开。你可以切换到该应用继续查看和修改。`);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setOpeningArtifactName(undefined);
    }
  }

  function continueFromArtifact() {
    if (selectedRun === undefined || artifactPreview === undefined) return;
    const parentRevision = selectedRun.artifactRevision?.revision ?? 1;
    setArtifactContinuation({
      parentRunId: selectedRun.runId,
      parentFileName: artifactPreview.fileName,
      parentSha256: artifactPreview.sha256,
      parentRevision,
      threadId: selectedRun.artifactRevision?.threadId,
    });
    setCreatingTask(true);
    setMode("research");
    setGoal("");
    setSourcePaths([]);
    setGoalConstraints([
      "把父产物作为明确资料，不读取未选择的工作区内容",
      "保留上一版本和版本关系，不覆盖父产物",
    ].join("\n"));
    setVerificationCriteria([
      "新产物明确回应本轮修改要求",
      "父产物身份和 SHA-256 可追溯",
    ].join("\n"));
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.scrollIntoView({ behavior: "smooth" }), 0);
  }

  async function viewParentArtifactRevision() {
    const revision = selectedRun?.artifactRevision;
    if (revision === undefined) return;
    setError(undefined);
    setLoadingArtifactName(revision.parentFileName);
    try {
      await openArtifactVersion(revision.parentRunId, revision.parentFileName);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setLoadingArtifactName(undefined);
    }
  }

  async function loadArtifactRevisionDiff() {
    if (selectedRun === undefined || artifactPreview === undefined) return;
    setError(undefined);
    setLoadingArtifactDiff(true);
    try {
      setArtifactRevisionDiff(await window.localbuddy.loadArtifactRevisionDiff({
        workspace,
        runId: selectedRun.runId,
        fileName: artifactPreview.fileName,
      }));
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setLoadingArtifactDiff(false);
    }
  }

  async function cleanupWorktrees() {
    if (selectedRun === undefined || retainedWorktrees.length === 0 || cleanupProtected) return;
    setError(undefined);
    try {
      const updated = await window.localbuddy.cleanupWorktrees({
        workspace,
        runId: selectedRun.runId,
      });
      if (updated !== null) {
        setRuns((current) => upsertRun(current, updated));
      }
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function approveIntegration() {
    if (selectedRun?.integration?.status !== "awaiting_approval") return;
    setError(undefined);
    try {
      const updated = await window.localbuddy.approveIntegration({
        workspace,
        runId: selectedRun.runId,
        commitMessage: commitAfterApply ? commitMessage : undefined,
      });
      if (updated !== null) {
        setRuns((current) => upsertRun(current, updated));
      }
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function revertIntegration() {
    if (
      selectedRun?.integration?.status !== "applied"
      && selectedRun?.integration?.status !== "committed"
    ) return;
    setError(undefined);
    try {
      const updated = await window.localbuddy.revertIntegration({
        workspace,
        runId: selectedRun.runId,
      });
      if (updated !== null) {
        setRuns((current) => upsertRun(current, updated));
      }
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function loadIntegrationDiff() {
    if (selectedRun?.integration?.combinedPatchSha256 === undefined) return;
    setError(undefined);
    setLoadingIntegrationDiff(true);
    try {
      const diff = await window.localbuddy.loadIntegrationDiff({
        workspace,
        runId: selectedRun.runId,
      });
      setIntegrationDiff(diff);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setLoadingIntegrationDiff(false);
    }
  }

  async function exportDiagnostics() {
    if (selectedRun === undefined) return;
    setError(undefined);
    setDiagnosticsStatus(undefined);
    setExportingDiagnostics(true);
    try {
      const path = await window.localbuddy.exportDiagnostics({
        workspace,
        runId: selectedRun.runId,
      });
      if (path !== null) setDiagnosticsStatus(`脱敏诊断包已导出：${path}`);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setExportingDiagnostics(false);
    }
  }

  function beginBugReport() {
    if (selectedRun === undefined) return;
    setBugReportPreview(undefined);
    setBugReportError(undefined);
    setBugReportOpen(true);
    void prepareBugReportRequest({ workspace, runId: selectedRun.runId });
  }

  function currentBugReportRequest() {
    if (selectedRun === undefined) throw new Error("没有可报告的 Run");
    return { workspace, runId: selectedRun.runId };
  }

  async function prepareBugReport() {
    await prepareBugReportRequest(currentBugReportRequest());
  }

  async function prepareBugReportRequest(request: { workspace: string; runId: string }) {
    setBugReportError(undefined);
    setPreparingBugReport(true);
    try {
      setBugReportPreview(await window.localbuddy.prepareBugReport(request));
    } catch (cause) {
      setBugReportError(toMessage(cause));
    } finally {
      setPreparingBugReport(false);
    }
  }

  async function saveBugReport() {
    setBugReportError(undefined);
    setSavingBugReport(true);
    try {
      const path = await window.localbuddy.saveBugReport(currentBugReportRequest());
      if (path !== null) setBugReportStatus(`公开安全问题报告已保存在本机：${path}`);
    } catch (cause) {
      setBugReportError(toMessage(cause));
    } finally {
      setSavingBugReport(false);
    }
  }

  async function openBugReportOnGitHub() {
    if (bugReportPreview === undefined) return;
    setBugReportError(undefined);
    setOpeningBugReport(true);
    try {
      const result = await window.localbuddy.openBugReport({
        ...currentBugReportRequest(),
        confirmedPublicSubmission: true,
        confirmedPreviewSha256: bugReportPreview.previewSha256,
      });
      setBugReportStatus(result.status === "duplicate-opened"
        ? "已在浏览器中打开可能重复的公开 Issue；LocalBuddy 没有发布新内容。"
        : "已在浏览器中打开预填的公开 Issue；请再次检查并由你点击 Submit new issue。");
      setBugReportOpen(false);
    } catch (cause) {
      setBugReportError(toMessage(cause));
    } finally {
      setOpeningBugReport(false);
    }
  }

  async function resolveToolApproval(approvalId: string, decision: "approve" | "deny") {
    if (selectedRun === undefined) return;
    setError(undefined);
    setResolvingApprovalId(approvalId);
    try {
      const updated = await window.localbuddy.resolveToolApproval({
        workspace,
        runId: selectedRun.runId,
        approvalId,
        decision,
      });
      setRuns((current) => upsertRun(current, updated));
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setResolvingApprovalId(undefined);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="window-drag" />
        <div className="brand">
          <span className="brand-mark">
            <img src={localBuddyIcon} alt="" />
          </span>
          <div>
            <strong>LocalBuddy</strong>
            <span>本地 AI 任务工作台</span>
          </div>
        </div>

        <button className="workspace-button" onClick={chooseWorkspace}>
          <span className="workspace-icon">⌘</span>
          <span>
            <small>运行位置</small>
            <strong title={workspace || "尚未选择运行位置"}>{workspace.length === 0 ? "选择保存运行记录的位置" : shortPath(workspace)}</strong>
          </span>
          <span className="chevron">⌄</span>
        </button>

        <button className={guideVisible ? "guide-entry active" : "guide-entry"} onClick={openGuide}>
          <span className="guide-entry-icon">?</span>
          <span>
            <strong>第一次使用</strong>
            <small>三步完成第一份结果</small>
          </span>
        </button>

        <button className="provider-entry" onClick={revealProviderSetup}>
          <span className={`provider-entry-icon ${selectedProviderCredential.available ? "ready" : "missing"}`}>◆</span>
          <span>
            <strong>模型设置</strong>
            <small>{providerLabel(providerId)} · {modelConnectionLabel(selectedProviderCredential)}</small>
          </span>
        </button>

        {recentWorkspaces.filter((item) => item !== workspace).length > 0 && (
          <div className="recent-workspaces">
            <span>最近运行位置</span>
            {recentWorkspaces.filter((item) => item !== workspace).slice(0, 3).map((item) => (
              <button key={item} onClick={() => openRecentWorkspace(item)} title={item}>
                {shortPath(item)}
              </button>
            ))}
          </div>
        )}

        <div className="sidebar-label">
          <span>运行记录</span>
          <span>{runs.length}</span>
        </div>
        <nav className="run-list">
          {runs.map((run) => (
            <button
              className={!guideVisible && run.runId === selectedRun?.runId ? "run-item selected" : "run-item"}
              key={run.runId}
              onClick={() => {
                setGuideVisible(false);
                setCreatingTask(false);
                setSelectedRunId(run.runId);
              }}
            >
              <span className={`status-dot ${run.status}`} />
              <span>
                <strong>{friendlyRunName(run)}</strong>
                <small>{formatTime(run.startedAt)} · {run.eventCount} 条记录</small>
              </span>
            </button>
          ))}
          {!loading && runs.length === 0 && (
            <div className="empty-sidebar">这里还没有运行记录</div>
          )}
        </nav>

        <div className="sidebar-footer">
          <span className="secure-dot" />
          密钥由系统保管 · 过程留在本机
        </div>
      </aside>

      {providerSettingsOpen && (
        <ProviderSettingsDialog
          providerId={providerId}
          availability={providerAvailability}
          model={providerModel}
          baseUrl={providerBaseUrl}
          apiKey={providerApiKey}
          status={credentialStatus}
          error={error}
          saving={savingCredential}
          deleting={deletingCredential}
          verifying={verifyingProvider}
          onSelectProvider={selectProvider}
          onChangeModel={setProviderModel}
          onChangeBaseUrl={setProviderBaseUrl}
          onChangeApiKey={setProviderApiKey}
          onSave={saveProviderCredential}
          onDelete={deleteProviderCredential}
          onVerify={verifySelectedProviderConnection}
          onOpenProviderSetup={openProviderSetupPage}
          onClose={() => {
            setProviderApiKey("");
            setError(undefined);
            setCredentialStatus(undefined);
            setProviderSettingsOpen(false);
          }}
        />
      )}

      {extensionsOpen && (
        <CapabilityPickerDialog
          catalog={extensionCatalog}
          loading={loadingExtensionCatalog}
          error={extensionCatalogError}
          mode={mode}
          selectedSkillIds={csvValues(skillIds)}
          selectedConnectionIds={csvValues(mcpServerIds)}
          browserOrigins={browserOrigins}
          allowBrowserActions={allowBrowserActions}
          onToggleSkill={selectSkillForRun}
          onToggleConnection={selectMcpForRun}
          onChangeBrowserOrigins={(value) => {
            setBrowserOrigins(value);
            if (csvValues(value).length === 0) setAllowBrowserActions(false);
          }}
          onChangeBrowserActions={setAllowBrowserActions}
          onRefresh={() => setExtensionCatalogVersion((current) => current + 1)}
          onClose={() => setExtensionsOpen(false)}
        />
      )}

      {bugReportOpen && selectedRun && (
        <BugReportDialog
          preview={bugReportPreview}
          error={bugReportError}
          preparing={preparingBugReport}
          saving={savingBugReport}
          opening={openingBugReport}
          onPrepare={prepareBugReport}
          onSave={saveBugReport}
          onOpen={openBugReportOnGitHub}
          onClose={() => setBugReportOpen(false)}
        />
      )}

      <main className="workspace-main">
        <header className="main-header">
          <div>
            <div className="eyebrow">本机任务工作台</div>
            <h1>{guideVisible ? "完成第一次任务" : selectedRun ? friendlyRunName(selectedRun) : "创建第一个任务"}</h1>
          </div>
          {guideVisible ? (
            <div className="header-actions guide-header-actions">
              <button onClick={closeGuide}>跳过指引，进入完整工作台</button>
            </div>
          ) : selectedRun && (
            <div className="header-actions">
              {selectedActiveRun ? (
                <>
                  <button className="header-new-task" onClick={beginNewTask}>开始新任务</button>
                  <button className="header-stop-button" onClick={cancelRun}>停止任务</button>
                </>
              ) : (
                <button className="header-new-task" onClick={beginNewTask}>开始新任务</button>
              )}
              <StatusPill status={selectedRun.status} />
              <details className="header-more-menu">
                <summary aria-label="更多操作">•••</summary>
                <div>
                  <button onClick={beginBugReport}>报告问题</button>
                  <button onClick={exportDiagnostics} disabled={exportingDiagnostics}>
                    {exportingDiagnostics ? "导出中…" : "导出脱敏诊断"}
                  </button>
                </div>
              </details>
            </div>
          )}
        </header>

        {error && <div className="error-banner">{error}</div>}
        {diagnosticsStatus && <div className="success-banner">{diagnosticsStatus}</div>}
        {artifactOpenStatus && <div className="success-banner">{artifactOpenStatus}</div>}
        {bugReportStatus && <div className="success-banner">{bugReportStatus}</div>}
        {guideVisible ? (
          <FirstRunGuide
            workspace={workspace}
            providerId={providerId}
            providerAvailability={providerAvailability}
            creatingTutorial={creatingTutorial}
            tutorialPrepared={
              workspaceReadiness.isTutorialWorkspace
              && sourcePaths.length === 1
              && goal.trim().length > 0
              && lineValues(verificationCriteria).length > 0
            }
            sourceKind={firstRunSourceKind}
            status={guideStatus}
            onCreateTutorial={createTutorialAndPrepare}
            onChooseOwnMeetingRecord={chooseOwnMeetingRecord}
            onConfigureProvider={revealProviderSetup}
            onStart={startRun}
          />
        ) : selectedRun ? (
          <div className="run-content">
            <RunStoryPanel run={selectedRun} now={runNow} />

            {selectedRun.planReview && (
              <PlanReviewPanel
                run={selectedRun}
                capabilityLabels={selectedRunCapabilityLabels}
                resolving={resolvingPlanReview}
                onResolve={resolveSelectedPlanReview}
              />
            )}

            {selectedRun.status === "failed" && (
              <section className="panel failed-recovery-panel">
                <div>
                  <span className="recovery-kicker">任务没有完成</span>
                  <h2>{selectedFailure?.title ?? plainFailureTitle(selectedRun.metrics.failureStage)}</h2>
                  <p>{selectedFailure?.detail ?? "LocalBuddy 已停止任务，原始资料和历史记录仍会保留。"}</p>
                  <div className="recovery-checkpoint-status">
                    <strong>能否接着运行</strong>
                    {selectedRun.checkpoint === undefined ? (
                      <p>正在检查安全继续点。检查完成前不会重复执行，也不会把失败显示成成功。</p>
                    ) : selectedRun.checkpoint.status === "available" ? (
                      <p>
                        可以。已完成的 {selectedRun.checkpoint.completedTasks} 个步骤会保留；“继续未完成步骤”只处理剩余
                        {selectedRun.checkpoint.resumableTasks} 个步骤。
                      </p>
                    ) : (
                      <p>
                        当前不能直接续跑：{checkpointBlockedReasonForRun(selectedRun)}。
                        这只说明恢复点不可用，不是上面的失败原因。
                      </p>
                    )}
                  </div>
                  <p className="failure-safety-note">原始资料不会因为这次失败被当作结果覆盖；已经通过检查的结果文件仍会保留。</p>
                  {selectedRun.error && (
                    <details className="technical-details">
                      <summary>查看技术信息</summary>
                      <small>{toMessage(selectedRun.error)}</small>
                    </details>
                  )}
                </div>
                <div className="recovery-actions">
                  {selectedFailure?.checkProvider && (
                    <button className="check-provider-button" onClick={revealProviderSetup}>检查模型连接</button>
                  )}
                  {selectedRun.checkpoint?.status === "available" && (
                    <button onClick={resumeRun}>继续未完成步骤</button>
                  )}
                  {selectedRun.checkpoint !== undefined && (
                    <button className="replay-button" onClick={restartRun} disabled={selectedRun.restartedAs !== undefined}>
                      {selectedRun.restartedAs ? "已经重新开始" : "从头重新开始"}
                    </button>
                  )}
                  <button className="report-failure-button" onClick={beginBugReport}>报告这次失败</button>
                </div>
              </section>
            )}

            {selectedRun.status === "interrupted" && (
              <section className="panel recovery-panel">
                <div>
                  <span className="recovery-kicker">任务被意外中断</span>
                  <h2>先确认能否安全继续</h2>
                  {selectedRun.checkpoint?.status === "available" ? (
                    <p>
                      已完成 {selectedRun.checkpoint.completedTasks} 个步骤，仍有 {selectedRun.checkpoint.resumableTasks} 个步骤需要继续。
                      {selectedRun.mode === "code"
                        ? " 系统会重新检查隔离修改；没有你的批准，主工作区不会写入。"
                        : " 模型请求可能重试，已经确认的本地读取不会重复执行。"}
                    </p>
                  ) : (
                    <p>
                      当前无法安全继续：{recoveryBlockedReason(selectedRun.checkpoint?.reason)}。
                      你仍可保留本次记录并从原任务重新开始。
                    </p>
                  )}
                  {selectedRun.restartedAs && <small>已经创建新的任务记录：{selectedRun.restartedAs}</small>}
                </div>
                <div className="recovery-actions">
                  {selectedRun.checkpoint?.status === "available" && (
                    <button onClick={resumeRun}>继续未完成步骤</button>
                  )}
                  <button className="replay-button" onClick={restartRun} disabled={selectedRun.restartedAs !== undefined}>
                    {selectedRun.restartedAs ? "已经重新开始" : "从头重新开始"}
                  </button>
                </div>
              </section>
            )}

            {selectedRun.status === "succeeded" && firstArtifact && (
              <section className="panel result-ready-panel">
                <div>
                  <span className="result-ready-kicker">任务已完成</span>
                  <h2>结果文件已经准备好：{firstArtifact.fileName}</h2>
                  <p>先查看内容；确认无误后，可以用系统默认应用打开，或基于这份结果继续修改。</p>
                </div>
                <div className="result-ready-actions">
                  <button onClick={() => loadArtifactPreview(firstArtifact.fileName)}>查看结果</button>
                  <button
                    className="open-result-button"
                    onClick={() => openArtifactExternally(firstArtifact.fileName)}
                    disabled={openingArtifactName === firstArtifact.fileName}
                  >
                    {openingArtifactName === firstArtifact.fileName ? "正在打开…" : "用默认应用打开"}
                  </button>
                  <button className="new-task-button" onClick={beginNewTask}>开始新任务</button>
                </div>
              </section>
            )}

            {selectedRun.pendingApprovals.length > 0 && (
              <section className="panel tool-approval-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-index">!</span>
                    <h2>逐调用人工审批</h2>
                  </div>
                  <span className="panel-note">只批准当前这一次调用</span>
                </div>
                <div className="tool-approval-list">
                  {selectedRun.pendingApprovals.map((approval) => (
                    <article className="tool-approval-card" key={approval.id}>
                      <div className="tool-approval-title">
                        <div>
                          <strong>{approval.toolName}</strong>
                          <span>{approval.agentId} · {approval.taskId}</span>
                        </div>
                        <small>参数哈希 {approval.argumentsSha256.slice(0, 12)}</small>
                      </div>
                      <p>{approval.toolDescription}</p>
                      <pre>{approval.argumentsPreview}</pre>
                      <div className="tool-approval-actions">
                        <span>到期 {formatClock(approval.expiresAt)}</span>
                        <button
                          className="deny-tool-button"
                          disabled={resolvingApprovalId === approval.id}
                          onClick={() => resolveToolApproval(approval.id, "deny")}
                        >拒绝</button>
                        <button
                          className="approve-tool-button"
                          disabled={resolvingApprovalId === approval.id}
                          onClick={() => resolveToolApproval(approval.id, "approve")}
                        >批准一次</button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {selectedRun.worktrees.length > 0 && (
              <section className="panel worktree-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-index">WT</span>
                    <h2>隔离工作树清单</h2>
                  </div>
                  <span className="panel-note">保留 {retainedWorktrees.length} · 已清理 {selectedRun.worktrees.length - retainedWorktrees.length}</span>
                </div>
                <div className="worktree-list">
                  {selectedRun.worktrees.map((worktree) => (
                    <div className={`worktree-row ${worktree.status}`} key={worktree.path}>
                      <span>{worktree.status === "retained" ? "保留" : "已清理"}</span>
                      <strong>{worktree.taskId}</strong>
                      <code title={worktree.path}>{shortPath(worktree.path)}</code>
                    </div>
                  ))}
                </div>
                {retainedWorktrees.length > 0 && (
                  <div className="worktree-actions">
                    <p>{cleanupProtected ? "当前集成状态仍依赖这些隔离区，暂不可清理。" : "显式清理只删除 Git 已确认登记的 worktree，审计日志与产物保留。"}</p>
                    <button onClick={cleanupWorktrees} disabled={cleanupProtected}>清理保留的 worktree</button>
                  </div>
                )}
              </section>
            )}

            <section className="panel artifacts-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-index">02</span>
                  <h2>结果文件</h2>
                </div>
                <span className="panel-note">{artifactReviewLabel(selectedRun.artifactReview)}</span>
              </div>
              {selectedRun.artifactRevision && (
                <div className="artifact-revision-banner">
                  <span>VERSION {selectedRun.artifactRevision.revision}</span>
                  <div>
                    <strong>这是同一 Artifact Thread 的第 {selectedRun.artifactRevision.revision} 版任务</strong>
                    <p>
                      上一版：{selectedRun.artifactRevision.parentFileName} · {selectedRun.artifactRevision.parentSha256.slice(0, 12)}
                      <br />修改原因：{selectedRun.artifactRevision.reason}
                    </p>
                  </div>
                  <button type="button" onClick={viewParentArtifactRevision}>查看上一版</button>
                </div>
              )}
              <div className="artifact-list">
                {selectedRun.artifacts.map((artifact) => (
                  <button
                    className="artifact-card"
                    key={artifact.absolutePath}
                    onClick={() => loadArtifactPreview(artifact.fileName)}
                  >
                      <span className="file-badge">{artifactBadge(artifact.fileName)}</span>
                    <span>
                      <strong>{artifact.fileName}</strong>
                      <small>{formatBytes(artifact.bytes)} · {artifact.sha256?.slice(0, 12) ?? "hash pending"}</small>
                    </span>
                    <span className="open-arrow">{loadingArtifactName === artifact.fileName ? "…" : "›"}</span>
                  </button>
                ))}
                {selectedRun.artifacts.length === 0 && (
                  <div className="empty-panel compact">完成并通过检查的结果会出现在这里；点击文件即可预览和打开。</div>
                )}
              </div>
              {artifactPreview && (
                <div className="artifact-preview" ref={artifactPreviewRef} tabIndex={-1}>
                  <div className="artifact-preview-header">
                    <div>
                      <strong>{artifactPreview.fileName}</strong>
                      <span>
                        {selectedRun.artifactRevision ? `Version ${selectedRun.artifactRevision.revision} · ` : ""}
                        SHA-256 {artifactPreview.sha256.slice(0, 16)} · {formatBytes(artifactPreview.bytes)}{artifactPreview.truncated ? " · 预览已截断" : ""}
                      </span>
                    </div>
                    <div>
                      <button
                        onClick={() => openArtifactExternally(artifactPreview.fileName)}
                        disabled={openingArtifactName === artifactPreview.fileName}
                      >
                        {openingArtifactName === artifactPreview.fileName ? "正在打开…" : "系统打开"}
                      </button>
                      {selectedRun.artifactRevision && (
                        <button onClick={loadArtifactRevisionDiff} disabled={loadingArtifactDiff}>
                          {loadingArtifactDiff ? "比较中…" : "与上一版比较"}
                        </button>
                      )}
                      <button className="continue-artifact-button" onClick={continueFromArtifact}>继续修改这份结果</button>
                    </div>
                  </div>
                  {artifactPreview.document && (
                    <div className="artifact-document-summary">
                      <strong>DOCX 结构预览</strong>
                      <span>
                        {artifactPreview.document.sections} 个章节 · {artifactPreview.document.paragraphs} 个段落 · {artifactPreview.document.tables} 个表格 · {artifactPreview.document.tableRows} 行表格数据
                      </span>
                      <small>正文与表格已在本机从 OOXML 抽取复核；分页和视觉版式请使用“系统打开”检查。</small>
                    </div>
                  )}
                  <pre>{artifactPreview.text}</pre>
                  <small>
                    {artifactPreview.format === "docx" ? "结构预览" : "文本预览"}在本机完成；发起修订时会把这份已校验内容复制成新 Run 的只读资料快照，不会覆盖上一版。
                  </small>
                </div>
              )}
              {artifactThread && (
                <div className="artifact-thread-workbench">
                  <div className="artifact-thread-heading">
                    <div>
                      <strong>版本历史</strong>
                      <small>{artifactThread.threadId} · {artifactThread.versions.length} 个版本/尝试</small>
                    </div>
                    <span>只读取已登记 Artifact，不扫描工作区</span>
                  </div>
                  <div className="artifact-thread-list">
                    {artifactThread.versions.map((version, index) => {
                      const sameRevisionCount = artifactThread.versions.filter(
                        (candidate) => candidate.revision === version.revision,
                      ).length;
                      return (
                        <article
                          className={version.runId === selectedRun.runId ? "selected" : ""}
                          key={`${version.revision}:${version.runId}:${index}`}
                        >
                          <div className="artifact-thread-version">
                            <span>V{version.revision}</span>
                            <div>
                              <strong>{version.title}</strong>
                              <small>
                                {statusLabel(version.runStatus)} · {formatTime(version.startedAt)}
                                {sameRevisionCount > 1 ? ` · 同版 ${sameRevisionCount} 个分支/尝试` : ""}
                              </small>
                            </div>
                          </div>
                          {version.reason && <p>{version.reason}</p>}
                          <div className="artifact-thread-files">
                            {version.artifacts.map((artifact) => (
                              <button
                                type="button"
                                key={artifact.fileName}
                                disabled={artifact.verification !== "verified"}
                                onClick={() => openArtifactVersion(version.runId, artifact.fileName)}
                              >
                                <span>{artifact.fileName}</span>
                                <small>
                                  {artifact.verification === "verified"
                                    ? `${formatBytes(artifact.bytes)} · ${artifact.sha256?.slice(0, 12)}`
                                    : "校验不可用"}
                                </small>
                              </button>
                            ))}
                            {version.artifacts.length === 0 && <small>本次运行没有通过验证的产物</small>}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
              {artifactRevisionDiff && (
                <div className="artifact-revision-diff">
                  <div className="artifact-diff-heading">
                    <div>
                      <strong>
                        V{artifactRevisionDiff.parent.revision} → V{artifactRevisionDiff.current.revision}
                        {artifactRevisionDiff.comparisonKind === "docx-structure" ? " DOCX 正文/表格差异" : " 文本差异"}
                      </strong>
                      <small>
                        {artifactRevisionDiff.parent.fileName} → {artifactRevisionDiff.current.fileName}
                      </small>
                    </div>
                    <span>
                      +{artifactRevisionDiff.addedLines} / −{artifactRevisionDiff.removedLines}
                      {artifactRevisionDiff.truncated ? " · 显示已截断" : ""}
                    </span>
                  </div>
                  {artifactRevisionDiff.lines.length === 0 ? (
                    <div className="artifact-diff-empty">文本内容与上一版一致；版本关系和 SHA-256 仍分别保留。</div>
                  ) : (
                    <div className="artifact-diff-lines">
                      {artifactRevisionDiff.lines.map((line, index) => (
                        <div className={line.kind} key={`${index}:${line.beforeLine ?? ""}:${line.afterLine ?? ""}`}>
                          <span>{line.beforeLine ?? ""}</span>
                          <span>{line.afterLine ?? ""}</span>
                          <code>
                            {line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}
                            {line.text}
                          </code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {selectedRun.integration && (
              <section className={`panel integration-panel ${selectedRun.integration.status}`}>
                <div className="panel-heading">
                  <div>
                    <span className="section-index">03</span>
                    <h2>受控集成</h2>
                  </div>
                  <span className={`integration-status ${selectedRun.integration.status}`}>
                    {integrationStatusLabel(selectedRun.integration.status)}
                  </span>
                </div>
                <div className="integration-body">
                  <div className="integration-facts">
                    <div>
                      <span>组合检查</span>
                      <strong>{selectedRun.integration.checkCommands.join(" · ") || "等待预检"}</strong>
                    </div>
                    <div>
                      <span>变更路径</span>
                      <strong>{selectedRun.integration.changedPaths.join(" · ") || "尚未生成"}</strong>
                    </div>
                    <div>
                      <span>组合补丁</span>
                      <strong>{selectedRun.integration.combinedPatchSha256?.slice(0, 16) ?? "—"}</strong>
                      {selectedRun.integration.combinedPatchSha256 && (
                        <button className="diff-load-button" onClick={loadIntegrationDiff} disabled={loadingIntegrationDiff}>
                          {loadingIntegrationDiff ? "校验中…" : integrationDiff ? "重新校验 Diff" : "校验并查看 Diff"}
                        </button>
                      )}
                    </div>
                  </div>
                  {integrationDiff && (
                    <div className="inline-diff">
                      <div>
                        <strong>已校验 SHA-256 · {integrationDiff.sha256}</strong>
                        <span>{formatBytes(integrationDiff.bytes)}{integrationDiff.truncated ? " · 预览已截断" : " · 完整预览"}</span>
                      </div>
                      <pre>{integrationDiff.text}</pre>
                    </div>
                  )}
                  {selectedRun.integration.status === "awaiting_approval" && (
                    <div className="approval-box">
                      <p>预览 worktree 已通过组合检查。Agent 无权写回，必须由你批准。</p>
                      <label className="commit-choice">
                        <input
                          type="checkbox"
                          checked={commitAfterApply}
                          onChange={(event) => setCommitAfterApply(event.target.checked)}
                        />
                        应用后创建 commit
                      </label>
                      {commitAfterApply && (
                        <input
                          className="commit-message"
                          value={commitMessage}
                          onChange={(event) => setCommitMessage(event.target.value)}
                          placeholder="单行 commit message"
                          maxLength={120}
                        />
                      )}
                      <button
                        className="approve-button"
                        onClick={approveIntegration}
                        disabled={commitAfterApply && commitMessage.trim().length === 0}
                      >
                        {commitAfterApply ? "批准写回并提交" : "批准写回主工作区"}
                      </button>
                    </div>
                  )}
                  {selectedRun.integration.status === "applied" && (
                    <div className="approval-box applied-box">
                      <p>补丁已写入主工作区但尚未提交。继续编辑后将不能自动撤销。</p>
                      <button className="revert-button" onClick={revertIntegration}>撤销本次应用</button>
                    </div>
                  )}
                  {selectedRun.integration.status === "committed" && (
                    <div className="approval-box applied-box">
                      <p>本次集成已经提交。撤销会保留历史，并创建一个新的反向 commit。</p>
                      <button className="revert-button" onClick={revertIntegration}>创建反向提交</button>
                    </div>
                  )}
                  {selectedRun.integration.commitSha && (
                    <div className="commit-result">Commit · {selectedRun.integration.commitSha}</div>
                  )}
                  {selectedRun.integration.revertCommitSha && (
                    <div className="commit-result">Revert commit · {selectedRun.integration.revertCommitSha}</div>
                  )}
                  {selectedRun.integration.error && (
                    <div className="integration-error">
                      {toMessage(selectedRun.integration.error)}
                      {selectedRun.integration.rolledBack && " · 已自动恢复主工作区"}
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="welcome-state">
            <span className="welcome-mark">◫</span>
            <h2>准备开始一个真实任务</h2>
            <p>{workspace.length === 0 ? "先选择一个明确的工作区，或重新打开“指引与示例”创建安全教程工作区。" : "描述目标并检查下方配置。模板只会预填；LocalBuddy 不会自行启动任务。"}</p>
            <button className="reopen-guide-button" onClick={openGuide}>打开指引与示例</button>
          </div>
        )}

        {!guideVisible && selectedRun === undefined && <section className="composer">
          <div className="goal-contract-heading">
            <div>
              <strong>{artifactContinuation ? `怎样修改 ${artifactContinuation.parentFileName}？` : "你想让 LocalBuddy 完成什么？"}</strong>
              <small>先用自己的话描述结果。LocalBuddy 会列出执行步骤，得到你的确认后才开始。</small>
            </div>
            <div className="goal-contract-heading-actions">
              <button
                type="button"
                aria-expanded={goalContractExpanded}
                aria-controls="goal-contract-fields"
                onClick={() => setGoalContractExpanded((current) => !current)}
              >
                {goalContractExpanded ? "收起任务要求" : "任务要求（可选）"}
                <span aria-hidden="true">{goalContractExpanded ? "⌃" : "⌄"}</span>
              </button>
            </div>
          </div>
          {artifactContinuation && (
            <div className="artifact-continuation-banner">
              <span>V{artifactContinuation.parentRevision} → V{artifactContinuation.parentRevision + 1}</span>
              <div>
                <strong>正在修订 {artifactContinuation.parentFileName}</strong>
                <small>
                  父产物 {artifactContinuation.parentSha256.slice(0, 12)} 将由 Main 进程复核，并复制为本次明确资料；本轮目标会保存为修改原因。
                </small>
              </div>
              <button type="button" onClick={() => setArtifactContinuation(undefined)}>取消修订关系</button>
            </div>
          )}
          <label className="goal-outcome-field">
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder={artifactContinuation === undefined
                ? "例如：把我添加的会议记录整理成可编辑的 会议纪要.docx，列出结论、负责人、截止时间和待确认事项。"
                : `请写清这次要怎样修改 ${artifactContinuation.parentFileName}。`}
            />
          </label>
          {goalContractExpanded && <div id="goal-contract-fields" className="goal-contract-fields">
          <div className="goal-contract-grid">
            <label>
              <span>需要遵守什么 <small>每行一条，可选</small></span>
              <textarea
                value={goalConstraints}
                onChange={(event) => setGoalConstraints(event.target.value)}
                placeholder={"只采用官方或权威来源\n不要扫描未明确添加的本地目录"}
              />
            </label>
            <label>
              <span>怎样才算完成 <small>每行一条，可选</small></span>
              <textarea
                value={verificationCriteria}
                onChange={(event) => setVerificationCriteria(event.target.value)}
                placeholder={"每项结论附原始出处\n明确区分原文、概括与推断"}
              />
            </label>
          </div>
          </div>}
          {mode === "research" && (
            <div className="research-sources">
              <div className="research-sources-heading">
                <span>
                  <strong>本次资料</strong>
                  <small>只读取你明确添加的资料；不会扫描上面的运行位置</small>
                </span>
                <span className="research-source-actions">
                  <button type="button" onClick={() => chooseResearchSources("files")}>添加文件</button>
                  <button type="button" onClick={() => chooseResearchSources("folders")}>添加资料文件夹</button>
                </span>
              </div>
              {sourcePaths.length === 0 ? (
                <p>未添加本地资料。任务仍可使用你添加的网页来源或连接；没有证据时会明确说明缺口。</p>
              ) : (
                <div className="research-source-list">
                  {sourcePaths.map((path) => (
                    <span className="research-source-chip" key={path} title={path}>
                      {shortPath(path)}
                      <button
                        type="button"
                        aria-label={`移除资料 ${path}`}
                        onClick={() => setSourcePaths((current) => current.filter((item) => item !== path))}
                      >×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className={`storage-disclosure ${workspaceReadiness.storage.risk}`}>
            <button
              type="button"
              aria-expanded={storageDetailsExpanded}
              aria-controls="storage-disclosure-details"
              onClick={() => setStorageDetailsExpanded((current) => !current)}
            >
              <strong>存储与隐私</strong>
              <span>
                {workspace.length === 0
                  ? "选择运行位置后显示过程文件和结果文件的确切位置"
                  : workspaceReadiness.storage.risk === "review_required"
                    ? "检测到同步或网络目录，请先了解私有过程数据边界"
                    : "过程文件和内部结果保存在当前运行位置的 .localbuddy 目录"}
              </span>
              <small>{storageDetailsExpanded ? "收起 ⌃" : "查看 ⌄"}</small>
            </button>
            {storageDetailsExpanded && (
              <div id="storage-disclosure-details" className="storage-disclosure-details">
                {workspace.length === 0 ? (
                  <p>LocalBuddy 不会在未选择运行位置时创建 Run 数据。</p>
                ) : (
                  <>
                    <p><strong>过程记录</strong><code title={workspaceReadiness.storage.runStoreRoot}>{workspaceReadiness.storage.runStoreRoot}</code></p>
                    <p><strong>内部结果</strong><code title={workspaceReadiness.storage.artifactLocation}>{workspaceReadiness.storage.artifactLocation}</code></p>
                    <p><strong>API Key / OAuth</strong><span>保存在操作系统凭据库，不写入上面的目录。</span></p>
                    <p><strong>本机权限</strong><span>macOS / Linux 新写目录限制为当前账号；Windows 继承所选位置的账号 ACL。</span></p>
                    <p><strong>当前版本</strong><span>不会自动迁移或删除旧 Run；最终结果仍从 Run 的产物列表打开。</span></p>
                    {workspaceReadiness.storage.warnings.map((warning) => (
                      <p className="storage-warning" key={warning}>
                        <strong>请确认</strong><span>{storageWarningLabel(warning)}</span>
                      </p>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          {selectedCapabilities.length > 0 && (
            <div className="selected-capabilities" aria-label="本次任务已添加的方法和连接">
              <span>本次会用</span>
              <div>
                {selectedCapabilities.map((capability) => (
                  <button
                    type="button"
                    key={`${capability.kind}:${capability.id}`}
                    title={`移除 ${capability.title}`}
                    onClick={() => capability.kind === "skill"
                      ? selectSkillForRun(capability.id, false)
                      : selectMcpForRun(capability.id, false)}
                  >
                    <i>{capability.kind === "skill" ? "方法" : "连接"}</i>
                    {capability.title}
                    <b aria-hidden="true">×</b>
                  </button>
                ))}
              </div>
              <small>会改变外部内容的动作仍会在执行前询问你</small>
            </div>
          )}
          {!selectedProviderCredential.available && (
            <div className="provider-required-banner">
              <span><strong>{providerLabel(providerId)} 尚未配置</strong>真实任务需要可用的 API Key，Guide 和模板仍可离线使用。</span>
              <button type="button" onClick={revealProviderSetup}>配置 {providerLabel(providerId)}</button>
            </div>
          )}
          <div className="composer-actions">
            <div className="composer-options">
              <button
                className="extensions-toggle"
                type="button"
                aria-expanded={extensionsOpen}
                onClick={() => setExtensionsOpen((current) => !current)}
              >
                方法与连接
                {extensionCount(skillIds, mcpServerIds, browserOrigins) > 0 && (
                  <span>{extensionCount(skillIds, mcpServerIds, browserOrigins)}</span>
                )}
              </button>
              <details className="composer-advanced-settings">
                <summary>高级设置</summary>
                <div>
                  <label className="provider-option" title="模型服务">
                    <span>使用哪个模型服务</span>
                    <select value={providerId} onChange={(event) => {
                      selectProvider(event.target.value as "deepseek" | "openai");
                    }} aria-label="模型服务">
                      <option value="deepseek">DeepSeek</option>
                      <option value="openai">OpenAI</option>
                    </select>
                  </label>
                  <button
                    className={`provider-status-button ${selectedProviderCredential.available ? "ready" : "missing"}`}
                    type="button"
                    onClick={revealProviderSetup}
                  >
                    {selectedProviderCredential.available ? "模型连接已就绪" : "配置模型连接"}
                  </button>
                  <label className="trust-option" title="操作确认方式">
                    <span>操作确认方式</span>
                    <select aria-label="操作确认方式" value={trustProfile} onChange={(event) => setTrustProfile(event.target.value as DesktopTrustProfile)}>
                      <option value="strict">每一步都确认</option>
                      <option value="balanced">重要操作再确认（推荐）</option>
                      <option value="automation">自动处理，不改外部内容</option>
                    </select>
                  </label>
                  <label className="mode-option" title="任务类型">
                    <span>任务类型</span>
                    <select aria-label="任务类型" value={mode} onChange={(event) => selectMode(event.target.value as DesktopRunMode)}>
                      <option value="research">整理资料</option>
                      <option value="code">修改代码</option>
                    </select>
                  </label>
                  <label className="concurrency-option" title="同时处理几步">
                    <span>同时处理</span>
                    <select aria-label="同时处理几步" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))}>
                      <option value={1}>1 个步骤</option>
                      <option value={2}>2 个步骤</option>
                      <option value={3}>3 个步骤（推荐）</option>
                    </select>
                  </label>
                </div>
              </details>
            </div>
            <div className="composer-buttons">
              <span className={`run-capacity ${activeRuns.length >= 2 ? "blocked" : ""}`} aria-live="polite">
                {activeRuns.length === 0
                  ? "当前没有任务在进行"
                  : activeRuns.length === 1
                  ? "已有 1 个任务在进行，还可以开始 1 个"
                  : "已有 2 个任务在进行，请先等待或停止一个"}
              </span>
              <button
                className="start-button"
                onClick={startRun}
                disabled={
                  goal.trim().length === 0
                  || workspace.length === 0
                  || activeRuns.length >= 2
                  || (allowBrowserActions && csvValues(browserOrigins).length === 0)
                  || !selectedProviderCredential.available
                }
              >
                生成计划 <span>→</span>
              </button>
            </div>
          </div>
        </section>}
      </main>

      <aside className="event-rail">
        <div className="event-header">
          <div>
            <span className="live-dot" />
            {guideVisible ? "下一步" : selectedRun ? "当前任务" : "开始任务"}
          </div>
          <span>{guideVisible ? "GUIDE" : selectedRun ? `${selectedRun.story.stages.length} 步` : "NEW"}</span>
        </div>
        <div className="event-list">
          {guideVisible ? (
            <GuideEventRail />
          ) : selectedRun ? (
            <RunStoryRail run={selectedRun} />
          ) : (
            <NewTaskRail providerReady={selectedProviderCredential.available} workspaceReady={workspace.length > 0} />
          )}
        </div>
        <div className="runtime-card">
          <span>{guideVisible ? "当前说明" : selectedRun ? "现在" : "准备情况"}</span>
          <strong>{guideVisible
            ? "第一次任务指引"
            : selectedRun
            ? runGuideHint(selectedRun).title
            : workspace.length === 0
            ? "还需选择保存位置"
            : selectedProviderCredential.available ? "可以生成计划" : "还需连接模型"}</strong>
          <p>
            {guideVisible
              ? "准备步骤全部在本机完成"
              : selectedRun
              ? runGuideHint(selectedRun).detail
              : "资料只会从你明确添加的位置读取"}<br />
            {guideVisible
              ? "只有生成计划和执行任务时，才会连接你选择的模型"
              : selectedRun
              ? "需要你操作时，主界面会出现明确按钮"
              : "生成计划和执行任务时才会连接模型"}
          </p>
          <div className="build-identity">
            <span>{update.build.channel.toUpperCase()}</span>
            <strong>v{update.build.version} · {shortBuildSha(update.build.sha)}{update.build.dirty ? "+dirty" : ""}</strong>
          </div>
          {update.configured && (
            <>
              <div className="update-actions">
                <small>{updateStatusLabel(update, updateNow)}</small>
                {update.status === "downloaded" ? (
                  <button
                    onClick={quitAndInstallUpdate}
                    disabled={updating}
                  >重启更新</button>
                ) : (
                  <button
                    onClick={checkForUpdates}
                    disabled={updating || update.status === "checking" || update.status === "available"}
                  >{update.status === "checking" ? "正在检查…" : update.status === "available" ? "后台下载中" : "检查更新"}</button>
                )}
              </div>
              {update.status === "available" && (
                <div className="update-download-progress" role="status" aria-live="polite">
                  <div className="update-progress-track" aria-label="更新正在后台下载">
                    <span />
                  </div>
                  <small>安装包较大，下载完成后这里会出现“重启更新”。</small>
                  <button type="button" onClick={openLatestRelease}>打开官方下载页</button>
                </div>
              )}
            </>
          )}
          {update.blockedReason && <small className="update-warning">{update.blockedReason}</small>}
          {update.error && <small className="update-warning">{update.error}</small>}
        </div>
      </aside>
    </div>
  );
}

function CapabilityPickerDialog({
  catalog,
  loading,
  error,
  mode,
  selectedSkillIds,
  selectedConnectionIds,
  browserOrigins,
  allowBrowserActions,
  onToggleSkill,
  onToggleConnection,
  onChangeBrowserOrigins,
  onChangeBrowserActions,
  onRefresh,
  onClose,
}: {
  catalog: WorkspaceExtensionCatalog;
  loading: boolean;
  error?: string;
  mode: DesktopRunMode;
  selectedSkillIds: readonly string[];
  selectedConnectionIds: readonly string[];
  browserOrigins: string;
  allowBrowserActions: boolean;
  onToggleSkill(id: string, selected: boolean): void;
  onToggleConnection(id: string, selected: boolean): void;
  onChangeBrowserOrigins(value: string): void;
  onChangeBrowserActions(value: boolean): void;
  onRefresh(): void;
  onClose(): void;
}) {
  const selectedCount = selectedSkillIds.length
    + selectedConnectionIds.length
    + (csvValues(browserOrigins).length > 0 ? 1 : 0);
  return (
    <div className="provider-settings-overlay capability-picker-overlay">
      <section className="capability-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="capability-picker-title">
        <header>
          <div>
            <span>按需添加</span>
            <h2 id="capability-picker-title">给这次任务添加方法或连接</h2>
            <p>普通任务可以直接开始。只有想固定做法，或要使用其他服务时，才需要在这里添加。</p>
          </div>
          <button className="provider-dialog-close" type="button" onClick={onClose} aria-label="关闭方法与连接">×</button>
        </header>

        <div className="capability-picker-safety" role="note">
          <strong>查看可以直接进行；需要改动时会再问你</strong>
          <p>LocalBuddy 可以读取连接返回的信息；如果要发送、创建、修改或删除内容，会在实际执行前单独询问你。</p>
        </div>

        <div className="capability-picker-body">
          <section className="capability-picker-section" aria-labelledby="method-picker-heading">
            <div className="capability-picker-section-heading">
              <div>
                <h3 id="method-picker-heading">按固定方法完成</h3>
                <p>适合需要稳定步骤、格式或检查标准的任务。</p>
              </div>
              <span>{catalog.skills.length} 个可用</span>
            </div>
            {catalog.skills.length === 0 && !loading ? (
              <div className="capability-picker-empty">
                <strong>当前没有额外方法</strong>
                <p>这不会影响普通任务；LocalBuddy 仍会先生成计划，再由你确认。</p>
              </div>
            ) : (
              <div className="capability-choice-list">
                {catalog.skills.map((skill) => {
                  const compatible = skillAppliesToMode(skill.appliesTo, mode);
                  const selected = selectedSkillIds.includes(skill.id);
                  return (
                    <article className={`capability-choice ${selected ? "selected" : ""} ${compatible ? "" : "disabled"}`} key={skill.id}>
                      <span className="capability-choice-icon">方</span>
                      <div>
                        <strong>{skill.title}</strong>
                        <p>{skill.description}</p>
                        {!compatible && <small>不适合当前的{mode === "research" ? "资料整理" : "代码"}任务</small>}
                      </div>
                      <button
                        type="button"
                        disabled={!compatible}
                        aria-pressed={selected}
                        onClick={() => onToggleSkill(skill.id, !selected)}
                      >{selected ? "已添加" : "添加"}</button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="capability-picker-section" aria-labelledby="connection-picker-heading">
            <div className="capability-picker-section-heading">
              <div>
                <h3 id="connection-picker-heading">使用其他服务或本机工具</h3>
                <p>例如资料库、业务系统或已经配置好的本机工具。</p>
              </div>
              <span>{catalog.mcpServers.length} 个可用</span>
            </div>
            {catalog.mcpServers.length === 0 && !loading ? (
              <div className="capability-picker-empty">
                <strong>当前没有可用连接</strong>
                <p>普通任务仍可继续；连接来源由熟悉当前运行位置的人在高级配置中提供。</p>
              </div>
            ) : (
              <div className="capability-choice-list">
                {catalog.mcpServers.map((server) => {
                  const selected = selectedConnectionIds.includes(server.id);
                  return (
                    <article className={`capability-choice ${selected ? "selected" : ""} ${server.supportedOnCurrentPlatform ? "" : "disabled"}`} key={server.id}>
                      <span className="capability-choice-icon connection">连</span>
                      <div>
                        <strong>{server.title}</strong>
                        <p>{server.description}</p>
                        <small>{server.supportedOnCurrentPlatform
                          ? connectionReadinessLabel(server.authentication)
                          : "当前系统暂时不能使用这个本机连接"}</small>
                      </div>
                      <button
                        type="button"
                        disabled={!server.supportedOnCurrentPlatform}
                        aria-pressed={selected}
                        onClick={() => onToggleConnection(server.id, !selected)}
                      >{selected ? "已添加" : "添加"}</button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <details className="capability-technical-details">
          <summary>高级：查看来源、网页访问和技术信息</summary>
          <div>
            <p>LocalBuddy 只检查当前运行位置的 <code>.localbuddy/skills</code> 与 <code>.localbuddy/mcp.json</code>，不会扫描其他文件夹，也不会自动连接发现的服务。</p>
            {catalog.skills.length > 0 && (
              <div className="capability-technical-list">
                <strong>方法来源（Skill）</strong>
                {catalog.skills.map((skill) => (
                  <span key={skill.id}><code>{skill.id}</code> · {skillModeLabel(skill.appliesTo)} · {skill.trust === "signed" ? `已签名 ${skill.release ?? ""}`.trim() : "当前运行位置提供"}</span>
                ))}
              </div>
            )}
            {catalog.mcpServers.length > 0 && (
              <div className="capability-technical-list">
                <strong>连接来源（MCP）</strong>
                {catalog.mcpServers.map((server) => (
                  <span key={server.id}>
                    <code>{server.id}</code> · {server.connectionLabel} · {mcpAuthenticationLabel(server.authentication)} · {server.networkAccess ? "会联网" : "默认不联网"}
                  </span>
                ))}
              </div>
            )}
            <div className="capability-browser-settings">
              <label>
                指定可以访问的网址来源
                <input value={browserOrigins} onChange={(event) => onChangeBrowserOrigins(event.target.value)} placeholder="https://example.com" />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={allowBrowserActions}
                  disabled={csvValues(browserOrigins).length === 0}
                  onChange={(event) => onChangeBrowserActions(event.target.checked)}
                />
                网页点击或填写时，也在实际执行前逐次询问
              </label>
            </div>
            {catalog.issues.length > 0 && (
              <div className="extension-catalog-issues" role="status">
                <strong>有些配置没有加载</strong>
                {catalog.issues.map((issue, index) => (
                  <p key={`${issue.kind}-${issue.id ?? index}`}>{issue.id ? `${issue.id}：` : ""}{issue.message}</p>
                ))}
              </div>
            )}
            {error && <div className="extension-catalog-issues" role="alert">无法检查能力来源：{error}</div>}
          </div>
        </details>

        <footer>
          <button type="button" className="capability-refresh" onClick={onRefresh} disabled={loading}>
            {loading ? "正在检查…" : "重新检查来源"}
          </button>
          <div>
            <span>{selectedCount === 0 ? "没有添加额外能力" : `已添加 ${selectedCount} 项`}</span>
            <button type="button" className="capability-done" onClick={onClose}>完成</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function BugReportDialog({
  preview,
  error,
  preparing,
  saving,
  opening,
  onPrepare,
  onSave,
  onOpen,
  onClose,
}: {
  preview?: DesktopPublicBugReportPreview;
  error?: string;
  preparing: boolean;
  saving: boolean;
  opening: boolean;
  onPrepare(): void;
  onSave(): void;
  onOpen(): void;
  onClose(): void;
}) {
  const duplicate = preview?.duplicateCheck;
  return (
    <div className="provider-settings-overlay bug-report-overlay">
      <section className="bug-report-dialog" role="dialog" aria-modal="true" aria-labelledby="bug-report-title">
        <header>
          <div>
            <span>PUBLIC BUG REPORT</span>
            <h2 id="bug-report-title">报告 LocalBuddy 问题</h2>
            <p>LocalBuddy 已根据当前 Run 自动生成公开安全 Trace；检查后只需同意一次。</p>
          </div>
          <button className="provider-dialog-close" type="button" onClick={onClose} aria-label="关闭问题报告">×</button>
        </header>

        <div className="bug-report-warning" role="note">
          <strong>GitHub Issue 是公开内容</strong>
          <p>预览不读取提示词、业务正文、资料或工件内容、本地路径、凭据、原始错误和事件详情。请确认下面的公开摘要符合你的预期。</p>
        </div>

        {!preview && (
          <div className="bug-report-prepare-row" role={error ? "alert" : "status"}>
            <p>{preparing
              ? "正在生成脱敏摘要，并用匿名签名检查公开 Issue 是否已有同类问题…"
              : "暂时无法生成公开预览；没有任何 Run 内容被发送。"}</p>
            {!preparing && (
              <button type="button" onClick={onPrepare} disabled={saving || opening}>重试生成</button>
            )}
          </div>
        )}

        {preview && (
          <div className="bug-report-preview">
            <div className="bug-report-preview-heading">
              <div>
                <strong>将打开：{preview.destination}</strong>
                <span>{preview.title}</span>
              </div>
              <span className={`duplicate-status ${duplicate?.status ?? "unavailable"}`}>
                {duplicate?.status === "found"
                  ? `发现可能重复的 Issue #${duplicate.issueNumber}`
                  : duplicate?.status === "none"
                  ? "未发现同签名的公开 Issue"
                  : "暂时无法检查重复，不影响本地保存"}
              </span>
            </div>
            <pre>{preview.previewMarkdown}</pre>
            <div className="bug-report-redactions">
              <strong>隐私边界</strong>
              <span>{preview.redactions.length === 0 ? "未读取自由文本，因此无需逐字遮盖；仍请核对自动摘要" : preview.redactions.join("、")}</span>
            </div>
          </div>
        )}

        {error && <div className="provider-settings-error" role="alert">{error}</div>}

        <footer>
          <p>{duplicate?.status === "found"
            ? "继续后只会打开已有 Issue，方便你核对和补充；LocalBuddy 不会自动留言。"
            : "同意后会打开预填的公开表单；LocalBuddy 不保存 GitHub Token，也不会替你点击最终提交。"}</p>
          <div>
            <button type="button" className="bug-report-save" onClick={onSave} disabled={!preview || preparing || saving || opening}>
              {saving ? "保存中…" : "保存本地报告"}
            </button>
            <button type="button" className="bug-report-open" onClick={onOpen} disabled={!preview || preparing || saving || opening}>
              {opening ? "正在打开…" : duplicate?.status === "found" ? "同意并查看已有 Issue" : "同意并在 GitHub 继续提交"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ProviderSettingsDialog({
  providerId,
  availability,
  model,
  baseUrl,
  apiKey,
  status,
  error,
  saving,
  deleting,
  verifying,
  onSelectProvider,
  onChangeModel,
  onChangeBaseUrl,
  onChangeApiKey,
  onSave,
  onDelete,
  onVerify,
  onOpenProviderSetup,
  onClose,
}: {
  providerId: "deepseek" | "openai";
  availability: DesktopProviderAvailability;
  model: string;
  baseUrl: string;
  apiKey: string;
  status?: string;
  error?: string;
  saving: boolean;
  deleting: boolean;
  verifying: boolean;
  onSelectProvider(providerId: "deepseek" | "openai"): void;
  onChangeModel(value: string): void;
  onChangeBaseUrl(value: string): void;
  onChangeApiKey(value: string): void;
  onSave(): void;
  onDelete(): void;
  onVerify(): void;
  onOpenProviderSetup(): void;
  onClose(): void;
}) {
  const credential = availability[providerId];
  return (
    <div className="provider-settings-overlay">
      <section className="provider-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-settings-title">
        <header>
          <div>
            <span>模型连接</span>
            <h2 id="provider-settings-title">模型设置</h2>
            <p>LocalBuddy 需要连接一个大模型服务，才能理解任务和生成结果。第一次使用建议选择 DeepSeek。</p>
          </div>
          <button className="provider-dialog-close" type="button" onClick={onClose} aria-label="关闭模型设置">×</button>
        </header>

        <div className="provider-choice-grid">
          {(["deepseek", "openai"] as const).map((id) => {
            const item = availability[id];
            return (
              <button
                className={id === providerId ? "selected" : ""}
                type="button"
                key={id}
                onClick={() => onSelectProvider(id)}
              >
                <span className={item.available ? "ready" : "missing"}>{item.available ? "✓" : "!"}</span>
                <div>
                  <strong>{providerLabel(id)}</strong>
                  <small>{providerCredentialLongLabel(item)}</small>
                </div>
              </button>
            );
          })}
        </div>

        <div className={`provider-credential-summary ${credential.available ? "ready" : "missing"}`}>
          <span>{credential.available ? "✓" : "!"}</span>
          <div>
            <strong>{providerLabel(providerId)} · {modelConnectionLabel(credential)}</strong>
            <p>{credential.source === "environment"
              ? "当前进程优先使用环境变量。你仍可保存一份到系统安全存储，但在环境变量移除前不会生效。"
              : credential.source === "system"
              ? "API Key 已保存在操作系统凭据库。LocalBuddy 只显示“已连接”，不会在界面中回显。"
              : "API Key 是模型服务商提供的调用凭证，不是 LocalBuddy 账号密码。保存后只显示“已连接”，不会回显密钥。"}</p>
          </div>
        </div>

        {!credential.available && (
          <section className="provider-getting-started" aria-labelledby="provider-getting-started-title">
            <div>
              <strong id="provider-getting-started-title">还没有 API Key？按这三步完成</strong>
              <ol>
                <li>打开 {providerLabel(providerId)} 官方平台并登录或注册。</li>
                <li>按官方页面创建 API Key。</li>
                <li>回到这里粘贴并安全保存，再点击“验证连接”。</li>
              </ol>
              <small>模型服务商可能按用量收费；LocalBuddy 不销售模型额度，也不会代扣费用。账户要求和价格以官方页面为准。</small>
            </div>
            <button type="button" onClick={onOpenProviderSetup}>打开 {providerLabel(providerId)} 官方平台</button>
          </section>
        )}

        <div className="provider-credential-form">
          <label>
            {credential.source === "system" ? "替换 API Key（模型服务商提供）" : "API Key（模型服务商提供）"}
            <span className="provider-key-row">
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => onChangeApiKey(event.target.value)}
                placeholder="粘贴后只保存到操作系统凭据库"
              />
              <button type="button" onClick={onSave} disabled={saving || deleting || verifying || apiKey.trim().length === 0}>
                {saving ? "保存中…" : credential.source === "system" ? "替换并保存" : credential.source === "environment" ? "另存到本机" : "安全保存到本机"}
              </button>
            </span>
            <small className="provider-storage-note">保存位置：macOS 钥匙串、Windows 凭据管理器或 Linux 系统密钥环。</small>
          </label>
          <button className="verify-provider-button" type="button" onClick={onVerify} disabled={!credential.available || saving || deleting || verifying}>
            {verifying ? "验证中…" : "验证连接"}
          </button>
          {credential.source === "system" && (
            <button className="delete-provider-button" type="button" onClick={onDelete} disabled={saving || deleting || verifying}>
              {deleting ? "等待确认…" : "删除系统凭据"}
            </button>
          )}
        </div>

        {status && <div className="provider-settings-status" aria-live="polite">{status}</div>}
        {error && <div className="provider-settings-error" role="alert">{error}</div>}

        <details className="provider-advanced-settings">
          <summary>高级设置（第一次使用不用改）</summary>
          <div>
            <label>
              Model（可选）
              <input value={model} onChange={(event) => onChangeModel(event.target.value)} placeholder="使用 Provider 默认模型" />
            </label>
            <label>
              Base URL（可选）
              <input value={baseUrl} onChange={(event) => onChangeBaseUrl(event.target.value)} placeholder="使用官方端点；仅支持 HTTPS/loopback" />
            </label>
          </div>
        </details>

        <footer>
          <p>保存不会联网。点击“验证连接”才会把 Key 发给上方所选模型服务并请求模型列表；点击“生成执行计划”或执行任务时，目标和你明确选择的资料才会发给该服务。</p>
          <button type="button" onClick={onClose}>完成</button>
        </footer>
      </section>
    </div>
  );
}

function FirstRunGuide({
  workspace,
  providerId,
  providerAvailability,
  creatingTutorial,
  tutorialPrepared,
  sourceKind,
  status,
  onCreateTutorial,
  onChooseOwnMeetingRecord,
  onConfigureProvider,
  onStart,
}: {
  workspace: string;
  providerId: "deepseek" | "openai";
  providerAvailability: DesktopProviderAvailability;
  creatingTutorial: boolean;
  tutorialPrepared: boolean;
  sourceKind: "sample" | "own";
  status?: string;
  onCreateTutorial(): void;
  onChooseOwnMeetingRecord(): void;
  onConfigureProvider(): void;
  onStart(): void;
}) {
  const providerCredential = providerAvailability[providerId];
  const providerReady = providerCredential.available;
  const primaryAction = tutorialPrepared
    ? providerReady
      ? onStart
      : onConfigureProvider
    : onCreateTutorial;
  const primaryLabel = creatingTutorial
    ? "正在准备…"
    : !tutorialPrepared
    ? "使用示例会议记录"
    : !providerReady
    ? "连接模型"
    : "生成执行计划";
  return (
    <div className="guide-state">
      <section className="guide-dialogue">
        <span className="guide-avatar"><img src={localBuddyIcon} alt="" /></span>
        <div className="guide-message">
          <span>第一次任务</span>
          <h2>把一份会议记录，整理成可以继续修改的 Word 纪要。</h2>
          <p>LocalBuddy 不会自动扫描电脑。你可以使用一份完全虚构的示例，也可以明确选择自己的会议记录；原文件不会被修改。</p>
        </div>
      </section>

      {status && <div className="guide-status">{status}</div>}

      <section className="first-task-card">
        <div className="first-task-heading">
          <div>
            <span>第一次只做这一个任务</span>
            <h3>整理会议记录，得到一份可编辑的 Word 纪要</h3>
          </div>
          <i>推荐</i>
        </div>
        <div className="first-task-summary">
          <div><span>会读取</span><strong>{tutorialPrepared && sourceKind === "own" ? "你选择的 1 份会议记录" : "1 份虚构会议记录"}</strong></div>
          <div><span>会得到</span><strong>会议纪要.docx</strong></div>
          <div><span>不会做</span><strong>扫描电脑或修改原文件</strong></div>
        </div>
        <ol className="first-task-steps">
          <li className={tutorialPrepared ? "complete" : "current"}>
            <span>{tutorialPrepared ? "✓" : "1"}</span>
            <div>
              <strong>选择会议记录</strong>
              <small>{tutorialPrepared
                ? sourceKind === "own" ? "已选择你的一份会议记录" : `示例已准备在 ${shortPath(workspace)}`
                : "可以先用虚构示例，也可以选择自己的 TXT、Markdown 或 DOCX 文件"}</small>
            </div>
          </li>
          <li className={providerReady ? "complete" : tutorialPrepared ? "current" : "waiting"}>
            <span>{providerReady ? "✓" : "2"}</span>
            <div><strong>连接模型</strong><small>{providerReady ? `${providerLabel(providerId)} 已连接；密钥不会回显` : "需要模型服务商提供的 API Key 才能生成内容"}</small></div>
          </li>
          <li className={tutorialPrepared && providerReady ? "current" : "waiting"}>
            <span>3</span>
            <div><strong>生成并确认计划</strong><small>确认前不会处理资料；完成后会直接显示结果文件</small></div>
          </li>
        </ol>
        <div className="first-task-action">
          <div className="first-task-buttons">
            <button className="first-task-primary" onClick={primaryAction} disabled={creatingTutorial}>{primaryLabel}<span>→</span></button>
            {!tutorialPrepared && (
              <button className="first-task-secondary" onClick={onChooseOwnMeetingRecord} disabled={creatingTutorial}>使用我自己的会议记录</button>
            )}
          </div>
          <p>{!tutorialPrepared
            ? "使用示例只会在本机创建一份虚构记录；选择自己的文件后，也要等你确认计划才会读取。"
            : !providerReady
            ? "保存 API Key 本身不联网；你可以在模型设置中查看何时会联网。"
            : "点击后会联网生成计划；你确认计划后，任务才会真正执行。"}</p>
        </div>
      </section>

      <details className="guide-more">
        <summary>以后还可以做什么</summary>
        <p>完成第一次任务后，还可以整理更多资料、修改已有 Word 文档或检查表格内容。只有经过当前版本验证的格式才会显示为可交付结果。</p>
      </details>
    </div>
  );
}

function PlanReviewPanel({
  run,
  capabilityLabels,
  resolving,
  onResolve,
}: {
  run: DesktopRunView;
  capabilityLabels: readonly string[];
  resolving: boolean;
  onResolve(decision: "approve" | "reject"): void;
}) {
  const review = run.planReview;
  if (review === undefined) return null;
  return (
    <section className={`panel plan-review-panel ${review.status}`}>
      <div className="panel-heading plan-review-heading">
        <div>
          <span className="section-index">00</span>
          <div>
            <h2>确认执行计划</h2>
            <p>
              {review.status === "pending"
                ? "这是 LocalBuddy 准备执行的步骤。确认前不会开始处理资料。"
                : `这份计划已经${planReviewStatusLabel(review.status)}，决定和计划都会保留在本地审计记录中。`}
            </p>
          </div>
        </div>
        <span className={`plan-review-status ${review.status}`}>{planReviewStatusLabel(review.status)}</span>
      </div>

      <div className="plan-review-contract">
        <div className="plan-review-outcome">
          <span>要交付的结果</span>
          <strong>{review.goalContract.outcome}</strong>
        </div>
        <div>
          <span>约束</span>
          <ul>
            {(review.goalContract.constraints.length > 0
              ? review.goalContract.constraints
              : ["没有额外约束"]
            ).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <div>
          <span>完成标准</span>
          <ul>
            {(review.goalContract.verificationCriteria.length > 0
              ? review.goalContract.verificationCriteria
              : ["沿用旧请求：没有单独填写完成标准"]
            ).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </div>

      <div className="plan-review-scope">
        <span>处理方式：{review.plan.mode === "code" ? "隔离修改代码" : "整理资料"}</span>
        <span>将读取资料：{review.scope.sourceCount} 项</span>
        <span>安全方式：{trustProfileLabel(review.scope.trustProfile)}</span>
        <span>额外工具：{review.scope.extensionCount} 项</span>
      </div>

      {capabilityLabels.length > 0 && (
        <div className="plan-review-capabilities">
          <strong>这次会使用</strong>
          <span>{capabilityLabels.join(" · ")}</span>
          <small>连接可以提供资料或提出操作；会改变外部内容的动作仍需逐次批准。</small>
        </div>
      )}

      <div className="plan-review-tasks">
        {review.plan.tasks.map((task, index) => (
          <article key={task.id}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{task.title}</strong>
              <p>{task.instructions}</p>
              {task.ownedPaths.length > 0 && <small>允许改动：{task.ownedPaths.join(" · ")}</small>}
            </div>
          </article>
        ))}
        <article className="plan-review-integration">
          <span>✓</span>
          <div>
            <strong>汇总并检查最终结果 · {review.plan.integration.fileName}</strong>
            <p>{review.plan.integration.instructions}</p>
            {review.plan.integration.verificationCommands.length > 0 && (
              <small>检查：{review.plan.integration.verificationCommands.join(" · ")}</small>
            )}
          </div>
        </article>
      </div>

      <div className="plan-review-footer">
        <small title={review.approvalSha256}>计划校验码 {review.approvalSha256.slice(0, 16)}</small>
        {review.status === "pending" && run.status === "awaiting_plan_approval" && (
          <div>
            <button
              className="reject-plan-button"
              disabled={resolving}
              onClick={() => onResolve("reject")}
            >不执行，结束任务</button>
            <button
              className="approve-plan-button"
              disabled={resolving}
              onClick={() => onResolve("approve")}
            >{resolving ? "处理中…" : "确认计划并开始"}</button>
          </div>
        )}
        {review.status === "pending" && run.status !== "awaiting_plan_approval" && (
          <small>正在恢复确认步骤；出现“需要你确认计划”后才可以决定。</small>
        )}
      </div>
    </section>
  );
}

function RunStoryPanel({ run, now }: { run: DesktopRunView; now: number }) {
  const hint = runGuideHint(run);
  return (
    <section className={`run-story-panel ${run.status}`}>
      <header>
        <div>
          <span>当前进展</span>
          <h2>{hint.title}</h2>
          <p>{hint.detail}</p>
        </div>
        <StatusPill status={run.status} />
      </header>
      <div className="run-story-stages" aria-label="任务步骤">
        {run.story.stages.map((stage, index) => (
          <div className={`run-story-stage ${stage.status}`} key={stage.id}>
            <span>{stage.status === "succeeded" ? "✓" : stage.status === "failed" ? "!" : index + 1}</span>
            <div>
              <strong>{stage.label}</strong>
              <small>
                {stage.durationMs !== undefined
                  ? stage.durationMs > 0
                    ? `${storyStageStatusLabel(stage.status)} · ${formatDuration(stage.durationMs)}`
                    : storyStageStatusLabel(stage.status)
                  : storyStageStatusLabel(stage.status)}
              </small>
            </div>
          </div>
        ))}
      </div>
      <details className="run-process-details">
        <summary>
          <span>查看详细过程</span>
          <small>实际时间线、并行步骤和运行数据</small>
        </summary>
        <div className="run-process-body">
          <div className="run-process-explanation">
            <strong>这条时间线来自真实运行记录</strong>
            <p>横向位置代表发生时间；重叠的条带表示同时进行。这里只显示脱敏后的步骤名称，不展示你的 Prompt、密钥或文件内容。</p>
          </div>
          <RunTimeline run={run} now={now} />
          <div className="run-process-task-list">
            {run.tasks.map((task, index) => (
              <article className={task.status} key={task.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{userTaskTitle(task, index)}</strong>
                  <small>{statusLabel(task.status)}</small>
                  {task.error && <p>{toMessage(task.error)}</p>}
                </div>
              </article>
            ))}
          </div>
          <RunSummaryStrip run={run} />
          <details className="raw-event-details">
            <summary>查看最近的技术事件（{run.eventCount} 条）</summary>
            <div className="raw-event-list"><RunEventItems run={run} /></div>
          </details>
        </div>
      </details>
    </section>
  );
}

function RunTimeline({ run, now }: { run: DesktopRunView; now: number }) {
  if (run.story.timeline.length === 0) {
    return <div className="run-timeline-empty">执行开始后，真实时间线会显示在这里。</div>;
  }
  const start = Math.min(...run.story.timeline.map((span) => Date.parse(span.startedAt)).filter(Number.isFinite));
  const completed = run.story.timeline
    .map((span) => span.completedAt === undefined ? undefined : Date.parse(span.completedAt))
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const end = Math.max(start + 1, ...completed, ACTIVE_STATUSES.has(run.status) ? now : start + 1);
  const duration = end - start;
  return (
    <div className="run-timeline" aria-label="真实运行时间线">
      <div className="run-timeline-axis">
        <span>开始</span>
        <span>{formatDuration(duration)}</span>
      </div>
      {run.story.timeline.map((span) => {
        const spanStart = Date.parse(span.startedAt);
        const spanEnd = span.completedAt === undefined ? end : Date.parse(span.completedAt);
        const left = Math.max(0, Math.min(100, ((spanStart - start) / duration) * 100));
        const width = Math.max(1.5, Math.min(100 - left, ((spanEnd - spanStart) / duration) * 100));
        return (
          <div className={`run-timeline-row ${span.lane}`} key={span.id}>
            <span>{timelineLaneLabel(span.lane)}</span>
            <div className="run-timeline-track">
              <i
                className={span.status}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${span.label} · ${span.durationMs === undefined ? "进行中" : formatDuration(span.durationMs)}`}
              />
            </div>
            <strong>{span.label}</strong>
            <small>{span.durationMs === undefined ? "进行中" : formatDuration(span.durationMs)}</small>
          </div>
        );
      })}
      {run.story.omittedTimelineSpans > 0 && (
        <p className="run-timeline-omitted">为保持界面流畅，另有 {run.story.omittedTimelineSpans} 条较早的过程记录未在图中展开。</p>
      )}
    </div>
  );
}

function RunStoryRail({ run }: { run: DesktopRunView }) {
  return (
    <div className="run-story-rail">
      {run.story.stages.map((stage, index) => (
        <div className={`tutorial-run-step ${storyRailState(stage.status)}`} key={stage.id}>
          <span>{stage.status === "succeeded" ? "✓" : stage.status === "failed" ? "!" : index + 1}</span>
          <div>
            <strong>{stage.label}</strong>
            <p>{stage.durationMs === undefined || stage.durationMs === 0
              ? storyStageStatusLabel(stage.status)
              : `${storyStageStatusLabel(stage.status)} · ${formatDuration(stage.durationMs)}`}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function NewTaskRail({ providerReady, workspaceReady }: { providerReady: boolean; workspaceReady: boolean }) {
  return (
    <div className="run-story-rail">
      <TutorialRunStep number="1" label="描述想要的结果" detail="用自己的话说明，不需要了解 Agent" state="current" />
      <TutorialRunStep number="2" label="确认执行步骤" detail="确认前不会处理资料" state="waiting" />
      <TutorialRunStep number="3" label="打开并检查结果" detail="完成后会出现在主界面" state="waiting" />
      {(!providerReady || !workspaceReady) && (
        <p className="new-task-readiness">
          {!workspaceReady ? "还需要选择结果保存位置。" : "还需要连接模型；API Key 由操作系统保管。"}
        </p>
      )}
    </div>
  );
}

function GuideEventRail() {
  return (
    <div className="guide-event-rail">
      <div className="event-item"><span className="event-icon">1</span><div><strong>选择会议记录</strong><p>示例或你明确选择的文件</p><small>不会扫描电脑</small></div></div>
      <div className="event-item"><span className="event-icon model">2</span><div><strong>连接模型</strong><p>密钥保存在操作系统凭据库</p><small>你来决定</small></div></div>
      <div className="event-item"><span className="event-icon artifact">3</span><div><strong>确认计划并查看结果</strong><p>确认前不会处理资料</p><small>结果可打开</small></div></div>
    </div>
  );
}

function TutorialRunStep({
  number,
  label,
  detail,
  state,
}: {
  number: string;
  label: string;
  detail: string;
  state: "current" | "complete" | "waiting" | "failed";
}) {
  return (
    <div className={`tutorial-run-step ${state}`}>
      <span>{state === "complete" ? "✓" : state === "failed" ? "!" : number}</span>
      <div><strong>{label}</strong><p>{detail}</p></div>
    </div>
  );
}

function RunEventItems({ run }: { run: DesktopRunView }) {
  return <>
    {run.recentEvents.toReversed().map((event) => (
      <div className="event-item" key={event.sequence}>
        <span className={`event-icon ${event.type.split(".")[0]}`}>{eventGlyph(event.type)}</span>
        <div>
          <strong>{eventLabel(event.type)}</strong>
          <p>{event.detail === undefined
            ? event.taskId ?? event.agentId ?? "runtime"
            : toMessage(event.detail)}</p>
          <small>#{event.sequence} · {formatClock(event.timestamp)}</small>
        </div>
      </div>
    ))}
  </>;
}

function runGuideHint(run: DesktopRunView): { title: string; detail: string } {
  if (run.status === "awaiting_plan_approval") {
    return { title: "需要你确认计划", detail: "确认前不会处理资料。请核对目标、将读取的资料和完成标准；不合适可以结束任务。" };
  }
  if (run.pendingApprovals.length > 0) {
    return { title: "需要你做一个决定", detail: "这里的批准只对当前这一次操作生效；不确定时可以拒绝。" };
  }
  if (run.integration?.status === "awaiting_approval") {
    return { title: "主工作区还没有被修改", detail: "先校验并查看完整 Diff，再决定只写回、写回并提交，或者拒绝。" };
  }
  if (run.status === "starting" || run.status === "planning") {
    return { title: "正在准备执行计划", detail: "暂时不需要操作。计划准备好后，LocalBuddy 会请你确认再开始处理资料。" };
  }
  if (run.status === "running") {
    return { title: "正在处理任务", detail: "暂时不需要操作；需要决定时会明确提醒，完成后的文件会出现在“结果文件”。" };
  }
  if (run.status === "succeeded") {
    return { title: "任务已完成", detail: "点击上方结果提示或下方“结果文件”即可查看，也可以用系统默认应用打开。" };
  }
  if (run.status === "failed" || run.status === "interrupted") {
    const failure = explainRunFailure(run);
    return {
      title: "任务没有完成",
      detail: failure.checkProvider
        ? "先按本页“检查模型连接”修正原因；验证通过后再重新开始，避免重复失败。"
        : "先按本页说明处理原因，再选择安全继续、从头开始或报告问题。",
    };
  }
  return { title: "任务状态已经记录", detail: "目标、决定和结果都属于当前运行位置；历史不会因重新开始而被改写。" };
}

function csvValues(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function updateCsvSelection(value: string, id: string, selected: boolean): string {
  const next = new Set(csvValues(value));
  if (selected) next.add(id);
  else next.delete(id);
  return [...next].join(",");
}

function skillAppliesToMode(appliesTo: "research" | "code" | "both", mode: DesktopRunMode): boolean {
  return appliesTo === "both" || appliesTo === mode;
}

function skillModeLabel(appliesTo: "research" | "code" | "both"): string {
  return appliesTo === "research" ? "整理资料任务" : appliesTo === "code" ? "代码任务" : "全部任务";
}

function mcpAuthenticationLabel(authentication: "none" | "environment" | "oauth"): string {
  return authentication === "oauth"
    ? "首次使用时网页登录"
    : authentication === "environment"
    ? "凭据由本机环境提供"
    : "无需额外登录";
}

function connectionReadinessLabel(authentication: "none" | "environment" | "oauth"): string {
  return authentication === "oauth"
    ? "首次使用时会请你登录"
    : authentication === "environment"
    ? "使用时检查本机凭据"
    : "可以直接使用";
}

function humanizeCapabilityId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.length === 0 ? part : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function runCapabilityLabels(
  run: DesktopRunView,
  catalog: WorkspaceExtensionCatalog,
): string[] {
  if (run.extensions === undefined) return [];
  return [
    ...run.extensions.skillIds.map((id) => catalog.skills.find((entry) => entry.id === id)?.title ?? humanizeCapabilityId(id)),
    ...run.extensions.mcpServerIds.map((id) => catalog.mcpServers.find((entry) => entry.id === id)?.title ?? humanizeCapabilityId(id)),
    ...(run.extensions.browserOrigins.length > 0 ? ["指定网页来源"] : []),
  ];
}

function lineValues(value: string): string[] {
  return [...new Set(value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean))];
}

function extensionCount(skills: string, servers: string, origins: string): number {
  return csvValues(skills).length + csvValues(servers).length + (csvValues(origins).length > 0 ? 1 : 0);
}

function providerLabel(id: string): string {
  return id === "openai" ? "OpenAI" : id === "deepseek" ? "DeepSeek" : "Provider";
}

function preferredProviderId(availability: DesktopProviderAvailability): "deepseek" | "openai" {
  if (availability.deepseek.available) return "deepseek";
  if (availability.openai.available) return "openai";
  return "deepseek";
}

function shortBuildSha(sha: string): string {
  return sha === "unknown" ? sha : sha.slice(0, 8);
}

function updateStatusLabel(update: DesktopUpdateView, now = Date.now()): string {
  switch (update.status) {
    case "ready": return "可手动检查当前频道";
    case "checking": return "正在检查更新";
    case "available": return `正在后台下载 · 已等待 ${formatUpdateElapsed(update.downloadStartedAt, now)}`;
    case "not_available": return "当前已经是最新版本";
    case "downloaded": return update.releaseName === undefined
      ? "新版本已验证并下载"
      : `${update.releaseName} 已下载`;
    case "installing": return "正在交给 Squirrel 更新";
    case "error": return "更新检查失败";
    default: return "此构建未配置自动更新";
  }
}

function formatUpdateElapsed(startedAt: string | undefined, now: number): string {
  if (startedAt === undefined) return "片刻";
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started) || now <= started) return "片刻";
  const totalSeconds = Math.floor((now - started) / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds} 秒` : `${minutes} 分 ${seconds} 秒`;
}

function modelConnectionLabel(status: DesktopProviderCredentialStatus): string {
  return status.available ? "已连接" : "未连接";
}

function providerCredentialLongLabel(status: DesktopProviderCredentialStatus): string {
  return status.source === "environment"
    ? "由当前进程环境变量提供"
    : status.source === "system"
    ? "系统安全存储中可用"
    : "尚未保存 API Key";
}

function SummaryMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="summary-metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function RunSummaryStrip({ run }: { run: DesktopRunView }) {
  return (
    <section className="summary-strip">
      <SummaryMetric label="任务" value={String(run.tasks.length)} detail="执行步骤" />
      <SummaryMetric
        label="已完成"
        value={String(run.tasks.filter((task) => task.status === "succeeded").length)}
        detail="已完成步骤"
      />
      <SummaryMetric label="耗时" value={formatDuration(run.metrics.durationMs)} detail="可核对时间线" />
      <SummaryMetric label="模型调用" value={String(run.metrics.modelCalls)} detail="已完成请求" />
      <SummaryMetric label="Tokens" value={formatCount(run.metrics.totalTokens)} detail="模型返回" />
      <SummaryMetric
        label="失败 / 闸门"
        value={`${run.metrics.modelFailures + run.metrics.toolFailures} / ${run.metrics.artifactGateRetries}`}
        detail={run.metrics.failureStage === undefined ? "调用 / 结果检查" : failureStageLabel(run.metrics.failureStage)}
      />
    </section>
  );
}

function StatusPill({ status }: { status: DesktopRunStatus }) {
  return <span className={`status-pill ${status}`}><i />{statusLabel(status)}</span>;
}

function upsertRun(runs: readonly DesktopRunView[], updated: DesktopRunView) {
  const next = [updated, ...runs.filter((run) => run.runId !== updated.runId)];
  return next.toSorted((left, right) => (right.startedAt ?? "").localeCompare(left.startedAt ?? ""));
}

function promoteRecentWorkspace(current: readonly string[], workspace: string): string[] {
  return [workspace, ...current.filter((candidate) => candidate !== workspace)].slice(0, 5);
}

function friendlyRunName(run: DesktopRunView) {
  const meaningfulTask = run.tasks.find((task) => task.id !== "integrate");
  const title = meaningfulTask?.title ?? (run.status === "failed" ? "未完成的任务" : "正在准备任务");
  return run.artifactRevision === undefined ? title : `V${run.artifactRevision.revision} · ${title}`;
}

function userTaskTitle(task: DesktopRunView["tasks"][number], index: number) {
  if (task.id === "integrate" || task.agentId === "integrator") return "汇总并检查最终结果";
  if (/^integrate worker results$/iu.test(task.title)) return "汇总并检查最终结果";
  return task.title.trim().length > 0 ? task.title : `处理资料第 ${index + 1} 步`;
}

function storyStageStatusLabel(status: DesktopRunView["story"]["stages"][number]["status"]): string {
  return ({
    queued: "尚未开始",
    running: "正在进行",
    waiting: "需要你确认",
    succeeded: "已经完成",
    failed: "没有完成",
    interrupted: "意外中断",
  } as const)[status];
}

function storyRailState(status: DesktopRunView["story"]["stages"][number]["status"]): "current" | "complete" | "waiting" | "failed" {
  if (status === "succeeded") return "complete";
  if (status === "failed" || status === "interrupted") return "failed";
  if (status === "running" || status === "waiting") return "current";
  return "waiting";
}

function timelineLaneLabel(lane: DesktopRunView["story"]["timeline"][number]["lane"]): string {
  return ({ task: "步骤", model: "思考", tool: "工具", approval: "确认", review: "检查" } as const)[lane];
}

function artifactBadge(fileName: string) {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".docx") ? "DOCX" : lower.endsWith(".patch") ? "DIFF" : lower.endsWith(".json") ? "JSON" : "MD";
}

function integrationStatusLabel(status: string) {
  return ({
    preflighting: "组合预检中",
    preflight_failed: "预检失败",
    awaiting_approval: "等待人工批准",
    applying: "写回中",
    applied: "已写回 · 未提交",
    committed: "已提交",
    reverted: "已撤销",
    revert_committed: "已创建反向提交",
    failed: "集成失败",
    recovery_required: "需要人工恢复",
  } as Record<string, string>)[status] ?? status;
}

function shortPath(path: string) {
  if (path.length < 28) return path;
  const parts = path.split("/").filter(Boolean);
  return `…/${parts.slice(-2).join("/")}`;
}

function joinLocalPath(root: string, fileName: string) {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]$/u, "")}${separator}${fileName}`;
}

function isSupportedFirstRunMeetingRecord(path: string): boolean {
  return /\.(?:txt|md|docx)$/iu.test(path);
}

function statusLabel(status: string) {
  return ({
    starting: "正在开始", planning: "正在准备计划", awaiting_plan_approval: "需要你确认计划", queued: "等待开始", running: "正在处理",
    succeeded: "已完成", failed: "失败", blocked: "已阻塞", cancelling: "停止中", cancelled: "已取消", interrupted: "已中断",
  } as Record<string, string>)[status] ?? status;
}

function eventLabel(type: string) {
  const [owner, action] = type.split(".");
  const ownerLabels: Record<string, string> = { run: "运行", plan: "规划", task: "任务", model: "模型", tool: "工具", approval: "审批", artifact: "产物", workspace: "隔离区", integration: "集成", checkpoint: "检查点" };
  const actionLabels: Record<string, string> = { started: "开始", resumed: "恢复执行", queued: "排队", requested: "请求", review_requested: "等待确认", review_completed: "审核结论", review_failed: "审核失败", resolved: "已决策", approved: "获准", rejected: "被拒绝", completed: "完成", succeeded: "成功", failed: "失败", blocked: "阻塞", created: "生成", revision_linked: "版本关联", restored: "状态恢复", resume_blocked: "恢复阻断", reused: "结果复用", denied: "拒绝", cancelled: "取消", interrupted: "意外中断", restarted: "已重放", removed: "已清理", diff_captured: "补丁已捕获", preflight_started: "组合预检", preflight_failed: "预检失败", awaiting_approval: "等待批准", applying: "写回中", applied: "已写回", committed: "已提交", reverted: "已撤销", revert_committed: "反向提交完成", revert_failed: "反向提交失败", recovery_required: "需要恢复" };
  if (owner === "integration" && action === "approved") return "集成 · 人工批准";
  return `${ownerLabels[owner ?? ""] ?? owner} · ${actionLabels[action ?? ""] ?? action}`;
}

function artifactReviewLabel(review: DesktopRunView["artifactReview"]) {
  if (review === undefined) return "结果写入受安全检查保护";
  if (review.status === "accepted") {
    return `独立审核通过 · ${review.attempts} 次${review.revisionRequests > 0 ? ` · 退回 ${review.revisionRequests} 次` : ""}`;
  }
  if (review.status === "revision_requested") {
    return `独立审核退回 · ${review.findingCount} 项`;
  }
  if (review.status === "failed") return "独立审核未形成结论";
  return `独立审核中 · 第 ${review.attempts} 次`;
}

function eventGlyph(type: string) {
  if (type.startsWith("model.")) return "AI";
  if (type.startsWith("tool.")) return "⌘";
  if (type.startsWith("approval.")) return "!";
  if (type.startsWith("artifact.")) return "↗";
  if (type.startsWith("workspace.")) return "W";
  if (type.startsWith("integration.")) return "✓";
  if (type.startsWith("task.")) return "T";
  if (type.startsWith("plan.")) return "P";
  return "•";
}

function planReviewStatusLabel(status: "pending" | "approved" | "rejected" | "cancelled") {
  return ({ pending: "等待你确认", approved: "批准", rejected: "拒绝", cancelled: "取消" })[status];
}

function trustProfileLabel(profile: DesktopTrustProfile) {
  return ({ strict: "严格审批", balanced: "平衡", automation: "自动化" })[profile];
}

function formatTime(value?: string) {
  if (value === undefined) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatClock(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function formatBytes(value?: number) {
  if (value === undefined) return "size unknown";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(value?: number) {
  if (value === undefined) return "—";
  if (value < 1_000) return `${value}ms`;
  if (value < 60_000) return `${Math.round(value / 1_000)}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1_000);
  return `${minutes}m${seconds}s`;
}

function formatCount(value: number) {
  return value >= 1_000 ? new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(value) : String(value);
}

function failureStageLabel(stage?: string) {
  return ({
    extensions: "启用高级工具",
    planning: "准备计划",
    task: "执行任务",
    artifact_gate: "检查结果",
    integration: "合并修改",
    runtime: "运行程序",
  } as Record<string, string>)[stage ?? ""] ?? "处理中";
}

function plainFailureTitle(stage?: string) {
  return `任务在“${failureStageLabel(stage)}”时停止`;
}

function explainRunFailure(run: DesktopRunView): { title: string; detail: string; checkProvider: boolean } {
  const raw = run.error ?? "";
  const provider = providerLabel(run.providerId ?? "");
  if (/\b(?:401|403)\b|unauthori[sz]ed|invalid api key|authentication|鉴权|认证失败/i.test(raw)) {
    return {
      title: `${provider} 没有接受当前 API Key`,
      detail: "请打开模型设置，确认账号和 API Key 仍然有效；验证连接通过后，再从头开始这次任务。",
      checkProvider: true,
    };
  }
  if (/fetch failed|provider (?:is )?unavailable|service unavailable|\b(?:ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|ETIMEDOUT)\b|network|socket|连接.*(?:失败|超时)/i.test(raw)) {
    return {
      title: `无法连接 ${provider} 模型服务`,
      detail: "请先检查网络和模型设置，再点击“验证连接”。连接通过后，可以从头开始；现在直接重试很可能再次失败。",
      checkProvider: true,
    };
  }
  if (/\b429\b|quota|rate limit|insufficient balance|billing|余额|额度|限流/i.test(raw)) {
    return {
      title: `${provider} 暂时没有接受这次请求`,
      detail: "可能是调用过快、账号额度或模型服务状态导致。请先到模型设置验证连接，并在服务商平台检查账号状态。",
      checkProvider: true,
    };
  }
  if (/\bENOENT\b|no such file or directory|source.+(?:moved|deleted)|资料.+(?:移动|删除)/i.test(raw)) {
    return {
      title: "任务需要的本地资料找不到了",
      detail: "请确认资料没有被移动或删除；原始资料不会被 LocalBuddy 自动修改。准备好资料后，再新建任务。",
      checkProvider: false,
    };
  }
  if (run.metrics.failureStage === "planning") {
    return {
      title: "执行计划没有生成",
      detail: "任务还没有开始处理资料。你可以查看技术信息，检查模型连接后再从头开始，或报告这次失败。",
      checkProvider: true,
    };
  }
  return {
    title: plainFailureTitle(run.metrics.failureStage),
    detail: "LocalBuddy 已停止后续步骤。请先查看下面可执行的操作；不确定原因时可以报告这次失败。",
    checkProvider: false,
  };
}

function checkpointBlockedReasonForRun(run: DesktopRunView): string {
  if (run.metrics.failureStage === "planning" || run.metrics.failureStage === "extensions") {
    return "任务还没有进入执行阶段，因此没有可恢复的步骤";
  }
  return recoveryBlockedReason(run.checkpoint?.reason);
}

function storageWarningLabel(warning: "cloud_sync" | "network_workspace") {
  return warning === "cloud_sync"
    ? "这个运行位置看起来位于 OneDrive、iCloud、Dropbox 或其他同步目录中；.localbuddy 可能被同步到云端或团队空间。"
    : "这个运行位置是 Windows 网络路径；文件权限由远端共享和当前账号 ACL 决定，LocalBuddy 不会把它误报为仅本机可见。";
}

function toMessage(value: unknown) {
  const message = value instanceof Error ? value.message : String(value);
  return recoveryBlockedReason(
    message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
  );
}

function recoveryBlockedReason(reason?: string) {
  if (reason === undefined || reason === "No safe checkpoint is available") {
    return "没有完整且可验证的安全继续点";
  }
  if (reason.includes("workspace snapshot exceeded the safe checkpoint entry limit")) {
    return "工作区可扫描条目超过安全快照上限";
  }
  if (reason.includes("workspace snapshot exceeded the safe checkpoint byte limit")) {
    return "工作区可扫描文件总大小超过安全快照上限";
  }
  if (reason.includes("workspace contents changed after the checkpoint was created")) {
    return "保存继续位置后，运行位置中的内容发生了变化";
  }
  if (reason.includes("a local source read by this Run changed")) {
    return "本次任务已经读取过的资料后来发生了变化";
  }
  if (reason.includes("a local source read by this Run is no longer available")) {
    return "本次任务已经读取过的资料已被移动或删除";
  }
  if (reason.includes("legacy research checkpoint used a whole-workspace snapshot")) {
    return "这是旧版的整目录快照；请新建任务并明确添加所需资料";
  }
  if (reason.includes("legacy Research Run used the project directory as implicit evidence")) {
    return "这个旧任务把整个项目目录当成隐式资料；请新建任务并明确添加所需资料";
  }
  if (reason.includes("checkpoint research sources do not match")) {
    return "保存的继续位置与本次资料不一致";
  }
  if (/\b(?:EACCES|EPERM)\b|permission denied/i.test(reason)) {
    return "工作区中有 LocalBuddy 无法读取的文件或目录";
  }
  if (/\bENOENT\b|no such file or directory/i.test(reason)) {
    return "所需的本地文件已不存在或位置发生了变化";
  }
  return reason;
}

function isCleanupProtected(run?: DesktopRunView) {
  return run !== undefined && (
    ACTIVE_STATUSES.has(run.status)
    || run.integration?.status === "awaiting_approval"
    || run.integration?.status === "applying"
    || run.integration?.status === "applied"
    || run.integration?.status === "recovery_required"
  );
}
