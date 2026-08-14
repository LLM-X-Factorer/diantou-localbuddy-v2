import { useEffect, useMemo, useState } from "react";

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
  DesktopWorkspaceReadiness,
} from "../../../src/desktop-contract";
import {
  GUIDE_TEMPLATES,
  type GuideTemplateId,
} from "../../../src/onboarding-content";

const ACTIVE_STATUSES = new Set<DesktopRunStatus>([
  "starting",
  "planning",
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
};
const DEFAULT_ONBOARDING: DesktopOnboardingState = {
  version: 1,
  guideSeen: false,
  contextHelpEnabled: true,
};

export function App() {
  const [workspace, setWorkspace] = useState("");
  const [recentWorkspaces, setRecentWorkspaces] = useState<readonly string[]>([]);
  const [runs, setRuns] = useState<readonly DesktopRunView[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [goal, setGoal] = useState("");
  const [sourcePaths, setSourcePaths] = useState<readonly string[]>([]);
  const [concurrency, setConcurrency] = useState(3);
  const [mode, setMode] = useState<DesktopRunMode>("research");
  const [providerId, setProviderId] = useState<"deepseek" | "openai">("deepseek");
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
  const [allowMcpWrites, setAllowMcpWrites] = useState(false);
  const [commitAfterApply, setCommitAfterApply] = useState(false);
  const [commitMessage, setCommitMessage] = useState("Apply approved LocalBuddy integration");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string>();
  const [integrationDiff, setIntegrationDiff] = useState<DesktopIntegrationDiffView>();
  const [loadingIntegrationDiff, setLoadingIntegrationDiff] = useState(false);
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<string>();
  const [artifactPreview, setArtifactPreview] = useState<DesktopArtifactPreviewView>();
  const [loadingArtifactName, setLoadingArtifactName] = useState<string>();
  const [guideVisible, setGuideVisible] = useState(true);
  const [onboarding, setOnboarding] = useState<DesktopOnboardingState>(DEFAULT_ONBOARDING);
  const [providerAvailability, setProviderAvailability] = useState<DesktopProviderAvailability>(EMPTY_PROVIDER_AVAILABILITY);
  const [workspaceReadiness, setWorkspaceReadiness] = useState<DesktopWorkspaceReadiness>(EMPTY_WORKSPACE_READINESS);
  const [creatingTutorial, setCreatingTutorial] = useState(false);
  const [guideStatus, setGuideStatus] = useState<string>();

  useEffect(() => {
    const unsubscribe = window.localbuddy.onRunUpdate((updated) => {
      setRuns((current) => upsertRun(current, updated));
      setSelectedRunId((current) => current ?? updated.runId);
    });
    window.localbuddy.bootstrap()
      .then((bootstrap) => {
        setWorkspace(bootstrap.workspace);
        setRecentWorkspaces(bootstrap.recentWorkspaces);
        setRuns(bootstrap.runs);
        setSelectedRunId(bootstrap.runs[0]?.runId);
        setProviderAvailability(bootstrap.providerAvailability);
        setWorkspaceReadiness(bootstrap.workspaceReadiness);
        setOnboarding(bootstrap.onboarding);
        setGuideVisible(!bootstrap.onboarding.guideSeen);
      })
      .catch((cause: unknown) => setError(toMessage(cause)))
      .finally(() => setLoading(false));
    return unsubscribe;
  }, []);

  useEffect(() => {
    setIntegrationDiff(undefined);
    setDiagnosticsStatus(undefined);
    setArtifactPreview(undefined);
  }, [selectedRunId]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.runId === selectedRunId) ?? runs[0],
    [runs, selectedRunId],
  );
  const activeRuns = runs.filter((run) => ACTIVE_STATUSES.has(run.status) && run.runtimeOwner !== "cli");
  const selectedProviderCredential = providerAvailability[providerId];
  const selectedActiveRun = selectedRun !== undefined && ACTIVE_STATUSES.has(selectedRun.status)
    ? selectedRun
    : undefined;
  const retainedWorktrees = selectedRun?.worktrees.filter((worktree) => worktree.status === "retained") ?? [];
  const cleanupProtected = isCleanupProtected(selectedRun);

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
    setRecentWorkspaces((current) => promoteRecentWorkspace(current, selected));
    setWorkspaceReadiness(readiness);
    setGoal("");
    setSourcePaths([]);
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

  async function setContextHelp(enabled: boolean) {
    setError(undefined);
    try {
      setOnboarding(await window.localbuddy.updateOnboarding({ contextHelpEnabled: enabled }));
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
      setOnboarding(result.onboarding);
      setSourcePaths(result.files.map((fileName) => joinLocalPath(result.workspace, fileName)));
      applyGuideTemplate("tutorial-research");
      setGuideStatus(result.created
        ? "教程工作区已在本机创建，研究模板已填入下方编辑器；任务尚未启动。"
        : "已复用原教程工作区，研究模板已填入下方编辑器；没有覆盖任何文件。"
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
    setGuideStatus("模板已填入下方编辑器。请先检查内容；只有点击“开始任务”后才会调用 Provider。");
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(), 0);
  }

  function revealProviderSetup() {
    setError(undefined);
    setCredentialStatus(undefined);
    setProviderSettingsOpen(true);
  }

  function selectProvider(nextProviderId: "deepseek" | "openai") {
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
      const run = await window.localbuddy.startRun({
        workspace,
        goal,
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
          allowMcpWrites,
          browser: origins.length === 0
            ? undefined
            : { allowedOrigins: origins, allowActions: allowBrowserActions },
        },
      });
      setRuns((current) => upsertRun(current, run));
      setSelectedRunId(run.runId);
      setGoal("");
      setSourcePaths([]);
      setGuideVisible(false);
      setGuideStatus(undefined);
    } catch (cause) {
      setError(toMessage(cause));
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
        ? `${providerLabel(providerId)} 已写入系统安全存储；当前运行仍优先使用环境变量。`
        : `${providerLabel(providerId)} 凭据已写入系统安全存储。`
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
      setCredentialStatus(`${providerLabel(providerId)} 连接验证通过；没有发起模型生成或产生模型 token。`);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setVerifyingProvider(false);
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
      "从头重新运行会保留原 Run，但会重新调用 Provider，并可能产生新的模型费用。确认继续吗？",
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
    setError(undefined);
    setLoadingArtifactName(fileName);
    try {
      setArtifactPreview(await window.localbuddy.loadArtifactPreview({
        workspace,
        runId: selectedRun.runId,
        fileName,
      }));
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setLoadingArtifactName(undefined);
    }
  }

  async function openArtifactExternally(fileName: string) {
    if (selectedRun === undefined) return;
    setError(undefined);
    try {
      await window.localbuddy.openArtifact({ workspace, runId: selectedRun.runId, fileName });
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  function continueFromArtifact() {
    if (selectedRun === undefined || artifactPreview === undefined) return;
    const excerpt = artifactPreview.text.slice(0, 20_000);
    setMode(selectedRun.mode);
    setGoal([
      `基于上一 Run 的已验证产物 ${artifactPreview.fileName} 继续。`,
      "以下内容只会在我点击“开始任务”后发送给所选 Provider：",
      "",
      excerpt,
      artifactPreview.text.length > excerpt.length ? "\n[续写上下文已截断]" : "",
      "",
      "请继续：",
    ].join("\n"));
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.scrollIntoView({ behavior: "smooth" }), 0);
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
            <span>multi-agent local runtime</span>
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
            <strong>指引与示例</strong>
            <small>完成第一次可信运行</small>
          </span>
        </button>

        <button className="provider-entry" onClick={revealProviderSetup}>
          <span className={`provider-entry-icon ${selectedProviderCredential.available ? "ready" : "missing"}`}>◆</span>
          <span>
            <strong>Provider 设置</strong>
            <small>{providerLabel(providerId)} · {providerCredentialShortLabel(selectedProviderCredential)}</small>
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
                setSelectedRunId(run.runId);
              }}
            >
              <span className={`status-dot ${run.status}`} />
              <span>
                <strong>{friendlyRunName(run)}</strong>
                <small>{formatTime(run.startedAt)} · {run.eventCount} events</small>
              </span>
            </button>
          ))}
          {!loading && runs.length === 0 && (
            <div className="empty-sidebar">这里还没有运行记录</div>
          )}
        </nav>

        <div className="sidebar-footer">
          <span className="secure-dot" />
          Keychain · local event log
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
          onClose={() => {
            setProviderApiKey("");
            setError(undefined);
            setCredentialStatus(undefined);
            setProviderSettingsOpen(false);
          }}
        />
      )}

      <main className="workspace-main">
        <header className="main-header">
          <div>
            <div className="eyebrow">LOCAL CONTROL PLANE</div>
            <h1>{guideVisible ? "第一次可信运行" : selectedRun ? friendlyRunName(selectedRun) : "创建第一个运行"}</h1>
          </div>
          {guideVisible ? (
            <div className="header-actions guide-header-actions">
              <button onClick={() => setContextHelp(!onboarding.contextHelpEnabled)}>
                运行中提示：{onboarding.contextHelpEnabled ? "开" : "关"}
              </button>
              <button onClick={closeGuide}>进入工作台</button>
            </div>
          ) : selectedRun && (
            <div className="header-actions">
              <button onClick={exportDiagnostics} disabled={exportingDiagnostics}>
                {exportingDiagnostics ? "导出中…" : "导出脱敏诊断"}
              </button>
              <StatusPill status={selectedRun.status} />
            </div>
          )}
        </header>

        {error && <div className="error-banner">{error}</div>}
        {diagnosticsStatus && <div className="success-banner">{diagnosticsStatus}</div>}
        {guideVisible ? (
          <FirstRunGuide
            workspace={workspace}
            readiness={workspaceReadiness}
            providerId={providerId}
            providerAvailability={providerAvailability}
            contextHelpEnabled={onboarding.contextHelpEnabled}
            creatingTutorial={creatingTutorial}
            status={guideStatus}
            onChooseWorkspace={chooseWorkspace}
            onCreateTutorial={createTutorialAndPrepare}
            onConfigureProvider={revealProviderSetup}
            onApplyTemplate={applyGuideTemplate}
            onToggleContextHelp={setContextHelp}
          />
        ) : selectedRun ? (
          <div className="run-content">
            {onboarding.contextHelpEnabled && (
              <RunGuideHint run={selectedRun} onDisable={() => setContextHelp(false)} />
            )}
            <section className="summary-strip">
              <SummaryMetric label="任务" value={String(selectedRun.tasks.length)} detail="task graph" />
              <SummaryMetric
                label="已完成"
                value={String(selectedRun.tasks.filter((task) => task.status === "succeeded").length)}
                detail="verified tasks"
              />
              <SummaryMetric label="耗时" value={formatDuration(selectedRun.metrics.durationMs)} detail="audited timeline" />
              <SummaryMetric label="模型调用" value={String(selectedRun.metrics.modelCalls)} detail="completed calls" />
              <SummaryMetric label="Tokens" value={formatCount(selectedRun.metrics.totalTokens)} detail="provider reported" />
              <SummaryMetric
                label="失败 / 闸门"
                value={`${selectedRun.metrics.modelFailures + selectedRun.metrics.toolFailures} / ${selectedRun.metrics.artifactGateRetries}`}
                detail={selectedRun.metrics.failureStage === undefined ? "calls / artifact" : failureStageLabel(selectedRun.metrics.failureStage)}
              />
            </section>

            {selectedRun.status === "failed" && (
              <section className="panel failed-recovery-panel">
                <div>
                  <span className="recovery-kicker">CHECKPOINT RETRY</span>
                  <h2>失败阶段：{failureStageLabel(selectedRun.metrics.failureStage)}</h2>
                  {selectedRun.checkpoint === undefined ? (
                    <p>正在复核 checkpoint 和本次真正读取过的资料；完成前不会开放恢复操作。</p>
                  ) : selectedRun.checkpoint.status === "available" ? (
                    <p>
                      checkpoint 已通过复核：已完成 {selectedRun.checkpoint.completedTasks} 个 Task，
                      重试只执行剩余 {selectedRun.checkpoint.resumableTasks} 个 Task 及其依赖链。
                    </p>
                  ) : (
                    <p>
                      当前 checkpoint 不可安全重试：{recoveryBlockedReason(selectedRun.checkpoint?.reason)}。
                      可以保留旧事件并从原请求创建一个全新 Run。
                    </p>
                  )}
                  {selectedRun.error && <small>{toMessage(selectedRun.error)}</small>}
                </div>
                <div className="recovery-actions">
                  {selectedRun.checkpoint?.status === "available" && (
                    <button onClick={resumeRun}>重试未完成 Task 链</button>
                  )}
                  {selectedRun.checkpoint !== undefined && (
                    <button className="replay-button" onClick={restartRun} disabled={selectedRun.restartedAs !== undefined}>
                      {selectedRun.restartedAs ? "已经重新运行" : "从头重新运行"}
                    </button>
                  )}
                </div>
              </section>
            )}

            {selectedRun.status === "interrupted" && (
              <section className="panel recovery-panel">
                <div>
                  <span className="recovery-kicker">SAFE RECOVERY</span>
                  <h2>这个 Run 在终态前中断</h2>
                  {selectedRun.checkpoint?.status === "available" ? (
                    <p>
                      可从已落盘的安全边界继续：已完成 {selectedRun.checkpoint.completedTasks} 个 Task，
                      仍需恢复 {selectedRun.checkpoint.resumableTasks} 个 Task。
                      {selectedRun.mode === "code"
                        ? " Git 登记的隔离工作树、patch 与预检状态会重新核验；主仓库不会自动写回。"
                        : " 模型请求可能重试，已确认的工具结果不会重复执行。"}
                    </p>
                  ) : (
                    <p>
                      当前 checkpoint 不可安全续跑：{recoveryBlockedReason(selectedRun.checkpoint?.reason)}。
                      仍可保留旧事件并从原请求创建一个全新 Run。
                    </p>
                  )}
                  {selectedRun.restartedAs && <small>已重放为 {selectedRun.restartedAs}</small>}
                </div>
                <div className="recovery-actions">
                  {selectedRun.checkpoint?.status === "available" && (
                    <button onClick={resumeRun}>从 checkpoint 继续</button>
                  )}
                  <button className="replay-button" onClick={restartRun} disabled={selectedRun.restartedAs !== undefined}>
                    {selectedRun.restartedAs ? "已经重新运行" : "从头重新运行"}
                  </button>
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

            <section className="panel tasks-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-index">01</span>
                  <h2>Agent 任务图</h2>
                </div>
                <span className="panel-note">读任务并行 · 整合任务串行</span>
              </div>
              <div className="task-grid">
                {selectedRun.tasks.map((task, index) => (
                  <article className={`task-card ${task.status}`} key={task.id}>
                    <div className="task-card-top">
                      <span className="task-number">{String(index + 1).padStart(2, "0")}</span>
                      <span className={`task-status ${task.status}`}>{statusLabel(task.status)}</span>
                    </div>
                    <h3>{task.title}</h3>
                    <p>{task.agentId ?? "等待 Agent 分配"}</p>
                    {task.error && (
                      <p className="task-error" title={toMessage(task.error)}>{toMessage(task.error)}</p>
                    )}
                    <div className="task-progress"><span /></div>
                  </article>
                ))}
                {selectedRun.tasks.length === 0 && (
                  <div className="empty-panel">Orchestrator 正在规划任务图…</div>
                )}
              </div>
            </section>

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
                  <h2>验证产物</h2>
                </div>
                <span className="panel-note">Artifact Gate protected</span>
              </div>
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
                  <div className="empty-panel compact">通过验证的产物会出现在这里</div>
                )}
              </div>
              {artifactPreview && (
                <div className="artifact-preview">
                  <div className="artifact-preview-header">
                    <div>
                      <strong>{artifactPreview.fileName}</strong>
                      <span>SHA-256 {artifactPreview.sha256.slice(0, 16)} · {formatBytes(artifactPreview.bytes)}{artifactPreview.truncated ? " · 预览已截断" : ""}</span>
                    </div>
                    <div>
                      <button onClick={() => openArtifactExternally(artifactPreview.fileName)}>系统打开</button>
                      <button className="continue-artifact-button" onClick={continueFromArtifact}>基于此产物继续</button>
                    </div>
                  </div>
                  <pre>{artifactPreview.text}</pre>
                  <small>预览在本机完成；只有你点击“开始任务”后，填入编辑器的续写上下文才会发送给 Provider。</small>
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

        <section className="composer">
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="描述一个需要多个 Agent 协作完成的本地任务…"
          />
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
                <p>未添加本地资料。任务仍可使用已启用的 Browser / MCP；没有证据时会明确说明缺口。</p>
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
          {!selectedProviderCredential.available && (
            <div className="provider-required-banner">
              <span><strong>{providerLabel(providerId)} 尚未配置</strong>真实任务需要可用的 API Key，Guide 和模板仍可离线使用。</span>
              <button type="button" onClick={revealProviderSetup}>配置 {providerLabel(providerId)}</button>
            </div>
          )}
          <div className="composer-actions">
            <div className="composer-options">
              <label className="provider-option" title="Provider">
                <span className="control-label">Provider</span>
                <select value={providerId} onChange={(event) => {
                  selectProvider(event.target.value as "deepseek" | "openai");
                }} aria-label="Provider">
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI</option>
                </select>
              </label>
              <button
                className={`provider-status-button ${selectedProviderCredential.available ? "ready" : "missing"}`}
                type="button"
                onClick={revealProviderSetup}
                title={`${providerLabel(providerId)} · ${providerCredentialShortLabel(selectedProviderCredential)}`}
                aria-label={`${providerLabel(providerId)} · ${providerCredentialShortLabel(selectedProviderCredential)}，打开 Provider 设置`}
              >
                {providerCredentialCompactLabel(selectedProviderCredential)}
              </button>
              <label className="trust-option" title="信任档位">
                <span className="control-label">信任档位</span>
                <select aria-label="信任档位" value={trustProfile} onChange={(event) => setTrustProfile(event.target.value as DesktopTrustProfile)}>
                  <option value="strict">严格审批</option>
                  <option value="balanced">平衡（推荐）</option>
                  <option value="automation">自动化（禁外部副作用）</option>
                </select>
              </label>
              <label className="mode-option" title="模式">
                <span className="control-label">模式</span>
                <select aria-label="模式" value={mode} onChange={(event) => setMode(event.target.value as DesktopRunMode)}>
                  <option value="research">研究</option>
                  <option value="code">代码隔离</option>
                </select>
              </label>
              <label className="concurrency-option" title="Run 并发">
                <span className="control-label">Run 并发</span>
                <select
                  aria-label="Run 并发"
                  value={concurrency}
                  onChange={(event) => setConcurrency(Number(event.target.value))}
                >
                  <option value={1}>并发 1</option>
                  <option value={2}>并发 2</option>
                  <option value={3}>并发 3</option>
                </select>
              </label>
              <span className="global-capacity">全局 3 · 活跃 {activeRuns.length}/2</span>
              <button
                className="extensions-toggle"
                type="button"
                aria-expanded={extensionsOpen}
                onClick={() => setExtensionsOpen((current) => !current)}
              >
                扩展 {extensionCount(skillIds, mcpServerIds, browserOrigins)}
                <span>{extensionsOpen ? "↑" : "↓"}</span>
              </button>
            </div>
            <div className="composer-buttons">
              {selectedActiveRun && (
                <button className="cancel-button" onClick={cancelRun}>停止当前 Run</button>
              )}
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
                开始任务 <span>→</span>
              </button>
            </div>
          </div>
          {extensionsOpen && (
            <div className="extensions-config">
              <label>
                Skills
                <input value={skillIds} onChange={(event) => setSkillIds(event.target.value)} placeholder="skill-one, skill-two" />
              </label>
              <label>
                MCP Servers
                <input value={mcpServerIds} onChange={(event) => setMcpServerIds(event.target.value)} placeholder="local-tools" />
              </label>
              <label>
                Browser Origins
                <input value={browserOrigins} onChange={(event) => setBrowserOrigins(event.target.value)} placeholder="https://example.com" />
              </label>
              <label className="extension-check">
                <input type="checkbox" checked={allowBrowserActions} onChange={(event) => setAllowBrowserActions(event.target.checked)} />
                允许浏览器动作发起逐次审批
              </label>
              <label className="extension-check">
                <input type="checkbox" checked={allowMcpWrites} onChange={(event) => setAllowMcpWrites(event.target.checked)} />
                允许 MCP 副作用工具发起逐次审批
              </label>
            </div>
          )}
        </section>
      </main>

      <aside className="event-rail">
        <div className="event-header">
          <div>
            <span className="live-dot" />
            运行轨迹
          </div>
          <span>{guideVisible ? "GUIDE" : selectedRun?.eventCount ?? 0}</span>
        </div>
        <div className="event-list">
          {guideVisible ? (
            <GuideEventRail />
          ) : selectedRun?.recentEvents.toReversed().map((event) => (
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
          {!guideVisible && selectedRun?.recentEvents.length === 0 && (
            <div className="empty-events">事件将在这里实时出现</div>
          )}
        </div>
        <div className="runtime-card">
          <span>RUNTIME</span>
          <strong>{guideVisible ? "Local guide · offline" : `${providerLabel(selectedRun?.providerId ?? providerId)} · SSE`}</strong>
          <p>
            {guideVisible ? "不会读取工作区、调用模型或启动任务" : "跨 Run 全局并发 3"}<br />
            {guideVisible
              ? "模板只预填，执行必须由你点击开始"
              : selectedRun?.extensions === undefined
              ? "扩展按 Run 显式启用"
              : `${selectedRun.extensions.skillIds.length} Skills · ${selectedRun.extensions.mcpServerIds.length} MCP · ${selectedRun.extensions.browserOrigins.length > 0 ? "Browser" : "No Browser"}`}
          </p>
        </div>
      </aside>
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
  onClose(): void;
}) {
  const credential = availability[providerId];
  return (
    <div className="provider-settings-overlay">
      <section className="provider-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-settings-title">
        <header>
          <div>
            <span>LOCAL PROVIDER CONTROL</span>
            <h2 id="provider-settings-title">Provider 设置</h2>
            <p>Provider 是真实运行的必要条件，不属于 Skills、MCP 或 Browser 扩展。</p>
          </div>
          <button className="provider-dialog-close" type="button" onClick={onClose} aria-label="关闭 Provider 设置">×</button>
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
            <strong>{providerLabel(providerId)} · {providerCredentialShortLabel(credential)}</strong>
            <p>{credential.source === "environment"
              ? "当前进程优先使用环境变量。你仍可保存一份到系统安全存储，但在环境变量移除前不会生效。"
              : credential.source === "system"
              ? "API Key 位于操作系统凭据库。LocalBuddy 只检查是否可用，不会读取并回显。"
              : "保存后只返回可用状态；密钥不会写入 Run、事件日志、checkpoint 或 Renderer 存储。"}</p>
          </div>
        </div>

        <div className="provider-credential-form">
          <label>
            {credential.source === "system" ? "替换 API Key" : "API Key"}
            <span className="provider-key-row">
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => onChangeApiKey(event.target.value)}
                placeholder="仅写入操作系统安全存储"
              />
              <button type="button" onClick={onSave} disabled={saving || deleting || verifying || apiKey.trim().length === 0}>
                {saving ? "写入中…" : credential.source === "system" ? "替换并保存" : credential.source === "environment" ? "另存到系统" : "安全保存"}
              </button>
            </span>
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
          <summary>当前 Run 高级设置</summary>
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
          <p>保存只验证本机安全写入，不会自动联网。点击“验证连接”会把凭据发送到上方显示的 Provider / Base URL，并请求模型列表；不会生成内容或消耗模型 token。</p>
          <button type="button" onClick={onClose}>完成</button>
        </footer>
      </section>
    </div>
  );
}

function FirstRunGuide({
  workspace,
  readiness,
  providerId,
  providerAvailability,
  contextHelpEnabled,
  creatingTutorial,
  status,
  onChooseWorkspace,
  onCreateTutorial,
  onConfigureProvider,
  onApplyTemplate,
  onToggleContextHelp,
}: {
  workspace: string;
  readiness: DesktopWorkspaceReadiness;
  providerId: "deepseek" | "openai";
  providerAvailability: DesktopProviderAvailability;
  contextHelpEnabled: boolean;
  creatingTutorial: boolean;
  status?: string;
  onChooseWorkspace(): void;
  onCreateTutorial(): void;
  onConfigureProvider(): void;
  onApplyTemplate(id: GuideTemplateId): void;
  onToggleContextHelp(enabled: boolean): void;
}) {
  const providerCredential = providerAvailability[providerId];
  const providerReady = providerCredential.available;
  return (
    <div className="guide-state">
      <section className="guide-dialogue">
        <span className="guide-avatar"><img src={localBuddyIcon} alt="" /></span>
        <div className="guide-message">
          <span>LOCALBUDDY GUIDE · 本地指引</span>
          <h2>先完成一个真实结果，再认识所有功能。</h2>
          <p>我不会在这里调用模型、读取文件或启动任务。下面的选择只会准备工作区和预填模板，最终执行必须由你确认。</p>
        </div>
      </section>

      {status && <div className="guide-status">{status}</div>}

      <section className="guide-readiness">
        <div className="guide-section-heading">
          <span>01</span>
          <div><h3>运行前准备</h3><p>只检查状态，不读取工作区内容或返回密钥。</p></div>
        </div>
        <div className="readiness-grid">
          <article className={readiness.selected ? "ready" : "needs-action"}>
            <span>{readiness.selected ? "✓" : "1"}</span>
            <div>
              <strong>明确工作区</strong>
              <small>{readiness.selected
                ? `${readiness.isTutorialWorkspace ? "教程工作区" : readiness.isGitRepository ? "Git 仓库" : "资料目录"} · ${shortPath(workspace)}`
                : "不会默认访问整个 Documents"}</small>
            </div>
            <button onClick={onChooseWorkspace}>{readiness.selected ? "更换" : "选择"}</button>
          </article>
          <article className={providerReady ? "ready" : "needs-action"}>
            <span>{providerReady ? "✓" : "2"}</span>
            <div>
              <strong>{providerLabel(providerId)} 凭据</strong>
              <small>{providerReady ? providerCredentialLongLabel(providerCredential) : "这里只返回可用/不可用，不读取密钥"}</small>
            </div>
            <button onClick={onConfigureProvider}>{providerReady ? "查看配置" : "去配置"}</button>
          </article>
          <article className="ready">
            <span>✓</span>
            <div>
              <strong>人工控制</strong>
              <small>模板不自动启动；外部副作用和代码写回另行审批</small>
            </div>
            <button onClick={() => onToggleContextHelp(!contextHelpEnabled)}>{contextHelpEnabled ? "提示已开" : "打开提示"}</button>
          </article>
        </div>
      </section>

      <section className="guide-capabilities">
        <div className="guide-section-heading">
          <span>02</span>
          <div><h3>你想先完成什么？</h3><p>按结果选择，不需要先理解 Agent、MCP 或 Worktree。</p></div>
        </div>
        <div className="capability-grid">
          <article className="capability-card recommended">
            <div className="capability-top"><span>90 秒入门</span><i>推荐</i></div>
            <h3>用合成材料完成第一份简报</h3>
            <p>显式创建一个独立教程目录，用真实 Provider 跑完整 Research 流程。</p>
            <ul><li>输入：3 份虚构材料</li><li>输出：有来源的 Markdown 简报</li><li>控制：不会覆盖现有文件</li></ul>
            <button onClick={onCreateTutorial} disabled={creatingTutorial}>{creatingTutorial ? "创建中…" : "创建教程工作区并预填"}</button>
          </article>
          <article className={!readiness.selected ? "capability-card unavailable" : "capability-card"}>
            <div className="capability-top"><span>资料研究</span><i>{readiness.selected ? "可准备" : "先选工作区"}</i></div>
            <h3>把自己的本地资料整理成简报</h3>
            <p>Worker 并行阅读，Integrator 区分事实、未知与建议，再交付验证产物。</p>
            <ul><li>输入：你选择的资料目录</li><li>输出：带来源文件名的报告</li><li>控制：点击开始后才发送必要上下文</li></ul>
            <button onClick={() => onApplyTemplate("workspace-research")} disabled={!readiness.selected}>预填研究模板</button>
          </article>
          <article className={!readiness.isGitRepository ? "capability-card unavailable" : "capability-card"}>
            <div className="capability-top"><span>代码修改</span><i>{readiness.isGitRepository ? "Git 已就绪" : "需要 Git 仓库"}</i></div>
            <h3>在隔离工作树中修改代码</h3>
            <p>Agent 只能先生成可审阅 Diff；没有你的明确批准，主工作区不会被写回。</p>
            <ul><li>输入：干净的 Git 仓库</li><li>输出：组合检查与可校验 Diff</li><li>控制：人工批准 apply / commit</li></ul>
            <button onClick={() => onApplyTemplate("safe-code")} disabled={!readiness.isGitRepository}>预填安全 Coding 模板</button>
          </article>
        </div>
      </section>

      <section className="guide-mechanics">
        <div className="guide-section-heading">
          <span>03</span>
          <div><h3>一次真实 Run 会展示什么？</h3><p>提示由审计状态驱动，不是预制假运行。</p></div>
        </div>
        <div className="mechanics-grid">
          <div><span>PLAN</span><strong>任务图</strong><p>看到 Orchestrator 如何拆解任务，以及 Worker 的依赖和并发。</p></div>
          <div><span>TRACE</span><strong>运行轨迹</strong><p>每次模型、工具、审批和产物动作都留下可审计事件。</p></div>
          <div><span>GATE</span><strong>人工控制</strong><p>外部副作用逐次批准，代码写回前必须查看并批准 Diff。</p></div>
          <div><span>RECOVER</span><strong>失败恢复</strong><p>安全 checkpoint 可复用已完成 Task，只继续未完成任务链。</p></div>
        </div>
      </section>
    </div>
  );
}

function RunGuideHint({ run, onDisable }: { run: DesktopRunView; onDisable(): void }) {
  const hint = runGuideHint(run);
  return (
    <section className="run-guide-hint">
      <span className="run-guide-icon">?</span>
      <div><strong>{hint.title}</strong><p>{hint.detail}</p></div>
      <button onClick={onDisable}>关闭运行中提示</button>
    </section>
  );
}

function GuideEventRail() {
  return (
    <div className="guide-event-rail">
      <div className="event-item"><span className="event-icon">1</span><div><strong>选择明确工作区</strong><p>不默认读取私人目录</p><small>本地准备</small></div></div>
      <div className="event-item"><span className="event-icon model">2</span><div><strong>检查并启动模板</strong><p>点击开始后才调用 Provider</p><small>用户决定</small></div></div>
      <div className="event-item"><span className="event-icon artifact">3</span><div><strong>核验真实产物</strong><p>查看来源、哈希与审计轨迹</p><small>可信结果</small></div></div>
    </div>
  );
}

function runGuideHint(run: DesktopRunView): { title: string; detail: string } {
  if (run.pendingApprovals.length > 0) {
    return { title: "Agent 正在等待你决定", detail: "批准只对当前一次、当前参数哈希的调用生效；不确定时可以拒绝。" };
  }
  if (run.integration?.status === "awaiting_approval") {
    return { title: "主工作区还没有被修改", detail: "先校验并查看完整 Diff，再决定只写回、写回并提交，或者拒绝。" };
  }
  if (run.status === "starting" || run.status === "planning") {
    return { title: "Orchestrator 正在拆解目标", detail: "稍后任务图会显示每个 Task、依赖关系和负责的 Agent；规划本身不会绕过工具权限。" };
  }
  if (run.status === "running") {
    return { title: "真实执行正在产生审计事件", detail: "右侧轨迹区会记录模型、工具、审批和产物动作；读任务可并行，写入仍受工作区锁约束。" };
  }
  if (run.status === "succeeded") {
    return { title: "Run 已完成，先验证结果", detail: "从“验证产物”查看文件名、大小和 SHA-256；文本预览会在本机复核后展示。" };
  }
  if (run.status === "failed" || run.status === "interrupted") {
    return { title: "失败不会被伪装成成功", detail: "检查失败阶段与 checkpoint。只有安全边界可验证时，LocalBuddy 才会允许继续未完成 Task 链。" };
  }
  return { title: "这个 Run 保留完整边界", detail: "目标、状态、审批和产物都属于当前工作区；历史不会因重放或恢复被改写。" };
}

function csvValues(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function extensionCount(skills: string, servers: string, origins: string): number {
  return csvValues(skills).length + csvValues(servers).length + (csvValues(origins).length > 0 ? 1 : 0);
}

function providerLabel(id: string): string {
  return id === "openai" ? "OpenAI" : id === "deepseek" ? "DeepSeek" : "Provider";
}

function providerCredentialShortLabel(status: DesktopProviderCredentialStatus): string {
  return status.source === "environment"
    ? "环境变量可用"
    : status.source === "system"
    ? "系统凭据已配置"
    : "未配置";
}

function providerCredentialCompactLabel(status: DesktopProviderCredentialStatus): string {
  return status.source === "environment"
    ? "环境变量"
    : status.source === "system"
    ? "系统凭据"
    : "去配置";
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
  return meaningfulTask?.title ?? run.runId.replace(/^run-/, "Run ").slice(0, 22);
}

function artifactBadge(fileName: string) {
  return fileName.endsWith(".patch") ? "DIFF" : fileName.endsWith(".json") ? "JSON" : "MD";
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

function statusLabel(status: string) {
  return ({
    starting: "启动中", planning: "规划中", queued: "排队中", running: "运行中",
    succeeded: "已完成", failed: "失败", blocked: "已阻塞", cancelling: "停止中", cancelled: "已取消", interrupted: "已中断",
  } as Record<string, string>)[status] ?? status;
}

function eventLabel(type: string) {
  const [owner, action] = type.split(".");
  const ownerLabels: Record<string, string> = { run: "运行", plan: "规划", task: "任务", model: "模型", tool: "工具", approval: "审批", artifact: "产物", workspace: "隔离区", integration: "集成", checkpoint: "检查点" };
  const actionLabels: Record<string, string> = { started: "开始", resumed: "恢复执行", queued: "排队", requested: "请求", resolved: "已决策", approved: "获准", completed: "完成", succeeded: "成功", failed: "失败", blocked: "阻塞", created: "生成", restored: "状态恢复", resume_blocked: "恢复阻断", reused: "结果复用", denied: "拒绝", cancelled: "取消", interrupted: "意外中断", restarted: "已重放", removed: "已清理", diff_captured: "补丁已捕获", preflight_started: "组合预检", preflight_failed: "预检失败", awaiting_approval: "等待批准", applying: "写回中", applied: "已写回", committed: "已提交", reverted: "已撤销", revert_committed: "反向提交完成", revert_failed: "反向提交失败", recovery_required: "需要恢复" };
  if (owner === "integration" && action === "approved") return "集成 · 人工批准";
  return `${ownerLabels[owner ?? ""] ?? owner} · ${actionLabels[action ?? ""] ?? action}`;
}

function eventGlyph(type: string) {
  if (type.startsWith("model.")) return "AI";
  if (type.startsWith("tool.")) return "⌘";
  if (type.startsWith("approval.")) return "!";
  if (type.startsWith("artifact.")) return "↗";
  if (type.startsWith("workspace.")) return "W";
  if (type.startsWith("integration.")) return "✓";
  if (type.startsWith("task.")) return "T";
  return "•";
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
    extensions: "扩展初始化",
    planning: "任务规划",
    task: "Task 执行",
    artifact_gate: "Artifact Gate",
    integration: "受控集成",
    runtime: "运行时",
  } as Record<string, string>)[stage ?? ""] ?? "待定位";
}

function toMessage(value: unknown) {
  const message = value instanceof Error ? value.message : String(value);
  return recoveryBlockedReason(
    message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
  );
}

function recoveryBlockedReason(reason?: string) {
  if (reason === undefined || reason === "No safe checkpoint is available") {
    return "没有完整且可验证的 checkpoint";
  }
  if (reason.includes("workspace snapshot exceeded the safe checkpoint entry limit")) {
    return "工作区可扫描条目超过安全快照上限";
  }
  if (reason.includes("workspace snapshot exceeded the safe checkpoint byte limit")) {
    return "工作区可扫描文件总大小超过安全快照上限";
  }
  if (reason.includes("workspace contents changed after the checkpoint was created")) {
    return "checkpoint 创建后工作区内容发生了变化";
  }
  if (reason.includes("a local source read by this Run changed")) {
    return "本次任务已经读取过的资料在 checkpoint 之后发生了变化";
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
    return "checkpoint 记录的本次资料与运行请求不一致";
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
