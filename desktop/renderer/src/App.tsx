import { useEffect, useMemo, useState } from "react";

import type {
  DesktopRunMode,
  DesktopRunStatus,
  DesktopTrustProfile,
  DesktopRunView,
  DesktopIntegrationDiffView,
} from "../../../src/desktop-contract";

const ACTIVE_STATUSES = new Set<DesktopRunStatus>([
  "starting",
  "planning",
  "running",
  "cancelling",
]);

export function App() {
  const [workspace, setWorkspace] = useState("");
  const [runs, setRuns] = useState<readonly DesktopRunView[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [goal, setGoal] = useState("");
  const [concurrency, setConcurrency] = useState(3);
  const [mode, setMode] = useState<DesktopRunMode>("research");
  const [providerId, setProviderId] = useState<"deepseek" | "openai">("deepseek");
  const [providerModel, setProviderModel] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [credentialStatus, setCredentialStatus] = useState<string>();
  const [savingCredential, setSavingCredential] = useState(false);
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

  useEffect(() => {
    const unsubscribe = window.localbuddy.onRunUpdate((updated) => {
      setRuns((current) => upsertRun(current, updated));
      setSelectedRunId((current) => current ?? updated.runId);
    });
    window.localbuddy.bootstrap()
      .then((bootstrap) => {
        setWorkspace(bootstrap.workspace);
        setRuns(bootstrap.runs);
        setSelectedRunId(bootstrap.runs[0]?.runId);
      })
      .catch((cause: unknown) => setError(toMessage(cause)))
      .finally(() => setLoading(false));
    return unsubscribe;
  }, []);

  useEffect(() => {
    setIntegrationDiff(undefined);
    setDiagnosticsStatus(undefined);
  }, [selectedRunId]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.runId === selectedRunId) ?? runs[0],
    [runs, selectedRunId],
  );
  const activeRuns = runs.filter((run) => ACTIVE_STATUSES.has(run.status) && run.runtimeOwner !== "cli");
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
      setWorkspace(selected);
      const history = await window.localbuddy.listRuns(selected);
      setRuns(history);
      setSelectedRunId(history[0]?.runId);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function startRun() {
    setError(undefined);
    try {
      const origins = csvValues(browserOrigins);
      const run = await window.localbuddy.startRun({
        workspace,
        goal,
        concurrency,
        mode,
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
      await window.localbuddy.storeProviderCredential({
        providerId,
        apiKey: providerApiKey,
      });
      setProviderApiKey("");
      setCredentialStatus(`${providerId === "deepseek" ? "DeepSeek" : "OpenAI"} 凭据已写入系统安全存储`);
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setSavingCredential(false);
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
    if (selectedRun?.status !== "interrupted" || selectedRun.restartedAs !== undefined) return;
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
    if (selectedRun?.status !== "interrupted" || selectedRun.checkpoint?.status !== "available") return;
    setError(undefined);
    try {
      const resumed = await window.localbuddy.resumeRun({ workspace, runId: selectedRun.runId });
      setRuns((current) => upsertRun(current, resumed));
      setSelectedRunId(resumed.runId);
    } catch (cause) {
      setError(toMessage(cause));
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
          <span className="brand-mark">LB</span>
          <div>
            <strong>LocalBuddy</strong>
            <span>multi-agent local runtime</span>
          </div>
        </div>

        <button className="workspace-button" onClick={chooseWorkspace}>
          <span className="workspace-icon">⌘</span>
          <span>
            <small>工作区</small>
            <strong title={workspace}>{shortPath(workspace)}</strong>
          </span>
          <span className="chevron">⌄</span>
        </button>

        <div className="sidebar-label">
          <span>运行记录</span>
          <span>{runs.length}</span>
        </div>
        <nav className="run-list">
          {runs.map((run) => (
            <button
              className={run.runId === selectedRun?.runId ? "run-item selected" : "run-item"}
              key={run.runId}
              onClick={() => setSelectedRunId(run.runId)}
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

      <main className="workspace-main">
        <header className="main-header">
          <div>
            <div className="eyebrow">LOCAL CONTROL PLANE</div>
            <h1>{selectedRun ? friendlyRunName(selectedRun) : "创建第一个运行"}</h1>
          </div>
          {selectedRun && (
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

        {selectedRun ? (
          <div className="run-content">
            <section className="summary-strip">
              <SummaryMetric label="任务" value={String(selectedRun.tasks.length)} detail="task graph" />
              <SummaryMetric
                label="已完成"
                value={String(selectedRun.tasks.filter((task) => task.status === "succeeded").length)}
                detail="verified tasks"
              />
              <SummaryMetric label="事件" value={String(selectedRun.eventCount)} detail="append-only" />
              <SummaryMetric label="产物" value={String(selectedRun.artifacts.length)} detail="registered" />
            </section>

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
                      当前 checkpoint 不可安全续跑：{selectedRun.checkpoint?.reason ?? "没有完整 checkpoint"}。
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
                    onClick={() => window.localbuddy.openArtifact(workspace, artifact.absolutePath)}
                  >
                      <span className="file-badge">{artifactBadge(artifact.fileName)}</span>
                    <span>
                      <strong>{artifact.fileName}</strong>
                      <small>{formatBytes(artifact.bytes)} · {artifact.sha256?.slice(0, 12) ?? "hash pending"}</small>
                    </span>
                    <span className="open-arrow">↗</span>
                  </button>
                ))}
                {selectedRun.artifacts.length === 0 && (
                  <div className="empty-panel compact">通过验证的产物会出现在这里</div>
                )}
              </div>
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
                      {selectedRun.integration.error}
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
            <h2>本地文件，远程智能，可审计执行</h2>
            <p>Orchestrator 拆解任务，Worker 并行执行，Integrator 通过闸门后交付产物。</p>
          </div>
        )}

        <section className="composer">
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="描述一个需要多个 Agent 协作完成的本地任务…"
          />
          <button
            className="extensions-toggle"
            type="button"
            onClick={() => setExtensionsOpen((current) => !current)}
          >
            扩展配置 {extensionsOpen ? "收起" : "展开"}
            <span>{extensionCount(skillIds, mcpServerIds, browserOrigins)} enabled</span>
          </button>
          {extensionsOpen && (
            <div className="extensions-config">
              <div className="provider-config-block">
                <label>
                  Provider Model（可选）
                  <input value={providerModel} onChange={(event) => setProviderModel(event.target.value)} placeholder="使用 Provider 默认模型" />
                </label>
                <label>
                  Base URL（可选）
                  <input value={providerBaseUrl} onChange={(event) => setProviderBaseUrl(event.target.value)} placeholder="使用官方端点" />
                </label>
                <label>
                  API Key（仅写入系统安全存储）
                  <span className="credential-input-row">
                    <input
                      type="password"
                      autoComplete="off"
                      value={providerApiKey}
                      onChange={(event) => setProviderApiKey(event.target.value)}
                      placeholder="不会写入 Run 或事件日志"
                    />
                    <button type="button" onClick={saveProviderCredential} disabled={savingCredential || providerApiKey.trim().length === 0}>
                      {savingCredential ? "写入中" : "安全保存"}
                    </button>
                  </span>
                </label>
                {credentialStatus && <small className="credential-status">{credentialStatus}</small>}
              </div>
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
          <div className="composer-actions">
            <div className="composer-options">
              <label>
                Provider
                <select value={providerId} onChange={(event) => {
                  setProviderId(event.target.value as "deepseek" | "openai");
                  setCredentialStatus(undefined);
                }}>
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI</option>
                </select>
              </label>
              <label>
                信任档位
                <select value={trustProfile} onChange={(event) => setTrustProfile(event.target.value as DesktopTrustProfile)}>
                  <option value="strict">严格审批</option>
                  <option value="balanced">平衡（推荐）</option>
                  <option value="automation">自动化（禁外部副作用）</option>
                </select>
              </label>
              <label>
                模式
                <select value={mode} onChange={(event) => setMode(event.target.value as DesktopRunMode)}>
                  <option value="research">研究</option>
                  <option value="code">代码隔离</option>
                </select>
              </label>
              <label>
                Run 并发
                <select
                  value={concurrency}
                  onChange={(event) => setConcurrency(Number(event.target.value))}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
              <span className="global-capacity">全局 3 · 活跃 {activeRuns.length}/2</span>
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
                }
              >
                开始任务 <span>→</span>
              </button>
            </div>
          </div>
        </section>
      </main>

      <aside className="event-rail">
        <div className="event-header">
          <div>
            <span className="live-dot" />
            运行轨迹
          </div>
          <span>{selectedRun?.eventCount ?? 0}</span>
        </div>
        <div className="event-list">
          {selectedRun?.recentEvents.toReversed().map((event) => (
            <div className="event-item" key={event.sequence}>
              <span className={`event-icon ${event.type.split(".")[0]}`}>{eventGlyph(event.type)}</span>
              <div>
                <strong>{eventLabel(event.type)}</strong>
                <p>{event.detail ?? event.taskId ?? event.agentId ?? "runtime"}</p>
                <small>#{event.sequence} · {formatClock(event.timestamp)}</small>
              </div>
            </div>
          ))}
          {selectedRun?.recentEvents.length === 0 && (
            <div className="empty-events">事件将在这里实时出现</div>
          )}
        </div>
        <div className="runtime-card">
          <span>RUNTIME</span>
          <strong>{providerLabel(selectedRun?.providerId ?? providerId)} · SSE</strong>
          <p>
            跨 Run 全局并发 3<br />
            {selectedRun?.extensions === undefined
              ? "扩展按 Run 显式启用"
              : `${selectedRun.extensions.skillIds.length} Skills · ${selectedRun.extensions.mcpServerIds.length} MCP · ${selectedRun.extensions.browserOrigins.length > 0 ? "Browser" : "No Browser"}`}
          </p>
        </div>
      </aside>
    </div>
  );
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
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`;
}

function toMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
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
